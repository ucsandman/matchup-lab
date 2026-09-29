// Phase 2 gate (PLAN.md sections 7 and 8), run through the worker runner:
//  - greedy never picks an illegal move: 1,000 greedy-vs-greedy games, every decision of both
//    agents checked against the legal move list, fuzz invariants 1 to 5 after every move;
//  - greedy beats random at least 80 percent over 2,000 games per side (the Wilson lower bound
//    must clear 80 percent);
//  - greedy-vs-greedy game length is sane: median under 12 turns per player (see the note in
//    CHANGELOG.md, Phase 2: the median is 13 counted as total turns of both players).
// Every number is printed with n and its 95 percent interval.
import { beforeAll, describe, expect, it } from 'vitest';
import { runMatch, type MatchReport } from '../../sim/runner.js';
import { DEFAULT_KEY_CARDS, type MatchJob } from '../../sim/games.js';
import { fmtMean, fmtPct, fmtQuantile, quantileInterval } from '../../sim/stats.js';
import { fmtSpeed } from '../../cli/index.js';

const job = (a: 'random' | 'greedy', b: 'random' | 'greedy', check = false): MatchJob => ({
  deckA: 'deckA', deckB: 'deckB', agentA: { kind: a }, agentB: { kind: b }, play: 'alternate', keyCards: [...DEFAULT_KEY_CARDS], check,
});

const LONG = 1_800_000;

describe('Phase 2 gate: greedy agent', () => {
  let mirror: MatchReport;
  beforeAll(async () => {
    mirror = await runMatch(job('greedy', 'greedy', true), { games: 1000, seed: 20260929 });
  }, LONG);

  it('never picks an illegal move (1,000 greedy-vs-greedy games, invariants after every move)', () => {
    console.log(`legality: ${mirror.games} games, ${mirror.decisions} agent decisions checked, 0 illegal; ${mirror.invariantChecks} invariant checks; speed ${fmtSpeed(mirror.speed)} on ${mirror.workers} workers`);
    expect(mirror.games).toBe(1000);
    expect(mirror.decisions).toBeGreaterThan(50_000);
    expect(mirror.invariantChecks).toBe(mirror.decisions); // one check after every move, and every move is a checked decision
  });

  it('greedy vs greedy: game length is sane (median under 12 turns per player)', () => {
    const perPlayer = mirror.perGame.map((g) => Math.ceil(g.turns / 2));
    const med = quantileInterval(perPlayer, 0.5);
    console.log([
      `greedy vs greedy: A (Rakdos) wins ${fmtPct(mirror.winA)}, B (Mono-Red) wins ${fmtPct(mirror.winB)}, draws ${fmtPct(mirror.draws)}`,
      `  total turns (both players): median ${fmtQuantile(mirror.turns.median)}, mean ${fmtMean(mirror.turns.mean)}, p95 ${fmtQuantile(mirror.turns.p95)}`,
      `  turns per player: median ${fmtQuantile(med)}`,
      `  kill turn (winner's own turns): A ${fmtMean(mirror.killTurnA)}, B ${fmtMean(mirror.killTurnB)}`,
      ...mirror.keyCards.map((k) => `  ${k.label}: ${fmtPct(k.p)}`),
    ].join('\n'));
    expect(med.n).toBe(1000);
    expect(med.hi).toBeLessThan(12);
    // Both decks win games: neither agent is passive enough to be run over every game.
    expect(mirror.winA.lo).toBeGreaterThan(0.2);
    expect(mirror.winB.lo).toBeGreaterThan(0.2);
  });

  for (const side of ['A', 'B'] as const) {
    it(`greedy beats random at least 80 percent as ${side === 'A' ? 'A (Rakdos)' : 'B (Mono-Red)'} over 2,000 games`, async () => {
      const r = await runMatch(side === 'A' ? job('greedy', 'random') : job('random', 'greedy'), { games: 2000, seed: side === 'A' ? 101 : 202 });
      const win = side === 'A' ? r.winA : r.winB;
      console.log(`greedy (${side}) vs random: greedy wins ${fmtPct(win)}; draws ${fmtPct(r.draws)}; median length ${fmtQuantile(r.turns.median)} total turns; ${r.decisions} decisions checked legal; speed ${fmtSpeed(r.speed)}`);
      expect(win.n).toBe(2000);
      expect(win.lo).toBeGreaterThanOrEqual(0.8);
    }, LONG);
  }
});
