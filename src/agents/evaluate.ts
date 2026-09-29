// Hand-written position evaluation for the greedy agent (PLAN.md section 8, Phase 2): a score from
// one player's point of view built from the life race, the board (power, toughness, keywords,
// permanents), cards in hand and deck-specific tables (src/agents/heuristics). It reads only what
// the player may know: public zones, their own hand, the opponent's hand size. It is a heuristic,
// not a solution of the game: nothing here is optimal play.
import { getDef } from '../cards/index.js';
import { characteristics, KW, TYPE } from '../engine/statics.js';
import type { Characteristics, DefId, GameState, Move, ObjId, PlayerId, Step } from '../engine/types.js';

export const WIN = 1_000_000;

/** Per-card numbers shared by both decks (merged from the two heuristic tables). */
export interface CardTables {
  /** Extra value of a permanent on the battlefield, by def id (face 1 as 'defId#1'). */
  permanent: Readonly<Record<DefId, number>>;
  /** Value of a card in its owner's hand. */
  hand: Readonly<Record<DefId, number>>;
  /** How much a discard effect wants to take this card from the opponent's hand. */
  threat: Readonly<Record<DefId, number>>;
}

export interface MoveCtx {
  /** The decision state (a determinized sample). */
  before: GameState;
  /** The state after the move and the settle (see greedy.ts). */
  after: GameState;
  move: Move;
  me: PlayerId;
  /** All legal moves of this decision. */
  moves: readonly Move[];
  cards: CardTables;
}

/** A deck-specific strategy: weights plus per-move and per-state adjustments. */
export interface Profile {
  name: 'rakdos' | 'monored';
  /** Weight of the player's own life and of the opponent's life. */
  lifeSelf: number;
  lifeOpp: number;
  /** Weight of the race term (turns to kill). */
  race: number;
  /** Cards that identify the deck (for automatic profile choice). */
  signature: readonly DefId[];
  cards: CardTables;
  /** Mana the deck wants to keep open on its own main phase 2 (reduces the unspent-mana penalty). */
  reserve(state: GameState, me: PlayerId): number;
  moveBonus(ctx: MoveCtx): number;
  stateBonus(state: GameState, me: PlayerId): number;
}

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

/** The number of turns p has started (p's own turn count). */
export function ownTurns(state: GameState, p: PlayerId): number {
  return state.startingPlayer === p ? Math.ceil(state.turn / 2) : Math.floor(state.turn / 2);
}

export function isCreature(c: Characteristics): boolean {
  return (c.types & TYPE.Creature) !== 0;
}

/** Sum of until-end-of-turn P/T deltas on an object (all ptDelta effects last until end of turn). */
export function eotDelta(state: GameState, id: ObjId): [number, number] {
  let p = 0;
  let t = 0;
  for (const e of state.effects) if (e.kind === 'ptDelta' && e.target === id) { p += e.p; t += e.t; }
  return [p, t];
}

/** Lasting power and toughness: current values minus until-end-of-turn deltas. */
export function lastingPT(state: GameState, id: ObjId): [number, number] {
  const c = characteristics(state, id);
  const [dp, dt] = eotDelta(state, id);
  return [c.power - dp, c.toughness - dt];
}

/** A creature's worth on the battlefield, from lasting stats and keywords. */
export function creatureValue(state: GameState, id: ObjId, cards: CardTables): number {
  const c = characteristics(state, id);
  const [p, t] = lastingPT(state, id);
  let v = 1 + Math.max(0, p) + 0.6 * Math.max(0, t);
  if (c.kw & KW.deathtouch) v += 1.2;
  if (c.kw & KW.lifelink) v += 0.4 * Math.max(0, p);
  if (c.kw & KW.trample) v += 0.2 * Math.max(0, p);
  if (c.kw & KW.menace) v += 0.6;
  if (c.kw & KW.flying) v += 0.8;
  if (c.kw & KW.prowess) v += 0.6;
  if (c.kw & KW.haste) v += 0.1;
  return v + permanentBonus(state, id, cards);
}

function permanentBonus(state: GameState, id: ObjId, cards: CardTables): number {
  const o = state.objects[id];
  if (!o) return 0;
  const key = o.face === 1 ? `${o.defId}#1` : o.defId;
  return cards.permanent[key] ?? (o.face === 1 ? 0 : cards.permanent[o.defId] ?? 0);
}

/** Worth of one permanent on the battlefield (for its controller). */
export function permanentValue(state: GameState, id: ObjId, cards: CardTables, landsSoFar: number): number {
  const o = state.objects[id];
  if (!o) return 0;
  const c = characteristics(state, id);
  // Animated manlands and crewed vehicles are valued as what they are between turns.
  if (c.types & TYPE.Land) return (landsSoFar < 6 ? 1.5 : 0.5) + permanentBonus(state, id, cards);
  if (isCreature(c) && !o.crewed) return creatureValue(state, id, cards);
  if (c.types & TYPE.Planeswalker) return 3 + (o.counters.loyalty ?? 0) + permanentBonus(state, id, cards);
  if (o.token && o.attachedTo !== undefined) return 0; // a Role: counted in its creature's stats
  if (o.token) return cards.permanent[o.defId] ?? 0.3;
  return 1.5 + permanentBonus(state, id, cards);
}

/** Concave value of a life total: each point is worth more when life is low. */
export function lifeValue(l: number): number {
  if (l <= 0) return -40 + l;
  return 1.6 * Math.min(l, 5) + 1.0 * Math.min(Math.max(l - 5, 0), 7) + 0.5 * Math.max(l - 12, 0);
}

export function isLandDef(defId: DefId): boolean {
  return getDef(defId).faces[0]?.types.includes('Land') ?? false;
}

/** Land drops still wanted: lands in hand up to this total on the battlefield are worth LAND_IN_HAND. */
export const LAND_TARGET = 5;
export const LAND_IN_HAND = 1.2;
export const EXTRA_LAND_IN_HAND = 0.3;

/** Marginal value of the lands in hand: the ones that are future land drops up to LAND_TARGET count fully. */
export function handLandsValue(inHand: number, onField: number): number {
  const useful = Math.max(0, Math.min(inHand, LAND_TARGET - onField));
  return useful * LAND_IN_HAND + (inHand - useful) * EXTRA_LAND_IN_HAND;
}

/** Value of a card in its owner's hand (a land counted alone: see handLandsValue for several). */
export function handCardValue(defId: DefId, landsOnField: number, cards: CardTables): number {
  if (isLandDef(defId)) return handLandsValue(1, landsOnField);
  return cards.hand[defId] ?? 1.5;
}

export const OPP_HAND_CARD = 1.0;
/** Value of an untapped land of the evaluating player. */
export const UNTAPPED_LAND = 0.15;
/** Average value of a card drawn, used to take draws out of comparisons across turn boundaries. */
export const AVG_DRAW = 1.4;

export interface BoardSummary {
  value: [number, number];
  /** Lasting power of creatures that can attack next turn (defender-less; tapped or not). */
  powers: [number[], number[]];
  creatures: [number, number];
  lands: [number, number];
  untappedLands: [number, number];
}

export function summarize(state: GameState, cards: CardTables): BoardSummary {
  const s: BoardSummary = { value: [0, 0], powers: [[], []], creatures: [0, 0], lands: [0, 0], untappedLands: [0, 0] };
  for (const id of state.zones.battlefield) {
    const o = state.objects[id];
    if (!o) continue;
    const p = o.controller;
    const c = characteristics(state, id);
    if (c.types & TYPE.Land) {
      s.value[p] += permanentValue(state, id, cards, s.lands[p]);
      s.lands[p]++;
      if (!o.tapped) s.untappedLands[p]++;
      continue;
    }
    s.value[p] += permanentValue(state, id, cards, 0);
    if (isCreature(c) && !o.crewed) {
      s.creatures[p]++;
      s.powers[p].push(Math.max(0, lastingPT(state, id)[0]));
    }
  }
  return s;
}

/** Damage p can expect to push through next turn: blockers absorb about half of the biggest attackers. */
export function expectedDamage(sum: BoardSummary, p: PlayerId): number {
  const mine = [...sum.powers[p]].sort((a, b) => b - a);
  const total = mine.reduce((a, b) => a + b, 0);
  const blockers = sum.creatures[other(p)];
  let absorbed = 0;
  for (let i = 0; i < Math.min(blockers, mine.length); i++) absorbed += 0.5 * (mine[i] as number);
  return Math.max(0, total - absorbed);
}

/**
 * Draw steps (per player) that happened between two states of the same game, the current turn's
 * included: from the untap or upkeep step to a later step of the same turn crosses its draw step
 * (the engine auto-passes an empty upkeep, so a settle that starts there can end in main phase 1).
 */
export function drawsBetween(before: GameState, after: GameState): [number, number] {
  const out: [number, number] = [0, 0];
  const PRE_DRAW: readonly Step[] = ['untap', 'upkeep'];
  for (let t = before.turn; t <= after.turn; t++) {
    if (t === 1) continue;
    if (t === before.turn && !PRE_DRAW.includes(before.step)) continue;
    const active: PlayerId = (t - before.turn) % 2 === 1 ? other(before.activePlayer) : before.activePlayer;
    if (t === after.turn && PRE_DRAW.includes(after.step)) continue;
    out[active]++;
  }
  return out;
}

/** Score of state from me's point of view (higher is better). */
export function evaluate(state: GameState, me: PlayerId, prof: Profile, cards: CardTables): number {
  const opp = other(me);
  if (state.result) {
    if (state.result.winner === me) return WIN - state.turn;
    if (state.result.winner === 'draw') return -WIN / 2;
    return -WIN + state.turn;
  }
  const sum = summarize(state, cards);
  const myLife = state.players[me].life;
  const oppLife = state.players[opp].life;
  let v = prof.lifeSelf * lifeValue(myLife) - prof.lifeOpp * lifeValue(oppLife);
  v += sum.value[me] - sum.value[opp];
  let handLands = 0;
  for (const id of state.zones.hand[me]) {
    const o = state.objects[id];
    if (!o) continue;
    if (isLandDef(o.defId)) handLands++;
    else v += handCardValue(o.defId, sum.lands[me], cards);
  }
  v += handLandsValue(handLands, sum.lands[me]);
  v -= OPP_HAND_CARD * state.zones.hand[opp].length;
  // Untapped lands are options (instants, activations, next plays): tapping mana for nothing loses.
  v += UNTAPPED_LAND * sum.untappedLands[me];
  // Race: turns each side needs to kill the other with the board as it stands.
  const dMe = expectedDamage(sum, me);
  const dOpp = expectedDamage(sum, opp);
  const ttkOpp = Math.min(10, oppLife / Math.max(dMe, 0.5));
  const ttkMe = Math.min(10, myLife / Math.max(dOpp, 0.5));
  v += prof.race * Math.max(-5, Math.min(5, ttkMe - ttkOpp));
  if (dMe >= oppLife) v += 3 * prof.race;
  if (dOpp >= myLife) v -= 3 * prof.lifeSelf;
  v += prof.stateBonus(state, me);
  return v;
}
