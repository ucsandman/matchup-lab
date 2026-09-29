import { act, card, land, mana } from '../dsl.js';
import { legendaryCreatureCount, sokenzanWindow } from '../land-windows.js';

/**
 * Sokenzan, Crucible of Defiance. Legendary land (CR 704.5j (legend rule)). {T}: Add {R}.
 * Channel {3}{R}, discard this card: two 1/1 colorless Spirit tokens that gain haste until end of
 * turn; {1} less for each legendary creature you control (CR 601.2f (cost reduction)). Channel is an
 * ability word (CR 207.2c (ability word)); the ability works only from the hand.
 */
export const SokenzanCrucibleOfDefiance = card('Sokenzan, Crucible of Defiance', [land({
  name: 'Sokenzan, Crucible of Defiance', supertypes: ['Legendary'],
  mana: [mana({ produce: ['R'] })],
  abilities: [act({
    cost: { mana: '{3}{R}', discardSelf: true },
    zone: 'hand',
    costReduction: legendaryCreatureCount,
    window: sokenzanWindow,
    resolve: (ctx) => {
      for (let i = 0; i < 2; i++) ctx.grantEot(ctx.createToken('Spirit', ctx.controller), ['haste']);
    },
  })],
})]);
