import { act, card, land, mana } from '../dsl.js';
import { manlandWindow } from '../land-windows.js';

/**
 * Mutavault. {T}: Add {C}. {1}: until end of turn a 2/2 creature with all creature types
 * (CR 205.3m (creature types)); still a land, still colorless. CR 302.6 (summoning sickness): it can
 * attack or tap only if controlled continuously since the turn began.
 */
export const Mutavault = card('Mutavault', [land({
  name: 'Mutavault',
  mana: [mana({ produce: ['C'] })],
  abilities: [act({
    cost: { mana: '{1}' },
    window: manlandWindow,
    resolve: (ctx) => { ctx.animate(ctx.source, { types: ['Creature'], allCreatureTypes: true, pt: [2, 2] }); },
  })],
})]);
