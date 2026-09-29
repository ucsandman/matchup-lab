import { card, face, stat, t, trig } from '../dsl.js';
import type { EffectCtx, Target, TargetSpec } from '../../engine/types.js';

/**
 * Graveyard targets are collapsed to creature cards (CARD-ANALYSIS proposal): exiling a
 * noncreature card changes nothing in this matchup, so the move generator only offers creature
 * cards, plus no target at all because the spec is up to N (CR 601.2c (choose up to N targets)).
 */
const creatureCardsInGraveyards = (max: number): TargetSpec => t.cardInGraveyard({
  min: 0, max,
  filter: (ctx, tg) => tg.kind === 'obj' && ctx.isType(tg.id, 'Creature'),
});

/** Exiles each still-legal target; returns how many creature cards were exiled. */
function exileTargets(ctx: EffectCtx, targets: Target[]): number {
  let creatures = 0;
  for (const tg of targets) {
    if (tg.kind !== 'obj' || !ctx.isLegalTarget(tg)) continue;
    const creature = ctx.isType(tg.id, 'Creature');
    if (ctx.exile(tg.id) !== null && creature) creatures++;
  }
  return creatures;
}

/** Each opponent loses 1 life and you gain 1 life, times times. */
function drain(ctx: EffectCtx, times: number): void {
  for (let i = 0; i < times; i++) {
    ctx.loseLife(ctx.opponent, 1);
    ctx.gainLife(ctx.controller, 1);
  }
}

/** Day side: exile up to one; if a creature card was exiled this way, drain 1 once. */
const dayEffect = (ctx: EffectCtx, targets: Target[]): void => { if (exileTargets(ctx, targets) > 0) drain(ctx, 1); };
/** Night side: exile up to two; drain 1 for each creature card exiled this way. */
const nightEffect = (ctx: EffectCtx, targets: Target[]): void => { drain(ctx, exileTargets(ctx, targets)); };

/**
 * Graveyard Trespasser // Graveyard Glutton {2}{B}. Ward, discard a card (CR 702.21a (ward)).
 * Daybound and nightbound (CR 702.145b (daybound), CR 702.145e (nightbound)): turn.ts setDayNight
 * flips the face, and zones.ts moveObject makes it enter transformed at night.
 */
export const GraveyardTrespasser = card('Graveyard Trespasser // Graveyard Glutton', [
  face({
    name: 'Graveyard Trespasser', types: ['Creature'], subtypes: ['Human', 'Werewolf'], cost: '{2}{B}', pt: [3, 3],
    keywords: ['ward', 'daybound'],
    abilities: [
      stat({ category: 'marker', marker: 'ward', wardCost: { discard: 1 } }),
      trig('etb', { targets: [creatureCardsInGraveyards(1)] }, dayEffect),
      trig('attacks', { targets: [creatureCardsInGraveyards(1)] }, dayEffect),
    ],
  }),
  face({
    name: 'Graveyard Glutton', types: ['Creature'], subtypes: ['Werewolf'], cost: null, colors: ['B'], pt: [4, 4],
    keywords: ['ward', 'nightbound'],
    abilities: [
      stat({ category: 'marker', marker: 'ward', wardCost: { discard: 1 } }),
      trig('etb', { targets: [creatureCardsInGraveyards(2)] }, nightEffect),
      trig('attacks', { targets: [creatureCardsInGraveyards(2)] }, nightEffect),
    ],
  }),
], 'transform');
