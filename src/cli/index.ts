// Command-line entry (PLAN.md section 8, Phase 5 CLI; the match command lands in Phase 2).
//
//   node --import tsx src/cli/index.ts match --a greedy --b random --games 2000 --seed 1 --workers 8 --play alternate [--json]
//   node dist/cli/index.js match ...        (after npm run build)
//   scripts/match.ps1 --a greedy --b random --games 2000
//
// Deck A (Rakdos Midrange) is always side A, deck B (Mono-Red Aggro) side B. Every printed number
// carries its sample size and a 95 percent interval. Win rates reflect the agents' heuristic play,
// not perfect play.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultWorkers, runMatch, type MatchReport } from '../sim/runner.js';
import { DEFAULT_KEY_CARDS, type MatchJob, type PlayMode } from '../sim/games.js';
import { fmtMean, fmtPct, fmtQuantile, type QuantileCI } from '../sim/stats.js';
import type { AgentKind } from '../agents/types.js';
import { HAND_USAGE, handCommand } from './hand.js';
import { SPOT_USAGE, spotCommand } from './spot.js';
import { COMMON_HELP, UsageError, checkFlags, wantsHelp } from './args.js';
import { validationNote } from './validation.js';
import { MCTS_UCT, MCTS_VALIDATED, type MctsMode } from '../agents/mcts-agent.js';
import { fmtLogStats, runLogged } from '../tools/selfplay-log.js';

export const MATCH_USAGE = `usage: match --a random|greedy|mcts --b random|greedy|mcts [--games N] [--seed S] [--workers W] [--play A|B|alternate|random] [--check] [--json] [--log path.jsonl[.gz]]
            [--mode validated|uct] [--samples D] [--iterations I | --ms M] [--rollout truncated|full] [--turns K] [--policy fast|greedy] [--prune K] [--prune-depth P] [--margin M] [--override Z] [--min-gain G] [--block-size G]
  Plays N games between two computer players and prints each side's win rate with n and a 95 percent interval.
  A is Rakdos Midrange (decks/deckA.json), B is Mono-Red Aggro (decks/deckB.json). Both default to greedy; --games defaults to 1000.
  mcts is the ISMCTS agent (src/agents/mcts-agent.ts). --mode validated (default) is the agent that beat greedy in the Phase 4
  acceptance run (docs/ACCEPTANCE.md): 8 samples x 3 iterations per decision, greedy rollouts cut after 2 turns, greedy top-3 pruning
  at the root, margin 3, override 2 with min gain 0.02. --mode uct is the plain UCT search (4 samples x 50 iterations, fast rollouts,
  no pruning, the most visited move), not validated against greedy. A note on stderr (the validation field with --json) says which.
  Every flag below replaces the mode's value:
  --ms gives a wall-clock budget per decision instead of iterations (results then depend on the machine).
  --policy is the rollout policy (fast: rollout.ts; greedy: the greedy agent for both players); --prune K keeps greedy's top K moves at tree nodes above depth P (--prune-depth, default 1: the root only; 0: all moves).
  --margin M plays greedy's move without a search when greedy scores it at least M evaluation points above its second choice.
  --override Z plays greedy's move unless a searched move beats it on paired per-sample values by more than Z standard errors and by at least --min-gain in value.
  --mcts-samples, --mcts-iterations and --mcts-turns are older spellings of --samples, --iterations and --turns.
  --block-size is the games per scheduling and seeding block (default 25; a seed gives the same games for any worker count, not for another block size).
  --log writes one JSON line per decision and one per game end (docs/JSONL-SCHEMA.md; gzip when the path ends in .gz).
  --check runs the fuzz invariants after every move.
${COMMON_HELP}`;
const USAGE = MATCH_USAGE;

/** The match command's flags beyond the common ones (src/cli/args.ts). */
export const MATCH_VALUE_FLAGS = ['--a', '--b', '--games', '--play', '--log', '--mode', '--samples', '--mcts-samples', '--iterations', '--mcts-iterations', '--ms', '--rollout', '--turns', '--mcts-turns', '--policy', '--prune', '--prune-depth', '--margin', '--override', '--min-gain', '--block-size'] as const;
export const MATCH_SWITCHES = ['--check'] as const;

export interface MatchArgs {
  a: AgentKind; b: AgentKind; games: number; seed: number; workers: number; play: PlayMode; json: boolean; check: boolean;
  /** ISMCTS budget for an 'mcts' side (iterations absent when ms is given). */
  mcts: { mode: MctsMode; samples: number; iterations?: number; ms?: number; rollout: 'truncated' | 'full'; rolloutTurns: number; policy: 'fast' | 'greedy'; prune: number; pruneDepth: number; margin?: number; override?: number; minGain?: number };
  /** Games per runner block. */
  blockSize: number;
  /** Phase 6 decision log path (src/tools/selfplay-log.ts). */
  log?: string;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new UsageError(`${name} needs a value\n${USAGE}`);
  return v;
}

function intFlag(argv: readonly string[], name: string, dflt: number, min: number): number {
  const v = flag(argv, name);
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min) throw new UsageError(`${name} must be an integer >= ${min}, got ${v}`);
  return n;
}

export function parseMatchArgs(argv: readonly string[]): MatchArgs {
  const kind = (name: string): AgentKind => {
    const v = flag(argv, name) ?? 'greedy';
    if (v !== 'random' && v !== 'greedy' && v !== 'mcts') throw new UsageError(`${name} must be random, greedy or mcts, got ${v}\n${USAGE}`);
    return v;
  };
  const modeRaw = flag(argv, '--mode') ?? 'validated';
  if (modeRaw !== 'validated' && modeRaw !== 'uct') throw new UsageError(`--mode must be validated or uct, got ${modeRaw}`);
  const mode: MctsMode = modeRaw;
  const preset: { samples: number; iterations: number; rolloutTurns: number; policy: 'fast' | 'greedy'; prune: number; margin?: number; override?: number; minGain?: number } = mode === 'uct' ? MCTS_UCT : MCTS_VALIDATED;
  const play = (flag(argv, '--play') ?? 'alternate') as PlayMode;
  const rollout = flag(argv, '--rollout') ?? 'truncated';
  if (rollout !== 'truncated' && rollout !== 'full') throw new UsageError(`--rollout must be truncated or full, got ${rollout}`);
  const either = (name: string, old: string, dflt: number): number => (argv.includes(name) ? intFlag(argv, name, dflt, 1) : intFlag(argv, old, dflt, 1));
  const msRaw = flag(argv, '--ms');
  const ms = msRaw === undefined ? undefined : intFlag(argv, '--ms', 1, 1);
  if (ms !== undefined && (argv.includes('--iterations') || argv.includes('--mcts-iterations'))) throw new UsageError('give --iterations or --ms, not both');
  const samples = either('--samples', '--mcts-samples', preset.samples);
  const policy = flag(argv, '--policy') ?? preset.policy;
  if (policy !== 'fast' && policy !== 'greedy') throw new UsageError(`--policy must be fast or greedy, got ${policy}`);
  const prune = intFlag(argv, '--prune', preset.prune, 0);
  const pruneDepth = intFlag(argv, '--prune-depth', 1, 1);
  const marginRaw = flag(argv, '--margin');
  const margin = marginRaw === undefined ? preset.margin : Number(marginRaw);
  if (margin !== undefined && !(margin >= 0)) throw new UsageError(`--margin must be a number >= 0, got ${marginRaw}`);
  const ovRaw = flag(argv, '--override');
  const override = ovRaw === undefined ? preset.override : Number(ovRaw);
  if (override !== undefined && !(override >= 0)) throw new UsageError(`--override must be a number >= 0, got ${ovRaw}`);
  const mgRaw = flag(argv, '--min-gain');
  const minGain = mgRaw === undefined ? preset.minGain : Number(mgRaw);
  if (minGain !== undefined && !(minGain >= 0)) throw new UsageError(`--min-gain must be a number >= 0, got ${mgRaw}`);
  const extra = { ...(margin === undefined ? {} : { margin }), ...(override === undefined ? {} : { override }), ...(minGain === undefined ? {} : { minGain }) };
  const rolloutTurns = either('--turns', '--mcts-turns', preset.rolloutTurns);
  const logPath = flag(argv, '--log');
  if (!['A', 'B', 'alternate', 'random'].includes(play)) throw new UsageError(`--play must be A, B, alternate or random, got ${play}`);
  return {
    a: kind('--a'), b: kind('--b'),
    games: intFlag(argv, '--games', 1000, 1),
    seed: intFlag(argv, '--seed', 1, Number.MIN_SAFE_INTEGER),
    workers: intFlag(argv, '--workers', defaultWorkers(), 0),
    play, json: argv.includes('--json'), check: argv.includes('--check'),
    mcts: ms === undefined
      ? { mode, samples, iterations: either('--iterations', '--mcts-iterations', preset.iterations), rollout, rolloutTurns, policy, prune, pruneDepth, ...extra }
      : { mode, samples, ms, rollout, rolloutTurns, policy, prune, pruneDepth, ...extra },
    blockSize: intFlag(argv, '--block-size', 25, 1),
    ...(logPath === undefined ? {} : { log: logPath }),
  };
}

/** Per-block games/sec/core: median with its order-statistic interval, n in blocks (not shown below 95 percent coverage). */
export function fmtSpeed(q: QuantileCI): string {
  return `median ${fmtQuantile(q, { digits: 2, after: ' games/sec/core', unit: 'blocks', note: 'one worker thread per block' })}`;
}

/** The MCTS budget in words (for reports). */
export function fmtMctsBudget(m: MatchArgs['mcts']): string {
  const per = m.ms === undefined ? `${m.samples} samples x ${m.iterations ?? 50} iterations` : `${m.samples} samples, ${m.ms} ms`;
  return `${m.mode === 'uct' ? 'uct mode, ' : ''}${per} per decision, ${m.policy} rollouts ${m.rollout === 'full' ? 'played to the end' : `cut after ${m.rolloutTurns} turns`}${m.prune > 0 ? `, greedy top-${m.prune} pruning ${m.pruneDepth === 1 ? 'at the root' : `above depth ${m.pruneDepth}`}` : ''}${m.margin !== undefined ? `, greedy's move unsearched when it leads by ${m.margin} or more` : ''}${m.override !== undefined ? `, greedy's move overridden only by a paired lead above ${m.override} standard errors and at least ${m.minGain ?? 0.02}` : ''}`;
}

export function formatReport(r: MatchReport, a: MatchArgs): string {
  const lines = [
    `match: A = Rakdos Midrange (${a.a}) vs B = Mono-Red Aggro (${a.b}), seed ${a.seed}, play ${a.play}`,
    ...(a.a === 'mcts' || a.b === 'mcts' ? [`mcts budget: ${fmtMctsBudget(a.mcts)}`] : []),
    `games: n=${r.games} (${r.decisions} agent decisions checked legal${r.invariantChecks ? `, ${r.invariantChecks} invariant checks` : ''})`,
    `A win rate: ${fmtPct(r.winA)}`,
    `  on the play: ${fmtPct(r.winAOnPlay)}   on the draw: ${fmtPct(r.winAOnDraw)}`,
    `B win rate: ${fmtPct(r.winB)}`,
    `draws: ${fmtPct(r.draws)}`,
    `game length, turns (both players): mean ${fmtMean(r.turns.mean)}; median ${fmtQuantile(r.turns.median)}; p95 ${fmtQuantile(r.turns.p95)}`,
    `kill turn (winner's own turns): A ${fmtMean(r.killTurnA)}; B ${fmtMean(r.killTurnB)}`,
    ...r.keyCards.map((k) => `${k.label}: ${fmtPct(k.p)}`),
    `speed: ${fmtSpeed(r.speed)} (${r.games} games in ${r.seconds.toFixed(1)} s wall on ${r.workers} worker${r.workers === 1 ? '' : 's'})`,
    'Win rates reflect the heuristic agents named above, not perfect play.',
  ];
  return lines.join('\n');
}

export async function matchCommand(argv: readonly string[]): Promise<MatchReport> {
  checkFlags(argv, MATCH_VALUE_FLAGS, MATCH_SWITCHES, USAGE);
  const a = parseMatchArgs(argv);
  const note = a.a === 'mcts' || a.b === 'mcts' ? validationNote(a.mcts.mode, a.mcts) : null;
  if (note !== null && !a.json) console.error(note);
  const job: MatchJob = {
    deckA: 'deckA', deckB: 'deckB', agentA: { kind: a.a, mcts: a.mcts }, agentB: { kind: a.b, mcts: a.mcts }, play: a.play,
    keyCards: [...DEFAULT_KEY_CARDS], check: a.check,
  };
  const opts = { games: a.games, seed: a.seed, workers: a.workers, blockSize: a.blockSize };
  const logged = a.log === undefined ? null : await runLogged(job, opts, a.log);
  const r = logged ? logged.report : await runMatch(job, opts);
  if (a.json) {
    const { perGame: _perGame, gamesPerSecPerCore: _wallRate, ...rest } = r; // the wall-clock rate has no interval; speed carries one
    console.log(JSON.stringify({ args: a, ...rest, ...(logged ? { log: logged.log } : {}), ...(note !== null ? { validation: note } : {}) }, null, 2));
  } else {
    console.log(formatReport(r, a));
    if (logged) console.log(fmtLogStats(logged.log));
  }
  return r;
}

const COMMANDS: Record<string, { usage: string; run: (argv: readonly string[]) => Promise<unknown> }> = {
  hand: { usage: HAND_USAGE, run: handCommand },
  spot: { usage: SPOT_USAGE, run: spotCommand },
  match: { usage: MATCH_USAGE, run: matchCommand },
};

export const OVERVIEW = `usage: node dist/cli/index.js hand|spot|match [flags]   (or scripts/hand.ps1, scripts/spot.ps1, scripts/match.ps1)
  hand   keep or mulligan an opening hand of deck A (Rakdos Midrange)
  spot   search one position seen by one player (a spot file, docs/SPOT-FORMAT.md)
  match  play N games between two computer players
  node dist/cli/index.js <command> --help   the command's flags`;

/**
 * Runs one command line; returns the exit code: 0 done, 2 bad input (a UsageError: the message,
 * naming the problem, goes to stderr). Any other error propagates (the process exits 1).
 */
export async function main(argv: readonly string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    if (cmd === undefined) { console.error(OVERVIEW); return 2; }
    console.log(`${OVERVIEW}\n\n${HAND_USAGE}\n\n${SPOT_USAGE}\n\n${MATCH_USAGE}`);
    return 0;
  }
  const c = Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : undefined;
  if (c === undefined) { console.error(`unknown command ${cmd}\n${OVERVIEW}`); return 2; }
  if (wantsHelp(rest)) { console.log(c.usage); return 0; }
  try {
    await c.run(rest);
    return 0;
  } catch (e) {
    if (e instanceof UsageError) { console.error(`${cmd}: ${e.message}`); return 2; }
    throw e;
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
