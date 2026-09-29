import { act, card, face, stat } from '../dsl.js';

/**
 * Kalitas, Traitor of Ghet {2}{B}{B} legendary 3/4 Vampire Warrior with lifelink.
 * If a nontoken creature an opponent controls would die, instead exile that card and create a 2/2
 * black Zombie token (CR 614.1a (instead)). With another would-die replacement on the same
 * creature, its controller picks one (CR 616.1 (affected controller chooses)); zones.ts die does it.
 * {2}{B}, Sacrifice another Vampire or Zombie: put two +1/+1 counters on Kalitas.
 */
export const KalitasTraitorOfGhet = card('Kalitas, Traitor of Ghet', [face({
  name: 'Kalitas, Traitor of Ghet', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Vampire', 'Warrior'],
  cost: '{2}{B}{B}', pt: [3, 4], keywords: ['lifelink'],
  abilities: [
    stat({
      category: 'dieReplacement',
      applies: (ctx, id) => {
        const o = ctx.obj(id);
        return !!o && o.controller !== ctx.controller && o.token === undefined && ctx.isType(id, 'Creature');
      },
      after: (ctx) => { ctx.createToken('Zombie', ctx.controller); },
    }),
    act({
      cost: {
        mana: '{2}{B}',
        sacrifice: {
          count: 1, another: true, filter: () => true,
          // Subtypes come from computed characteristics, so an animated Mutavault (all creature
          // types) or a Reflection copy of a Vampire qualifies.
          ctxFilter: (ctx, id) => {
            const c = ctx.chars(id);
            return c.allCreatureTypes || c.subtypes.includes('Vampire') || c.subtypes.includes('Zombie');
          },
        },
      },
      resolve: (ctx) => { ctx.addCounter(ctx.source, 'p1p1', 2); },
    }),
  ],
})]);
