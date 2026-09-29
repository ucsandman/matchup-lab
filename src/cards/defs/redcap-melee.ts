import { card, face, spell, t } from '../dsl.js';

import { COLOR } from '../../engine/bits.js';

/** Red in Characteristics.colors (engine/bits.ts, a leaf module defs may import; a test pins the value). */
export const RED_BIT = COLOR.R;

/**
 * Redcap Melee. {R} instant: 4 damage to target creature or planeswalker. If a nonred permanent is
 * dealt damage this way, you sacrifice a land. The check reads the damage actually dealt after
 * replacements: Soul-Scar Mage turns it into -1/-1 counters, no damage is dealt, and no land is
 * sacrificed (CR 614.1a (instead)). A multicolored permanent with red is red (CR 105.2 (colors)).
 * The color is read before the damage is dealt (the permanent may die to the SBA afterwards).
 */
export const RedcapMelee = card('Redcap Melee', [face({
  name: 'Redcap Melee', types: ['Instant'], cost: '{R}',
  abilities: [spell({
    target: t.creatureOrPlaneswalker(),
    resolve: (ctx, [tg]) => {
      if (!tg || tg.kind !== 'obj' || !ctx.obj(tg.id)) return;
      const nonred = (ctx.chars(tg.id).colors & RED_BIT) === 0;
      const dealt = ctx.dealDamage(tg, 4);
      if (!nonred || dealt <= 0) return;
      const lands = ctx.permanents(ctx.controller, (id) => ctx.isType(id, 'Land'));
      // Identical lands (same def, face and tapped state) are one choice.
      const keys: string[] = [];
      const reps = lands.filter((id) => {
        const o = ctx.obj(id);
        const k = `${o?.defId}|${o?.face}|${o?.tapped}`;
        if (keys.includes(k)) return false;
        keys.push(k);
        return true;
      });
      let chosen = reps[0];
      if (chosen === undefined) return;
      if (reps.length > 1) {
        const ans = ctx.choose({ kind: 'pickObjects', player: ctx.controller, reason: 'sacrificeLand', from: reps, min: 1, max: 1 });
        chosen = ans.ids?.[0];
        if (chosen === undefined || !reps.includes(chosen)) throw new Error('Redcap Melee: bad land choice');
      }
      ctx.sacrifice(chosen);
    },
  })],
})]);
