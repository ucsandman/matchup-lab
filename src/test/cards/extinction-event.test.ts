// Extinction Event scenarios (docs/CARD-ANALYSIS.json). Player 0 is A (the caster), player 1 is B.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face } from '../../cards/dsl.js';
import { TOKEN_IDS } from '../../cards/index.js';
import { act, answer, castMove, pass } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
/** Stands in for Screaming Nemesis: mana value 3. */
const Three = registerTestDef(card('Test EE Three', [face({ name: 'Test EE Three', types: ['Creature'], cost: '{2}{R}', pt: [3, 3] })]));
const ODD = 0;
const EVEN = 1;
const GOBLIN = TOKEN_IDS.Goblin as string;

function resolveAll(s: GameState): void {
  while (s.zones.stack.length > 0 && !s.pendingChoice && !s.result) pass(s);
}
const lands = ['Swamp', 'Swamp', 'Swamp', 'Swamp', 'Mountain'];

describe('Extinction Event', () => {
  it('scenario 1: odd exiles Swiftspear (1) and a 3-drop; Emberheart (2) and Sheoldred (4) remain', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: [...lands, 'Sheoldred, the Apocalypse',
        { card: 'Monastery Swiftspear', controller: 1 }, { card: Three.id, controller: 1 }, { card: 'Emberheart Challenger', controller: 1 }],
      hands: [['Extinction Event', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Extinction Event'));
    resolveAll(s);
    expect(s.pendingChoice).toMatchObject({ kind: 'pickIndex', player: 0, reason: 'oddOrEven', count: 2 });
    answer(s, { index: ODD });
    expect(s.zones.exile[1].map((id) => s.objects[id]?.defId).sort()).toEqual(['monastery-swiftspear', Three.id].sort());
    expect(ids(s, 'Emberheart Challenger').length).toBe(1);
    expect(ids(s, 'Sheoldred, the Apocalypse').length).toBe(1);
    expect(s.zones.graveyard[1].length).toBe(0);
  });

  it('scenario 2: even exiles a token (mana value 0) and Sunspine Lynx (4) (CR 202.3 (mana value))', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: [...lands, { card: GOBLIN, token: true, controller: 1 }, { card: 'Sunspine Lynx', controller: 1 }, { card: 'Monastery Swiftspear', controller: 1 }],
      hands: [['Extinction Event', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Extinction Event'));
    resolveAll(s);
    answer(s, { index: EVEN });
    expect(ids(s, GOBLIN).length).toBe(0);
    expect(s.zones.exile[1].map((id) => s.objects[id]?.defId)).toEqual(['sunspine-lynx']);
    expect(ids(s, 'Monastery Swiftspear').length).toBe(1);
  });

  it('scenario 3: exile is not dying: Kalitas makes no Zombie (CR 700.4 (dies))', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: [...lands, 'Kalitas, Traitor of Ghet', { card: 'Monastery Swiftspear', controller: 1 }],
      hands: [['Extinction Event', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Extinction Event'));
    resolveAll(s);
    answer(s, { index: ODD });
    expect(s.zones.exile[1].map((id) => s.objects[id]?.defId)).toEqual(['monastery-swiftspear']);
    expect(ids(s, TOKEN_IDS.Zombie as string).length).toBe(0);
    expect(id1(s, 'Kalitas, Traitor of Ghet')).toBeGreaterThan(0);
  });
});
