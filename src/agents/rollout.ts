// Cheap rollout policy for the ISMCTS spot analyzer (PLAN.md section 8, Phase 4). No lookahead
// beyond one combat estimate:
//  - priority: play a land when one can be played; else cast the most expensive castable spell
//    (mana value of the face cast; ties and target variants broken towards the opponent's objects
//    for hostile spells and towards the caster's own for the few friendly ones, then at random);
//    otherwise a uniformly random move (activations, door unlocks, pass);
//  - declare attackers: the greedy combat scorer (greedy.ts staticBlock and combatOutcome) scores
//    the first ATTACK_LOOK attack options (the engine ranks them by power at the player) against the
//    defender's static block; the best one is declared when it scores above not attacking;
//  - declare blockers: greedy's static block;
//  - mulligan: keep; every other choice: uniformly random.
// Randomness comes from the searcher's stream passed in, never from the game. This is a playout
// heuristic, much weaker than the greedy agent; rollouts are truncated after a few turns and scored
// by the greedy evaluation (leafValue), or played to the end with --rollout full.
import { applyMove, applyMoveInPlace } from '../engine/apply.js';
import { decider, legalMoves } from '../engine/moves.js';
import { nextFloat, nextInt } from '../engine/rng.js';
import { manaValueOf, parseMana } from '../engine/cost.js';
import { getDef } from '../cards/index.js';
import { CARDS, combatOutcome, detectProfile, staticBlock } from './greedy.js';
import { creatureValue, evaluate, lifeValue, other, type Profile } from './evaluate.js';
import type { DefId, GameState, Move, PlayerId, RngState } from '../engine/types.js';

/** Attack options scored per declaration (the engine lists them ranked, capped at 64). */
export const ATTACK_LOOK = 3;
/** Engine moves per rollout before it is cut and scored (a backstop; decking ends games sooner). */
export const ROLLOUT_MOVE_CAP = 3000;
/**
 * Scale of the logistic map from the greedy evaluation to [0, 1]: value = 1 / (1 + exp(-eval / EVAL_SCALE)).
 * Fitted by maximum likelihood on greedy-vs-greedy games (evaluation at the start of each turn
 * against the final winner; docs/PERF.md, Phase 4).
 */
export const EVAL_SCALE = 16;

/** Spells and abilities whose targets should be the caster's own objects (pump); every other targeted one is hostile. */
const FRIENDLY: ReadonlySet<DefId> = new Set(['monstrous-rage', 'rockface-village']);

function castMV(state: GameState, m: Extract<Move, { type: 'cast' }>): number {
  const o = state.objects[m.objId];
  if (!o) return 0;
  const f = getDef(o.defId).faces[m.half ?? m.face ?? 0];
  return manaValueOf(parseMana(f?.cost ?? null));
}

/** Targets that point the right way: opponent objects or the opponent for hostile spells, own for friendly. */
function targetFit(state: GameState, p: PlayerId, m: Move): number {
  if (m.type !== 'cast' && m.type !== 'activate') return 0;
  const src = state.objects[m.objId];
  const friendly = src !== undefined && FRIENDLY.has(src.defId);
  let fit = 0;
  for (const t of m.targets) {
    const mine = t.kind === 'player' ? t.p === p : state.objects[t.id]?.controller === p;
    if (mine === friendly) fit++;
  }
  return fit;
}

function pickRandom<T>(rng: RngState, xs: readonly T[]): T {
  return xs[xs.length === 1 ? 0 : nextInt(rng, xs.length)] as T;
}

/** The best variants by fit, one picked at random. */
function bestFit(state: GameState, p: PlayerId, ms: readonly Move[], rng: RngState): Move {
  let best = -1;
  let pool: Move[] = [];
  for (const m of ms) {
    const f = targetFit(state, p, m);
    if (f > best) { best = f; pool = [m]; } else if (f === best) pool.push(m);
  }
  return pickRandom(rng, pool);
}

/** Greedy combat score of one attack declaration: expected life swing and creatures traded, defender blocking statically. */
function attackScore(state: GameState, p: PlayerId, m: Move): number {
  const s = applyMove(state, m);
  const opp = other(p);
  if (s.result) return s.result.winner === p ? 1e6 : -1e6;
  const life = s.players[opp].life;
  const ch = s.pendingChoice;
  let blocks: readonly [number, number][] = [];
  if (ch && ch.kind === 'declareBlockers' && ch.player === opp) {
    const b = staticBlock(s, opp, legalMoves(s, opp));
    if (b.type === 'declareBlockers') blocks = b.assignments;
  }
  const r = combatOutcome(s, blocks);
  if (r.damage >= life) return 1e5;
  let v = lifeValue(life) - lifeValue(life - r.damage);
  for (const id of r.deadBlockers) v += creatureValue(s, id, CARDS);
  for (const id of r.deadAttackers) v -= creatureValue(s, id, CARDS);
  return v;
}

/** The rollout policy's move for p (see the file comment). moves = legalMoves(state, p), never empty. */
export function rolloutMove(state: GameState, p: PlayerId, moves: readonly Move[], rng: RngState): Move {
  if (moves.length === 1) return moves[0] as Move;
  const ch = state.pendingChoice;
  if (ch) {
    if (ch.kind === 'mulligan') return moves.find((m) => m.type === 'choose' && m.answer.keep === true) ?? (moves[0] as Move);
    if (ch.kind === 'declareBlockers') return staticBlock(state, p, moves);
    if (ch.kind === 'declareAttackers') {
      let best: Move | null = null;
      let bestScore = 0; // not attacking scores 0
      let looked = 0;
      for (const m of moves) {
        if (m.type !== 'declareAttackers' || m.assignments.length === 0) continue;
        if (looked++ >= ATTACK_LOOK) break;
        const sc = attackScore(state, p, m);
        if (sc > bestScore) { bestScore = sc; best = m; }
      }
      return best ?? moves.find((m) => m.type === 'declareAttackers' && m.assignments.length === 0) ?? (moves[0] as Move);
    }
    return pickRandom(rng, moves);
  }
  const lands = moves.filter((m) => m.type === 'playLand');
  if (lands.length > 0) return pickRandom(rng, lands);
  let top = -1;
  let casts: Move[] = [];
  for (const m of moves) {
    if (m.type !== 'cast') continue;
    const mv = castMV(state, m);
    if (mv > top) { top = mv; casts = [m]; } else if (mv === top) casts.push(m);
  }
  if (casts.length > 0) return bestFit(state, p, casts, rng);
  return pickRandom(rng, moves);
}

/** A rollout policy: the move for p at state (moves = legalMoves(state, p), never empty); must not mutate state. */
export type RolloutPick = (state: GameState, p: PlayerId, moves: readonly Move[]) => Move;

export interface RolloutOptions {
  /** Turns (both players' turns) to play before scoring; null plays to the end of the game. */
  turns: number | null;
  /** The policy (default rolloutMove with the searcher's stream). */
  pick?: RolloutPick;
}

/**
 * Plays state on in place with the rollout policy until the game ends, the turn count passes
 * state.turn + turns, or ROLLOUT_MOVE_CAP moves. Returns the number of moves played.
 */
export function rollout(state: GameState, rng: RngState, opts: RolloutOptions): number {
  const end = opts.turns === null ? Infinity : state.turn + opts.turns;
  let n = 0;
  while (!state.result && state.turn < end && n < ROLLOUT_MOVE_CAP) {
    const p = decider(state);
    if (p === null) break;
    const moves = legalMoves(state, p);
    if (moves.length === 0) break;
    applyMoveInPlace(state, opts.pick ? opts.pick(state, p, moves) : rolloutMove(state, p, moves, rng));
    n++;
  }
  return n;
}

/** Logistic map of an evaluation score to [0, 1]. */
export function squash(score: number): number {
  return 1 / (1 + Math.exp(-score / EVAL_SCALE));
}

/**
 * Value of a position for p in [0, 1]: 1 won, 0 lost, 0.5 drawn; otherwise the greedy evaluation
 * from the side of p, with the deck profile of p, through the logistic map. An estimate of the
 * chance of p under heuristic play, not a solved value.
 */
export function leafValue(state: GameState, p: PlayerId, prof?: Profile): number {
  const r = state.result;
  if (r) return r.winner === 'draw' ? 0.5 : r.winner === p ? 1 : 0;
  return squash(evaluate(state, p, prof ?? detectProfile(state, p), CARDS));
}

/** A binary outcome with mean v: 1 with probability v, drawn from the searcher's stream (win counting for the Wilson interval). */
export function bernoulli(v: number, rng: RngState): 0 | 1 {
  if (v >= 1) return 1;
  if (v <= 0) return 0;
  return nextFloat(rng) < v ? 1 : 0;
}
