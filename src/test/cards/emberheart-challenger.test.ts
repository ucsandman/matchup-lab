// Emberheart Challenger scenarios (docs/CARD-ANALYSIS.json). Player 0 is B (mono-red), player 1 is A.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { act as ability, card, face, spell, t } from '../../cards/dsl.js';
import { characteristics } from '../../engine/statics.js';
import { act, answer, castMove, moves, O, pass, who } from '../scenario.js';
import type { GameState, Move } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const EMBER = 'Emberheart Challenger';
const VALIANT = 'emberheart-challenger:0:0';

/** Stands in for Monstrous Rage: target creature you control gets +2/+0 until end of turn. */
const Rage = registerTestDef(card('Test Eh Rage', [face({
  name: 'Test Eh Rage', types: ['Instant'], cost: '{R}',
  abilities: [spell({ target: t.creature({ controller: 'you' }), resolve: (ctx, [tg]) => { if (tg?.kind === 'obj') ctx.addEotDelta(tg.id, 2, 0); } })],
})]));
/** Stands in for Rockface Village's pump: an activated ability that targets. */
const Rock = registerTestDef(card('Test Eh Rock', [face({
  name: 'Test Eh Rock', types: ['Artifact'], cost: '{1}',
  abilities: [ability({ cost: { tap: true }, target: t.creature({ controller: 'you' }), resolve: (ctx, [tg]) => { if (tg?.kind === 'obj') ctx.addEotDelta(tg.id, 1, 0); } })],
})]));

const pt = (s: GameState, id: number): [number, number] => { const c = characteristics(s, id); return [c.power, c.toughness]; };
const valiantOnStack = (s: GameState): number => s.zones.stack.filter((x) => x.abilityKey === VALIANT).length;
const prowessOnStack = (s: GameState): number => s.zones.stack.filter((x) => x.abilityKey === 'builtin:prowess').length;
/** Answers trigger-order questions with the first option. */
function settleOrder(s: GameState): void {
  while (s.pendingChoice?.kind === 'pickIndex' && s.pendingChoice.reason === 'orderTriggers') answer(s, { index: 0 });
}

describe('Emberheart Challenger', () => {
  it('def matches oracle: {1}{R} 2/2 Mouse Warrior, haste, prowess, valiant', () => {
    const s = given({ battlefield: [EMBER] });
    const c = characteristics(s, id1(s, EMBER));
    expect([c.power, c.toughness, c.manaValue]).toEqual([2, 2, 2]);
    expect(c.subtypes).toEqual(['Mouse', 'Warrior']);
  });

  it('scenario 1: cast with haste and attack the same turn: A takes 2 (CR 702.10 (haste))', () => {
    const s = given({ turn: 3, step: 'main1', battlefield: ['Mountain', 'Mountain'], hands: [[EMBER], []], libraries: [lib(5), lib(5)] });
    act(s, castMove(s, EMBER));
    const e = id1(s, EMBER);
    while (s.pendingChoice?.kind !== 'declareAttackers') act(s, { type: 'pass' });
    act(s, { type: 'declareAttackers', assignments: [[e, { kind: 'player', p: 1 }]] });
    expect(s.players[1].life).toBe(18);
  });

  it('scenario 2: a pump on it triggers prowess and valiant; the exiled Mountain can be played as the land drop (CR 305.2 (one land per turn))', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: [EMBER, 'Mountain', 'Mountain'],
      hands: [[Rage.id, TestBolt.id], []], libraries: [['Mountain', ...lib(5)], lib(5)],
    });
    const e = id1(s, EMBER);
    act(s, castMove(s, Rage.name, [O(e)]));
    settleOrder(s);
    expect(valiantOnStack(s)).toBe(1);
    expect(prowessOnStack(s)).toBe(1);
    while (s.zones.stack.length > 0) pass(s);
    // Rage +2/+0 and prowess +1/+1 on a 2/2.
    expect(pt(s, e)).toEqual([5, 3]);
    const exiled = ids(s, 'Mountain', 'exile', 0);
    expect(exiled.length).toBe(1);
    expect(s.objects[exiled[0]!]!.knownTo).toEqual([true, true]); // face up: public
    const play = moves(s).find((m): m is Extract<Move, { type: 'playLand' }> => m.type === 'playLand' && m.objId === exiled[0]);
    if (!play) throw new Error('no playLand move for the exiled Mountain');
    act(s, play);
    expect(ids(s, 'Mountain', 'battlefield', 0).length).toBe(3);
    expect(s.turnFlags.landsPlayed[0]).toBe(1);
  });

  it('scenario 2b: with the land drop already used, the exiled Mountain is not playable (CR 305.2 (one land per turn))', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: [EMBER, 'Mountain', 'Mountain'],
      hands: [[Rage.id, TestBolt.id], []], libraries: [['Mountain', ...lib(5)], lib(5)],
    });
    s.turnFlags.landsPlayed[0] = 1;
    const e = id1(s, EMBER);
    act(s, castMove(s, Rage.name, [O(e)]));
    settleOrder(s);
    while (s.zones.stack.length > 0) pass(s);
    const [ex] = ids(s, 'Mountain', 'exile', 0);
    expect(ex).toBeDefined();
    expect(moves(s).some((m) => m.type === 'playLand' && m.objId === ex)).toBe(false);
  });

  it('scenario 3: a second targeting the same turn triggers prowess again but not valiant; the unplayed card stays in exile, unplayable after cleanup (CR 514.2 (end of turn effects))', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: [EMBER, 'Mountain', 'Mountain', 'Mountain'],
      hands: [[Rage.id, Rage.id, TestBolt.id], [TestBolt.id]],
      libraries: [[TestBolt.id, ...lib(5)], lib(5)],
    });
    const e = id1(s, EMBER);
    act(s, castMove(s, Rage.name, [O(e)]));
    settleOrder(s);
    while (s.zones.stack.length > 0) pass(s);
    const exiled = ids(s, TestBolt.id, 'exile', 0);
    expect(exiled.length).toBe(1);
    act(s, castMove(s, Rage.name, [O(e)]));
    settleOrder(s);
    expect(valiantOnStack(s)).toBe(0);
    expect(prowessOnStack(s)).toBe(1);
    while (s.zones.stack.length > 0) pass(s);
    expect(pt(s, e)).toEqual([8, 4]);
    expect(ids(s, TestBolt.id, 'exile', 0).length).toBe(1);
    // The exiled Bolt is castable now (one Mountain left).
    expect(moves(s).some((m) => m.type === 'cast' && m.objId === exiled[0])).toBe(true);
    while (s.turn === 3 && s.result === null) pass(s);
    expect(ids(s, TestBolt.id, 'exile', 0)).toEqual(exiled);
    expect(s.effects.some((x) => x.kind === 'playFromExile')).toBe(false);
  });

  it('valiant counts the event, not the resolution: a second targeting while the first trigger is still on the stack does not trigger (CR 207.2c (ability word))', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: [EMBER, 'Mountain', 'Mountain', 'Mountain'],
      hands: [[Rage.id, Rage.id, TestBolt.id], []], libraries: [lib(6), lib(5)],
    });
    const e = id1(s, EMBER);
    act(s, castMove(s, Rage.name, [O(e)]));
    settleOrder(s);
    expect(who(s)).toBe(0);
    expect(valiantOnStack(s)).toBe(1);
    act(s, castMove(s, Rage.name, [O(e)]));
    settleOrder(s);
    expect(valiantOnStack(s)).toBe(1);
    expect(prowessOnStack(s)).toBe(2);
    while (s.zones.stack.length > 0) pass(s);
    expect(s.zones.exile[0].length).toBe(1);
  });

  it('valiant triggers on an ability you control too, and not on an opponent\'s spell', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: [EMBER, Rock.id, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(6), lib(5)],
    });
    const rockMove = moves(s).find((m) => m.type === 'activate' && m.objId === id1(s, Rock.id));
    if (!rockMove) throw new Error('no Rock activation');
    act(s, rockMove);
    expect(valiantOnStack(s)).toBe(1);
    while (s.zones.stack.length > 0) pass(s);
    expect(s.zones.exile[0].length).toBe(1);

    // The opponent's spell targeting it: no valiant (the spell or ability must be one you control).
    const s2 = given({
      turn: 4, step: 'main1', active: 1, battlefield: [EMBER, { card: 'Mountain', controller: 1 }, 'Mountain'],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(6), lib(5)],
    });
    const e2 = id1(s2, EMBER);
    act(s2, castMove(s2, TestBolt.name, [O(e2)]));
    expect(valiantOnStack(s2)).toBe(0);
    expect(s2.zones.exile[0].length).toBe(0);
  });
});
