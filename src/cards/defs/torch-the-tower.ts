import { card, face, spell, t } from '../dsl.js';

/**
 * Torch the Tower {R} Instant. Bargain. 2 damage to target creature or planeswalker; if bargained,
 * 3 damage instead and you scry 1. If a permanent dealt damage by Torch the Tower would die this
 * turn, exile it instead.
 * CR 702.166a (bargain): an optional additional cost paid while casting, so the sacrificed
 * permanent sets revolt before resolution. The would-die clause covers only a permanent that was
 * actually dealt damage (an exileIfDies effect until end of turn, read by the die choke point);
 * CR 616.1 (the affected object's controller orders it against Kalitas or Etching of Kumano).
 */
export const TorchTheTower = card('Torch the Tower', [face({
  name: 'Torch the Tower', types: ['Instant'], cost: '{R}',
  abilities: [spell({
    bargain: true,
    target: t.creatureOrPlaneswalker(),
    resolve: (ctx, [tg]) => {
      if (!tg || tg.kind !== 'obj') return;
      const bargained = !!ctx.item?.bargained;
      const dealt = ctx.dealDamage(tg, bargained ? 3 : 2);
      if (dealt > 0) ctx.exileIfDiesThisTurn(tg.id);
      if (bargained) ctx.scry1(ctx.controller);
    },
  })],
})]);
