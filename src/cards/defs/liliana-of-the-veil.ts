import { act, card, face, t } from '../dsl.js';
import type { EffectCtx, ObjId, PlayerId, Target } from '../../engine/types.js';

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const targetPlayer = (tg: Target | undefined): PlayerId | null => (tg && tg.kind === 'player' ? tg.p : null);

/** Heuristic worth of a permanent for the -6 pile splits: lands 1, else mana value plus power or loyalty. */
function worth(ctx: EffectCtx, id: ObjId): number {
  if (ctx.isType(id, 'Land') && !ctx.isType(id, 'Creature')) return 1;
  const c = ctx.chars(id);
  let v = Math.max(c.manaValue, 1);
  if (ctx.isType(id, 'Creature')) v += Math.max(c.power, 0);
  if (ctx.isType(id, 'Planeswalker')) v += ctx.obj(id)?.counters.loyalty ?? 0;
  return v;
}

/**
 * The three -6 splits (PLAN.md D9): lands vs nonlands, the best threat alone vs the rest, and a
 * greedy value-balanced split. Each split is [pileA, pileB]; duplicates (as unordered pile pairs)
 * and splits with an empty side equal to an earlier one are dropped. Deterministic given state.
 */
export function lilianaSplits(ctx: EffectCtx, perms: readonly ObjId[]): ObjId[][][] {
  const sorted = [...perms].sort((a, b) => worth(ctx, b) - worth(ctx, a) || a - b);
  const isLand = (id: ObjId): boolean => ctx.isType(id, 'Land');
  const splits: ObjId[][][] = [];
  splits.push([sorted.filter(isLand), sorted.filter((id) => !isLand(id))]);
  const nonland = sorted.filter((id) => !isLand(id));
  const best = nonland[0] ?? sorted[0];
  if (best !== undefined) splits.push([[best], sorted.filter((id) => id !== best)]);
  const a: ObjId[] = [];
  const b: ObjId[] = [];
  let wa = 0;
  let wb = 0;
  for (const id of sorted) {
    if (wa <= wb) { a.push(id); wa += worth(ctx, id); } else { b.push(id); wb += worth(ctx, id); }
  }
  splits.push([a, b]);
  const seen = new Set<string>();
  return splits.filter(([x, y]) => {
    const k = [[...(x ?? [])].sort((m, n) => m - n).join(','), [...(y ?? [])].sort((m, n) => m - n).join(',')].sort().join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Liliana of the Veil. {1}{B}{B} Legendary Planeswalker - Liliana, loyalty 3.
 * Loyalty abilities are sorcery speed, once per turn (CR 606.3 (loyalty ability)); damage removes
 * loyalty (CR 120.3c (damage to a planeswalker)); at 0 loyalty she dies to the SBA
 * (CR 704.5i (planeswalker loyalty 0)); creatures may attack her.
 *
 * +1: each player discards a card. The active player chooses first, then the other player, and the
 * chosen cards are discarded at the same time (CR 101.4 (APNAP order)). The non-active player
 * chooses without seeing the first pick: the answer sits in state.pending, which no view shows.
 * A player with an empty hand is not asked.
 *
 * -2: target player sacrifices a creature; that player picks it (CR 701.21a (sacrifice)). It
 * targets the player, not a creature, so ward on a creature does not apply.
 *
 * -6: Liliana's controller separates all permanents target player controls into two piles; that
 * player sacrifices the pile of their choice. The separation is bounded to three heuristic splits
 * (PLAN.md D9, lilianaSplits); the choice of pile is exact.
 */
export const LilianaOfTheVeil = card('Liliana of the Veil', [face({
  name: 'Liliana of the Veil', types: ['Planeswalker'], subtypes: ['Liliana'], supertypes: ['Legendary'],
  cost: '{1}{B}{B}', loyalty: 3,
  abilities: [
    act({
      cost: { loyalty: 1 }, timing: 'sorcery',
      resolve: (ctx) => {
        const ap = ctx.state.activePlayer;
        const picks: ObjId[] = [];
        for (const p of [ap, other(ap)]) {
          const hand = ctx.state.zones.hand[p];
          if (hand.length === 0) continue;
          const ans = ctx.choose({ kind: 'pickObjects', player: p, reason: 'lilianaDiscard', from: [...hand], min: 1, max: 1 });
          const id = ans.ids?.[0];
          if (id !== undefined) picks.push(id);
        }
        for (const id of picks) ctx.discard(id);
      },
    }),
    act({
      cost: { loyalty: -2 }, timing: 'sorcery', target: t.player(),
      resolve: (ctx, [tg]) => {
        const p = targetPlayer(tg);
        if (p === null) return;
        const creatures = ctx.permanents(p, (id) => ctx.isType(id, 'Creature'));
        if (creatures.length === 0) return;
        const ans = ctx.choose({ kind: 'pickObjects', player: p, reason: 'lilianaEdict', from: creatures, min: 1, max: 1 });
        const id = ans.ids?.[0];
        if (id !== undefined) ctx.sacrifice(id);
      },
    }),
    act({
      cost: { loyalty: -6 }, timing: 'sorcery', target: t.player(),
      resolve: (ctx, [tg]) => {
        const p = targetPlayer(tg);
        if (p === null) return;
        const perms = ctx.permanents(p);
        if (perms.length === 0) return;
        const splits = lilianaSplits(ctx, perms);
        const si = splits.length > 1
          ? ctx.choose({ kind: 'pickIndex', player: ctx.controller, reason: 'lilianaSplit', count: splits.length }).index ?? 0
          : 0;
        const piles = splits[si] ?? splits[0] ?? [[], []];
        const pile = ctx.choose({ kind: 'pickIndex', player: p, reason: 'lilianaPile', count: 2 }).index ?? 0;
        for (const id of piles[pile] ?? []) ctx.sacrifice(id);
      },
    }),
  ],
})]);
