import type { CardType } from '../../engine/types.js';
import { card, face, spell, t } from '../dsl.js';

const STEPS: readonly CardType[] = ['Creature', 'Enchantment', 'Planeswalker'];

/**
 * Invoke Despair {1}{B}{B}{B}{B} Sorcery. Target opponent sacrifices a creature of their choice. If
 * they cannot, they lose 2 life and you draw a card. Then repeat for an enchantment and a planeswalker.
 * CR 608.2c (instructions in order): three sequential edicts. CR 704.3 (SBAs only before priority):
 * state-based actions are not checked during resolution, so a Role whose creature was sacrificed in the creature step is
 * still on the battlefield in the enchantment step and must be sacrificed then.
 */
export const InvokeDespair = card('Invoke Despair', [face({
  name: 'Invoke Despair', types: ['Sorcery'], cost: '{1}{B}{B}{B}{B}',
  abilities: [spell({
    target: t.opponent(),
    resolve: (ctx, [tg]) => {
      if (!tg || tg.kind !== 'player') return;
      const p = tg.p;
      for (const type of STEPS) {
        const from = ctx.permanents(p, (id) => ctx.isType(id, type));
        if (from.length === 0) {
          ctx.loseLife(p, 2);
          ctx.draw(ctx.controller, 1);
          continue;
        }
        const pickedId = from.length === 1 ? from[0]
          : (ctx.choose({ kind: 'pickObjects', player: p, reason: `invokeDespair:${type}`, from, min: 1, max: 1 }).ids ?? [])[0];
        if (pickedId !== undefined && from.includes(pickedId)) ctx.sacrifice(pickedId);
      }
    },
  })],
})]);
