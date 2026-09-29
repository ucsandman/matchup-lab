import { card, land, mana } from '../dsl.js';

/**
 * Blazemire Verge. {T}: Add {B}. {T}: Add {R}, activate only if you control a Swamp or a Mountain.
 * The condition reads land types, so a tapped Blood Crypt counts and Urborg makes the Verge itself a
 * Swamp (CR 305.7 (land type changing)).
 */
export const BlazemireVerge = card('Blazemire Verge', [land({
  name: 'Blazemire Verge',
  mana: [
    mana({ produce: ['B'] }),
    mana({ produce: ['R'], condition: (ctx) => ctx.controlsLandType(ctx.controller, ['Swamp', 'Mountain']) }),
  ],
})]);
