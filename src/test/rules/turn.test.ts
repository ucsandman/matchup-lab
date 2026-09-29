// Turn structure: the phase queue, the first-draw skip, day/night, the cleanup repeat and the
// extra-combat hook.
import { describe, expect, it } from 'vitest';
import { given, id1, registerTestDef, TestBear, TestBolt, type Given } from '../helpers.js';
import { card, face, trig } from '../../cards/dsl.js';
import { invalidateMemo } from '../../engine/mutate.js';
import { COMBAT_STEPS } from '../../engine/types.js';
import { act, answer, castMove, O, P, pass, who } from '../scenario.js';
import type { GameState, Step } from '../../engine/types.js';

const TestWall = registerTestDef(card('Test Turn Wall', [face({ name: 'Test Turn Wall', types: ['Creature'], cost: '{1}', pt: [1, 4] })]));
const TestWatcher = registerTestDef(card('Test Turn Watcher', [face({
  name: 'Test Turn Watcher', types: ['Enchantment'], cost: '{1}',
  abilities: [trig('discard', { scope: 'any' }, (ctx) => { ctx.gainLife(ctx.controller, 1); })],
})]));
const TestRally = registerTestDef(card('Test Turn Rally', [face({
  name: 'Test Turn Rally', types: ['Creature'], cost: '{1}{R}', pt: [2, 2], keywords: ['haste'],
  abilities: [trig('attacks', { interveningIf: (ctx) => (ctx.obj(ctx.source)?.attacksThisTurn ?? 0) === 1 }, (ctx) => {
    ctx.untap(ctx.source);
    ctx.addExtraCombat();
  })],
})]));
const TestWolf = registerTestDef({
  ...card('Test Turn Wolf // Test Turn Werewolf', [
    face({ name: 'Test Turn Wolf', types: ['Creature'], cost: '{1}{B}', pt: [2, 2], keywords: ['daybound'] }),
    face({ name: 'Test Turn Werewolf', types: ['Creature'], pt: [4, 4], keywords: ['nightbound'] }),
  ], 'transform'),
});

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);

/** Two players who both hold an instant and a Mountain, so every priority step is a decision. */
function busy(extra: Partial<Given> = {}): GameState {
  return given({
    turn: 1, step: 'upkeep', active: 0,
    battlefield: ['Mountain', { card: 'Mountain', controller: 1 }],
    hands: [[TestBolt.id], [TestBolt.id]],
    libraries: [lib(10), lib(10)],
    ...extra,
  });
}

describe('turn structure', () => {
  it('steps in order with priority, blockers and damage skipped with no attackers, cleanup without priority', () => {
    const s = busy();
    const seen: string[] = [];
    while (s.turn < 3) {
      seen.push(`${s.turn}:${s.step}:${who(s)}`);
      pass(s);
    }
    const t1 = seen.filter((x) => x.startsWith('1:')).map((x) => x.split(':').slice(1).join(':'));
    const order: Step[] = ['upkeep', 'draw', 'main1', 'beginCombat', 'declareAttackers', 'endCombat', 'main2', 'end'];
    // CR 508.8 (no attackers): with no creature declared, declare blockers and combat damage are skipped.
    expect(t1).toEqual(order.flatMap((st) => [`${st}:0`, `${st}:1`]));
    // Turn 2 belongs to the other player, who gets priority first (CR 117.3a (priority at beginning of steps)).
    expect(seen.find((x) => x.startsWith('2:'))).toBe('2:upkeep:1');
    expect(seen.some((x) => x.includes('untap') || x.includes('cleanup'))).toBe(false);
  });

  it('CR 103.8a (skips the draw): the starting player skips the turn 1 draw; turn 2 draws', () => {
    const s = busy();
    expect(s.zones.hand[0].length).toBe(1);
    while (s.step !== 'main1') pass(s);
    expect(s.zones.hand[0].length).toBe(1);
    while (s.turn < 2 || s.step !== 'main1') pass(s);
    expect(s.zones.hand[1].length).toBe(2);
  });

  it('CR 731.2a (day becomes night) and CR 731.2b (night becomes day); daybound transforms', () => {
    const s = busy({
      battlefield: ['Mountain', { card: 'Mountain', controller: 1 }, { card: 'Mountain', controller: 1 }, TestWolf.id],
      hands: [[TestBolt.id], [TestBolt.id, TestBolt.id]],
    });
    s.dayNight = 'day';
    invalidateMemo(s);
    const wolf = id1(s, TestWolf.id);
    while (s.turn < 2) pass(s); // player 0 casts no spell on turn 1
    expect(s.dayNight).toBe('night');
    expect(s.objects[wolf]!.face).toBe(1);
    // Turn 2: player 1 casts two spells, so turn 3 starts with day.
    while (s.step !== 'main1') pass(s);
    act(s, castMove(s, TestBolt.name, [P(0)]));
    while (who(s) !== 1) pass(s);
    act(s, castMove(s, TestBolt.name, [P(0)]));
    while (s.turn < 3) pass(s);
    expect(s.dayNight).toBe('day');
    expect(s.objects[wolf]!.face).toBe(0);
  });

  it('CR 702.145d (becomes day): a daybound permanent with neither day nor night makes it day', () => {
    const s = busy({ battlefield: ['Mountain', { card: 'Mountain', controller: 1 }, TestWolf.id] });
    expect(s.dayNight).toBe('none');
    pass(s);
    expect(s.dayNight).toBe('day');
    expect(s.objects[id1(s, TestWolf.id)]!.face).toBe(0);
  });

  it('CR 514.3a (another cleanup step): a trigger in cleanup gives priority, then cleanup repeats and damage wears off', () => {
    const hand0 = [TestBolt.id, ...lib(7)];
    const s = given({
      turn: 1, step: 'end', active: 0,
      battlefield: ['Mountain', TestWatcher.id, { card: 'Mountain', controller: 1 }, { card: TestWall.id, controller: 1 }],
      hands: [hand0, [TestBolt.id]],
      libraries: [lib(10), lib(10)],
    });
    const wall = id1(s, TestWall.id);
    pass(s, 2);
    // CR 514.1 (discard to hand size): eight cards, discard one.
    expect(s.step).toBe('cleanup');
    expect(s.pendingChoice?.kind).toBe('pickObjects');
    const bear = s.zones.hand[0].find((id) => s.objects[id]!.defId === TestBear.id)!;
    answer(s, { ids: [bear] });
    // The discard trigger fires during cleanup: players get priority in cleanup.
    expect(s.step).toBe('cleanup');
    expect(s.stepPriority).toBe(true);
    expect(who(s)).toBe(0);
    act(s, castMove(s, TestBolt.name, [O(wall)]));
    while (s.turn < 2) {
      if (s.step === 'cleanup' && s.zones.stack.length === 0 && s.objects[wall]) expect(s.objects[wall]!.damage).toBe(3);
      pass(s);
    }
    expect(s.players[0].life).toBe(21);
    // Damage dealt during the first cleanup's priority was removed by the second cleanup.
    expect(s.objects[wall]!.damage).toBe(0);
  });

  it('CR 500.8 (extra phases): an attack trigger inserts a second combat phase right after this one', () => {
    const s = given({
      turn: 1, step: 'main1', active: 0,
      battlefield: [TestRally.id],
      libraries: [lib(10), lib(10)],
    });
    const rally = id1(s, TestRally.id);
    act(s, { type: 'pass' });
    expect(s.pendingChoice?.kind).toBe('declareAttackers');
    act(s, { type: 'declareAttackers', assignments: [[rally, { kind: 'player', p: 1 }]] });
    // Second declare attackers: the trigger untapped Rally and queued another combat.
    expect(s.pendingChoice?.kind).toBe('declareAttackers');
    expect(s.players[1].life).toBe(18);
    expect(s.step).toBe('declareAttackers');
    expect(s.phaseQueue.includes('beginCombat')).toBe(false);
    act(s, { type: 'declareAttackers', assignments: [[rally, { kind: 'player', p: 1 }]] });
    // The intervening-if clause fails on the second attack: no third combat; next stop is turn 3.
    while (s.pendingChoice?.kind !== 'declareAttackers') pass(s);
    expect(s.turn).toBe(3);
    expect(s.players[1].life).toBe(16);
  });

  it('insertExtraCombat puts the combat steps before the postcombat main phase', async () => {
    const { insertExtraCombat } = await import('../../engine/turn.js');
    const s = given({ step: 'declareAttackers' });
    insertExtraCombat(s);
    expect(s.phaseQueue).toEqual(['declareBlockers', 'combatDamage', 'endCombat', ...COMBAT_STEPS, 'main2', 'end', 'cleanup']);
  });
});
