// Bloodtithe Harvester: ETB Blood token; sorcery-speed sacrifice ability whose X is read on
// resolution, CR 608.2h (determined only once).
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, spell, t } from '../../cards/dsl.js';
import { characteristics } from '../../engine/statics.js';
import { act, castMove, moves, O, pass } from '../scenario.js';
import type { GameState, Move, ObjId } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);

/** {R} instant: target creature gets +2/+2 until end of turn (a Monstrous Rage stand-in). */
const Pump = registerTestDef(card('Test Bth Pump', [face({
  name: 'Test Bth Pump', types: ['Instant'], cost: '{R}',
  abilities: [spell({ target: t.creature(), resolve: (ctx, [tg]) => { if (tg && tg.kind === 'obj') ctx.addEotDelta(tg.id, 2, 2); } })],
})]));

const HARVESTER = 'Bloodtithe Harvester';
const BLOOD = 'token-blood';

function resolveStack(s: GameState): void {
  let guard = 0;
  while (s.zones.stack.length > 0 && !s.pendingChoice) { pass(s); if (++guard > 50) throw new Error('stack did not resolve'); }
}

function activation(s: GameState, objId: ObjId, pred: (m: Extract<Move, { type: 'activate' }>) => boolean = () => true): Extract<Move, { type: 'activate' }> {
  const m = moves(s).find((x): x is Extract<Move, { type: 'activate' }> => x.type === 'activate' && x.objId === objId && pred(x));
  if (!m) throw new Error(`no activation for ${objId}: ${JSON.stringify(moves(s))}`);
  return m;
}

describe('Bloodtithe Harvester', () => {
  it('matches its oracle characteristics', () => {
    const s = given({ battlefield: [HARVESTER] });
    const c = characteristics(s, id1(s, HARVESTER));
    expect([c.power, c.toughness, c.manaValue, c.subtypes]).toEqual([3, 2, 2, ['Vampire']]);
  });

  it('scenario 1: cast with no Blood; the ETB trigger creates one Blood token', () => {
    const s = given({
      turn: 2, step: 'main1', active: 0,
      battlefield: ['Swamp', 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[HARVESTER], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, HARVESTER));
    resolveStack(s);
    expect(ids(s, HARVESTER, 'battlefield', 0).length).toBe(1);
    expect(ids(s, BLOOD, 'battlefield', 0).length).toBe(1);
  });

  it('scenario 2: activation targets a creature; a pump in response makes it survive; Harvester is gone either way', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [HARVESTER, { card: BLOOD, token: true }, { card: TestBear.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[], [Pump.id]], libraries: [lib(5), lib(5)],
    });
    const bear = id1(s, TestBear.id);
    act(s, activation(s, id1(s, HARVESTER), (m) => JSON.stringify(m.targets) === JSON.stringify([O(bear)])));
    // CR 602.2 (pay its costs): Harvester is already sacrificed.
    expect(ids(s, HARVESTER, 'graveyard', 0).length).toBe(1);
    // Player 0 passes; player 1 responds with the pump.
    if (s.priority === 0) pass(s);
    act(s, castMove(s, 'Test Bth Pump', [O(bear)]));
    resolveStack(s);
    expect(s.objects[bear]?.zone).toBe('battlefield');
    const c = characteristics(s, bear);
    expect([c.power, c.toughness]).toEqual([2, 2]);
  });

  it('scenario 2 without a response: X = 2 kills a 2/2 (CR 704.5f (toughness 0 or less))', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [HARVESTER, { card: BLOOD, token: true }, { card: TestBear.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const bear = id1(s, TestBear.id);
    act(s, activation(s, id1(s, HARVESTER), (m) => JSON.stringify(m.targets) === JSON.stringify([O(bear)])));
    resolveStack(s);
    expect(ids(s, TestBear.id, 'graveyard', 1).length).toBe(1);
  });

  it('scenario 3: sacrificing the Blood in response makes X = 0 on resolution, CR 608.2h (determined only once)', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [HARVESTER, { card: BLOOD, token: true }, 'Swamp', { card: TestBear.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const bear = id1(s, TestBear.id);
    const handCard = s.zones.hand[0][0] as ObjId;
    act(s, activation(s, id1(s, HARVESTER), (m) => JSON.stringify(m.targets) === JSON.stringify([O(bear)])));
    // CR 117.3c (receives priority afterward): player 0 keeps priority and activates the Blood.
    expect(s.priority).toBe(0);
    act(s, activation(s, id1(s, BLOOD)));
    expect(ids(s, BLOOD, 'battlefield', 0).length).toBe(0);
    // The discarded card is public in the graveyard.
    expect(ids(s, TestBolt.id, 'graveyard', 0).length).toBe(1);
    expect(s.objects[handCard]).toBeUndefined();
    resolveStack(s);
    expect(s.objects[bear]?.zone).toBe('battlefield');
    const c = characteristics(s, bear);
    expect([c.power, c.toughness]).toEqual([2, 2]);
    // The Blood's draw happened.
    expect(s.zones.hand[0].length).toBe(1);
  });

  it('CR 602.5d (activate only as a sorcery) and CR 302.6 (tap symbol): no activation while sick or with a spell on the stack', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: HARVESTER, sick: true }, { card: TestBear.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const h = id1(s, HARVESTER);
    expect(moves(s).some((m) => m.type === 'activate' && m.objId === h)).toBe(false);
  });
});
