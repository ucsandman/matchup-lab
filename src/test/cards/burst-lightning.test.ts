// Burst Lightning scenarios (docs/CARD-ANALYSIS.json). Player 0 is B, player 1 is A.
import { describe, expect, it } from 'vitest';
import { given, id1, TestBolt } from '../helpers.js';
import { BurstLightning } from '../../cards/defs/burst-lightning.js';
import { act, castMove, moves, O, P, pass, who } from '../scenario.js';
import { drain, expectOracle, Harv, lib, Push, Sheol, Spear, pt, toNextTurn } from './burn-pump-fixtures.js';

const BURST = 'Burst Lightning';

describe('Burst Lightning', () => {
  it('def matches oracle.json: {R} instant, kicker {4}', () => {
    expectOracle(BurstLightning);
  });

  it('scenario 1: unkicked on a 4/5 marks 2 damage; it survives; cleanup removes the damage (CR 514.3 (cleanup damage removal))', () => {
    const s = given({
      turn: 1, step: 'main1',
      battlefield: ['Mountain', { card: Sheol.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[BURST], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const sh = id1(s, Sheol.id);
    act(s, castMove(s, BURST, [O(sh)]));
    drain(s);
    expect(s.objects[sh]?.damage).toBe(2);
    expect(s.zones.graveyard[0].length).toBe(1);
    toNextTurn(s);
    expect(s.objects[sh]?.damage).toBe(0);
  });

  it('scenario 1b: 2 damage to a player (CR 120.3a (damage to a player))', () => {
    const s = given({ battlefield: ['Mountain'], hands: [[BURST], []], libraries: [lib(5), lib(5)] });
    act(s, castMove(s, BURST, [P(1)]));
    drain(s);
    expect(s.players[1].life).toBe(18);
  });

  it('scenario 2: kicked (5 lands) deals 4: a 4/5 survives, and dies with 1 prior damage (CR 702.33d (kicked), CR 704.5g (lethal damage))', () => {
    const five = ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain'];
    const s = given({
      battlefield: [...five, { card: Sheol.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[BURST], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const sh = id1(s, Sheol.id);
    act(s, castMove(s, BURST, [O(sh)], (m) => m.kicked === true));
    drain(s);
    expect(s.objects[sh]?.damage).toBe(4);

    const d = given({
      battlefield: [...five, { card: Sheol.id, controller: 1, damage: 1 }],
      hands: [[BURST], []], libraries: [lib(5), lib(5)],
    });
    const sh2 = id1(d, Sheol.id);
    act(d, castMove(d, BURST, [O(sh2)], (m) => m.kicked === true));
    drain(d);
    expect(d.objects[sh2]).toBeUndefined();
    expect(d.zones.graveyard[1].length).toBe(1);
  });

  it('the kicked variant is not offered with one land (CR 601.2f (total cost))', () => {
    const s = given({ battlefield: ['Mountain'], hands: [[BURST], []], libraries: [lib(5), lib(5)] });
    const casts = moves(s).filter((m) => m.type === 'cast');
    console.log(`burst: ${casts.length} cast moves checked for kicker`);
    expect(casts.length).toBeGreaterThan(0);
    expect(casts.some((m) => m.type === 'cast' && m.kicked)).toBe(false);
  });

  it('scenario 3: the target is removed in response: Burst does nothing (CR 608.2b (illegal targets)); prowess from the cast still resolved', () => {
    const s = given({
      battlefield: [Spear.id, 'Mountain', 'Mountain', { card: Harv.id, controller: 1 }, { card: 'Swamp', controller: 1 }],
      hands: [[BURST, TestBolt.id], [Push.id]], libraries: [lib(5), lib(5)],
    });
    const sp = id1(s, Spear.id);
    const hv = id1(s, Harv.id);
    act(s, castMove(s, BURST, [O(hv)]));
    pass(s); // B passes with prowess on top
    expect(who(s)).toBe(1);
    act(s, castMove(s, Push.name, [O(hv)])); // A removes its own Harvester in response
    drain(s);
    expect(s.objects[hv]).toBeUndefined();
    expect(s.players[1].life).toBe(20);
    expect(pt(s, sp)).toEqual([2, 3]);
    expect(s.zones.graveyard[0].length).toBe(1); // Burst went to the graveyard
  });
});
