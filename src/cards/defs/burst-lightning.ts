import { card, face, spell, t } from '../dsl.js';

/**
 * Burst Lightning. {R} instant, kicker {4}: 2 damage to any target, 4 if kicked.
 * Kicker is announced at cast and remembered on the stack item (CR 702.33d (kicked)); the damage
 * goes through the shared pipeline, so Soul-Scar Mage and Screaming Nemesis see it. A target that
 * left before resolution makes the spell do nothing (CR 608.2b (illegal targets)).
 */
export const BurstLightning = card('Burst Lightning', [face({
  name: 'Burst Lightning', types: ['Instant'], cost: '{R}',
  abilities: [spell({
    kicker: '{4}', target: t.any(),
    resolve: (ctx, [tg]) => { if (tg) ctx.dealDamage(tg, ctx.item?.kicked ? 4 : 2); },
  })],
})]);
