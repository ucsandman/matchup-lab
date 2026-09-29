import { act, card, land, mana } from '../dsl.js';

/**
 * Castle Locthwain. Enters tapped unless you control a Swamp (any land with the Swamp type: Blood
 * Crypt, or every land under Urborg). {T}: Add {B}. {1}{B}{B}, {T}: draw a card, then lose life equal
 * to the number of cards in your hand (CR 119.3 (life loss): not damage).
 */
export const CastleLocthwain = card('Castle Locthwain', [land({
  name: 'Castle Locthwain',
  mana: [mana({ produce: ['B'] })],
  entersTapped: (ctx) => !ctx.controlsLandType(ctx.controller, ['Swamp']),
  abilities: [act({
    cost: { mana: '{1}{B}{B}', tap: true },
    resolve: (ctx) => {
      ctx.draw(ctx.controller);
      ctx.loseLife(ctx.controller, ctx.state.zones.hand[ctx.controller].length);
    },
  })],
})]);
