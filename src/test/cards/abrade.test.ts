// Abrade scenarios (docs/CARD-ANALYSIS.json). Player 0 is A (the caster), player 1 is B.
import { describe, expect, it } from 'vitest';
import { given, id1, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, spell, t } from '../../cards/dsl.js';
import { TOKEN_IDS } from '../../cards/index.js';
import { act, castMove, moves, O, pass, who } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
/** Stands in for Monstrous Rage: target creature you control gets +2/+0 until end of turn. */
const Rage = registerTestDef(card('Test Ab Rage', [face({
  name: 'Test Ab Rage', types: ['Instant'], cost: '{R}',
  abilities: [spell({ target: t.creature({ controller: 'you' }), resolve: (ctx, [tg]) => { if (tg?.kind === 'obj') ctx.addEotDelta(tg.id, 2, 0); } })],
})]));

function resolveAll(s: GameState): void {
  while (s.zones.stack.length > 0 && !s.pendingChoice && !s.result) pass(s);
}
const cardCount = (s: GameState, p: 0 | 1): number => Object.values(s.objects).filter((o) => o.owner === p && o.token === undefined).length;

describe('Abrade', () => {
  it('scenario 1: mode 1 deals 3 to Emberheart Challenger: it dies (CR 704.5g (lethal damage)); card count conserved', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: ['Mountain', 'Mountain', 'Mountain', { card: 'Emberheart Challenger', controller: 1 }],
      hands: [['Abrade', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const before: [number, number] = [cardCount(s, 0), cardCount(s, 1)];
    const eh = id1(s, 'Emberheart Challenger');
    act(s, castMove(s, 'Abrade', [O(eh)], (m) => (m.mode ?? 0) === 0));
    resolveAll(s);
    expect(s.zones.graveyard[1].map((id) => s.objects[id]?.defId)).toEqual(['emberheart-challenger']);
    expect(s.zones.graveyard[0].map((id) => s.objects[id]?.defId)).toEqual(['abrade']);
    expect([cardCount(s, 0), cardCount(s, 1)]).toEqual(before);
  });

  it('scenario 2: B pumps Swiftspear (prowess on the stack); A Abrades it in response: the pump fizzles (CR 608.2b (illegal targets))', () => {
    const s = given({
      turn: 3, step: 'main1', active: 1,
      battlefield: [{ card: 'Monastery Swiftspear', controller: 1 }, { card: 'Mountain', controller: 1 }, 'Mountain', 'Mountain'],
      hands: [[ 'Abrade'], [Rage.id]], libraries: [lib(5), lib(5)],
    });
    const sw = id1(s, 'Monastery Swiftspear');
    act(s, castMove(s, Rage.name, [O(sw)]));
    expect(who(s)).toBe(0);
    act(s, castMove(s, 'Abrade', [O(sw)], (m) => (m.mode ?? 0) === 0));
    resolveAll(s);
    expect(s.objects[sw]).toBeUndefined();
    expect(s.zones.graveyard[1].map((id) => s.objects[id]?.defId).sort()).toEqual(['monastery-swiftspear', Rage.id].sort());
    expect(s.zones.stack.length).toBe(0);
  });

  it('mode 2 destroys an artifact (a Treasure token, CR 111.10 (predefined tokens)); with no artifact, mode 2 is not offered (CR 700.2 (modal spells))', () => {
    const treasure = TOKEN_IDS.Treasure as string;
    const s = given({
      turn: 3, step: 'main1', battlefield: ['Mountain', 'Mountain', 'Mountain', { card: treasure, token: true, controller: 1 }],
      hands: [['Abrade', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const tr = id1(s, treasure);
    act(s, castMove(s, 'Abrade', [O(tr)], (m) => m.mode === 1));
    resolveAll(s);
    expect(s.objects[tr]).toBeUndefined();

    const s2 = given({
      turn: 3, step: 'main1', battlefield: ['Mountain', 'Mountain', { card: TestBear.id, controller: 1 }],
      hands: [['Abrade'], []], libraries: [lib(5), lib(5)],
    });
    const modes = moves(s2).flatMap((m) => (m.type === 'cast' ? [m.mode ?? 0] : []));
    console.log(`abrade cast moves without artifacts=${modes.length}`);
    expect(modes.length).toBeGreaterThan(0);
    expect(modes.every((x) => x === 0)).toBe(true);
  });
});
