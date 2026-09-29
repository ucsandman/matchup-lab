import { act, card, granted, grantedKey, land, mana, trig } from '../dsl.js';
import { landCount, manlandWindow } from '../land-windows.js';

/**
 * The quoted attack trigger the animation grants. CR 508.4 (put onto the battlefield attacking): the
 * Goblin token was never declared as an attacker, so it triggers no attack abilities. It attacks the
 * player or planeswalker the Den attacks (the opponent if the Den already left combat).
 */
export const DenOfTheBugbearGranted = granted('Den of the Bugbear', [
  trig('attacks', (ctx) => {
    const d = ctx.obj(ctx.source)?.attacking;
    ctx.createToken('Goblin', ctx.controller, { tapped: true, attacking: d ? { ...d } : { kind: 'player', p: ctx.opponent } });
  }),
]);

/**
 * Den of the Bugbear. Enters tapped if you control two or more other lands. {T}: Add {R}.
 * {3}{R}: until end of turn a 3/2 red Goblin creature with the attack trigger above; still a land.
 * CR 613.1d (type-changing layer), CR 613.4b (set power and toughness): the overlay ends at cleanup (turn.ts).
 */
export const DenOfTheBugbear = card('Den of the Bugbear', [land({
  name: 'Den of the Bugbear',
  mana: [mana({ produce: ['R'] })],
  entersTapped: (ctx) => landCount(ctx) >= 2,
  abilities: [act({
    cost: { mana: '{3}{R}' },
    window: manlandWindow,
    resolve: (ctx) => {
      ctx.animate(ctx.source, { types: ['Creature'], subtypes: ['Goblin'], colors: ['R'], pt: [3, 2], abilities: [grantedKey(DenOfTheBugbearGranted, 0)] });
    },
  })],
})]);
