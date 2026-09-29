// Bitter Triumph scenarios (docs/CARD-ANALYSIS.json). Player 0 is A (the caster), player 1 is B.
import { describe, expect, it } from 'vitest';
import { given, id1, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face } from '../../cards/dsl.js';
import { act, castMove, moves, O, pass, who } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
/** Stands in for Screaming Nemesis: a 3/3 creature. */
const Three = registerTestDef(card('Test BT Three', [face({ name: 'Test BT Three', types: ['Creature'], cost: '{2}{R}', pt: [3, 3] })]));

function resolveAll(s: GameState): void {
  while (s.zones.stack.length > 0 && !s.pendingChoice && !s.result) pass(s);
}
const LIFE = 1; // index of the pay-3-life option in additionalChoice
const DISCARD = 0;

describe('Bitter Triumph', () => {
  it('scenario 1: A at 3 pays 3 life and destroys the creature; A is at 0 and loses (CR 119.4 (paying life to 0 is legal), CR 704.5a (0 life))', () => {
    const s = given({
      turn: 3, step: 'main1', life: [3, 20], battlefield: ['Swamp', 'Swamp', { card: Three.id, controller: 1 }],
      hands: [['Bitter Triumph'], []], libraries: [lib(5), lib(5)],
    });
    const three = id1(s, Three.id);
    act(s, castMove(s, 'Bitter Triumph', [O(three)], (m) => m.costChoice === LIFE));
    expect(s.players[0].life).toBe(0);
    resolveAll(s);
    // The spell is still put on the stack; SBAs run before anyone gets priority, so A loses at once.
    expect(s.result).toEqual({ winner: 1, reason: expect.any(String) });
  });

  it('scenario 2: A at 2 life holding Duress: only the discard variant is offered', () => {
    const s = given({
      turn: 3, step: 'main1', life: [2, 20], battlefield: ['Swamp', 'Swamp', { card: Three.id, controller: 1 }],
      hands: [['Bitter Triumph', 'Duress'], []], libraries: [lib(5), lib(5)],
    });
    const bt = moves(s).filter((m) => m.type === 'cast' && s.objects[m.objId]?.defId === 'bitter-triumph');
    console.log(`bitter triumph cast moves at 2 life=${bt.length}`);
    expect(bt.length).toBeGreaterThan(0);
    const duress = id1(s, 'Duress', 'hand', 0);
    for (const m of bt) {
      if (m.type !== 'cast') continue;
      expect(m.costChoice).toBe(DISCARD);
      expect(m.discard).toEqual([duress]);
    }
    act(s, bt[0] as (typeof bt)[number]);
    resolveAll(s);
    expect(s.objects[id1(s, Three.id, 'graveyard', 1)]?.zone).toBe('graveyard');
    expect(s.zones.graveyard[0].map((id) => s.objects[id]?.defId).sort()).toEqual(['bitter-triumph', 'duress']);
    expect(s.players[0].life).toBe(2);
  });

  it('scenario 3: the target dies in response: Triumph fizzles, the 3 life stays paid (CR 608.2b (illegal targets))', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: ['Swamp', 'Swamp', { card: 'Monastery Swiftspear', controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [['Bitter Triumph'], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const sw = id1(s, 'Monastery Swiftspear');
    act(s, castMove(s, 'Bitter Triumph', [O(sw)], (m) => m.costChoice === LIFE));
    expect(s.players[0].life).toBe(17);
    expect(who(s)).toBe(1);
    act(s, castMove(s, TestBolt.name, [O(sw)]));
    resolveAll(s);
    expect(s.players[0].life).toBe(17);
    expect(s.zones.graveyard[0].map((id) => s.objects[id]?.defId)).toEqual(['bitter-triumph']);
  });
});
