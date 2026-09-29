// Pyroclasm scenarios (docs/CARD-ANALYSIS.json). Player 0 is B, player 1 is A.
//
// Deviation from the analysis text: it expects the prowess creatures (Swiftspear in scenario 1,
// Soul-Scar Mage in scenario 2) to die. Casting Pyroclasm triggers their prowess, which resolves
// before Pyroclasm (CR 702.108a (prowess)), so each is 2/3 when dealt 2 damage and survives.
import { describe, expect, it } from 'vitest';
import { given, id1, TestBolt } from '../helpers.js';
import { Pyroclasm } from '../../cards/defs/pyroclasm.js';
import { act, castMove, hasCast, P } from '../scenario.js';
import { Aeth, drain, expectOracle, Gob, Harv, lib, pickTargets, pt, Sheol, Spear } from './burn-pump-fixtures.js';

const PYRO = 'Pyroclasm';
const A_SIDE = [
  { card: Harv.id, controller: 1 as const }, { card: Aeth.id, controller: 1 as const },
  { card: Gob.id, controller: 1 as const }, { card: Sheol.id, controller: 1 as const },
];

describe('Pyroclasm', () => {
  it('def matches oracle.json: {1}{R} sorcery', () => {
    expectOracle(Pyroclasm);
  });

  it('scenario 1: 2 to each creature; one simultaneous event, one Nemesis trigger (CR 120.3e (damage to a creature), CR 704.5g (lethal damage))', () => {
    const s = given({
      battlefield: [Spear.id, 'Screaming Nemesis', 'Mountain', 'Mountain', ...A_SIDE],
      hands: [[PYRO], []], libraries: [lib(5), lib(5)],
    });
    const sp = id1(s, Spear.id);
    const nem = id1(s, 'Screaming Nemesis');
    const ae = id1(s, Aeth.id);
    const sh = id1(s, Sheol.id);
    const hv = id1(s, Harv.id);
    const gb = id1(s, Gob.id);
    act(s, castMove(s, PYRO));
    drain(s);
    // SBAs ran once after the whole spell; the Nemesis trigger is waiting for its target.
    expect(s.pendingChoice?.kind).toBe('pickTargets');
    expect(s.objects[hv]).toBeUndefined();
    expect(s.objects[gb]).toBeUndefined();
    expect(s.objects[ae]?.damage).toBe(2);
    expect(s.objects[sh]?.damage).toBe(2);
    expect(s.objects[nem]?.damage).toBe(2);
    expect(s.objects[sp]?.damage).toBe(2); // prowess made it 2/3 first
    expect(pt(s, sp)).toEqual([2, 3]);
    pickTargets(s, [P(1)]);
    drain(s);
    expect(s.players[1].life).toBe(18);
    expect(s.players[1].cantGainLife).toBe(true);
    expect(s.zones.stack.length).toBe(0);
  });

  it('scenario 2: with Soul-Scar, A\'s creatures get two -1/-1 counters each; Soul-Scar itself is dealt damage (CR 614.1a (instead), CR 704.5f (toughness 0 or less))', () => {
    const s = given({
      battlefield: ['Soul-Scar Mage', 'Mountain', 'Mountain', ...A_SIDE],
      hands: [[PYRO], []], libraries: [lib(5), lib(5)],
    });
    const ss = id1(s, 'Soul-Scar Mage');
    const ae = id1(s, Aeth.id);
    const sh = id1(s, Sheol.id);
    const hv = id1(s, Harv.id);
    act(s, castMove(s, PYRO));
    drain(s);
    expect(s.objects[hv]).toBeUndefined(); // 1/0
    expect(s.objects[ae]).toMatchObject({ damage: 0, counters: { m1m1: 2 } });
    expect(pt(s, ae)).toEqual([0, 1]);
    expect(pt(s, sh)).toEqual([2, 3]);
    expect(s.objects[ss]?.damage).toBe(2);
    expect(s.objects[ss]?.counters.m1m1 ?? 0).toBe(0);
  });

  it('sorcery timing: not castable while a spell is on the stack (CR 307.1 (sorcery timing))', () => {
    const s = given({
      battlefield: ['Mountain', 'Mountain', 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[PYRO, 'Burst Lightning', 'Burst Lightning'], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    expect(hasCast(s, PYRO)).toBe(true);
    act(s, castMove(s, 'Burst Lightning', [P(1)]));
    expect(s.zones.stack.length).toBe(1);
    expect(hasCast(s, 'Burst Lightning')).toBe(true);
    expect(hasCast(s, PYRO)).toBe(false);
  });
});
