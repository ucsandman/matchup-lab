// Sheoldred, the Apocalypse: one trigger per card drawn, CR 121.2 (one at a time), real stack
// objects that resolve even after she leaves, CR 113.7a (independently of its source).
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, spell, t } from '../../cards/dsl.js';
import { invalidateMemo } from '../../engine/mutate.js';
import { characteristics } from '../../engine/statics.js';
import { act, castMove, O, pass } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const SHEOLDRED = 'Sheoldred, the Apocalypse';

const Murder = registerTestDef(card('Test Sh Murder', [face({
  name: 'Test Sh Murder', types: ['Instant'], cost: '{R}',
  abilities: [spell({ target: t.creature(), resolve: (ctx, [tg]) => { if (tg && tg.kind === 'obj') ctx.destroy(tg.id); } })],
})]));
const Divination = registerTestDef(card('Test Sh Divination', [face({
  name: 'Test Sh Divination', types: ['Sorcery'], cost: '{R}',
  abilities: [spell({ resolve: (ctx) => { ctx.draw(ctx.controller, 2); } })],
})]));

function sheoldredTriggers(s: GameState): number {
  return s.zones.stack.filter((i) => i.kind === 'triggered' && i.defId === 'sheoldred-the-apocalypse').length;
}

describe('Sheoldred, the Apocalypse', () => {
  it('matches its oracle characteristics', () => {
    const s = given({ battlefield: [SHEOLDRED] });
    const c = characteristics(s, id1(s, SHEOLDRED));
    expect([c.power, c.toughness, c.manaValue, c.legendary]).toEqual([4, 5, 4, true]);
  });

  it('scenario 1: the opponent draws for the turn; the trigger goes on the stack and they lose 2', () => {
    const s = given({
      turn: 2, step: 'upkeep', active: 1, life: [20, 10],
      battlefield: [SHEOLDRED, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    while (s.step !== 'draw') pass(s);
    expect(sheoldredTriggers(s)).toBe(1);
    expect(s.players[1].life).toBe(10);
    while (s.zones.stack.length > 0) pass(s);
    expect(s.players[1].life).toBe(8);
  });

  it('scenario 2: controller cannot gain life; the trigger still resolves as a no-op', () => {
    const s = given({
      turn: 3, step: 'upkeep', active: 0, life: [5, 20],
      battlefield: [SHEOLDRED, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    s.players[0].cantGainLife = true;
    invalidateMemo(s);
    while (s.step !== 'draw') pass(s);
    expect(sheoldredTriggers(s)).toBe(1);
    while (s.zones.stack.length > 0) pass(s);
    expect(s.players[0].life).toBe(5);
  });

  it('scenario 3: killing Sheoldred in response does not stop the trigger, CR 113.7a (independently of its source)', () => {
    const s = given({
      turn: 2, step: 'upkeep', active: 1, life: [20, 10],
      battlefield: [SHEOLDRED, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [Murder.id]], libraries: [lib(5), lib(5)],
    });
    while (s.step !== 'draw') pass(s);
    expect(sheoldredTriggers(s)).toBe(1);
    expect(s.priority).toBe(1);
    act(s, castMove(s, 'Test Sh Murder', [O(id1(s, SHEOLDRED))]));
    while (s.zones.stack.length > 0) pass(s);
    expect(ids(s, SHEOLDRED, 'graveyard', 0).length).toBe(1);
    expect(s.players[1].life).toBe(8);
  });

  it('CR 121.2 (one at a time): drawing two cards triggers twice (controller gains 4)', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0, life: [10, 20],
      battlefield: [SHEOLDRED, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[Divination.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Test Sh Divination'));
    while (s.zones.stack.some((i) => i.kind === 'spell')) pass(s);
    expect(sheoldredTriggers(s)).toBe(2);
    while (s.zones.stack.length > 0) pass(s);
    expect(s.players[0].life).toBe(14);
  });
});
