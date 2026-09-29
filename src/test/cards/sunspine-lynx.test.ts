// Sunspine Lynx scenarios (docs/CARD-ANALYSIS.json). Player 0 is B (mono-red), player 1 is A.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { given, id1, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, land, mana, trig } from '../../cards/dsl.js';
import { characteristics } from '../../engine/statics.js';
import { gainLife } from '../../engine/life.js';
import { act, castMove, pass } from '../scenario.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const LYNX = 'Sunspine Lynx';

/** A nonbasic land that taps for R (Mutavault, Blood Crypt and friends stand-in). */
const Dual = registerTestDef(card('Test Lx Dual', [land({ name: 'Test Lx Dual', mana: [mana({ produce: ['B', 'R'] })] })]));
/** Sheoldred stand-in: whenever you draw a card, you gain 2 life. */
const Healer = registerTestDef(card('Test Lx Healer', [face({
  name: 'Test Lx Healer', types: ['Creature'], cost: '{2}{B}{B}', pt: [4, 5],
  abilities: [trig('draw', { scope: 'you' }, (ctx) => { ctx.gainLife(ctx.controller, 2); })],
})]));
/** Gifted Aetherborn stand-in: 2/3 deathtouch lifelink. */
const Leech = registerTestDef(card('Test Lx Leech', [face({
  name: 'Test Lx Leech', types: ['Creature'], cost: '{B}{B}', pt: [2, 3], keywords: ['deathtouch', 'lifelink'],
})]));

function aBoard(nonbasics: number, basics: number): Array<{ card: string; controller: 1 }> {
  return [
    ...Array.from({ length: nonbasics }, () => ({ card: Dual.id, controller: 1 as const })),
    ...Array.from({ length: basics }, () => ({ card: 'Swamp', controller: 1 as const })),
  ];
}

describe('Sunspine Lynx', () => {
  it('def matches oracle: {2}{R}{R} 5/4 Elemental Cat', () => {
    const s = given({ battlefield: [LYNX] });
    const c = characteristics(s, id1(s, LYNX));
    expect([c.power, c.toughness, c.manaValue]).toEqual([5, 4, 4]);
    expect(c.subtypes).toEqual(['Elemental', 'Cat']);
  });

  it('scenario 1: ETB deals each player damage equal to the nonbasic lands they control: A 3, B 1', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: ['Mountain', 'Mountain', 'Mountain', Dual.id, ...aBoard(3, 1)],
      hands: [[LYNX], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, LYNX));
    while (s.zones.stack.length > 0) pass(s);
    expect(id1(s, LYNX)).toBeGreaterThan(0);
    expect(s.players[1].life).toBe(17);
    expect(s.players[0].life).toBe(19);
  });

  it('scenario 2: with Lynx out, a draw trigger and lifelink gain nothing; the damage is still dealt (CR 119.7 (can\'t gain life), CR 702.15b (lifelink))', () => {
    // A (player 1) is active and draws for the turn with the Healer out.
    const s = given({
      turn: 4, step: 'upkeep', active: 1,
      battlefield: [LYNX, { card: Healer.id, controller: 1 }, { card: Leech.id, controller: 1 }, 'Mountain'],
      hands: [[TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const leech = id1(s, Leech.id);
    while (s.step !== 'main1') pass(s);
    expect(s.zones.hand[1].length).toBe(1);
    expect(s.players[1].life).toBe(20);
    while (s.pendingChoice?.kind !== 'declareAttackers') act(s, { type: 'pass' });
    act(s, { type: 'declareAttackers', assignments: [[leech, { kind: 'player', p: 0 }]] });
    while (s.players[0].life === 20 && s.turn === 4) pass(s);
    expect(s.players[0].life).toBe(18);
    expect(s.players[1].life).toBe(20);
  });

  it('control: without Lynx the same draw trigger gains 2 (the hook is what stops it)', () => {
    const s = given({
      turn: 4, step: 'upkeep', active: 1,
      battlefield: [{ card: Healer.id, controller: 1 }, 'Mountain'],
      hands: [[TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    while (s.step !== 'main1') pass(s);
    expect(s.players[1].life).toBe(22);
    const s2 = given({ battlefield: [LYNX] });
    expect(gainLife(s2, 0, 3)).toBe(0);
    expect(gainLife(s2, 1, 3)).toBe(0);
  });

  it('scenario 3: A at 2 with 2 nonbasics, B at 1 with 1 nonbasic: both reach 0 at one SBA check, the game is a draw (CR 104.4a (all players lose simultaneously))', () => {
    const s = given({
      turn: 3, step: 'main1', life: [1, 2],
      battlefield: ['Mountain', 'Mountain', 'Mountain', Dual.id, ...aBoard(2, 0)],
      hands: [[LYNX], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, LYNX));
    while (s.result === null && s.zones.stack.length > 0) pass(s);
    expect(s.players[0].life).toBe(0);
    expect(s.players[1].life).toBe(0);
    expect(s.result?.winner).toBe('draw');
  });

  it('a player with no nonbasic lands takes no damage; basics do not count', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', ...aBoard(1, 3)],
      hands: [[LYNX], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, LYNX));
    while (s.zones.stack.length > 0) pass(s);
    expect(s.players[0].life).toBe(20);
    expect(s.players[1].life).toBe(19);
  });

  it('"damage can\'t be prevented" is a marker only: no prevention effect exists in the pool (PLAN.md section 4)', () => {
    const oracle = JSON.parse(readFileSync('decks/oracle.json', 'utf8')) as unknown;
    const texts: string[] = [];
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) { for (const y of x) walk(y); return; }
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        if (typeof o.oracle_text === 'string') texts.push(o.oracle_text);
        for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
      }
    };
    walk(oracle);
    const prevent = texts.filter((x) => /prevent/i.test(x));
    console.log("oracle texts scanned=" + texts.length + ", mentioning prevention=" + prevent.length);
    expect(texts.length).toBeGreaterThan(0);
    expect(prevent.length).toBeGreaterThan(0); // Lynx itself
    for (const x of prevent) expect(x).toMatch(/can't be prevented/i);
  });
});
