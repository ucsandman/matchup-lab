import { card, face, spell, t } from '../dsl.js';

/** Scorching Shot. {R}{R} sorcery: 5 damage to target creature (CR 120.3e (damage to a creature)). */
export const ScorchingShot = card('Scorching Shot', [face({
  name: 'Scorching Shot', types: ['Sorcery'], cost: '{R}{R}',
  abilities: [spell({
    target: t.creature(),
    resolve: (ctx, [tg]) => { if (tg) ctx.dealDamage(tg, 5); },
  })],
})]);
