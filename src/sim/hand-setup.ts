// Pregame setup for the Phase 3 hand tool (src/tools/goldfish.ts; PLAN.md section 8). A leaf
// module: games.ts applies it to a fresh newGame state before any agent decision. Deck A is
// player 0. Plain data only, so a HandSetup travels to worker threads inside the MatchJob.
//
//  - keep branch: A holds the given hand after 'mulligans' mulligans and keeps it. A 7-card hand
//    has 'bottom' (chosen by the tool) put on the bottom through the engine's London mulligan
//    bottom choice, CR 103.5 (mulligan); a hand of 7 - mulligans cards was already bottomed by
//    the player, and the bottomed cards, unknown to the tool, are modeled by the random cards the
//    deal put in the other hand slots (an approximation: a real player's bottoms are not random).
//  - mulligan branch: A takes one more mulligan: a fresh random seven (newGame's deal is a
//    uniformly random seven from the whole 60, the kept hand shuffled back in), mulligans + 1
//    cards to bottom, chosen by A's own agent, then A decides keep or mulligan again as usual.
// Deck B is untouched: its normal seven and its agent's mulligans.
import { answerPregame } from '../engine/mulligan.js';
import { invalidateMemo, setPlayer, setTop } from '../engine/mutate.js';
import type { DefId, GameState, ObjId, PlayerId } from '../engine/types.js';

export interface HandSetup {
  branch: 'keep' | 'mulligan';
  /** Mulligans A has already taken before this hand. */
  mulligans: number;
  /** keep: A's hand as def ids, 7 cards (bottom still to choose) or 7 - mulligans (already bottomed). */
  hand?: DefId[];
  /** keep with a 7-card hand and mulligans > 0: the def ids to put on the bottom (a sub-multiset of hand). */
  bottom?: DefId[];
}

const A: PlayerId = 0;
const HAND = 7;

/**
 * Puts the wanted cards in p's hand by swapping card identities between hand and library objects
 * (setup only, like fixOpeningHand in games.ts, but the wanted cards may be fewer than the hand).
 * Returns the hand ids that hold the wanted cards, in the order of 'want'.
 */
export function dealHand(state: GameState, p: PlayerId, want: readonly DefId[]): ObjId[] {
  const hand = state.zones.hand[p];
  if (want.length > hand.length) throw new Error(`dealHand: ${want.length} cards for a hand of ${hand.length}`);
  const slots: (ObjId | undefined)[] = want.map(() => undefined);
  const taken = new Set<ObjId>();
  // Hand cards that already are a wanted card keep it.
  want.forEach((d, j) => {
    const id = hand.find((h) => !taken.has(h) && state.objects[h]?.defId === d);
    if (id !== undefined) { slots[j] = id; taken.add(id); }
  });
  const lib = state.zones.library[p];
  want.forEach((d, j) => {
    if (slots[j] !== undefined) return;
    const libId = lib.find((id) => state.objects[id]?.defId === d);
    if (libId === undefined) throw new Error(`dealHand: the deck has no more copies of ${d}`);
    const slot = hand.find((h) => !taken.has(h));
    if (slot === undefined) throw new Error('dealHand: no free hand slot');
    const handObj = state.objects[slot];
    const libObj = state.objects[libId];
    if (!handObj || !libObj) throw new Error('dealHand: dangling id');
    libObj.defId = handObj.defId;
    handObj.defId = d;
    slots[j] = slot;
    taken.add(slot);
  });
  invalidateMemo(state);
  return slots as ObjId[];
}

/** Applies the setup to a state fresh from newGame (pregame, first mulligan decision pending). */
export function applyHandSetup(state: GameState, s: HandSetup): void {
  if (!state.pregame || state.zones.hand[A].length !== HAND) throw new Error('applyHandSetup: needs a fresh newGame state');
  const n = s.mulligans;
  if (!Number.isInteger(n) || n < 0 || n > HAND - 2) throw new Error(`applyHandSetup: mulligans must be 0 to ${HAND - 2}, got ${n}`);
  if (s.branch === 'mulligan') {
    // One more mulligan: the dealt seven is the new draw; A's agent bottoms n + 1 and decides again.
    setPlayer(state, A, 'mulligans', n + 1);
    setTop(state, 'pregame', { toDeclare: [], mulling: [], toBottom: [A] });
    setTop(state, 'pendingChoice', { kind: 'bottom', player: A, count: n + 1 });
    return;
  }
  const hand = s.hand ?? [];
  if (hand.length !== HAND && hand.length !== HAND - n) throw new Error(`applyHandSetup: hand of ${hand.length} cards after ${n} mulligans`);
  const held = dealHand(state, A, hand);
  setPlayer(state, A, 'kept', true);
  if (n === 0) {
    setTop(state, 'pregame', { toDeclare: [1], mulling: [], toBottom: [] });
    setTop(state, 'pendingChoice', { kind: 'mulligan', player: 1 });
    return;
  }
  let ids: ObjId[];
  if (hand.length === HAND) {
    const bottom = s.bottom ?? [];
    if (bottom.length !== n) throw new Error(`applyHandSetup: ${bottom.length} bottom cards for ${n} mulligans`);
    const used = new Set<number>();
    ids = bottom.map((d) => {
      const j = hand.findIndex((h, k) => !used.has(k) && h === d);
      if (j < 0) throw new Error(`applyHandSetup: bottom card ${d} is not in the hand`);
      used.add(j);
      return held[j] as ObjId;
    });
  } else {
    ids = state.zones.hand[A].filter((id) => !held.includes(id));
  }
  setPlayer(state, A, 'mulligans', n);
  setTop(state, 'pregame', { toDeclare: [], mulling: [], toBottom: [A] });
  setTop(state, 'pendingChoice', { kind: 'bottom', player: A, count: n });
  // The engine's bottom answer: moves them under the library, records them in libraryKnown.bottom
  // and asks B's first declaration (A already kept).
  answerPregame(state, { ids });
}
