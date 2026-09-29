import { card, face, spell, t } from '../dsl.js';

/**
 * Go Blank {2}{B} Sorcery. Target player discards two cards. Then exile that player's graveyard.
 * The target player chooses the discards, CR 701.9b (discarding player chooses by default); with
 * two or fewer cards in hand, all are discarded without a choice.
 * CR 608.2c (instructions in order): the discarded cards are in the graveyard when it is exiled.
 */
export const GoBlank = card('Go Blank', [face({
  name: 'Go Blank', types: ['Sorcery'], cost: '{2}{B}',
  abilities: [spell({
    target: t.player(),
    resolve: (ctx, [tg]) => {
      if (!tg || tg.kind !== 'player') return;
      const p = tg.p;
      const hand = [...ctx.state.zones.hand[p]];
      const picked = hand.length <= 2 ? hand
        : ctx.choose({ kind: 'pickObjects', player: p, reason: 'goBlank', from: hand, min: 2, max: 2 }).ids ?? [];
      for (const id of picked) if (hand.includes(id)) ctx.discard(id);
      for (const id of [...ctx.state.zones.graveyard[p]]) ctx.exile(id);
    },
  })],
})]);
