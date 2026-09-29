// Fuzz in the default suite: 2,000 random-vs-random games on the test pool, 500 on the extended
// test pool (combat, triggers, sagas, planeswalkers, tokens), 200 on the real decks and 100 with the
// sideboards swapped in, invariants 1-8 checked after every applyMove (PLAN.md section 7).
// The full 10,000-game runs are npm run fuzz.
import { describe, expect, it } from 'vitest';
import { formatReport, runFuzz } from '../tools/fuzz.js';

describe('fuzz', () => {
  it('2,000 games on the test pool: zero failures, zero cap hits', () => {
    const r = runFuzz({ games: 2000, seed: 1, pool: 'test', replay: 200 });
    const text = formatReport(r);
    console.log(text);
    // Every estimate in the report carries n and a 95 percent interval; maxima are labelled as checks.
    expect(text).toMatch(/^ {2}mean turns +\d+\.\d\d \[95% CI \d+\.\d\d-\d+\.\d\d, n=2000\] \(completed games\)$/m);
    expect(text).toMatch(/^ {2}time per game +median \d+\.\d ms \[9\d\.\d% CI \d+\.\d-\d+\.\d, n=2000 games, checks and replays included\]$/m);
    expect(text).toMatch(/^ {2}max turns +\d+ \(the largest of n=2000 completed games; a check against the turn cap, not an estimate\)$/m);
    expect(text).not.toMatch(/games\/s/);
    expect(r.failures).toEqual([]);
    expect(r.capHits).toBe(0);
    expect(r.games).toBe(2000);
    expect(r.moves).toBeGreaterThan(0);
  }, 600_000);

  it('500 games on the extended test pool: zero failures, zero cap hits', () => {
    const r = runFuzz({ games: 500, seed: 100_001, pool: 'extended', replay: 50 });
    console.log(formatReport(r));
    expect(r.failures).toEqual([]);
    expect(r.capHits).toBe(0);
    expect(r.games).toBe(500);
    expect(r.viewChecks).toBeGreaterThan(0);
  }, 600_000);

  it('200 games on the real game-1 decks and 100 with the sideboards swapped in: zero failures, zero cap hits', () => {
    for (const [pool, games, seed] of [['decks', 200, 200_001], ['sideboard', 100, 300_001]] as const) {
      const r = runFuzz({ games, seed, pool, replay: 20 });
      console.log(formatReport(r));
      expect(r.failures).toEqual([]);
      expect(r.capHits).toBe(0);
      expect(r.games).toBe(games);
      expect(Object.keys(r.used).length).toBeGreaterThan(0);
    }
  }, 600_000);
});
