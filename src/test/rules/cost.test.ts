import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, spell, t } from '../../cards/dsl.js';
import {
  bargainCandidates, checkNonMana, collapseByClass, costString, discardCandidates, manaValueOf, parseMana, payNonMana,
  reduceGeneric, sacrificeCandidates, spellManaCost, spellDefOf,
} from '../../engine/cost.js';
import { createToken } from '../../engine/zones.js';
import { isType } from '../../engine/statics.js';
import type { CostSpec, FaceDef } from '../../engine/types.js';

const TestKicker = registerTestDef(card('Test Kicker', [face({
  name: 'Test Kicker', types: ['Instant'], cost: '{R}',
  abilities: [spell({ target: t.any(), kicker: '{4}', resolve: () => {} })],
})]));

describe('mana costs', () => {
  it('parses costs and computes mana value (CR 202.3 (mana value))', () => {
    expect(parseMana('{2}{B}{B}')).toMatchObject({ generic: 2, B: 2, R: 0 });
    expect(manaValueOf(parseMana('{2}{B}{B}'))).toBe(4);
    expect(manaValueOf(parseMana(null))).toBe(0);
    expect(costString(parseMana('{1}{B}{R}'))).toBe('{1}{B}{R}');
    expect(() => parseMana('{X}{R}')).toThrow();
    expect(() => parseMana('{B/R}')).toThrow();
  });

  it('generic reductions never touch colored mana (CR 118.7a (reduce generic))', () => {
    expect(reduceGeneric(parseMana('{3}{R}'), 1)).toMatchObject({ generic: 2, R: 1 });
    expect(reduceGeneric(parseMana('{1}{R}'), 5)).toMatchObject({ generic: 0, R: 1 });
  });

  it('kicker adds to the total cost (CR 702.33a (kicker))', () => {
    const f = TestKicker.faces[0] as FaceDef;
    expect(costString(spellManaCost(f, spellDefOf(f), { kicked: true }))).toBe('{4}{R}');
    expect(costString(spellManaCost(f, spellDefOf(f)))).toBe('{R}');
    const bolt = TestBolt.faces[0] as FaceDef;
    expect(() => spellManaCost(bolt, spellDefOf(bolt), { kicked: true })).toThrow();
  });
});

describe('non-mana costs', () => {
  it('tap: a tapped source or a summoning-sick creature cannot pay {T} (CR 302.6 (summoning sickness))', () => {
    const s = given({ battlefield: [{ card: TestBear.id, sick: true }, { card: TestBear.id, tapped: true }, TestBear.id] });
    const [sick, tapped, ready] = s.zones.battlefield as [number, number, number];
    expect(checkNonMana(s, 0, sick, { tap: true })).toBe('summoning sick');
    expect(checkNonMana(s, 0, tapped, { tap: true })).toBe('tapped');
    expect(checkNonMana(s, 0, ready, { tap: true })).toBeNull();
  });

  it('life: payable when life equals the cost, not below it (CR 119.4 (pay life))', () => {
    const s = given({ battlefield: [TestBear.id], life: [3, 20] });
    const src = id1(s, TestBear.id);
    expect(checkNonMana(s, 0, src, { life: 3 })).toBeNull();
    expect(checkNonMana(s, 0, src, { life: 4 })).toBe('not enough life');
    payNonMana(s, 0, src, { life: 3 });
    expect(s.players[0].life).toBe(0);
  });

  it('discard as a cost needs the exact count from the payer\'s hand, never the source itself', () => {
    const s = given({ battlefield: [TestBear.id], hands: [['Swamp', 'Swamp', TestBolt.id], []] });
    const src = id1(s, TestBear.id);
    const cost: CostSpec = { discard: 1 };
    expect(checkNonMana(s, 0, src, cost, {})).toBe('wrong discard count');
    const card0 = s.zones.hand[0][0] as number;
    expect(checkNonMana(s, 0, src, cost, { discard: [card0] })).toBeNull();
    payNonMana(s, 0, src, cost, { discard: [card0] });
    expect(s.zones.graveyard[0].length).toBe(1);
    // Collapsed by name: two Swamps and a Bolt give two discard options.
    const s2 = given({ hands: [['Swamp', 'Swamp', TestBolt.id], []] });
    expect(discardCandidates(s2, 0).length).toBe(2);
  });

  it('sacrifice-another costs exclude the source; sacrifice goes through the die choke point', () => {
    const s = given({ battlefield: [TestBear.id, TestBear.id, 'Swamp'] });
    const [src, other] = s.zones.battlefield as [number, number];
    const cost: CostSpec = { sacrifice: { count: 1, another: true, filter: (st, id) => isType(st, id, 'Creature') } };
    expect(sacrificeCandidates(s, 0, cost, src)).toEqual([other]);
    expect(checkNonMana(s, 0, src, cost, { sacrifice: [src] })).toBe('bad sacrifice');
    payNonMana(s, 0, src, cost, { sacrifice: [other] });
    expect(s.zones.graveyard[0].length).toBe(1);
    expect(s.turnFlags.permanentLeft[0]).toBe(true);
  });

  it('tap plus sacrifice-self (Blood, Treasure style) and remove-counter costs', () => {
    const s = given({ battlefield: [{ card: TestBear.id, counters: { charge: 1 } }] });
    const src = id1(s, TestBear.id);
    expect(checkNonMana(s, 0, src, { removeCounter: { type: 'charge', n: 2 } })).toBe('not enough counters');
    payNonMana(s, 0, src, { removeCounter: { type: 'charge', n: 1 }, tap: true, sacrificeSelf: true });
    expect(ids(s, TestBear.id).length).toBe(0);
    expect(ids(s, TestBear.id, 'graveyard')[0]).toBeDefined();
  });

  it('bargain candidates are artifacts, enchantments and tokens (CR 702.166a (bargain))', () => {
    const s = given({ battlefield: [TestBear.id, 'Swamp'] });
    const blood = createToken(s, 'Blood', 0);
    const goblin = createToken(s, 'GoblinShaman', 0);
    createToken(s, 'Zombie', 1);
    expect(bargainCandidates(s, 0).sort((a, b) => a - b)).toEqual([blood, goblin]);
  });

  it('identical tokens collapse to one choice', () => {
    const s = given();
    const a = createToken(s, 'Treasure', 0);
    createToken(s, 'Treasure', 0);
    const b = createToken(s, 'Blood', 0);
    expect(collapseByClass(s, bargainCandidates(s, 0))).toEqual([a, b]);
  });
});
