// Turn structure. phaseQueue holds the remaining steps of the turn after the current one
// (ENGINE-NOTES, deviation 1). nextStep ends the current step (mana empties, combat ends) and
// moves to the next one or starts the next turn; stepActions performs the turn-based actions at
// the start of a step. apply.ts drives both and gives priority.
//
//   untap      day/night check (CR 731.2 (day/night check)), untap, summoning sickness clears; no priority
//   upkeep     'upkeep' step event
//   draw       draw a card, except the starting player's first turn (CR 103.8a (skips the draw))
//   main1      lore counters on sagas, 'precombatMain' step event
//   beginCombat, declareAttackers (choice), declareBlockers (choice), combatDamage, endCombat
//   main2
//   end        'endStep' step event (delayed 'next end step' triggers fire here)
//   cleanup    discard to hand size, damage wears off, until-end-of-turn effects end; no priority
//              unless something triggers or an SBA happens, then another cleanup follows
import { getDef } from '../cards/index.js';
import { COMBAT_STEPS, PHASE_OF, TURN_STEPS } from './types.js';
import type { GameState, PlayerId, Step } from './types.js';
import { pushEvent, removeEffect, setField, setIn, setTop } from './mutate.js';
import { emptyPool } from './mana.js';
import { drawCard, discard, type Picker } from './zones.js';
import { hasKeyword } from './statics.js';
import { addLoreForTurn } from './saga.js';
import { attackCandidates, blockersAvailable, removeFromCombat, combatDamage } from './combat.js';
import { clearIfSet } from './ctx.js';

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

/**
 * Optional read-only observer called with the state at the end of every turn (after cleanup,
 * before the next turn starts). Not game state and never set by the engine: a measuring caller
 * (src/sim/games.ts, key cards by own turn N) sets it around its own applyMoveInPlace call only,
 * because advance() runs through turns in which nobody has a decision, and a caller that looks
 * only at decision points would miss what happened late in such a turn.
 */
let turnEndObserver: ((state: GameState) => void) | null = null;
export function setTurnEndObserver(fn: ((state: GameState) => void) | null): void {
  turnEndObserver = fn;
}

/** Steps in which players normally get priority (CR 117.3a (priority at beginning of steps)). */
export function priorityStep(step: Step): boolean {
  return step !== 'untap' && step !== 'cleanup' && step !== 'mulligan';
}

/**
 * Starts the next turn: the day/night check, fresh turn flags, then the untap step.
 * Turn 1 belongs to the starting player.
 */
export function startTurn(state: GameState): void {
  const prev = state.activePlayer;
  const first = state.turn === 0;
  if (!first && turnEndObserver) turnEndObserver(state);
  const active: PlayerId = first ? state.startingPlayer : other(prev);
  if (!first) dayNightCheck(state, prev);
  setTop(state, 'turn', state.turn + 1);
  setTop(state, 'activePlayer', active);
  setTop(state, 'priority', active);
  setTop(state, 'turnFlags', {
    landsPlayed: [0, 0], spellsCast: [0, 0], noncreatureSpellsCast: [0, 0], permanentLeft: [false, false],
    nextCreatureBonus: [false, false], damageTally: {}, loyaltyUsed: [],
  });
  for (const id of state.zones.battlefield) {
    const o = state.objects[id];
    if (!o) continue;
    if (o.damagedThisTurnBy[0] || o.damagedThisTurnBy[1]) setField(state, id, 'damagedThisTurnBy', [false, false]);
    if (o.attacksThisTurn !== undefined) setIn(state, ['objects', id, 'attacksThisTurn'], 0);
    if (o.valiantUsed) setField(state, id, 'valiantUsed', false);
  }
  setTop(state, 'step', 'untap');
  setTop(state, 'phaseQueue', TURN_STEPS.slice(1));
  setTop(state, 'stepPriority', false);
  setTop(state, 'passes', 0);
}

/**
 * CR 731.2a (day becomes night) and CR 731.2b (night becomes day), checked as the untap step
 * begins using the previous turn's active player's spell count. CR 731.2c (neither day nor night): no change.
 */
function dayNightCheck(state: GameState, prevActive: PlayerId): void {
  const cast = state.turnFlags.spellsCast[prevActive];
  if (state.dayNight === 'day' && cast === 0) setDayNight(state, 'night');
  else if (state.dayNight === 'night' && cast >= 2) setDayNight(state, 'day');
}

/**
 * Sets day or night and transforms daybound and nightbound permanents to match.
 * CR 702.145 (daybound): daybound permanents are front face up during the day, nightbound back face up at night.
 */
export function setDayNight(state: GameState, dn: 'day' | 'night'): void {
  if (state.dayNight === dn) return;
  setTop(state, 'dayNight', dn);
  for (const id of [...state.zones.battlefield]) {
    const o = state.objects[id];
    if (!o || getDef(o.defId).layout !== 'transform') continue;
    if (dn === 'night' && o.face === 0 && hasKeyword(state, id, 'daybound')) setField(state, id, 'face', 1);
    else if (dn === 'day' && o.face === 1 && hasKeyword(state, id, 'nightbound')) setField(state, id, 'face', 0);
  }
}

/**
 * Ends the current step and enters the next one (or the next turn). The caller runs stepActions
 * for the new step. Throws if the stack is not empty (fuzz invariant 5): steps end only after all
 * players pass with an empty stack.
 */
export function nextStep(state: GameState): void {
  if (state.zones.stack.length > 0) throw new Error(`invariant 5: stack not empty at the end of ${state.step}`);
  const ending = state.step;
  // CR 106.4 (mana empties): pools empty at the end of each step; firebending mana lasts until end of combat.
  for (const p of [0, 1] as const) emptyPool(state, p, ending === 'endCombat' ? 'endOfCombat' : 'step');
  if (ending === 'endCombat') removeFromCombat(state);
  let queue = state.phaseQueue;
  // CR 514.3a (another cleanup step): if players got priority during cleanup, another cleanup follows.
  if (ending === 'cleanup' && state.stepPriority) queue = ['cleanup', ...queue];
  if (queue.length === 0) {
    startTurn(state);
    return;
  }
  setTop(state, 'step', queue[0] as Step);
  setTop(state, 'phaseQueue', queue.slice(1));
  setTop(state, 'stepPriority', priorityStep(queue[0] as Step));
  setTop(state, 'priority', state.activePlayer);
  setTop(state, 'passes', 0);
}

/** Turn-based actions as a step begins (before anyone gets priority). May ask the active player a Choice. */
export function stepActions(state: GameState, step: Step, pick?: Picker): void {
  const ap = state.activePlayer;
  switch (step) {
    case 'untap':
      for (const id of state.zones.battlefield) {
        const o = state.objects[id];
        if (!o || o.controller !== ap) continue;
        // CR 302.6 (summoning sickness): controlled continuously since the turn began.
        if (o.sick) setField(state, id, 'sick', false);
        // CR 502.3 (untap): the active player untaps their permanents.
        if (o.tapped) setField(state, id, 'tapped', false);
      }
      return;
    case 'upkeep':
      pushEvent(state, { e: 'step', step: 'upkeep', player: ap });
      return;
    case 'draw':
      // CR 103.8a (skips the draw): the starting player skips the draw of turn 1.
      if (state.turn > 1) drawCard(state, ap);
      return;
    case 'main1':
      addLoreForTurn(state);
      pushEvent(state, { e: 'step', step: 'main1', player: ap });
      return;
    case 'declareAttackers':
      if (attackCandidates(state, ap).length > 0) setTop(state, 'pendingChoice', { kind: 'declareAttackers', player: ap });
      else skipBlocksAndDamage(state);
      return;
    case 'declareBlockers': {
      const dp = other(ap);
      if (blockersAvailable(state, dp)) setTop(state, 'pendingChoice', { kind: 'declareBlockers', player: dp });
      return;
    }
    case 'combatDamage':
      combatDamage(state);
      return;
    case 'end':
      pushEvent(state, { e: 'step', step: 'end', player: ap });
      return;
    case 'cleanup':
      cleanup(state, pick);
      return;
    default:
      return;
  }
}

/** CR 508.8 (no attackers): skip the declare blockers and combat damage steps. */
export function skipBlocksAndDamage(state: GameState): void {
  const q = state.phaseQueue;
  const i = q.indexOf('declareBlockers');
  const j = q.indexOf('combatDamage');
  if (i === 0 && j === 1) setTop(state, 'phaseQueue', q.slice(2));
}

export const MAX_HAND = 7;

function cleanup(state: GameState, pick?: Picker): void {
  const ap = state.activePlayer;
  // CR 514.1 (discard to hand size): the active player discards down to seven.
  const hand = state.zones.hand[ap];
  const excess = hand.length - MAX_HAND;
  if (excess > 0) {
    const choice = { kind: 'pickObjects' as const, player: ap, reason: 'cleanupDiscard', from: [...hand], min: excess, max: excess };
    if (!pick) throw new Error('cleanup: a discard choice needs a picker');
    const ids = pick(choice).ids ?? [];
    if (ids.length !== excess || new Set(ids).size !== excess || ids.some((id) => !hand.includes(id))) {
      throw new Error(`cleanup: discard needs ${excess} distinct cards from the hand`);
    }
    for (const id of ids) discard(state, id);
  }
  // CR 514.2 (damage removed): damage wears off and until-end-of-turn effects end, simultaneously.
  for (const id of state.zones.battlefield) {
    const o = state.objects[id];
    if (!o) continue;
    if (o.damage !== 0) setField(state, id, 'damage', 0);
    clearIfSet(state, id, 'deathtouched');
    clearIfSet(state, id, 'animated');
    clearIfSet(state, id, 'crewed');
  }
  for (const e of [...state.effects]) {
    if ((e.kind === 'ptDelta' || e.kind === 'keywords' || e.kind === 'exileIfDies') && e.until === 'eot') removeEffect(state, e.eid);
    else if (e.kind === 'playFromExile' && e.untilTurn <= state.turn) removeEffect(state, e.eid);
  }
  if (state.turnFlags.nextCreatureBonus[ap]) setIn(state, ['turnFlags', 'nextCreatureBonus', ap], false);
}

/**
 * Fear of Missing Out: an additional combat phase directly after the current combat phase
 * (CR 500.8 (extra phases)); the most recently created one happens first.
 */
export function insertExtraCombat(state: GameState): void {
  const q = state.phaseQueue;
  let at = q.findIndex((s) => PHASE_OF[s] !== 'combat');
  if (at < 0) at = q.length;
  setTop(state, 'phaseQueue', [...q.slice(0, at), ...COMBAT_STEPS, ...q.slice(at)]);
}
