// Phase 4 acceptance tool smoke (src/tools/acceptance.ts; PLAN.md section 8, Phase 4). Not the
// acceptance run, which is documented in docs/ACCEPTANCE.md and not repeated here: 40 games of the
// MCTS agent against greedy under a tiny budget (20 with MCTS as A, 20 as B, on 2 worker threads),
// every decision of both agents checked against the legal move list by the runner, and the
// acceptance report checked for n and a 95 percent interval on every number.
import { describe, expect, it } from 'vitest';
import { runMatch } from '../../sim/runner.js';
import { BASELINE, formatSide, job, sideResult } from '../../tools/acceptance.js';
import { matchCommand, parseMatchArgs } from '../../cli/index.js';

describe('acceptance tool smoke: MCTS vs greedy, 40 games, tiny budget', () => {
  it('plays 40 games with no illegal move and reports n and a 95% CI for each side', async () => {
    const tiny = parseMatchArgs(['--samples', '1', '--iterations', '3', '--policy', 'greedy', '--prune', '2', '--turns', '1', '--margin', '3']).mcts;
    const lines: string[] = [];
    let games = 0;
    let decisions = 0;
    for (const side of ['A', 'B'] as const) {
      const r = await runMatch(job(side, tiny, true), { games: 20, seed: side === 'A' ? 31 : 32, workers: 2, blockSize: 2 });
      games += r.games;
      decisions += r.decisions;
      expect(r.games).toBe(20);
      // The runner throws on an illegal move; every move played is a checked decision, followed by an invariant check.
      expect(r.decisions).toBeGreaterThan(20 * 20);
      expect(r.invariantChecks).toBe(r.decisions);
      const s = sideResult(side, r, BASELINE[side]);
      expect(s.mcts.k + s.greedy.k + s.draws.k).toBe(20);
      expect(s.perGame.map((g) => g.i)).toEqual(Array.from({ length: 20 }, (_, i) => i));
      const text = formatSide(s);
      lines.push(text);
      for (const label of ['MCTS win rate', 'greedy win rate', 'draws']) {
        expect(text).toMatch(new RegExp(`${label}: +\\d+\\.\\d% \\[95% CI \\d+\\.\\d-\\d+\\.\\d%, n=20\\]`));
      }
      expect(text).toMatch(/baseline, greedy as [AB] vs greedy: \d+\.\d% \[95% CI [\d.]+-[\d.]+%, n=1000\]/);
      expect(text).toMatch(/two-sided p = [\d.e+-]+/);
      expect(text).toMatch(/speed: median [\d.]+ games\/sec\/core \[(9[5-9]|100)\.\d% CI [\d.]+-[\d.]+, n=10 blocks/);
    }
    console.log(`acceptance smoke: ${games} games, ${decisions} decisions checked legal (not the acceptance run)\n${lines.join('\n')}`);
    expect(games).toBe(40);
  }, 600_000);
});

// A slice of the acceptance run can be replayed with the match command (docs/ACCEPTANCE.md): block b
// is seeded by b + 1 jumps of the master stream whatever the game count, and the match command
// builds the same job as the acceptance tool. Tiny budget here, the acceptance flags otherwise.
describe('slice replay: the match command reproduces the first games of an acceptance side', () => {
  it('the first 3 games of a 5-game acceptance side (MCTS as A) equal a 3-game match command run', async () => {
    const flags = ['--samples', '1', '--iterations', '3', '--policy', 'greedy', '--prune', '3', '--turns', '1', '--margin', '3', '--override', '2', '--min-gain', '0.02', '--block-size', '2', '--workers', '0'];
    const acc = await runMatch(job('A', parseMatchArgs(flags).mcts, true), { games: 5, seed: 20260930, workers: 0, blockSize: 2 });
    const slice = await matchCommand(['--a', 'mcts', '--b', 'greedy', '--games', '3', '--seed', '20260930', ...flags]);
    console.log(`slice replay: ${acc.games} acceptance games, ${slice.games} match games compared, ${slice.decisions} decisions`);
    expect(acc.perGame).toHaveLength(5);
    expect(slice.perGame).toHaveLength(3);
    expect(slice.perGame).toEqual(acc.perGame.slice(0, 3));
    // L1: a different seed gives different games, so the equality is not vacuous.
    const other = await matchCommand(['--a', 'mcts', '--b', 'greedy', '--games', '3', '--seed', '20260931', ...flags]);
    expect(other.perGame).not.toEqual(slice.perGame);
  }, 600_000);
});
