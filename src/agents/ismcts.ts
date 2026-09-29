// Information set Monte Carlo tree search with determinization (PLAN.md section 8, Phase 4; the
// brief's spot analyzer). From a PlayerView:
//  1. D determinized samples are dealt from the view and the two decklists (determinize.ts): the
//     cards the viewer cannot see are filled in at random, uniformly over what is left of each list;
//  2. each sample gets its own UCT search of I iterations (or a time budget) over the full move set:
//     the opponent's decisions are tree nodes like the viewer's, and so are pending choices (attack
//     and block declarations, picks, targets). Inside a sample the opponent's hidden cards are
//     visible to the search: that is the documented weakness of determinization (strategy fusion,
//     non-locality; it can act as if it knew cards the player has not seen);
//  3. the root moves are aggregated across samples by a key that names each object by id when the
//     view shows it and by card when it was sampled: visits, the mean rollout value with its
//     standard error, and a win-rate estimate with a Wilson interval over the rollouts that passed
//     through the move. The principal variation (the most visited path) is merged the same way.
// Tree policy: UCT, mean value of the deciding player plus c * sqrt(ln N / n), c = 0.7 by default
// (values lie in [0, 1]). Untried moves are expanded one per iteration in an order shuffled with the
// searcher's stream. Rollouts: rollout.ts, truncated after K turns and scored by the greedy
// evaluation mapped to [0, 1], or played to the end (rollout 'full').
// Execution (PLAN.md D6): a node stores its own state, copied at expansion (copy mode), while the
// storage cap lasts; an iteration mutates the deepest stored state on its path in journal mode,
// replays the moves below it, expands, plays the rollout and rewinds with undoTo, so no state is
// cloned per move. Every random draw comes from the searcher's stream (one stream per sample, jump()
// separated), so a result is fixed by the seed, the view and the options when the budget is in
// iterations (a millisecond budget depends on the machine). Values and win rates reflect heuristic
// play inside the samples, not perfect play.
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { applyMoveInPlace, cloneState } from '../engine/apply.js';
import { decider, legalMoves } from '../engine/moves.js';
import { beginJournal, cloneData, mark, undoTo } from '../engine/mutate.js';
import { cloneRng, jump, nextU32, seedRng, shuffle } from '../engine/rng.js';
import { tQuantile, wilson, type Proportion } from '../sim/stats.js';
import { describeMove } from '../tools/describe-move.js';
import { deckDefIds, freshBase, prepareDeterminizer, type DeckSource, type Determinizer } from './determinize.js';
import { detectProfile, greedyAgent, type GreedyAgent } from './greedy.js';
import type { Profile } from './evaluate.js';
import { bernoulli, leafValue, rollout, type RolloutPick } from './rollout.js';
import type { Choice, DefId, GameObject, GameState, Move, ObjId, PlayerId, RngState } from '../engine/types.js';
import type { PlayerView } from '../engine/view.js';

export interface SearchOptions {
  /** Determinized samples D. */
  samples: number;
  /** UCT iterations per sample I (default 200 when ms is not given). */
  iterations?: number | undefined;
  /** Wall-clock budget per decision in milliseconds, split over the samples (replaces iterations when given). */
  ms?: number | undefined;
  /** 'truncated' (default): rollouts stop after rolloutTurns turns and are scored by the evaluation; 'full': played to the end. */
  rollout?: 'truncated' | 'full' | undefined;
  /** Turns (both players' turns) a truncated rollout plays; default 2. */
  rolloutTurns?: number | undefined;
  /** UCT exploration constant; default 0.7. */
  c?: number | undefined;
  /** Searcher seed; every sample's stream derives from it. */
  seed: number;
  /** The two decklists (default decks/deckA.json and decks/deckB.json). */
  decks?: [DeckSource, DeckSource] | undefined;
  /** Whose win rate the values are (default the viewer). */
  player?: PlayerId | undefined;
  /** Stored node states per sample (copy mode); deeper nodes are reached by journal replay. Default 4,096. */
  storeCap?: number | undefined;
  /**
   * Rollout policy: 'fast' (default, rollout.ts rolloutMove) or 'greedy' (the greedy agent's one-ply
   * scoring for both players on the sample, which is a full state; much slower per move).
   */
  policy?: 'fast' | 'greedy' | undefined;
  /**
   * Greedy pruning: when K > 0, every node keeps only the K moves the greedy agent scores highest
   * for its decider on that node's sample state, expanded best first (the rest are never searched).
   * 0 (default) keeps every legal move, expanded in a shuffled order.
   */
  prune?: number | undefined;
  /** Tree depths that are pruned: nodes at depth below this (the root is depth 0); default 1, the root only. */
  pruneDepth?: number | undefined;
}

export const DEFAULTS = { iterations: 200, rolloutTurns: 2, c: 0.7, storeCap: 4096, pvDepth: 8 } as const;

// ---- UCT ------------------------------------------------------------------------------------

/**
 * UCT score of a child for the player deciding at its parent: mean + c * sqrt(ln(parentVisits) / visits),
 * where mean is that player's mean value through the child. An unvisited child scores Infinity.
 */
export function uctScore(mean: number, visits: number, parentVisits: number, c: number): number {
  if (visits === 0) return Infinity;
  return mean + c * Math.sqrt(Math.log(parentVisits) / visits);
}

/** The shape selectChild reads (a search node, or a hand-built one in tests). */
export interface UctNode {
  /** Decider at this node. */
  player: PlayerId | null;
  visits: number;
  children: readonly { visits: number; sum: number }[];
}

/**
 * Index of the child with the highest UCT score for the node's decider; sum is the value total from
 * perspective's side, so the decider's mean is sum / visits for perspective and 1 - sum / visits for
 * the other player. Ties go to the lower index.
 */
export function selectChild(node: UctNode, perspective: PlayerId, c: number): number {
  let best = -1;
  let bestScore = -Infinity;
  node.children.forEach((ch, i) => {
    const m = ch.visits === 0 ? 0 : ch.sum / ch.visits;
    const mean = node.player === perspective ? m : 1 - m;
    const s = uctScore(mean, ch.visits, node.visits, c);
    if (s > bestScore) { bestScore = s; best = i; }
  });
  return best;
}

// ---- move keys --------------------------------------------------------------------------------

/**
 * A key for a move that is the same in every sample: an object the view shows keeps its id, a
 * sampled object is named by its card ('s:defId'), so two samples' casts of a sampled Burst
 * Lightning share a key.
 */
export function moveKey(m: Move, known: ReadonlySet<ObjId>, objects: Readonly<Record<number, GameObject>>): string {
  const id = (x: ObjId): string | number => (known.has(x) ? x : `s:${objects[x]?.defId ?? '?'}`);
  const t = (x: { kind: 'player'; p: PlayerId } | { kind: 'obj' | 'planeswalker'; id: ObjId }): unknown =>
    (x.kind === 'player' ? `p${x.p}` : id(x.id));
  switch (m.type) {
    case 'playLand': return JSON.stringify(['L', id(m.objId), m.face ?? 0, m.pay ?? false]);
    case 'cast': return JSON.stringify(['C', id(m.objId), m.face ?? 0, m.half ?? -1, m.mode ?? -1, m.kicked ?? false,
      m.bargain === undefined ? null : id(m.bargain), m.costChoice ?? -1, (m.discard ?? []).map(id), m.targets.map(t), m.payment ?? 0]);
    case 'activate': return JSON.stringify(['A', id(m.objId), m.abilityKey, m.targets.map(t), (m.crewWith ?? []).map(id),
      (m.sacrifice ?? []).map(id), (m.discard ?? []).map(id), m.payment ?? 0]);
    case 'unlockDoor': return JSON.stringify(['U', id(m.objId), m.half, m.payment ?? 0]);
    case 'declareAttackers': return JSON.stringify(['DA', m.assignments.map(([a, d]) => [id(a), t(d)])]);
    case 'declareBlockers': return JSON.stringify(['DB', m.assignments.map(([b, a]) => [id(b), id(a)])]);
    case 'choose': return JSON.stringify(['Q', m.answer.keep ?? null, (m.answer.ids ?? []).map(id), m.answer.index ?? -1]);
    case 'pass': return '["P"]';
  }
}

// ---- the tree ---------------------------------------------------------------------------------

interface Node {
  /** Edge from the parent (null at the root). */
  move: Move | null;
  key: string;
  text: string;
  mover: PlayerId | null;
  /** Decider at this node (null when the game is over). */
  player: PlayerId | null;
  choice: Choice | null;
  moves: Move[];
  untried: number[];
  children: Node[];
  visits: number;
  /** Sums of rollout values from the perspective player's side, their squares, and Bernoulli wins. */
  sum: number;
  sumSq: number;
  wins: number;
  state: GameState | null;
}

/** Move order for a new node: indices into moves, the last one expanded first (untried is popped). */
type Order = (state: GameState, player: PlayerId, moves: readonly Move[]) => number[];

function makeNode(state: GameState, move: Move | null, key: string, text: string, mover: PlayerId | null, rng: RngState, order?: Order): Node {
  const player = state.result ? null : decider(state);
  const moves = player === null ? [] : legalMoves(state, player);
  const untried = order && player !== null && moves.length > 1 ? order(state, player, moves) : shuffle(rng, moves.map((_, i) => i));
  return {
    move, key, text, mover, player, choice: state.pendingChoice ? cloneData(state.pendingChoice) : null, moves, untried,
    children: [], visits: 0, sum: 0, sumSq: 0, wins: 0, state: null,
  };
}

/** Plain-data tree of one sample (no states), for aggregation and for worker transfer. */
export interface TreeStats {
  key: string;
  text: string;
  mover: PlayerId | null;
  /** The move itself (root children only; the agent maps it back to a legal move). */
  move?: Move;
  visits: number;
  sum: number;
  sumSq: number;
  wins: number;
  children: TreeStats[];
}

export interface SampleResult {
  index: number;
  root: TreeStats;
  /** Decider at the root of this sample. */
  decider: PlayerId | null;
  iterations: number;
  rollouts: number;
  rolloutMoves: number;
  storedStates: number;
  seconds: number;
}

function exportNode(n: Node, depth: number): TreeStats {
  const out: TreeStats = { key: n.key, text: n.text, mover: n.mover, visits: n.visits, sum: n.sum, sumSq: n.sumSq, wins: n.wins, children: [] };
  if (n.move && depth === 1) out.move = cloneData(n.move);
  out.children = n.children.map((c) => exportNode(c, depth + 1));
  return out;
}

const NO_VIEW = (): never => { throw new Error('ismcts: the greedy rollout and pruning policies read the sample, not a view'); };

/** Greedy's choice for p on a sample state (the state itself is not touched: greedy scores copies). */
function greedyPick(agents: readonly [GreedyAgent, GreedyAgent]): RolloutPick {
  return (state, p, moves) => (moves.length === 1 ? moves[0] as Move
    : agents[p].choose({ player: p, moves, view: NO_VIEW, sample: () => cloneState(state) }));
}

/** The top k moves by greedy's score for the decider, as untried indices (best last, so it is expanded first). */
function greedyOrder(agents: readonly [GreedyAgent, GreedyAgent], k: number): Order {
  return (state, p, moves) => {
    const sc = agents[p].explain({ player: p, moves, view: NO_VIEW, sample: () => cloneState(state) }).map((x) => x.score);
    const idx = moves.map((_, i) => i).sort((a, b) => (sc[b] as number) - (sc[a] as number) || a - b);
    return idx.slice(0, k).reverse();
  };
}

/** Known ids of a view: every object it shows. */
export function knownIds(v: PlayerView): Set<ObjId> {
  return new Set(Object.keys(v.objects).map(Number));
}

/**
 * UCT search of one determinized sample (the state is owned by the search and mutated in journal
 * mode). iterations and ms bound the work (both may be given; the first reached stops it).
 */
export function searchSample(
  s0: GameState, rng: RngState, known: ReadonlySet<ObjId>, perspective: PlayerId,
  opts: {
    iterations: number; ms?: number | undefined; rollout: 'truncated' | 'full'; rolloutTurns: number; c: number; storeCap: number; index?: number; base?: number;
    policy?: 'fast' | 'greedy' | undefined; prune?: number | undefined; pruneDepth?: number | undefined;
  },
): SampleResult {
  const t0 = performance.now();
  const deadline = opts.ms === undefined ? Infinity : t0 + opts.ms;
  // Greedy agents for the policies that use them, one per player (each detects its own deck
  // profile), seeded from the sample's stream.
  const prune = opts.prune ?? 0;
  const pruneDepth = opts.pruneDepth ?? 1;
  const greedy: readonly [GreedyAgent, GreedyAgent] | null = opts.policy === 'greedy' || prune > 0
    ? [greedyAgent(nextU32(rng) * 2097152 + (nextU32(rng) >>> 11)), greedyAgent(nextU32(rng) * 2097152 + (nextU32(rng) >>> 11))]
    : null;
  const order = greedy && prune > 0 ? greedyOrder(greedy, prune) : undefined;
  const pick = greedy && opts.policy === 'greedy' ? greedyPick(greedy) : undefined;
  const root = makeNode(s0, null, 'root', 'root', null, rng, order);
  // Dealt ids: from the view's fresh base (every view id is below it) to the sample's first free id.
  const base = opts.base ?? freshBase(Object.keys(s0.objects).filter((k) => known.has(Number(k))).map(Number));
  const dealtEnd = s0.nextId;
  const sampled = (id: ObjId): boolean => id >= base && id < dealtEnd;
  root.state = s0;
  const profiles: [Profile, Profile] = [detectProfile(s0, 0), detectProfile(s0, 1)];
  const turns = opts.rollout === 'full' ? null : opts.rolloutTurns;
  let stored = 1;
  let it = 0;
  let rolloutMoves = 0;
  for (; it < opts.iterations; it++) {
    if (opts.ms !== undefined && performance.now() >= deadline) break;
    // Selection: descend through fully expanded nodes.
    const path: Node[] = [root];
    let node = root;
    while (node.player !== null && node.untried.length === 0 && node.children.length > 0) {
      node = node.children[selectChild(node, perspective, opts.c)] as Node;
      path.push(node);
    }
    // Journal mode on the deepest stored state of the path, replaying the moves below it.
    let bi = path.length - 1;
    while (!(path[bi] as Node).state) bi--;
    const work = (path[bi] as Node).state as GameState;
    beginJournal(work);
    const m0 = mark(work);
    for (let k = bi + 1; k < path.length; k++) applyMoveInPlace(work, cloneData((path[k] as Node).move as Move));
    // Expansion: one untried move; the child keeps a copy of its state while the cap lasts.
    if (node.player !== null && node.untried.length > 0) {
      const i = node.untried.pop() as number;
      const mv = node.moves[i] as Move;
      const text = describeMove(work.objects, mv, node.player, { sampled, choice: node.choice });
      const key = moveKey(mv, known, work.objects);
      const mover = node.player;
      applyMoveInPlace(work, cloneData(mv));
      const child = makeNode(work, mv, key, text, mover, rng, path.length < pruneDepth ? order : undefined);
      if (stored < opts.storeCap) { child.state = cloneState(work); stored++; }
      node.children.push(child);
      path.push(child);
      node = child;
    }
    // Rollout and evaluation, then rewind.
    if (!work.result) rolloutMoves += rollout(work, rng, pick ? { turns, pick } : { turns });
    const v = leafValue(work, perspective, profiles[perspective]);
    const win = bernoulli(v, rng);
    undoTo(work, m0);
    for (const n of path) { n.visits++; n.sum += v; n.sumSq += v * v; n.wins += win; }
  }
  return {
    index: opts.index ?? 0, root: exportNode(root, 0), decider: root.player, iterations: it, rollouts: it, rolloutMoves,
    storedStates: stored, seconds: (performance.now() - t0) / 1000,
  };
}

// ---- samples and aggregation -------------------------------------------------------------------

/** The stream of sample i: seedRng(seed) advanced i + 1 jump() calls (the same for any worker split). */
export function sampleStreams(seed: number, count: number): RngState[] {
  const master = seedRng(seed);
  const out: RngState[] = [];
  for (let i = 0; i < count; i++) { jump(master); out.push(cloneRng(master)); }
  return out;
}

export interface LineStep {
  text: string;
  mover: PlayerId | null;
  /** Rollouts that passed through this step (summed over the samples that reached it). */
  visits: number;
  /** Samples whose tree has this step. */
  samples: number;
  /** Mean rollout value for the perspective player, its standard error (NaN below 2 rollouts). */
  mean: number;
  se: number;
  /** 95 percent Student t interval for the mean value (mean +- t(0.975, n - 1) x se, clipped to [0, 1] where values lie; NaN below 2 rollouts). */
  meanLo: number;
  meanHi: number;
  /** Win-rate estimate: Wilson interval over the rollouts' win outcomes (a truncated rollout wins with probability equal to its value). */
  win: Proportion;
}

export interface TopLine extends LineStep {
  key: string;
  /** The root move (from one sample; the agent maps it back to a legal move by key). */
  move: Move | null;
  /** Principal variation after the root move: the most visited path, merged across samples by key. */
  pv: LineStep[];
  /** Mean rollout value through this move in each sample, by sample index (null where the sample's tree does not have it). */
  perSample: (number | null)[];
}

export interface SearchResult {
  perspective: PlayerId;
  viewer: PlayerId;
  /** The player deciding at the root (null when the game is over). */
  decider: PlayerId | null;
  samples: number;
  iterations: number;
  rollouts: number;
  rolloutMoves: number;
  seconds: number;
  /** Every root move, most visited first. */
  lines: TopLine[];
  /** All rollouts of the search. */
  total: LineStep;
  options: { samples: number; iterations: number | null; ms: number | null; rollout: 'truncated' | 'full'; rolloutTurns: number; c: number; seed: number };
}

interface Merged { key: string; text: string; mover: PlayerId | null; move: Move | null; visits: number; sum: number; sumSq: number; wins: number; samples: number; kids: TreeStats[][] }

function merge(lists: readonly (readonly TreeStats[])[]): Merged[] {
  const by = new Map<string, Merged>();
  for (const list of lists) {
    for (const t of list) {
      let m = by.get(t.key);
      if (!m) { m = { key: t.key, text: t.text, mover: t.mover, move: t.move ?? null, visits: 0, sum: 0, sumSq: 0, wins: 0, samples: 0, kids: [] }; by.set(t.key, m); }
      m.visits += t.visits; m.sum += t.sum; m.sumSq += t.sumSq; m.wins += t.wins; m.samples++;
      m.kids.push(t.children);
    }
  }
  return [...by.values()].sort((a, b) => b.visits - a.visits || b.sum - a.sum || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function step(m: { text: string; mover: PlayerId | null; visits: number; sum: number; sumSq: number; wins: number; samples: number }): LineStep {
  const n = m.visits;
  const mean = n === 0 ? NaN : m.sum / n;
  const variance = n < 2 ? NaN : Math.max(0, (m.sumSq - n * mean * mean) / (n - 1));
  const se = n < 2 ? NaN : Math.sqrt(variance / n);
  const half = n < 2 ? NaN : tQuantile(0.975, n - 1) * se;
  return { text: m.text, mover: m.mover, visits: n, samples: m.samples, mean, se, meanLo: Math.max(0, mean - half), meanHi: Math.min(1, mean + half), win: wilson(m.wins, n) };
}

/** Aggregates per-sample trees into the ranked root lines with merged principal variations. */
export function aggregate(results: readonly SampleResult[], meta: { perspective: PlayerId; viewer: PlayerId; seconds: number; options: SearchResult['options'] }, pvDepth: number = DEFAULTS.pvDepth): SearchResult {
  const sorted = [...results].sort((a, b) => a.index - b.index);
  const rootLines = merge(sorted.map((r) => r.root.children));
  const lines: TopLine[] = rootLines.map((m) => {
    const pv: LineStep[] = [];
    let kids = m.kids;
    for (let d = 0; d < pvDepth; d++) {
      const next = merge(kids)[0];
      if (!next || next.visits === 0) break;
      pv.push(step(next));
      kids = next.kids;
    }
    const perSample = sorted.map((r) => {
      const c = r.root.children.find((x) => x.key === m.key);
      return c && c.visits > 0 ? c.sum / c.visits : null;
    });
    return { ...step(m), key: m.key, move: m.move, pv, perSample };
  });
  const tot = sorted.reduce((a, r) => ({ visits: a.visits + r.root.visits, sum: a.sum + r.root.sum, sumSq: a.sumSq + r.root.sumSq, wins: a.wins + r.root.wins }), { visits: 0, sum: 0, sumSq: 0, wins: 0 });
  return {
    perspective: meta.perspective, viewer: meta.viewer, decider: sorted[0]?.decider ?? null,
    samples: sorted.length,
    iterations: sorted.reduce((a, r) => a + r.iterations, 0),
    rollouts: sorted.reduce((a, r) => a + r.rollouts, 0),
    rolloutMoves: sorted.reduce((a, r) => a + r.rolloutMoves, 0),
    seconds: meta.seconds,
    lines,
    total: step({ text: 'all rollouts', mover: null, samples: sorted.length, ...tot }),
    options: meta.options,
  };
}

// ---- entry points ------------------------------------------------------------------------------

interface Resolved {
  samples: number; iterations: number; msPerSample: number | undefined; rollout: 'truncated' | 'full'; rolloutTurns: number; c: number; storeCap: number;
  perspective: PlayerId; decks: [DefId[], DefId[]]; policy: 'fast' | 'greedy'; prune: number; pruneDepth: number;
}

function resolveOptions(v: PlayerView, o: SearchOptions, parallel: number): Resolved {
  if (!Number.isInteger(o.samples) || o.samples < 1) throw new Error(`samples must be a positive integer, got ${o.samples}`);
  if (o.iterations !== undefined && (!Number.isInteger(o.iterations) || o.iterations < 1)) throw new Error(`iterations must be a positive integer, got ${o.iterations}`);
  if (o.ms !== undefined && !(o.ms > 0)) throw new Error(`ms must be positive, got ${o.ms}`);
  if (o.prune !== undefined && (!Number.isInteger(o.prune) || o.prune < 0)) throw new Error(`prune must be a non-negative integer, got ${o.prune}`);
  const decks = o.decks ?? ['deckA', 'deckB'];
  return {
    samples: o.samples,
    iterations: o.iterations ?? (o.ms === undefined ? DEFAULTS.iterations : Number.MAX_SAFE_INTEGER),
    // The decision budget is wall time: samples searched in parallel each get their share of it.
    msPerSample: o.ms === undefined ? undefined : (o.ms * Math.min(parallel, o.samples)) / o.samples,
    rollout: o.rollout ?? 'truncated',
    rolloutTurns: o.rolloutTurns ?? DEFAULTS.rolloutTurns,
    c: o.c ?? DEFAULTS.c,
    storeCap: o.storeCap ?? DEFAULTS.storeCap,
    perspective: o.player ?? v.viewer,
    decks: [deckDefIds(decks[0]), deckDefIds(decks[1])],
    policy: o.policy ?? 'fast',
    prune: o.prune ?? 0,
    pruneDepth: o.pruneDepth ?? 1,
  };
}

function optionsRecord(o: SearchOptions, r: Resolved): SearchResult['options'] {
  return { samples: r.samples, iterations: o.iterations ?? (o.ms === undefined ? DEFAULTS.iterations : null), ms: o.ms ?? null, rollout: r.rollout, rolloutTurns: r.rolloutTurns, c: r.c, seed: o.seed };
}

/** Searches the samples with the given indices (0-based, of opts.samples) in this thread. */
export function searchIndices(v: PlayerView, o: SearchOptions, indices: readonly number[], parallel = 1, det?: Determinizer): SampleResult[] {
  const r = resolveOptions(v, o, parallel);
  const d = det ?? prepareDeterminizer(v, r.decks);
  const streams = sampleStreams(o.seed, r.samples);
  const known = knownIds(v);
  const base = freshBase(v);
  return indices.map((i) => {
    const rng = streams[i] as RngState;
    const s0 = d.sample(rng);
    return searchSample(s0, rng, known, r.perspective, {
      iterations: r.iterations, ms: r.msPerSample, rollout: r.rollout, rolloutTurns: r.rolloutTurns, c: r.c, storeCap: r.storeCap, index: i, base,
      policy: r.policy, prune: r.prune, pruneDepth: r.pruneDepth,
    });
  });
}

/** ISMCTS from a view in this thread (the agent's path). det: a prepared determinizer to reuse. */
export function searchView(v: PlayerView, o: SearchOptions, det?: Determinizer): SearchResult {
  const t0 = performance.now();
  const r = resolveOptions(v, o, 1);
  const results = searchIndices(v, o, Array.from({ length: r.samples }, (_, i) => i), 1, det);
  return aggregate(results, { perspective: r.perspective, viewer: v.viewer, seconds: (performance.now() - t0) / 1000, options: optionsRecord(o, r) });
}

/** Worker entry and execArgv: ismcts-worker.ts with the tsx loader, or ismcts-worker.js from dist/. */
function workerSpec(): { url: URL; execArgv: string[] } {
  const self = fileURLToPath(import.meta.url);
  const isTs = self.endsWith('.ts');
  const url = new URL(isTs ? './ismcts-worker.ts' : './ismcts-worker.js', import.meta.url);
  const hasTsx = process.execArgv.some((a, i, all) => a.includes('tsx') && (a.startsWith('--import') || all[i - 1] === '--import' || all[i - 1] === '--loader'));
  return { url, execArgv: isTs && !hasTsx ? [...process.execArgv, '--import', 'tsx'] : [...process.execArgv] };
}

export function defaultSearchWorkers(): number {
  return Math.max(1, availableParallelism() - 1);
}

/**
 * ISMCTS with the samples spread over worker threads (workers 0 or 1: in this thread). The result
 * does not depend on the worker count when the budget is in iterations: each sample's stream is
 * fixed by its index.
 */
export async function searchViewParallel(v: PlayerView, o: SearchOptions, workers: number): Promise<SearchResult> {
  const t0 = performance.now();
  const n = Math.min(Math.max(workers, 0), o.samples);
  if (n <= 1) return searchView(v, o);
  const r = resolveOptions(v, o, n);
  prepareDeterminizer(v, r.decks); // fail fast in this thread with the determinizer's message
  const parts: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < r.samples; i++) (parts[i % n] as number[]).push(i);
  const { url, execArgv } = workerSpec();
  const results = (await Promise.all(parts.map((indices) => new Promise<SampleResult[]>((resolve, reject) => {
    const w = new Worker(url, { execArgv, workerData: { view: v, opts: o, indices, parallel: n } });
    w.once('message', (msg: { results?: SampleResult[]; error?: string }) => {
      void w.terminate();
      if (msg.error !== undefined || !msg.results) reject(new Error(`ismcts worker: ${msg.error ?? 'no result'}`));
      else resolve(msg.results);
    });
    w.once('error', reject);
  })))).flat();
  return aggregate(results, { perspective: r.perspective, viewer: v.viewer, seconds: (performance.now() - t0) / 1000, options: optionsRecord(o, r) });
}
