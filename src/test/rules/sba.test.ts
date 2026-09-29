// State-based actions: one test per 704.5 case the pool needs, plus Role uniqueness and the
// simultaneous-loss draw.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, saga } from '../../cards/dsl.js';
import { checkSBA } from '../../engine/sba.js';
import { createToken } from '../../engine/zones.js';
import { addEffect, allocId, invalidateMemo } from '../../engine/mutate.js';
import { runWithChoices } from '../../engine/ctx.js';
import { act, advance, answer, castMove, O, pass } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const TestLegendA = registerTestDef(card('Test Sba Legend', [face({
  name: 'Test Sba Legend', types: ['Creature'], supertypes: ['Legendary'], cost: '{1}{B}', pt: [2, 2],
})]));
const TestWalker = registerTestDef(card('Test Sba Walker', [face({ name: 'Test Sba Walker', types: ['Planeswalker'], cost: '{2}{B}', loyalty: 3 })]));
const TestSaga = registerTestDef(card('Test Sba Saga', [face({
  name: 'Test Sba Saga', types: ['Enchantment'], subtypes: ['Saga'], cost: '{1}{R}',
  abilities: saga([() => {}, () => {}, (ctx) => { ctx.loseLife(ctx.opponent, 3); }]),
})]));
const TestTough = registerTestDef(card('Test Sba Tough', [face({ name: 'Test Sba Tough', types: ['Creature'], cost: '{2}', pt: [2, 4] })]));

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const sba = (s: GameState): boolean => {
  const r = runWithChoices(s, [], (pick) => checkSBA(s, pick));
  if (!r.done) throw new Error(`choice ${r.choice.kind}`);
  return r.value;
};

describe('state-based actions', () => {
  it('CR 704.5a (0 or less life): that player loses', () => {
    const s = given({ life: [0, 5] });
    expect(sba(s)).toBe(true);
    expect(s.result).toEqual({ winner: 1, reason: 'life' });
  });

  it('CR 704.5b (draw from empty library): that player loses', () => {
    const s = given();
    s.players[1].drewFromEmpty = true;
    sba(s);
    expect(s.result?.winner).toBe(0);
  });

  it('CR 104.4a (lose simultaneously): both at 0 life is a draw', () => {
    const s = given({ life: [0, -2] });
    sba(s);
    expect(s.result?.winner).toBe('draw');
  });

  it('CR 704.5f (toughness 0 or less) and CR 704.5g (lethal damage)', () => {
    const s = given({ battlefield: [TestBear.id, { card: TestTough.id, damage: 4 }, { card: TestTough.id, damage: 3 }] });
    const bear = id1(s, TestBear.id);
    addEffect(s, { eid: allocId(s), kind: 'ptDelta', target: bear, p: -2, t: -2, until: 'eot' });
    expect(sba(s)).toBe(true);
    expect(ids(s, TestBear.id, 'graveyard').length).toBe(1);
    expect(ids(s, TestTough.id, 'graveyard').length).toBe(1);
    expect(ids(s, TestTough.id).length).toBe(1);
    expect(sba(s)).toBe(false);
  });

  it('CR 704.5h (deathtouch): any damage from a deathtouch source destroys', () => {
    const s = given({ battlefield: [{ card: TestTough.id, damage: 1 }] });
    const t = id1(s, TestTough.id);
    s.objects[t]!.deathtouched = true;
    invalidateMemo(s);
    sba(s);
    expect(ids(s, TestTough.id, 'graveyard').length).toBe(1);
  });

  it('CR 704.5i (planeswalker loyalty 0)', () => {
    const s = given({ battlefield: [{ card: TestWalker.id, counters: { loyalty: 1 } }, { card: TestWalker.id, counters: { loyalty: 3 } }] });
    const [a] = ids(s, TestWalker.id);
    s.objects[a!]!.counters = {};
    invalidateMemo(s);
    sba(s);
    expect(ids(s, TestWalker.id, 'graveyard').length).toBe(1);
  });

  it('CR 704.5j (legend rule): identical copies need no choice; different ones ask the controller', () => {
    const s = given({ battlefield: [TestLegendA.id, TestLegendA.id] });
    sba(s);
    expect(ids(s, TestLegendA.id).length).toBe(1);
    expect(ids(s, TestLegendA.id, 'graveyard').length).toBe(1);
    // A tapped and an untapped copy differ: the engine stops for the controller's pickObjects Choice.
    const s2 = given({ turn: 1, step: 'main1', battlefield: [TestLegendA.id, { card: TestLegendA.id, tapped: true }], libraries: [lib(5), lib(5)] });
    const keep = ids(s2, TestLegendA.id).find((id) => s2.objects[id]!.tapped)!;
    advance(s2);
    expect(s2.pendingChoice).toMatchObject({ kind: 'pickObjects', player: 0, reason: 'legendRule' });
    answer(s2, { ids: [keep] });
    expect(ids(s2, TestLegendA.id)).toEqual([keep]);
  });

  it('CR 704.5m (Aura attached illegally): a Role on a noncreature goes to the graveyard', () => {
    const s = given({ battlefield: ['Mountain', TestBear.id] });
    const role1 = createToken(s, 'MonsterRole', 0, { attachedTo: id1(s, 'Mountain') });
    const role2 = createToken(s, 'MonsterRole', 0, { attachedTo: id1(s, TestBear.id) });
    sba(s);
    expect(s.objects[role1]).toBeUndefined();
    expect(s.objects[role2]).toBeDefined();
  });

  it('CR 303.7a (Role): two Roles from one player on one creature: the older goes', () => {
    const s = given({ battlefield: [TestBear.id] });
    const bear = id1(s, TestBear.id);
    const older = createToken(s, 'MonsterRole', 0, { attachedTo: bear });
    const newer = createToken(s, 'MonsterRole', 0, { attachedTo: bear });
    const other = createToken(s, 'MonsterRole', 1, { attachedTo: bear });
    sba(s);
    expect(s.objects[older]).toBeUndefined();
    expect(s.objects[newer]).toBeDefined();
    expect(s.objects[other]).toBeDefined();
  });

  it('CR 704.5q (counters annihilate): +1/+1 and -1/-1 counters cancel', () => {
    const s = given({ battlefield: [{ card: TestTough.id, counters: { p1p1: 2, m1m1: 3 } }] });
    const t = id1(s, TestTough.id);
    sba(s);
    expect(s.objects[t]!.counters).toEqual({ m1m1: 1 });
  });

  it('CR 704.5s (saga sacrifice): after the final chapter leaves the stack, not before', () => {
    const s = given({
      turn: 1, step: 'upkeep', active: 0,
      battlefield: [{ card: TestSaga.id, counters: { lore: 2 } }, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const saga = id1(s, TestSaga.id);
    pass(s, 4); // upkeep and draw
    // Precombat main: lore 3, chapter III triggers and waits on the stack; the saga stays meanwhile.
    expect(s.step).toBe('main1');
    expect(s.zones.stack.length).toBe(1);
    expect(s.objects[saga]!.counters.lore).toBe(3);
    pass(s, 2);
    expect(s.players[1].life).toBe(17);
    expect(s.objects[saga]).toBeUndefined();
    expect(ids(s, TestSaga.id, 'graveyard').length).toBe(1);
  });

  it('an SBA death through the engine: lethal Bolt kills during advance', () => {
    const s = given({
      turn: 1, step: 'main1', battlefield: ['Mountain', { card: TestBear.id, controller: 1 }],
      hands: [[TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const bear = id1(s, TestBear.id);
    act(s, castMove(s, TestBolt.name, [O(bear)]));
    expect(ids(s, TestBear.id, 'graveyard', 1).length).toBe(1);
  });
});

