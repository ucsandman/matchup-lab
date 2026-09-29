import { card, face, t, trig } from '../dsl.js';
import type { CardType, EffectCtx } from '../../engine/types.js';

/** CR 205.2a (card types). */
const CARD_TYPES: readonly CardType[] = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Instant', 'Kindred', 'Land', 'Planeswalker', 'Sorcery'];

/**
 * Delirium count: card types among cards in the controller's graveyard. A card with two types
 * counts both (an enchantment creature is two). Graveyard characteristics come from statics.ts:
 * CR 712.8a (characteristics of its front face) and CR 715.4 (adventurer card normal characteristics).
 */
export function deliriumCount(ctx: EffectCtx): number {
  const gy = ctx.state.zones.graveyard[ctx.controller];
  return CARD_TYPES.filter((ty) => gy.some((id) => ctx.isType(id, ty))).length;
}

/**
 * Fear of Missing Out {1}{R} 2/3 Enchantment Creature, Nightmare.
 * ETB: discard a card, then draw a card (the discard is chosen before the draw is seen).
 * Delirium: whenever it attacks for the first time each turn, if there are four or more card types
 * among cards in your graveyard, untap target creature; after this phase there is an additional
 * combat phase (CR 500.8 (extra phases)).
 * The first time each turn is a trigger condition read from attacksThisTurn, so a second attack in
 * the extra combat does not trigger. Delirium is an intervening-if clause, checked when it
 * triggers and again on resolution: CR 603.4 (if condition). If the untap target is illegal on
 * resolution the whole ability does nothing, extra combat included (CR 608.2b (all targets illegal)).
 */
export const FearOfMissingOut = card('Fear of Missing Out', [face({
  name: 'Fear of Missing Out', types: ['Enchantment', 'Creature'], subtypes: ['Nightmare'], cost: '{1}{R}', pt: [2, 3],
  abilities: [
    trig('etb', (ctx) => {
      const hand = ctx.state.zones.hand[ctx.controller];
      if (hand.length === 1) ctx.discard(hand[0] as number);
      else if (hand.length > 1) {
        const pick = ctx.choose({ kind: 'pickObjects', player: ctx.controller, reason: 'discard', from: [...hand], min: 1, max: 1 });
        const id = pick.ids?.[0];
        if (id === undefined) throw new Error('Fear of Missing Out: no discard chosen');
        ctx.discard(id);
      }
      ctx.draw(ctx.controller);
    }),
    trig('attacks', {
      filter: (ctx) => (ctx.obj(ctx.source)?.attacksThisTurn ?? 0) === 1,
      interveningIf: (ctx) => deliriumCount(ctx) >= 4,
      targets: [t.creature()],
    }, (ctx, [tg]) => {
      if (tg && tg.kind === 'obj') ctx.untap(tg.id);
      ctx.addExtraCombat();
    }),
  ],
})]);
