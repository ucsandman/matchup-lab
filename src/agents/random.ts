// Random agent: uniform over the legal moves, drawing from its own xoshiro128** stream. The stream
// is seeded from the agent seed and jumped once, so an agent seeded with the game seed still never
// shares the game stream (PLAN.md section 6, Seeded RNG).
import { cloneRng, jump, nextInt, seedRng } from '../engine/rng.js';
import type { RngState } from '../engine/types.js';
import type { Agent, Decision } from './types.js';

export interface RandomAgent extends Agent {
  /** Current RNG state (for replays). */
  rng(): RngState;
}

export function randomAgent(seed: number, name = 'random'): RandomAgent {
  const s = seedRng(seed);
  jump(s);
  return {
    name,
    choose(d: Decision) {
      if (d.moves.length === 0) throw new Error('randomAgent: no legal moves');
      return d.moves[nextInt(s, d.moves.length)] as NonNullable<Decision['moves'][number]>;
    },
    rng: () => cloneRng(s),
  };
}
