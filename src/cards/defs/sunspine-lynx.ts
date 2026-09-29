import { card, face, stat, trig } from '../dsl.js';
import type { PlayerId } from '../../engine/types.js';

/**
 * Sunspine Lynx. {2}{R}{R} 5/4 Elemental Cat.
 * Players can't gain life: the cantGainLife static read by life.ts (CR 119.7 (can't gain life)).
 * Damage can't be prevented: a marker nothing reads, because no prevention effect exists in the
 * pool (PLAN.md section 4, skipped).
 * ETB: damage to each player equal to the nonbasic lands that player controls. Both amounts are
 * dealt in one resolution and SBAs are checked after it, so two players at 0 life lose at the same
 * time and the game is a draw (CR 104.4a (all players lose simultaneously)).
 */
export const SunspineLynx = card('Sunspine Lynx', [face({
  name: 'Sunspine Lynx', types: ['Creature'], subtypes: ['Elemental', 'Cat'], cost: '{2}{R}{R}', pt: [5, 4],
  abilities: [
    stat({ category: 'cantGainLife' }),
    stat({ category: 'marker', marker: 'damageCantBePrevented' }),
    trig('etb', (ctx) => {
      const nonbasic = (p: PlayerId): number => ctx.permanents(p, (id) => ctx.isType(id, 'Land') && !ctx.chars(id).basic).length;
      const n: [number, number] = [nonbasic(0), nonbasic(1)];
      for (const p of [ctx.state.activePlayer, ctx.state.activePlayer === 0 ? 1 : 0] as const) {
        if (n[p] > 0) ctx.dealDamage({ kind: 'player', p }, n[p]);
      }
    }),
  ],
})]);
