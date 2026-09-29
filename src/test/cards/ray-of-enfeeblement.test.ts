// Ray of Enfeeblement scenarios (docs/CARD-ANALYSIS.json). Player 0 is A (the caster), player 1 is B.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face } from '../../cards/dsl.js';
import { TOKEN_IDS } from '../../cards/index.js';
import { characteristics } from '../../engine/statics.js';
import { act, castMove, O, pass, who } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
/** Stands in for Screaming Nemesis: a 3/3. */
const Three = registerTestDef(card('Test Ray Three', [face({ name: 'Test Ray Three', types: ['Creature'], cost: '{2}{R}', pt: [3, 3] })]));
/** A white 5/5, for the -4/-4 branch. */
const White = registerTestDef(card('Test Ray White', [face({ name: 'Test Ray White', types: ['Creature'], cost: '{3}{W}', pt: [5, 5] })]));
const GOBLIN = TOKEN_IDS.Goblin as string;

function resolveAll(s: GameState): void {
  while (s.zones.stack.length > 0 && !s.pendingChoice && !s.result) pass(s);
}

describe('Ray of Enfeeblement', () => {
  it('scenario 1: an attacking 3/3 becomes -1/2 and deals no combat damage (CR 510.1a (0 or less power assigns no damage))', () => {
    const s = given({
      turn: 4, step: 'main1', active: 1,
      battlefield: ['Swamp', 'Mountain', { card: Three.id, controller: 1 }],
      hands: [['Ray of Enfeeblement', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const three = id1(s, Three.id);
    while (s.pendingChoice?.kind !== 'declareAttackers') act(s, { type: 'pass' });
    act(s, { type: 'declareAttackers', assignments: [[three, { kind: 'player', p: 0 }]] });
    expect(who(s)).toBe(0);
    act(s, castMove(s, 'Ray of Enfeeblement', [O(three)]));
    resolveAll(s);
    const c = characteristics(s, three);
    expect([c.power, c.toughness]).toEqual([-1, 2]);
    while (s.turn === 4 && !s.result) pass(s);
    expect(s.players[0].life).toBe(20);
  });

  it('scenario 2: a 1/1 Goblin token goes to toughness 0 and dies (CR 704.5f (toughness 0 or less))', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: ['Swamp', 'Mountain', { card: GOBLIN, token: true, controller: 1 }],
      hands: [['Ray of Enfeeblement', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Ray of Enfeeblement', [O(id1(s, GOBLIN))]));
    resolveAll(s);
    expect(ids(s, GOBLIN).length).toBe(0);
  });

  it('scenario 3: a 2/2 with 1 damage marked dies at toughness 1 (CR 704.5g (lethal damage))', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: ['Swamp', 'Mountain', { card: 'Emberheart Challenger', controller: 1, damage: 1 }],
      hands: [['Ray of Enfeeblement', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Ray of Enfeeblement', [O(id1(s, 'Emberheart Challenger'))]));
    resolveAll(s);
    expect(s.zones.graveyard[1].map((id) => s.objects[id]?.defId)).toEqual(['emberheart-challenger']);
  });

  it('a white creature gets -4/-4 instead (color checked on resolution, CR 608.2h (information determined on resolution))', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: ['Swamp', 'Mountain', { card: White.id, controller: 1 }],
      hands: [['Ray of Enfeeblement', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const w = id1(s, White.id);
    act(s, castMove(s, 'Ray of Enfeeblement', [O(w)]));
    resolveAll(s);
    const c = characteristics(s, w);
    expect([c.power, c.toughness]).toEqual([1, 1]);
  });
});
