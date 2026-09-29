// State-based actions (CR 704.3 (state-based actions)): checked whenever a player would receive
// priority; all applicable ones are performed at once, then the check repeats until none apply
// (apply.ts loops). One call of checkSBA performs one simultaneous round and returns whether
// anything happened.
//
// Covered: 704.5a (0 life), 704.5b (draw from empty library), 704.5d (tokens elsewhere, done at
// once in moveObject), 704.5f (toughness 0), 704.5g (lethal damage), 704.5h (deathtouch), 704.5i
// (0 loyalty), 704.5j (legend rule), 704.5m (Aura attached illegally), 704.5q (counter
// annihilation), 704.5s (saga final chapter), Role uniqueness (CR 303.7a (Role)), and
// CR 104.4a (all lose simultaneously: draw).
import { getAbility } from '../cards/index.js';
import { addCounter, setTop } from './mutate.js';
import { characteristics, classKey, isType, KW, TYPE } from './statics.js';
import { setDayNight } from './turn.js';
import { die, type Picker } from './zones.js';
import { finalChapter } from './saga.js';
import { clearIfSet } from './ctx.js';
import type { GameState, ObjId, PlayerId } from './types.js';

function isChapterKey(key: string | undefined): boolean {
  if (!key || key.startsWith('builtin:')) return false;
  const ab = getAbility(key).ability;
  return ab.kind === 'triggered' && ab.event === 'chapter';
}

/** CR 714.4 (saga sacrifice): not while a chapter ability from it has triggered and not left the stack. */
function chapterPending(state: GameState, id: ObjId): boolean {
  if (state.pendingTriggers.some((t) => t.sourceId === id && isChapterKey(t.key))) return true;
  return state.zones.stack.some((s) => s.kind === 'triggered' && s.sourceId === id && isChapterKey(s.abilityKey));
}

export function checkSBA(state: GameState, pick?: Picker): boolean {
  if (state.result) return false;
  // Players.
  const losers: PlayerId[] = [];
  for (const p of [0, 1] as const) {
    const pl = state.players[p];
    // CR 704.5a (0 or less life) and CR 704.5b (draw from empty library).
    if (pl.life <= 0 || pl.drewFromEmpty) losers.push(p);
  }
  if (losers.length === 2) {
    // CR 104.4a (lose simultaneously): the game is a draw.
    setTop(state, 'result', { winner: 'draw', reason: 'both players lost simultaneously' });
    setTop(state, 'pendingChoice', null);
    return true;
  }
  if (losers.length === 1) {
    const l = losers[0] as PlayerId;
    const reason = state.players[l].life <= 0 ? 'life' : 'drew from an empty library';
    setTop(state, 'result', { winner: l === 0 ? 1 : 0, reason });
    setTop(state, 'pendingChoice', null);
    return true;
  }

  let acted = false;
  if (state.dayNight === 'none') {
    // CR 702.145d (neither day nor night: becomes day) with a daybound permanent;
    // CR 702.145g (becomes night) with only nightbound ones. Not an SBA, but checked at the same moments.
    let any = 0;
    for (const id of state.zones.battlefield) any |= characteristics(state, id).kw;
    if (any & KW.daybound) { setDayNight(state, 'day'); acted = true; }
    else if (any & KW.nightbound) { setDayNight(state, 'night'); acted = true; }
  }
  const toGraveyard: ObjId[] = [];
  const { add } = { add(id: ObjId): void { if (!toGraveyard.includes(id)) toGraveyard.push(id); } };
  const legends = new Map<string, ObjId[]>();
  const roles = new Map<string, ObjId[]>();

  for (const id of state.zones.battlefield) {
    const o = state.objects[id];
    if (!o) continue;
    const c = characteristics(state, id);
    // CR 704.5q (counters annihilate): +1/+1 and -1/-1 counters cancel in pairs.
    const plus = o.counters.p1p1 ?? 0;
    const minus = o.counters.m1m1 ?? 0;
    // Characteristics after the annihilation (the same object the memo returns until then).
    let cc = c;
    if (plus > 0 && minus > 0) {
      const n = Math.min(plus, minus);
      addCounter(state, id, 'p1p1', -n);
      addCounter(state, id, 'm1m1', -n);
      acted = true;
      cc = characteristics(state, id);
    }
    if (cc.types & TYPE.Creature) {
      // CR 704.5f (toughness 0 or less): put into its owner's graveyard.
      if (cc.toughness <= 0) add(id);
      // CR 704.5g (lethal damage) and CR 704.5h (deathtouch): destroyed.
      else if (o.damage >= cc.toughness || (o.deathtouched && o.damage > 0)) add(id);
    }
    // CR 704.5i (planeswalker loyalty 0).
    if ((cc.types & TYPE.Planeswalker) && (o.counters.loyalty ?? 0) <= 0) add(id);
    if (c.legendary) {
      const k = `${o.controller}|${c.name}`;
      const arr = legends.get(k);
      if (arr) arr.push(id);
      else legends.set(k, [id]);
    }
    if (c.subtypes.includes('Aura')) {
      const host = o.attachedTo !== undefined ? state.objects[o.attachedTo] : undefined;
      // CR 704.5m (Aura attached illegally): Roles enchant creatures.
      if (!host || host.zone !== 'battlefield' || !isType(state, host.id, 'Creature')) add(id);
      else if (c.subtypes.includes('Role')) {
        const k = `${o.controller}|${host.id}`;
        const arr = roles.get(k);
        if (arr) arr.push(id);
        else roles.set(k, [id]);
      }
    }
    // CR 704.5s (saga sacrifice).
    if (cc.subtypes.includes('Saga')) {
      const fin = finalChapter(state, id);
      if (fin > 0 && (o.counters.lore ?? 0) >= fin && !chapterPending(state, id)) add(id);
    }
  }
  // CR 303.7a (Role): only the newest Role a player controls on one permanent stays (ids grow with time).
  for (const ids of roles.values()) if (ids.length > 1) for (const id of [...ids].sort((a, b) => a - b).slice(0, -1)) add(id);
  // CR 704.5j (legend rule): the controller chooses one to keep; identical copies need no choice.
  for (const [k, ids] of legends) {
    if (ids.length < 2) continue;
    const player = Number(k.split('|')[0]) as PlayerId;
    let keep: ObjId;
    const sorted = [...ids].sort((a, b) => a - b);
    if (new Set(sorted.map((id) => classKey(state, id))).size === 1) keep = sorted[sorted.length - 1] as ObjId;
    else {
      if (!pick) throw new Error('legend rule needs a picker');
      const ans = pick({ kind: 'pickObjects', player, reason: 'legendRule', from: sorted, min: 1, max: 1 }).ids ?? [];
      const chosen = ans[0];
      if (chosen === undefined || !sorted.includes(chosen)) throw new Error('legend rule: bad choice');
      keep = chosen;
    }
    for (const id of sorted) if (id !== keep) add(id);
  }
  if (toGraveyard.length > 0) {
    die(state, toGraveyard, 'sba', pick);
    acted = true;
  }
  // The deathtouch flag lasts until the next SBA check.
  for (const id of state.zones.battlefield) clearIfSet(state, id, 'deathtouched');
  return acted;
}
