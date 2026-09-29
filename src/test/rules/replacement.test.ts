// Replacement effects and the damage pipeline: the affected controller orders two would-die
// replacements through the engine, damage replaced by -1/-1 counters, lifelink through gainLife,
// the per-source damage tally, damagedThisTurnBy.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, stat } from '../../cards/dsl.js';
import { addEffect, allocId } from '../../engine/mutate.js';
import { dealDamage } from '../../engine/damage.js';
import { act, answer, castMove, O } from '../scenario.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);

const Exiler = registerTestDef(card('Test Rp Exiler', [face({
  name: 'Test Rp Exiler', types: ['Creature'], cost: '{2}{B}{B}', pt: [3, 4],
  abilities: [stat({
    category: 'dieReplacement',
    applies: (ctx, dying) => { const o = ctx.obj(dying); return !!o && o.controller !== ctx.controller && !o.token && ctx.isType(dying, 'Creature'); },
    after: (ctx) => { ctx.createToken('Zombie', ctx.controller); },
  })],
})]));
const Scarred = registerTestDef(card('Test Rp Scarred', [face({
  name: 'Test Rp Scarred', types: ['Creature'], cost: '{1}{R}', pt: [1, 2],
  abilities: [stat({
    category: 'damageReplacement',
    damageToCounters: (ctx, src, target, combat) => {
      const s = ctx.obj(src);
      const t = ctx.obj(target);
      return !combat && !!s && !!t && s.controller === ctx.controller && t.controller !== ctx.controller;
    },
  })],
})]));
const Tracker = registerTestDef(card('Test Rp Tracker', [face({
  name: 'Test Rp Tracker', types: ['Creature'], cost: '{1}', pt: [3, 3], keywords: ['lifelink'],
  abilities: [stat({ category: 'marker', marker: 'tracksDamageDealt' })],
})]));
const NoGain = registerTestDef(card('Test Rp NoGain', [face({
  name: 'Test Rp NoGain', types: ['Creature'], cost: '{1}', pt: [1, 1], abilities: [stat({ category: 'cantGainLife' })],
})]));

describe('replacement effects and damage', () => {
  it('CR 616.1 (affected controller chooses): two would-die replacements ask the dying creature\'s controller', () => {
    const mk = () => {
      const s = given({
        turn: 1, step: 'main1',
        battlefield: ['Mountain', { card: Exiler.id, controller: 1 }, TestBear.id, { card: 'Mountain', controller: 1 }],
        hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
      });
      const bear = id1(s, TestBear.id);
      // Torch the Tower style: exile it if it would die this turn.
      addEffect(s, { eid: allocId(s), kind: 'exileIfDies', target: bear, until: 'eot' });
      act(s, { type: 'pass' }); // player 0 passes; player 1 holds Bolt
      act(s, castMove(s, TestBolt.name, [O(bear)]));
      return s;
    };
    const s = mk();
    expect(s.pendingChoice).toMatchObject({ kind: 'dieReplacement', player: 0 });
    const opts = s.pendingChoice!.kind === 'dieReplacement' ? s.pendingChoice!.options : [];
    expect(opts.length).toBe(2);
    // Choose the static (Exiler): exiled, and Exiler's controller gets a Zombie.
    answer(s, { index: opts.findIndex((o) => o.source !== null) });
    expect(ids(s, TestBear.id, 'exile', 0).length).toBe(1);
    expect(ids(s, 'token-zombie').length).toBe(1);
    const s2 = mk();
    const opts2 = s2.pendingChoice!.kind === 'dieReplacement' ? s2.pendingChoice!.options : [];
    answer(s2, { index: opts2.findIndex((o) => o.source === null) });
    expect(ids(s2, TestBear.id, 'exile', 0).length).toBe(1);
    expect(ids(s2, 'token-zombie').length).toBe(0);
  });

  it('CR 614.1a (instead): noncombat damage to an opposing creature becomes -1/-1 counters; 0 damage dealt', () => {
    const s = given({ battlefield: [Scarred.id, { card: TestBear.id, controller: 1 }, TestBear.id] });
    const [mine, theirs] = [ids(s, TestBear.id, 'battlefield', 0)[0]!, ids(s, TestBear.id, 'battlefield', 1)[0]!];
    const scar = id1(s, Scarred.id);
    expect(dealDamage(s, scar, O(theirs), 1, false)).toBe(0);
    expect(s.objects[theirs]).toMatchObject({ damage: 0, counters: { m1m1: 1 } });
    // Combat damage and damage to its controller's own creatures are not replaced.
    expect(dealDamage(s, scar, O(theirs), 1, true)).toBe(1);
    expect(dealDamage(s, scar, O(mine), 1, false)).toBe(1);
    expect(s.objects[mine]!.damage).toBe(1);
  });

  it('lifelink goes through gainLife (CR 119.7 (can\'t gain life)); the damage tally counts only flagged sources', () => {
    const s = given({ battlefield: [Tracker.id, TestBear.id] });
    const tr = id1(s, Tracker.id);
    const bear = id1(s, TestBear.id);
    dealDamage(s, tr, { kind: 'player', p: 1 }, 3, true);
    dealDamage(s, bear, { kind: 'player', p: 1 }, 2, true);
    expect(s.players[0].life).toBe(23);
    expect(s.turnFlags.damageTally).toEqual({ [tr]: [0, 3] });
    const s2 = given({ battlefield: [Tracker.id, { card: NoGain.id, controller: 1 }] });
    dealDamage(s2, id1(s2, Tracker.id), { kind: 'player', p: 1 }, 3, true);
    expect(s2.players[0].life).toBe(20);
    expect(s2.players[1].life).toBe(17);
  });

  it('damage marks damagedThisTurnBy for the source controller and the deathtouch flag', () => {
    const s = given({ battlefield: [{ card: TestBear.id, controller: 1 }, 'Mountain'] });
    const bear = id1(s, TestBear.id);
    dealDamage(s, id1(s, 'Mountain'), O(bear), 1, false);
    expect(s.objects[bear]!.damagedThisTurnBy).toEqual([true, false]);
    expect(s.objects[bear]!.deathtouched).toBeUndefined();
  });
});
