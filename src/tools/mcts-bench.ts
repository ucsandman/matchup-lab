// ISMCTS agent speed (PLAN.md section 8, Phase 4; docs/PERF.md): plays G games of the MCTS agent
// against greedy in this thread, the MCTS side alternating A and B, and reports searched decisions
// per second. Each game gives one sample (its searched decisions / the seconds spent searching
// them), so the median carries an order-statistic 95 percent interval with n = games; the pooled
// rate, the rollouts per decision and the wall time per game are printed beside it.
//
// Usage (compiled, as the acceptance run uses it):
//   npm run build
//   node dist/tools/mcts-bench.js [--games G] [--samples D] [--iterations I] [--turns K] [--seed S] [--policy fast|greedy] [--prune K] [--margin M]
// or under tsx: node --import tsx src/tools/mcts-bench.ts ...
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { newGame } from '../engine/setup.js';
import { applyMoveInPlace } from '../engine/apply.js';
import { decider, legalMoves } from '../engine/moves.js';
import { checkedChoice, nextSeed } from '../sim/games.js';
import { fmtQuantile, quantileInterval, tInterval, wilson } from '../sim/stats.js';
import { seedRng } from '../engine/rng.js';
import { greedyAgent } from '../agents/greedy.js';
import { mctsAgent } from '../agents/mcts-agent.js';
import type { Agent } from '../agents/types.js';
import type { PlayerId } from '../engine/types.js';

export interface MctsBenchGame { searched: number; skipped: number; overrides: number; searchSeconds: number; rollouts: number; fallbacks: number; wallSeconds: number; mctsWon: boolean; moves: number }

export function benchGame(
  seed: number, seat: PlayerId,
  opts: { samples: number; iterations: number; turns: number; policy?: 'fast' | 'greedy'; prune?: number; margin?: number; override?: number },
): MctsBenchGame {
  const rng = seedRng(seed);
  const s = newGame('deckA', 'deckB', nextSeed(rng), 'random');
  const mcts = mctsAgent(nextSeed(rng), {
    mode: 'uct', // the flags below are the whole configuration (no validated margin or override unless given)
    samples: opts.samples, iterations: opts.iterations, rolloutTurns: opts.turns, policy: opts.policy ?? 'fast', prune: opts.prune ?? 0,
    ...(opts.margin === undefined ? {} : { margin: opts.margin }), ...(opts.override === undefined ? {} : { override: opts.override }),
  });
  const greedy = greedyAgent(nextSeed(rng));
  const agents: Agent[] = seat === 0 ? [mcts, greedy] : [greedy, mcts];
  const t0 = performance.now();
  let moves = 0;
  while (!s.result) {
    const p = decider(s);
    if (p === null) break;
    applyMoveInPlace(s, checkedChoice(agents[p] as Agent, s, p, legalMoves(s, p), `bench game ${seed}`));
    moves++;
  }
  const st = mcts.stats();
  return {
    searched: st.searched, skipped: st.skipped, overrides: st.overrides, searchSeconds: st.searchSeconds, rollouts: st.rollouts, fallbacks: st.fallbacks,
    wallSeconds: (performance.now() - t0) / 1000, mctsWon: s.result?.winner === seat, moves,
  };
}

function arg(argv: readonly string[], name: string, dflt: number): number {
  const i = argv.indexOf(name);
  if (i < 0) return dflt;
  const n = Number(argv[i + 1]);
  if (!Number.isFinite(n)) throw new Error(`${name} needs a number`);
  return n;
}

function main(argv: readonly string[]): void {
  const games = arg(argv, '--games', 20);
  const policy = argv.includes('--policy') && argv[argv.indexOf('--policy') + 1] === 'greedy' ? 'greedy' as const : 'fast' as const;
  const margin = argv.includes('--margin') ? arg(argv, '--margin', 0) : undefined;
  const override = argv.includes('--override') ? arg(argv, '--override', 0) : undefined;
  const opts = {
    samples: arg(argv, '--samples', 4), iterations: arg(argv, '--iterations', 50), turns: arg(argv, '--turns', 2), policy, prune: arg(argv, '--prune', 0),
    ...(margin === undefined ? {} : { margin }), ...(override === undefined ? {} : { override }),
  };
  const seed = arg(argv, '--seed', 1);
  const out: MctsBenchGame[] = [];
  for (let g = 0; g < games; g++) out.push(benchGame(seed + g, (g % 2) as PlayerId, opts));
  const rates = out.filter((g) => g.searched > 0 && g.searchSeconds > 0).map((g) => g.searched / g.searchSeconds);
  const q = quantileInterval(rates, 0.5);
  const searched = out.reduce((a, g) => a + g.searched, 0);
  const secs = out.reduce((a, g) => a + g.searchSeconds, 0);
  const wall = tInterval(out.map((g) => g.wallSeconds));
  const cpu = cpus()[0]?.model ?? 'unknown CPU';
  console.log(`mcts bench: D=${opts.samples} samples x I=${opts.iterations} iterations per decision, ${opts.policy} rollouts cut after ${opts.turns} turns, prune ${opts.prune}, margin ${opts.margin ?? 'none'}, override ${opts.override ?? 'none'}, vs greedy, ${games} games, one thread (${cpu}, Node ${process.version}, ${fileURLToPath(import.meta.url).endsWith('.js') ? 'compiled' : 'tsx'})`);
  console.log(`searched decisions/sec: median ${fmtQuantile(q, { digits: 2, unit: 'games' })}; pooled ${(searched / secs).toFixed(2)} (${searched} decisions in ${secs.toFixed(1)} s of search)`);
  console.log(`rollouts per searched decision: ${(out.reduce((a, g) => a + g.rollouts, 0) / Math.max(1, searched)).toFixed(0)}; fallback (mid-operation) decisions: ${out.reduce((a, g) => a + g.fallbacks, 0)}; decisions played unsearched by the greedy margin: ${out.reduce((a, g) => a + g.skipped, 0)}; searched decisions where the override played a move other than greedy's: ${out.reduce((a, g) => a + g.overrides, 0)}`);
  const won = wilson(out.filter((g) => g.mctsWon).length, out.length);
  console.log(`MCTS win rate against greedy (a speed run, not the acceptance run): ${(100 * won.est).toFixed(1)}% [95% CI ${(100 * won.lo).toFixed(1)}-${(100 * won.hi).toFixed(1)}%, n=${won.n} games, sides alternating]`);
  console.log(`wall seconds per game (both agents): mean ${wall.mean.toFixed(1)} [95% CI ${wall.lo.toFixed(1)}-${wall.hi.toFixed(1)}, n=${wall.n} games]`);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv.slice(2));
