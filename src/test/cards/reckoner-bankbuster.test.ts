// Reckoner Bankbuster: scenarios from docs/CARD-ANALYSIS.json plus crew windows and 302.6.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, TestBear, TestBolt } from '../helpers.js';
import { characteristics, isType } from '../../engine/statics.js';
import { legalTargets } from '../../engine/targets.js';
import { t } from '../../cards/dsl.js';
import { act, castMove, moves, O, P, pass } from '../scenario.js';
import type { GameState, Move, ObjId } from '../../engine/types.js';

const NAME = 'Reckoner Bankbuster';
const DRAW = 'reckoner-bankbuster:0:0';
const CREW = 'reckoner-bankbuster:0:1';
const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
// Player 1 keeps a Bolt and a Mountain so the engine stops whenever player 1 has priority.
const B_STOP = { card: 'Mountain', controller: 1 as const };

const actsOf = (s: GameState, id: ObjId, key: string): Extract<Move, { type: 'activate' }>[] =>
  moves(s).filter((m): m is Extract<Move, { type: 'activate' }> => m.type === 'activate' && m.objId === id && m.abilityKey === key);
const hasCastAt = (s: GameState, id: ObjId): boolean =>
  moves(s).some((m) => m.type === 'cast' && m.targets.some((x) => x.kind === 'obj' && x.id === id));
/** Go for the Throat's target: a creature that is not an artifact. */
const nonArtifactCreature = t.creature({ filter: (ctx, x) => x.kind === 'obj' && !ctx.isType(x.id, 'Artifact') });
function passUntil(s: GameState, pred: (s: GameState) => boolean, max = 60): void {
  for (let i = 0; i < max && !pred(s); i++) pass(s);
  expect(pred(s)).toBe(true);
}

describe('Reckoner Bankbuster', () => {
  it('scenario 1: enters with three charge counters; {2},{T}, remove one: draw, two left, tapped (CR 122.6 (enters with counters))', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp', B_STOP],
      hands: [[NAME], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, NAME, []));
    pass(s);
    const bb = id1(s, NAME);
    expect(s.objects[bb]!.counters.charge).toBe(3);
    // A noncreature artifact: not a creature, so its {T} ability works the turn it enters (CR 302.6 (summoning sickness)).
    expect(isType(s, bb, 'Creature')).toBe(false);
    const draw = actsOf(s, bb, DRAW);
    expect(draw.length).toBe(1);
    const hand = s.zones.hand[0].length;
    act(s, draw[0]!);
    expect(s.objects[bb]!.tapped).toBe(true);
    expect(s.objects[bb]!.counters.charge).toBe(2);
    pass(s);
    expect(s.zones.hand[0].length).toBe(hand + 1);
    expect(ids(s, 'token-treasure').length).toBe(0);
    expect(ids(s, 'token-pilot').length).toBe(0);
  });

  it('scenario 2: the last counter makes a Treasure and a Pilot; the Pilot alone crews 3 (1 + 2) and it attacks as a 4/4', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: NAME, counters: { charge: 1 } }, 'Swamp', 'Swamp', B_STOP],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const bb = id1(s, NAME);
    act(s, actsOf(s, bb, DRAW)[0]!);
    pass(s);
    expect(s.objects[bb]!.counters.charge ?? 0).toBe(0);
    expect(ids(s, 'token-treasure', 'battlefield', 0).length).toBe(1);
    const pilot = id1(s, 'token-pilot', 'battlefield', 0);
    expect(characteristics(s, pilot)).toMatchObject({ power: 1, toughness: 1 });
    // No counter left: the draw ability can't be activated any more.
    expect(actsOf(s, bb, DRAW).length).toBe(0);

    // Next turn: untapped Bankbuster and Pilot; the Pilot alone is a minimal crew (CR 702.122a (crew)).
    const n = given({
      turn: 5, step: 'main1', active: 0,
      battlefield: [{ card: NAME }, { card: 'token-pilot', token: true }, B_STOP],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const bb2 = id1(n, NAME);
    const pilot2 = id1(n, 'token-pilot');
    const crews = actsOf(n, bb2, CREW);
    expect(crews.map((m) => m.crewWith)).toEqual([[pilot2]]);
    act(n, crews[0]!);
    expect(n.objects[pilot2]!.tapped).toBe(true);
    pass(n);
    expect(isType(n, bb2, 'Creature')).toBe(true);
    expect(isType(n, bb2, 'Artifact')).toBe(true);
    expect(characteristics(n, bb2)).toMatchObject({ power: 4, toughness: 4 });
    passUntil(n, (x) => x.pendingChoice?.kind === 'declareAttackers');
    const atk: Move = { type: 'declareAttackers', assignments: [[bb2, P(1) as { kind: 'player'; p: 1 }]] };
    expect(moves(n)).toContainEqual(atk);
    act(n, atk);
    passUntil(n, (x) => x.step === 'endCombat' || x.step === 'main2');
    expect(n.players[1].life).toBe(16);
  });

  it('an uncrewed Bankbuster is not a creature: no creature or any-target spell can target it (CR 301.7 (Vehicle))', () => {
    const s = given({
      turn: 4, step: 'main1', active: 1,
      battlefield: [{ card: NAME }, B_STOP, { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id, TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const bb = id1(s, NAME);
    expect(legalTargets(s, t.any(), 1, bb).some((x) => x.kind === 'obj' && x.id === bb)).toBe(false);
    expect(legalTargets(s, t.artifact(), 1, bb).some((x) => x.kind === 'obj' && x.id === bb)).toBe(true);
    expect(hasCastAt(s, bb)).toBe(false);
  });

  it('crew is offered in the crew windows only, and a Vehicle crewed the turn it entered cannot use {T} (CR 302.6 (summoning sickness))', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: NAME, sick: true, counters: { charge: 3 } }, TestBear.id, TestBear.id, 'Swamp', 'Swamp', B_STOP],
      hands: [[], [TestBolt.id, TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const bb = id1(s, NAME);
    // Uncrewed, the sick Bankbuster can still tap for its draw ability.
    expect(actsOf(s, bb, DRAW).length).toBe(1);
    const crews = actsOf(s, bb, CREW);
    // Bear + Bear (4) is the only minimal crew for 3.
    expect(crews.length).toBe(1);
    expect(crews[0]!.crewWith!.length).toBe(2);
    act(s, crews[0]!);
    pass(s);
    expect(isType(s, bb, 'Creature')).toBe(true);
    expect(actsOf(s, bb, DRAW).length).toBe(0);
    passUntil(s, (x) => x.pendingChoice?.kind === 'declareAttackers');
    // A sick creature can't attack: no attack option includes it.
    expect(moves(s).some((m) => m.type === 'declareAttackers' && m.assignments.some(([a]) => a === bb))).toBe(false);
  });

  it('crew window (PLAN.md D9): not in your main2; offered in the opponent declare attackers step', () => {
    const own = given({
      turn: 3, step: 'main2', active: 0,
      battlefield: [{ card: NAME, counters: { charge: 3 } }, TestBear.id, TestBear.id, 'Swamp', 'Swamp', B_STOP],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const bb = id1(own, NAME);
    expect(actsOf(own, bb, DRAW).length).toBe(1);
    expect(actsOf(own, bb, CREW).length).toBe(0);
    const opp = given({
      turn: 4, step: 'declareAttackers', active: 1,
      battlefield: [{ card: NAME }, TestBear.id, TestBear.id, B_STOP],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    pass(opp);
    expect(opp.priority).toBe(0);
    expect(actsOf(opp, id1(opp, NAME), CREW).length).toBe(1);
    // The opponent's main phase is not a crew window.
    const oppMain = given({
      turn: 4, step: 'main1', active: 1,
      battlefield: [{ card: NAME }, TestBear.id, TestBear.id, 'Mountain', B_STOP],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    pass(oppMain); // player 0 holds a Bolt, so the engine stops at player 0's priority
    expect(oppMain.priority).toBe(0);
    expect(oppMain.step).toBe('main1');
    expect(actsOf(oppMain, id1(oppMain, NAME), CREW).length).toBe(0);
  });

  it('scenario 3: a Bolt on a crewed Bankbuster marks 3 damage and it survives; a nonartifact-creature spell cannot target it', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: NAME }, TestBear.id, TestBear.id, B_STOP, { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id, TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const bb = id1(s, NAME);
    act(s, actsOf(s, bb, CREW)[0]!);
    // Player 1 responds after the crew resolves: pass once to resolve crew, then player 1 has priority.
    pass(s);
    expect(isType(s, bb, 'Creature')).toBe(true);
    const gftt = legalTargets(s, nonArtifactCreature, 1, bb).map((x) => (x.kind === 'obj' ? x.id : -1));
    expect(gftt).not.toContain(bb);
    expect(gftt.length).toBe(2);
    passUntil(s, (x) => x.priority === 1 && x.zones.stack.length === 0);
    act(s, castMove(s, 'Test Bolt', [O(bb)]));
    pass(s);
    expect(ids(s, NAME).length).toBe(1);
    expect(s.objects[bb]!.damage).toBe(3);
  });
});
