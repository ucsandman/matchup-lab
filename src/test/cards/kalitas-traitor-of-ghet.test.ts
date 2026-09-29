// Kalitas, Traitor of Ghet: would-die replacement (CR 614.1a (instead)) that makes a Zombie, and
// the sacrifice-another-Vampire-or-Zombie ability.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, spell, t } from '../../cards/dsl.js';
import { characteristics } from '../../engine/statics.js';
import { act, castMove, moves, O, pass } from '../scenario.js';
import type { GameState, Move } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const KALITAS = 'Kalitas, Traitor of Ghet';
const ZOMBIE = 'token-zombie';

/** {R} instant: 4 damage to one target creature and 2 to another (Reckless Rage stand-in). */
const Rage = registerTestDef(card('Test Ka Rage', [face({
  name: 'Test Ka Rage', types: ['Instant'], cost: '{R}',
  abilities: [spell({
    targets: [t.creature({ controller: 'opponent' }), t.creature({ controller: 'you' })],
    resolve: (ctx, [a, b]) => { if (a) ctx.dealDamage(a, 4); if (b) ctx.dealDamage(b, 2); },
  })],
})]));

function resolveStack(s: GameState): void {
  let guard = 0;
  while (s.zones.stack.length > 0 && !s.pendingChoice) { pass(s); if (++guard > 50) throw new Error('stack did not resolve'); }
}

describe('Kalitas, Traitor of Ghet', () => {
  it('matches its oracle characteristics', () => {
    const s = given({ battlefield: [KALITAS] });
    const c = characteristics(s, id1(s, KALITAS));
    expect([c.power, c.toughness, c.manaValue, c.legendary, c.subtypes]).toEqual([3, 4, 4, true, ['Vampire', 'Warrior']]);
  });

  it('scenario 1: an opponent creature dealt lethal damage is exiled and Kalitas controller gets a 2/2 Zombie', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [KALITAS, 'Mountain', { card: TestBear.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Test Bolt', [O(id1(s, TestBear.id))]));
    resolveStack(s);
    expect(ids(s, TestBear.id, 'exile', 1).length).toBe(1);
    expect(s.zones.graveyard[1].length).toBe(0);
    const z = ids(s, ZOMBIE, 'battlefield', 0);
    expect(z.length).toBe(1);
    const c = characteristics(s, z[0]!);
    expect([c.power, c.toughness]).toEqual([2, 2]);
  });

  it('scenario 2: it also replaces the death of a creature its opponent kills themselves', () => {
    const s = given({
      turn: 3, step: 'main1', active: 1,
      battlefield: [KALITAS, 'Mountain', { card: TestBear.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [Rage.id]], libraries: [lib(5), lib(5)],
    });
    const k = id1(s, KALITAS);
    act(s, castMove(s, 'Test Ka Rage', [O(k), O(id1(s, TestBear.id))]));
    resolveStack(s);
    expect(ids(s, TestBear.id, 'exile', 1).length).toBe(1);
    expect(ids(s, ZOMBIE, 'battlefield', 0).length).toBe(1);
    // 4 damage on a 3/4 Kalitas is lethal; its own controller's creature dying is not replaced.
    expect(ids(s, KALITAS, 'graveyard', 0).length).toBe(1);
  });

  it('scenario 3: sacrifice Bloodtithe Harvester for two +1/+1 counters; Harvester goes to its owner graveyard', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [KALITAS, 'Bloodtithe Harvester', TestBear.id, 'Swamp', 'Swamp', 'Swamp', { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const k = id1(s, KALITAS);
    const acts = moves(s).filter((m): m is Extract<Move, { type: 'activate' }> => m.type === 'activate' && m.objId === k);
    // Only another Vampire or Zombie: Harvester qualifies, the Bear and Kalitas itself do not.
    expect(acts.map((m) => m.sacrifice)).toEqual([[id1(s, 'Bloodtithe Harvester')]]);
    act(s, acts[0]!);
    resolveStack(s);
    expect(ids(s, 'Bloodtithe Harvester', 'graveyard', 0).length).toBe(1);
    const c = characteristics(s, k);
    expect([c.power, c.toughness]).toEqual([5, 6]);
  });

  it('does not apply to tokens: an opponent Zombie token dying makes no new Zombie', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [KALITAS, 'Mountain', { card: ZOMBIE, controller: 1, token: true }, { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Test Bolt', [O(id1(s, ZOMBIE))]));
    resolveStack(s);
    expect(ids(s, ZOMBIE, 'battlefield').length).toBe(0);
  });
});
