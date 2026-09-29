import { card, face, t, trig } from '../dsl.js';

/**
 * Screaming Nemesis. {2}{R} 3/3 Spirit with haste. Whenever it is dealt damage, it deals that much
 * damage to any other target; a player dealt damage this way can't gain life for the rest of the
 * game (the public player flag cantGainLife, CR 119.7 (can't gain life)).
 * - The trigger system sums all damage drained together per object, so damage from several sources
 *   at once (a double block, a Pyroclasm) is one trigger for the total (the Scryfall ruling).
 * - It triggers even when the damage is lethal: triggers are collected before the SBA check.
 * - If Nemesis has left, it still deals the damage, using last known information
 *   (CR 113.7a (last known information)): the pipeline falls back to the trigger's controller.
 * - Damage replaced by Soul-Scar Mage is not dealt, so it never triggers; neither does non-damage
 *   removal (Fatal Push, -X/-X).
 */
export const ScreamingNemesis = card('Screaming Nemesis', [face({
  name: 'Screaming Nemesis', types: ['Creature'], subtypes: ['Spirit'], cost: '{2}{R}', pt: [3, 3],
  keywords: ['haste'],
  abilities: [trig('dealtDamage', {
    targets: [t.any({ filter: (ctx, tg) => !(tg.kind === 'obj' && tg.id === ctx.source) })],
  }, (ctx, [tg], info) => {
    if (!tg) return;
    const dealt = ctx.dealDamage(tg, info.amount ?? 0);
    if (tg.kind === 'player' && dealt > 0) ctx.setCantGainLife(tg.p);
  })],
})]);
