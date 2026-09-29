// Random-vs-random fuzzer (PLAN.md section 7). Every applyMove is followed by invariants 1-5, the
// caps of invariant 6 (per turn, per game, turns; the applyMove loop cap throws inside the
// engine), invariant 7 (the first 1,000 games are replayed from their seeds in copy mode and
// compared move by move, which also checks copy mode against in-place mode) and invariant 8 (a
// view leak check every 100th state). A cap hit, an invariant failure or an engine exception fails
// the run and writes the seed, agent seeds and move list to out/.
//
// Usage: node --import tsx src/tools/fuzz.ts [--games N] [--seed S] [--pool test|extended|decks|sideboard]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../test/helpers.js';
import { EXTENDED_DECK_A, EXTENDED_DECK_B, sideboardDeck, TEST_POOL_DECK } from '../test/pool.js';
import { randomAgent } from '../agents/random.js';
import { CapHit, playGame, type GameRecord } from './play.js';
import { loadDeckFile, type DeckInput } from '../engine/setup.js';
import { defIdByName, getDef } from '../cards/index.js';
import type { Move } from '../engine/types.js';
import { fmtMean, fmtQuantile, quantileInterval, tInterval, type MeanCI, type QuantileCI } from '../sim/stats.js';

export type PoolName = 'test' | 'extended' | 'decks' | 'sideboard';

export function poolDecks(pool: PoolName): [DeckInput, DeckInput] {
  if (pool === 'test') return [TEST_POOL_DECK, TEST_POOL_DECK];
  if (pool === 'extended') return [EXTENDED_DECK_A, EXTENDED_DECK_B];
  if (pool === 'sideboard') return [sideboardDeck('deckA'), sideboardDeck('deckB')];
  return ['deckA', 'deckB'];
}

export interface FuzzReport {
  pool: PoolName;
  games: number;
  moves: number;
  capHits: number;
  failures: { seed: number; error: string; file?: string }[];
  /** Mean turns per completed game with its 95 percent t interval (n = completed games). */
  turns: MeanCI;
  maxTurns: number;
  maxMovesInTurn: number;
  invariantChecks: number;
  viewChecks: number;
  replayed: number;
  results: { p0: number; p1: number; draw: number };
  seconds: number;
  /** Wall milliseconds per game, checks and replays included: median with its order-statistic interval, n = completed games. */
  gameMs: QuantileCI;
  /** Moves that cast, played, activated or unlocked each def (by def id). */
  used: Record<string, number>;
  /** Real card names in the two lists that no move ever used (empty for the test pools). */
  neverUsed: string[];
}

const REPLAY_GAMES = 1000;
const VIEW_EVERY = 100;

export function agentSeedsFor(seed: number): [number, number] {
  return [seed * 2 + 1_000_003, seed * 2 + 1_000_004];
}

function writeFailure(outDir: string | null, pool: PoolName, seed: number, agentSeeds: [number, number], moves: Move[], error: string): string | undefined {
  if (!outDir) return undefined;
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `fuzz-fail-${pool}-${seed}.json`);
  writeFileSync(file, JSON.stringify({ pool, seed, agentSeeds, error, moves }, null, 1));
  return file;
}

export function runFuzz(opts: { games: number; seed?: number; pool?: PoolName; outDir?: string | null; replay?: number }): FuzzReport {
  const pool = opts.pool ?? 'test';
  const [deckA, deckB] = poolDecks(pool);
  const base = opts.seed ?? 1;
  const replayN = Math.min(opts.replay ?? REPLAY_GAMES, opts.games);
  const outDir = opts.outDir === undefined ? null : opts.outDir;
  const rep: FuzzReport = {
    pool, games: 0, moves: 0, capHits: 0, failures: [], turns: tInterval([]), maxTurns: 0, maxMovesInTurn: 0,
    invariantChecks: 0, viewChecks: 0, replayed: 0, results: { p0: 0, p1: 0, draw: 0 }, seconds: 0, gameMs: quantileInterval([], 0.5), used: {}, neverUsed: [],
  };
  const t0 = performance.now();
  const turns: number[] = [];
  const gameMs: number[] = [];
  const counter = { n: 0 };
  for (let i = 0; i < opts.games; i++) {
    const seed = base + i;
    const agentSeeds = agentSeedsFor(seed);
    const agents = [randomAgent(agentSeeds[0]), randomAgent(agentSeeds[1])] as const;
    const replay = i < replayN;
    let rec: GameRecord | null = null;
    const g0 = performance.now();
    try {
      rec = playGame(deckA, deckB, seed, [agents[0], agents[1]], agentSeeds, { check: true, hash: replay, viewEvery: VIEW_EVERY, counter, used: rep.used });
      if (replay) {
        // Invariant 7: same seeds, copy mode; the agents must pick the same moves and every state must hash the same.
        const again = playGame(deckA, deckB, seed, [randomAgent(agentSeeds[0]), randomAgent(agentSeeds[1])], agentSeeds, { hash: true, copy: true });
        if (again.moves.length !== rec.moves.length) throw new Error(`inv7: replay has ${again.moves.length} moves, original ${rec.moves.length}`);
        for (let k = 0; k < rec.moves.length; k++) {
          if (JSON.stringify(again.moves[k]) !== JSON.stringify(rec.moves[k]) || again.hashes[k] !== rec.hashes[k]) {
            throw new Error(`inv7: replay diverges at move ${k}`);
          }
        }
        rep.replayed++;
      }
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      if (e instanceof CapHit) rep.capHits++;
      const moves = rec?.moves ?? [];
      rep.failures.push({ seed, error: msg, ...(outDir ? { file: writeFailure(outDir, pool, seed, agentSeeds, moves, `${msg}\n${e instanceof Error ? e.stack ?? '' : ''}`) as string } : {}) });
      rep.games++;
      continue;
    }
    gameMs.push(performance.now() - g0);
    rep.games++;
    rep.moves += rec.moves.length;
    rep.invariantChecks += rec.checks;
    rep.viewChecks += rec.viewChecks;
    turns.push(rec.turns);
    if (rec.turns > rep.maxTurns) rep.maxTurns = rec.turns;
    if (rec.maxMovesInTurn > rep.maxMovesInTurn) rep.maxMovesInTurn = rec.maxMovesInTurn;
    const w = rec.result?.winner;
    if (w === 0) rep.results.p0++;
    else if (w === 1) rep.results.p1++;
    else rep.results.draw++;
  }
  rep.seconds = (performance.now() - t0) / 1000;
  const names = new Set<string>();
  for (const d of [deckA, deckB]) for (const e of (typeof d === 'string' ? loadDeckFile(d) : d).main) names.add(e.name);
  rep.neverUsed = [...names].filter((n) => { const id = defIdByName(n); return id !== undefined && !getDef(id).testOnly && !rep.used[id]; });
  rep.turns = tInterval(turns);
  rep.gameMs = quantileInterval(gameMs, 0.5);
  return rep;
}

export function formatReport(r: FuzzReport): string {
  return [
    `fuzz pool=${r.pool}`,
    `  games            ${r.games}`,
    `  moves            ${r.moves}`,
    `  cap hits         ${r.capHits} (must be 0)`,
    `  failures         ${r.failures.length} (must be 0)`,
    `  mean turns       ${fmtMean(r.turns)} (completed games)`,
    `  max turns        ${r.maxTurns} (the largest of n=${r.turns.n} completed games; a check against the turn cap, not an estimate)`,
    `  max moves/turn   ${r.maxMovesInTurn} (the largest over n=${r.turns.n} completed games; a check against the per-turn cap, not an estimate)`,
    `  invariant checks ${r.invariantChecks} (invariants 1-5 after every applyMove)`,
    `  view checks      ${r.viewChecks} (invariant 8, every ${VIEW_EVERY}th state, both players)`,
    `  replayed         ${r.replayed} games (invariant 7, copy mode vs in-place)`,
    `  results          p0 ${r.results.p0}, p1 ${r.results.p1}, draw ${r.results.draw}`,
    `  cards used       ${Object.keys(r.used).length} distinct defs cast, played, activated or unlocked; never used: ${r.neverUsed.length ? r.neverUsed.join(', ') : 'none'}`,
    `  time per game    median ${fmtQuantile(r.gameMs, { digits: 1, after: ' ms', unit: 'games', note: 'checks and replays included' })}`,
    `  total time       ${r.seconds.toFixed(1)} s wall for ${r.games} games (one run, a measurement, not an estimate)`,
    ...r.failures.slice(0, 5).map((f) => `  FAIL seed ${f.seed}: ${f.error}${f.file ? ` -> ${f.file}` : ''}`),
  ].join('\n');
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const games = Number(arg('--games') ?? 10000);
  const seed = Number(arg('--seed') ?? 1);
  const pool = (arg('--pool') ?? 'test') as PoolName;
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
  const r = runFuzz({ games, seed, pool, outDir });
  console.log(formatReport(r));
  process.exit(r.failures.length === 0 && r.capHits === 0 && r.games === games ? 0 : 1);
}
