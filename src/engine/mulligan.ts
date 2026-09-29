// London mulligan, following CR 103.5 (mulligan) as written in docs/CR.txt: the starting player
// declares first, then the other player; everyone who declared a mulligan shuffles their hand into
// their library, draws seven, and puts cards equal to their mulligan count on the bottom in any
// order; repeat until nobody takes a mulligan. A player may mulligan only while the new hand would
// have at least one card. The bottom choice is a Choice so the mulligan tool can decide it, and
// the bottomed cards are recorded in the owner's libraryKnown.bottom (the view keeps them).
//
// When pregame is done: state.pregame === null and pendingChoice === null; turn.ts starts turn 1.
import { moveObject, shuffleLibrary, drawCards } from './zones.js';
import { drainEvents, setPlayer, setTop } from './mutate.js';
import type { ChoiceAnswer, GameState, ObjId, PlayerId, Pregame } from './types.js';

const HAND = 7;

export function canMulligan(state: GameState, p: PlayerId): boolean {
  return state.players[p].mulligans < HAND;
}

/** Answers the pending mulligan or bottom Choice. */
export function answerPregame(state: GameState, answer: ChoiceAnswer): void {
  const ch = state.pendingChoice;
  const pg = state.pregame;
  if (!ch || !pg) throw new Error('answerPregame: no pregame choice pending');
  if (ch.kind === 'mulligan') {
    const keep = answer.keep;
    if (keep === undefined) throw new Error('answerPregame: mulligan answer needs keep');
    if (!keep && !canMulligan(state, ch.player)) throw new Error('answerPregame: no further mulligans allowed');
    const next: Pregame = {
      toDeclare: pg.toDeclare.slice(1),
      mulling: keep ? [...pg.mulling] : [...pg.mulling, ch.player],
      toBottom: [...pg.toBottom],
    };
    if (keep) setPlayer(state, ch.player, 'kept', true);
    setTop(state, 'pregame', next);
    advance(state);
    drainEvents(state); // pregame draws and moves trigger nothing
    return;
  }
  if (ch.kind === 'bottom') {
    const ids = answer.ids ?? [];
    const hand = state.zones.hand[ch.player];
    if (ids.length !== ch.count || new Set(ids).size !== ids.length || ids.some((id) => !hand.includes(id))) {
      throw new Error(`answerPregame: bottom needs ${ch.count} distinct cards from the hand`);
    }
    // CR 401.4 (library order): the owner arranges them. Each goes beneath the previous one, so the
    // last id in the answer ends up as the very bottom card.
    for (const id of ids) moveObject(state, id, 'library', { position: 'bottom', cause: 'mulligan' });
    setTop(state, 'pregame', { ...pg, toBottom: pg.toBottom.slice(1) });
    advance(state);
    drainEvents(state);
    return;
  }
  throw new Error(`answerPregame: pending choice is ${ch.kind}`);
}

function advance(state: GameState): void {
  const pg = state.pregame as Pregame;
  if (pg.toDeclare.length > 0) {
    setTop(state, 'pendingChoice', { kind: 'mulligan', player: pg.toDeclare[0] as PlayerId });
    return;
  }
  if (pg.mulling.length > 0) {
    // All mulligans this round happen at the same time.
    for (const p of pg.mulling) takeMulligan(state, p);
    setTop(state, 'pregame', { toDeclare: [], mulling: [], toBottom: [...pg.mulling] });
    advance(state);
    return;
  }
  if (pg.toBottom.length > 0) {
    const p = pg.toBottom[0] as PlayerId;
    setTop(state, 'pendingChoice', { kind: 'bottom', player: p, count: state.players[p].mulligans });
    return;
  }
  const order: PlayerId[] = state.startingPlayer === 0 ? [0, 1] : [1, 0];
  const undecided = order.filter((p) => !state.players[p].kept);
  if (undecided.length > 0) {
    setTop(state, 'pregame', { toDeclare: undecided, mulling: [], toBottom: [] });
    setTop(state, 'pendingChoice', { kind: 'mulligan', player: undecided[0] as PlayerId });
    return;
  }
  setTop(state, 'pregame', null);
  setTop(state, 'pendingChoice', null);
}

function takeMulligan(state: GameState, p: PlayerId): void {
  for (const id of [...state.zones.hand[p]] as ObjId[]) moveObject(state, id, 'library', { cause: 'mulligan' });
  shuffleLibrary(state, p);
  drawCards(state, p, HAND);
  setPlayer(state, p, 'mulligans', state.players[p].mulligans + 1);
}
