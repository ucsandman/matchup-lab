// Unlicensed Hearse: scenarios from docs/CARD-ANALYSIS.json plus the single-graveyard target rule.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, TestBear, TestBolt } from '../helpers.js';
import { characteristics, isType } from '../../engine/statics.js';
import { applyMoveInPlace } from '../../engine/apply.js';
import { setField } from '../../engine/mutate.js';
import { moveObject } from '../../engine/zones.js';
import { act, castMove, moves, O, P, pass } from '../scenario.js';
import type { GameState, Move, ObjId } from '../../engine/types.js';

const NAME = 'Unlicensed Hearse';
const TAP = 'unlicensed-hearse:0:0';
const CREW = 'unlicensed-hearse:0:2';
const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
// Player 1 keeps a Bolt and a Mountain so the engine stops whenever player 1 has priority.
const B_STOP = { card: 'Mountain', controller: 1 as const };

const actsOf = (s: GameState, id: ObjId, key: string): Extract<Move, { type: 'activate' }>[] =>
  moves(s).filter((m): m is Extract<Move, { type: 'activate' }> => m.type === 'activate' && m.objId === id && m.abilityKey === key);
const pt = (s: GameState, id: ObjId): [number, number] => [characteristics(s, id).power, characteristics(s, id).toughness];
function passUntil(s: GameState, pred: (s: GameState) => boolean, max = 60): void {
  for (let i = 0; i < max && !pred(s); i++) pass(s);
  expect(pred(s)).toBe(true);
}

describe('Unlicensed Hearse', () => {
  it('scenario 1: cast (0/0, not a creature), tap the same turn to exile two cards from the opponent graveyard; next turn crew 2 and attack as a 2/2', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: ['Swamp', 'Swamp', B_STOP],
      hands: [[NAME], [TestBolt.id]], libraries: [lib(5), lib(5)],
      graveyards: [[TestBear.id], [TestBolt.id, 'Mountain']],
    });
    act(s, castMove(s, NAME, []));
    pass(s);
    const h = id1(s, NAME);
    // Not a creature, so a 0/0 Hearse does not die (CR 704.5f (toughness 0) applies to creatures only).
    expect(isType(s, h, 'Creature')).toBe(false);
    expect(pt(s, h)).toEqual([0, 0]);
    const oppCards = [...s.zones.graveyard[1]].sort((a, b) => a - b);
    const both = actsOf(s, h, TAP).find((m) => m.targets.length === 2 && m.targets.every((x) => x.kind === 'obj' && oppCards.includes(x.id)));
    // CR 302.6 (summoning sickness): only a creature needs haste for {T}; this one entered this turn.
    expect(both).toBeDefined();
    act(s, both!);
    pass(s);
    expect(s.zones.graveyard[1].length).toBe(0);
    expect(s.zones.exile[1].length).toBe(2);
    expect(s.objects[h]!.exiledWith).toBe(2);
    expect(pt(s, h)).toEqual([2, 2]);

    // Next turn: crew 2 with a 2/2 and attack.
    const n = given({
      turn: 5, step: 'main1', active: 0,
      battlefield: [{ card: NAME }, TestBear.id, B_STOP],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const h2 = id1(n, NAME);
    setField(n, h2, 'exiledWith', 2);
    const crews = actsOf(n, h2, CREW);
    expect(crews.map((m) => m.crewWith)).toEqual([[id1(n, TestBear.id)]]);
    act(n, crews[0]!);
    pass(n);
    expect(isType(n, h2, 'Creature')).toBe(true);
    expect(pt(n, h2)).toEqual([2, 2]);
    passUntil(n, (x) => x.pendingChoice?.kind === 'declareAttackers');
    const atk: Move = { type: 'declareAttackers', assignments: [[h2, P(1) as { kind: 'player'; p: 1 }]] };
    expect(moves(n)).toContainEqual(atk);
    act(n, atk);
    passUntil(n, (x) => x.step === 'endCombat' || x.step === 'main2');
    expect(n.players[1].life).toBe(18);
  });

  it('scenario 2: crewed the turn it entered it is a creature: it cannot attack and cannot use {T} (CR 302.6 (summoning sickness))', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: NAME, sick: true }, TestBear.id, B_STOP],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
      graveyards: [[], [TestBolt.id]],
    });
    const h = id1(s, NAME);
    setField(s, h, 'exiledWith', 2);
    expect(actsOf(s, h, TAP).length).toBeGreaterThan(0);
    act(s, actsOf(s, h, CREW)[0]!);
    pass(s);
    expect(isType(s, h, 'Creature')).toBe(true);
    expect(actsOf(s, h, TAP).length).toBe(0);
    passUntil(s, (x) => x.pendingChoice?.kind === 'declareAttackers');
    expect(moves(s).some((m) => m.type === 'declareAttackers' && m.assignments.some(([a]) => a === h))).toBe(false);
  });

  it('scenario 3: a crewed 3/3 Hearse dies to 3 damage; the card in the graveyard is a new object and is 0/0 again (CR 400.7 (new object))', () => {
    const s = given({
      turn: 4, step: 'main1', active: 1,
      battlefield: [{ card: NAME }, TestBear.id, B_STOP, { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id, TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const h = id1(s, NAME);
    setField(s, h, 'exiledWith', 3);
    setField(s, h, 'animated', { types: ['Creature'] });
    setField(s, h, 'crewed', true);
    expect(pt(s, h)).toEqual([3, 3]);
    act(s, castMove(s, 'Test Bolt', [O(h)]));
    pass(s);
    expect(ids(s, NAME).length).toBe(0);
    const g = id1(s, NAME, 'graveyard', 0);
    expect(g).not.toBe(h);
    expect(s.objects[g]!.exiledWith).toBeUndefined();
    // CR 604.3 (characteristic-defining abilities): the CDA works in every zone; nothing is exiled with this object.
    expect(pt(s, g)).toEqual([0, 0]);
  });

  it('targets come from a single graveyard (CR 601.2c (targets)); up to two, zero allowed', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: NAME }, B_STOP],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
      graveyards: [[TestBear.id, 'Swamp'], [TestBolt.id, 'Mountain']],
    });
    const h = id1(s, NAME);
    const tapMoves = actsOf(s, h, TAP);
    const owners = (m: Extract<Move, { type: 'activate' }>): Set<number> =>
      new Set(m.targets.map((x) => (x.kind === 'obj' ? s.objects[x.id]!.owner : -1)));
    console.log(`hearse target tuples: ${tapMoves.length}`);
    // Empty, 2 singles + 1 pair from the own graveyard, and count-only from the opponent's
    // (PLAN.md D9: one single, one pair): 1 + 3 + 2.
    expect(tapMoves.length).toBe(6);
    expect(tapMoves.every((m) => owners(m).size <= 1)).toBe(true);
    expect(tapMoves.filter((m) => m.targets.length === 0).length).toBe(1);
    // A mixed pair is rejected by the activation itself.
    const mixed: Move = { type: 'activate', objId: h, abilityKey: TAP, targets: [O(s.zones.graveyard[0][0]!), O(s.zones.graveyard[1][0]!)] };
    expect(() => applyMoveInPlace(s, mixed)).toThrow(/illegal target/);
  });

  it('count-only collapse of the opponent graveyard (PLAN.md D9): one move per size, own graveyard listed in full', () => {
    const opp = ['Mountain', TestBolt.id, TestBear.id, 'Swamp', 'Unlicensed Hearse'];
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: NAME }, B_STOP],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
      graveyards: [[TestBear.id, 'Swamp', 'Mountain'], opp],
    });
    const h = id1(s, NAME);
    const tapMoves = actsOf(s, h, TAP);
    const ownerOf = (m: Extract<Move, { type: 'activate' }>): number =>
      m.targets.length === 0 ? -1 : s.objects[(m.targets[0] as { kind: 'obj'; id: ObjId }).id]!.owner;
    const fromOpp = tapMoves.filter((m) => ownerOf(m) === 1);
    const fromOwn = tapMoves.filter((m) => ownerOf(m) === 0);
    console.log(`hearse count-only: ${fromOpp.length} opponent tuples, ${fromOwn.length} own tuples (${tapMoves.length} total)`);
    // Five distinct cards in the opponent graveyard would be 5 singles + 10 pairs uncollapsed.
    expect(fromOpp.map((m) => m.targets.length).sort()).toEqual([1, 2]);
    // Own graveyard (three distinct cards): 3 singles + 3 pairs, uncollapsed.
    expect(fromOwn.length).toBe(6);
    expect(tapMoves.filter((m) => m.targets.length === 0).length).toBe(1);
    // Legality is unchanged: any single-graveyard pair is still accepted by applyMove.
    const [, c, , d] = [...s.zones.graveyard[1]] as ObjId[];
    applyMoveInPlace(s, { type: 'activate', objId: h, abilityKey: TAP, targets: [O(c!), O(d!)] });
    pass(s);
    expect(s.objects[h]!.exiledWith).toBe(2);
  });

  it('partial fizzle: a target that left the graveyard is skipped; only the card actually exiled counts (CR 608.2b (illegal targets))', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: NAME }, B_STOP],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
      graveyards: [[], [TestBolt.id, 'Mountain']],
    });
    const h = id1(s, NAME);
    const [a, b] = [...s.zones.graveyard[1]] as [ObjId, ObjId];
    act(s, { type: 'activate', objId: h, abilityKey: TAP, targets: [O(a), O(b)] });
    // Before it resolves, one target leaves the graveyard (as if another effect exiled it).
    moveObject(s, a, 'exile');
    pass(s);
    expect(s.objects[h]!.exiledWith).toBe(1);
    expect(pt(s, h)).toEqual([1, 1]);
    expect(s.zones.graveyard[1].length).toBe(0);
  });
});
