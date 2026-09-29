// Scenario helpers for rules tests: drive a given() state through the real engine (applyMove,
// auto-pass, triggers, SBAs) and find moves by card name.
import { advance, applyMoveInPlace } from '../engine/apply.js';
import { decider, legalMoves } from '../engine/moves.js';
import { getDef } from '../cards/index.js';
import type { ChoiceAnswer, GameState, Move, ObjId, PlayerId, Target } from '../engine/types.js';

export { advance };

/** Applies a move in place and advances to the next decision. */
export function act(s: GameState, m: Move): GameState {
  return applyMoveInPlace(s, m);
}
/** Passes priority; a pending attack or block declaration is answered with no creatures. */
export function pass(s: GameState, times = 1): GameState {
  for (let i = 0; i < times; i++) {
    const k = s.pendingChoice?.kind;
    if (k === 'declareAttackers') applyMoveInPlace(s, { type: 'declareAttackers', assignments: [] });
    else if (k === 'declareBlockers') applyMoveInPlace(s, { type: 'declareBlockers', assignments: [] });
    else applyMoveInPlace(s, { type: 'pass' });
  }
  return s;
}
export function answer(s: GameState, a: ChoiceAnswer): GameState {
  return applyMoveInPlace(s, { type: 'choose', answer: a });
}
export function who(s: GameState): PlayerId {
  const p = decider(s);
  if (p === null) throw new Error('game over');
  return p;
}
export function moves(s: GameState): Move[] {
  const p = decider(s);
  return p === null ? [] : legalMoves(s, p);
}

const nameOf = (s: GameState, id: ObjId): string => getDef(s.objects[id]?.defId ?? '').name;

/** The cast move for a card name (first match), optionally with these targets. */
export function castMove(s: GameState, name: string, targets?: Target[], pred: (m: Extract<Move, { type: 'cast' }>) => boolean = () => true): Move {
  const m = moves(s).find((x): x is Extract<Move, { type: 'cast' }> => x.type === 'cast' && nameOf(s, x.objId) === name
    && (!targets || JSON.stringify(x.targets) === JSON.stringify(targets)) && pred(x));
  if (!m) throw new Error(`no cast move for ${name} ${JSON.stringify(targets ?? '')}; moves: ${JSON.stringify(moves(s))}`);
  return m;
}
export function hasCast(s: GameState, name: string): boolean {
  return moves(s).some((x) => x.type === 'cast' && nameOf(s, x.objId) === name);
}

export const P = (p: PlayerId): Target => ({ kind: 'player', p });
export const O = (id: ObjId): Target => ({ kind: 'obj', id });
