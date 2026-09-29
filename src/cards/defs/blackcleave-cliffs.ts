import { card, land, mana } from '../dsl.js';
import { landCount } from '../land-windows.js';

/**
 * Blackcleave Cliffs. Enters tapped unless you control two or fewer other lands; {T}: Add {B} or {R}.
 * CR 614.12 (enters replacement): the condition is checked before the land enters, so it counts only
 * the other lands (the entering card is still in hand when the predicate runs).
 */
export const BlackcleaveCliffs = card('Blackcleave Cliffs', [land({
  name: 'Blackcleave Cliffs',
  mana: [mana({ produce: ['B', 'R'] })],
  entersTapped: (ctx) => landCount(ctx) > 2,
})]);
