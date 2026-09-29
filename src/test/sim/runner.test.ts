// Match runner: block seeding, determinism (same seed, same aggregate, for any worker count), the
// worker_threads path, the legality check and the fixed opening hand (PLAN.md section 6 and 7).
import { describe, expect, it } from 'vitest';
import { makeBlocks, runMatch } from '../../sim/runner.js';
import { checkedChoice, fixOpeningHand, type MatchJob } from '../../sim/games.js';
import { newGame } from '../../engine/setup.js';
import { legalMoves } from '../../engine/moves.js';
import type { Agent } from '../../agents/types.js';

const JOB: MatchJob = { deckA: 'deckA', deckB: 'deckB', agentA: { kind: 'random' }, agentB: { kind: 'greedy' }, play: 'alternate' };

describe('blocks', () => {
  it('cover the games once, each with its own jumped stream', () => {
    const b = makeBlocks(103, 5, 25);
    expect(b.map((x) => x.games)).toEqual([25, 25, 25, 25, 3]);
    expect(b.map((x) => x.first)).toEqual([0, 25, 50, 75, 100]);
    expect(new Set(b.map((x) => x.rng.join(','))).size).toBe(5);
    expect(makeBlocks(103, 5, 25)).toEqual(b);
  });
});

describe('determinism', () => {
  it('same seed gives the same games in-process and on 3 worker threads; another seed differs', async () => {
    const a = await runMatch(JOB, { games: 30, seed: 77, workers: 0, blockSize: 10 });
    const b = await runMatch(JOB, { games: 30, seed: 77, workers: 3, blockSize: 10 });
    const c = await runMatch(JOB, { games: 30, seed: 78, workers: 0, blockSize: 10 });
    console.log(`determinism: ${a.games} games, ${a.decisions} decisions; B won ${a.winB.k}, mean ${a.turns.mean.mean.toFixed(2)} turns`);
    expect(a.games).toBe(30);
    expect(b.perGame).toEqual(a.perGame);
    expect(b.winA).toEqual(a.winA);
    expect(b.turns).toEqual(a.turns);
    expect(b.decisions).toBe(a.decisions);
    expect(c.perGame).not.toEqual(a.perGame);
    expect(a.perGame.filter((g) => g.aOnPlay).length).toBe(15);
  }, 300_000);
});

describe('legality check', () => {
  it('throws when an agent answers with a move that is not legal', () => {
    const s = newGame('deckA', 'deckB', 1, 0);
    const legal = legalMoves(s, 0);
    const bad: Agent = { name: 'bad', choose: () => ({ type: 'pass' }) };
    expect(() => checkedChoice(bad, s, 0, legal, 'test')).toThrow(/illegal move/);
    const good: Agent = { name: 'good', choose: (d) => JSON.parse(JSON.stringify(d.moves[0])) };
    expect(checkedChoice(good, s, 0, legal, 'test')).toEqual(legal[0]);
  });
});

describe('fixed opening hand', () => {
  it('puts the named seven in hand and keeps the 60 intact', () => {
    const s = newGame('deckA', 'deckB', 12, 0);
    const want = ['Blood Crypt', 'Swamp', 'Blackcleave Cliffs', 'Thoughtseize', 'Bloodtithe Harvester', 'Fable of the Mirror-Breaker', 'Sheoldred, the Apocalypse'];
    const count = (): Record<string, number> => {
      const c: Record<string, number> = {};
      for (const o of Object.values(s.objects)) if (o.owner === 0) c[o.defId] = (c[o.defId] ?? 0) + 1;
      return c;
    };
    const before = count();
    fixOpeningHand(s, 0, want);
    const hand = s.zones.hand[0].map((id) => s.objects[id]!.defId).sort();
    expect(hand).toEqual(['blackcleave-cliffs', 'blood-crypt', 'bloodtithe-harvester', 'fable-of-the-mirror-breaker', 'sheoldred-the-apocalypse', 'swamp', 'thoughtseize']);
    expect(count()).toEqual(before);
    expect(() => fixOpeningHand(s, 0, ['Swamp'])).toThrow();
  });
});
