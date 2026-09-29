import { act, card, granted, grantedKey, land, mana, t, trig } from '../dsl.js';
import { landCount, manlandWindow } from '../land-windows.js';

/**
 * The quoted attack trigger the animation grants: exile target card from defending player's
 * graveyard. With two players the defending player is always the opponent.
 * CR 603.3d (no legal target): with an empty graveyard the trigger is removed as it would go on the stack.
 */
export const HiveOfTheEyeTyrantGranted = granted('Hive of the Eye Tyrant', [
  trig('attacks', { targets: [t.cardInGraveyard({ controller: 'opponent' })] }, (ctx, [tg]) => {
    if (tg?.kind === 'obj') ctx.exile(tg.id);
  }),
]);

/**
 * Hive of the Eye Tyrant. Enters tapped if you control two or more other lands. {T}: Add {B}.
 * {3}{B}: until end of turn a 3/3 black Beholder creature with menace and the trigger above; still a
 * land. CR 613.1d (type-changing layer), CR 613.4b (set power and toughness).
 */
export const HiveOfTheEyeTyrant = card('Hive of the Eye Tyrant', [land({
  name: 'Hive of the Eye Tyrant',
  mana: [mana({ produce: ['B'] })],
  entersTapped: (ctx) => landCount(ctx) >= 2,
  abilities: [act({
    cost: { mana: '{3}{B}' },
    window: manlandWindow,
    resolve: (ctx) => {
      ctx.animate(ctx.source, {
        types: ['Creature'], subtypes: ['Beholder'], colors: ['B'], pt: [3, 3], keywords: ['menace'],
        abilities: [grantedKey(HiveOfTheEyeTyrantGranted, 0)],
      });
    },
  })],
})]);
