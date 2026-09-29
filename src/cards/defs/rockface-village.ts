import { act, card, land, mana, t } from '../dsl.js';

const PUMPABLE = ['Lizard', 'Mouse', 'Otter', 'Raccoon'];

/**
 * Rockface Village. {T}: Add {C}. {T}: Add {R}, spend only to cast a creature spell
 * (CR 106.6 (mana spending restriction): the pool entry carries restriction 'creatureSpell'). {R}, {T}: target
 * Lizard, Mouse, Otter or Raccoon you control gets +1/+0 and haste until end of turn, sorcery speed
 * (an animated Mutavault has every creature type).
 */
export const RockfaceVillage = card('Rockface Village', [land({
  name: 'Rockface Village',
  mana: [mana({ produce: ['C'] }), mana({ produce: ['R'], restriction: 'creatureSpell' })],
  abilities: [act({
    cost: { mana: '{R}', tap: true },
    timing: 'sorcery',
    target: t.creature({
      controller: 'you',
      filter: (ctx, tg) => {
        if (tg.kind !== 'obj') return false;
        const c = ctx.chars(tg.id);
        return c.allCreatureTypes || PUMPABLE.some((s) => c.subtypes.includes(s));
      },
    }),
    resolve: (ctx, [tg]) => {
      if (tg?.kind !== 'obj') return;
      ctx.addEotDelta(tg.id, 1, 0);
      ctx.grantEot(tg.id, ['haste']);
    },
  })],
})]);
