// Fuzz pools. 'test' is the minimal registered pool (Mountain, Swamp, TestBear, TestBolt).
// 'extended' adds test-only cards that exercise the engine paths the minimal pool never reaches
// (TestBear costs green, so the test pool never casts a creature): haste, deathtouch, lifelink,
// trample, menace, flying, prowess, a planeswalker with loyalty abilities, a saga, the legend
// rule, Blood tokens (activated ability with discard and sacrifice costs), a drain spell and a
// targeted ETB trigger. 'decks' is the real matchup and needs every card def. 'sideboard' is the
// real matchup with every sideboard card swapped in (SIDEBOARD_SWAP below), so the fuzzer reaches
// the 16 sideboard-only cards; it is a test config, not a sideboard plan.
import { act, card, face, saga, spell, t, trig } from '../cards/dsl.js';
import { registerTestDef } from './helpers.js';
import { loadDeckFile, type DeckList } from '../engine/setup.js';

export const TestGoblin = registerTestDef(card('Test Goblin', [face({
  name: 'Test Goblin', types: ['Creature'], subtypes: ['Goblin'], cost: '{R}', pt: [1, 1], keywords: ['haste'],
})]));
export const TestKnight = registerTestDef(card('Test Knight', [face({
  name: 'Test Knight', types: ['Creature'], subtypes: ['Knight'], cost: '{1}{B}', pt: [2, 2], keywords: ['deathtouch', 'lifelink'],
})]));
export const TestBrute = registerTestDef(card('Test Brute', [face({
  name: 'Test Brute', types: ['Creature'], subtypes: ['Ogre'], cost: '{2}{R}', pt: [3, 3], keywords: ['trample', 'menace'],
})]));
export const TestFlier = registerTestDef(card('Test Flier', [face({
  name: 'Test Flier', types: ['Creature'], subtypes: ['Bat'], cost: '{1}{B}{B}', pt: [2, 2], keywords: ['flying'],
})]));
export const TestProwler = registerTestDef(card('Test Prowler', [face({
  name: 'Test Prowler', types: ['Creature'], subtypes: ['Monk'], cost: '{1}{R}', pt: [1, 2], keywords: ['prowess'],
})]));
export const TestLegend = registerTestDef(card('Test Legend', [face({
  name: 'Test Legend', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Vampire'], cost: '{B}{R}', pt: [3, 2],
})]));
/** ETB: create a Blood token; also a targeted ETB trigger: 1 damage to up to one target creature. */
export const TestBleeder = registerTestDef(card('Test Bleeder', [face({
  name: 'Test Bleeder', types: ['Creature'], subtypes: ['Vampire'], cost: '{1}{R}', pt: [2, 1],
  abilities: [
    trig('etb', (ctx) => { ctx.createToken('Blood', ctx.controller); }),
    trig('etb', { targets: [t.creature({ min: 0, max: 1 })] }, (ctx, [tg]) => { if (tg) ctx.dealDamage(tg, 1); }),
  ],
})]));
export const TestWalker = registerTestDef(card('Test Walker', [face({
  name: 'Test Walker', types: ['Planeswalker'], supertypes: ['Legendary'], cost: '{1}{B}{B}', loyalty: 3,
  abilities: [
    act({ cost: { loyalty: 1 }, resolve: (ctx) => { ctx.loseLife(ctx.opponent, 1); } }),
    act({ cost: { loyalty: -2 }, target: t.creature(), resolve: (ctx, [tg]) => { if (tg?.kind === 'obj') ctx.destroy(tg.id); } }),
  ],
})]));
export const TestChronicle = registerTestDef(card('Test Chronicle', [face({
  name: 'Test Chronicle', types: ['Enchantment'], subtypes: ['Saga'], cost: '{1}{R}',
  abilities: saga([
    (ctx) => { ctx.createToken('GoblinShaman', ctx.controller); },
    (ctx) => { ctx.draw(ctx.controller); },
    (ctx) => { ctx.gainLife(ctx.controller, 2); },
  ]),
})]));
export const TestDrain = registerTestDef(card('Test Drain', [face({
  name: 'Test Drain', types: ['Sorcery'], cost: '{B}',
  abilities: [spell({ target: t.opponent(), resolve: (ctx, [tg]) => { if (tg?.kind === 'player') { ctx.loseLife(tg.p, 2); ctx.gainLife(ctx.controller, 2); } } })],
})]));

const deck = (entries: Record<string, number>): DeckList => ({ main: Object.entries(entries).map(([name, count]) => ({ name, count })) });

export const TEST_POOL_DECK: DeckList = deck({ Mountain: 14, Swamp: 10, 'Test Bear': 18, 'Test Bolt': 18 });

export const EXTENDED_DECK_A: DeckList = deck({
  Mountain: 12, Swamp: 12, 'Test Bolt': 4, 'Test Goblin': 4, 'Test Knight': 4, 'Test Brute': 4, 'Test Flier': 3,
  'Test Prowler': 4, 'Test Legend': 3, 'Test Bleeder': 4, 'Test Walker': 2, 'Test Chronicle': 2, 'Test Drain': 2,
});
export const EXTENDED_DECK_B: DeckList = deck({
  Mountain: 14, Swamp: 10, 'Test Bolt': 6, 'Test Goblin': 6, 'Test Knight': 3, 'Test Brute': 4, 'Test Flier': 2,
  'Test Prowler': 6, 'Test Legend': 2, 'Test Bleeder': 3, 'Test Walker': 1, 'Test Chronicle': 2, 'Test Drain': 1,
});

/**
 * Fuzz-only sideboard configs: the whole 15-card sideboard comes in and the listed main-deck cards
 * go out, keeping 60. Not a sideboard plan (PLAN.md section 10): it only exercises the defs.
 */
export const SIDEBOARD_SWAP: Record<'deckA' | 'deckB', Record<string, number>> = {
  deckA: { Thoughtseize: 4, Duress: 2, 'Liliana of the Veil': 1, 'Fear of Missing Out': 1, 'Graveyard Trespasser // Graveyard Glutton': 2, 'Bitter Triumph': 1, 'Gifted Aetherborn': 2, Swamp: 2 },
  deckB: { 'Monstrous Rage': 4, 'Reckless Rage': 4, 'Emberheart Challenger': 4, 'Sunspine Lynx': 3 },
};

/** A deck file with its sideboard swapped in for SIDEBOARD_SWAP[file]; throws unless the result is 60 cards. */
export function sideboardDeck(file: 'deckA' | 'deckB'): DeckList {
  const list = loadDeckFile(file);
  const out = { ...SIDEBOARD_SWAP[file] };
  const counts = new Map<string, number>();
  for (const e of list.main) counts.set(e.name, (counts.get(e.name) ?? 0) + e.count);
  for (const [name, n] of Object.entries(out)) {
    const have = counts.get(name) ?? 0;
    if (have < n) throw new Error(`sideboardDeck ${file}: cannot take out ${n} ${name} (main has ${have})`);
    counts.set(name, have - n);
  }
  for (const e of list.side ?? []) counts.set(e.name, (counts.get(e.name) ?? 0) + e.count);
  const main = [...counts].filter(([, c]) => c > 0).map(([name, count]) => ({ name, count }));
  const total = main.reduce((a, e) => a + e.count, 0);
  if (total !== 60) throw new Error(`sideboardDeck ${file}: ${total} cards, expected 60`);
  return { main };
}
