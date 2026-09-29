import { card, face, spell } from '../dsl.js';

/**
 * Pyroclasm. {1}{R} sorcery: 2 damage to each creature. All the damage is dealt in one resolution,
 * so it is one simultaneous damage event: SBAs are checked once afterwards
 * (CR 704.3 (state-based actions)) and a Screaming Nemesis triggers once. Each creature goes through the shared pipeline,
 * so Soul-Scar Mage turns the damage to the opponent's creatures into -1/-1 counters.
 */
export const Pyroclasm = card('Pyroclasm', [face({
  name: 'Pyroclasm', types: ['Sorcery'], cost: '{1}{R}',
  abilities: [spell({
    resolve: (ctx) => {
      const creatures = ctx.state.zones.battlefield.filter((id) => ctx.isType(id, 'Creature'));
      for (const id of creatures) ctx.dealDamage({ kind: 'obj', id }, 2);
    },
  })],
})]);
