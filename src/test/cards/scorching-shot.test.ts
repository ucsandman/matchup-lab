// Scorching Shot scenarios (docs/CARD-ANALYSIS.json). Player 0 is B, player 1 is A.
import { describe, expect, it } from 'vitest';
import { given, id1, TestBolt } from '../helpers.js';
import { ScorchingShot } from '../../cards/defs/scorching-shot.js';
import { act, answer, castMove, O } from '../scenario.js';
import { Crusher, drain, Etching, expectOracle, lib, Sheol, Tresp } from './burn-pump-fixtures.js';

const SHOT = 'Scorching Shot';

describe('Scorching Shot', () => {
  it('def matches oracle.json: {R}{R} sorcery', () => {
    expectOracle(ScorchingShot);
  });

  it('scenario 1a: 5 damage kills a 4/5 (CR 704.5g (lethal damage))', () => {
    const s = given({
      battlefield: ['Mountain', 'Mountain', { card: Sheol.id, controller: 1 }],
      hands: [[SHOT], []], libraries: [lib(5), lib(5)],
    });
    const sh = id1(s, Sheol.id);
    act(s, castMove(s, SHOT, [O(sh)]));
    drain(s);
    expect(s.objects[sh]).toBeUndefined();
    expect(s.zones.graveyard[1].length).toBe(1);
  });

  it('scenario 1b: with Etching on B\'s side the creature dealt damage is exiled instead (CR 614.1a (instead))', () => {
    const s = given({
      battlefield: [Etching.id, 'Mountain', 'Mountain', { card: Sheol.id, controller: 1 }],
      hands: [[SHOT], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, SHOT, [O(id1(s, Sheol.id))]));
    drain(s);
    expect(s.zones.graveyard[1].length).toBe(0);
    expect(s.zones.exile[1].length).toBe(1);
  });

  it('scenario 2: Soul-Scar and Etching, ward paid: five -1/-1 counters, dies to CR 704.5f (toughness 0 or less), goes to the graveyard, not exile', () => {
    const s = given({
      battlefield: ['Soul-Scar Mage', Etching.id, 'Mountain', 'Mountain', { card: Tresp.id, controller: 1 }],
      hands: [[SHOT, TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const tr = id1(s, Tresp.id);
    act(s, castMove(s, SHOT, [O(tr)]));
    drain(s);
    answer(s, { index: 1 }); // pay ward
    drain(s);
    expect(s.objects[tr]).toBeUndefined();
    expect(s.zones.graveyard[1].length).toBe(1);
    expect(s.zones.exile[1].length).toBe(0);
  });

  it('scenario 3: the Giant\'s becomes-target trigger resolves first (B takes 2), then the Giant dies (CR 603.3 (triggered abilities on the stack))', () => {
    const s = given({
      battlefield: ['Mountain', 'Mountain', { card: Crusher.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[SHOT], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const gi = id1(s, Crusher.id);
    act(s, castMove(s, SHOT, [O(gi)]));
    expect(s.zones.stack.map((x) => x.kind)).toEqual(['spell', 'triggered']);
    drain(s);
    expect(s.players[0].life).toBe(18);
    expect(s.objects[gi]).toBeUndefined();
  });
});
