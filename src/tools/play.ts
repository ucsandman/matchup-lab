// One game between two agents, with optional per-move invariant checks (PLAN.md section 7,
// invariants 1-8) and termination caps (invariant 6). Shared by fuzz.ts, bench.ts and the vitest
// fuzz suite.
import { newGame, type DeckInput } from '../engine/setup.js';
import { applyMove, applyMoveInPlace } from '../engine/apply.js';
import { decider, legalMoves } from '../engine/moves.js';
import { view } from '../engine/view.js';
import { sampleHidden } from '../agents/sample.js';
import type { Agent } from '../agents/types.js';
import type { GameState, Move, ObjId, PlayerId } from '../engine/types.js';

export const CAPS = { movesPerTurn: 1000, movesPerGame: 20000, turns: 200 } as const;

export class CapHit extends Error {}
export class InvariantFailure extends Error {}

export interface GameRecord {
  seed: number;
  agentSeeds: [number, number];
  moves: Move[];
  /** FNV-1a hash of the state after each move (only when hashing is on). */
  hashes: number[];
  turns: number;
  maxMovesInTurn: number;
  result: GameState['result'];
  checks: number;
  viewChecks: number;
}

export interface PlayOpts {
  check?: boolean;
  hash?: boolean;
  /** Copy mode (applyMove) instead of in-place (journal-mode code path). */
  copy?: boolean;
  /** View leak check every Nth state (invariant 8). 0 = never. */
  viewEvery?: number;
  deckSize?: [number, number];
  /** Shared state counter so 'every Nth state' spans games. */
  counter?: { n: number };
  /** When given, counts by def id every object a move casts, plays, activates or unlocks. */
  used?: Record<string, number>;
}

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function stateHash(state: GameState): number {
  const { journal: _j, ...rest } = state;
  return fnv1a(JSON.stringify(rest));
}

const fail = (msg: string): never => { throw new InvariantFailure(msg); };
const isInt = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n) && Number.isFinite(n);

/** Invariants 1-5 (PLAN.md section 7). Throws InvariantFailure. */
export function checkInvariants(state: GameState, deckSize: [number, number]): void {
  // 2. Zone consistency: each object in exactly one zone array, and object.zone matches.
  const where = new Map<ObjId, string>();
  const put = (id: ObjId, z: string): void => {
    if (where.has(id)) fail(`inv2: object ${id} in ${where.get(id)} and ${z}`);
    where.set(id, z);
    const o = state.objects[id];
    if (!o) fail(`inv2: dangling id ${id} in ${z}`);
    else if (o.zone !== z.split(':')[0]) fail(`inv2: object ${id} zone ${o.zone} listed in ${z}`);
  };
  for (const z of ['library', 'hand', 'graveyard', 'exile'] as const) {
    for (const p of [0, 1] as const) for (const id of state.zones[z][p]) {
      put(id, `${z}:${p}`);
      if (state.objects[id]?.owner !== p) fail(`inv2: ${id} in ${z} of ${p} but owned by ${state.objects[id]?.owner}`);
    }
  }
  for (const id of state.zones.battlefield) put(id, 'battlefield');
  for (const it of state.zones.stack) if (it.kind === 'spell') put(it.id, 'stack');
  for (const o of Object.values(state.objects)) {
    if (!where.has(o.id)) fail(`inv2: object ${o.id} (${o.defId}, zone ${o.zone}) is in no zone array`);
  }
  // 1. Card conservation; tokens only on the battlefield.
  const count: [number, number] = [0, 0];
  for (const o of Object.values(state.objects)) {
    if (o.token) { if (o.zone !== 'battlefield') fail(`inv1: token ${o.id} in ${o.zone}`); continue; }
    count[o.owner]++;
  }
  for (const p of [0, 1] as const) if (count[p] !== deckSize[p]) fail(`inv1: player ${p} has ${count[p]} cards, expected ${deckSize[p]}`);
  // 3. Battlefield-only state; 4. finite integers.
  for (const o of Object.values(state.objects)) {
    if (o.zone !== 'battlefield') {
      if (o.tapped || o.damage !== 0 || o.attacking || o.animated || o.attachedTo !== undefined || o.blocking || o.blocked) {
        fail(`inv3: object ${o.id} in ${o.zone} has battlefield state`);
      }
      if ((o.zone === 'hand' || o.zone === 'library') && Object.keys(o.counters).length) fail(`inv3: counters on ${o.id} in ${o.zone}`);
      if (o.counters.lore) fail(`inv3: lore counters on ${o.id} in ${o.zone}`);
    }
    if (!isInt(o.damage) || o.damage < 0) fail(`inv4: damage ${o.damage} on ${o.id}`);
    for (const [k, v] of Object.entries(o.counters)) if (!isInt(v) || (v as number) <= 0) fail(`inv4: counter ${k}=${v} on ${o.id}`);
  }
  for (const p of [0, 1] as const) {
    const pl = state.players[p];
    if (!isInt(pl.life)) fail(`inv4: life ${pl.life}`);
    for (const e of pl.manaPool) if (!['W', 'U', 'B', 'R', 'G', 'C'].includes(e.color)) fail(`inv4: pool entry ${JSON.stringify(e)}`);
  }
  // 5. Priority holder valid; no pending choice once the game has a result.
  if (state.priority !== 0 && state.priority !== 1) fail(`inv5: priority ${String(state.priority)}`);
  if (state.result && state.pendingChoice) fail('inv5: pendingChoice with a result');
}

/** Invariant 8: a view for p contains no identity of an object hidden from p. Returns objects checked. */
export function checkViewLeak(state: GameState, p: PlayerId): number {
  const v = view(state, p);
  const hidden = new Set<ObjId>();
  const hiddenDefs = new Map<string, number>();
  // Cards a pending pickObjects Choice reveals to its chooser are not hidden from that chooser.
  const pc = state.pendingChoice;
  const revealed: readonly ObjId[] = pc && pc.kind === 'pickObjects' && pc.player === p ? pc.reveal ?? [] : [];
  for (const o of Object.values(state.objects)) {
    if ((o.zone === 'hand' || o.zone === 'library') && !o.knownTo[p] && !revealed.includes(o.id)) {
      const knownPos = o.zone === 'library' && p === o.owner
        && (state.players[p].libraryKnown.top.includes(o.id) || state.players[p].libraryKnown.bottom.includes(o.id));
      if (!knownPos) { hidden.add(o.id); hiddenDefs.set(o.defId, (hiddenDefs.get(o.defId) ?? 0) + 1); }
    }
  }
  for (const k of Object.keys(v.objects)) if (hidden.has(Number(k))) fail(`inv8: hidden object ${k} in view.objects of ${p}`);
  const idKeys = new Set(['id', 'sourceId', 'objId', 'target', 'attachedTo', 'stackId']);
  const walk = (x: unknown, key: string): void => {
    if (typeof x === 'number') {
      if (idKeys.has(key) && hidden.has(x)) fail(`inv8: hidden id ${x} under key ${key} in view of ${p}`);
      return;
    }
    if (Array.isArray(x)) {
      const arrKey = ['battlefield', 'graveyard', 'exile', 'known', 'knownTop', 'knownBottom', 'from', 'ids', 'blocking', 'loyaltyUsed'].includes(key);
      for (const y of x) {
        if (arrKey && typeof y === 'number' && hidden.has(y)) fail(`inv8: hidden id ${y} in ${key} in view of ${p}`);
        walk(y, key);
      }
      return;
    }
    if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) walk(y, k);
  };
  walk(v, '');
  // A hidden def id that no visible object shares must not appear anywhere.
  const visibleDefs = new Set(Object.values(v.objects).map((o) => o.defId));
  const json = JSON.stringify(v);
  for (const d of hiddenDefs.keys()) if (!visibleDefs.has(d) && json.includes(`"${d}"`)) fail(`inv8: hidden def ${d} in view of ${p}`);
  return hidden.size;
}

export function playGame(deckA: DeckInput, deckB: DeckInput, seed: number, agents: [Agent, Agent], agentSeeds: [number, number], opts: PlayOpts = {}): GameRecord {
  let state = newGame(deckA, deckB, seed, 'random');
  const deckSize: [number, number] = opts.deckSize ?? [
    Object.values(state.objects).filter((o) => o.owner === 0).length,
    Object.values(state.objects).filter((o) => o.owner === 1).length,
  ];
  const rec: GameRecord = { seed, agentSeeds, moves: [], hashes: [], turns: 0, maxMovesInTurn: 0, result: null, checks: 0, viewChecks: 0 };
  let turnMoves = 0;
  let lastTurn = state.turn;
  const viewEvery = opts.viewEvery ?? 0;
  if (opts.check) { checkInvariants(state, deckSize); rec.checks++; }
  while (!state.result) {
    const p = decider(state);
    if (p === null) break;
    const moves = legalMoves(state, p);
    if (moves.length === 0) fail(`no legal moves for player ${p} at turn ${state.turn} step ${state.step} choice ${state.pendingChoice?.kind ?? 'none'}`);
    const st = state;
    const move = agents[p].choose({ player: p, moves, view: () => view(st, p), sample: (r) => sampleHidden(st, p, r) });
    rec.moves.push(move);
    if (opts.used && 'objId' in move) {
      const defId = state.objects[move.objId]?.defId;
      if (defId !== undefined) opts.used[defId] = (opts.used[defId] ?? 0) + 1;
    }
    state = opts.copy ? applyMove(state, move) : applyMoveInPlace(state, move);
    if (opts.hash) rec.hashes.push(stateHash(state));
    if (opts.check) { checkInvariants(state, deckSize); rec.checks++; }
    const counter = opts.counter ?? { n: rec.moves.length - 1 };
    counter.n++;
    if (viewEvery > 0 && counter.n % viewEvery === 0) { checkViewLeak(state, 0); checkViewLeak(state, 1); rec.viewChecks += 2; }
    if (state.turn !== lastTurn) { lastTurn = state.turn; turnMoves = 0; }
    turnMoves++;
    if (turnMoves > rec.maxMovesInTurn) rec.maxMovesInTurn = turnMoves;
    if (turnMoves > CAPS.movesPerTurn) throw new CapHit(`cap: ${turnMoves} moves in turn ${state.turn}`);
    if (rec.moves.length > CAPS.movesPerGame) throw new CapHit(`cap: ${rec.moves.length} moves in one game`);
    if (state.turn > CAPS.turns) throw new CapHit(`cap: turn ${state.turn}`);
  }
  rec.turns = state.turn;
  rec.result = state.result;
  return rec;
}
