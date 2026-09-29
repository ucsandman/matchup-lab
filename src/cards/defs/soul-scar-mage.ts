import { card, face, stat } from '../dsl.js';

/**
 * Soul-Scar Mage. {R} 1/2 Human Wizard with prowess. If a source you control would deal noncombat
 * damage to a creature an opponent controls, put that many -1/-1 counters on it instead
 * (CR 614.1a (instead)); the damage pipeline (damage.ts) then reports 0 damage dealt, so there is
 * no damage event, no dealt-damage trigger and no damagedThisTurnBy mark. The source's controller
 * comes from last known information when the source has left (CR 113.7a (last known information)).
 * Combat damage is never replaced (CR 510.2 (combat damage)).
 */
export const SoulScarMage = card('Soul-Scar Mage', [face({
  name: 'Soul-Scar Mage', types: ['Creature'], subtypes: ['Human', 'Wizard'], cost: '{R}', pt: [1, 2],
  keywords: ['prowess'],
  abilities: [stat({
    category: 'damageReplacement',
    damageToCounters: (ctx, _src, target, combat, sourceController) => {
      const o = ctx.obj(target);
      return !combat && !!o && sourceController === ctx.controller && o.controller !== ctx.controller;
    },
  })],
})]);
