import { adventure, face, spell, t, trig } from '../dsl.js';

/**
 * Bonecrusher Giant // Stomp. Giant {2}{R} 4/3: whenever this creature becomes the target of a
 * spell, it deals 2 damage to that spell's controller. Abilities that target it do not trigger it
 * (the becomesTarget trigger info carries amount 1 for a spell, 0 for an ability).
 * Stomp {1}{R} instant Adventure: damage can't be prevented this turn; 2 damage to any target.
 * The can't-be-prevented clause is a no-op: no damage prevention effect exists in the pool
 * (PLAN.md section 4, Skipped; the card test checks oracle.json to keep that true).
 * CR 715.3d (exiles it): the engine exiles it with onAdventure, and its owner may
 * cast the creature from exile later.
 */
export const BonecrusherGiant = adventure('Bonecrusher Giant // Stomp',
  face({
    name: 'Bonecrusher Giant', types: ['Creature'], subtypes: ['Giant'], cost: '{2}{R}', pt: [4, 3],
    abilities: [
      trig('becomesTarget', { filter: (_ctx, info) => info.amount === 1 }, (ctx, _t, info) => {
        if (info.player !== undefined) ctx.dealDamage({ kind: 'player', p: info.player }, 2);
      }),
    ],
  }),
  face({
    name: 'Stomp', types: ['Instant'], subtypes: ['Adventure'], cost: '{1}{R}',
    abilities: [spell({ target: t.any(), resolve: (ctx, [tg]) => { if (tg) ctx.dealDamage(tg, 2); } })],
  }));
