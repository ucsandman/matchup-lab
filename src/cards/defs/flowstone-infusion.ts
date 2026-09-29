import { card, face, spell, t } from '../dsl.js';

/**
 * Flowstone Infusion. {R} instant: target creature gets +2/-2 until end of turn. No damage is
 * dealt, so a creature it kills dies to CR 704.5f (toughness 0 or less), and Soul-Scar Mage,
 * Etching of Kumano and Screaming Nemesis never see it.
 */
export const FlowstoneInfusion = card('Flowstone Infusion', [face({
  name: 'Flowstone Infusion', types: ['Instant'], cost: '{R}',
  abilities: [spell({
    target: t.creature(),
    resolve: (ctx, [tg]) => { if (tg && tg.kind === 'obj') ctx.addEotDelta(tg.id, 2, -2); },
  })],
})]);
