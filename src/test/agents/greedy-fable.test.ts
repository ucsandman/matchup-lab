// Greedy regression (Phase 3 gate finding): with a strong seven on the play (Blood Crypt,
// Blackcleave Cliffs, Swamp, Thoughtseize, Bloodtithe Harvester, Fable of the Mirror-Breaker,
// Fatal Push), greedy Rakdos played 3 lands by own turn 3 in about 90 percent of games but cast
// Fable by then in about 5 percent. Root cause: drawsBetween (src/agents/evaluate.ts) did not
// count the draw step of the current turn, so an upkeep Blood token activation, which the engine
// auto-passes into main phase 1, was credited with the draw step's card while the upkeep pass was
// scored before the draw; the crack tapped the third mana Fable needed, and the strand penalty
// (src/agents/greedy.ts) looked only at instants cast in a main phase. This test on the code
// before the fix: Fable 5.0% [95% CI 2.7-9.0%, n=200], 3 lands 90.0% [95% CI 85.1-93.4%, n=200],
// and the drawsBetween case below failed (0 draws from upkeep to main phase 1).
import { describe, expect, it } from 'vitest';
import { runMatch } from '../../sim/runner.js';
import type { MatchJob } from '../../sim/games.js';
import { fmtPct } from '../../sim/stats.js';
import { drawsBetween } from '../../agents/evaluate.js';
import { newGame } from '../../engine/setup.js';
import { cloneState } from '../../engine/apply.js';
import type { DefId, GameState, Step } from '../../engine/types.js';

const HAND: DefId[] = [
  'blood-crypt', 'blackcleave-cliffs', 'swamp', 'thoughtseize', 'bloodtithe-harvester', 'fable-of-the-mirror-breaker', 'fatal-push',
];

describe('drawsBetween', () => {
  const at = (s: GameState, turn: number, step: Step): GameState => {
    const c = cloneState(s);
    c.turn = turn;
    c.step = step;
    c.activePlayer = turn % 2 === 1 ? 0 : 1;
    return c;
  };
  it('counts the draw step of the current turn when the first state is before it', () => {
    const s = newGame('deckA', 'deckB', 1, 0);
    expect(drawsBetween(at(s, 5, 'upkeep'), at(s, 5, 'main1'))).toEqual([1, 0]);
    expect(drawsBetween(at(s, 5, 'untap'), at(s, 5, 'draw'))).toEqual([1, 0]);
    expect(drawsBetween(at(s, 5, 'upkeep'), at(s, 5, 'upkeep'))).toEqual([0, 0]);
    expect(drawsBetween(at(s, 5, 'main1'), at(s, 5, 'end'))).toEqual([0, 0]);
    expect(drawsBetween(at(s, 5, 'main2'), at(s, 6, 'main1'))).toEqual([0, 1]);
    expect(drawsBetween(at(s, 5, 'upkeep'), at(s, 6, 'upkeep'))).toEqual([1, 0]);
    expect(drawsBetween(at(s, 4, 'end'), at(s, 7, 'main1'))).toEqual([2, 1]);
    // The player on the play skips the draw of turn 1.
    expect(drawsBetween(at(s, 1, 'upkeep'), at(s, 2, 'main1'))).toEqual([0, 1]);
  });
});

describe('greedy casts Fable on curve from a strong seven', () => {
  it('Fable of the Mirror-Breaker is cast by own turn 3 in at least 70 percent of 200 games on the play', async () => {
    const job: MatchJob = {
      deckA: 'deckA', deckB: 'deckB', agentA: { kind: 'greedy' }, agentB: { kind: 'greedy' }, play: 'A',
      handSetup: { branch: 'keep', mulligans: 0, hand: HAND },
      keyCards: [
        { label: 'Fable of the Mirror-Breaker cast by own turn 3', side: 'A', defIds: ['fable-of-the-mirror-breaker'], byTurn: 3, how: 'cast' },
        { label: '3 lands by own turn 3', side: 'A', defIds: [], byTurn: 3, how: 'lands', count: 3 },
      ],
    };
    const r = await runMatch(job, { games: 200, seed: 20260929 });
    const [fable, lands] = r.keyCards;
    console.log(`strong seven on the play, greedy vs greedy Mono-Red: ${fable!.label}: ${fmtPct(fable!.p)}; ${lands!.label}: ${fmtPct(lands!.p)}`);
    expect(fable!.p.n).toBe(200);
    expect(fable!.p.est).toBeGreaterThanOrEqual(0.7);
  }, 600_000);
});
