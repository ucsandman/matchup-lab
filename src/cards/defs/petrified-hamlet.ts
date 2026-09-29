import { card, land, mana, trig } from '../dsl.js';

/**
 * The names Petrified Hamlet may choose: land cards with non-mana activated abilities in the two 75s
 * (PLAN.md section 5: real Magic allows any land card name; the others change nothing here).
 */
export const HAMLET_NAMES: readonly string[] = [
  'Mutavault', 'Den of the Bugbear', 'Ramunap Ruins', 'Sokenzan, Crucible of Defiance', 'Rockface Village',
  'Castle Locthwain', 'Hive of the Eye Tyrant', 'Takenuma, Abandoned Mire',
];

/**
 * Petrified Hamlet. {T}: Add {C} (ability 0). When it enters, its controller chooses a land card name
 * (a pickIndex into HAMLET_NAMES). While it is on the battlefield, activated abilities of sources with
 * that name can't be activated unless they are mana abilities (CR 602.5 (prohibited activation): in
 * every zone, so channel from hand is blocked too, for both players), and lands with that name have
 * its {T}: Add {C} (CR 613.1f (ability-adding layer)). Both live in one namedBan effect (engine: ctx
 * addNamedBan, the grant in statics.ts, removal in zones.ts when the Hamlet leaves).
 */
export const PetrifiedHamlet = card('Petrified Hamlet', [land({
  name: 'Petrified Hamlet',
  mana: [mana({ produce: ['C'] })],
  abilities: [trig('etb', (ctx) => {
    const a = ctx.choose({ kind: 'pickIndex', player: ctx.controller, reason: 'chooseLandName', count: HAMLET_NAMES.length });
    const name = HAMLET_NAMES[a.index ?? 0];
    if (name !== undefined) ctx.addNamedBan(name, 'petrified-hamlet:0:0');
  })],
})]);
