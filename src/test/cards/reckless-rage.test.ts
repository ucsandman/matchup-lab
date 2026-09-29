// Reckless Rage scenarios (docs/CARD-ANALYSIS.json). Player 0 is B, player 1 is A.
import { describe, expect, it } from 'vitest';
import { given, id1, TestBolt } from '../helpers.js';
import { PROWESS_BIT, RecklessRage } from '../../cards/defs/reckless-rage.js';
import { KW } from '../../engine/statics.js';
import { isLegalTarget } from '../../engine/targets.js';
import { getDef } from '../../cards/index.js';
import { act, castMove, hasCast, moves, O, P, pass, who } from '../scenario.js';
import { drain, Elf, expectOracle, Gob, Harv, lib, pickTargets, Push, Sheol, Spear, pt } from './burn-pump-fixtures.js';
import type { Move, SpellDef } from '../../engine/types.js';

const RAGE = 'Reckless Rage';

describe('Reckless Rage', () => {
  it('def matches oracle.json: {R} instant; the prowess bit it reads is KW.prowess', () => {
    expectOracle(RecklessRage);
    expect(PROWESS_BIT).toBe(KW.prowess);
  });

  it('scenario 1: prowess resolves first, then 4 kills the 3/2 and the 2/3 survives 2 (CR 702.108a (prowess))', () => {
    const s = given({
      battlefield: [Spear.id, 'Mountain', { card: Harv.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[RAGE], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const sp = id1(s, Spear.id);
    const hv = id1(s, Harv.id);
    act(s, castMove(s, RAGE, [O(hv), O(sp)]));
    drain(s);
    expect(s.objects[hv]).toBeUndefined();
    expect(s.objects[sp]?.damage).toBe(2);
    expect(pt(s, sp)).toEqual([2, 3]);
  });

  it('scenario 2: with Soul-Scar the 4 becomes four -1/-1 counters; Nemesis takes 2 and its trigger finishes the 4/5 (CR 614.1a (instead))', () => {
    const s = given({
      battlefield: ['Soul-Scar Mage', 'Screaming Nemesis', 'Mountain', { card: Sheol.id, controller: 1 }],
      hands: [[RAGE], []], libraries: [lib(5), lib(5)],
    });
    const nem = id1(s, 'Screaming Nemesis');
    const sh = id1(s, Sheol.id);
    act(s, castMove(s, RAGE, [O(sh), O(nem)]));
    drain(s);
    // Rage resolved: Sheoldred has counters, not damage; the Nemesis trigger waits for a target.
    expect(s.objects[sh]).toMatchObject({ damage: 0, counters: { m1m1: 4 } });
    expect(pt(s, sh)).toEqual([0, 1]);
    expect(s.objects[nem]?.damage).toBe(2);
    pickTargets(s, [O(sh)]);
    drain(s);
    expect(s.objects[sh]).toBeUndefined();
    expect(s.zones.graveyard[1].length).toBe(1);
  });

  it('scenario 3: with no creature of your own it cannot be cast (CR 601.2c (choose targets))', () => {
    const s = given({
      battlefield: ['Mountain', { card: Harv.id, controller: 1 }],
      hands: [[RAGE], []], libraries: [lib(5), lib(5)],
    });
    expect(hasCast(s, RAGE)).toBe(false);
  });

  it('one target illegal on resolution: the other is still dealt its damage (CR 608.2b (illegal targets))', () => {
    const s = given({
      battlefield: ['Screaming Nemesis', 'Mountain', { card: Harv.id, controller: 1 }, { card: 'Swamp', controller: 1 }],
      hands: [[RAGE], [Push.id]], libraries: [lib(5), lib(5)],
    });
    const nem = id1(s, 'Screaming Nemesis');
    const hv = id1(s, Harv.id);
    act(s, castMove(s, RAGE, [O(hv), O(nem)]));
    expect(who(s)).toBe(1);
    act(s, castMove(s, Push.name, [O(nem)]));
    drain(s);
    expect(s.objects[nem]).toBeUndefined();
    expect(s.objects[hv]).toBeUndefined(); // 4 damage to the 3/2
  });

  it('move pruning: own targets that survive or want damage, plus one sacrificial; legality unchanged', () => {
    const s = given({
      battlefield: [Spear.id, Gob.id, Elf.id, 'Screaming Nemesis', 'Mountain', { card: Harv.id, controller: 1 }],
      hands: [[RAGE], []], libraries: [lib(5), lib(5)],
    });
    const offered = moves(s).filter((m): m is Extract<Move, { type: 'cast' }> => m.type === 'cast')
      .map((m) => m.targets[1]).map((tg) => (tg?.kind === 'obj' ? tg.id : -1)).sort((a, b) => a - b);
    const want = [id1(s, Spear.id), id1(s, Elf.id), id1(s, 'Screaming Nemesis')].sort((a, b) => a - b);
    console.log(`reckless rage prune: ${offered.length} own targets offered of 4 legal`);
    expect(offered).toEqual(want);
    // The pruned Goblin is still a legal target.
    const sp = (getDef(RecklessRage.id).faces[0]?.abilities[0] as SpellDef).modes[0]!.targets[1]!;
    expect(isLegalTarget(s, sp, 0, id1(s, 'Reckless Rage', 'hand'), O(id1(s, Gob.id)))).toBe(true);
  });

  it('never targets a player', () => {
    const s = given({ battlefield: [Spear.id, 'Mountain', { card: Harv.id, controller: 1 }], hands: [[RAGE], []], libraries: [lib(5), lib(5)] });
    const ts = moves(s).flatMap((m) => (m.type === 'cast' ? m.targets : []));
    expect(ts.some((tg) => JSON.stringify(tg) === JSON.stringify(P(1)))).toBe(false);
    pass(s);
  });
});
