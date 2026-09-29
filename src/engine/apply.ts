// applyMove: runs one move, then advances the game (state-based actions, triggers, priority passes
// with no real alternative, turn-based actions and step changes) until a player has a real
// decision: a pending Choice, or priority with at least one move other than passing.
//
// Two modes, one code path (PLAN.md section 6):
//  - copy mode, applyMove(state, move): works on a structuredClone and returns it; the input is
//    untouched;
//  - journal mode, applyMoveInPlace(state, move): mutates state; with beginJournal/mark/undoTo the
//    caller rewinds it.
//
// Decisions inside an operation (a legend-rule choice during SBAs, a discard during resolution,
// trigger order and targets, a cleanup discard) use replay: the operation runs through
// runWithChoices; if it needs an answer it is rolled back, state.pendingChoice is set and
// state.pending records the operation and the answers so far. Answering replays it with one more
// answer (effects are deterministic given state and answers).
//
// Priority: CR 117.3b (priority after resolution), CR 117.3c (priority after acting),
// CR 117.4 (all players pass). After an action the actor keeps priority; after a resolution the active
// player gets it; when both pass in succession the top of the stack resolves, or with an empty
// stack the step ends. Auto-pass: a player whose only legal move is pass passes without a decision.
import { runWithChoices } from './ctx.js';
import { cloneData, getContentTick, setTop } from './mutate.js';
import { answerPregame } from './mulligan.js';
import { checkSBA } from './sba.js';
import { collectTriggers, putTriggers } from './triggers.js';
import { activateAbility, castSpell, playLand, resolveTop, unlockDoor } from './stack.js';
import { nextStep, startTurn, stepActions } from './turn.js';
import { declareAttackers, declareBlockers } from './combat.js';
import { hasAction } from './moves.js';
import type { Picker } from './zones.js';
import type { ChoiceAnswer, EngineOp, GameState, Move, PlayerId } from './types.js';

/** applyMove's internal advance loop cap (fuzz invariant 6): more iterations means a hang. */
export const LOOP_CAP = 10_000;

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

/**
 * Copy mode: returns a new state; the journal (if any) is not copied. cloneData, not
 * structuredClone: about 5 times faster on a mid-game state and identical on plain data (docs/PERF.md).
 */
export function cloneState(state: GameState): GameState {
  const { journal: _journal, ...rest } = state;
  return cloneData(rest) as GameState;
}

export function applyMove(state: GameState, move: Move): GameState {
  const s = cloneState(state);
  applyMoveInPlace(s, move);
  return s;
}

function execOp(state: GameState, op: EngineOp, pick: Picker): boolean {
  switch (op.kind) {
    case 'move': {
      const m = op.move;
      if (m.type === 'playLand') playLand(state, op.player, m);
      else if (m.type === 'cast') castSpell(state, op.player, m, pick);
      else if (m.type === 'activate') activateAbility(state, op.player, m, pick);
      else if (m.type === 'unlockDoor') unlockDoor(state, op.player, m, pick);
      else throw new Error(`execOp: ${m.type} is not an action`);
      setTop(state, 'passes', 0);
      setTop(state, 'priority', op.player);
      return true;
    }
    case 'resolve':
      resolveTop(state, pick);
      setTop(state, 'passes', 0);
      setTop(state, 'priority', state.activePlayer);
      return true;
    case 'sba':
      return checkSBA(state, pick);
    case 'triggers':
      putTriggers(state, pick);
      return true;
    case 'stepAction':
      stepActions(state, op.step, pick);
      return true;
    default:
      return false;
  }
}

/** Runs op with replay; returns its result, or null when it stopped for a Choice. */
function runOp(state: GameState, op: EngineOp, answers: readonly ChoiceAnswer[] = []): boolean | null {
  const r = runWithChoices(state, answers, (pick) => execOp(state, op, pick));
  if (r.done) return r.value;
  setTop(state, 'pendingChoice', r.choice);
  setTop(state, 'pending', { op: cloneData(op), answers: answers.map((a) => cloneData(a)) });
  return null;
}

function beginStep(state: GameState): void {
  // Only the cleanup discard asks a Choice (stepActions passes the picker nowhere else), so the
  // other steps skip the replay wrapper and its journal (docs/PERF.md, T1.5).
  if (state.step !== 'cleanup') {
    stepActions(state, state.step);
    return;
  }
  runOp(state, { kind: 'stepAction', step: state.step });
}

/** Leaves the pregame and starts turn 1 once both players kept. */
function startGame(state: GameState): void {
  startTurn(state);
  beginStep(state);
}

function pass(state: GameState): void {
  const passes = state.passes + 1;
  if (passes < 2) {
    setTop(state, 'passes', passes);
    setTop(state, 'priority', other(state.priority));
    return;
  }
  setTop(state, 'passes', 0);
  if (state.zones.stack.length > 0) {
    runOp(state, { kind: 'resolve' });
    return;
  }
  nextStep(state);
  beginStep(state);
}

/**
 * The last state-based action check that found nothing and wrote nothing: its state and content
 * tick (mutate.ts). checkSBA reads no timing field and not the event buffer, so while the tick is
 * unchanged another check of the same state would find nothing again and is skipped (docs/PERF.md,
 * T1.5). Most loop iterations follow a priority pass or a step change, which leave the tick alone.
 */
let quietState: GameState | null = null;
let quietTick = -1;

function checkSBAOp(state: GameState): boolean | null {
  const tick = getContentTick();
  if (quietState === state && quietTick === tick) return false;
  const r = runOp(state, { kind: 'sba' });
  if (r === false && getContentTick() === tick) {
    quietState = state;
    quietTick = tick;
  }
  return r;
}

/** Runs the engine until someone has a real decision or the game is over. */
export function advance(state: GameState): void {
  for (let i = 0; ; i++) {
    if (i >= LOOP_CAP) throw new Error(`applyMove: advance loop cap ${LOOP_CAP} hit (turn ${state.turn}, step ${state.step})`);
    if (state.result) {
      if (state.pendingChoice) setTop(state, 'pendingChoice', null);
      if (state.pending) setTop(state, 'pending', null);
      return;
    }
    if (state.pendingChoice) return;
    if (state.pregame) return;
    collectTriggers(state);
    const sba = checkSBAOp(state);
    if (sba === null) return;
    if (sba) {
      // CR 514.3a (cleanup priority): an SBA during cleanup gives players priority.
      if (state.step === 'cleanup' && !state.stepPriority) setTop(state, 'stepPriority', true);
      continue;
    }
    // CR 502.4 (no priority in untap): triggers from the untap step wait for the upkeep.
    if (state.pendingTriggers.length > 0 && state.step !== 'untap') {
      if (state.step === 'cleanup' && !state.stepPriority) setTop(state, 'stepPriority', true);
      runOp(state, { kind: 'triggers' });
      continue;
    }
    if (state.stepPriority) {
      if (hasAction(state, state.priority)) return;
      pass(state);
      continue;
    }
    nextStep(state);
    beginStep(state);
  }
}

/**
 * Journal mode: applies the move to state in place and advances. Throws on a move that is not
 * the current decision. Returns state.
 */
export function applyMoveInPlace(state: GameState, move: Move): GameState {
  if (state.result) throw new Error('applyMove: the game is over');
  const ch = state.pendingChoice;
  if (ch) {
    if (ch.kind === 'mulligan' || ch.kind === 'bottom') {
      if (move.type !== 'choose') throw new Error(`applyMove: expected a pregame choice, got ${move.type}`);
      answerPregame(state, move.answer);
      if (!state.pregame && !state.pendingChoice) startGame(state);
    } else if (ch.kind === 'declareAttackers') {
      if (move.type !== 'declareAttackers') throw new Error(`applyMove: expected declareAttackers, got ${move.type}`);
      setTop(state, 'pendingChoice', null);
      declareAttackers(state, move.assignments);
    } else if (ch.kind === 'declareBlockers') {
      if (move.type !== 'declareBlockers') throw new Error(`applyMove: expected declareBlockers, got ${move.type}`);
      setTop(state, 'pendingChoice', null);
      declareBlockers(state, move.assignments);
    } else {
      if (move.type !== 'choose') throw new Error(`applyMove: expected choose, got ${move.type}`);
      const pend = state.pending;
      if (!pend) throw new Error('applyMove: a choice is pending but no operation records it');
      setTop(state, 'pendingChoice', null);
      setTop(state, 'pending', null);
      runOp(state, pend.op, [...pend.answers, move.answer]);
    }
  } else if (move.type === 'pass') {
    if (!state.stepPriority) throw new Error('applyMove: nobody has priority');
    pass(state);
  } else if (move.type === 'choose' || move.type === 'declareAttackers' || move.type === 'declareBlockers') {
    throw new Error(`applyMove: ${move.type} without a pending choice`);
  } else {
    runOp(state, { kind: 'move', player: state.priority, move });
  }
  advance(state);
  return state;
}
