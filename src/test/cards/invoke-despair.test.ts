// Invoke Despair scenarios (docs/CARD-ANALYSIS.json). Player 0 is A (the caster), player 1 is B.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face } from '../../cards/dsl.js';
import { TOKEN_IDS } from '../../cards/index.js';
import { invalidateMemo } from '../../engine/mutate.js';
import { act, answer, castMove, moves, P, pass } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
/** Stands in for Kumano Faces Kakkazan: a noncreature enchantment. */
const Omen = registerTestDef(card('Test ID Omen', [face({ name: 'Test ID Omen', types: ['Enchantment'], cost: '{R}' })]));
/** Stands in for Etching of Kumano: an enchantment creature. */
const Etching = registerTestDef(card('Test ID Etching', [face({ name: 'Test ID Etching', types: ['Enchantment', 'Creature'], cost: '{R}', pt: [2, 2] })]));
const ROLE = TOKEN_IDS.MonsterRole as string;
const lands = ['Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Mountain'];

function resolveAll(s: GameState): void {
  while (s.zones.stack.length > 0 && !s.pendingChoice && !s.result) pass(s);
}
function setup(bField: (string | { card: string; controller: 1; token?: boolean })[]): GameState {
  return given({
    turn: 3, step: 'main1', battlefield: [...lands, ...bField.map((x) => (typeof x === 'string' ? { card: x, controller: 1 as const } : x))],
    hands: [['Invoke Despair', TestBolt.id], []], libraries: [lib(10), lib(10)],
  });
}

describe('Invoke Despair', () => {
  it('scenario 1: B sacrifices its creature and its enchantment, loses 2 for the planeswalker step; A draws 1', () => {
    const s = setup(['Emberheart Challenger', Omen.id]);
    // A's hand size without Invoke Despair (the engine may resolve it before act returns).
    const hand0 = s.zones.hand[0].length - 1;
    act(s, castMove(s, 'Invoke Despair', [P(1)]));
    resolveAll(s);
    expect(s.pendingChoice).toBeNull();
    expect(s.zones.graveyard[1].map((id) => s.objects[id]?.defId).sort()).toEqual(['emberheart-challenger', Omen.id].sort());
    expect(s.players[1].life).toBe(18);
    expect(s.zones.hand[0].length).toBe(hand0 + 1);
  });

  it('scenario 2: B controls nothing: B loses 6, A draws 3', () => {
    const s = setup([]);
    // A's hand size without Invoke Despair (the engine may resolve it before act returns).
    const hand0 = s.zones.hand[0].length - 1;
    act(s, castMove(s, 'Invoke Despair', [P(1)]));
    resolveAll(s);
    expect(s.players[1].life).toBe(14);
    expect(s.zones.hand[0].length).toBe(hand0 + 3);
  });

  it('scenario 3: a Role stays on the battlefield after its creature is sacrificed and is the enchantment sacrificed next (CR 704.3 (no SBAs during resolution))', () => {
    const s = setup([TestBear.id, { card: ROLE, controller: 1, token: true }]);
    const bear = id1(s, TestBear.id);
    const role = id1(s, ROLE);
    const r = s.objects[role];
    if (!r) throw new Error('no role');
    r.attachedTo = bear;
    invalidateMemo(s);
    // A's hand size without Invoke Despair (the engine may resolve it before act returns).
    const hand0 = s.zones.hand[0].length - 1;
    act(s, castMove(s, 'Invoke Despair', [P(1)]));
    resolveAll(s);
    expect(ids(s, TestBear.id).length).toBe(0);
    expect(ids(s, ROLE).length).toBe(0);
    // Only the planeswalker step found nothing.
    expect(s.players[1].life).toBe(18);
    expect(s.zones.hand[0].length).toBe(hand0 + 1);
  });

  it('scenario 3 variant: an enchantment creature may be sacrificed at the creature step; B chooses', () => {
    const s = setup([TestBear.id, Etching.id]);
    // A's hand size without Invoke Despair (the engine may resolve it before act returns).
    const hand0 = s.zones.hand[0].length - 1;
    act(s, castMove(s, 'Invoke Despair', [P(1)]));
    resolveAll(s);
    if (s.pendingChoice?.kind !== 'pickObjects') throw new Error('expected the creature-step choice');
    expect(s.pendingChoice.player).toBe(1);
    expect(moves(s).length).toBe(2);
    answer(s, { ids: [id1(s, Etching.id)] });
    // Enchantment step: none left; planeswalker step: none. B loses 4, A draws 2.
    expect(ids(s, TestBear.id).length).toBe(1);
    expect(s.players[1].life).toBe(16);
    expect(s.zones.hand[0].length).toBe(hand0 + 2);
  });
});
