import { card, land, stat } from '../dsl.js';

/**
 * Urborg, Tomb of Yawgmoth. Legendary land. Each land is a Swamp in addition to its other land types
 * (both players'; CR 305.7 (land type changing) with 'in addition', so each land keeps its other
 * types and gains the intrinsic {T}: Add {B}, CR 305.6 (basic land types)). Urborg itself is a Swamp.
 */
export const UrborgTombOfYawgmoth = card('Urborg, Tomb of Yawgmoth', [land({
  name: 'Urborg, Tomb of Yawgmoth', supertypes: ['Legendary'],
  abilities: [stat({ category: 'allLandsAreSwamps' })],
})]);
