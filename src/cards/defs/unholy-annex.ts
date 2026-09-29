import { face, room, trig } from '../dsl.js';
import type { EffectCtx, PlayerId } from '../../engine/types.js';

/** Does player control a Demon? The Ritual Chamber token, a copy of it, or an animated Mutavault (all creature types). */
function controlsDemon(ctx: EffectCtx, player: PlayerId): boolean {
  return ctx.permanents(player, (id) => {
    const c = ctx.chars(id);
    // CR 205.3m (creature types): a creature with all creature types is a Demon.
    return c.subtypes.includes('Demon') || (c.allCreatureTypes && ctx.isType(id, 'Creature'));
  }).length > 0;
}

/**
 * Unholy Annex // Ritual Chamber. Room: {2}{B} // {3}{B}{B}, Enchantment - Room on both doors.
 * Either half is cast (a cast move with face 0 or 1) and enters with that door unlocked; the other
 * door is unlocked with the unlockDoor special action at sorcery timing, paying that door's mana
 * cost (CR 116.2m (unlock cost)). Unlocking is not casting a spell, so it triggers nothing that
 * looks for casts. A locked door has no abilities on the battlefield (CR 709.5 (locked half)).
 *
 * Unholy Annex: at the beginning of your end step, draw a card, then drain 2 if you control a
 * Demon, else lose 2. "If you control a Demon" is not an intervening-if (it is not right after the
 * trigger condition), so the ability always triggers and the Demon is checked as it resolves,
 * after the draw (CR 603.4 (intervening if)).
 *
 * Ritual Chamber: when you unlock this door, create a 6/6 black Demon with flying. Casting the
 * Ritual Chamber half also unlocks it, so the Demon comes at once (CR 709.5h (unlocks)).
 */
export const UnholyAnnex = room('Unholy Annex // Ritual Chamber',
  face({
    name: 'Unholy Annex', types: ['Enchantment'], subtypes: ['Room'], cost: '{2}{B}',
    abilities: [
      trig('endStep', (ctx) => {
        ctx.draw(ctx.controller);
        if (controlsDemon(ctx, ctx.controller)) {
          ctx.loseLife(ctx.opponent, 2);
          // CR 119.7 (can't gain life): with Sunspine Lynx out the gain does nothing; the loss still happens.
          ctx.gainLife(ctx.controller, 2);
        } else {
          ctx.loseLife(ctx.controller, 2);
        }
      }),
    ],
  }),
  face({
    name: 'Ritual Chamber', types: ['Enchantment'], subtypes: ['Room'], cost: '{3}{B}{B}',
    abilities: [trig('unlock', (ctx) => { ctx.createToken('Demon', ctx.controller); })],
  }));
