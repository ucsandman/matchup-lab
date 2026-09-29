// Greedy one-ply agent (PLAN.md section 8, Phase 2). For each legal move it applies the move in
// copy mode to a determinized sample of the game (Decision.sample: the cards hidden from it are
// re-dealt from its own stream, so it never peeks), lets the stack settle, and scores the result
// with the hand-written evaluation in evaluate.ts plus the deck tables in heuristics/. It then
// plays the best move; exact ties are broken with its own RNG stream, so it is deterministic given
// the game and its seed. It is a baseline heuristic player, not optimal play.
//
// Settle: after the move, the engine runs on with every priority decision answered by passing
// (the opponent is assumed not to respond) and mid-resolution choices answered by a one-step
// look, until the stack is empty at a priority decision, a combat declaration is due, or the game
// ends. Combat: when an attack reaches the opponent's declare-blockers choice inside a settle, the
// opponent's block is picked by a static trade estimate (combatOutcome), then combat damage is
// dealt by the engine, so attacks are scored by their expected trades.
import { applyMove, applyMoveInPlace, cloneState } from '../engine/apply.js';
import { decider, legalMoves } from '../engine/moves.js';
import { cloneRng, jump, nextInt, seedRng } from '../engine/rng.js';
import { characteristics, KW } from '../engine/statics.js';
import { parseMana, manaValueOf } from '../engine/cost.js';
import { getDef } from '../cards/index.js';
import {
  AVG_DRAW, creatureValue, drawsBetween, evaluate, handCardValue, isLandDef, lifeValue, OPP_HAND_CARD, other,
  type CardTables, type Profile,
} from './evaluate.js';
import { RAKDOS } from './heuristics/rakdos.js';
import { MONORED } from './heuristics/monored.js';
import type { Agent, Decision } from './types.js';
import type { Color, DefId, GameState, Move, ObjId, PlayerId, RngState, Step } from '../engine/types.js';

export const PROFILES: Readonly<Record<Profile['name'], Profile>> = { rakdos: RAKDOS, monored: MONORED };

/** Card values of both decks merged: a card is worth the same whoever holds it. */
export const CARDS: CardTables = {
  permanent: { ...MONORED.cards.permanent, ...RAKDOS.cards.permanent },
  hand: { ...MONORED.cards.hand, ...RAKDOS.cards.hand },
  threat: { ...MONORED.cards.threat, ...RAKDOS.cards.threat },
};

/** Settle loop cap (engine moves after the scored move). */
export const SETTLE_CAP = 40;
/** Steps a settle plays through with empty-stack passes (attackers declared, damage not yet dealt). */
export const IN_COMBAT: ReadonlySet<Step> = new Set<Step>(['declareAttackers', 'declareBlockers', 'combatDamage']);
/** Mid-settle choices with at most this many options get a one-step look; others take option 0. */
const LOOK_CAP = 12;
const EPS = 1e-9;

export interface GreedyOptions {
  /** Deck profile; 'auto' (default) picks it from the agent's own cards at its first decision. */
  deck?: Profile['name'] | 'auto';
  name?: string;
}

export interface GreedyAgent extends Agent {
  rng(): RngState;
  /** The profile in use (null until the first decision with 'auto'). */
  profile(): Profile | null;
  /** Every legal move with its score (debugging and tests; draws from the agent's stream like choose). */
  explain(d: Decision): { move: Move; score: number }[];
}

/** Picks the profile whose signature cards the player owns most of. */
export function detectProfile(state: GameState, me: PlayerId): Profile {
  const owned = new Set<DefId>();
  for (const o of Object.values(state.objects)) if (o.owner === me) owned.add(o.defId);
  let best: Profile = RAKDOS;
  let bestN = -1;
  for (const p of [RAKDOS, MONORED]) {
    const n = p.signature.filter((d) => owned.has(d)).length;
    if (n > bestN) { best = p; bestN = n; }
  }
  return best;
}

// ---- combat estimate ----------------------------------------------------------------------------

export interface CombatOutcome {
  /** Damage to the defending player. */
  damage: number;
  /** Lifelink gained by the attacking player. */
  lifelink: number;
  deadAttackers: ObjId[];
  deadBlockers: ObjId[];
}

/**
 * Static combat result for declared attackers and a block assignment, mirroring the engine's
 * damage rule (combat.ts: blockers in ascending lethal need, lethal to each, the rest to the last
 * blocker or through with trample). No tricks, no triggers.
 */
export function combatOutcome(state: GameState, blocks: readonly [ObjId, ObjId][]): CombatOutcome {
  const out: CombatOutcome = { damage: 0, lifelink: 0, deadAttackers: [], deadBlockers: [] };
  const byAttacker = new Map<ObjId, ObjId[]>();
  for (const [b, a] of blocks) {
    const arr = byAttacker.get(a);
    if (arr) arr.push(b);
    else byAttacker.set(a, [b]);
  }
  const taken = new Map<ObjId, number>();
  const deathtouched = new Set<ObjId>();
  for (const id of state.zones.battlefield) {
    const o = state.objects[id];
    if (!o?.attacking) continue;
    const c = characteristics(state, id);
    const power = Math.max(0, c.power);
    const dt = (c.kw & KW.deathtouch) !== 0;
    const trample = (c.kw & KW.trample) !== 0;
    const blockers = byAttacker.get(id);
    if (!blockers || blockers.length === 0) {
      if (o.blocked) continue; // blocked earlier, blocker gone: no damage without trample
      if (o.attacking.kind === 'player') out.damage += power;
      if (c.kw & KW.lifelink) out.lifelink += power;
      continue;
    }
    const need = (b: ObjId): number => {
      const bo = state.objects[b];
      const left = characteristics(state, b).toughness - (bo?.damage ?? 0);
      return dt ? Math.min(1, Math.max(left, 0)) : Math.max(left, 0);
    };
    const order = [...blockers].sort((x, y) => need(x) - need(y) || x - y);
    let left = power;
    order.forEach((b, i) => {
      if (left <= 0) return;
      const n = i === order.length - 1 && !trample ? left : Math.min(left, need(b));
      taken.set(b, (taken.get(b) ?? 0) + n);
      if (dt && n > 0) deathtouched.add(b);
      left -= n;
    });
    if (left > 0 && trample && o.attacking.kind === 'player') out.damage += left;
    if (c.kw & KW.lifelink) out.lifelink += power;
    let back = 0;
    let backDt = false;
    for (const b of blockers) {
      const bc = characteristics(state, b);
      back += Math.max(0, bc.power);
      if ((bc.kw & KW.deathtouch) && bc.power > 0) backDt = true;
    }
    if (back > 0 && (backDt || back >= c.toughness - o.damage)) out.deadAttackers.push(id);
  }
  for (const [b, n] of taken) {
    const bo = state.objects[b];
    if (!bo) continue;
    if (deathtouched.has(b) || n >= characteristics(state, b).toughness - bo.damage) out.deadBlockers.push(b);
  }
  return out;
}

/** The defender's block by static trade estimate: life lost against creatures traded. */
export function staticBlock(state: GameState, defender: PlayerId, moves: readonly Move[]): Move {
  const life = state.players[defender].life;
  let best = moves[0] as Move;
  let bestScore = -Infinity;
  for (const m of moves) {
    if (m.type !== 'declareBlockers') continue;
    const r = combatOutcome(state, m.assignments);
    let s = r.damage >= life ? -1e5 : -(lifeValue(life) - lifeValue(life - r.damage));
    for (const id of r.deadBlockers) s -= creatureValue(state, id, CARDS);
    for (const id of r.deadAttackers) s += creatureValue(state, id, CARDS);
    if (s > bestScore + EPS) { bestScore = s; best = m; }
  }
  return best;
}

// ---- settle ---------------------------------------------------------------------------------------

function quickChoice(state: GameState, chooser: PlayerId, moves: readonly Move[], prof: (p: PlayerId) => Profile): Move {
  if (moves.length === 1 || moves.length > LOOK_CAP) return moves[0] as Move;
  let best = moves[0] as Move;
  let bestScore = -Infinity;
  for (const m of moves) {
    const s = evaluate(applyMove(state, m), chooser, prof(chooser), CARDS);
    if (s > bestScore + EPS) { bestScore = s; best = m; }
  }
  return best;
}

/**
 * Runs the engine on from state (mutated in place) until the scoring point: the stack is empty at
 * a priority decision outside the declare-attackers to combat-damage steps, a combat declaration of
 * me is due, a pregame choice is pending, or the game is over. Returns the number of engine moves
 * made.
 */
export function settle(state: GameState, me: PlayerId, prof: (p: PlayerId) => Profile): number {
  let n = 0;
  for (; n < SETTLE_CAP; n++) {
    if (state.result) break;
    const ch = state.pendingChoice;
    // Once attackers are declared, combat is played out to the end of the damage step, so attacks,
    // blocks and combat tricks are scored by what the damage did.
    if (!ch && state.zones.stack.length === 0 && !IN_COMBAT.has(state.step)) break;
    if (ch && (ch.kind === 'mulligan' || ch.kind === 'bottom' || ch.kind === 'declareAttackers')) break;
    if (ch && ch.kind === 'declareBlockers' && ch.player === me) break;
    const p = decider(state);
    if (p === null) break;
    const moves = legalMoves(state, p);
    if (moves.length === 0) break;
    let m: Move;
    if (ch?.kind === 'declareBlockers') m = staticBlock(state, p, moves);
    else if (ch) m = quickChoice(state, p, moves, prof);
    else m = { type: 'pass' };
    applyMoveInPlace(state, m);
  }
  return n;
}

// ---- mulligan -------------------------------------------------------------------------------------

/**
 * Colors a land card can make, from its mana abilities and basic land types: one face when face is
 * given, else either face of a modal land.
 */
export function landColors(defId: DefId, face?: 0 | 1): Set<Color> {
  const out = new Set<Color>();
  const faces = getDef(defId).faces;
  for (const f of face === undefined ? faces : [faces[face]]) {
    if (!f || !f.types.includes('Land')) continue;
    if (f.subtypes.includes('Swamp')) out.add('B');
    if (f.subtypes.includes('Mountain')) out.add('R');
    if (f.subtypes.includes('Plains')) out.add('W');
    if (f.subtypes.includes('Island')) out.add('U');
    if (f.subtypes.includes('Forest')) out.add('G');
    for (const a of f.abilities) {
      if (a.kind !== 'mana') continue;
      if (a.produce === 'any') for (const c of ['W', 'U', 'B', 'R', 'G'] as const) out.add(c);
      else for (const c of a.produce) if (c !== 'C') out.add(c);
    }
  }
  return out;
}

/** True when the spell can be cast by turn 3 with the given lands (one land drop per turn). */
export function castableByTurn3(defId: DefId, lands: readonly DefId[]): boolean {
  const f = getDef(defId).faces[0];
  if (!f || f.cost === null || f.types.includes('Land')) return false;
  const cost = parseMana(f.cost);
  const n = Math.min(3, lands.length);
  if (manaValueOf(cost) > n) return false;
  // Assign colored pips to distinct lands: try every choice of n lands (hands are small).
  const cols = lands.map((d) => landColors(d));
  const pips: Color[] = [];
  for (const c of ['W', 'U', 'B', 'R', 'G'] as const) for (let i = 0; i < cost[c]; i++) pips.push(c);
  const used = new Array<boolean>(cols.length).fill(false);
  const place = (i: number): boolean => {
    if (i === pips.length) return true;
    for (let j = 0; j < cols.length; j++) {
      if (used[j] || !cols[j]?.has(pips[i] as Color)) continue;
      used[j] = true;
      if (place(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return place(0);
}

/**
 * London mulligan keep rule: with 7 cards, keep when the hand has 2 to 5 lands and at least one
 * spell castable by turn 3; otherwise mulligan. The engine asks for the bottom cards right after
 * each mulligan (mulligan.ts), so a later decision sees the reduced hand: 2 to size - 2 lands
 * (2 to 4 in 6 cards) and the same castable test. After two mulligans, always keep.
 */
export function keepHand(hand: readonly DefId[], mulligans: number): boolean {
  if (mulligans >= 2) return true;
  const lands = hand.filter(isLandDef);
  if (lands.length < 2 || lands.length > Math.min(5, hand.length - 2)) return false;
  return hand.some((d) => !isLandDef(d) && castableByTurn3(d, lands));
}

/** How good a kept hand is (for choosing the cards to bottom). */
export function keptHandScore(hand: readonly DefId[]): number {
  const lands = hand.filter(isLandDef);
  const ideal = hand.length >= 6 ? 3 : 2;
  let s = -3 * Math.abs(lands.length - ideal) - (lands.length < 2 ? 6 : 0);
  for (const d of hand) {
    if (isLandDef(d)) continue;
    const mv = manaValueOf(parseMana(getDef(d).faces[0]?.cost ?? null));
    s += handCardValue(d, 0, CARDS) - 0.3 * Math.max(0, mv - 3);
  }
  if (hand.some((d) => !isLandDef(d) && castableByTurn3(d, lands))) s += 2;
  return s;
}

function mulliganMove(state: GameState, me: PlayerId, moves: readonly Move[]): Move {
  const hand = state.zones.hand[me].map((id) => (state.objects[id] as { defId: DefId }).defId);
  const keep = keepHand(hand, state.players[me].mulligans);
  return moves.find((m) => m.type === 'choose' && m.answer.keep === keep) ?? (moves[0] as Move);
}

function bottomScores(state: GameState, me: PlayerId, moves: readonly Move[]): number[] {
  const handIds = state.zones.hand[me];
  return moves.map((m) => {
    if (m.type !== 'choose') return -Infinity;
    const out = new Set(m.answer.ids ?? []);
    const kept = handIds.filter((id) => !out.has(id)).map((id) => (state.objects[id] as { defId: DefId }).defId);
    return keptHandScore(kept);
  });
}

// ---- land choice ------------------------------------------------------------------------------------

/** Colored pips the player's nonland hand cards need. */
function neededColors(state: GameState, me: PlayerId): Set<Color> {
  const out = new Set<Color>();
  for (const id of state.zones.hand[me]) {
    const o = state.objects[id];
    if (!o || isLandDef(o.defId)) continue;
    for (const f of getDef(o.defId).faces) {
      const c = parseMana(f.cost);
      for (const k of ['W', 'U', 'B', 'R', 'G'] as const) if (c[k] > 0) out.add(k);
    }
  }
  return out;
}

/**
 * Land order: a land that adds a color the hand needs and the battlefield lacks is worth 0.4 per
 * such color, plus 0.1 per needed color it makes at all (so a colored land comes before a colorless
 * one).
 */
export function landPlayBonus(state: GameState, me: PlayerId, objId: ObjId, face: 0 | 1): number {
  const o = state.objects[objId];
  if (!o) return 0;
  const need = neededColors(state, me);
  const have = new Set<Color>();
  for (const id of state.zones.battlefield) {
    const b = state.objects[id];
    if (b && b.controller === me && isLandDef(b.defId)) for (const c of landColors(b.defId, b.face)) have.add(c);
  }
  let v = 0;
  for (const c of landColors(o.defId, face)) {
    if (!need.has(c)) continue;
    v += 0.1;
    if (!have.has(c)) v += 0.4;
  }
  return v;
}

/** Spells (by object) the player could cast at this point, with their mana values. */
function castableSpells(state: GameState, me: PlayerId): Map<ObjId, number> {
  const out = new Map<ObjId, number>();
  if (decider(state) !== me) return out;
  for (const m of legalMoves(state, me)) {
    if (m.type !== 'cast' || out.has(m.objId)) continue;
    const o = state.objects[m.objId];
    if (o) out.set(m.objId, manaValueOf(parseMana(getDef(o.defId).faces[m.face ?? 0]?.cost ?? null)));
  }
  return out;
}

const isMain = (st: Step): boolean => st === 'main1' || st === 'main2';
/** Own-turn steps with priority before combat or in a main phase (strandPenalty). */
const PRE_MAIN: ReadonlySet<Step> = new Set<Step>(['upkeep', 'draw']);

/**
 * Spells the player could cast in main phase 1 of this turn with its land drop: from the upkeep
 * or draw step the state is first passed on to main phase 1 (a copy; the draw step's card is not
 * counted by the caller, which looks only at cards held at the decision). Each land the player
 * may play now is tried and the spells castable after any of them are merged.
 */
function mainPhaseCastable(state: GameState, me: PlayerId): Map<ObjId, number> {
  let st = state;
  if (PRE_MAIN.has(state.step)) {
    st = cloneState(state);
    for (let i = 0; i < 8 && !(st.step === 'main1' && st.zones.stack.length === 0 && decider(st) === me); i++) {
      if (st.result || st.pendingChoice || st.activePlayer !== me || decider(st) === null) return new Map();
      applyMoveInPlace(st, { type: 'pass' });
    }
    if (st.step !== 'main1') return new Map();
  }
  const out = castableSpells(st, me);
  if (decider(st) !== me) return out;
  for (const m of legalMoves(st, me)) {
    if (m.type !== 'playLand') continue;
    for (const [id, mv] of castableSpells(applyMove(st, m), me)) if (!out.has(id)) out.set(id, mv);
  }
  return out;
}

/**
 * Land drop in the own main phase: the land comes first (5, above any single play) and a land that lets a bigger spell be
 * cast this turn is preferred (0.3 per mana value of the biggest castable spell).
 */
export function landEnableBonus(before: GameState, after: GameState, me: PlayerId): number {
  if (before.activePlayer !== me || !isMain(before.step)) return 0;
  let biggest = 0;
  for (const mv of castableSpells(after, me).values()) biggest = Math.max(biggest, mv);
  return 5 + 0.3 * biggest;
}

/**
 * Casting an instant, or activating an ability (a Blood token, a manland), on the own turn from
 * the upkeep to main phase 2 that leaves a sorcery-speed spell in hand uncastable this turn
 * strands mana: the stranded spell's hand-table value, at least 2 (the play it would make this turn
 * is lost for a turn; instants and activations can wait for the opponent's turn or for spare mana).
 * An instant is penalized only for a bigger spell. In the upkeep and draw step, the spells
 * castable in main phase 1 with the land drop are compared, so cracking a Blood token in the upkeep that
 * leaves Fable one mana short counts: the one-ply score of the upkeep cannot see main phase 1.
 */
const STRAND_BEFORE = new WeakMap<GameState, Map<ObjId, number>>();

export function strandPenalty(before: GameState, after: GameState, me: PlayerId, move: Move): number {
  if (before.activePlayer !== me || !(isMain(before.step) || PRE_MAIN.has(before.step))) return 0;
  if (move.type !== 'cast' && move.type !== 'activate') return 0;
  let mv = 0;
  if (move.type === 'cast') {
    const o = before.objects[move.objId];
    const face = o ? getDef(o.defId).faces[move.face ?? 0] : undefined;
    if (!face || !face.types.includes('Instant')) return 0;
    mv = manaValueOf(parseMana(face.cost));
  }
  // Nothing to strand without a sorcery-speed nonland card in hand (the common case: no search).
  const sorceryInHand = before.zones.hand[me].some((id) => {
    const d = before.objects[id]?.defId;
    return d !== undefined && !isLandDef(d) && !getDef(d).faces[0]?.types.includes('Instant');
  });
  if (!sorceryInHand) return 0;
  // before is the decision state, shared by every move of the decision: computed once.
  // In a main phase the spells castable right now are compared (the land drop comes first);
  // before main phase 1, those castable there with the land drop.
  const castable = PRE_MAIN.has(before.step) ? mainPhaseCastable : castableSpells;
  let was = STRAND_BEFORE.get(before);
  if (!was) { was = castable(before, me); STRAND_BEFORE.set(before, was); }
  // Sorcery-speed spells in hand, bigger than the instant, castable this turn before the move.
  const at = [...was].filter(([id, v]) => {
    const d = before.objects[id]?.defId;
    return id !== move.objId && v > mv && before.objects[id]?.zone === 'hand' && d !== undefined && !getDef(d).faces[0]?.types.includes('Instant');
  });
  if (at.length === 0) return 0;
  const now = castable(after, me);
  let pen = 0;
  for (const [id] of at) if (!now.has(id)) pen = Math.max(pen, 2, CARDS.hand[before.objects[id]?.defId ?? ''] ?? 0);
  return pen;
}

// ---- the agent --------------------------------------------------------------------------------------

export function greedyAgent(seed: number, opts: GreedyOptions = {}): GreedyAgent {
  const rng = seedRng(seed);
  jump(rng);
  let prof: Profile | null = opts.deck && opts.deck !== 'auto' ? PROFILES[opts.deck] : null;
  const oppProf: Profile[] = [];

  const pick = (moves: readonly Move[], scores: readonly number[]): Move => {
    let best = -Infinity;
    for (const s of scores) if (s > best) best = s;
    const tied: number[] = [];
    scores.forEach((s, i) => { if (s >= best - EPS) tied.push(i); });
    const i = tied.length === 1 ? tied[0] as number : tied[nextInt(rng, tied.length)] as number;
    return moves[i] as Move;
  };

  return {
    name: opts.name ?? 'greedy',
    rng: () => cloneRng(rng),
    profile: () => prof,
    choose(d: Decision): Move {
      const moves = d.moves;
      if (moves.length === 0) throw new Error('greedyAgent: no legal moves');
      if (moves.length === 1) return moves[0] as Move;
      return pick(moves, scoreDecision(d));
    },
    explain(d: Decision): { move: Move; score: number }[] {
      const sc = scoreDecision(d);
      return d.moves.map((move, i) => ({ move, score: sc[i] as number }));
    },
  };

  /** One score per legal move (draws the sample from the agent's stream). */
  function scoreDecision(d: Decision): number[] {
    const moves = d.moves;
    if (!d.sample) throw new Error('greedyAgent: the caller must provide Decision.sample');
    const me = d.player;
    const s0 = d.sample(rng);
    if (!prof) prof = detectProfile(s0, me);
    if (oppProf.length === 0) oppProf.push(detectProfile(s0, other(me)));
    const my = prof;
    const profOf = (p: PlayerId): Profile => (p === me ? my : oppProf[0] as Profile);
    const ch = s0.pendingChoice;
    if (ch?.kind === 'mulligan') {
      const keep = mulliganMove(s0, me, moves);
      return moves.map((m) => (m === keep ? 1 : 0));
    }
    if (ch?.kind === 'bottom') return bottomScores(s0, me, moves);

    return scoreMoves(s0, me, moves, my, profOf, true);
  }
}

/**
 * After animating a manland on the own turn before attacks, plays on to the own declare-attackers
 * choice (passing priority) and returns that state, or null when it is not reached.
 */
function toOwnAttack(state: GameState, me: PlayerId): GameState | null {
  const st = cloneState(state);
  for (let i = 0; i < 8; i++) {
    if (st.result || st.activePlayer !== me) return null;
    const ch = st.pendingChoice;
    if (ch) return ch.kind === 'declareAttackers' && ch.player === me ? st : null;
    if (st.step !== 'main1' && st.step !== 'beginCombat') return null;
    applyMoveInPlace(st, { type: 'pass' });
  }
  return null;
}

/**
 * The state a move is scored at: the move applied to a copy of s0 and settled. Passing with an
 * empty stack outside combat is 'do nothing now' and is scored as s0 itself, which is the point
 * the other moves settle back to (the stack empty at a priority decision of the same step). Inside
 * combat (declare attackers to combat damage) every other move settles through the damage step,
 * so the pass is settled too: otherwise the pass would be scored before combat damage and the
 * other moves after it.
 */
export function scoredState(s0: GameState, m: Move, me: PlayerId, profOf: (p: PlayerId) => Profile): GameState {
  if (m.type === 'pass' && s0.zones.stack.length === 0 && !s0.pendingChoice && !IN_COMBAT.has(s0.step)) return s0;
  const after = applyMove(s0, m);
  settle(after, me, profOf);
  return after;
}

/** Scores every move at s0 for me (see the file comment); lookAttack allows the manland look-ahead. */
function scoreMoves(
  s0: GameState, me: PlayerId, moves: readonly Move[], my: Profile, profOf: (p: PlayerId) => Profile, lookAttack: boolean,
): number[] {
  const ch = s0.pendingChoice;
  const opp = other(me);
  const mainTwoPass = !ch && s0.activePlayer === me && s0.step === 'main2' && s0.zones.stack.length === 0;
  return moves.map((m) => {
    const after = scoredState(s0, m, me, profOf);
    // A manland animated before attacks: the other moves are scored before combat, so the manland
    // earns only what it adds to the attack (the best attack with it minus the best without it,
    // not below 0), on top of the usual score of the animated position (mana spent, stranded
    // spells). Scoring it by the whole attack credited it with every other attacker's damage.
    let manlandGain = 0;
    if (lookAttack && m.type === 'activate' && s0.activePlayer === me && !after.result
      && after.objects[m.objId]?.animated && !after.objects[m.objId]?.sick && isLandDef(after.objects[m.objId]?.defId ?? '')) {
      const atk = toOwnAttack(after, me);
      if (atk) {
        const opts = legalMoves(atk, me);
        const sc = scoreMoves(atk, me, opts, my, profOf, false);
        let withIt = -Infinity;
        let without = -Infinity;
        opts.forEach((o, i) => {
          if (o.type !== 'declareAttackers') return;
          if (o.assignments.some(([id]) => id === m.objId)) withIt = Math.max(withIt, sc[i] as number);
          else without = Math.max(without, sc[i] as number);
        });
        if (withIt > -Infinity && without > -Infinity) manlandGain = Math.max(0, withIt - without);
      }
    }
    let v = evaluate(after, me, my, CARDS);
    if (after.result) return v;
    // Take draw steps out of comparisons that cross a turn boundary.
    const draws = drawsBetween(s0, after);
    v -= draws[me] * AVG_DRAW;
    v += draws[opp] * OPP_HAND_CARD;
    v += my.moveBonus({ before: s0, after, move: m, me, moves, cards: CARDS });
    if (m.type === 'playLand') v += landPlayBonus(s0, me, m.objId, m.face ?? 0) + landEnableBonus(s0, after, me);
    v -= strandPenalty(s0, after, me, m);
    // Discard picks from the opponent's hand: take the most dangerous card.
    if (m.type === 'choose' && ch?.kind === 'pickObjects') {
      for (const id of m.answer.ids ?? []) {
        const o = s0.objects[id];
        if (o && o.owner === opp && o.zone === 'hand') v += CARDS.threat[o.defId] ?? 0.3;
      }
    }
    // Mana efficiency: unspent mana when passing out of the own main phase 2.
    if (mainTwoPass && m.type === 'pass' && moves.some((x) => x.type === 'cast' || x.type === 'activate')) {
      let untapped = 0;
      for (const id of s0.zones.battlefield) {
        const o = s0.objects[id];
        if (o && o.controller === me && !o.tapped && isLandDef(o.defId)) untapped++;
      }
      v -= 0.4 * Math.max(0, untapped - my.reserve(s0, me));
    }
    return v + manlandGain;
  });
}
