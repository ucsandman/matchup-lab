// Payment solver collapsing rules (PLAN.md section 6), one test per rule, plus mana abilities.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear } from '../helpers.js';
import { act, card, land, mana, stat } from '../../cards/dsl.js';
import { activateManaAbility, emptyPool, manaSources, payMana, solvePayment } from '../../engine/mana.js';
import { parseMana } from '../../engine/cost.js';
import { addPoolEntry, setField } from '../../engine/mutate.js';
import { createToken } from '../../engine/zones.js';
import type { GameState, ObjId } from '../../engine/types.js';

const TestCrypt = registerTestDef(card('Test Crypt', [land({ name: 'Test Crypt', subtypes: ['Swamp', 'Mountain'] })]));
const TestRuins = registerTestDef(card('Test Ruins', [land({
  name: 'Test Ruins', mana: [mana({ produce: ['C'] }), mana({ produce: ['R'], cost: { tap: true, life: 1 } })],
})]));
const TestRockface = registerTestDef(card('Test Rockface', [land({
  name: 'Test Rockface', mana: [mana({ produce: ['C'] }), mana({ produce: ['R'], restriction: 'creatureSpell' })],
})]));
const TestVerge = registerTestDef(card('Test Verge', [land({
  name: 'Test Verge',
  mana: [mana({ produce: ['B'] }), mana({ produce: ['R'], condition: (ctx) => ctx.controlsLandType(ctx.controller, ['Swamp', 'Mountain']) })],
})]));
const TestUrborg2 = registerTestDef(card('Test Urborg Two', [land({ name: 'Test Urborg Two', abilities: [stat({ category: 'allLandsAreSwamps' })] })]));
const TestCastle = registerTestDef(card('Test Castle', [land({
  name: 'Test Castle', mana: [mana({ produce: ['B'] })],
  abilities: [act({ cost: { mana: '{1}{B}{B}', tap: true }, resolve: (ctx) => ctx.draw(ctx.controller) })],
})]));

const NONCREATURE = { creatureSpell: false };
const CREATURE = { creatureSpell: true };
const tapped = (s: GameState, plan: { taps: { objId: ObjId }[] }): string[] => plan.taps.map((t) => s.objects[t.objId]!.defId).sort();

describe('payment solver collapsing rules', () => {
  it('identical untapped lands collapse to one payment', () => {
    const s = given({ battlefield: ['Swamp', 'Swamp', 'Swamp'] });
    const plans = solvePayment(s, 0, parseMana('{B}'), NONCREATURE);
    expect(plans.length).toBe(1);
  });

  it('basics before duals: paying {B} taps the Swamp and keeps the dual (dual residual dominates)', () => {
    const s = given({ battlefield: [TestCrypt.id, 'Swamp'] });
    const plans = solvePayment(s, 0, parseMana('{B}'), NONCREATURE);
    expect(plans.length).toBe(1);
    expect(tapped(s, plans[0]!)).toEqual(['swamp']);
  });

  it('an alternative exists only when the residual differs: leaving B vs R open', () => {
    const s = given({ battlefield: ['Swamp', 'Mountain', TestCrypt.id] });
    const plans = solvePayment(s, 0, parseMana('{1}'), NONCREATURE);
    // Tapping the dual is dominated (it leaves only Swamp + Mountain); tapping Swamp leaves B/R + R,
    // tapping Mountain leaves B/R + B. Two futures, two payments.
    expect(plans.map((p) => tapped(s, p))).toEqual(expect.arrayContaining([['swamp'], ['mountain']]));
    expect(plans.length).toBe(2);
    expect(new Set(plans.map((p) => p.residualKey)).size).toBe(2);
  });

  it('costless before life-costed: Mountain first, the 1-life red kept as an alternative', () => {
    const s = given({ battlefield: [TestRuins.id, 'Mountain'] });
    const plans = solvePayment(s, 0, parseMana('{R}'), NONCREATURE);
    expect(plans[0]!.life).toBe(0);
    expect(tapped(s, plans[0]!)).toEqual(['mountain']);
    expect(plans.length).toBe(2);
    expect(plans[1]!.life).toBe(1);
    // Generic from the same land uses its free colorless ability.
    const s2 = given({ battlefield: [TestRuins.id] });
    const g = solvePayment(s2, 0, parseMana('{1}'), NONCREATURE);
    expect(g.length).toBe(1);
    expect(g[0]!.life).toBe(0);
    expect(g[0]!.taps[0]!.key).toBe(`${TestRuins.id}:0:0`);
  });

  it('life costs need enough life (CR 119.4 (pay life))', () => {
    const s = given({ battlefield: [TestRuins.id], life: [0, 20] });
    expect(solvePayment(s, 0, parseMana('{R}'), NONCREATURE)).toEqual([]);
    const s1 = given({ battlefield: [TestRuins.id], life: [1, 20] });
    expect(solvePayment(s1, 0, parseMana('{R}'), NONCREATURE).length).toBe(1);
  });

  it('lands before Treasure; the Treasure line stays as an alternative (it changes revolt)', () => {
    const s = given({ battlefield: ['Swamp'] });
    createToken(s, 'Treasure', 0);
    const plans = solvePayment(s, 0, parseMana('{B}'), NONCREATURE);
    expect(tapped(s, plans[0]!)).toEqual(['swamp']);
    expect(plans[0]!.sacrifices).toBe(0);
    expect(plans.length).toBe(2);
    expect(plans[1]!.sacrifices).toBe(1);
  });

  it('restricted mana: unusable for a noncreature spell, spent first on a creature spell', () => {
    const s = given({ battlefield: [TestRockface.id, 'Mountain'] });
    const non = solvePayment(s, 0, parseMana('{R}'), NONCREATURE);
    expect(non.length).toBe(1);
    expect(tapped(s, non[0]!)).toEqual(['mountain']);
    const cre = solvePayment(s, 0, parseMana('{R}'), CREATURE);
    expect(cre[0]!.taps[0]).toMatchObject({ key: `${TestRockface.id}:0:1`, color: 'R' });
    expect(cre.length).toBe(2);
  });

  it('conditional mana (Verge): red only with a Swamp or Mountain; Urborg makes the Verge its own Swamp', () => {
    const alone = given({ battlefield: [TestVerge.id] });
    expect(solvePayment(alone, 0, parseMana('{R}'), NONCREATURE)).toEqual([]);
    expect(solvePayment(alone, 0, parseMana('{B}'), NONCREATURE).length).toBe(1);
    const withSwamp = given({ battlefield: [TestVerge.id, 'Swamp'] });
    expect(solvePayment(withSwamp, 0, parseMana('{R}'), NONCREATURE).length).toBe(1);
    const withUrborg = given({ battlefield: [TestVerge.id, TestUrborg2.id] });
    expect(solvePayment(withUrborg, 0, parseMana('{R}'), NONCREATURE).length).toBe(1);
  });

  it('a land with a non-mana ability is covered only by the same card; it covers a plain basic', () => {
    const s = given({ battlefield: [TestCastle.id, 'Swamp'] });
    const plans = solvePayment(s, 0, parseMana('{B}'), NONCREATURE);
    expect(tapped(s, plans[0]!)).toEqual(['swamp']);
    expect(plans.length).toBe(1); // Castle covers Swamp (same mana, extra ability): keeping Castle dominates
    const s2 = given({ battlefield: [TestCastle.id, TestCrypt.id] });
    // Castle (B + draw ability) vs Crypt (B or R): neither covers the other.
    expect(solvePayment(s2, 0, parseMana('{B}'), NONCREATURE).length).toBe(2);
  });

  it('pool mana is spent before tapping a land', () => {
    const s = given({ battlefield: ['Swamp'] });
    addPoolEntry(s, 0, { color: 'B' });
    const plans = solvePayment(s, 0, parseMana('{B}'), NONCREATURE);
    expect(plans.length).toBe(1);
    expect(plans[0]).toMatchObject({ pool: [0], taps: [] });
  });

  it('colored pips need their color; impossible costs give no plan', () => {
    const s = given({ battlefield: ['Swamp', 'Swamp'] });
    expect(solvePayment(s, 0, parseMana('{R}'), NONCREATURE)).toEqual([]);
    expect(solvePayment(s, 0, parseMana('{2}{B}'), NONCREATURE)).toEqual([]);
    expect(solvePayment(s, 0, parseMana('{1}{B}'), NONCREATURE).length).toBe(1);
  });
});

describe('mana abilities and pools', () => {
  it('payMana taps, pays life, sacrifices Treasure and leaves the pool empty', () => {
    const s = given({ battlefield: [TestRuins.id, 'Swamp'] });
    createToken(s, 'Treasure', 0);
    const cost = parseMana('{R}{B}{G}');
    const plans = solvePayment(s, 0, cost, NONCREATURE);
    const plan = plans.find((p) => p.life === 1 && p.sacrifices === 1);
    expect(plan).toBeDefined();
    payMana(s, 0, cost, plan!, NONCREATURE);
    expect(s.players[0].manaPool).toEqual([]);
    expect(s.players[0].life).toBe(19);
    expect(ids(s, 'token-treasure').length).toBe(0);
    expect(s.turnFlags.permanentLeft[0]).toBe(true);
    expect(s.zones.battlefield.every((id) => s.objects[id]!.tapped)).toBe(true);
  });

  it('mana abilities resolve immediately (CR 605.3b (mana ability doesn\'t use the stack))', () => {
    const s = given({ battlefield: [TestCrypt.id] });
    const crypt = id1(s, TestCrypt.id);
    activateManaAbility(s, 0, crypt, 'basic:R', 'R');
    expect(s.players[0].manaPool).toEqual([{ color: 'R' }]);
    expect(s.zones.stack).toEqual([]);
    expect(() => activateManaAbility(s, 0, crypt, 'basic:B', 'B')).toThrow();
  });

  it('a summoning-sick creature land cannot tap for mana (CR 302.6 (summoning sickness))', () => {
    const s = given({ battlefield: [{ card: 'Swamp', sick: true }] });
    const sw = id1(s, 'Swamp');
    expect(manaSources(s, 0).length).toBe(1); // a land that is not a creature ignores sickness
    setField(s, sw, 'animated', { types: ['Creature'], pt: [2, 2] });
    expect(manaSources(s, 0).length).toBe(0);
  });

  it('pools empty at end of step except firebending mana, which lasts until end of combat', () => {
    const s = given({ battlefield: [TestBear.id] });
    addPoolEntry(s, 0, { color: 'R' });
    addPoolEntry(s, 0, { color: 'R', expires: 'endOfCombat' });
    // CR 106.4 (mana pool empties)
    emptyPool(s, 0, 'step');
    expect(s.players[0].manaPool).toEqual([{ color: 'R', expires: 'endOfCombat' }]);
    emptyPool(s, 0, 'endOfCombat');
    expect(s.players[0].manaPool).toEqual([]);
  });
});
