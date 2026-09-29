// Soul-Scar Mage scenarios (docs/CARD-ANALYSIS.json). Player 0 is B, player 1 is A.
import { describe, expect, it } from 'vitest';
import { given, id1, TestBolt } from '../helpers.js';
import { SoulScarMage } from '../../cards/defs/soul-scar-mage.js';
import { act, answer, castMove, O, P, pass } from '../scenario.js';
import { drain, Etching, expectOracle, Harv, lib, pt, Sheol, toNextTurn, Tresp, until } from './burn-pump-fixtures.js';

const SSM = 'Soul-Scar Mage';
const BURST = 'Burst Lightning';

describe('Soul-Scar Mage', () => {
  it('def matches oracle.json: {R} 1/2 Human Wizard', () => {
    expectOracle(SoulScarMage);
  });

  it('scenario 1: Burst on a 4/5: two -1/-1 counters that last (2/3); Soul-Scar is 2/3 until end of turn (CR 614.1a (instead), CR 702.108a (prowess))', () => {
    const s = given({
      turn: 1, step: 'main1',
      battlefield: [SSM, 'Mountain', { card: Sheol.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[BURST], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const ss = id1(s, SSM);
    const sh = id1(s, Sheol.id);
    act(s, castMove(s, BURST, [O(sh)]));
    drain(s);
    expect(s.objects[sh]).toMatchObject({ damage: 0, counters: { m1m1: 2 } });
    expect(s.objects[sh]?.damagedThisTurnBy).toEqual([false, false]);
    expect(pt(s, sh)).toEqual([2, 3]);
    expect(pt(s, ss)).toEqual([2, 3]);
    toNextTurn(s);
    expect(pt(s, sh)).toEqual([2, 3]);
    expect(pt(s, ss)).toEqual([1, 2]);
  });

  it('scenario 2: with Etching, kicked Burst on a 3/3 (ward paid): dies to CR 704.5f (toughness 0 or less) and goes to the graveyard, not exile', () => {
    const s = given({
      battlefield: [SSM, Etching.id, 'Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain', { card: Tresp.id, controller: 1 }],
      hands: [[BURST, TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const tr = id1(s, Tresp.id);
    act(s, castMove(s, BURST, [O(tr)], (m) => m.kicked === true));
    drain(s);
    answer(s, { index: 1 }); // pay ward
    drain(s);
    expect(s.objects[tr]).toBeUndefined();
    expect(s.zones.graveyard[1].length).toBe(1);
    expect(s.zones.exile[1].length).toBe(0);
  });

  it('scenario 3: combat damage is not replaced: the blocker gets marked damage (CR 510.2 (combat damage))', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: [SSM, { card: Harv.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const ss = id1(s, SSM);
    const hv = id1(s, Harv.id);
    until(s, 'declareAttackers');
    act(s, { type: 'declareAttackers', assignments: [[ss, { kind: 'player', p: 1 }]] });
    until(s, 'declareBlockers');
    act(s, { type: 'declareBlockers', assignments: [[hv, ss]] });
    while (s.step !== 'combatDamage' && s.turn === 3) pass(s);
    expect(s.objects[hv]).toMatchObject({ damage: 1 });
    expect(s.objects[hv]?.counters.m1m1 ?? 0).toBe(0);
    expect(s.objects[ss]).toBeUndefined();
  });

  it('noncombat damage to a player or to B\'s own creature is not replaced', () => {
    const s = given({
      battlefield: [SSM, 'Screaming Nemesis', 'Mountain', 'Mountain'],
      hands: [[BURST, BURST], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, BURST, [P(1)]));
    drain(s);
    expect(s.players[1].life).toBe(18);
    const ss = id1(s, SSM);
    act(s, castMove(s, BURST, [O(ss)]));
    drain(s);
    expect(s.objects[ss]).toMatchObject({ damage: 2 });
  });

  it('two Soul-Scars: the damage becomes counters once, not twice (CR 616.1f (repeated process))', () => {
    const s = given({
      battlefield: [SSM, SSM, 'Mountain', { card: Sheol.id, controller: 1 }],
      hands: [[BURST], []], libraries: [lib(5), lib(5)],
    });
    const sh = id1(s, Sheol.id);
    act(s, castMove(s, BURST, [O(sh)]));
    drain(s);
    expect(s.objects[sh]?.counters.m1m1).toBe(2);
  });
});
