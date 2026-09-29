import { act, card, face, saga, trig } from '../dsl.js';

/**
 * The Legend of Roku // Avatar Roku ({2}{R}{R} Saga; back face a legendary 4/4 red Avatar with
 * firebending 4).
 */
export const TheLegendOfRoku = card('The Legend of Roku // Avatar Roku', [
  face({
    name: 'The Legend of Roku', types: ['Enchantment'], subtypes: ['Saga'], cost: '{2}{R}{R}',
    abilities: saga([
      // I: exile the top three cards of your library (face up, public); until the end of your next
      // turn you may play those cards. A land played this way uses the land drop (CR 305.2 (one land)). The
      // permission ends at the cleanup of that turn (turn.ts); the cards stay in exile.
      (ctx) => {
        const p = ctx.controller;
        // 'Your next turn': two turns on when this resolves in your own turn, else the next turn.
        const untilTurn = ctx.state.activePlayer === p ? ctx.state.turn + 2 : ctx.state.turn + 1;
        for (let i = 0; i < 3; i++) {
          const lib = ctx.state.zones.library[p];
          const top = lib[lib.length - 1];
          if (top === undefined) break;
          const ex = ctx.exile(top);
          if (ex !== null) ctx.grantPlayFromExile(ex, p, untilTurn);
        }
      },
      // II: add one mana of any color. Collapsed to {R} (PLAN.md D9): every cost in deck B is red or
      // generic, so the choice of color never changes a game of this matchup.
      (ctx) => { ctx.addMana(ctx.controller, 'R'); },
      // III: exile this Saga, then return it transformed under your control.
      (ctx) => { ctx.exileAndReturnTransformed(ctx.source); },
    ]),
  }),
  face({
    name: 'Avatar Roku', types: ['Creature'], subtypes: ['Avatar'], supertypes: ['Legendary'], cost: null,
    colors: ['R'], pt: [4, 4], keywords: ['firebending'],
    abilities: [
      // CR 702.189a (firebending): whenever this creature attacks, add {R}{R}{R}{R}; until end of
      // combat this mana is not lost as steps end (pool entries with expires 'endOfCombat').
      trig('attacks', (ctx) => { for (let i = 0; i < 4; i++) ctx.addMana(ctx.controller, 'R', { expires: 'endOfCombat' }); }),
      // {8}: create a 4/4 red Dragon creature token with flying and firebending 4. The move generator
      // offers it only when a payment plan for {8} exists (lands, pool and firebending mana).
      act({ cost: { mana: '{8}' }, resolve: (ctx) => { ctx.createToken('Dragon', ctx.controller); } }),
    ],
  }),
], 'transform');
