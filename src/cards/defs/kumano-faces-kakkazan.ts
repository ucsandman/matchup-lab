import { card, face, saga, stat } from '../dsl.js';

/**
 * Kumano Faces Kakkazan // Etching of Kumano ({R} Saga; back face a 2/2 red Human Shaman with haste).
 */
export const KumanoFacesKakkazan = card('Kumano Faces Kakkazan // Etching of Kumano', [
  face({
    name: 'Kumano Faces Kakkazan', types: ['Enchantment'], subtypes: ['Saga'], cost: '{R}',
    abilities: saga([
      // I: 1 damage to each opponent and each planeswalker they control.
      // CR 120.3a (damage dealt to a player): life loss. CR 120.3c (damage dealt to a planeswalker): loyalty counters removed.
      (ctx) => {
        const opp = ctx.opponent;
        const walkers = ctx.permanents(opp, (id) => ctx.isType(id, 'Planeswalker'));
        ctx.dealDamage({ kind: 'player', p: opp }, 1);
        for (const id of walkers) ctx.dealDamage({ kind: 'obj', id }, 1);
      },
      // II: 'When you next cast a creature spell this turn, that creature enters with an additional
      // +1/+1 counter on it.' CR 603.7 (delayed triggered ability) approximated as a player flag
      // consumed at cast time (PLAN.md D9): the spell's enterCounters carry the counter, applied as
      // it enters (CR 614.1c (enters with counters)). Lost: the response window to that trigger.
      (ctx) => { ctx.setNextCreatureBonus(ctx.controller); },
      // III: exile this Saga, then return it transformed under your control.
      (ctx) => { ctx.exileAndReturnTransformed(ctx.source); },
    ]),
  }),
  face({
    name: 'Etching of Kumano', types: ['Enchantment', 'Creature'], subtypes: ['Human', 'Shaman'], cost: null,
    colors: ['R'], pt: [2, 2], keywords: ['haste'],
    abilities: [
      // If a creature dealt damage this turn by a source you controlled would die, exile it instead.
      // CR 614.1a (instead): a replacement effect. CR 700.4 (dies): put into a graveyard from the
      // battlefield, so sacrifice and destroy count, not only lethal damage. damagedThisTurnBy is set by
      // the damage pipeline with the source's controller at the time of the damage and reset as each
      // turn begins; CR 514.2 (damage marked removed) at cleanup does not clear it. With Kalitas or Torch
      // also applying, CR 616.1 (affected object's controller chooses) through zones.ts die.
      stat({
        category: 'dieReplacement',
        applies: (ctx, dyingId) => ctx.isType(dyingId, 'Creature') && ctx.obj(dyingId)?.damagedThisTurnBy[ctx.controller] === true,
      }),
    ],
  }),
], 'transform');
