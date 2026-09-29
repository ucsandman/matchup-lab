import { card, face, stat } from '../dsl.js';

/**
 * Weathered Runestone. {2} Artifact.
 * Nonland permanent cards in graveyards and libraries can't enter the battlefield (moveObject
 * refuses the move, CR 101.2 (can't beats can)). Players can't cast spells from graveyards or
 * libraries: no card in the pool grants that, and the cast pipeline only allows hand and exile
 * with a permission (stack.ts fromOk). Inert in this matchup; it is mostly an Abrade target.
 */
export const WeatheredRunestone = card('Weathered Runestone', [face({
  name: 'Weathered Runestone', types: ['Artifact'], cost: '{2}',
  abilities: [stat({ category: 'graveyardLibraryLock' })],
})]);
