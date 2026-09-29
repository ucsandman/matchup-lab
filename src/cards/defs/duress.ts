import { card, face, spell, t } from '../dsl.js';

/**
 * Duress {B} Sorcery. Target opponent reveals their hand. You choose a noncreature, nonland card
 * from it. That player discards that card.
 * CR 608.2c (instructions in order): reveal first, so every card in that hand becomes known to
 * the caster (knownTo), then the choice. The choice carries reveal so the chooser sees the hand
 * while it is pending (the replay rolls the knownTo change back until the answer comes).
 */
export const Duress = card('Duress', [face({
  name: 'Duress', types: ['Sorcery'], cost: '{B}',
  abilities: [spell({
    target: t.opponent(),
    resolve: (ctx, [tg]) => {
      if (!tg || tg.kind !== 'player') return;
      const hand = [...ctx.state.zones.hand[tg.p]];
      ctx.reveal(hand);
      const from = hand.filter((id) => !ctx.isType(id, 'Creature') && !ctx.isType(id, 'Land'));
      if (from.length === 0) return;
      const ans = ctx.choose({ kind: 'pickObjects', player: ctx.controller, reason: 'duress', from, min: 1, max: 1, reveal: hand });
      for (const id of ans.ids ?? []) if (from.includes(id)) ctx.discard(id);
    },
  })],
})]);
