import { card, face, spell } from '../dsl.js';

/**
 * Extinction Event {3}{B} Sorcery. Choose odd or even. Exile each creature with mana value of the
 * chosen quality. (Zero is even.)
 * The parity is chosen on resolution (CR 608.2d (choices made while resolving)): a pickIndex
 * Choice, index 0 = odd, 1 = even. Exile is not dying (CR 700.4 (dies)), so there are no dies
 * triggers and no would-die replacements (Kalitas, Torch the Tower). CR 202.3 (mana value): tokens
 * and animated lands are 0, a transformed permanent uses its front face.
 */
export const ExtinctionEvent = card('Extinction Event', [face({
  name: 'Extinction Event', types: ['Sorcery'], cost: '{3}{B}',
  abilities: [spell({
    resolve: (ctx) => {
      const odd = (ctx.choose({ kind: 'pickIndex', player: ctx.controller, reason: 'oddOrEven', count: 2 }).index ?? 0) === 0;
      const hit = ctx.state.zones.battlefield.filter((id) => ctx.isType(id, 'Creature') && (ctx.chars(id).manaValue % 2 === 1) === odd);
      for (const id of hit) ctx.exile(id);
    },
  })],
})]);
