// Go for the Throat scenarios (docs/CARD-ANALYSIS.json). Player 0 is A (the caster), player 1 is B.
import { describe, expect, it } from 'vitest';
import { given, id1, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, spell, t } from '../../cards/dsl.js';
import { act, castMove, moves, O, pass, who } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
/** Stands in for a crewed Reckoner Bankbuster: an artifact creature. */
const Golem = registerTestDef(card('Test GftT Golem', [face({ name: 'Test GftT Golem', types: ['Artifact', 'Creature'], cost: '{2}', pt: [4, 4] })]));
/** Stands in for Monstrous Rage: target creature gets +2/+2 until end of turn. */
const Pump = registerTestDef(card('Test GftT Pump', [face({
  name: 'Test GftT Pump', types: ['Instant'], cost: '{R}',
  abilities: [spell({ target: t.creature(), resolve: (ctx, [tg]) => { if (tg?.kind === 'obj') ctx.addEotDelta(tg.id, 2, 2); } })],
})]));

function resolveAll(s: GameState): void {
  while (s.zones.stack.length > 0 && !s.pendingChoice && !s.result) pass(s);
}

describe('Go for the Throat', () => {
  it('scenario 1: destroys a nonartifact creature of B', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: ['Swamp', 'Swamp', 'Mountain', { card: 'Emberheart Challenger', controller: 1 }],
      hands: [['Go for the Throat', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const eh = id1(s, 'Emberheart Challenger');
    act(s, castMove(s, 'Go for the Throat', [O(eh)]));
    resolveAll(s);
    expect(s.objects[eh]).toBeUndefined();
    expect(s.zones.graveyard[1].map((id) => s.objects[id]?.defId)).toEqual(['emberheart-challenger']);
  });

  it('scenario 2: B pumps its creature in response: destroy ignores toughness', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: ['Swamp', 'Swamp', { card: 'Monastery Swiftspear', controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [['Go for the Throat'], [Pump.id]], libraries: [lib(5), lib(5)],
    });
    const sw = id1(s, 'Monastery Swiftspear');
    act(s, castMove(s, 'Go for the Throat', [O(sw)]));
    expect(who(s)).toBe(1);
    act(s, castMove(s, Pump.name, [O(sw)]));
    resolveAll(s);
    expect(s.objects[sw]).toBeUndefined();
    expect(s.zones.graveyard[1].map((id) => s.objects[id]?.defId).sort()).toEqual(['monastery-swiftspear', Pump.id].sort());
  });

  it('scenario 3: an artifact creature is not a legal target; the generator never offers it', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: ['Swamp', 'Swamp', { card: Golem.id, controller: 0 }, { card: Golem.id, controller: 1 }, { card: TestBear.id, controller: 1 }],
      hands: [['Go for the Throat'], []], libraries: [lib(5), lib(5)],
    });
    const casts = moves(s).filter((m) => m.type === 'cast');
    const targeted = casts.flatMap((m) => (m.type === 'cast' ? m.targets : [])).map((tg) => (tg.kind === 'obj' ? s.objects[tg.id]?.defId : 'player'));
    console.log(`go for the throat cast moves=${casts.length}`);
    expect(casts.length).toBeGreaterThan(0);
    expect(targeted).not.toContain(Golem.id);
    expect(targeted).toContain(TestBear.id);
  });
});
