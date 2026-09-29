// One block of agent-vs-agent games (the unit of work the runner hands to a worker; also run
// in-process). Deck A is always player 0 and deck B player 1. Each block owns an RNG stream
// (jump()-separated by the runner) from which every game draws its game seed and both agent
// seeds, so a block's result depends only on its stream and its first game index, never on which
// worker ran it or how many workers there were.
import { newGame, type DeckInput } from '../engine/setup.js';
import { applyMoveInPlace } from '../engine/apply.js';
import { setTurnEndObserver } from '../engine/turn.js';
import { decider, legalMoves } from '../engine/moves.js';
import { view } from '../engine/view.js';
import { invalidateMemo } from '../engine/mutate.js';
import { nextU32 } from '../engine/rng.js';
import { defIdByName, findDef } from '../cards/index.js';
import { slug } from '../cards/dsl.js';
import { CAPS, CapHit, checkInvariants } from '../tools/play.js';
import { randomAgent } from '../agents/random.js';
import { greedyAgent, type GreedyOptions } from '../agents/greedy.js';
import { passiveAgent } from '../agents/passive.js';
import { mctsAgent, type MctsOptions } from '../agents/mcts-agent.js';
import { applyHandSetup, type HandSetup } from './hand-setup.js';
import { openBlockLog, snapSearch, type BlockLog, type GameMeta } from './decision-log.js';
import { sampleHidden } from '../agents/sample.js';
import { isLandDef, ownTurns } from '../agents/evaluate.js';
import type { Agent, AgentKind } from '../agents/types.js';
import type { DefId, GameState, Move, PlayerId, RngState } from '../engine/types.js';

export type Side = 'A' | 'B';
export type PlayMode = 'A' | 'B' | 'alternate' | 'random';

export interface AgentSpec { kind: AgentKind; deck?: GreedyOptions['deck']; /** ISMCTS budget (kind 'mcts'). */ mcts?: Omit<MctsOptions, 'decks' | 'name'> }

/**
 * A card (or group) counted as online when it is on the battlefield, or cast, by the player's own
 * turn N; with how 'lands', when the player controls at least 'count' lands by own turn N (defIds
 * unused).
 */
export interface KeyCard { label: string; side: Side; defIds: DefId[]; byTurn: number; how: 'battlefield' | 'cast' | 'lands'; count?: number }

export interface MatchJob {
  deckA: DeckInput;
  deckB: DeckInput;
  agentA: AgentSpec;
  agentB: AgentSpec;
  play: PlayMode;
  /** Replaces one side's opening seven with these card names (before the mulligan decision). */
  openingHand?: { side: Side; cards: string[] };
  /** Phase 3 hand tool: A's pregame from a given hand and mulligan count (src/sim/hand-setup.ts). */
  handSetup?: HandSetup;
  keyCards?: KeyCard[];
  /** Check fuzz invariants 1 to 5 after every move (slower). Legality is always checked. */
  check?: boolean;
  /** Phase 6 decision log: directory for per-block part files (set by src/tools/selfplay-log.ts; src/sim/decision-log.ts). */
  log?: string;
}

export interface Block { index: number; first: number; games: number; rng: RngState }

export interface GameSummary {
  /** Global game index. */
  i: number;
  winner: Side | 'draw';
  reason: string;
  /** Turns played (both players' turns; state.turn at the end). */
  turns: number;
  /** The winner's own turn count when the game ended (null for a draw). */
  killTurn: number | null;
  aOnPlay: boolean;
  /** One flag per job.keyCards entry. */
  key: boolean[];
  moves: number;
}

export interface BlockResult {
  index: number;
  games: GameSummary[];
  /** Agent decisions whose chosen move was checked against the legal move list (an illegal one throws). */
  decisions: number;
  invariantChecks: number;
  seconds: number;
}

export const DEFAULT_KEY_CARDS: readonly KeyCard[] = [
  { label: 'A: Fable of the Mirror-Breaker on the battlefield by own turn 3', side: 'A', defIds: ['fable-of-the-mirror-breaker'], byTurn: 3, how: 'battlefield' },
  { label: 'A: Sheoldred on the battlefield by own turn 4', side: 'A', defIds: ['sheoldred-the-apocalypse'], byTurn: 4, how: 'battlefield' },
  { label: 'A: removal cast by own turn 2', side: 'A', defIds: ['fatal-push', 'go-for-the-throat', 'bitter-triumph', 'abrade'], byTurn: 2, how: 'cast' },
  { label: 'B: Kumano Faces Kakkazan cast on own turn 1', side: 'B', defIds: ['kumano-faces-kakkazan'], byTurn: 1, how: 'cast' },
];

const sideOf = (p: PlayerId): Side => (p === 0 ? 'A' : 'B');
const playerOf = (s: Side): PlayerId => (s === 'A' ? 0 : 1);

/** A safe integer (53 bits) from the stream. */
export function nextSeed(rng: RngState): number {
  return nextU32(rng) * 2097152 + (nextU32(rng) >>> 11);
}

export function makeAgent(spec: AgentSpec, seed: number, decks?: [DeckInput, DeckInput]): Agent {
  if (spec.kind === 'mcts') return mctsAgent(seed, { ...spec.mcts, ...(decks ? { decks } : {}) });
  if (spec.kind === 'random') return randomAgent(seed);
  if (spec.kind === 'greedy') return greedyAgent(seed, spec.deck ? { deck: spec.deck } : {});
  if (spec.kind === 'passive') return passiveAgent();
  throw new Error(`unknown agent kind ${String((spec as AgentSpec).kind)}`);
}

/**
 * Puts the named cards in p's opening hand by swapping card identities between hand and library
 * objects (setup only, before any decision). Ids keep their shuffled order, and each displaced
 * hand card lands where the wanted card was, a uniformly random library slot.
 */
export function fixOpeningHand(state: GameState, p: PlayerId, names: readonly string[]): void {
  const want: DefId[] = names.map((n) => {
    // Full names ('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki') or front-face names.
    const d = defIdByName(n) ?? (findDef(slug(n)) ? slug(n) : undefined);
    if (!d) throw new Error(`fixOpeningHand: no card named ${n}`);
    return d;
  });
  const hand = state.zones.hand[p];
  if (want.length !== hand.length) throw new Error(`fixOpeningHand: ${want.length} names for a hand of ${hand.length}`);
  const handDefs = hand.map((id) => state.objects[id]?.defId as DefId);
  // Hand slots that already hold a wanted card keep it.
  const need = [...want];
  const free: number[] = [];
  handDefs.forEach((d, i) => {
    const k = need.indexOf(d);
    if (k >= 0) need.splice(k, 1);
    else free.push(i);
  });
  const lib = state.zones.library[p];
  for (const d of need) {
    const libId = lib.find((id) => state.objects[id]?.defId === d);
    if (libId === undefined) throw new Error(`fixOpeningHand: the deck has no more copies of ${d}`);
    const slot = free.shift() as number;
    const handObj = state.objects[hand[slot] as number];
    const libObj = state.objects[libId];
    if (!handObj || !libObj) throw new Error('fixOpeningHand: dangling id');
    libObj.defId = handObj.defId;
    handObj.defId = d;
  }
  invalidateMemo(state);
}

/**
 * Asks the agent for a move and checks it is one of the legal moves (by identity, else by value);
 * an illegal move throws.
 */
export function checkedChoice(agent: Agent, state: GameState, p: PlayerId, legal: readonly Move[], where: string): Move {
  const move = agent.choose({ player: p, moves: legal, view: () => view(state, p), sample: (r) => sampleHidden(state, p, r) });
  if (!legal.includes(move)) {
    const js = JSON.stringify(move);
    if (!legal.some((m) => JSON.stringify(m) === js)) throw new Error(`${where}: ${agent.name} picked an illegal move ${js}`);
  }
  return move;
}

function playOne(job: MatchJob, i: number, rng: RngState, log: BlockLog | null = null): { g: GameSummary; decisions: number; checks: number } {
  const gameSeed = nextSeed(rng);
  const seedA = nextSeed(rng);
  const seedB = nextSeed(rng);
  const onThePlay: PlayerId | 'random' = job.play === 'A' ? 0 : job.play === 'B' ? 1 : job.play === 'alternate' ? ((i % 2) as PlayerId) : 'random';
  let state = newGame(job.deckA, job.deckB, gameSeed, onThePlay);
  if (job.openingHand) fixOpeningHand(state, playerOf(job.openingHand.side), job.openingHand.cards);
  if (job.handSetup) applyHandSetup(state, job.handSetup);
  const agents: [Agent, Agent] = [makeAgent(job.agentA, seedA, [job.deckA, job.deckB]), makeAgent(job.agentB, seedB, [job.deckA, job.deckB])];
  const meta: GameMeta | null = log ? { game: i, seed: gameSeed, agents: { A: job.agentA.kind, B: job.agentB.kind } } : null;
  const keys = job.keyCards ?? [];
  const key = keys.map(() => false);
  const deckSize: [number, number] = [0, 0];
  for (const o of Object.values(state.objects)) deckSize[o.owner]++;
  let decisions = 0;
  let checks = 0;
  let moves = 0;
  let turnMoves = 0;
  let lastTurn = state.turn;
  const markKeys = (s: GameState, move: Move | null, mover: PlayerId | null): void => {
    keys.forEach((k, j) => {
      if (key[j]) return;
      const p = playerOf(k.side);
      if (ownTurns(s, p) > k.byTurn) return;
      if (k.how === 'lands') {
        let lands = 0;
        for (const id of s.zones.battlefield) {
          const o = s.objects[id];
          if (o !== undefined && o.controller === p && isLandDef(o.defId)) lands++;
        }
        key[j] = lands >= (k.count ?? 1);
      } else if (k.how === 'battlefield') {
        key[j] = s.zones.battlefield.some((id) => {
          const o = s.objects[id];
          return o !== undefined && o.controller === p && k.defIds.includes(o.defId);
        });
      } else if (move && mover === p && move.type === 'cast') {
        const d = s.objects[move.objId]?.defId;
        if (d && k.defIds.includes(d)) key[j] = true;
      }
    });
  };
  const endOfTurn = (s: GameState): void => markKeys(s, null, null);
  while (!state.result) {
    const p = decider(state);
    if (p === null) break;
    const legal = legalMoves(state, p);
    if (legal.length === 0) throw new Error(`game ${i}: no legal moves for player ${p} at turn ${state.turn}`);
    const before = log ? snapSearch(agents[p]) : null;
    const move = checkedChoice(agents[p], state, p, legal, `game ${i}`);
    if (log) log.decision(state, p, legal, move, agents[p], before, meta as GameMeta);
    decisions++;
    markKeys(state, move, p);
    // The engine plays on to the next decision, which may be turns later; the observer also looks
    // at the end of every turn in between, so a land played as the last decision of own turn N
    // still counts for 'N lands by own turn N'. Set only around the real game's move, never
    // while an agent searches.
    if (keys.length > 0) setTurnEndObserver(endOfTurn);
    try {
      state = applyMoveInPlace(state, move);
    } finally {
      setTurnEndObserver(null);
    }
    moves++;
    if (job.check) { checkInvariants(state, deckSize); checks++; }
    markKeys(state, null, null);
    if (state.turn !== lastTurn) { lastTurn = state.turn; turnMoves = 0; }
    turnMoves++;
    if (turnMoves > CAPS.movesPerTurn) throw new CapHit(`game ${i}: ${turnMoves} moves in turn ${state.turn}`);
    if (moves > CAPS.movesPerGame) throw new CapHit(`game ${i}: ${moves} moves`);
    if (state.turn > CAPS.turns) throw new CapHit(`game ${i}: turn ${state.turn}`);
  }
  const res = state.result;
  const winner: Side | 'draw' = !res || res.winner === 'draw' ? 'draw' : sideOf(res.winner);
  if (log) log.end(state, { winner, reason: res?.reason ?? 'no result', turns: state.turn, aOnPlay: state.startingPlayer === 0 }, meta as GameMeta);
  return {
    g: {
      i, winner, reason: res?.reason ?? 'no result', turns: state.turn,
      killTurn: res && res.winner !== 'draw' ? ownTurns(state, res.winner) : null,
      aOnPlay: state.startingPlayer === 0, key, moves,
    },
    decisions, checks,
  };
}

export function runBlock(job: MatchJob, block: Block): BlockResult {
  const t0 = performance.now();
  const rng: RngState = [...block.rng] as RngState;
  const out: BlockResult = { index: block.index, games: [], decisions: 0, invariantChecks: 0, seconds: 0 };
  const log = job.log ? openBlockLog(job.log, block.index) : null;
  try {
    for (let k = 0; k < block.games; k++) {
      const r = playOne(job, block.first + k, rng, log);
      out.games.push(r.g);
      out.decisions += r.decisions;
      out.invariantChecks += r.checks;
    }
  } finally {
    log?.close();
  }
  out.seconds = (performance.now() - t0) / 1000;
  return out;
}
