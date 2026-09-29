import { card, face, spell, t } from '../dsl.js';

/**
 * Thoughtseize {B} Sorcery. Target player reveals their hand. You choose a nonland card from it.
 * That player discards that card. You lose 2 life.
 * CR 608.2c (instructions in order): reveal, choose, discard, then the life loss, which happens
 * even when the hand held no nonland card. CR 119.3 (life loss is not damage).
 */
export const Thoughtseize = card('Thoughtseize', [face({
  name: 'Thoughtseize', types: ['Sorcery'], cost: '{B}',
  abilities: [spell({
    target: t.player(),
    resolve: (ctx, [tg]) => {
      if (!tg || tg.kind !== 'player') return;
      const hand = [...ctx.state.zones.hand[tg.p]];
      ctx.reveal(hand);
      const from = hand.filter((id) => !ctx.isType(id, 'Land'));
      if (from.length > 0) {
        const ans = ctx.choose({ kind: 'pickObjects', player: ctx.controller, reason: 'thoughtseize', from, min: 1, max: 1, reveal: hand });
        for (const id of ans.ids ?? []) if (from.includes(id)) ctx.discard(id);
      }
      ctx.loseLife(ctx.controller, 2);
    },
  })],
})]);
