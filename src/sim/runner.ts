// Parallel match runner (PLAN.md section 6, Parallel simulation). Splits N games into fixed-size
// blocks; block b gets the stream seedRng(seed) advanced by b + 1 jump() calls (2^64 steps each),
// so every block, and the aggregate, is the same for any worker count. Workers (worker_threads,
// default os.availableParallelism() - 1) take blocks as they free up; workers = 0 runs in-process.
// The aggregate carries n, the estimate and a 95 percent interval for every number (D18): Wilson
// for proportions, Student t for means, order statistics for the median and p95.
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { cloneRng, jump, seedRng } from '../engine/rng.js';
import { runBlock, type Block, type BlockResult, type GameSummary, type MatchJob } from './games.js';
import { quantileInterval, tInterval, wilson, type MeanCI, type Proportion, type QuantileCI } from './stats.js';

export interface RunOptions {
  games: number;
  seed: number;
  /** Worker threads; 0 plays in this thread. Default os.availableParallelism() - 1. */
  workers?: number;
  /** Games per block (the scheduling and seeding unit). Default 25. */
  blockSize?: number;
}

export interface MatchReport {
  games: number;
  workers: number;
  seconds: number;
  /** total games / (wall seconds x workers), workers counted as 1 in-process (one run, no interval). */
  gamesPerSecPerCore: number;
  /** Sum of the blocks' own seconds (thread time spent playing, all workers; for run-time extrapolation). */
  blockSeconds: number;
  /**
   * Games/sec on one core, one sample per block (block games / block seconds, each block played on
   * one worker thread): the median with its order-statistic 95 percent interval, n = blocks.
   */
  speed: QuantileCI;
  winA: Proportion;
  winB: Proportion;
  draws: Proportion;
  winAOnPlay: Proportion;
  winAOnDraw: Proportion;
  turns: { mean: MeanCI; median: QuantileCI; p95: QuantileCI };
  killTurnA: MeanCI;
  killTurnB: MeanCI;
  keyCards: { label: string; p: Proportion }[];
  decisions: number;
  invariantChecks: number;
  reasons: Record<string, number>;
  /** Per-game summaries in game order (for determinism checks and JSON output). */
  perGame: GameSummary[];
}

export function makeBlocks(games: number, seed: number, blockSize = 25): Block[] {
  if (!Number.isInteger(games) || games < 1) throw new Error(`games must be a positive integer, got ${games}`);
  const master = seedRng(seed);
  const out: Block[] = [];
  for (let first = 0, index = 0; first < games; first += blockSize, index++) {
    jump(master);
    out.push({ index, first, games: Math.min(blockSize, games - first), rng: cloneRng(master) });
  }
  return out;
}

export function defaultWorkers(): number {
  return Math.max(1, availableParallelism() - 1);
}

/** Worker entry and execArgv for this build: worker.ts plus the tsx loader, or worker.js from dist/. */
export function workerSpec(): { url: URL; execArgv: string[] } {
  const self = fileURLToPath(import.meta.url);
  const isTs = self.endsWith('.ts');
  const url = new URL(isTs ? './worker.ts' : './worker.js', import.meta.url);
  const hasTsx = process.execArgv.some((a, i, all) => a.includes('tsx') && (a.startsWith('--import') || all[i - 1] === '--import' || all[i - 1] === '--loader'));
  const execArgv = isTs && !hasTsx ? [...process.execArgv, '--import', 'tsx'] : [...process.execArgv];
  return { url, execArgv };
}

async function runInWorkers(job: MatchJob, blocks: Block[], n: number): Promise<BlockResult[]> {
  const { url, execArgv } = workerSpec();
  const results: BlockResult[] = [];
  const queue = [...blocks];
  const workers: Worker[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      let active = 0;
      let failed = false;
      const feed = (w: Worker): void => {
        const block = queue.shift();
        if (!block) { active--; if (active === 0) resolve(); return; }
        w.postMessage({ job, block });
      };
      for (let k = 0; k < Math.min(n, blocks.length); k++) {
        const w = new Worker(url, { execArgv });
        workers.push(w);
        active++;
        w.on('message', (msg: { result?: BlockResult; error?: string }) => {
          if (failed) return;
          if (msg.error !== undefined || !msg.result) { failed = true; reject(new Error(`worker: ${msg.error ?? 'no result'}`)); return; }
          results.push(msg.result);
          feed(w);
        });
        w.on('error', (e) => { if (!failed) { failed = true; reject(e); } });
        feed(w);
      }
    });
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
  return results;
}

export function aggregate(results: BlockResult[], job: MatchJob, workers: number, seconds: number): MatchReport {
  const perGame = results.sort((a, b) => a.index - b.index).flatMap((r) => r.games);
  const n = perGame.length;
  const count = (f: (g: GameSummary) => boolean): number => perGame.filter(f).length;
  const aWins = count((g) => g.winner === 'A');
  const bWins = count((g) => g.winner === 'B');
  const onPlay = perGame.filter((g) => g.aOnPlay);
  const onDraw = perGame.filter((g) => !g.aOnPlay);
  const turns = perGame.map((g) => g.turns);
  const reasons: Record<string, number> = {};
  for (const g of perGame) reasons[g.reason] = (reasons[g.reason] ?? 0) + 1;
  const keyCards = (job.keyCards ?? []).map((k, j) => ({ label: k.label, p: wilson(count((g) => g.key[j] === true), n) }));
  return {
    games: n,
    workers,
    seconds,
    gamesPerSecPerCore: n / (seconds * Math.max(1, workers)),
    blockSeconds: results.reduce((s, r) => s + r.seconds, 0),
    speed: quantileInterval(results.filter((r) => r.seconds > 0).map((r) => r.games.length / r.seconds), 0.5),
    winA: wilson(aWins, n),
    winB: wilson(bWins, n),
    draws: wilson(n - aWins - bWins, n),
    winAOnPlay: wilson(onPlay.filter((g) => g.winner === 'A').length, onPlay.length),
    winAOnDraw: wilson(onDraw.filter((g) => g.winner === 'A').length, onDraw.length),
    turns: { mean: tInterval(turns), median: quantileInterval(turns, 0.5), p95: quantileInterval(turns, 0.95) },
    killTurnA: tInterval(perGame.filter((g) => g.winner === 'A').map((g) => g.killTurn as number)),
    killTurnB: tInterval(perGame.filter((g) => g.winner === 'B').map((g) => g.killTurn as number)),
    keyCards,
    decisions: results.reduce((s, r) => s + r.decisions, 0),
    invariantChecks: results.reduce((s, r) => s + r.invariantChecks, 0),
    reasons,
    perGame,
  };
}

export async function runMatch(job: MatchJob, opts: RunOptions): Promise<MatchReport> {
  const blocks = makeBlocks(opts.games, opts.seed, opts.blockSize ?? 25);
  const workers = opts.workers ?? defaultWorkers();
  const t0 = performance.now();
  const results = workers === 0 ? blocks.map((b) => runBlock(job, b)) : await runInWorkers(job, blocks, workers);
  const seconds = (performance.now() - t0) / 1000;
  return aggregate(results, job, workers === 0 ? 1 : Math.min(workers, blocks.length), seconds);
}
