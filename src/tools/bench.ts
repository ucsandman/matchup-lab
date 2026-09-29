// Benchmark (PLAN.md section 7, Performance): random-vs-random games on one core, in-place mode,
// no invariant checks. R runs of N games, each timed in blocks of B games; prints the median
// per-block games/sec/core with its order-statistic 95 percent interval (n = blocks, as the match
// CLI does), and p50 and p95 game length in moves with the same kind of interval (n = games). A
// quantile whose interval cannot reach 95 percent is not printed as a number (fmtQuantile).
//
// Usage: node --import tsx src/tools/bench.ts [--games N] [--runs R] [--block B] [--pool test|extended|decks|sideboard]
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../test/helpers.js';
import { randomAgent } from '../agents/random.js';
import { playGame } from './play.js';
import { agentSeedsFor, poolDecks, type PoolName } from './fuzz.js';
import { fmtQuantile, quantileInterval } from '../sim/stats.js';

/** One run: its wall seconds, the games/sec of each timed block of games, and each game's move count. */
export interface BenchRun { games: number; seconds: number; blockRates: number[]; moves: number[] }

export function benchRun(games: number, pool: PoolName, seed: number, block = 100): BenchRun {
  if (!(Number.isSafeInteger(block) && block >= 1)) throw new Error(`bench: block must be an integer >= 1, got ${block}`);
  const [a, b] = poolDecks(pool);
  const moves: number[] = [];
  const blockRates: number[] = [];
  const t0 = performance.now();
  let tb = t0;
  for (let i = 0; i < games; i++) {
    const s = seed + i;
    const as = agentSeedsFor(s);
    const r = playGame(a, b, s, [randomAgent(as[0]), randomAgent(as[1])], as);
    moves.push(r.moves.length);
    const done = i + 1;
    if (done % block === 0 || done === games) {
      const now = performance.now();
      const size = done % block === 0 ? block : done % block;
      blockRates.push(size / Math.max((now - tb) / 1000, 1e-9));
      tb = now;
    }
  }
  const seconds = (performance.now() - t0) / 1000;
  return { games, seconds, blockRates, moves };
}

/** The summary lines: the per-block speed and the game length, each with its interval and n. */
export function benchSummary(results: readonly BenchRun[], block: number): string[] {
  const rates = results.flatMap((r) => r.blockRates);
  const moves = results.flatMap((r) => r.moves);
  const games = results.reduce((t, r) => t + r.games, 0);
  const speed = fmtQuantile(quantileInterval(rates, 0.5), { digits: 1, unit: 'blocks', note: `blocks of up to ${block} games, ${results.length} runs, one core` });
  const len = (q: number): string => fmtQuantile(quantileInterval(moves, q), { unit: 'games' });
  return [
    `  games/sec/core  median ${speed}`,
    `  moves per game  p50 ${len(0.5)}  p95 ${len(0.95)}`,
    `  total           ${games} games in ${results.length} runs (counts, not estimates)`,
  ];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const games = Number(arg('--games') ?? 10000);
  const runs = Number(arg('--runs') ?? 5);
  const block = Number(arg('--block') ?? 100);
  const pool = (arg('--pool') ?? 'test') as PoolName;
  const results: BenchRun[] = [];
  for (let r = 0; r < runs; r++) {
    const run = benchRun(games, pool, 1 + r * games, block);
    results.push(run);
    console.log(`run ${r + 1}/${runs}: ${run.games} games in ${run.seconds.toFixed(2)} s wall, ${run.blockRates.length} timed blocks (one run, a measurement, not an estimate)`);
  }
  console.log(`bench pool=${pool} machine=${cpus()[0]?.model ?? 'unknown'} node=${process.version}`);
  for (const l of benchSummary(results, block)) console.log(l);
}
