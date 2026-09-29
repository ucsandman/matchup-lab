// The damage pipeline. Every damage event in the engine goes through dealDamage:
//   1. replacements: damageReplacement statics (Soul-Scar Mage turns damage into -1/-1 counters;
//      the damage is then not dealt and 0 is returned);
//   2. results by target: player loses life, planeswalker loses loyalty, creature gets damage
//      marked (and the deathtouch flag when the source has deathtouch);
//   3. lifelink through gainLife (so cantGainLife applies);
//   4. bookkeeping: damagedThisTurnBy on permanents (Etching of Kumano), the per-source tally to
//      players only for sources flagged with the static marker 'tracksDamageDealt' (Vessel);
//   5. a 'damage' event. The trigger system (triggers.ts) sums all damage events drained together
//      per object, so a creature dealt damage by several sources at once triggers once (PLAN.md D12).
// Returns the damage actually dealt.
import { getAbility, getDef } from '../cards/index.js';
import { addCounter, pushEvent, setField, setIn } from './mutate.js';
import { characteristics, isType, KW, staticAbilities } from './statics.js';
import { gainLife, loseLife } from './life.js';
import { makeCtx } from './ctx.js';
import type { GameObject, GameState, ObjId, PlayerId, Target } from './types.js';

interface SourceInfo { controller: PlayerId; kw: number; tracks: boolean }

function tracksFromKeys(keys: readonly string[]): boolean {
  return keys.some((k) => {
    if (k.startsWith('basic:')) return false;
    const ab = getAbility(k).ability;
    return ab.kind === 'static' && ab.category === 'marker' && ab.marker === 'tracksDamageDealt';
  });
}

function sourceInfo(state: GameState, sourceId: ObjId, controller: PlayerId, lki?: GameObject): SourceInfo {
  const o = state.objects[sourceId];
  if (o) {
    const c = characteristics(state, sourceId);
    return { controller: o.controller, kw: c.kw, tracks: tracksFromKeys(c.abilities) };
  }
  if (lki) {
    // The source left its zone: use last known information from its printed face.
    const def = getDef(lki.copyOf ?? lki.defId);
    const lf = lki.copyOf ? lki.copyFace ?? 0 : lki.face; // CR 707.8a (copied face)
    const f = def.faces[lf];
    let kw = 0;
    for (const k of [...(f?.keywords ?? []), ...(lki.animated?.keywords ?? [])]) kw |= KW[k];
    const keys = (f?.abilities ?? []).map((_, i) => `${def.id}:${lf}:${i}`);
    return { controller: lki.controller, kw, tracks: tracksFromKeys(keys) };
  }
  return { controller, kw: 0, tracks: false };
}

export interface DamageOpts {
  /** Controller of the source when the source object no longer exists. */
  controller?: PlayerId;
  lki?: GameObject;
}

/** dealDamage(source, target, n, isCombat): see the file comment. CR 120.3 (damage results). */
export function dealDamage(state: GameState, sourceId: ObjId, target: Target, n: number, combat: boolean, opts: DamageOpts = {}): number {
  if (n <= 0) return 0;
  const src = sourceInfo(state, sourceId, opts.controller ?? 0, opts.lki);
  if (target.kind === 'player') {
    // CR 120.3a (damage to a player): that player loses that much life.
    loseLife(state, target.p, n);
    if (src.tracks) {
      const cur = state.turnFlags.damageTally[sourceId] ?? [0, 0];
      const next: [number, number] = [cur[0], cur[1]];
      next[target.p] += n;
      setIn(state, ['turnFlags', 'damageTally', sourceId], next);
    }
  } else {
    const o = state.objects[target.id];
    if (!o || o.zone !== 'battlefield') return 0;
    const creature = isType(state, target.id, 'Creature');
    const walker = isType(state, target.id, 'Planeswalker');
    if (!creature && !walker) return 0;
    if (creature) {
      // CR 614.1a (instead): Soul-Scar Mage replaces the damage with -1/-1 counters, so no damage is dealt.
      for (const s of staticAbilities(state, 'damageReplacement')) {
        const holder = state.objects[s.sourceId];
        if (!holder || !s.def.damageToCounters) continue;
        if (s.def.damageToCounters(makeCtx(state, s.sourceId, holder.controller, s.key), sourceId, target.id, combat, src.controller)) {
          addCounter(state, target.id, 'm1m1', n);
          pushEvent(state, { e: 'counterAdded', id: target.id, counter: 'm1m1', n });
          return 0;
        }
      }
    }
    // CR 120.3c (damage to a planeswalker): that many loyalty counters are removed.
    if (walker) addCounter(state, target.id, 'loyalty', -Math.min(n, o.counters.loyalty ?? 0));
    if (creature) {
      // CR 120.3e (damage to a creature): the damage is marked on it.
      setField(state, target.id, 'damage', o.damage + n);
      // CR 702.2b (deathtouch): destroyed at the next SBA check.
      if (src.kw & KW.deathtouch) setField(state, target.id, 'deathtouched', true);
    }
    if (!o.damagedThisTurnBy[src.controller]) {
      setIn(state, ['objects', target.id, 'damagedThisTurnBy', src.controller], true);
    }
  }
  // CR 702.15b (lifelink): the source's controller gains that much life, as part of the damage event.
  if (src.kw & KW.lifelink) gainLife(state, src.controller, n);
  pushEvent(state, { e: 'damage', source: sourceId, target, amount: n, combat });
  return n;
}
