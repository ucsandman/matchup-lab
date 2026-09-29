// The effect context handed to card effect functions (EffectCtx in types.ts), plus
// runWithChoices, the replay mechanism for effects that need player decisions mid-resolution:
// run the effect with the answers known so far; if it asks for one more, roll the state back
// with the journal and return the Choice. When answered, run again with one more answer. Effects
// are deterministic given state and answers, so the replay reaches the same point.
import { getDef } from '../cards/index.js';
import {
  addEffect, allocId, beginJournal, cloneData, endJournal, mark, pushEvent, setField, undoTo, addCounter, addPoolEntry, clearField, spliceIn,
} from './mutate.js';
import { characteristics, controlsLandType, isType } from './statics.js';
import { gainLife, loseLife } from './life.js';
import {
  createToken, destroy, discard, drawCards, exileObj, mill, moveObject, NeedChoice, sacrifice, scry1, type Picker,
} from './zones.js';
import { dealDamage } from './damage.js';
import { insertExtraCombat } from './turn.js';
import { setPlayer } from './mutate.js';
import { setIn as setSagaIn } from './mutate.js';
import { die as dieAll } from './zones.js';
import type {
  AbilityKey, Choice, ChoiceAnswer, EffectCtx, GameState, ObjId, PlayerId, StackItem, Target,
} from './types.js';

export { NeedChoice } from './zones.js';

/** Resolution context: the stack item and the targets that became illegal (CR 608.2b (illegal targets)). */
export interface CtxExtra {
  item?: StackItem;
  /** targetKey strings ('o12', 'p1') of targets that are illegal on resolution. */
  illegal?: readonly string[];
}

export function makeCtx(state: GameState, source: ObjId, controller: PlayerId, abilityKey: AbilityKey, pick?: Picker, extra: CtxExtra = {}): EffectCtx {
  const opponent: PlayerId = controller === 0 ? 1 : 0;
  const illegal = extra.illegal ?? [];
  // Perf (docs/PERF.md): helpers and ctx functions are method shorthand, not named arrows, because
  // tsx (esbuild keepNames) wraps every named arrow in __name(), an Object.defineProperty per
  // function per makeCtx call, which was about 30 percent of a random game's time.
  const helpers = {
    choose(choice: Choice): ChoiceAnswer {
      if (!pick) throw new NeedChoice(choice);
      return pick(choice);
    },
    /** An object an effect may act on: it exists and is not an illegal target. */
    live(id: ObjId): boolean { return state.objects[id] !== undefined && !illegal.includes(`o${id}`); },
    onField(id: ObjId): boolean { return helpers.live(id) && state.objects[id]?.zone === 'battlefield'; },
  };
  const { choose, live, onField } = helpers;
  const lki = extra.item?.lki;
  const ctx: EffectCtx = {
    state, source, controller, opponent, abilityKey,
    item: extra.item ?? null,
    isLegalTarget(t) { return !illegal.includes(t.kind === 'player' ? `p${t.p}` : `o${t.id}`); },
    tap(id) { if (onField(id) && !state.objects[id]?.tapped) setField(state, id, 'tapped', true); },
    untap(id) { if (onField(id) && state.objects[id]?.tapped) setField(state, id, 'tapped', false); },
    animate(id, overlay) { if (onField(id)) setField(state, id, 'animated', cloneData(overlay)); },
    transform(id) {
      const o = state.objects[id];
      // CR 712.9 (transform): only double-faced permanents transform; anything else: nothing happens.
      if (!o || !onField(id) || getDef(o.defId).layout !== 'transform') return;
      setField(state, id, 'face', o.face === 0 ? 1 : 0);
    },
    exileAndReturnTransformed(id) {
      if (!onField(id)) return null;
      const ex = exileObj(state, id);
      if (ex === null) return null;
      return moveObject(state, ex, 'battlefield', { face: 1, controller, cause: 'returnTransformed' });
    },
    addDelayed(on, abilityIndex, objId) {
      const [defId, face] = abilityKey.split(':');
      const rec = { id: allocId(state), key: `${defId}:${face}:${abilityIndex}`, sourceId: source, controller, on, createdTurn: state.turn };
      spliceIn(state, ['delayed'], state.delayed.length, 0, objId === undefined ? rec : { ...rec, objId });
    },
    addExtraCombat() { return insertExtraCombat(state); },
    grantPlayFromExile(objId, player, untilTurn) { return addEffect(state, { eid: allocId(state), kind: 'playFromExile', objId, player, untilTurn }); },
    // Sagas family: Kumano chapter II flag (consumed by castSpell, cleared at cleanup) and CR 104.3e (effect: loses the game).
    setNextCreatureBonus(player) { if (!state.turnFlags.nextCreatureBonus[player]) setSagaIn(state, ['turnFlags', 'nextCreatureBonus', player], true); },
    loseGame(player, reason) { if (!state.result) setSagaIn(state, ['result'], { winner: player === 0 ? 1 : 0, reason }); },
    addExiledWith(id, n) {
      const o = state.objects[id];
      if (o && n > 0) setField(state, id, 'exiledWith', (o.exiledWith ?? 0) + n);
    },
    addNamedBan(name, grant) {
      if (state.objects[source]?.zone !== 'battlefield') return;
      const e = { eid: allocId(state), kind: 'namedBan' as const, player: controller, name, sourceId: source };
      addEffect(state, grant === undefined ? e : { ...e, grant });
    },
    obj(id) { return state.objects[id]; },
    chars(id) { return characteristics(state, id); },
    isType(id, type) { return isType(state, id, type); },
    count(nameOrToken, player) {
      let n = 0;
      for (const id of state.zones.battlefield) {
        const o = state.objects[id];
        if (!o || o.controller !== player) continue;
        if (characteristics(state, id).name === nameOrToken || (o.token !== undefined && getDef(o.token).name === nameOrToken)) n++;
      }
      return n;
    },
    permanents(player, pred) { return state.zones.battlefield.filter((id) => state.objects[id]?.controller === player && (!pred || pred(id))); },
    controlsLandType(player, types) { return controlsLandType(state, player, types); },
    choose,
    createToken(token, ctl, opts) { return createToken(state, token, ctl, opts); },
    moveTo(id, zone, opts) { return (live(id) && state.objects[id]?.zone !== zone ? moveObject(state, id, zone, opts) : null); },
    draw(player, n = 1) { return drawCards(state, player, n); },
    discard(id) { if (live(id) && state.objects[id]?.zone === 'hand') discard(state, id); },
    mill(player, n) { return mill(state, player, n); },
    exile(id) { return (live(id) && state.objects[id]?.zone !== 'exile' ? exileObj(state, id) : null); },
    sacrifice(id) { if (onField(id)) sacrifice(state, id, choose); },
    destroy(id) { if (onField(id)) destroy(state, id, choose); },
    destroyAll(ids) { const on = ids.filter(onField); if (on.length > 0) dieAll(state, on, 'destroy', choose); },
    addCounter(id, type, n) {
      if (!live(id)) return;
      const cur = state.objects[id]?.counters[type] ?? 0;
      const delta = Math.max(n, -cur);
      if (delta === 0) return;
      addCounter(state, id, type, delta);
      if (delta > 0) pushEvent(state, { e: 'counterAdded', id, counter: type, n: delta });
    },
    addEotDelta(id, p, t) { if (onField(id)) addEffect(state, { eid: allocId(state), kind: 'ptDelta', target: id, p, t, until: 'eot' }); },
    grantEot(id, keywords) { if (onField(id)) addEffect(state, { eid: allocId(state), kind: 'keywords', target: id, keywords: [...keywords], until: 'eot' }); },
    addMana(player, color, opts = {}) {
      addPoolEntry(state, player, { color, ...opts });
      pushEvent(state, { e: 'manaAdded', player, color, sourceId: source });
    },
    gainLife(player, n) { gainLife(state, player, n); },
    loseLife(player, n) { return loseLife(state, player, n); },
    setCantGainLife(player) { if (!state.players[player].cantGainLife) setPlayer(state, player, 'cantGainLife', true); },
    dealDamage(target, n, opts = {}) {
      if (!ctx.isLegalTarget(target)) return 0;
      const dopts = lki ? { controller, lki } : { controller };
      return dealDamage(state, source, target, n, !!opts.combat, dopts);
    },
    // removal-discard family (Duress, Thoughtseize, Torch the Tower): reveal, scry 1, exile-if-dies tag.
    reveal(ids) {
      for (const id of ids) {
        const o = state.objects[id];
        if (o && (o.zone === 'hand' || o.zone === 'library') && !(o.knownTo[0] && o.knownTo[1])) setField(state, id, 'knownTo', [true, true]);
      }
    },
    scry1(player) {
      const lib = state.zones.library[player];
      const top = lib[lib.length - 1];
      if (top === undefined) return;
      // CR 701.22a (scry): the player looks at the card (reveal to the chooser), then top or bottom.
      const ans = choose({ kind: 'pickObjects', player, reason: 'scry1', from: [top], min: 0, max: 1, reveal: [top] });
      scry1(state, player, (ans.ids ?? []).includes(top));
    },
    exileIfDiesThisTurn(id) {
      if (onField(id)) addEffect(state, { eid: allocId(state), kind: 'exileIfDies', target: id, until: 'eot' });
    },
  };
  return ctx;
}

/** Removes a field only when present (keeps the journal short). */
export function clearIfSet(state: GameState, id: ObjId, key: 'deathtouched' | 'blocked' | 'animated' | 'crewed'): void {
  if (state.objects[id]?.[key] !== undefined) clearField(state, id, key);
}

export type ReplayResult<T> = { done: true; value: T } | { done: false; choice: Choice };

/**
 * Runs fn with a picker that returns answers in order. If fn needs one more answer, the state is
 * rolled back to where it was and the pending Choice is returned. Works in copy mode too: the
 * journal is switched on for the run and removed again afterwards.
 */
export function runWithChoices<T>(state: GameState, answers: readonly ChoiceAnswer[], fn: (pick: Picker) => T): ReplayResult<T> {
  const hadJournal = state.journal !== undefined;
  beginJournal(state);
  const m = mark(state);
  let i = 0;
  const { pick } = {
    pick(choice: Choice): ChoiceAnswer {
      const a = answers[i++];
      if (a === undefined) throw new NeedChoice(choice);
      return a;
    },
  };
  try {
    const value = fn(pick);
    if (!hadJournal) endJournal(state);
    return { done: true, value };
  } catch (e) {
    undoTo(state, m);
    if (!hadJournal) endJournal(state);
    if (e instanceof NeedChoice) return { done: false, choice: e.choice };
    throw e;
  }
}
