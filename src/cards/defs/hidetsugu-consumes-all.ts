import { card, face, saga, stat, trig } from '../dsl.js';

/**
 * Hidetsugu Consumes All // Vessel of the All-Consuming ({1}{B}{R} Saga; back face a 3/3 black and
 * red Ogre Shaman with trample). Sideboard card for deck A.
 */
export const HidetsuguConsumesAll = card('Hidetsugu Consumes All // Vessel of the All-Consuming', [
  face({
    name: 'Hidetsugu Consumes All', types: ['Enchantment'], subtypes: ['Saga'], cost: '{1}{B}{R}',
    abilities: saga([
      // I: destroy each nonland permanent with mana value 1 or less, as one event. CR 202.3 (mana value):
      // tokens are 0 (Role, Blood, Treasure, Goblin Shaman); CR 712.8e (mana value of front face): a
      // transformed permanent uses its front face (Etching of Kumano is 1); an animated land is still a land.
      (ctx) => {
        const hit = ctx.state.zones.battlefield.filter((id) => !ctx.isType(id, 'Land') && ctx.chars(id).manaValue <= 1);
        ctx.destroyAll(hit);
      },
      // II: exile all graveyards.
      (ctx) => {
        for (const p of [0, 1] as const) for (const id of [...ctx.state.zones.graveyard[p]]) ctx.exile(id);
      },
      // III: exile this Saga, then return it transformed under your control.
      (ctx) => { ctx.exileAndReturnTransformed(ctx.source); },
    ]),
  }),
  face({
    name: 'Vessel of the All-Consuming', types: ['Enchantment', 'Creature'], subtypes: ['Ogre', 'Shaman'], cost: null,
    colors: ['B', 'R'], pt: [3, 3], keywords: ['trample'],
    abilities: [
      // Turns on the per-source damage tally to players (damage.ts, turnFlags.damageTally, reset each turn).
      stat({ category: 'marker', marker: 'tracksDamageDealt' }),
      // Whenever this creature deals damage, put a +1/+1 counter on it. One trigger per damage event
      // (all damage from one combat damage step or one resolution is summed, PLAN.md D12).
      trig('dealsDamage', (ctx) => { ctx.addCounter(ctx.source, 'p1p1', 1); }),
      // Whenever this creature deals damage to a player, if it has dealt 10 or more damage to that
      // player this turn, they lose the game. CR 603.4 (intervening if): checked when it triggers and
      // again on resolution; CR 104.3e (an effect states a player loses the game). The tally is per
      // object: a new Vessel after a zone change starts at 0 (CR 400.7 (new object)).
      trig('dealsDamage', {
        filter: (_ctx, info) => info.player !== undefined,
        interveningIf: (ctx, info) => info.player !== undefined && (ctx.state.turnFlags.damageTally[ctx.source]?.[info.player] ?? 0) >= 10,
      }, (ctx, _t, info) => {
        if (info.player !== undefined) ctx.loseGame(info.player, 'Vessel of the All-Consuming: dealt 10 or more damage this turn');
      }),
    ],
  }),
], 'transform');
