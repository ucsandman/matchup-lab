// Flowstone Infusion scenarios (docs/CARD-ANALYSIS.json). Player 0 is B, player 1 is A.
import { describe, expect, it } from 'vitest';
import { given, id1, TestBolt } from '../helpers.js';
import { FlowstoneInfusion } from '../../cards/defs/flowstone-infusion.js';
import { act, castMove, O } from '../scenario.js';
import { Aeth, drain, Etching, expectOracle, Harv, lib, pt, Spear, toNextTurn } from './burn-pump-fixtures.js';

const INF = 'Flowstone Infusion';

describe('Flowstone Infusion', () => {
  it('def matches oracle.json: {R} instant', () => {
    expectOracle(FlowstoneInfusion);
  });

  it('scenario 1: a 3/2 becomes 5/0 and dies to CR 704.5f (toughness 0 or less); no damage was dealt, so Etching does not exile it', () => {
    const s = given({
      battlefield: [Etching.id, 'Mountain', { card: Harv.id, controller: 1 }],
      hands: [[INF], []], libraries: [lib(5), lib(5)],
    });
    const hv = id1(s, Harv.id);
    act(s, castMove(s, INF, [O(hv)]));
    drain(s);
    expect(s.objects[hv]).toBeUndefined();
    expect(s.zones.graveyard[1].length).toBe(1);
    expect(s.zones.exile[1].length).toBe(0);
  });

  it('scenario 2: on a 1/2 prowess creature: prowess first (2/3), then 4/1; back to 1/2 after cleanup (CR 514.2 (end of turn effects))', () => {
    const s = given({
      turn: 1, step: 'main1',
      battlefield: [Spear.id, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[INF], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const sp = id1(s, Spear.id);
    act(s, castMove(s, INF, [O(sp)]));
    drain(s);
    expect(pt(s, sp)).toEqual([4, 1]);
    toNextTurn(s);
    expect(pt(s, sp)).toEqual([1, 2]);
  });

  it('scenario 3: a 2/3 with 1 damage marked becomes toughness 1 and dies to CR 704.5g (lethal damage)', () => {
    const s = given({
      battlefield: ['Mountain', { card: Aeth.id, controller: 1, damage: 1 }],
      hands: [[INF], []], libraries: [lib(5), lib(5)],
    });
    const ae = id1(s, Aeth.id);
    act(s, castMove(s, INF, [O(ae)]));
    drain(s);
    expect(s.objects[ae]).toBeUndefined();
    expect(s.zones.graveyard[1].length).toBe(1);
  });

  it('it deals no damage, so a Screaming Nemesis given +2/-2 does not trigger', () => {
    const s = given({ battlefield: ['Screaming Nemesis', 'Mountain'], hands: [[INF], []], libraries: [lib(5), lib(5)] });
    const nem = id1(s, 'Screaming Nemesis');
    act(s, castMove(s, INF, [O(nem)]));
    drain(s);
    expect(s.pendingChoice?.kind).not.toBe('pickTargets');
    expect(s.zones.stack.length).toBe(0);
    expect(pt(s, nem)).toEqual([5, 1]);
    expect(s.players[1].life).toBe(20);
    expect(s.players[1].cantGainLife).toBe(false);
  });
});
