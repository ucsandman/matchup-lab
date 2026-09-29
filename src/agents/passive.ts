// Passive agent: the goldfish opponent of the Phase 3 hand tool (PLAN.md section 8). It keeps its
// opening seven, never plays a land, casts, activates, attacks or blocks: at priority it passes,
// for attacks and blocks it declares none, and any other choice (the cleanup discard) takes the
// first legal option. It draws no randomness, so its games depend only on the game seed and the
// other agent.
import type { Move } from '../engine/types.js';
import type { Agent, Decision } from './types.js';

export function passiveAgent(name = 'passive'): Agent {
  return {
    name,
    choose(d: Decision): Move {
      if (d.moves.length === 0) throw new Error('passiveAgent: no legal moves');
      let best: Move = d.moves[0] as Move;
      let bestRank = Infinity;
      for (const m of d.moves) {
        let rank = 3;
        if (m.type === 'pass') rank = 0;
        else if (m.type === 'choose' && m.answer.keep === true) rank = 0;
        else if ((m.type === 'declareAttackers' || m.type === 'declareBlockers') && m.assignments.length === 0) rank = 0;
        else if (m.type === 'choose') rank = 1;
        if (rank < bestRank) { best = m; bestRank = rank; }
      }
      return best;
    },
  };
}
