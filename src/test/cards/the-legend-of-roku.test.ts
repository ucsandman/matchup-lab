// The Legend of Roku // Avatar Roku: impulse exile with a permission that ends after your next
// turn, chapter II mana collapsed to R (PLAN.md D9), transform as a new object, firebending 4
// (CR 702.189a (firebending)) and the {8} Dragon ability offered only when 8 mana is available.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, spell, t } from '../../cards/dsl.js';
import { characteristics } from '../../engine/statics.js';
import { canAttack } from '../../engine/combat.js';
import { act, castMove, moves, O, pass } from '../scenario.js';
import type { GameState, Move, ObjId } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const ROKU = 'The Legend of Roku // Avatar Roku';
const ROKU_ID = 'the-legend-of-roku';
const DRAGON = 'token-dragon';

/** {R} instant pump (a Monstrous Rage stand-in). */
const Pump = registerTestDef(card('Test Roku Pump', [face({
  name: 'Test Roku Pump', types: ['Instant'], cost: '{R}',
  abilities: [spell({ target: t.creature(), resolve: (ctx, [tg]) => { if (tg && tg.kind === 'obj') ctx.addEotDelta(tg.id, 1, 1); } })],
})]));

function until(s: GameState, pred: (s: GameState) => boolean, max = 80): void {
  for (let i = 0; i < max; i++) {
    if (pred(s)) return;
    const k = s.pendingChoice?.kind;
    if (k && k !== 'declareAttackers' && k !== 'declareBlockers') throw new Error(`unexpected choice ${JSON.stringify(s.pendingChoice)} turn ${s.turn} ${s.step}`);
    pass(s);
  }
  throw new Error(`condition not reached; step ${s.step}, stack ${s.zones.stack.length}, choice ${JSON.stringify(s.pendingChoice)}`);
}
const rokuActivations = (s: GameState, id: ObjId): Move[] => moves(s).filter((m) => m.type === 'activate' && m.objId === id);
const permissions = (s: GameState): number => s.effects.filter((e) => e.kind === 'playFromExile').length;

describe('The Legend of Roku', () => {
  it('def matches oracle: {2}{R}{R} Saga; back face legendary 4/4 red Avatar with firebending, mana value 4', () => {
    const s = given({ battlefield: [ROKU, { card: ROKU, face: 1 }], libraries: [lib(3), lib(3)] });
    const [front, back] = ids(s, ROKU_ID);
    const cf = characteristics(s, front as ObjId);
    const cb = characteristics(s, back as ObjId);
    expect([cf.name, cf.manaValue, cf.subtypes]).toEqual(['The Legend of Roku', 4, ['Saga']]);
    expect([cb.name, cb.power, cb.toughness, cb.subtypes, cb.legendary, cb.manaValue]).toEqual(['Avatar Roku', 4, 4, ['Avatar'], true, 4]);
  });

  it('scenario 1: chapter I exiles the top three face up; a land from exile uses the land drop, a spell is cast from exile; the rest stops being playable after your next turn', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', { card: TestBear.id, controller: 1 }],
      hands: [[ROKU, 'Mountain', TestBolt.id], []],
      libraries: [[TestBolt.id, 'Mountain', Pump.id, ...lib(10)], lib(10)],
    });
    act(s, castMove(s, ROKU));
    until(s, (x) => x.zones.exile[0].length === 3 && x.zones.stack.length === 0 && x.priority === 0);
    expect(s.zones.library[0].length).toBe(10);
    // Public: exile is a public zone.
    for (const id of s.zones.exile[0]) expect(s.objects[id]?.knownTo).toEqual([true, true]);
    expect(permissions(s)).toBe(3);
    const exMountain = id1(s, 'Mountain', 'exile', 0);
    expect(moves(s).some((m) => m.type === 'playLand' && m.objId === exMountain)).toBe(true);
    act(s, { type: 'playLand', objId: exMountain });
    // CR 305.2 (one land per turn): the land from exile was this turn's land drop.
    expect(s.turnFlags.landsPlayed[0]).toBe(1);
    expect(moves(s).some((m) => m.type === 'playLand')).toBe(false);
    const bear = id1(s, TestBear.id);
    act(s, castMove(s, TestBolt.name, [O(bear)], (m) => s.objects[m.objId]?.zone === 'exile'));
    until(s, (x) => x.zones.stack.length === 0 && ids(x, TestBear.id).length === 0);
    expect(ids(s, TestBolt.id, 'graveyard', 0).length).toBe(1);
    expect(ids(s, TestBolt.id, 'hand', 0).length).toBe(1);
    expect(permissions(s)).toBe(1);
    const pump = id1(s, Pump.id, 'exile', 0);
    // Still playable through player 0's next turn (turn 5).
    until(s, (x) => x.turn === 5 && x.step === 'main2');
    expect(permissions(s)).toBe(1);
    until(s, (x) => x.turn === 6);
    expect(permissions(s)).toBe(0);
    expect(s.objects[pump]?.zone).toBe('exile');
    expect(ids(s, Pump.id, 'exile', 0).length).toBe(1);
  });

  it('chapter II adds one R (any color collapsed to R, PLAN.md D9)', () => {
    const s = given({
      turn: 3, step: 'upkeep', active: 0,
      battlefield: [{ card: ROKU, counters: { lore: 1 } }, 'Mountain'],
      hands: [[TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    until(s, (x) => x.step === 'main1' && x.zones.stack.length === 0 && x.priority === 0);
    expect(s.objects[id1(s, ROKU_ID)]?.counters.lore).toBe(2);
    expect(s.players[0].manaPool).toEqual([{ color: 'R' }]);
  });

  it('scenario 2: chapter III: the saga is exiled and Avatar Roku enters as a new object that cannot attack this turn', () => {
    const s = given({
      turn: 3, step: 'upkeep', active: 0,
      battlefield: [{ card: ROKU, counters: { lore: 2 } }, 'Mountain'],
      hands: [[TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const oldId = id1(s, ROKU_ID);
    until(s, (x) => x.step === 'main1' && x.zones.stack.length === 0 && x.priority === 0);
    const roku = id1(s, ROKU_ID);
    expect(roku).not.toBe(oldId);
    expect(s.objects[roku]?.face).toBe(1);
    expect(s.objects[roku]?.sick).toBe(true);
    expect(ids(s, ROKU_ID, 'graveyard').length).toBe(0);
    // CR 302.6 (summoning sickness): not eligible to attack this turn.
    expect(canAttack(s, roku, 0)).toBe(false);
    until(s, (x) => x.step !== 'main1');
    expect(s.objects[roku]?.attacking).toBeUndefined();
    expect(s.players[1].life).toBe(20);
  });

  it('scenario 3: Roku attacks, firebending adds RRRR; with 4 Mountains the {8} ability is offered in combat and makes a 4/4 flying firebending Dragon', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: ROKU, face: 1 }, 'Mountain', 'Mountain', 'Mountain', 'Mountain'],
      libraries: [lib(5), lib(5)],
    });
    const roku = id1(s, ROKU_ID);
    // Out of combat, 4 sources cannot pay {8}: not offered.
    expect(rokuActivations(s, roku).length).toBe(0);
    until(s, (x) => x.pendingChoice?.kind === 'declareAttackers');
    act(s, { type: 'declareAttackers', assignments: [[roku, { kind: 'player', p: 1 }]] });
    until(s, (x) => rokuActivations(x, roku).length > 0);
    expect(s.players[0].manaPool.filter((e) => e.color === 'R' && e.expires === 'endOfCombat').length).toBe(4);
    act(s, rokuActivations(s, roku)[0] as Move);
    until(s, (x) => ids(x, DRAGON).length === 1 && x.zones.stack.length === 0);
    const dragon = id1(s, DRAGON);
    const c = characteristics(s, dragon);
    expect([c.power, c.toughness]).toEqual([4, 4]);
    expect(s.objects[dragon]?.controller).toBe(0);
    expect(s.players[0].manaPool.length).toBe(0);
  });

  it('CR 702.189a (firebending): unused firebending mana lasts through combat steps and empties at end of combat', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: ROKU, face: 1 }, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const roku = id1(s, ROKU_ID);
    until(s, (x) => x.pendingChoice?.kind === 'declareAttackers');
    act(s, { type: 'declareAttackers', assignments: [[roku, { kind: 'player', p: 1 }]] });
    until(s, (x) => x.step === 'combatDamage' && x.priority === 0);
    expect(s.players[0].manaPool.length).toBe(4);
    until(s, (x) => x.step === 'main2' && x.priority === 0);
    expect(s.players[0].manaPool.length).toBe(0);
    expect(s.players[1].life).toBe(16);
  });

  it('the {8} ability out of combat needs 8 untapped sources (count printed)', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: ROKU, face: 1 }, ...Array.from({ length: 8 }, () => 'Mountain')],
      libraries: [lib(5), lib(5)],
    });
    const roku = id1(s, ROKU_ID);
    const n = rokuActivations(s, roku).length;
    console.log(`avatar roku: ${n} {8} activation moves with 8 Mountains`);
    expect(n).toBe(1);
    act(s, rokuActivations(s, roku)[0] as Move);
    until(s, (x) => ids(x, DRAGON).length === 1);
    expect(ids(s, 'Mountain').every((id) => s.objects[id]?.tapped)).toBe(true);
  });
});
