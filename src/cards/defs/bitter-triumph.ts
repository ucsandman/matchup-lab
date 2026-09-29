import { card, face, spell, t } from '../dsl.js';

/**
 * Bitter Triumph {1}{B} Instant. As an additional cost, discard a card or pay 3 life.
 * Destroy target creature or planeswalker.
 * CR 601.2b (additional cost choice announced while casting); CR 119.4 (paying life): life can be
 * paid only if the life total is at least the amount, so paying down to 0 is legal.
 */
export const BitterTriumph = card('Bitter Triumph', [face({
  name: 'Bitter Triumph', types: ['Instant'], cost: '{1}{B}',
  abilities: [spell({
    additionalChoice: [{ discard: 1 }, { life: 3 }],
    target: t.creatureOrPlaneswalker(),
    resolve: (ctx, [tg]) => { if (tg && tg.kind === 'obj') ctx.destroy(tg.id); },
  })],
})]);
