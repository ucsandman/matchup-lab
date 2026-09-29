// Liliana of the Veil: scenarios from docs/CARD-ANALYSIS.json plus -6 splits, attacks and the legend rule.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face } from '../../cards/dsl.js';
import { lilianaSplits } from '../../cards/defs/liliana-of-the-veil.js';
import { makeCtx } from '../../engine/ctx.js';
import { view } from '../../engine/view.js';
import { act, answer, castMove, moves, O, P, pass } from '../scenario.js';
import type { GameState, Move, ObjId } from '../../engine/types.js';

const NAME = 'Liliana of the Veil';
const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
/** Stand-in for Soul-Scar Mage (a second, different creature). */
const Mage = registerTestDef(card('Test Lili Mage', [face({ name: 'Test Lili Mage', types: ['Creature'], cost: '{R}', pt: [1, 2] })]));
const Ogre = registerTestDef(card('Test Lili Ogre', [face({ name: 'Test Lili Ogre', types: ['Creature'], cost: '{2}{R}{R}', pt: [5, 4] })]));

const actsOf = (s: GameState, id: ObjId): Extract<Move, { type: 'activate' }>[] =>
  moves(s).filter((m): m is Extract<Move, { type: 'activate' }> => m.type === 'activate' && m.objId === id);
const keyOf = (i: number): string => `liliana-of-the-veil:0:${i}`;
// Player 1 keeps a Bolt and a Mountain so the engine stops whenever player 1 has priority.
const B_STOP = { card: 'Mountain', controller: 1 as const };

describe('Liliana of the Veil', () => {
  it('scenario 1: cast, +1: loyalty 4; each player discards; the second chooser does not see the first pick (CR 101.4 (APNAP order))', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: ['Swamp', 'Swamp', 'Swamp', B_STOP],
      hands: [[NAME, TestBear.id], [TestBolt.id, 'Mountain']], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, NAME, []));
    pass(s); // player 1 lets Liliana resolve
    const lili = id1(s, NAME);
    // CR 306.5b (loyalty counters): she enters with her printed loyalty.
    expect(s.objects[lili]!.counters.loyalty).toBe(3);
    const plus = actsOf(s, lili).find((m) => m.abilityKey === keyOf(0));
    expect(plus).toBeDefined();
    act(s, plus!);
    expect(s.objects[lili]!.counters.loyalty).toBe(4);
    pass(s); // player 1 passes: the +1 resolves and asks the active player first
    expect(s.pendingChoice).toMatchObject({ kind: 'pickObjects', player: 0, reason: 'lilianaDiscard' });
    const bear = id1(s, TestBear.id, 'hand', 0);
    answer(s, { ids: [bear] });
    expect(s.pendingChoice).toMatchObject({ kind: 'pickObjects', player: 1, reason: 'lilianaDiscard' });
    // Hidden choice: nothing is discarded yet, and player 1's view carries no trace of the pick.
    expect(s.zones.hand[0]).toContain(bear);
    expect(s.zones.graveyard[0].length).toBe(0);
    const v1 = JSON.stringify(view(s, 1));
    expect(v1).not.toContain('"pending"');
    expect(v1).not.toContain(`"id":${bear}`);
    const mountain = id1(s, 'Mountain', 'hand', 1);
    answer(s, { ids: [mountain] });
    expect(ids(s, TestBear.id, 'graveyard', 0).length).toBe(1);
    expect(ids(s, 'Mountain', 'graveyard', 1).length).toBe(1);
    expect(ids(s, TestBolt.id, 'hand', 1).length).toBe(1);
    expect(s.objects[lili]!.counters.loyalty).toBe(4);
  });

  it('+1 with an empty hand: only the other player is asked', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: NAME, counters: { loyalty: 3 } }, B_STOP],
      hands: [[], [TestBolt.id, 'Mountain']], libraries: [lib(5), lib(5)],
    });
    act(s, actsOf(s, id1(s, NAME)).find((m) => m.abilityKey === keyOf(0))!);
    pass(s);
    expect(s.pendingChoice).toMatchObject({ kind: 'pickObjects', player: 1 });
  });

  it('scenario 2: -2 targeting the opponent: loyalty 1, they sacrifice the creature they pick; no second activation (CR 606.3 (loyalty ability))', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: NAME, counters: { loyalty: 3 } }, { card: TestBear.id, controller: 1 }, { card: Mage.id, controller: 1 }, B_STOP],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const lili = id1(s, NAME);
    const minus = actsOf(s, lili).filter((m) => m.abilityKey === keyOf(1));
    // Player targets collapse to the opponent (PLAN.md D9).
    expect(minus.map((m) => m.targets)).toEqual([[P(1)]]);
    act(s, minus[0]!);
    expect(s.objects[lili]!.counters.loyalty).toBe(1);
    pass(s);
    expect(s.pendingChoice).toMatchObject({ kind: 'pickObjects', player: 1, reason: 'lilianaEdict' });
    // The sacrificing player chooses; both creatures are offered.
    expect(moves(s).length).toBe(2);
    answer(s, { ids: [id1(s, Mage.id)] });
    expect(ids(s, Mage.id).length).toBe(0);
    expect(ids(s, Mage.id, 'graveyard', 1).length).toBe(1);
    expect(ids(s, TestBear.id).length).toBe(1);
    expect(actsOf(s, lili).length).toBe(0);
  });

  it('scenario 3: Bolt to Liliana at loyalty 2: she dies to the SBA and revolt is set (CR 704.5i (planeswalker loyalty 0))', () => {
    const s = given({
      turn: 4, step: 'main1', active: 1,
      battlefield: [{ card: NAME, counters: { loyalty: 2 } }, B_STOP, { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id, TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const lili = id1(s, NAME);
    act(s, castMove(s, 'Test Bolt', [O(lili)]));
    pass(s); // player 1 holds priority after casting; player 0 has nothing and auto-passes
    expect(ids(s, NAME).length).toBe(0);
    expect(ids(s, NAME, 'graveyard', 0).length).toBe(1);
    expect(s.turnFlags.permanentLeft[0]).toBe(true);
  });

  it('creatures may attack Liliana; combat damage removes loyalty (CR 120.3c (damage to a planeswalker))', () => {
    const s = given({
      turn: 4, step: 'main1', active: 1,
      battlefield: [{ card: NAME, counters: { loyalty: 4 } }, { card: TestBear.id, controller: 1 }, B_STOP],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const lili = id1(s, NAME);
    const bear = id1(s, TestBear.id);
    for (let i = 0; i < 20 && s.pendingChoice?.kind !== 'declareAttackers'; i++) pass(s);
    expect(s.pendingChoice?.kind).toBe('declareAttackers');
    const atk = moves(s).find((m) => m.type === 'declareAttackers' && m.assignments.some(([, d]) => d.kind === 'planeswalker'));
    expect(atk).toEqual({ type: 'declareAttackers', assignments: [[bear, { kind: 'planeswalker', id: lili }]] });
    act(s, atk!);
    for (let i = 0; i < 20 && s.step !== 'endCombat' && s.step !== 'main2'; i++) pass(s);
    expect(s.objects[lili]!.counters.loyalty).toBe(2);
    expect(s.players[0].life).toBe(20);
  });

  it('legend rule: a second Liliana leaves one on the battlefield (CR 704.5j (legend rule))', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: NAME, counters: { loyalty: 1 } }, 'Swamp', 'Swamp', 'Swamp', B_STOP],
      hands: [[NAME], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, NAME, []));
    pass(s);
    // The two copies differ (loyalty 1 vs 3), so the controller is asked which to keep.
    expect(s.pendingChoice).toMatchObject({ player: 0 });
    const newest = Math.max(...ids(s, NAME));
    const keepNew = moves(s).find((m) => m.type === 'choose' && (m.answer.ids ?? []).includes(newest));
    expect(keepNew).toBeDefined();
    act(s, keepNew!);
    expect(ids(s, NAME)).toEqual([newest]);
    expect(s.objects[newest]!.counters.loyalty).toBe(3);
    expect(ids(s, NAME, 'graveyard', 0).length).toBe(1);
  });

  it('-6: three heuristic splits (PLAN.md D9); the controller picks a split, the target player picks the pile to sacrifice', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [
        { card: NAME, counters: { loyalty: 6 } }, B_STOP, { card: 'Mountain', controller: 1 },
        { card: Ogre.id, controller: 1 }, { card: TestBear.id, controller: 1 }, { card: Mage.id, controller: 1 },
      ],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const lili = id1(s, NAME);
    const mts = ids(s, 'Mountain', 'battlefield', 1);
    const ogre = id1(s, Ogre.id);
    const bear = id1(s, TestBear.id);
    const mage = id1(s, Mage.id);
    const splits = lilianaSplits(makeCtx(s, lili, 0, keyOf(2)), s.zones.battlefield.filter((id) => s.objects[id]!.controller === 1));
    const norm = (sp: ObjId[][]): string => sp.map((p) => [...p].sort((a, b) => a - b).join(',')).sort().join('|');
    // Worth: Ogre 4+5=9, Bear 2+2=4, Mage 1+1=2, Mountains 1 each. Greedy: Ogre | Bear, Mage, M, M (9 vs 8).
    // That equals the best-threat split, so it is dropped as a duplicate: two distinct splits remain.
    expect(splits.map(norm)).toEqual([norm([mts, [ogre, bear, mage]]), norm([[ogre], [bear, mage, ...mts]])]);
    const ult = actsOf(s, lili).find((m) => m.abilityKey === keyOf(2));
    expect(ult?.targets).toEqual([P(1)]);
    act(s, ult!);
    expect(s.objects[lili]?.counters.loyalty ?? 0).toBe(0);
    pass(s);
    // Liliana at 0 loyalty is gone, but the ability resolves independently of its source (CR 113.7a (independent of its source)).
    expect(ids(s, NAME).length).toBe(0);
    expect(s.pendingChoice).toMatchObject({ kind: 'pickIndex', player: 0, reason: 'lilianaSplit', count: 2 });
    answer(s, { index: 1 }); // the Ogre alone vs the rest
    expect(s.pendingChoice).toMatchObject({ kind: 'pickIndex', player: 1, reason: 'lilianaPile', count: 2 });
    answer(s, { index: 0 }); // player 1 sacrifices the Ogre pile
    expect(ids(s, Ogre.id).length).toBe(0);
    expect(ids(s, Ogre.id, 'graveyard', 1).length).toBe(1);
    expect(ids(s, TestBear.id).length + ids(s, Mage.id).length + ids(s, 'Mountain', 'battlefield', 1).length).toBe(4);
  });

  it('-6 greedy split differs when values are spread (three distinct splits)', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [
        { card: NAME, counters: { loyalty: 6 } }, { card: Ogre.id, controller: 1 }, { card: Ogre.id, controller: 1 },
        { card: TestBear.id, controller: 1 }, { card: 'Mountain', controller: 1 },
      ],
    });
    const lili = id1(s, NAME);
    const splits = lilianaSplits(makeCtx(s, lili, 0, keyOf(2)), s.zones.battlefield.filter((id) => s.objects[id]!.controller === 1));
    console.log(`liliana -6 splits: ${splits.length} for ${s.zones.battlefield.length - 1} permanents`);
    // Lands vs nonlands; one Ogre alone; greedy: Ogre + Mountain (10) vs Ogre + Bear (13).
    expect(splits.length).toBe(3);
    for (const [a, b] of splits) expect((a ?? []).length + (b ?? []).length).toBe(4);
  });
});
