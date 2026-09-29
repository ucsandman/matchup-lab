// Shared helpers for the lands family scenario tests (src/test/cards/<land>.test.ts).
import { expect } from 'vitest';
import { id1 } from '../helpers.js';
import { moves, pass } from '../scenario.js';
import { activateAbility, playLand } from '../../engine/stack.js';
import { advance } from '../../engine/apply.js';
import type { GameState, Move, ObjId, PlayerId, Target } from '../../engine/types.js';

/** Passes (and answers declarations with nothing) until pred holds; fails after max passes. */
export function passUntil(s: GameState, pred: (s: GameState) => boolean, max = 200): GameState {
  let n = 0;
  while (!pred(s)) {
    if (s.result) throw new Error(`game ended (${s.result.reason}) before the condition held`);
    if (++n > max) throw new Error('passUntil: condition never held');
    pass(s);
  }
  return s;
}

/** Plays a land directly (no advance), as the playLand special action does. */
export function playLandNow(s: GameState, name: string, opts: { face?: 0 | 1; pay?: boolean; player?: PlayerId } = {}): ObjId {
  const p = opts.player ?? 0;
  const id = id1(s, name, 'hand', p);
  const m: Extract<Move, { type: 'playLand' }> = { type: 'playLand', objId: id };
  if (opts.face !== undefined) m.face = opts.face;
  if (opts.pay !== undefined) m.pay = opts.pay;
  playLand(s, p, m);
  const bf = s.zones.battlefield[s.zones.battlefield.length - 1];
  expect(bf).toBeDefined();
  return bf as ObjId;
}

/** Activation moves the decider has for this object right now. */
export function activations(s: GameState, objId: ObjId): Extract<Move, { type: 'activate' }>[] {
  return moves(s).filter((m): m is Extract<Move, { type: 'activate' }> => m.type === 'activate' && m.objId === objId);
}

/** Activates directly (no advance) and returns the stack item id. */
export function activateNow(s: GameState, p: PlayerId, objId: ObjId, abilityKey: string, extra: { targets?: Target[]; sacrifice?: ObjId[]; payment?: number } = {}): ObjId {
  const m: Extract<Move, { type: 'activate' }> = { type: 'activate', objId, abilityKey, targets: extra.targets ?? [] };
  if (extra.sacrifice) m.sacrifice = extra.sacrifice;
  if (extra.payment !== undefined) m.payment = extra.payment;
  return activateAbility(s, p, m);
}

/** Runs the engine loop (triggers, SBAs, auto-passes) until the next real decision. */
export function settle(s: GameState): GameState {
  advance(s);
  return s;
}
