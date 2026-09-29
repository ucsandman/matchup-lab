// Phase 4 acceptance run (PLAN.md section 8, Phase 4 gate): the MCTS agent against greedy, 1,000
// games with MCTS as A (Rakdos Midrange) and 1,000 with MCTS as B (Mono-Red Aggro), each side
// compared with the greedy-vs-greedy baseline for that side by a two-proportion z-test. Before the
// run it plays a pilot (default 50 games, half per side), extrapolates the wall time of the full
// run from the pilot's thread seconds per game and prints the plan; with --max-hours it stops
// there when the estimate is over.
//
// Usage (compiled, 23 workers on this machine):
//   npm run build
//   node dist/tools/acceptance.js --policy greedy --prune 3 --samples 6 --iterations 3 --margin 3 --games 1000 --seed 4001 --block-size 5
//   [--pilot 50] [--pilot-only] [--max-hours 2] [--baseline-a 465/1000] [--baseline-b 535/1000] [--workers W] [--json FILE]
// The MCTS flags are the match command's (src/cli/index.ts). The baselines default to the Phase 2
// greedy-vs-greedy gate numbers in CHANGELOG.md (A 465 of 1000, B 535 of 1000). Every number is
// printed with its n and a 95 percent interval; the z-test is two-sided and a side passes when MCTS
// is ahead and p < 0.01. Win rates reflect heuristic play, not perfect play.
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { parseMatchArgs, fmtMctsBudget, fmtSpeed, type MatchArgs } from '../cli/index.js';
import { runMatch, type MatchReport } from '../sim/runner.js';
import { DEFAULT_KEY_CARDS, type GameSummary, type MatchJob } from '../sim/games.js';
import { fmtPct, twoProportionZ, wilson, type Proportion, type ZTest } from '../sim/stats.js';
import type { Side } from '../sim/games.js';

export const ALPHA = 0.01;
/** Phase 2 gate, greedy vs greedy, n = 1000 (CHANGELOG.md): wins of the greedy agent on each side. */
export const BASELINE: Record<Side, { k: number; n: number }> = { A: { k: 465, n: 1000 }, B: { k: 535, n: 1000 } };

export interface SideResult {
  side: Side;
  n: number;
  mcts: Proportion;
  greedy: Proportion;
  draws: Proportion;
  baseline: Proportion;
  z: ZTest;
  pass: boolean;
  speed: string;
  seconds: number;
  blockSeconds: number;
  decisions: number;
  /** Per-game summaries in game order (written with --json, so any slice of the run can be checked later). */
  perGame: GameSummary[];
}

export function job(side: Side, mcts: MatchArgs['mcts'], check = false): MatchJob {
  const m = { kind: 'mcts' as const, mcts };
  const g = { kind: 'greedy' as const };
  return { deckA: 'deckA', deckB: 'deckB', agentA: side === 'A' ? m : g, agentB: side === 'A' ? g : m, play: 'alternate', keyCards: [...DEFAULT_KEY_CARDS], check };
}

/** One side's line of the acceptance table from its match report. */
export function sideResult(side: Side, r: MatchReport, base: { k: number; n: number }): SideResult {
  const mcts = side === 'A' ? r.winA : r.winB;
  const greedy = side === 'A' ? r.winB : r.winA;
  const z = twoProportionZ(mcts.k, mcts.n, base.k, base.n);
  return {
    side, n: r.games, mcts, greedy, draws: r.draws, baseline: z.b, z, pass: z.diff > 0 && z.p < ALPHA,
    speed: fmtSpeed(r.speed), seconds: r.seconds, blockSeconds: r.blockSeconds, decisions: r.decisions,
    perGame: r.perGame,
  };
}

export function fmtP(p: number): string {
  return p < 1e-4 ? p.toExponential(2) : p.toFixed(4);
}

export function formatSide(s: SideResult): string {
  const deck = s.side === 'A' ? 'Rakdos Midrange' : 'Mono-Red Aggro';
  return [
    `MCTS as ${s.side} (${deck}) vs greedy: n=${s.n} games (${s.decisions} decisions checked legal)`,
    `  MCTS win rate:   ${fmtPct(s.mcts)}`,
    `  greedy win rate: ${fmtPct(s.greedy)}`,
    `  draws:           ${fmtPct(s.draws)}`,
    `  baseline, greedy as ${s.side} vs greedy: ${fmtPct(s.baseline)}`,
    `  two-proportion z-test against the baseline: diff ${(100 * s.z.diff).toFixed(1)} points, z = ${s.z.z.toFixed(2)}, two-sided p = ${fmtP(s.z.p)}: ${s.pass ? `PASS (MCTS ahead, p < ${ALPHA})` : `FAIL (needs MCTS ahead with p < ${ALPHA})`}`,
    `  speed: ${s.speed}`,
    `  elapsed: ${(s.seconds / 60).toFixed(1)} min wall; ${s.blockSeconds.toFixed(0)} thread seconds, ${(s.blockSeconds / s.n).toFixed(1)} per game`,
  ].join('\n');
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i < 0 ? undefined : argv[i + 1];
}

function baselineFlag(argv: readonly string[], name: string, dflt: { k: number; n: number }): { k: number; n: number } {
  const v = flag(argv, name);
  if (v === undefined) return dflt;
  const m = /^(\d+)\/(\d+)$/.exec(v);
  if (!m || Number(m[1]) > Number(m[2]) || Number(m[2]) < 1) throw new Error(`${name} must be wins/games, got ${v}`);
  return { k: Number(m[1]), n: Number(m[2]) };
}

async function main(argv: readonly string[]): Promise<number> {
  const a = parseMatchArgs(argv);
  const pilot = Number(flag(argv, '--pilot') ?? 50);
  const maxHours = flag(argv, '--max-hours') === undefined ? undefined : Number(flag(argv, '--max-hours'));
  const base: Record<Side, { k: number; n: number }> = { A: baselineFlag(argv, '--baseline-a', BASELINE.A), B: baselineFlag(argv, '--baseline-b', BASELINE.B) };
  const jsonOut = flag(argv, '--json');
  const cpu = cpus()[0]?.model ?? 'unknown CPU';
  const build = fileURLToPath(import.meta.url).endsWith('.js') ? 'compiled' : 'tsx';
  console.log(`acceptance: MCTS (${fmtMctsBudget(a.mcts)}) vs greedy, ${a.games} games per side, seed ${a.seed}, block size ${a.blockSize}, ${a.workers} workers (${cpu}, ${cpus().length} logical, Node ${process.version}, ${build})`);
  console.log(`baselines (greedy vs greedy): A ${fmtPct(wilson(base.A.k, base.A.n))}; B ${fmtPct(wilson(base.B.k, base.B.n))}`);
  const t0 = performance.now();
  let plan = { perGame: NaN, hours: NaN };
  if (pilot > 0) {
    const half = Math.max(1, Math.round(pilot / 2));
    const opts = { games: half, workers: a.workers, blockSize: 1 };
    const pa = await runMatch(job('A', a.mcts), { ...opts, seed: a.seed + 100000 });
    const pb = await runMatch(job('B', a.mcts), { ...opts, seed: a.seed + 200000 });
    const games = pa.games + pb.games;
    const perGame = (pa.blockSeconds + pb.blockSeconds) / games;
    const hours = (2 * a.games * perGame) / Math.max(1, a.workers) / 3600;
    plan = { perGame, hours };
    const pw = (x: MatchReport, side: Side): string => fmtPct(side === 'A' ? x.winA : x.winB);
    console.log(`pilot: ${games} games (${pa.games} with MCTS as A, ${pb.games} as B, seeds ${a.seed + 100000} and ${a.seed + 200000}) in ${((pa.seconds + pb.seconds) / 60).toFixed(1)} min wall; ${perGame.toFixed(1)} thread seconds per game (one run, no interval)`);
    console.log(`pilot MCTS win rate: as A ${pw(pa, 'A')}; as B ${pw(pb, 'B')} (a pilot, not the acceptance result)`);
    console.log(`plan: ${2 * a.games} games x ${perGame.toFixed(1)} thread seconds / ${a.workers} workers = about ${hours.toFixed(2)} h of wall time (an extrapolation from the pilot; the pilot's blocks of 1 game keep all workers busy, the run's tail may add a few minutes)`);
    if (maxHours !== undefined && hours > maxHours) {
      console.log(`plan over --max-hours ${maxHours}: not running. Lower the budget and pilot again.`);
      return 3;
    }
  }
  if (argv.includes('--pilot-only')) return 0;
  const results: SideResult[] = [];
  for (const side of ['A', 'B'] as const) {
    const r = await runMatch(job(side, a.mcts, a.check), { games: a.games, seed: side === 'A' ? a.seed : a.seed + 1, workers: a.workers, blockSize: a.blockSize });
    const s = sideResult(side, r, base[side]);
    results.push(s);
    console.log(formatSide(s));
  }
  const total = (performance.now() - t0) / 1000;
  const pass = results.every((s) => s.pass);
  console.log(`total elapsed (pilot and both sides): ${(total / 60).toFixed(1)} min`);
  console.log(`verdict: ${pass ? 'PASS' : 'FAIL'}: MCTS ${pass ? 'beats' : 'does not beat'} greedy at p < ${ALPHA} on both sides (${results.filter((s) => s.pass).length} of ${results.length} sides pass)`);
  console.log('Win rates reflect the heuristic agents named above, not perfect play.');
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ args: a, plan, baselines: base, results, totalSeconds: total, cpu, logical: cpus().length, node: process.version, build }, null, 2));
  return pass ? 0 : 1;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
