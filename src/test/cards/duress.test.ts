// Duress scenarios (docs/CARD-ANALYSIS.json). Player 0 is A (Rakdos, the caster), player 1 is B.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, TestBear, TestBolt } from '../helpers.js';
import { act, answer, castMove, moves, P, pass } from '../scenario.js';
import { view } from '../../engine/view.js';
import { checkViewLeak } from '../../tools/play.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const SWIFT = 'Monastery Swiftspear';

/** Passes until the stack is empty or a choice is pending. */
function resolveAll(s: GameState): void {
  while (s.zones.stack.length > 0 && !s.pendingChoice && !s.result) pass(s);
}

/** A has Duress plus a Bolt and a spare Mountain, so the engine stops at A's priority afterwards. */
function setup(bHand: string[]): GameState {
  return given({
    turn: 3, step: 'main1', active: 0,
    battlefield: ['Swamp', 'Mountain'],
    hands: [['Duress', TestBolt.id], bHand],
    libraries: [lib(5), lib(5)],
  });
}

describe('Duress', () => {
  it('scenario 1: B holds Mountain, a Bolt and Swiftspear: only the Bolt can be taken; the rest of the hand becomes known to A', () => {
    const s = setup(['Mountain', TestBolt.id, SWIFT]);
    const bolt = id1(s, TestBolt.id, 'hand', 1);
    act(s, castMove(s, 'Duress', [P(1)]));
    resolveAll(s);
    expect(s.pendingChoice?.kind).toBe('pickObjects');
    if (s.pendingChoice?.kind !== 'pickObjects') throw new Error('no choice');
    expect(s.pendingChoice.player).toBe(0);
    expect(s.pendingChoice.from).toEqual([bolt]);
    // While the choice is pending the chooser sees the revealed hand (reveal hook), and nothing leaks.
    const v = view(s, 0);
    expect(v.zones.hand[1].known.length).toBe(3);
    expect(v.zones.hand[1].hidden.length).toBe(0);
    const hiddenChecked = checkViewLeak(s, 0) + checkViewLeak(s, 1);
    console.log(`duress view leak check: hidden objects checked=${hiddenChecked}`);
    expect(hiddenChecked).toBeGreaterThan(0);
    // L1: without the reveal list, the choice's from ids would be hidden ids in A's view; the checker catches it.
    const bare = structuredClone(s);
    if (bare.pendingChoice?.kind === 'pickObjects') delete bare.pendingChoice.reveal;
    expect(() => checkViewLeak(bare, 0)).toThrow(/inv8/);
    // B's own view of A's pending choice is reduced to its kind.
    expect(view(s, 1).pendingChoice).toEqual({ kind: 'pickObjects', player: 0, hidden: true });
    answer(s, { ids: [bolt] });
    expect(s.zones.graveyard[1].map((id) => s.objects[id]?.defId)).toEqual([TestBolt.id]);
    const hand = s.zones.hand[1];
    expect(hand.length).toBe(2);
    for (const id of hand) expect(s.objects[id]?.knownTo).toEqual([true, true]);
    expect(s.players[0].life).toBe(20);
    expect(s.zones.graveyard[0].map((id) => s.objects[id]?.defId)).toEqual(['duress']);
  });

  it('scenario 2: B holds only creatures and lands: the hand is revealed, no choice, no discard', () => {
    const s = setup(['Mountain', SWIFT, TestBear.id]);
    act(s, castMove(s, 'Duress', [P(1)]));
    resolveAll(s);
    expect(s.pendingChoice).toBeNull();
    expect(s.zones.hand[1].length).toBe(3);
    expect(s.zones.graveyard[1].length).toBe(0);
    for (const id of s.zones.hand[1]) expect(s.objects[id]?.knownTo[0]).toBe(true);
    expect(view(s, 0).zones.hand[1].hidden.length).toBe(0);
  });

  it('scenario 3: two copies of one card and one other: the choice collapses by name to 2 options', () => {
    const s = setup([TestBolt.id, TestBolt.id, 'Fatal Push']);
    act(s, castMove(s, 'Duress', [P(1)]));
    resolveAll(s);
    const opts = moves(s);
    console.log(`duress collapsed options=${opts.length}`);
    expect(opts.length).toBe(2);
    expect(opts.every((m) => m.type === 'choose')).toBe(true);
    const push = id1(s, 'Fatal Push', 'hand', 1);
    answer(s, { ids: [push] });
    expect(ids(s, 'Fatal Push', 'graveyard', 1).length).toBe(1);
    expect(s.zones.hand[1].length).toBe(2);
  });

  it('targets only the opponent (CR 115.1 (target opponent))', () => {
    const s = setup(['Mountain']);
    const casts = moves(s).filter((m) => m.type === 'cast' && s.objects[m.objId]?.defId === 'duress');
    expect(casts.length).toBeGreaterThan(0);
    for (const m of casts) if (m.type === 'cast') expect(m.targets).toEqual([P(1)]);
  });
});
