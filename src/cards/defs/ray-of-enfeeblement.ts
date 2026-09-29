import { card, face, spell, t } from '../dsl.js';

import { COLOR } from '../../engine/bits.js';

/** White in Characteristics.colors (engine/bits.ts, a leaf module defs may import). */
const WHITE = COLOR.W;

/**
 * Ray of Enfeeblement {B} Instant. Target creature gets -4/-1 until end of turn. If that creature is
 * white, it gets -4/-4 until end of turn instead.
 * The color is checked on resolution (CR 608.2h (information determined on resolution)).
 * No damage is dealt: toughness 0 dies to CR 704.5f (toughness 0 or less), and damage already
 * marked can become lethal under the lower toughness, CR 704.5g (lethal damage).
 */
export const RayOfEnfeeblement = card('Ray of Enfeeblement', [face({
  name: 'Ray of Enfeeblement', types: ['Instant'], cost: '{B}',
  abilities: [spell({
    target: t.creature(),
    resolve: (ctx, [tg]) => {
      if (!tg || tg.kind !== 'obj' || !ctx.obj(tg.id)) return;
      const white = (ctx.chars(tg.id).colors & WHITE) !== 0;
      ctx.addEotDelta(tg.id, -4, white ? -4 : -1);
    },
  })],
})]);
