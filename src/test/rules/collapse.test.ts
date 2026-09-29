// Move-generator collapsing rules (PLAN.md section 6), each with its count printed, plus the
// applyMove loop cap and the fuzz invariant checkers seen failing on broken states.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, land, mana, trig } from '../../cards/dsl.js';
import { createToken } from '../../engine/zones.js';
import { gainLife } from '../../engine/life.js';
import { legalMoves } from '../../engine/moves.js';
import { advance, LOOP_CAP } from '../../engine/apply.js';
import { checkInvariants, checkViewLeak } from '../../tools/play.js';
import { moves } from '../scenario.js';
import type { Move } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const TestDual = registerTestDef(card('Test Cl Dual', [land({ name: 'Test Cl Dual', mana: [mana({ produce: ['B', 'R'] })] })]));
const Echo = registerTestDef(card('Test Cl Echo', [face({
  name: 'Test Cl Echo', types: ['Enchantment'], cost: '{1}',
  abilities: [trig('lifeGain', { scope: 'any' }, (ctx) => { ctx.gainLife(ctx.controller, 1); })],
})]));
const TwoDrop = registerTestDef(card('Test Cl Two', [face({ name: 'Test Cl Two', types: ['Creature'], cost: '{1}{B}', pt: [2, 1] })]));
const OneGeneric = registerTestDef(card('Test Cl One', [face({ name: 'Test Cl One', types: ['Artifact'], cost: '{1}' })]));

const of = <T extends Move['type']>(ms: Move[], type: T): Extract<Move, { type: T }>[] => ms.filter((m): m is Extract<Move, { type: T }> => m.type === type);

describe('collapsing rules', () => {
  it('identical lands in hand are one land play', () => {
    const s = given({ turn: 1, step: 'main1', hands: [['Mountain', 'Mountain', 'Mountain', 'Swamp'], []], libraries: [lib(5), lib(5)] });
    const plays = of(legalMoves(s, 0), 'playLand');
    console.log(`collapse lands: 4 cards in hand -> ${plays.length} land moves`);
    expect(plays.length).toBe(2);
  });

  it('identical tokens are one activation', () => {
    const s = given({ turn: 1, step: 'main1', battlefield: ['Mountain'], hands: [[TestBear.id, TestBear.id], []], libraries: [lib(5), lib(5)] });
    createToken(s, 'Blood', 0);
    createToken(s, 'Blood', 0);
    createToken(s, 'Blood', 0);
    const acts = of(legalMoves(s, 0), 'activate');
    // Three identical Blood tokens and two identical discard choices: one move.
    console.log(`collapse tokens: 3 Blood x 2 identical discards -> ${acts.length} activations`);
    expect(acts.length).toBe(1);
  });

  it('discard and pick choices collapse by name', () => {
    const s = given({ turn: 1, step: 'cleanup', hands: [[TestBear.id, TestBear.id, TestBear.id, TestBolt.id, TestBolt.id, 'Mountain', 'Mountain', 'Swamp', 'Swamp'], []], libraries: [lib(5), lib(5)] });
    s.pendingChoice = { kind: 'pickObjects', player: 0, reason: 'cleanupDiscard', from: [...s.zones.hand[0]], min: 2, max: 2 };
    const answers = of(legalMoves(s, 0), 'choose');
    // Multisets of size 2 over 4 names with multiplicities 3,2,2,2: 4 pairs of equal names + 6 mixed = 10 (not C(9,2)=36).
    console.log(`collapse discards: 9 cards, choose 2 -> ${answers.length} answers`);
    expect(answers.length).toBe(10);
  });

  it('payment alternatives: one move unless the leftover sources differ', () => {
    // Swamp + dual: paying {B} with the Swamp leaves the dual, which covers everything: one plan.
    const s = given({ turn: 1, step: 'main1', battlefield: ['Swamp', TestDual.id], hands: [[TwoDrop.id], []], libraries: [lib(5), lib(5)] });
    expect(of(legalMoves(s, 0), 'cast').length).toBe(1);
    // Mountain + Swamp paying {1}: leaving R or leaving B are different futures: two moves.
    const s2 = given({ turn: 1, step: 'main1', battlefield: ['Swamp', 'Mountain'], hands: [[OneGeneric.id], []], libraries: [lib(5), lib(5)] });
    const casts = of(legalMoves(s2, 0), 'cast');
    console.log(`collapse payments: Swamp+Mountain for {1} -> ${casts.length} moves`);
    expect(casts.map((m) => m.payment ?? 0)).toEqual([0, 1]);
    // Two identical Mountains paying {1}: one move.
    const s3 = given({ turn: 1, step: 'main1', battlefield: ['Mountain', 'Mountain'], hands: [[OneGeneric.id], []], libraries: [lib(5), lib(5)] });
    expect(of(legalMoves(s3, 0), 'cast').length).toBe(1);
  });

  it('player targets collapse to the opponent; identical creatures to one target', () => {
    const s = given({
      turn: 1, step: 'main1',
      battlefield: ['Mountain', { card: TestBear.id, controller: 1 }, { card: TestBear.id, controller: 1 }, TestBear.id],
      hands: [[TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const casts = of(legalMoves(s, 0), 'cast');
    // Targets: player 1, one of player 1's two identical Bears, player 0's Bear. Never player 0.
    console.log(`collapse targets: 2 players + 3 bears -> ${casts.length} Bolt moves`);
    expect(casts.length).toBe(3);
    expect(casts.some((m) => m.targets[0]!.kind === 'player' && m.targets[0]!.p === 0)).toBe(false);
    expect(ids(s, TestBear.id).length).toBe(3);
  });

  it(`applyMove's internal loop cap (${LOOP_CAP}) turns an endless trigger chain into an error`, () => {
    const s = given({ turn: 1, step: 'main1', battlefield: [Echo.id], libraries: [lib(5), lib(5)] });
    gainLife(s, 0, 1);
    expect(() => advance(s)).toThrow(/loop cap/);
    expect(id1(s, Echo.id)).toBeGreaterThan(0);
  });

  it('the fuzz invariant checkers fail on broken states (L1: seen failing)', () => {
    const s = given({ turn: 1, step: 'main1', battlefield: ['Mountain'], hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)] });
    expect(() => checkInvariants(s, [7, 6])).not.toThrow();
    const dup = structuredClone(s);
    dup.zones.graveyard[0].push(dup.zones.hand[0][0]!);
    expect(() => checkInvariants(dup, [7, 6])).toThrow(/inv2/);
    expect(() => checkInvariants(s, [8, 6])).toThrow(/inv1/);
    const tapped = structuredClone(s);
    tapped.objects[tapped.zones.hand[0][0]!]!.tapped = true;
    expect(() => checkInvariants(tapped, [7, 6])).toThrow(/inv3/);
    // A Choice for player 0 listing player 1's hidden hand card would leak it.
    expect(checkViewLeak(s, 0)).toBeGreaterThan(0);
    const leak = structuredClone(s);
    leak.pendingChoice = { kind: 'pickObjects', player: 0, reason: 'test', from: [...leak.zones.hand[1]], min: 1, max: 1 };
    expect(() => checkViewLeak(leak, 0)).toThrow(/inv8/);
    expect(moves(s).length).toBeGreaterThan(0);
  });
});
