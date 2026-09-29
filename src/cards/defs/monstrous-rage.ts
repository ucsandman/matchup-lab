import { card, face, spell, t } from '../dsl.js';

/**
 * Monstrous Rage. {R} instant: target creature gets +2/+0 until end of turn; create a Monster Role
 * token attached to it. The Role is an Aura token (+1/+1 and trample through the enchantedGets
 * static). Two Roles from one player on one permanent: only the newest stays (CR 303.7a (Role));
 * a Role on a permanent that stopped being a creature goes to the graveyard
 * (CR 704.5m (Aura attached illegally)) and then ceases to exist
 * (CR 704.5d (token not on the battlefield)).
 */
export const MonstrousRage = card('Monstrous Rage', [face({
  name: 'Monstrous Rage', types: ['Instant'], cost: '{R}',
  abilities: [spell({
    target: t.creature(),
    resolve: (ctx, [tg]) => {
      if (!tg || tg.kind !== 'obj') return;
      const o = ctx.obj(tg.id);
      if (!o || o.zone !== 'battlefield') return;
      ctx.addEotDelta(tg.id, 2, 0);
      ctx.createToken('MonsterRole', ctx.controller, { attachedTo: tg.id });
    },
  })],
})]);
