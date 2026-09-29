// Go Blank scenarios (docs/CARD-ANALYSIS.json). Player 0 is A (the caster), player 1 is B.
import { describe, expect, it } from 'vitest';
import { given, TestBear, TestBolt } from '../helpers.js';
import { act, answer, castMove, moves, P, pass } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
function resolveAll(s: GameState): void {
  while (s.zones.stack.length > 0 && !s.pendingChoice && !s.result) pass(s);
}
function setup(bHand: string[], bGrave: string[]): GameState {
  return given({
    turn: 3, step: 'main1', battlefield: ['Swamp', 'Mountain', 'Mountain', 'Mountain', 'Mountain'],
    hands: [['Go Blank', TestBolt.id], bHand], graveyards: [[], bGrave], libraries: [lib(5), lib(5)],
  });
}

describe('Go Blank', () => {
  it('scenario 1: B chooses 2 of [Bolt, Bolt, Mountain, Push]: 4 distinct pairs by name; then B\'s graveyard is exiled', () => {
    const s = setup([TestBolt.id, TestBolt.id, 'Mountain', 'Fatal Push'], ['Abrade']);
    act(s, castMove(s, 'Go Blank', [P(1)]));
    resolveAll(s);
    if (s.pendingChoice?.kind !== 'pickObjects') throw new Error('expected the discard choice');
    // CR 701.9b (discard): the discarding player chooses.
    expect(s.pendingChoice.player).toBe(1);
    const opts = moves(s);
    console.log(`go blank pair options=${opts.length}`);
    expect(opts.length).toBe(4);
    const first = opts[0];
    if (!first) throw new Error('no option');
    act(s, first);
    expect(s.zones.hand[1].length).toBe(2);
    expect(s.zones.graveyard[1].length).toBe(0);
    expect(s.zones.exile[1].length).toBe(3);
  });

  it('scenario 2: B holds one card: no choice; it is discarded and then exiled', () => {
    const s = setup(['Mountain'], []);
    act(s, castMove(s, 'Go Blank', [P(1)]));
    resolveAll(s);
    expect(s.pendingChoice).toBeNull();
    expect(s.zones.hand[1].length).toBe(0);
    expect(s.zones.graveyard[1].length).toBe(0);
    expect(s.zones.exile[1].map((id) => s.objects[id]?.defId)).toEqual(['mountain']);
  });

  it('answering with a specific pair discards exactly those (CR 608.2c (instructions in order))', () => {
    const s = setup([TestBolt.id, 'Mountain', 'Fatal Push'], []);
    act(s, castMove(s, 'Go Blank', [P(1)]));
    resolveAll(s);
    const hand = s.zones.hand[1];
    const keep = hand.find((id) => s.objects[id]?.defId === 'mountain');
    answer(s, { ids: hand.filter((id) => id !== keep) });
    expect(s.zones.hand[1]).toEqual([keep]);
    expect(s.zones.exile[1].map((id) => s.objects[id]?.defId).sort()).toEqual(['fatal-push', TestBolt.id].sort());
  });
});
