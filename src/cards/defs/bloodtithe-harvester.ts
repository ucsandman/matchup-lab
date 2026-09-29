import { act, card, face, t, trig } from '../dsl.js';

/**
 * Bloodtithe Harvester {B}{R} 3/2 Vampire. ETB: create a Blood token. {T}, Sacrifice this
 * creature: target creature gets -X/-X until end of turn, where X is twice the number of Blood
 * tokens you control. Activate only as a sorcery.
 * CR 608.2h (determined only once, when the effect is applied): X is counted as the ability resolves, so a Blood
 * sacrificed in response lowers X.
 */
export const BloodtitheHarvester = card('Bloodtithe Harvester', [face({
  name: 'Bloodtithe Harvester', types: ['Creature'], subtypes: ['Vampire'], cost: '{B}{R}', pt: [3, 2],
  abilities: [
    trig('etb', (ctx) => { ctx.createToken('Blood', ctx.controller); }),
    act({
      cost: { tap: true, sacrificeSelf: true }, timing: 'sorcery', target: t.creature(),
      resolve: (ctx, [tg]) => {
        if (!tg || tg.kind !== 'obj') return;
        const x = 2 * ctx.count('Blood', ctx.controller);
        if (x > 0) ctx.addEotDelta(tg.id, -x, -x);
      },
    }),
  ],
})]);
