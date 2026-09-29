import { act, card, face, saga, t, trig } from '../dsl.js';
import type { EffectCtx, ObjId, TokenOpts } from '../../engine/types.js';

/** PLAN.md section 5: chapter II rummage options are capped at this many (counting the empty discard). */
export const RUMMAGE_CAP = 20;

/**
 * The hand cards chapter II offers for discard (PLAN.md section 5, Fable bounding strategy).
 * Classes are distinct card names. They are ranked (excess lands first when the controller already
 * has four or more lands, then nonlands by mana value, highest first, then the remaining lands),
 * and the best classes are kept while the number of distinct discards of size 0 to 2 stays at or
 * under RUMMAGE_CAP. Lost: rare lines where a dropped class was the best discard.
 */
export function rummageCandidates(ctx: EffectCtx, hand: readonly ObjId[]): ObjId[] {
  const p = ctx.controller;
  const excessLands = ctx.permanents(p, (id) => ctx.isType(id, 'Land')).length >= 4;
  const classes = new Map<string, ObjId[]>();
  for (const id of [...hand].sort((a, b) => a - b)) {
    const n = ctx.chars(id).name;
    const arr = classes.get(n);
    if (arr) arr.push(id);
    else classes.set(n, [id]);
  }
  const rank = (ids: ObjId[]): number => {
    const id = ids[0] as ObjId;
    const isLand = ctx.isType(id, 'Land');
    if (isLand) return excessLands ? 1000 : -1;
    return ctx.chars(id).manaValue;
  };
  const ranked = [...classes.entries()].sort((a, b) => rank(b[1]) - rank(a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const kept: ObjId[] = [];
  let k = 0;
  let pairs = 0;
  for (const [, ids] of ranked) {
    const k2 = k + 1;
    const pairs2 = pairs + (ids.length >= 2 ? 1 : 0);
    // Multisets of size 0, 1 and 2 over k2 classes: 1 + k2 + C(k2, 2) + classes with two copies.
    if (1 + k2 + (k2 * (k2 - 1)) / 2 + pairs2 > RUMMAGE_CAP) break;
    k = k2;
    pairs = pairs2;
    kept.push(...ids);
  }
  return kept;
}

/**
 * Fable of the Mirror-Breaker // Reflection of Kiki-Jiki ({2}{R} Saga; back face a 2/2 red
 * Goblin Shaman). Chapter III exiles the Saga and returns it transformed, a new object that is
 * summoning sick (CR 400.7 (new object), CR 302.6 (summoning sickness)).
 */
export const FableOfTheMirrorBreaker = card('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', [
  face({
    name: 'Fable of the Mirror-Breaker', types: ['Enchantment'], subtypes: ['Saga'], cost: '{2}{R}',
    abilities: saga([
      // I: a 2/2 red Goblin Shaman token with 'Whenever this token attacks, create a Treasure token.'
      (ctx) => { ctx.createToken('GoblinShaman', ctx.controller); },
      // II: you may discard up to two cards; if you do, draw that many (rummage, capped choices).
      (ctx) => {
        const p = ctx.controller;
        const hand = ctx.state.zones.hand[p];
        if (hand.length === 0) return;
        const from = rummageCandidates(ctx, hand);
        const ans = ctx.choose({ kind: 'pickObjects', player: p, reason: 'fableRummage', from, min: 0, max: 2 });
        const ids = ans.ids ?? [];
        if (ids.length > 2 || new Set(ids).size !== ids.length || ids.some((id) => !from.includes(id))) {
          throw new Error(`Fable chapter II: bad discard ${JSON.stringify(ids)}`);
        }
        for (const id of ids) ctx.discard(id);
        if (ids.length > 0) ctx.draw(p, ids.length);
      },
      // III: exile this Saga, then return it transformed under your control.
      (ctx) => { ctx.exileAndReturnTransformed(ctx.source); },
    ]),
  }),
  face({
    name: 'Reflection of Kiki-Jiki', types: ['Enchantment', 'Creature'], subtypes: ['Goblin', 'Shaman'], cost: null,
    colors: ['R'], pt: [2, 2],
    abilities: [
      // {1}, {T}: Create a token that's a copy of another target nonlegendary creature you control,
      // except it has haste (CR 707.9b (copy exceptions): the Copy token def carries haste).
      // Pruned (PLAN.md section 5): animated lands and crewed Vehicles, whose copy is not a creature.
      act({
        cost: { mana: '{1}', tap: true },
        target: t.creature({
          controller: 'you',
          filter: (ctx, tg) => tg.kind === 'obj' && tg.id !== ctx.source && !ctx.chars(tg.id).legendary && !ctx.obj(tg.id)?.animated,
        }),
        resolve: (ctx, [tg]) => {
          if (!tg || tg.kind !== 'obj' || !ctx.isLegalTarget(tg)) return;
          const o = ctx.obj(tg.id);
          if (!o || o.zone !== 'battlefield') return;
          // CR 707.2 (copiable values): printed values plus other copy effects; a copy of a copy
          // copies what that copy copies. CR 707.8a (copy of a double-faced permanent): the face up.
          const opts: TokenOpts = { copyOf: o.copyOf ?? o.defId };
          if ((o.copyOf ? o.copyFace ?? 0 : o.face) === 1) opts.copyFace = 1;
          const id = ctx.createToken('Copy', ctx.controller, opts);
          // CR 603.7 (delayed triggered ability): sacrifice it at the beginning of the next end step.
          ctx.addDelayed('endStep', 1, id);
        },
      }),
      // The delayed trigger. CR 603.7c (delayed trigger object gone): does nothing if the token left.
      trig('delayed', (ctx, _t, info) => { if (info.objId !== undefined) ctx.sacrifice(info.objId); }),
    ],
  }),
], 'transform');
