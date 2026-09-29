import { card, face, spell, t } from '../dsl.js';

/**
 * Abrade {1}{R} Instant. Choose one: 3 damage to target creature; or destroy target artifact.
 * CR 700.2 (modal spells): the mode is chosen as the spell is cast (the cast move's mode index).
 */
export const Abrade = card('Abrade', [face({
  name: 'Abrade', types: ['Instant'], cost: '{1}{R}',
  abilities: [spell({
    modes: [
      { targets: [t.creature()], resolve: (ctx, [tg]) => { if (tg) ctx.dealDamage(tg, 3); } },
      { targets: [t.artifact()], resolve: (ctx, [tg]) => { if (tg && tg.kind === 'obj') ctx.destroy(tg.id); } },
    ],
  })],
})]);
