// The ISMCTS agent (PLAN.md section 8, Phase 4): a playable agent that decides from the per-player
// view alone. At each decision with more than one legal move it takes Decision.view(), deals D
// determinized samples from it and the two decklists (determinize.ts), searches each with UCT
// (ismcts.ts, a per-decision budget of I iterations per sample or a time budget) and picks a root
// move. It never reads the real game state: the view is all it gets from the game, and randomness
// comes from its own stream.
//
// Two modes (PLAN.md D25, D27). The default, 'validated', is the search that beat greedy in the
// Phase 4 acceptance run (docs/ACCEPTANCE.md, MCTS_VALIDATED below): greedy rollouts, root pruning
// to greedy's top 3, a skip margin and the paired override that keeps greedy's move unless the search
// finds a clear gain. 'uct' is the plain Phase 4 search (MCTS_UCT: fast rollouts over every legal
// move, the most visited root move, ties to the higher mean value); it was not validated against
// greedy. Any option given replaces the mode's value.
//
// Two kinds of decisions are not searched:
//  - mulligan and bottom decisions use greedy's keep rule and bottom scoring (keepHand,
//    keptHandScore) on the hand the view shows;
//  - a choice asked in the middle of an operation (a discard pick, a trigger's target or order, a
//    would-die replacement) cannot be determinized, because the view does not carry the
//    half-finished operation (DeterminizeError). Those are answered by the greedy agent on
//    Decision.sample (PLAN.md D21 a: the caller's determinized copy, which holds nothing beyond the
//    view plus the decklists); without a sample, by a uniform pick from the agent's stream. The
//    count is in stats().fallbacks.
import { cloneRng, jump, nextInt, nextU32, seedRng } from '../engine/rng.js';
import { legalMoves } from '../engine/moves.js';
import { deckDefIds, DeterminizeError, prepareDeterminizer, type DeckSource, type Determinizer } from './determinize.js';
import { greedyAgent, keepHand, keptHandScore, type GreedyAgent } from './greedy.js';
import { knownIds, moveKey, searchView, type SearchOptions, type SearchResult, type TopLine } from './ismcts.js';
import type { Agent, Decision } from './types.js';
import type { DefId, Move, ObjId, PlayerId, RngState } from '../engine/types.js';
import type { PlayerView } from '../engine/view.js';

export interface MctsOptions {
  /** The preset the other options start from (default 'validated', MCTS_VALIDATED; 'uct' is MCTS_UCT). */
  mode?: MctsMode;
  /** Samples per decision (default: the mode's, 8 validated, 4 uct). */
  samples?: number;
  /** Iterations per sample (default: the mode's, 3 validated, 50 uct; ignored when ms is given). */
  iterations?: number;
  /** Wall-clock budget per decision in milliseconds (replaces iterations). */
  ms?: number;
  rollout?: 'truncated' | 'full';
  rolloutTurns?: number;
  /** Rollout policy (ismcts.ts SearchOptions.policy; default: the mode's, 'greedy' validated, 'fast' uct). */
  policy?: 'fast' | 'greedy';
  /** Greedy top-K pruning (ismcts.ts SearchOptions.prune; default: the mode's, 3 validated, 0 (off) uct). */
  prune?: number;
  /** Depths pruned (ismcts.ts SearchOptions.pruneDepth; default 1, the root only). */
  pruneDepth?: number;
  /**
   * Skip margin: before searching, greedy scores the legal moves on one determinized sample; when
   * its best move leads the second by at least this many evaluation points, that move is played
   * without a search (counted in stats().skipped). Default: the mode's, 3 validated, undefined uct
   * (every decision is searched).
   */
  margin?: number;
  /**
   * Conservative override: when set to z, the agent plays greedy's choice (greedy's best move on
   * the margin sample) unless another searched root move beats it on the paired per-sample values
   * (the same determinized sample for both moves) by a mean difference d with d - z x se > 0, se
   * the standard error of the paired differences over the samples that have both; then the move
   * with the largest such d is played, provided d is also at least minGain. Default: the mode's, 2
   * validated, undefined uct (the most visited root move is played).
   */
  override?: number;
  /** Smallest paired mean gain (value units, [0, 1]) that may override greedy's move; default 0.02. */
  minGain?: number;
  c?: number;
  /** The two decklists (default decks/deckA.json and decks/deckB.json); resolved once. */
  decks?: [DeckSource, DeckSource];
  name?: string;
}

export interface MctsStats {
  /** Decisions answered by search. */
  searched: number;
  /** Mid-operation choices answered by the fallback (see the file comment). */
  fallbacks: number;
  /** Decisions with a single legal move (answered without looking). */
  forced: number;
  /** Mulligan and bottom decisions (greedy's rules on the view). */
  pregame: number;
  /** Decisions played by greedy's clear first choice without a search (options.margin). */
  skipped: number;
  /** Searched decisions where the override rule played a move other than greedy's (options.override). */
  overrides: number;
  /** Seconds spent in search (searched decisions only). */
  searchSeconds: number;
  rollouts: number;
}

export interface MctsAgent extends Agent {
  rng(): RngState;
  stats(): MctsStats;
  /** The last search result (null before the first search). */
  last(): SearchResult | null;
  /** The search this agent runs on a view (the same path choose takes; for tests and tools). */
  analyze(v: PlayerView): SearchResult;
}

/**
 * The search that passed the Phase 4 acceptance run (docs/ACCEPTANCE.md; PLAN.md D25), the default
 * mode: 8 samples x 3 iterations per decision, greedy rollouts cut after 2 turns, root pruning to
 * greedy's top 3, greedy's move unsearched when it leads by 3 evaluation points, and greedy's move
 * overridden only by a paired lead above 2 standard errors and at least 0.02.
 */
export const MCTS_VALIDATED = { samples: 8, iterations: 3, rolloutTurns: 2, policy: 'greedy', prune: 3, pruneDepth: 1, margin: 3, override: 2, minGain: 0.02 } as const;

/**
 * The plain determinized UCT search of Phase 4 (PLAN.md D24 f), mode 'uct': 4 samples x 50
 * iterations, fast rollouts cut after 2 turns over every legal move, the most visited root move. Not
 * validated against greedy (docs/ACCEPTANCE.md: 41.3% [95% CI 28.3-55.7%, n=46] as A in a screen).
 */
export const MCTS_UCT = { samples: 4, iterations: 50, rolloutTurns: 2, policy: 'fast', prune: 0, pruneDepth: 1 } as const;

export type MctsMode = 'validated' | 'uct';

/** The options an agent runs with: the mode's preset, then every option given (an undefined value does not replace a preset value). */
export function resolveMctsOptions(opts: MctsOptions = {}): MctsOptions {
  const out: Record<string, unknown> = { ...(opts.mode === 'uct' ? MCTS_UCT : MCTS_VALIDATED) };
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) out[k] = v;
  if (opts.ms !== undefined && opts.iterations === undefined) delete out.iterations;
  out.mode = opts.mode ?? 'validated';
  return out as MctsOptions;
}

/** Greedy's first choice on one determinized sample (the margin step, PLAN.md D25 c). */
export interface GreedyChoice {
  /** moveKey of greedy's best move on the sample. */
  key: string;
  /** Its evaluation lead over greedy's second choice (Infinity with one legal move). */
  lead: number;
  /** Legal moves on the sample. */
  moves: number;
}

/**
 * Greedy scores the decider's legal moves on det.sample(rng), one determinized sample of the view
 * (it draws that sample and nothing else from rng); returns the key of its best move (the first of
 * equal scores) and its lead over the second.
 */
export function greedyFirstChoice(v: PlayerView, det: Determinizer, rng: RngState, me: PlayerId, greedy: GreedyAgent, known: ReadonlySet<ObjId>): GreedyChoice {
  const s = det.sample(rng);
  const sm = legalMoves(s, me);
  const sc = greedy.explain({ player: me, moves: sm, view: () => v, sample: () => s }).map((x) => x.score);
  let bi = 0;
  sc.forEach((x, i) => { if (x > (sc[bi] as number)) bi = i; });
  const second = Math.max(-Infinity, ...sc.filter((_, i) => i !== bi));
  return { key: moveKey(sm[bi] as Move, known, s.objects), lead: (sc[bi] as number) - second, moves: sm.length };
}

/** A root line's paired gain over greedy's line: mean and standard error of the per-sample differences. */
export interface PairedGain { key: string; n: number; mean: number; se: number }

/**
 * The conservative override (PLAN.md D25 d): each root line against greedy's line on the samples
 * that have both (a paired comparison). The line with the largest mean gain d that has
 * d - z x se > 0 and d >= minGain is picked (the earlier line on a tie); otherwise greedy's line.
 * Lines with fewer than 2 pairs are not compared. Null when greedy's line is not among the lines.
 */
export function pairedOverride(lines: readonly TopLine[], greedyKey: string, z: number, minGain: number, allowed: (key: string) => boolean = () => true): { pick: string; gains: PairedGain[] } | null {
  const g = lines.find((l) => l.key === greedyKey);
  if (!g) return null;
  let pick = greedyKey;
  let bestD = 0;
  const gains: PairedGain[] = [];
  for (const l of lines) {
    if (l.key === greedyKey || !allowed(l.key)) continue;
    const d: number[] = [];
    l.perSample.forEach((x, i) => { const y = g.perSample[i]; if (x !== null && y !== null && y !== undefined) d.push(x - y); });
    if (d.length < 2) continue;
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (d.length - 1));
    const se = sd / Math.sqrt(d.length);
    gains.push({ key: l.key, n: d.length, mean, se });
    if (mean - z * se > 0 && mean >= minGain && mean > bestD) { bestD = mean; pick = l.key; }
  }
  return { pick, gains };
}

export function mctsAgent(seed: number, given: MctsOptions = {}): MctsAgent {
  const opts = resolveMctsOptions(given);
  const rng = seedRng(seed);
  jump(rng);
  const decks: [DefId[], DefId[]] = [deckDefIds(opts.decks?.[0] ?? 'deckA'), deckDefIds(opts.decks?.[1] ?? 'deckB')];
  const fallback = greedyAgent(nextU32(rng) * 2097152 + (nextU32(rng) >>> 11), { name: 'mcts-fallback' });
  const stats: MctsStats = { searched: 0, fallbacks: 0, forced: 0, pregame: 0, skipped: 0, overrides: 0, searchSeconds: 0, rollouts: 0 };
  let last: SearchResult | null = null;

  const searchOpts = (): SearchOptions => ({
    samples: opts.samples as number,
    iterations: opts.iterations,
    ms: opts.ms,
    rollout: opts.rollout,
    rolloutTurns: opts.rolloutTurns,
    policy: opts.policy,
    prune: opts.prune,
    pruneDepth: opts.pruneDepth,
    c: opts.c,
    seed: nextU32(rng) * 2097152 + (nextU32(rng) >>> 11),
    decks,
  });

  const analyze = (v: PlayerView, det?: Determinizer): SearchResult => {
    const t0 = performance.now();
    const r = searchView(v, searchOpts(), det ?? prepareDeterminizer(v, decks));
    stats.searchSeconds += (performance.now() - t0) / 1000;
    stats.rollouts += r.rollouts;
    last = r;
    return r;
  };

  return {
    name: opts.name ?? 'mcts',
    rng: () => cloneRng(rng),
    stats: () => ({ ...stats }),
    last: () => last,
    analyze: (v) => analyze(v),
    choose(d: Decision): Move {
      const moves = d.moves;
      if (moves.length === 0) throw new Error('mctsAgent: no legal moves');
      if (moves.length === 1) { stats.forced++; return moves[0] as Move; }
      const v = d.view();
      const me = d.player;
      const ch = v.pendingChoice;
      if (ch && ch.player === me && (ch.kind === 'mulligan' || ch.kind === 'bottom')) {
        stats.pregame++;
        const hand = v.zones.hand[me].known.map((id) => v.objects[id]?.defId as DefId);
        if (ch.kind === 'mulligan') {
          const keep = keepHand(hand, v.players[me].mulligans);
          return moves.find((m) => m.type === 'choose' && m.answer.keep === keep) ?? (moves[0] as Move);
        }
        let best = moves[0] as Move;
        let bestScore = -Infinity;
        for (const m of moves) {
          if (m.type !== 'choose') continue;
          const out = new Set(m.answer.ids ?? []);
          const s = keptHandScore(v.zones.hand[me].known.filter((id) => !out.has(id)).map((id) => v.objects[id]?.defId as DefId));
          if (s > bestScore) { bestScore = s; best = m; }
        }
        return best;
      }
      let det: Determinizer;
      try {
        det = prepareDeterminizer(v, decks);
      } catch (e) {
        if (!(e instanceof DeterminizeError)) throw e;
        stats.fallbacks++;
        return d.sample ? fallback.choose(d) : moves[nextInt(rng, moves.length)] as Move;
      }
      const known = knownIds(v);
      const byKey = new Map<string, Move>();
      for (const m of moves) byKey.set(moveKey(m, known, v.objects), m);
      let greedyKey: string | null = null;
      if (opts.margin !== undefined || opts.override !== undefined) {
        // Greedy's scores on one sample of the agent's own; a clear leader is played unsearched.
        const gc = greedyFirstChoice(v, det, rng, me, fallback, known);
        const best = byKey.get(gc.key);
        greedyKey = best ? gc.key : null;
        if (best && opts.margin !== undefined && gc.lead >= opts.margin) { stats.skipped++; return best; }
      }
      stats.searched++;
      const r = analyze(v, det);
      if (opts.override !== undefined && greedyKey !== null) {
        const ov = pairedOverride(r.lines, greedyKey, opts.override, opts.minGain ?? 0.02, (k) => byKey.has(k));
        if (ov) {
          if (ov.pick !== greedyKey) stats.overrides++;
          return byKey.get(ov.pick) as Move;
        }
      }
      // Most visited root move (the lines are sorted by visits, then value).
      for (const line of r.lines) {
        const m = byKey.get(line.key);
        if (m) return m;
      }
      throw new Error(`mctsAgent: no searched move matches a legal move (${r.lines.length} lines, ${moves.length} moves)`);
    },
  };
}
