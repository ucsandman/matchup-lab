// Monastery Swiftspear scenarios (docs/CARD-ANALYSIS.json). Player 0 is B (mono-red), player 1 is A.
import { describe, expect, it } from 'vitest';
import { given, id1, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, spell, t } from '../../cards/dsl.js';
import { characteristics } from '../../engine/statics.js';
import { act, castMove, moves, O, P, pass, who } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);

/** Stands in for Kumano Faces Kakkazan: a noncreature permanent spell for {R}. */
const Omen = registerTestDef(card('Test Sw Omen', [face({ name: 'Test Sw Omen', types: ['Enchantment'], cost: '{R}' })]));
/** Stands in for Monstrous Rage: target creature you control gets +2/+0 until end of turn. */
const Rage = registerTestDef(card('Test Sw Rage', [face({
  name: 'Test Sw Rage', types: ['Instant'], cost: '{R}',
  abilities: [spell({ target: t.creature({ controller: 'you' }), resolve: (ctx, [tg]) => { if (tg?.kind === 'obj') ctx.addEotDelta(tg.id, 2, 0); } })],
})]));
/** Stands in for Fatal Push: destroy target creature. */
const Push = registerTestDef(card('Test Sw Push', [face({
  name: 'Test Sw Push', types: ['Instant'], cost: '{B}',
  abilities: [spell({ target: t.creature(), resolve: (ctx, [tg]) => { if (tg?.kind === 'obj') ctx.destroy(tg.id); } })],
})]));

const SWIFT = 'Monastery Swiftspear';
const pt = (s: GameState, id: number): [number, number] => { const c = characteristics(s, id); return [c.power, c.toughness]; };
function toAttack(s: GameState): void {
  while (s.pendingChoice?.kind !== 'declareAttackers') act(s, { type: 'pass' });
}

describe('Monastery Swiftspear', () => {
  it('def matches oracle: {R} 1/2 Human Monk, haste and prowess', () => {
    const s = given({ battlefield: [SWIFT] });
    const c = characteristics(s, id1(s, SWIFT));
    expect([c.power, c.toughness, c.manaValue]).toEqual([1, 2, 1]);
    expect(c.subtypes).toEqual(['Human', 'Monk']);
  });

  it('scenario 1a: turn 1 Mountain, Swiftspear, attack: haste lets it hit for 1 (CR 702.10 (haste))', () => {
    const s = given({ turn: 1, step: 'main1', hands: [['Mountain', SWIFT], []], libraries: [lib(5), lib(5)] });
    const land = moves(s).find((m) => m.type === 'playLand');
    if (!land) throw new Error('no land move');
    act(s, land);
    act(s, castMove(s, SWIFT));
    const sw = id1(s, SWIFT);
    toAttack(s);
    act(s, { type: 'declareAttackers', assignments: [[sw, P(1) as { kind: 'player'; p: 1 }]] });
    expect(s.players[1].life).toBe(19);
  });

  it('scenario 1b: a noncreature spell precombat makes it 2/3; it attacks for 2; cleanup returns it to 1/2 (CR 514.2 (end of turn effects))', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: [SWIFT, 'Mountain'], hands: [[Omen.id], []], libraries: [lib(5), lib(5)],
    });
    const sw = id1(s, SWIFT);
    act(s, castMove(s, Omen.name));
    // CR 603.2 (cast triggers): the prowess trigger resolved before the spell; both are done now.
    expect(s.zones.stack.length).toBe(0);
    expect(pt(s, sw)).toEqual([2, 3]);
    toAttack(s);
    act(s, { type: 'declareAttackers', assignments: [[sw, { kind: 'player', p: 1 }]] });
    expect(s.players[1].life).toBe(18);
    while (s.turn === 3 && s.result === null) pass(s);
    expect(pt(s, sw)).toEqual([1, 2]);
  });

  it('scenario 2: pump on Swiftspear, A kills it in response: prowess resolves with no object and the pump fizzles (CR 608.2b (illegal targets))', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: [SWIFT, 'Mountain', 'Mountain', { card: 'Swamp', controller: 1 }],
      hands: [[Rage.id, TestBolt.id], [Push.id]], libraries: [lib(5), lib(5)],
    });
    const sw = id1(s, SWIFT);
    act(s, castMove(s, Rage.name, [O(sw)]));
    // Stack: Rage, then the prowess trigger on top of it.
    expect(s.zones.stack.map((x) => x.abilityKey ?? x.defId)).toEqual([Rage.id, 'builtin:prowess']);
    pass(s); // B passes with the trigger on the stack
    expect(who(s)).toBe(1);
    act(s, castMove(s, Push.name, [O(sw)]));
    pass(s); // B lets Push resolve
    expect(s.objects[sw]).toBeUndefined();
    expect(s.zones.graveyard[0].map((id) => s.objects[id]?.defId)).toContain('monastery-swiftspear');
    // The prowess trigger resolves doing nothing; Rage has no legal target and is removed.
    while (s.zones.stack.length > 0) pass(s);
    expect(s.zones.graveyard[0].map((id) => s.objects[id]?.defId)).toContain(Rage.id);
    expect(s.result).toBeNull();
  });

  it('scenario 3: two noncreature spells in one turn give two separate +1/+1 deltas: 3/4 (CR 702.108a (prowess triggers per noncreature spell))', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: [SWIFT, 'Mountain', 'Mountain'],
      hands: [[TestBolt.id, TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const sw = id1(s, SWIFT);
    act(s, castMove(s, TestBolt.name, [P(1)]));
    act(s, castMove(s, TestBolt.name, [P(1)]));
    expect(s.players[1].life).toBe(14);
    expect(pt(s, sw)).toEqual([3, 4]);
    expect(s.effects.filter((e) => e.kind === 'ptDelta' && e.target === sw).length).toBe(2);
  });

  it('a creature spell does not trigger prowess (CR 702.108a (noncreature spell))', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: [SWIFT, 'Mountain', 'Mountain'],
      hands: [['Monastery Swiftspear'], []], libraries: [lib(5), lib(5)],
    });
    const sw = id1(s, SWIFT);
    act(s, castMove(s, SWIFT));
    expect(pt(s, sw)).toEqual([1, 2]);
  });
});
