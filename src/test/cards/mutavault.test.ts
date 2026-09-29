import { describe, expect, it } from 'vitest';
import { given, id1, TestBear, TestBolt } from '../helpers.js';
import { activations, passUntil } from './lands-util.js';
import { act } from '../scenario.js';
import { characteristics, isType } from '../../engine/statics.js';
import { canAttack, canBlock } from '../../engine/combat.js';
import { solvePayment } from '../../engine/mana.js';
import { parseMana } from '../../engine/cost.js';
import { dealDamage } from '../../engine/damage.js';
import { checkSBA } from '../../engine/sba.js';
import { makeCtx } from '../../engine/ctx.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => 'Swamp');
const ANIM = { types: ['Creature' as const], allCreatureTypes: true, pt: [2, 2] as [number, number] };

describe('Mutavault', () => {
  it('paid from the other land it becomes a 2/2, attacks for 2, and is a noncreature land again after cleanup', () => {
    const s = given({
      battlefield: ['Mutavault', 'Swamp', { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const mv = id1(s, 'Mutavault');
    const swamp = id1(s, 'Swamp');
    const plans = solvePayment(s, 0, parseMana('{1}'), { creatureSpell: false });
    const viaSwamp = plans.findIndex((p) => p.taps.every((t) => t.objId === swamp));
    expect(viaSwamp).toBeGreaterThanOrEqual(0);
    const m = activations(s, mv).find((x) => (x.payment ?? 0) === viaSwamp);
    expect(m).toBeDefined();
    act(s, m!);
    passUntil(s, (x) => x.pendingChoice?.kind === 'declareAttackers');
    const c = characteristics(s, mv);
    expect([c.power, c.toughness, c.allCreatureTypes]).toEqual([2, 2, true]);
    expect(c.colors).toBe(0);
    expect(s.objects[mv]!.tapped).toBe(false);
    act(s, { type: 'declareAttackers', assignments: [[mv, { kind: 'player', p: 1 }]] });
    passUntil(s, (x) => x.step === 'main2' || x.step === 'endCombat');
    expect(s.players[1].life).toBe(18);
    passUntil(s, (x) => x.turn === 2);
    expect(isType(s, mv, 'Creature')).toBe(false);
    expect(s.objects[mv]!.damage).toBe(0);
  });

  it('CR 302.6 (summoning sickness): played this turn and animated it cannot attack, but it can block', () => {
    const s = given({ battlefield: [{ card: 'Mutavault', sick: true }, { card: TestBear.id, controller: 1 }] });
    const mv = id1(s, 'Mutavault');
    makeCtx(s, mv, 0, 'test').animate(mv, ANIM);
    expect(canAttack(s, mv, 0)).toBe(false);
    // On the opponent's turn: the bear attacks and the (still sick) Mutavault may block it.
    const bear = id1(s, TestBear.id);
    s.objects[bear]!.attacking = { kind: 'player', p: 0 };
    expect(canBlock(s, mv, bear)).toBe(true);
  });

  it('blocked by a deathtouch creature it dies and goes to its owner\'s graveyard as a land card', () => {
    const s = given({ battlefield: ['Mutavault', 'Swamp', { card: 'Gifted Aetherborn', controller: 1 }] });
    const mv = id1(s, 'Mutavault');
    makeCtx(s, mv, 0, 'test').animate(mv, ANIM);
    dealDamage(s, id1(s, 'Gifted Aetherborn'), { kind: 'obj', id: mv }, 2, true, { controller: 1 });
    checkSBA(s);
    const card = id1(s, 'Mutavault', 'graveyard', 0);
    expect(isType(s, card, 'Land')).toBe(true);
    expect(isType(s, card, 'Creature')).toBe(false);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 0 && isType(s, id, 'Land')).length).toBe(1);
  });

  it('the animation is offered only where it can matter (main phase, beginning of combat, or in response)', () => {
    const s = given({ step: 'main2', battlefield: ['Mutavault', 'Swamp'] });
    expect(activations(s, id1(s, 'Mutavault')).length).toBe(0);
    const t = given({ step: 'main1', battlefield: ['Mutavault', 'Swamp'] });
    expect(activations(t, id1(t, 'Mutavault')).length).toBeGreaterThan(0);
  });
});
