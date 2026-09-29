import { card, face, spell, t } from '../dsl.js';

/**
 * Fatal Push {B} Instant. Destroy target creature if it has mana value 2 or less. Revolt: 4 or less
 * instead if a permanent left the battlefield under your control this turn.
 * Any creature is a legal target; mana value and revolt are checked on resolution,
 * CR 608.2h (information determined on resolution). Revolt reads turnFlags.permanentLeft, which moveObject
 * sets for the leaving permanent's controller (a Treasure sacrificed while casting counts).
 * CR 202.3 (mana value): tokens 0, lands 0, a transformed permanent uses its front face.
 */
export const FatalPush = card('Fatal Push', [face({
  name: 'Fatal Push', types: ['Instant'], cost: '{B}',
  abilities: [spell({
    target: t.creature(),
    resolve: (ctx, [tg]) => {
      if (!tg || tg.kind !== 'obj' || !ctx.obj(tg.id)) return;
      const limit = ctx.state.turnFlags.permanentLeft[ctx.controller] ? 4 : 2;
      if (ctx.chars(tg.id).manaValue <= limit) ctx.destroy(tg.id);
    },
  })],
})]);
