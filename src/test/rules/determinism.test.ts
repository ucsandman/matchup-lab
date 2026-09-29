// Determinism and the two execution modes: the same seed and move list give byte-identical
// states; copy mode (applyMove) and in-place journal mode (applyMoveInPlace) produce the same
// states; every applyMove is fully undone by the journal (so the whole engine writes state only
// through the mutators).
import { describe, expect, it } from 'vitest';
import { canon } from '../helpers.js';
import { EXTENDED_DECK_A, EXTENDED_DECK_B } from '../pool.js';
import { newGame } from '../../engine/setup.js';
import { applyMove, applyMoveInPlace, cloneState } from '../../engine/apply.js';
import { decider, legalMoves } from '../../engine/moves.js';
import { beginJournal, endJournal, mark, undoTo } from '../../engine/mutate.js';
import { randomAgent } from '../../agents/random.js';
import type { GameState, Move } from '../../engine/types.js';

function playRandom(seed: number, agentSeed: number, maxMoves = 5000): Move[] {
  const s = newGame(EXTENDED_DECK_A, EXTENDED_DECK_B, seed);
  const ag = [randomAgent(agentSeed), randomAgent(agentSeed + 1)];
  const out: Move[] = [];
  while (!s.result && out.length < maxMoves) {
    const p = decider(s)!;
    const m = ag[p]!.choose({ player: p, moves: legalMoves(s, p), view: () => { throw new Error('unused'); } });
    out.push(m);
    applyMoveInPlace(s, m);
  }
  return out;
}

const strip = (s: GameState): string => { const c = cloneState(s); return canon(c); };

describe('determinism and execution modes', () => {
  it('same seed and move list give byte-identical states, in copy mode and in journal mode', () => {
    let totalMoves = 0;
    for (const seed of [11, 12, 13]) {
      const moves = playRandom(seed, seed * 7);
      totalMoves += moves.length;
      let a = newGame(EXTENDED_DECK_A, EXTENDED_DECK_B, seed);
      const b = newGame(EXTENDED_DECK_A, EXTENDED_DECK_B, seed);
      beginJournal(b);
      for (const m of moves) {
        a = applyMove(a, m);
        applyMoveInPlace(b, m);
        expect(strip(a)).toBe(strip(b));
      }
      expect(a.result).not.toBeNull();
    }
    console.log(`determinism: ${totalMoves} moves compared across copy and journal mode`);
    expect(totalMoves).toBeGreaterThan(100);
  });

  it('copy mode leaves the input state untouched', () => {
    const s = newGame(EXTENDED_DECK_A, EXTENDED_DECK_B, 21);
    const before = strip(s);
    const m = legalMoves(s, decider(s)!)[0]!;
    const next = applyMove(s, m);
    expect(strip(s)).toBe(before);
    expect(strip(next)).not.toBe(before);
  });

  it('journal: every applyMove is undone exactly (no write bypasses the mutators)', () => {
    let checked = 0;
    for (const seed of [31, 32]) {
      const moves = playRandom(seed, seed * 3);
      const s = newGame(EXTENDED_DECK_A, EXTENDED_DECK_B, seed);
      beginJournal(s);
      for (const m of moves) {
        const before = strip(s);
        const at = mark(s);
        applyMoveInPlace(s, m);
        undoTo(s, at);
        expect(strip(s)).toBe(before);
        applyMoveInPlace(s, m);
        checked++;
      }
      endJournal(s);
    }
    console.log(`journal completeness: ${checked} applyMove calls undone and compared`);
    expect(checked).toBeGreaterThan(100);
  });
});
