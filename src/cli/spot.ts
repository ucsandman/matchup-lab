// The spot command (PLAN.md section 8, Phase 4; src/agents/ismcts.ts does the work):
//
//   node --import tsx src/cli/index.ts spot --file spots/example.json [--player A|B] [--samples D]
//        [--iterations I | --ms MS] [--rollout truncated|full] [--turns K] [--seed S] [--workers W] [--top N] [--json]
//   node dist/cli/index.js spot --file spots/example.json        (after npm run build)
//   scripts/spot.ps1 --file spots/example.json
//
// The spot file format is docs/SPOT-FORMAT.md. Prints the top lines (root moves, most visited
// first) with the win-rate estimate, its Wilson interval and the number of rollouts behind it, the
// mean rollout value with its standard error, and the principal variation; then the totals and the
// two limits every report states.
//
// Two modes (PLAN.md D27). The default, validated, runs the search of the agent that beat greedy in
// the Phase 4 acceptance run (docs/ACCEPTANCE.md; src/agents/mcts-agent.ts MCTS_VALIDATED): greedy
// rollouts, root pruning to greedy's top 3, 8 samples x 3 iterations, and it names the move that agent
// would play (greedy's move unless the paired override finds a clear gain; unsearched when greedy
// leads by the margin). --mode uct is the deeper plain UCT search (8 samples x 400 iterations, fast
// rollouts over every legal move), which was not validated against greedy; a note on stderr says so.
import { readFileSync } from 'node:fs';
import { readSpotFile, SpotError, type LoadedSpot } from '../tools/spot-schema.js';
import { defaultSearchWorkers, knownIds, moveKey, searchViewParallel, type LineStep, type SearchOptions, type SearchResult } from '../agents/ismcts.js';
import { DeterminizeError, prepareDeterminizer, type Determinizer } from '../agents/determinize.js';
import { greedyAgent, type GreedyAgent } from '../agents/greedy.js';
import { legalMoves } from '../engine/moves.js';
import { greedyFirstChoice, MCTS_VALIDATED, pairedOverride, type MctsMode, type PairedGain } from '../agents/mcts-agent.js';
import { seedRng } from '../engine/rng.js';
import { fmtPct, tInterval, tQuantile, wilson, type MeanCI, type Proportion } from '../sim/stats.js';
import type { ObjId, PlayerId } from '../engine/types.js';
import type { PlayerView } from '../engine/view.js';
import { COMMON_HELP, UsageError, checkFlags } from './args.js';
import { validationNote } from './validation.js';

export const SPOT_USAGE = `usage: spot --file spot.json [--mode validated|uct] [--player A|B] [--samples D] [--iterations I | --ms MS]
            [--rollout truncated|full] [--turns K] [--seed S] [--workers W] [--top N] [--json]
  Searches one position seen by one player. The file format is docs/SPOT-FORMAT.md (example: spots/example.json).
  --mode validated (default): the search of the agent that beat greedy in the Phase 4 acceptance run (docs/ACCEPTANCE.md):
    8 samples x 3 iterations, greedy rollouts cut after 2 turns, greedy top-3 pruning at the root; it names the move that agent
    plays (greedy's move unsearched when it leads by 3 evaluation points, else greedy's move unless another move's paired gain
    is above 2 standard errors and at least 0.02).
  --mode uct: the deeper plain UCT search (8 samples x 400 iterations, fast rollouts over every legal move, most visited first).
    Not validated against greedy; a note on stderr (the validation field with --json) gives the numbers.
  --player picks whose win rate is shown (default: the spot's viewer). --samples: determinized deals of the hidden cards;
  --iterations: searches per sample; --ms: a time budget for the whole search instead (results then depend on the machine);
  --turns: rollout length in turns (default 2); --top: root moves shown (default 5). Changing any of these in validated mode
  leaves the validated settings, and the note says so.
${COMMON_HELP}`;

/** The spot command's flags beyond the common ones (src/cli/args.ts). */
export const SPOT_VALUE_FLAGS = ['--file', '--mode', '--player', '--samples', '--iterations', '--ms', '--rollout', '--turns', '--top'] as const;
export const SPOT_SWITCHES = [] as const;

/** The two modes' defaults (MCTS_VALIDATED is the acceptance agent; the uct values are the Phase 4 spot defaults). */
export const SPOT_MODES = {
  validated: { samples: MCTS_VALIDATED.samples, iterations: MCTS_VALIDATED.iterations, policy: MCTS_VALIDATED.policy, prune: MCTS_VALIDATED.prune, margin: MCTS_VALIDATED.margin, override: MCTS_VALIDATED.override, minGain: MCTS_VALIDATED.minGain },
  uct: { samples: 8, iterations: 400, policy: 'fast', prune: 0 },
} as const;

export const HEURISTIC_SENTENCE = 'Win rates reflect heuristic play, not perfect play.';
export const DETERMINIZATION_SENTENCE = 'The search samples hidden cards; it can act as if it knew cards the player has not seen.';

export interface SpotArgs {
  file: string; player: PlayerId | null; samples: number; iterations: number | null; ms: number | null;
  rollout: 'truncated' | 'full'; turns: number; seed: number; workers: number; top: number; json: boolean;
  /** Search mode (absent: a plain search with the policy and prune given, fast and 0 when absent). */
  mode?: MctsMode;
  policy?: 'fast' | 'greedy';
  prune?: number;
  /** Validated mode's skip margin, override z and minimum gain (absent in uct mode). */
  margin?: number;
  override?: number;
  minGain?: number;
}

/** The move the validated agent plays from this spot, and why (validated mode only). */
export interface SpotRecommendation {
  /** Root-move key and text; null when there is nothing to recommend (see reason). */
  key: string | null;
  text: string | null;
  reason: string;
  /**
   * Greedy's first choice on the agent's own determinized sample and, on that sample, its lead over
   * greedy's second choice in evaluation points (the value the margin step compares; one sample).
   * onSamples: the same move over n samples of the agent's stream, the first being the agent's own:
   * how often greedy picks it (Wilson interval) and its mean lead over greedy's best other move
   * (t interval) on the samples where it is legal and not the only legal move.
   */
  greedy: { key: string; text: string; lead: number; legalMoves: number; onSamples: GreedyOnSamples } | null;
  /** Each searched root move's paired gain over greedy's move, with a 95 percent t interval over the n samples that have both. */
  gains: (PairedGain & { text: string; lo: number; hi: number })[];
}

/** Greedy's view of one move over several samples (see SpotRecommendation.greedy). */
export interface GreedyOnSamples { samples: number; first: Proportion; lead: MeanCI; onlyMove: number; notLegal: number }

/**
 * Greedy's first choice and the lead of the move 'key' over greedy's best other move, on n samples
 * drawn in turn from seedRng(seed): the first is the sample greedyFirstChoice deals (the validated
 * agent's own), so onSamples.lead covers the one-sample lead the margin step uses.
 */
export function greedyOnSamples(v: PlayerView, det: Determinizer, seed: number, me: PlayerId, greedy: GreedyAgent, known: ReadonlySet<ObjId>, key: string, n: number): GreedyOnSamples {
  const rng = seedRng(seed);
  const leads: number[] = [];
  let first = 0;
  let onlyMove = 0;
  let notLegal = 0;
  for (let i = 0; i < n; i++) {
    const s = det.sample(rng);
    const sm = legalMoves(s, me);
    const sc = greedy.explain({ player: me, moves: sm, view: () => v, sample: () => s }).map((x) => x.score);
    let bi = 0;
    sc.forEach((x, j) => { if (x > (sc[bi] as number)) bi = j; });
    const keys = sm.map((m) => moveKey(m, known, s.objects));
    if (keys[bi] === key) first++;
    const k = keys.indexOf(key);
    if (k < 0) { notLegal++; continue; }
    if (sm.length === 1) { onlyMove++; continue; }
    leads.push((sc[k] as number) - Math.max(...sc.filter((_, j) => j !== k)));
  }
  return { samples: n, first: wilson(first, n), lead: tInterval(leads), onlyMove, notLegal };
}

/** The greedy lines of a validated spot report: the agent's move and margin test, then the same move over the samples with intervals. */
export function greedyLines(g: NonNullable<SpotRecommendation['greedy']>, margin: number | undefined): string[] {
  const on = g.onSamples;
  const test = !Number.isFinite(g.lead)
    ? 'its only legal move'
    : margin === undefined ? 'the margin step is off' : `${g.lead >= margin ? 'at least' : 'less than'} the margin of ${margin} evaluation points ahead of greedy's second choice`;
  const sign = (x: number): string => `${x >= 0 ? '' : '-'}${Math.abs(x).toFixed(2)}`;
  const lead = Number.isFinite(on.lead.lo)
    ? `mean ${sign(on.lead.mean)} [95% CI ${sign(on.lead.lo)} to ${sign(on.lead.hi)}, t interval, n=${on.lead.n} samples]`
    : `not shown [95% CI undefined, n=${on.lead.n} samples is too few for a t interval]`;
  const skipped = [on.onlyMove ? `${on.onlyMove} where it is the only legal move` : '', on.notLegal ? `${on.notLegal} where it is not legal` : ''].filter(Boolean);
  return [
    `greedy's first choice on the validated agent's own sample: ${g.text} (${test} on that sample; the agent's margin step, a yes or no)`,
    `  over n=${on.samples} samples (the first is the agent's own): greedy picks it in ${fmtPct(on.first)}; its lead over greedy's best other move, in evaluation points: ${lead}${skipped.length ? ` (leaving out ${skipped.join(' and ')})` : ''}`,
  ];
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new UsageError(`${name} needs a value\n${SPOT_USAGE}`);
  return v;
}

function intFlag(argv: readonly string[], name: string, dflt: number, min: number): number {
  const v = flag(argv, name);
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min) throw new UsageError(`${name} must be an integer >= ${min}, got ${v}`);
  return n;
}

export function parseSpotArgs(argv: readonly string[]): SpotArgs {
  const file = flag(argv, '--file');
  if (file === undefined) throw new UsageError(`--file is required\n${SPOT_USAGE}`);
  const modeRaw = flag(argv, '--mode') ?? 'validated';
  if (modeRaw !== 'validated' && modeRaw !== 'uct') throw new UsageError(`--mode must be validated or uct, got ${modeRaw}`);
  const mode: MctsMode = modeRaw;
  const d = SPOT_MODES[mode];
  const pl = flag(argv, '--player');
  let player: PlayerId | null = null;
  if (pl !== undefined) {
    const u = pl.toUpperCase();
    if (u === 'A' || u === '0') player = 0;
    else if (u === 'B' || u === '1') player = 1;
    else throw new UsageError(`--player must be A or B, got ${pl}`);
  }
  const rollout = flag(argv, '--rollout') ?? 'truncated';
  if (rollout !== 'truncated' && rollout !== 'full') throw new UsageError(`--rollout must be truncated or full, got ${rollout}`);
  const ms = flag(argv, '--ms') === undefined ? null : intFlag(argv, '--ms', 0, 1);
  if (ms !== null && flag(argv, '--iterations') !== undefined) throw new UsageError('give --iterations or --ms, not both');
  const samples = intFlag(argv, '--samples', d.samples, 1);
  return {
    mode, policy: d.policy, prune: d.prune,
    ...('margin' in d ? { margin: d.margin, override: d.override, minGain: d.minGain } : {}),
    file, player, samples,
    iterations: ms === null ? intFlag(argv, '--iterations', d.iterations, 1) : null,
    ms, rollout,
    turns: intFlag(argv, '--turns', 2, 1),
    seed: intFlag(argv, '--seed', 1, Number.MIN_SAFE_INTEGER),
    workers: intFlag(argv, '--workers', Math.min(samples, defaultSearchWorkers()), 0),
    top: intFlag(argv, '--top', 5, 1),
    json: argv.includes('--json'),
  };
}

const SIDE = ['A', 'B'] as const;
const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

/** Win estimate with its Wilson interval and n, then the mean value with its t interval and standard error. */
export function fmtStep(s: LineStep): string {
  const win = `win ${pct(s.win.est)} [95% CI ${pct(s.win.lo)}-${pct(s.win.hi)}, n=${s.win.n} rollouts]`;
  const val = Number.isFinite(s.se)
    ? `mean value ${s.mean.toFixed(3)} [95% CI ${s.meanLo.toFixed(3)}-${s.meanHi.toFixed(3)}, t interval, SE ${s.se.toFixed(3)}, n=${s.visits}]`
    : `mean value ${s.mean.toFixed(3)} [no interval below 2 rollouts, n=${s.visits}]`;
  return `${win}; ${val}`;
}

/** A paired gain with its 95 percent t interval over the samples that have both moves. */
export function fmtGain(g: { mean: number; se: number; n: number; lo: number; hi: number }): string {
  const sign = (x: number): string => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
  return `gain ${sign(g.mean)} [95% CI ${sign(g.lo)} to ${sign(g.hi)}, t interval, SE ${g.se.toFixed(3)}, n=${g.n} samples]`;
}

function recommendationLines(rec: SpotRecommendation, a: SpotArgs): string[] {
  const out: string[] = [];
  if (rec.greedy) out.push(...greedyLines(rec.greedy, a.margin));
  out.push(`recommendation: ${rec.text ?? 'none'}: ${rec.reason}`);
  if (rec.gains.length > 0) {
    out.push(`paired gain of each searched move over greedy's move (mean per-sample difference in rollout value; the override needs gain - ${a.override ?? 2} x SE > 0 and gain >= ${a.minGain ?? 0.02}):`);
    for (const g of rec.gains) out.push(`  ${g.text}: ${fmtGain(g)}`);
  }
  return out;
}

export function formatSpotReport(r: SearchResult, a: SpotArgs, note: string | undefined, rec?: SpotRecommendation): string {
  const who = SIDE[r.perspective];
  const budget = a.ms !== null ? `${a.ms} ms` : `${a.iterations} iterations per sample`;
  const policy = a.policy ?? 'fast';
  const prune = a.prune ?? 0;
  const lines = [
    `spot: ${a.file}${note ? ` (${note})` : ''}`,
    ...(a.mode === undefined ? [] : [`mode: ${a.mode === 'validated' ? 'validated (the Phase 4 acceptance agent\'s search; see the note on stderr)' : 'uct (plain UCT search, not validated against greedy; see the note on stderr)'}`]),
    `seen by ${SIDE[r.viewer]}; deciding: ${r.decider === null ? 'nobody (the game is over)' : SIDE[r.decider]}; win rates are for ${who}`,
    `search: ${r.samples} samples, ${budget}, ${policy} rollouts ${a.rollout === 'full' ? 'played to the end' : `truncated after ${a.turns} turns`}${prune > 0 ? `, greedy top-${prune} pruning at the root` : ''}, seed ${a.seed}, ${Math.max(1, Math.min(a.workers, a.samples))} worker${Math.min(a.workers, a.samples) > 1 ? 's' : ''}`,
    ...(rec ? recommendationLines(rec, a) : []),
    `total: ${r.rollouts} rollouts over ${r.samples} samples; ${fmtStep(r.total)}; elapsed ${r.seconds.toFixed(1)} s (one run)`,
    `top ${Math.min(a.top, r.lines.length)} of ${r.lines.length} root moves (most visited first; n = rollouts through the move, summed over the samples):`,
  ];
  r.lines.slice(0, a.top).forEach((l, i) => {
    lines.push(`${i + 1}. ${l.text}`);
    lines.push(`   ${fmtStep(l)}; visits ${l.visits} of ${r.rollouts}, in ${l.samples} of ${r.samples} samples`);
    if (l.pv.length > 0) {
      lines.push('   most visited line after it:');
      for (const s of l.pv) lines.push(`     ${s.text}: ${fmtStep(s)}`);
    }
  });
  lines.push(HEURISTIC_SENTENCE, DETERMINIZATION_SENTENCE);
  return lines.join('\n');
}

/**
 * What the validated agent (src/agents/mcts-agent.ts) plays from this spot: greedy's first choice on
 * one sample of its own (the margin step, drawn from the stream of seedRng(seed), which the samples'
 * jumped streams never reach), then the paired override over the search's root lines. Only for the
 * viewer's own decision: the agent decides for itself.
 */
export function recommend(spot: LoadedSpot, r: SearchResult, a: SpotArgs): SpotRecommendation {
  const none = (reason: string): SpotRecommendation => ({ key: null, text: null, reason, greedy: null, gains: [] });
  if (r.decider === null) return none('the game is over');
  if (r.decider !== spot.view.viewer) return none(`the validated agent decides only for itself, and the decider here is ${SIDE[r.decider]}, not the viewer ${SIDE[spot.view.viewer]}`);
  if (r.lines.length === 0) return none('no root move was searched');
  const v = spot.view;
  const det = prepareDeterminizer(v, spot.decks);
  const known = knownIds(v);
  const gc = greedyFirstChoice(v, det, seedRng(a.seed), r.decider, greedyAgent(a.seed, { name: 'spot-greedy' }), known);
  const textOf = (key: string): string => r.lines.find((l) => l.key === key)?.text ?? key;
  const onSamples = greedyOnSamples(v, det, a.seed, r.decider, greedyAgent(a.seed, { name: 'spot-greedy' }), known, gc.key, a.samples);
  const greedy = { key: gc.key, text: textOf(gc.key), lead: gc.lead, legalMoves: gc.moves, onSamples };
  const top = r.lines[0] as (typeof r.lines)[number];
  if (!r.lines.some((l) => l.key === gc.key)) {
    return { key: top.key, text: top.text, reason: 'greedy\'s move was not among the searched moves, so the agent plays the most visited move', greedy, gains: [] };
  }
  const z = a.override ?? 2;
  const ov = pairedOverride(r.lines, gc.key, z, a.minGain ?? 0.02);
  const gains = (ov?.gains ?? []).map((g) => {
    const half = tQuantile(0.975, g.n - 1) * g.se;
    return { ...g, text: textOf(g.key), lo: g.mean - half, hi: g.mean + half };
  });
  if (a.margin !== undefined && gc.lead >= a.margin) {
    return { key: gc.key, text: greedy.text, reason: `greedy's move, which leads by ${a.margin} or more evaluation points, so the validated agent plays it without a search (the lines below are shown for reference)`, greedy, gains };
  }
  if (!ov || ov.pick === gc.key) {
    return { key: gc.key, text: greedy.text, reason: `greedy's move: no other move beats it by a paired gain above ${z} standard errors and at least ${a.minGain ?? 0.02}`, greedy, gains };
  }
  const g = gains.find((x) => x.key === ov.pick);
  return { key: ov.pick, text: textOf(ov.pick), reason: `overrides greedy's move: ${g ? fmtGain(g) : 'paired gain'}, above ${z} standard errors and at least ${a.minGain ?? 0.02}`, greedy, gains };
}

export async function spotCommand(argv: readonly string[], out: (s: string) => void = (s) => console.log(s)): Promise<SearchResult> {
  checkFlags(argv, SPOT_VALUE_FLAGS, SPOT_SWITCHES, SPOT_USAGE);
  const a = parseSpotArgs(argv);
  let spot: LoadedSpot;
  try { spot = readSpotFile(a.file); } catch (e) {
    if (e instanceof SpotError) throw new UsageError(`${a.file}: ${e.message}`);
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new UsageError(`--file ${a.file}: no such file`);
    throw e;
  }
  try { prepareDeterminizer(spot.view, spot.decks); } catch (e) {
    if (e instanceof DeterminizeError) throw new UsageError(`${a.file}: this spot cannot be searched: ${e.message}`);
    throw e;
  }
  const opts: SearchOptions = {
    samples: a.samples, iterations: a.iterations ?? undefined, ms: a.ms ?? undefined, rollout: a.rollout, rolloutTurns: a.turns,
    seed: a.seed, decks: spot.decks, player: a.player ?? spot.view.viewer, policy: a.policy, prune: a.prune,
  };
  const r = await searchViewParallel(spot.view, opts, a.workers);
  const rec = a.mode === 'validated' ? recommend(spot, r, a) : undefined;
  const validation = validationNote(a.mode ?? 'uct', { ...a, rolloutTurns: a.turns });
  if (a.json) {
    const { lines: all, ...rest } = r;
    out(JSON.stringify({ args: a, ...rest, lines: all.slice(0, a.top), ...(rec ? { recommendation: rec } : {}), notes: [HEURISTIC_SENTENCE, DETERMINIZATION_SENTENCE], validation }, null, 2));
  } else {
    let note: string | undefined;
    try { note = (JSON.parse(readFileSync(a.file, 'utf8')) as { note?: string }).note; } catch { note = undefined; }
    console.error(validation);
    out(formatSpotReport(r, a, note, rec));
  }
  return r;
}
