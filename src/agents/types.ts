// The agent interface. An agent picks one of the legal moves for the player whose decision it is:
// priority moves and pendingChoice answers (mulligan, bottom, picks, targets, attacks, blocks)
// alike. Agents see the game only through the per-player view (PlayerView) or through a sample
// (a full state with every card hidden from the deciding player re-dealt from the agent's own
// stream), never the real state, and draw randomness only from their own RNG stream, never from
// the game's (PLAN.md D16). The runner seeds each agent's stream.
import type { GameState, Move, PlayerId, RngState } from '../engine/types.js';
import type { PlayerView } from '../engine/view.js';

export interface Decision {
  player: PlayerId;
  /** legalMoves(state, player); never empty when an agent is asked. */
  moves: readonly Move[];
  /** The deciding player's view, built on demand (random agents never pay for it). */
  view(): PlayerView;
  /**
   * A determinized copy of the game for search-style agents (src/agents/sample.ts): the cards
   * hidden from the deciding player are permuted among the hidden slots with rng (the agent's
   * stream) and the game seed is replaced, so the copy holds nothing the view does not. The
   * caller's state is never touched. Absent when the caller cannot provide one.
   */
  sample?(rng: RngState): GameState;
}

export interface Agent {
  readonly name: string;
  choose(d: Decision): Move;
}

export type AgentKind = 'random' | 'greedy' | 'passive' | 'mcts';
