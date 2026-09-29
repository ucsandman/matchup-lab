import { act, card, crew, face } from '../dsl.js';
import type { EffectCtx } from '../../engine/types.js';

/**
 * Crew window shared by the Vehicles (PLAN.md D9): crewing only matters to attack or to block, so
 * it is offered in your precombat main phase and beginning of combat, and in the opponent's
 * declare attackers step (after attackers are declared, before blockers). Legality ignores it.
 */
export function vehicleCrewWindow(ctx: EffectCtx): boolean {
  const s = ctx.state;
  if (s.activePlayer === ctx.controller) return s.step === 'main1' || s.step === 'beginCombat';
  return s.step === 'declareAttackers';
}

/**
 * Reckoner Bankbuster. {2} Artifact - Vehicle 4/4, Crew 3. Enters with three charge counters
 * (CR 122.6 (enters with counters)).
 * {2}, {T}, remove a charge counter: draw a card; then if it has no charge counters, create a
 * Treasure and a 1/1 Pilot that crews as though its power were 2 greater. The {T} cost needs no
 * haste while it is not a creature; a crewed Bankbuster that came under your control this turn
 * cannot pay it (CR 302.6 (summoning sickness)). The counter check reads the Vehicle as it is on
 * resolution, or its last known information if it left (CR 608.2h (last known information)).
 * Draw window (PLAN.md D9): your main phases with an empty stack, and the opponent's end step.
 */
export const ReckonerBankbuster = card('Reckoner Bankbuster', [face({
  name: 'Reckoner Bankbuster', types: ['Artifact'], subtypes: ['Vehicle'], cost: '{2}', pt: [4, 4],
  entersWithCounters: { charge: 3 },
  abilities: [
    act({
      cost: { mana: '{2}', tap: true, removeCounter: { type: 'charge', n: 1 } },
      window: (ctx) => {
        const s = ctx.state;
        if (s.activePlayer === ctx.controller) return (s.step === 'main1' || s.step === 'main2') && s.zones.stack.length === 0;
        return s.step === 'end';
      },
      resolve: (ctx) => {
        ctx.draw(ctx.controller);
        const o = ctx.obj(ctx.source);
        // The LKI was taken before the cost removed its counter.
        const left = o && o.zone === 'battlefield' ? (o.counters.charge ?? 0) : Math.max((ctx.item?.lki?.counters.charge ?? 1) - 1, 0);
        if (left === 0) {
          ctx.createToken('Treasure', ctx.controller);
          ctx.createToken('Pilot', ctx.controller);
        }
      },
    }),
    { ...crew(3), window: vehicleCrewWindow },
  ],
})]);
