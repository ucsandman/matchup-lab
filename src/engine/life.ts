// Life gain, life loss and life payment. Every life change goes through here so the
// cantGainLife hook (Screaming Nemesis flag, Sunspine Lynx static) is checked in one place.
import { pushEvent, setPlayer } from './mutate.js';
import { staticAbilities } from './statics.js';
import type { GameState, PlayerId } from './types.js';

/** CR 119.7 (can't gain life): the player flag or any cantGainLife static on the battlefield. */
export function canGainLife(state: GameState, p: PlayerId): boolean {
  return !state.players[p].cantGainLife && staticAbilities(state, 'cantGainLife').length === 0;
}

/** Returns the life actually gained (0 when life gain is prohibited). CR 119.3 (gain life). */
export function gainLife(state: GameState, p: PlayerId, n: number): number {
  if (n <= 0 || !canGainLife(state, p)) return 0;
  setPlayer(state, p, 'life', state.players[p].life + n);
  pushEvent(state, { e: 'lifeGain', player: p, amount: n });
  return n;
}

/** CR 119.3 (lose life). */
export function loseLife(state: GameState, p: PlayerId, n: number): void {
  if (n <= 0) return;
  setPlayer(state, p, 'life', state.players[p].life - n);
  pushEvent(state, { e: 'lifeLoss', player: p, amount: n });
}

/** CR 119.4 (pay life): allowed only if life total is at least the payment; paying is losing life. */
export function canPayLife(state: GameState, p: PlayerId, n: number): boolean {
  return n <= 0 || state.players[p].life >= n;
}
export function payLife(state: GameState, p: PlayerId, n: number): void {
  if (!canPayLife(state, p, n)) throw new Error(`payLife: player ${p} has ${state.players[p].life} life, cannot pay ${n}`);
  loseLife(state, p, n);
}
