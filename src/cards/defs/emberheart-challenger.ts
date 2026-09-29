import { card, face, trig } from '../dsl.js';

/**
 * Emberheart Challenger. {1}{R} 2/2 Mouse Warrior with haste and prowess.
 * Valiant: whenever it becomes the target of a spell or ability you control for the first time
 * each turn, exile the top card of your library; until end of turn you may play that card.
 * The once-per-turn flag is set as the event happens (firstTimeEachTurn), so a later fizzle of the
 * targeting spell neither undoes the trigger nor lets a second one happen (CR 207.2c (ability word)).
 * The permission ends at this turn's cleanup (CR 514.2 (until end of turn effects end)); a land
 * played from exile uses the land drop (CR 305.2 (one land per turn)).
 */
export const EmberheartChallenger = card('Emberheart Challenger', [face({
  name: 'Emberheart Challenger', types: ['Creature'], subtypes: ['Mouse', 'Warrior'], cost: '{1}{R}', pt: [2, 2],
  keywords: ['haste', 'prowess', 'valiant'],
  abilities: [
    trig('becomesTarget', {
      filter: (ctx, info) => info.player === ctx.controller,
      firstTimeEachTurn: true,
    }, (ctx) => {
      const lib = ctx.state.zones.library[ctx.controller];
      const top = lib[lib.length - 1];
      if (top === undefined) return;
      const ex = ctx.exile(top);
      if (ex !== null) ctx.grantPlayFromExile(ex, ctx.controller, ctx.state.turn);
    }),
  ],
})]);
