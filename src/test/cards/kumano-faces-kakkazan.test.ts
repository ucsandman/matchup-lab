// Kumano Faces Kakkazan // Etching of Kumano: chapter I damage to the opponent and their
// planeswalkers, chapter II as a cast-time flag (PLAN.md D9), and Etching's would-die exile
// replacement keyed on damagedThisTurnBy (CR 614.1a (instead), CR 700.4 (dies)).
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { act as ability, card, face } from '../../cards/dsl.js';
import { characteristics } from '../../engine/statics.js';
import { act, castMove, moves, O, pass } from '../scenario.js';
import { TestWalker } from '../pool.js';
import type { GameState, Move, ObjId } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const KUMANO = 'Kumano Faces Kakkazan // Etching of Kumano';
const KUMANO_ID = 'kumano-faces-kakkazan';

/** {R} 1/2 red creature (a Monastery Swiftspear stand-in). */
const Spear = registerTestDef(card('Test Kumano Spear', [face({ name: 'Test Kumano Spear', types: ['Creature'], cost: '{R}', pt: [1, 2] })]));
/** {1} 1/4 with 'Sacrifice this: nothing' (a creature whose controller can sacrifice it at will). */
const Wall = registerTestDef(card('Test Kumano Wall', [face({
  name: 'Test Kumano Wall', types: ['Creature'], cost: '{1}', pt: [1, 4],
  abilities: [ability({ cost: { sacrificeSelf: true }, resolve: () => {} })],
})]));

function until(s: GameState, pred: (s: GameState) => boolean, max = 60): void {
  for (let i = 0; i < max; i++) {
    if (pred(s)) return;
    pass(s);
  }
  throw new Error(`condition not reached; step ${s.step}, stack ${s.zones.stack.length}, choice ${JSON.stringify(s.pendingChoice)}`);
}
function activation(s: GameState, objId: ObjId): Move {
  const m = moves(s).find((x) => x.type === 'activate' && x.objId === objId);
  if (!m) throw new Error(`no activation for ${objId}: ${JSON.stringify(moves(s))}`);
  return m;
}

describe('Kumano Faces Kakkazan', () => {
  it('def matches oracle: {R} Saga, back face 2/2 red Human Shaman with haste, mana value 1', () => {
    const s = given({ battlefield: [KUMANO, { card: KUMANO, face: 1 }], libraries: [lib(3), lib(3)] });
    const [front, back] = ids(s, KUMANO_ID);
    const cf = characteristics(s, front as ObjId);
    const cb = characteristics(s, back as ObjId);
    expect([cf.name, cf.manaValue, cf.subtypes]).toEqual(['Kumano Faces Kakkazan', 1, ['Saga']]);
    expect([cb.name, cb.power, cb.toughness, cb.subtypes, cb.manaValue]).toEqual(['Etching of Kumano', 2, 2, ['Human', 'Shaman'], 1]);
  });

  it('scenario 1: chapter I deals 1 to the opponent (life 20 to 19) and 1 to their planeswalker (loyalty 3 to 2)', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: ['Mountain', 'Mountain', { card: TestWalker.id, controller: 1, counters: { loyalty: 3 } }],
      hands: [[KUMANO, TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, KUMANO));
    until(s, (x) => x.players[1].life !== 20 && x.zones.stack.length === 0);
    expect(s.players[1].life).toBe(19);
    expect(s.objects[id1(s, TestWalker.id)]?.counters.loyalty).toBe(2);
    expect(s.players[0].life).toBe(20);
    expect(s.objects[id1(s, KUMANO_ID)]?.counters.lore).toBe(1);
  });

  it('scenario 2: chapter II gives the next creature spell this turn a +1/+1 counter; a second creature gets none (D9 cast-time flag)', () => {
    const s = given({
      turn: 3, step: 'upkeep', active: 0,
      battlefield: [{ card: KUMANO, counters: { lore: 1 } }, 'Mountain', 'Mountain', 'Mountain'],
      hands: [[Spear.id, Spear.id, TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    until(s, (x) => x.step === 'main1' && x.zones.stack.length === 0 && x.priority === 0);
    expect(s.turnFlags.nextCreatureBonus[0]).toBe(true);
    act(s, castMove(s, Spear.name));
    expect(s.turnFlags.nextCreatureBonus[0]).toBe(false);
    until(s, (x) => ids(x, Spear.id).length === 1);
    const first = id1(s, Spear.id);
    expect(s.objects[first]?.counters.p1p1).toBe(1);
    const c = characteristics(s, first);
    expect([c.power, c.toughness]).toEqual([2, 3]);
    until(s, (x) => x.zones.stack.length === 0 && x.priority === 0);
    act(s, castMove(s, Spear.name));
    until(s, (x) => ids(x, Spear.id).length === 2);
    const second = ids(s, Spear.id).find((id) => id !== first) as ObjId;
    expect(s.objects[second]?.counters.p1p1).toBeUndefined();
  });

  it('chapter II flag ends with the turn: a creature cast next turn gets no counter', () => {
    const s = given({
      turn: 3, step: 'upkeep', active: 0,
      battlefield: [{ card: KUMANO, counters: { lore: 1 } }, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [Spear.id]], libraries: [lib(5), lib(5)],
    });
    until(s, (x) => x.step === 'main1' && x.zones.stack.length === 0);
    expect(s.turnFlags.nextCreatureBonus[0]).toBe(true);
    // Player 1 casts a creature on their own turn: the flag was player 0's and this turn's only.
    until(s, (x) => x.turn === 4 && x.step === 'main1' && x.priority === 1);
    expect(s.turnFlags.nextCreatureBonus).toEqual([false, false]);
    act(s, castMove(s, Spear.name));
    until(s, (x) => ids(x, Spear.id).length === 1);
    expect(s.objects[id1(s, Spear.id)]?.counters.p1p1).toBeUndefined();
  });

  it('chapter III: Etching of Kumano returns as a new object and can attack that turn (CR 702.10b (haste))', () => {
    const s = given({
      turn: 3, step: 'upkeep', active: 0,
      battlefield: [{ card: KUMANO, counters: { lore: 2 } }],
      libraries: [lib(5), lib(5)],
    });
    const oldId = id1(s, KUMANO_ID);
    until(s, (x) => x.pendingChoice?.kind === 'declareAttackers');
    const etching = id1(s, KUMANO_ID);
    expect(etching).not.toBe(oldId);
    expect(s.objects[etching]?.face).toBe(1);
    expect(s.objects[etching]?.sick).toBe(true);
    act(s, { type: 'declareAttackers', assignments: [[etching, { kind: 'player', p: 1 }]] });
    until(s, (x) => x.players[1].life < 20);
    expect(s.players[1].life).toBe(18);
  });

  it('scenario 3: a creature dealt damage this turn by your source is exiled when its controller sacrifices it (CR 700.4 (dies) includes sacrifice)', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: KUMANO, face: 1 }, 'Mountain', { card: Wall.id, controller: 1 }],
      hands: [[TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const wall = id1(s, Wall.id);
    act(s, castMove(s, TestBolt.name, [O(wall)]));
    until(s, (x) => (x.objects[wall]?.damage ?? 0) === 3 && x.priority === 1 && x.zones.stack.length === 0);
    expect(s.objects[wall]?.damagedThisTurnBy).toEqual([true, false]);
    act(s, activation(s, wall));
    expect(ids(s, Wall.id, 'exile', 1).length).toBe(1);
    expect(ids(s, Wall.id, 'graveyard', 1).length).toBe(0);
  });

  it('Etching: lethal damage from your source exiles; an undamaged creature, or one damaged only by its own controller, goes to the graveyard', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: KUMANO, face: 1 }, 'Mountain', { card: TestBear.id, controller: 1 }, { card: Wall.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const bear = id1(s, TestBear.id);
    const wall = id1(s, Wall.id);
    act(s, castMove(s, TestBolt.name, [O(bear)]));
    until(s, (x) => x.objects[bear] === undefined);
    // CR 704.5g (lethal damage) through the die choke point: exiled instead.
    expect(ids(s, TestBear.id, 'exile', 1).length).toBe(1);
    // Player 1 bolts their own Wall (damage by a source player 1 controls), then sacrifices it.
    until(s, (x) => x.priority === 1 && x.zones.stack.length === 0);
    act(s, castMove(s, TestBolt.name, [O(wall)]));
    until(s, (x) => (x.objects[wall]?.damage ?? 0) === 3 && x.priority === 1 && x.zones.stack.length === 0);
    expect(s.objects[wall]?.damagedThisTurnBy).toEqual([false, true]);
    act(s, activation(s, wall));
    expect(ids(s, Wall.id, 'graveyard', 1).length).toBe(1);
  });

  it('this turn means this turn: damagedThisTurnBy resets as the next turn begins, so a sacrifice then goes to the graveyard', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: KUMANO, face: 1 }, 'Mountain', { card: Wall.id, controller: 1 }],
      hands: [[TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const wall = id1(s, Wall.id);
    act(s, castMove(s, TestBolt.name, [O(wall)]));
    until(s, (x) => x.turn === 4 && x.priority === 1);
    expect(s.objects[wall]?.damage).toBe(0);
    expect(s.objects[wall]?.damagedThisTurnBy).toEqual([false, false]);
    act(s, activation(s, wall));
    expect(ids(s, Wall.id, 'graveyard', 1).length).toBe(1);
  });
});
