// Phase 3 mulligan and goldfish tool (PLAN.md section 8; the friend's question 1): given deck A's
// opening hand, play or draw and the mulligans already taken, decide KEEP, MULLIGAN or TOO CLOSE
// TO CALL by simulation, and report goldfish metrics for the kept hand.
//
//  - Keep branch: A (greedy) keeps this hand (after bottoming, when mulligans were taken) and plays
//    the greedy Mono-Red agent. Mulligan branch: A takes one more mulligan (a fresh random seven,
//    greedy bottoms mulligans + 1, then its usual keep rule) against the same opponent.
//  - Both branches run in interleaved batches on one persistent worker pool; after each batch the
//    two Wilson intervals of A's win rate are compared (sequentialCompare, src/sim/stats.ts) and
//    the run stops when they separate or both branches reach maxGames. Repeated looks make the
//    effective error rate higher than 5 percent: the verdict is a stopping rule, not a test.
//  - Goldfish: the same kept hand against a passive opponent (src/agents/passive.ts) gives the
//    average kill turn; the real keep-branch games give the turn A won on and the key cards online
//    by own turn N (decks/key-cards.json).
// Every number carries n and a 95 percent interval. Win rates reflect heuristic play, not perfect
// play. Each branch has its own seed stream and fixed-size blocks, so a report depends only on the
// seed, maxGames, batch and blockSize, never on the worker count.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defIdByName, findDef, getDef } from '../cards/index.js';
import { slug } from '../cards/dsl.js';
import { loadDeckFile, resolveDeck, type DeckList } from '../engine/setup.js';
import { seedRng } from '../engine/rng.js';
import { keptHandScore } from '../agents/greedy.js';
import { aggregate, defaultWorkers, makeBlocks } from '../sim/runner.js';
import { nextSeed, type Block, type BlockResult, type KeyCard, type MatchJob } from '../sim/games.js';
import { createPool, type Pool, type Task } from '../sim/pool.js';
import {
  fmtMean, fmtPct, fmtQuantile, quantileInterval, sequentialCompare, wilson, type MeanCI, type Proportion, type QuantileCI,
} from '../sim/stats.js';
import type { DefId } from '../engine/types.js';

export const HEURISTIC_SENTENCE = 'Win rates reflect heuristic play, not perfect play.';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY_CARDS_FILE = join(ROOT, 'decks', 'key-cards.json');
const HAND = 7;

export type Verdict = 'KEEP' | 'MULLIGAN' | 'TOO CLOSE TO CALL';

export interface HandOptions {
  /** Deck A card names: 7 cards, or 7 - mulligans when the bottom was already chosen. */
  hand: string[];
  onThePlay: boolean;
  /** Mulligans already taken (0 to 5). */
  mulligans: number;
  /** Pins the cards to bottom (7-card hand with mulligans > 0); default: the greedy bottoming heuristic. */
  bottom?: string[];
  seed: number;
  workers?: number;
  /** Cap per branch (keep and mulligan each). */
  maxGames?: number;
  /** Games per branch per look. */
  batch?: number;
  goldfishGames?: number;
  blockSize?: number;
  keyCardsFile?: string;
}

// maxGames 400 (PLAN.md D22 a, D27): the most work a run can do, 2 x 400 + 200 goldfish = 1,000 games, fits in 60 s on 8 workers with margin.
export const DEFAULTS = { maxGames: 400, batch: 100, goldfishGames: 200, blockSize: 5 } as const;

export interface BranchStats { win: Proportion; draws: Proportion; games: number }

export interface HandReport {
  input: {
    hand: string[]; onThePlay: boolean; mulligans: number; seed: number; maxGames: number; batch: number;
    goldfishGames: number; blockSize: number; workers: number;
    bottom: string[]; bottomSource: 'none' | 'greedy' | 'pinned' | 'already bottomed';
  };
  warnings: string[];
  verdict: Verdict;
  looks: number;
  keep: BranchStats;
  mulligan: BranchStats;
  /** Own turn A killed on against the passive opponent (over A's goldfish wins). */
  goldfishKillTurn: MeanCI;
  goldfishWin: Proportion;
  /** Own turn A won on in the real keep-branch games (over A's wins). */
  keepWinTurn: MeanCI;
  keyCards: { label: string; p: Proportion }[];
  games: number;
  seconds: number;
  /** Per-block games/sec on one core: median, order-statistic interval, n = blocks. */
  speed: QuantileCI;
  sentence: string;
}

// ---- input ------------------------------------------------------------------------------------

/**
 * Deck or front-face name, any case, to a def id; undefined when no card matches. A name with
 * ' // ' must be that card's full name ('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki'):
 * the back half is checked, so 'Fable ... // Reflection of Kiki-Jiki, Fatal Push' is not one card.
 */
export function cardId(name: string): DefId | undefined {
  const n = name.trim();
  const exact = defIdByName(n);
  if (exact) return exact;
  const halves = n.split(' // ');
  if (halves.length > 2) return undefined;
  const front = (halves[0] as string).trim();
  const s = defIdByName(front) ?? slug(front);
  const def = findDef(s);
  if (!def || def.layout === 'token' || def.testOnly) return undefined;
  if (halves.length === 2 && def.name.toLowerCase() !== n.replace(/\s+/g, ' ').toLowerCase()) return undefined;
  return s;
}

export interface ResolvedHand {
  hand: DefId[];
  bottom: DefId[];
  bottomSource: HandReport['input']['bottomSource'];
  deck: DeckList;
  warnings: string[];
}

const nameOf = (d: DefId): string => getDef(d).name;

function counts(ids: readonly DefId[]): Map<DefId, number> {
  const m = new Map<DefId, number>();
  for (const d of ids) m.set(d, (m.get(d) ?? 0) + 1);
  return m;
}

/**
 * The greedy bottoming heuristic: of every way to bottom n cards, keep the hand with the highest
 * keptHandScore (src/agents/greedy.ts); ties go to the first combination in hand order.
 */
export function greedyBottom(hand: readonly DefId[], n: number): DefId[] {
  if (n <= 0) return [];
  if (n >= hand.length) throw new Error(`greedyBottom: cannot bottom ${n} of ${hand.length} cards`);
  let best: number[] = [];
  let bestScore = -Infinity;
  const pick: number[] = [];
  const walk = (from: number): void => {
    if (pick.length === n) {
      const out = new Set(pick);
      const s = keptHandScore(hand.filter((_, i) => !out.has(i)));
      if (s > bestScore) { bestScore = s; best = [...pick]; }
      return;
    }
    for (let i = from; i < hand.length; i++) { pick.push(i); walk(i + 1); pick.pop(); }
  };
  walk(0);
  return best.map((i) => hand[i] as DefId);
}

/**
 * Validates the hand against decks/deckA.json. Unknown names, a wrong size, a hand that is not a
 * legal draw from the list (more copies of a card than the list has, or a card the list does not
 * run) and a bad bottom all throw with a message naming the problem.
 */
export function resolveHand(opts: Pick<HandOptions, 'hand' | 'mulligans' | 'bottom'>): ResolvedHand {
  const n = opts.mulligans;
  if (!Number.isInteger(n) || n < 0 || n > HAND - 2) throw new Error(`--mulligans must be 0 to ${HAND - 2}, got ${n}`);
  const unknown = opts.hand.filter((c) => cardId(c) === undefined);
  if (unknown.length) throw new Error(`no card named ${unknown.map((c) => `'${c}'`).join(', ')} (use the decklist names, for example 'Blood Crypt')`);
  const hand = opts.hand.map((c) => cardId(c) as DefId);
  if (hand.length !== HAND && hand.length !== HAND - n) {
    throw new Error(`the hand has ${hand.length} cards; after ${n} mulligan(s) give the 7 cards drawn${n > 0 ? ` or the ${HAND - n} kept` : ''}`);
  }
  const warnings: string[] = [];
  const deck = loadDeckFile('deckA');
  const have = counts(resolveDeck(deck));
  const extra: string[] = [];
  for (const [d, k] of counts(hand)) {
    const inList = have.get(d) ?? 0;
    if (k > inList) extra.push(`${k} x ${nameOf(d)} (the list has ${inList})`);
  }
  if (extra.length) {
    throw new Error(`illegal hand: it is not a legal draw from decks/deckA.json (the 60-card main deck): ${extra.join('; ')}. Fix the hand and run again.`);
  }
  let bottom: DefId[] = [];
  let bottomSource: ResolvedHand['bottomSource'] = 'none';
  if (opts.bottom && opts.bottom.length > 0) {
    if (n === 0) throw new Error('--bottom needs --mulligans 1 or more');
    if (hand.length !== HAND) throw new Error(`--bottom needs the 7 cards drawn; this hand of ${hand.length} is already bottomed`);
    const bad = opts.bottom.filter((c) => cardId(c) === undefined);
    if (bad.length) throw new Error(`no card named ${bad.map((c) => `'${c}'`).join(', ')} in --bottom`);
    bottom = opts.bottom.map((c) => cardId(c) as DefId);
    if (bottom.length !== n) throw new Error(`--bottom names ${bottom.length} card(s); after ${n} mulligan(s) it must name ${n}`);
    const h = counts(hand);
    for (const [d, k] of counts(bottom)) {
      if ((h.get(d) ?? 0) < k) throw new Error(`--bottom: the hand does not hold ${k} x ${nameOf(d)}`);
    }
    bottomSource = 'pinned';
  } else if (n > 0 && hand.length === HAND) {
    bottom = greedyBottom(hand, n);
    bottomSource = 'greedy';
  } else if (n > 0) {
    bottomSource = 'already bottomed';
    warnings.push(`the ${n} bottomed card(s) are not known, so they are modeled as random cards from the rest of the deck.`);
  }
  return { hand, bottom, bottomSource, deck, warnings };
}

interface KeyCardEntry { label?: string; side?: 'A' | 'B'; how?: string; cards?: string[]; count?: number; byTurn?: number }

/** Reads the key-card list (default decks/key-cards.json); every entry is validated. */
export function loadKeyCards(file = KEY_CARDS_FILE): KeyCard[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { keyCards?: KeyCardEntry[] };
  if (!Array.isArray(raw.keyCards)) throw new Error(`${file}: no keyCards array`);
  return raw.keyCards.map((e, i): KeyCard => {
    const where = `${file}: keyCards[${i}]`;
    if (typeof e.label !== 'string' || !e.label) throw new Error(`${where}: label missing`);
    if (!Number.isInteger(e.byTurn) || (e.byTurn as number) < 1) throw new Error(`${where}: byTurn must be a positive integer`);
    const side = e.side ?? 'A';
    if (side !== 'A' && side !== 'B') throw new Error(`${where}: side must be A or B`);
    if (e.how === 'lands') {
      if (!Number.isInteger(e.count) || (e.count as number) < 1) throw new Error(`${where}: 'lands' needs a positive count`);
      return { label: e.label, side, defIds: [], byTurn: e.byTurn as number, how: 'lands', count: e.count as number };
    }
    if (e.how !== 'cast' && e.how !== 'battlefield') throw new Error(`${where}: how must be lands, cast or battlefield`);
    if (!Array.isArray(e.cards) || e.cards.length === 0) throw new Error(`${where}: cards missing`);
    const defIds = e.cards.map((c) => {
      const d = cardId(c);
      if (!d) throw new Error(`${where}: no card named '${c}'`);
      return d;
    });
    return { label: e.label, side, defIds, byTurn: e.byTurn as number, how: e.how };
  });
}

// ---- run --------------------------------------------------------------------------------------

export interface HandDeps {
  /** Replaces the worker pool (tests script the games). */
  pool?: Pool;
  /** Called after each look with the running intervals. */
  onLook?: (look: number, keep: Proportion, mull: Proportion) => void;
}

function takeBlocks(queue: Block[], games: number): Block[] {
  const out: Block[] = [];
  let g = 0;
  while (g < games && queue.length > 0) {
    const b = queue.shift() as Block;
    out.push(b);
    g += b.games;
  }
  return out;
}

function winsOf(rs: readonly BlockResult[]): [number, number] {
  let k = 0;
  let n = 0;
  for (const r of rs) for (const g of r.games) { n++; if (g.winner === 'A') k++; }
  return [k, n];
}

export async function analyzeHand(opts: HandOptions, deps: HandDeps = {}): Promise<HandReport> {
  const t0 = performance.now();
  const maxGames = opts.maxGames ?? DEFAULTS.maxGames;
  const batch = opts.batch ?? DEFAULTS.batch;
  const goldfishGames = opts.goldfishGames ?? DEFAULTS.goldfishGames;
  const blockSize = opts.blockSize ?? DEFAULTS.blockSize;
  for (const [k, v] of [['maxGames', maxGames], ['batch', batch], ['blockSize', blockSize]] as const) {
    if (!Number.isSafeInteger(v) || v < 1) throw new Error(`${k} must be a positive integer, got ${v}`);
  }
  if (!Number.isSafeInteger(goldfishGames) || goldfishGames < 0) throw new Error(`goldfishGames must be 0 or more, got ${goldfishGames}`);
  const r = resolveHand(opts);
  const keyCards = loadKeyCards(opts.keyCardsFile);
  const play = opts.onThePlay ? 'A' as const : 'B' as const;
  const keepJob: MatchJob = {
    deckA: r.deck, deckB: 'deckB', agentA: { kind: 'greedy' }, agentB: { kind: 'greedy' }, play, keyCards,
    handSetup: { branch: 'keep', mulligans: opts.mulligans, hand: r.hand, bottom: r.bottom },
  };
  const mullJob: MatchJob = {
    deckA: r.deck, deckB: 'deckB', agentA: { kind: 'greedy' }, agentB: { kind: 'greedy' }, play,
    handSetup: { branch: 'mulligan', mulligans: opts.mulligans },
  };
  const goldJob: MatchJob = { ...keepJob, agentB: { kind: 'passive' }, keyCards: [] };
  // One stream per branch (and one for the goldfish), fixed-size blocks: independent samples, and
  // the same games whatever the worker count.
  const master = seedRng(opts.seed);
  const keepQ = makeBlocks(maxGames, nextSeed(master), blockSize);
  const mullQ = makeBlocks(maxGames, nextSeed(master), blockSize);
  const goldSeed = nextSeed(master);
  const goldQ = goldfishGames > 0 ? makeBlocks(goldfishGames, goldSeed, blockSize) : [];
  const workers = deps.pool ? deps.pool.workers : opts.workers ?? defaultWorkers();
  const pool = deps.pool ?? createPool(workers);
  const keepRes: BlockResult[] = [];
  const mullRes: BlockResult[] = [];
  const goldRes: BlockResult[] = [];
  let seq: Awaited<ReturnType<typeof sequentialCompare>>;
  try {
    seq = await sequentialCompare(async (want, look) => {
      const kb = takeBlocks(keepQ, want);
      const mb = takeBlocks(mullQ, want);
      const tasks: Task[] = [];
      const kind: ('k' | 'm' | 'g')[] = [];
      for (let i = 0; i < Math.max(kb.length, mb.length); i++) {
        const k = kb[i];
        const m = mb[i];
        if (k) { tasks.push({ job: keepJob, block: k }); kind.push('k'); }
        if (m) { tasks.push({ job: mullJob, block: m }); kind.push('m'); }
      }
      // The goldfish games ride on the first look, after the branch blocks (they are the fast ones).
      if (look === 0) for (const g of goldQ) { tasks.push({ job: goldJob, block: g }); kind.push('g'); }
      const res = await pool.run(tasks);
      const k: BlockResult[] = [];
      const m: BlockResult[] = [];
      res.forEach((x, i) => { (kind[i] === 'k' ? k : kind[i] === 'm' ? m : goldRes).push(x); });
      keepRes.push(...k);
      mullRes.push(...m);
      if (deps.onLook) {
        const [ka, na] = winsOf(keepRes);
        const [km, nm] = winsOf(mullRes);
        deps.onLook(look + 1, wilson(ka, na), wilson(km, nm));
      }
      return { a: winsOf(k), b: winsOf(m) };
    }, { batch, maxN: maxGames });
  } finally {
    if (!deps.pool) await pool.close();
  }
  const keepAgg = aggregate(keepRes, keepJob, workers, 1);
  const mullAgg = aggregate(mullRes, mullJob, workers, 1);
  const goldAgg = aggregate(goldRes, goldJob, workers, 1);
  const all = [...keepRes, ...mullRes, ...goldRes];
  const seconds = (performance.now() - t0) / 1000;
  return {
    input: {
      hand: r.hand.map(nameOf), onThePlay: opts.onThePlay, mulligans: opts.mulligans, seed: opts.seed, maxGames, batch,
      goldfishGames, blockSize, workers: pool.workers, bottom: r.bottom.map(nameOf), bottomSource: r.bottomSource,
    },
    warnings: r.warnings,
    verdict: seq.verdict === 'A' ? 'KEEP' : seq.verdict === 'B' ? 'MULLIGAN' : 'TOO CLOSE TO CALL',
    looks: seq.looks,
    keep: { win: keepAgg.winA, draws: keepAgg.draws, games: keepAgg.games },
    mulligan: { win: mullAgg.winA, draws: mullAgg.draws, games: mullAgg.games },
    goldfishKillTurn: goldAgg.killTurnA,
    goldfishWin: goldAgg.winA,
    keepWinTurn: keepAgg.killTurnA,
    keyCards: keepAgg.keyCards,
    games: all.reduce((s, x) => s + x.games.length, 0),
    seconds,
    speed: quantileInterval(all.filter((x) => x.seconds > 0).map((x) => x.games.length / x.seconds), 0.5),
    sentence: HEURISTIC_SENTENCE,
  };
}

// ---- output -----------------------------------------------------------------------------------

function fmtTurn(m: MeanCI, what: string): string {
  if (m.n === 0) return `no ${what} [95% CI undefined, n=0]`;
  if (m.n === 1) return `${m.mean.toFixed(2)} [95% CI undefined with one game, n=1]`;
  return fmtMean(m);
}

export function fmtSpeedLine(r: Pick<HandReport, 'speed' | 'seconds' | 'games' | 'input'>): string {
  const q = r.speed;
  const rate = q.n > 0
    ? `median ${fmtQuantile(q, { digits: 2, after: ' games/sec/core', unit: 'blocks', note: 'one worker thread per block' })}`
    : 'no timed blocks [95% CI undefined, n=0 blocks]';
  const where = r.input.workers === 0 ? 'this thread' : `${r.input.workers} workers`;
  return `speed: ${rate}; elapsed ${r.seconds.toFixed(1)} s wall for ${r.games} games on ${where}`;
}

/**
 * The text report. A line with a number either echoes the input, states a note, a warning or the
 * sample sizes (labels 'input:', 'note:', 'WARNING:', 'sample:') or carries n and a 95 percent
 * interval.
 */
export function formatHandReport(r: HandReport): string {
  const i = r.input;
  const nextSize = HAND - i.mulligans - 1;
  const bottom = i.bottomSource === 'none' ? 'none (no mulligan taken)'
    : i.bottomSource === 'already bottomed' ? 'already chosen by the player'
      : `${i.bottom.join(', ')} (${i.bottomSource === 'greedy' ? 'greedy bottoming heuristic' : 'pinned with --bottom'})`;
  const why = r.verdict === 'TOO CLOSE TO CALL'
    ? `the intervals still overlap at the cap of ${i.maxGames} games per branch`
    : `the intervals separated after ${r.looks} look(s) of up to ${i.batch} games per branch`;
  const lines = [
    `input: Rakdos Midrange (deck A) ${i.onThePlay ? 'on the play' : 'on the draw'}, ${i.mulligans} mulligan(s) taken, seed ${i.seed}, max ${i.maxGames} games per branch, batch ${i.batch}`,
    `input: hand (${i.hand.length} cards): ${i.hand.join(', ')}`,
    `input: bottom: ${bottom}`,
    ...r.warnings.map((w) => `WARNING: ${w}`),
    `verdict: ${r.verdict}`,
    `  keep this hand: A wins ${fmtPct(r.keep.win)} vs greedy Mono-Red`,
    `  mulligan to ${nextSize}: A wins ${fmtPct(r.mulligan.win)} vs greedy Mono-Red`,
    `note: stopped because ${why}; the rule looks repeatedly, so it is a stopping rule, not a significance test.`,
    'keep branch:',
    `  kill turn vs a passive opponent (own turns): ${fmtTurn(r.goldfishKillTurn, 'goldfish kill')}`,
    `  turn A won on vs greedy Mono-Red (own turns, over A's wins): ${fmtTurn(r.keepWinTurn, 'win')}`,
    ...r.keyCards.map((k) => `  ${k.label}: ${fmtPct(k.p)}`),
    `  draws: ${fmtPct(r.keep.draws)}`,
    `sample: n=${r.games} games in total (keep n=${r.keep.games}, mulligan n=${r.mulligan.games}, goldfish n=${r.goldfishWin.n})`,
    fmtSpeedLine(r),
    r.sentence,
  ];
  return lines.join('\n');
}
