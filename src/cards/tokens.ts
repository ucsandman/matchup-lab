// Token definitions (PLAN.md section 6). Predefined tokens follow CR 111.10 (predefined token);
// the rest follow the card text that creates them. Token def ids are 'token-<name>'.
import type { CardDef, FaceDef } from '../engine/types.js';
import { act, face, mana, stat, trig } from './dsl.js';

function token(id: string, name: string, f: FaceDef): CardDef {
  return { id, name, layout: 'token', faces: [f] };
}

/** CR 111.10g (Blood token): {1}, {T}, Discard a card, Sacrifice this token: Draw a card. */
export const Blood = token('token-blood', 'Blood', face({
  name: 'Blood', types: ['Artifact'], subtypes: ['Blood'],
  abilities: [act({ cost: { mana: '{1}', tap: true, discard: 1, sacrificeSelf: true }, resolve: (ctx) => ctx.draw(ctx.controller) })],
}));

/** CR 111.10a (Treasure token): {T}, Sacrifice this token: Add one mana of any color. */
export const Treasure = token('token-treasure', 'Treasure', face({
  name: 'Treasure', types: ['Artifact'], subtypes: ['Treasure'],
  abilities: [mana({ produce: 'any', cost: { tap: true, sacrificeSelf: true } })],
}));

/** Fable of the Mirror-Breaker chapter I. */
export const GoblinShaman = token('token-goblin-shaman', 'Goblin Shaman', face({
  name: 'Goblin Shaman', types: ['Creature'], subtypes: ['Goblin', 'Shaman'], colors: ['R'], pt: [2, 2],
  abilities: [trig('attacks', (ctx) => { ctx.createToken('Treasure', ctx.controller); })],
}));

/** Kalitas, Traitor of Ghet. */
export const Zombie = token('token-zombie', 'Zombie', face({
  name: 'Zombie', types: ['Creature'], subtypes: ['Zombie'], colors: ['B'], pt: [2, 2],
}));

/** Sokenzan channel (the haste is granted by the channel effect, not by the token). */
export const Spirit = token('token-spirit', 'Spirit', face({
  name: 'Spirit', types: ['Creature'], subtypes: ['Spirit'], colors: [], pt: [1, 1],
}));

/** Den of the Bugbear attack trigger (created tapped and attacking by the trigger). */
export const Goblin = token('token-goblin', 'Goblin', face({
  name: 'Goblin', types: ['Creature'], subtypes: ['Goblin'], colors: ['R'], pt: [1, 1],
}));

/** Reckoner Bankbuster: crews Vehicles as though its power were 2 greater. */
export const Pilot = token('token-pilot', 'Pilot', face({
  name: 'Pilot', types: ['Creature'], subtypes: ['Pilot'], colors: [], pt: [1, 1],
  abilities: [stat({ category: 'crewBonus', amount: 2 })],
}));

/** Ritual Chamber unlock trigger. */
export const Demon = token('token-demon', 'Demon', face({
  name: 'Demon', types: ['Creature'], subtypes: ['Demon'], colors: ['B'], pt: [6, 6], keywords: ['flying'],
}));

/** Avatar Roku: 4/4 red Dragon with flying and firebending 4 (mana lasts until end of combat). */
export const Dragon = token('token-dragon', 'Dragon', face({
  name: 'Dragon', types: ['Creature'], subtypes: ['Dragon'], colors: ['R'], pt: [4, 4], keywords: ['flying', 'firebending'],
  abilities: [trig('attacks', (ctx) => {
    // CR 702.189a (firebending): add N {R}; until end of combat this mana is not lost as steps end.
    for (let i = 0; i < 4; i++) ctx.addMana(ctx.controller, 'R', { expires: 'endOfCombat' });
  })],
}));

/** CR 111.10k (Monster Role token): enchanted creature gets +1/+1 and has trample. */
export const MonsterRole = token('token-monster-role', 'Monster', face({
  name: 'Monster', types: ['Enchantment'], subtypes: ['Aura', 'Role'],
  abilities: [stat({ category: 'enchantedGets', p: 1, t: 1, keywords: ['trample'] })],
}));

/**
 * Reflection of Kiki-Jiki copy: characteristics come from the object's copyOf def, plus haste
 * (CR 707.9b (copy exceptions)). The sacrifice at the next end step is a delayed trigger set up
 * by the Reflection ability, not part of the token.
 */
export const Copy = token('token-copy', 'Copy', face({
  name: 'Copy', types: [], keywords: ['haste'],
}));

export const TOKENS: readonly CardDef[] = [Blood, Treasure, GoblinShaman, Zombie, Spirit, Goblin, Pilot, Demon, Dragon, MonsterRole, Copy];

/** Short names accepted by createToken, mapped to token def ids. */
export const TOKEN_IDS: Readonly<Record<string, string>> = {
  Blood: Blood.id, Treasure: Treasure.id, GoblinShaman: GoblinShaman.id, Zombie: Zombie.id, Spirit: Spirit.id,
  Goblin: Goblin.id, Pilot: Pilot.id, Demon: Demon.id, Dragon: Dragon.id, MonsterRole: MonsterRole.id, Copy: Copy.id,
};
