// The benchmark's summary (src/tools/bench.ts): the per-block speed median and the game-length
// quantiles each carry an order-statistic interval of at least 95 percent coverage and their n.
import { describe, expect, it } from 'vitest';
import { benchRun, benchSummary } from '../../tools/bench.js';

describe('bench summary', () => {
  it('2 runs of 40 test-pool games in blocks of 10: median speed over n=8 blocks and move quantiles over n=80 games, each with its interval', () => {
    const runs = [benchRun(40, 'test', 1, 10), benchRun(40, 'test', 41, 10)];
    for (const r of runs) { expect(r.blockRates).toHaveLength(4); expect(r.moves).toHaveLength(40); }
    const lines = benchSummary(runs, 10);
    console.log(lines.join('\n'));
    expect(lines[0]).toMatch(/^ {2}games\/sec\/core {2}median \d+\.\d \[(9[5-9]|100)\.\d% CI \d+\.\d-\d+\.\d, n=8 blocks, blocks of up to 10 games, 2 runs, one core\]$/);
    expect(lines[1]).toMatch(/^ {2}moves per game {2}p50 \d+ \[(9[5-9]|100)\.\d% CI \d+-\d+, n=80 games\] {2}p95 \d+ \[(9[5-9]|100)\.\d% CI \d+-\d+, n=80 games\]$/);
    expect(lines[2]).toBe('  total           80 games in 2 runs (counts, not estimates)');
  }, 120_000);

  it('a partial last block is timed on its own games', () => {
    const r = benchRun(25, 'test', 1, 10);
    expect(r.blockRates).toHaveLength(3);
    for (const x of r.blockRates) expect(x).toBeGreaterThan(0);
  }, 120_000);
});
