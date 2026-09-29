// Thoughtseize scenarios (docs/CARD-ANALYSIS.json). Player 0 is A (the caster), player 1 is B.
import { describe, expect, it } from 'vitest';
import { given, id1, TestBear, TestBolt } from '../helpers.js';
import { act, answer, castMove, moves, P, pass } from '../scenario.js';
import { view } from '../../engine/view.js';
import { drawCards } from '../../engine/zones.js';
import { checkViewLeak } from '../../tools/play.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const SWIFT = 'Monastery Swiftspear';

function resolveAll(s: GameState): void {
  while (s.zones.stack.length > 0 && !s.pendingChoice && !s.result) pass(s);
}
function setup(bHand: string[]): GameState {
  return given({
    turn: 3, step: 'main1', active: 0,
    battlefield: ['Swamp', 'Mountain'],
    hands: [['Thoughtseize', TestBolt.id], bHand],
    libraries: [lib(5), lib(5)],
  });
}

describe('Thoughtseize', () => {
  it('scenario 1: A takes Swiftspear from [Mountain, Bolt, Swiftspear]; A at 18; the rest of B\'s hand is known to A', () => {
    const s = setup(['Mountain', TestBolt.id, SWIFT]);
    const sw = id1(s, SWIFT, 'hand', 1);
    act(s, castMove(s, 'Thoughtseize', [P(1)]));
    resolveAll(s);
    if (s.pendingChoice?.kind !== 'pickObjects') throw new Error('expected the Thoughtseize choice');
    expect(s.pendingChoice.player).toBe(0);
    expect(s.pendingChoice.from.length).toBe(2); // Bolt and Swiftspear; the Mountain is a land
    expect(moves(s).length).toBe(2);
    answer(s, { ids: [sw] });
    expect(s.players[0].life).toBe(18);
    expect(s.zones.graveyard[1].map((id) => s.objects[id]?.defId)).toEqual(['monastery-swiftspear']);
    expect(s.zones.hand[1].length).toBe(2);
    for (const id of s.zones.hand[1]) expect(s.objects[id]?.knownTo[0]).toBe(true);
  });

  it('scenario 2: after B draws, A sees 2 known cards and 1 unknown in B\'s hand (CR 400.2 (hidden zones))', () => {
    const s = setup(['Mountain', TestBolt.id, SWIFT]);
    act(s, castMove(s, 'Thoughtseize', [P(1)]));
    resolveAll(s);
    answer(s, { ids: [id1(s, SWIFT, 'hand', 1)] });
    drawCards(s, 1, 1);
    const v = view(s, 0);
    expect(v.zones.hand[1].known.length).toBe(2);
    expect(v.zones.hand[1].hidden.length).toBe(1);
    const hidden = checkViewLeak(s, 0);
    console.log(`thoughtseize view leak check: hidden objects for A=${hidden}`);
    expect(hidden).toBeGreaterThan(0);
  });

  it('scenario 3: B holds only lands: the hand is revealed, nothing is discarded, A still loses 2 (CR 608.2c (instructions in order))', () => {
    const s = setup(['Mountain', 'Mountain']);
    act(s, castMove(s, 'Thoughtseize', [P(1)]));
    resolveAll(s);
    expect(s.pendingChoice).toBeNull();
    expect(s.players[0].life).toBe(18);
    expect(s.zones.hand[1].length).toBe(2);
    for (const id of s.zones.hand[1]) expect(s.objects[id]?.knownTo).toEqual([true, true]);
  });

  it('the generator offers only the opponent as target (player targets collapse to the opponent)', () => {
    const s = setup(['Mountain']);
    const casts = moves(s).filter((m) => m.type === 'cast' && s.objects[m.objId]?.defId === 'thoughtseize');
    expect(casts.length).toBeGreaterThan(0);
    for (const m of casts) if (m.type === 'cast') expect(m.targets).toEqual([P(1)]);
  });
});
