import { describe, expect, it } from 'vitest';
import { deckOf, TestBear, TestBolt } from '../helpers.js';
import { loadDeckFile, newGame, resolveDeck } from '../../engine/setup.js';
import type { GameState } from '../../engine/types.js';

const DECK_A = deckOf({ Swamp: 20, 'Test Bear': 20, 'Test Bolt': 20 });
const DECK_B = deckOf({ Mountain: 30, 'Test Bolt': 30 });

const libDefs = (s: GameState, p: 0 | 1): string[] => s.zones.library[p].map((id) => s.objects[id]!.defId);

describe('newGame', () => {
  it('deals seven, leaves 53 in the library and asks the starting player about a mulligan', () => {
    const s = newGame(DECK_A, DECK_B, 42, 0);
    for (const p of [0, 1] as const) {
      expect(s.zones.hand[p].length).toBe(7);
      expect(s.zones.library[p].length).toBe(53);
      expect(s.players[p].life).toBe(20);
      for (const id of s.zones.hand[p]) expect(s.objects[id]!.knownTo).toEqual(p === 0 ? [true, false] : [false, true]);
    }
    expect(s.pendingChoice).toEqual({ kind: 'mulligan', player: 0 });
    expect(s.startingPlayer).toBe(0);
    expect(s.events).toEqual([]);
    expect(s.step).toBe('mulligan');
  });

  it('shuffles before assigning ids: library ids ascend with position whatever the order of cards', () => {
    const a = newGame(DECK_A, DECK_B, 1, 0);
    const b = newGame(DECK_A, DECK_B, 2, 0);
    // Ids 1..60 were given in shuffled order, bottom first; the top seven were drawn (and re-id'd).
    expect(a.zones.library[0]).toEqual(Array.from({ length: 53 }, (_, i) => i + 1));
    expect(b.zones.library[0]).toEqual(a.zones.library[0]);
    // The card behind each id differs by seed, so an id says nothing about the card.
    expect(libDefs(a, 0)).not.toEqual(libDefs(b, 0));
    const counts = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});
    const all = [...libDefs(a, 0), ...a.zones.hand[0].map((id) => a.objects[id]!.defId)];
    expect(counts(all)).toEqual({ swamp: 20, [TestBear.id]: 20, [TestBolt.id]: 20 });
  });

  it('is deterministic: same seed, same state; state is plain JSON', () => {
    const a = newGame(DECK_A, DECK_B, 7, 'random');
    const b = newGame(DECK_A, DECK_B, 7, 'random');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(structuredClone(a)).toEqual(a);
    const starters = new Set(Array.from({ length: 40 }, (_, i) => newGame(DECK_A, DECK_B, i, 'random').startingPlayer));
    expect(starters.size).toBe(2); // the die roll picks both players across seeds
  });

  it('loads deck files by name and resolves names through the registry', () => {
    const a = loadDeckFile('deckA');
    const b = loadDeckFile('deckB');
    const total = (l: { main: { count: number }[] }) => l.main.reduce((n, e) => n + e.count, 0);
    console.log(`deck files: deckA main ${total(a)}, deckB main ${total(b)}`);
    expect(total(a)).toBe(60);
    expect(total(b)).toBe(60);
    expect(() => resolveDeck(deckOf({ Swamp: 10, 'No Such Card': 2 }))).toThrow(/No Such Card/);
    expect(resolveDeck(deckOf({ Swamp: 2, Mountain: 1 }))).toEqual(['swamp', 'swamp', 'mountain']);
  });
});
