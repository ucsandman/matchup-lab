import { describe, expect, it } from 'vitest';
import { given, id1, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, stat } from '../../cards/dsl.js';
import { getAbility } from '../../cards/index.js';
import { makeCtx } from '../../engine/ctx.js';
import { canGainLife, gainLife } from '../../engine/life.js';
import { characteristics } from '../../engine/statics.js';
import { createToken } from '../../engine/zones.js';
import type { SpellDef } from '../../engine/types.js';

const TestLynx = registerTestDef(card('Test Lynx', [face({
  name: 'Test Lynx', types: ['Creature'], cost: '{2}{R}{R}', pt: [5, 4], abilities: [stat({ category: 'cantGainLife' })],
})]));

describe('effect context', () => {
  it('TestBolt resolves through the ctx: 3 damage to a creature or a player', () => {
    const s = given({ battlefield: [{ card: TestBear.id, controller: 1 }] });
    const bolt = getAbility(`${TestBolt.id}:0:0`).ability as SpellDef;
    const bear = id1(s, TestBear.id);
    const ctx = makeCtx(s, 0, 0, `${TestBolt.id}:0:0`);
    bolt.modes[0]!.resolve(ctx, [{ kind: 'obj', id: bear }]);
    expect(s.objects[bear]!.damage).toBe(3);
    bolt.modes[0]!.resolve(ctx, [{ kind: 'player', p: 1 }]);
    expect(s.players[1].life).toBe(17);
    expect(s.events.filter((e) => e.e === 'damage').length).toBe(2);
  });

  it('count, permanents, until-EOT deltas and counters', () => {
    const s = given({ battlefield: [TestBear.id] });
    createToken(s, 'Blood', 0);
    createToken(s, 'Blood', 0);
    createToken(s, 'Blood', 1);
    const bear = id1(s, TestBear.id);
    const ctx = makeCtx(s, bear, 0, 'x');
    expect(ctx.count('Blood', 0)).toBe(2);
    expect(ctx.permanents(0).length).toBe(3);
    ctx.addEotDelta(bear, -4, -4);
    expect(characteristics(s, bear).toughness).toBe(-2);
    ctx.addCounter(bear, 'p1p1', 1);
    expect(characteristics(s, bear).power).toBe(-1);
  });

  it('life gain checks the cantGainLife hook (CR 119.7 (can\'t gain life))', () => {
    const s = given({ battlefield: [{ card: TestLynx.id, controller: 1 }] });
    expect(canGainLife(s, 0)).toBe(false);
    expect(gainLife(s, 0, 3)).toBe(0);
    expect(s.players[0].life).toBe(20);
    const s2 = given();
    s2.players[1].cantGainLife = true;
    expect(gainLife(s2, 1, 2)).toBe(0);
    expect(gainLife(s2, 0, 2)).toBe(2);
    expect(s2.players[0].life).toBe(22);
  });

  it('choose without a picker throws NeedChoice', () => {
    const s = given();
    const ctx = makeCtx(s, 0, 0, 'x');
    expect(() => ctx.choose({ kind: 'pickIndex', player: 0, reason: 'test', count: 2 })).toThrow(/need choice/);
  });
});
