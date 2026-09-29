// Redcap Melee scenarios (docs/CARD-ANALYSIS.json). Player 0 is B, player 1 is A.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, TestBolt } from '../helpers.js';
import { RED_BIT, RedcapMelee } from '../../cards/defs/redcap-melee.js';
import { COLOR } from '../../engine/statics.js';
import { act, answer, castMove, O } from '../scenario.js';
import { drain, expectOracle, Harv, lib, Sheol, Tresp } from './burn-pump-fixtures.js';

const REDCAP = 'Redcap Melee';

describe('Redcap Melee', () => {
  it('def matches oracle.json: {R} instant; the red bit it reads is COLOR.R', () => {
    expectOracle(RedcapMelee);
    expect(RED_BIT).toBe(COLOR.R);
  });

  it('scenario 1: 4 damage to a black 4/5: it survives, and B sacrifices a land of B\'s choice (CR 120.3e (damage to a creature))', () => {
    const s = given({
      battlefield: ['Mountain', 'Swamp', { card: Sheol.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[REDCAP], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const sh = id1(s, Sheol.id);
    const swamp = id1(s, 'Swamp');
    act(s, castMove(s, REDCAP, [O(sh)]));
    drain(s);
    // The tapped Mountain and the untapped Swamp differ, so B is asked (mid-resolution; the
    // resolution is replayed with the answer).
    expect(s.pendingChoice).toMatchObject({ kind: 'pickObjects', player: 0, reason: 'sacrificeLand' });
    answer(s, { ids: [swamp] });
    expect(s.objects[sh]?.damage).toBe(4);
    expect(ids(s, 'Swamp').length).toBe(0);
    expect(ids(s, 'Mountain', 'battlefield', 0).length).toBe(1);
    expect(ids(s, 'Swamp', 'graveyard').length).toBe(1);
  });

  it('scenario 2: a black and red permanent is red (CR 105.2 (colors)): it dies and no land is sacrificed', () => {
    const s = given({
      battlefield: ['Mountain', { card: Harv.id, controller: 1 }],
      hands: [[REDCAP], []], libraries: [lib(5), lib(5)],
    });
    const hv = id1(s, Harv.id);
    act(s, castMove(s, REDCAP, [O(hv)]));
    drain(s);
    expect(s.objects[hv]).toBeUndefined();
    expect(ids(s, 'Mountain').length).toBe(1);
  });

  it('scenario 3: with Soul-Scar (ward paid) the damage becomes counters, no damage is dealt, no land is sacrificed (CR 614.1a (instead), CR 702.21a (ward))', () => {
    const s = given({
      battlefield: ['Soul-Scar Mage', 'Mountain', { card: Tresp.id, controller: 1 }],
      hands: [[REDCAP, TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const tr = id1(s, Tresp.id);
    act(s, castMove(s, REDCAP, [O(tr)]));
    drain(s);
    // Ward (A's trigger) resolves first: B pays by discarding its last card.
    expect(s.pendingChoice).toMatchObject({ kind: 'pickIndex', player: 0, reason: 'wardPay' });
    answer(s, { index: 1 });
    drain(s);
    expect(s.objects[tr]).toBeUndefined();
    expect(s.zones.graveyard[1].length).toBe(1);
    expect(ids(s, 'Mountain').length).toBe(1);
    expect(s.zones.hand[0].length).toBe(0);
  });

  it('ward unpaid: Redcap is countered, nothing happens', () => {
    const s = given({
      battlefield: ['Mountain', { card: Tresp.id, controller: 1 }],
      hands: [[REDCAP, TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const tr = id1(s, Tresp.id);
    act(s, castMove(s, REDCAP, [O(tr)]));
    drain(s);
    answer(s, { index: 0 });
    drain(s);
    expect(s.objects[tr]?.damage).toBe(0);
    expect(ids(s, 'Mountain').length).toBe(1);
  });
});
