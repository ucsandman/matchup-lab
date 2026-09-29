import { card, land, mana } from '../dsl.js';

/**
 * Blightstep Pathway // Searstep Pathway. Modal double-faced land: the face is chosen as it is played
 * (playLand move face 0 or 1) and stays fixed while it is on the battlefield. CR 712.8a (front face):
 * in any other zone it has only the front face's characteristics.
 */
export const BlightstepPathway = card('Blightstep Pathway // Searstep Pathway', [
  land({ name: 'Blightstep Pathway', mana: [mana({ produce: ['B'] })] }),
  land({ name: 'Searstep Pathway', mana: [mana({ produce: ['R'] })] }),
], 'mdfc');
