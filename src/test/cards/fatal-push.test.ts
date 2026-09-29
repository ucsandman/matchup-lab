// Fatal Push scenarios (docs/CARD-ANALYSIS.json). Player 0 is A (the caster), player 1 is B.
import { describe, expect, it } from 'vitest';
import { given, id1, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face } from '../../cards/dsl.js';
import { TOKEN_IDS } from '../../cards/index.js';
import { act, castMove, O, pass } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
/** Stands in for Screaming Nemesis: a mana value 3 creature. */
const Three = registerTestDef(card('Test FP Three', [face({ name: 'Test FP Three', types: ['Creature'], cost: '{2}{R}', pt: [3, 3] })]));
const TREASURE = TOKEN_IDS.Treasure as string;
const GOBLIN = TOKEN_IDS.Goblin as string;

function resolveAll(s: GameState): void {
  while (s.zones.stack.length > 0 && !s.pendingChoice && !s.result) pass(s);
}

describe('Fatal Push', () => {
  it('scenario 1: no revolt, target has mana value 3: Push resolves and does nothing', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: ['Swamp', 'Mountain', { card: Three.id, controller: 1 }],
      hands: [['Fatal Push', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const three = id1(s, Three.id);
    act(s, castMove(s, 'Fatal Push', [O(three)]));
    resolveAll(s);
    expect(s.objects[three]?.zone).toBe('battlefield');
    expect(s.zones.graveyard[0].map((id) => s.objects[id]?.defId)).toEqual(['fatal-push']);
    expect(s.turnFlags.permanentLeft[0]).toBe(false);
  });

  it('scenario 2: a Treasure sacrificed for mana while casting turns on revolt: Sunspine Lynx (mana value 4) is destroyed', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: [{ card: TREASURE, token: true }, 'Mountain', { card: 'Sunspine Lynx', controller: 1 }],
      hands: [['Fatal Push', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const lynx = id1(s, 'Sunspine Lynx');
    // The only black source is the Treasure, so paying {B} sacrifices it before resolution.
    act(s, castMove(s, 'Fatal Push', [O(lynx)]));
    expect(s.turnFlags.permanentLeft[0]).toBe(true);
    resolveAll(s);
    expect(s.objects[lynx]).toBeUndefined();
    expect(s.zones.graveyard[1].map((id) => s.objects[id]?.defId)).toEqual(['sunspine-lynx']);
  });

  it('scenario 3: a token (mana value 0, CR 202.3 (mana value)) of B is destroyed; A\'s revolt stays off because it was B\'s permanent', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: ['Swamp', 'Mountain', { card: GOBLIN, token: true, controller: 1 }],
      hands: [['Fatal Push', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const gob = id1(s, GOBLIN);
    act(s, castMove(s, 'Fatal Push', [O(gob)]));
    resolveAll(s);
    expect(s.objects[gob]).toBeUndefined();
    expect(s.turnFlags.permanentLeft[0]).toBe(false);
    expect(s.turnFlags.permanentLeft[1]).toBe(true);
  });

  it('revolt read on resolution: a 4-drop survives without revolt (CR 608.2h (information determined on resolution))', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: ['Swamp', 'Mountain', { card: 'Sunspine Lynx', controller: 1 }],
      hands: [['Fatal Push', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const lynx = id1(s, 'Sunspine Lynx');
    act(s, castMove(s, 'Fatal Push', [O(lynx)]));
    resolveAll(s);
    expect(s.objects[lynx]?.zone).toBe('battlefield');
  });
});
