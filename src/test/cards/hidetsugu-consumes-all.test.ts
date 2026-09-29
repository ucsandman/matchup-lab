// Hidetsugu Consumes All // Vessel of the All-Consuming: mass destroy by mana value as one event,
// exile all graveyards, transform as a new object, the damage counter trigger and the 10-damage
// lose trigger with a per-source tally (CR 603.4 (intervening if), CR 104.3e (effect: lose the game)).
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face } from '../../cards/dsl.js';
import { characteristics } from '../../engine/statics.js';
import { invalidateMemo } from '../../engine/mutate.js';
import { insertExtraCombat } from '../../engine/turn.js';
import { act, answer, castMove, pass } from '../scenario.js';
import type { GameState, ObjId } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const HIDETSUGU = 'Hidetsugu Consumes All // Vessel of the All-Consuming';
const HID_ID = 'hidetsugu-consumes-all';
const KUMANO = 'Kumano Faces Kakkazan // Etching of Kumano';
const KUMANO_ID = 'kumano-faces-kakkazan';

/** {R} 1/2 (Monastery Swiftspear stand-in) and {R} 1/1 (Soul-Scar Mage stand-in): mana value 1. */
const One = registerTestDef(card('Test Hid One', [face({ name: 'Test Hid One', types: ['Creature'], cost: '{R}', pt: [1, 2] })]));
const OneB = registerTestDef(card('Test Hid One B', [face({ name: 'Test Hid One B', types: ['Creature'], cost: '{R}', pt: [1, 1] })]));
/** A land used as an animated manland (Mutavault stand-in). */
/** 2/4 blocker that survives 3 damage and does not kill a 3/3. */
const Wall = registerTestDef(card('Test Hid Wall', [face({ name: 'Test Hid Wall', types: ['Creature'], cost: '{3}', pt: [2, 4] })]));
const Vault = registerTestDef(card('Test Hid Vault', [face({ name: 'Test Hid Vault', types: ['Land'], cost: null })]));

function until(s: GameState, pred: (s: GameState) => boolean, max = 80): void {
  for (let i = 0; i < max; i++) {
    if (pred(s)) return;
    // Vessel's two damage triggers go on the stack together: its controller orders them (CR 603.3b (APNAP order)).
    if (s.pendingChoice?.kind === 'pickIndex' && s.pendingChoice.reason === 'orderTriggers') { answer(s, { index: 0 }); continue; }
    pass(s);
  }
  throw new Error(`condition not reached; step ${s.step}, stack ${s.zones.stack.length}, choice ${JSON.stringify(s.pendingChoice)}`);
}

describe('Hidetsugu Consumes All', () => {
  it('def matches oracle: {1}{B}{R} Saga, back face 3/3 black-red Ogre Shaman with trample, mana value 3', () => {
    const s = given({ battlefield: [HIDETSUGU, { card: HIDETSUGU, face: 1 }], libraries: [lib(3), lib(3)] });
    const [front, back] = ids(s, HID_ID);
    const cf = characteristics(s, front as ObjId);
    const cb = characteristics(s, back as ObjId);
    expect([cf.name, cf.manaValue, cf.subtypes]).toEqual(['Hidetsugu Consumes All', 3, ['Saga']]);
    expect([cb.name, cb.power, cb.toughness, cb.subtypes, cb.manaValue]).toEqual(['Vessel of the All-Consuming', 3, 3, ['Ogre', 'Shaman'], 3]);
  });

  it('scenario 1: chapter I destroys every nonland permanent with mana value 1 or less (tokens 0, sagas 1, CR 712.8e (mana value of front face) back face 1); MV 2, lands and animated lands stay', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [
        'Swamp', 'Mountain', 'Mountain', 'Mountain',
        { card: 'token-goblin-shaman', token: true }, { card: 'token-blood', token: true }, TestBear.id,
        { card: One.id, controller: 1 }, { card: OneB.id, controller: 1 }, { card: TestBear.id, controller: 1 },
        { card: KUMANO, controller: 1, counters: { lore: 1 } }, { card: KUMANO, controller: 1, face: 1 },
        { card: Vault.id, controller: 1 },
      ],
      hands: [[HIDETSUGU, TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const vault = id1(s, Vault.id);
    s.objects[vault]!.animated = { types: ['Creature'], pt: [2, 2] };
    invalidateMemo(s);
    act(s, castMove(s, HIDETSUGU));
    until(s, (x) => x.zones.stack.length === 0 && ids(x, One.id).length === 0);
    expect(ids(s, 'token-goblin-shaman').length).toBe(0);
    expect(ids(s, 'token-blood').length).toBe(0);
    expect(ids(s, One.id, 'graveyard', 1).length).toBe(1);
    expect(ids(s, OneB.id, 'graveyard', 1).length).toBe(1);
    expect(ids(s, KUMANO_ID, 'battlefield').length).toBe(0);
    expect(ids(s, KUMANO_ID, 'graveyard', 1).length).toBe(2);
    expect(ids(s, TestBear.id, 'battlefield').length).toBe(2);
    expect(ids(s, Vault.id, 'battlefield').length).toBe(1);
    expect(ids(s, HID_ID).length).toBe(1);
    expect(s.objects[id1(s, HID_ID)]?.counters.lore).toBe(1);
  });

  it('chapter I is one event: Etching of Kumano destroyed at the same time still exiles a creature its controller damaged (CR 614.1a (instead), zones.ts die)', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      // Etching is listed first so a one-at-a-time destroy would remove it before the damaged creature.
      battlefield: [{ card: KUMANO, controller: 1, face: 1 }, 'Swamp', 'Mountain', 'Mountain', 'Mountain', One.id],
      hands: [[HIDETSUGU, TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const one = id1(s, One.id);
    s.objects[one]!.damagedThisTurnBy = [false, true];
    invalidateMemo(s);
    act(s, castMove(s, HIDETSUGU));
    until(s, (x) => x.zones.stack.length === 0 && ids(x, One.id).length === 0);
    expect(ids(s, One.id, 'exile', 0).length).toBe(1);
    expect(ids(s, KUMANO_ID, 'graveyard', 1).length).toBe(1);
  });

  it('chapter II exiles all graveyards', () => {
    const s = given({
      turn: 3, step: 'upkeep', active: 0,
      battlefield: [{ card: HIDETSUGU, counters: { lore: 1 } }, 'Mountain'],
      graveyards: [[TestBear.id, TestBolt.id], [TestBolt.id, 'Mountain', TestBear.id]],
      hands: [[TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    until(s, (x) => x.step === 'main1' && x.zones.stack.length === 0 && x.priority === 0);
    expect(s.zones.graveyard[0].length + s.zones.graveyard[1].length).toBe(0);
    expect(s.zones.exile[0].length).toBe(2);
    expect(s.zones.exile[1].length).toBe(3);
  });

  it('scenario 2: chapter III returns Vessel as a new 3/3 with no counters and summoning sickness; the saga SBA does not touch it', () => {
    const s = given({
      turn: 3, step: 'upkeep', active: 0,
      battlefield: [{ card: HIDETSUGU, counters: { lore: 2 } }, 'Mountain'],
      hands: [[TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const oldId = id1(s, HID_ID);
    until(s, (x) => x.step === 'main1' && x.zones.stack.length === 0 && x.priority === 0);
    const vessel = id1(s, HID_ID);
    expect(vessel).not.toBe(oldId);
    expect(s.objects[vessel]?.face).toBe(1);
    expect(s.objects[vessel]?.counters).toEqual({});
    expect(s.objects[vessel]?.sick).toBe(true);
    const c = characteristics(s, vessel);
    expect([c.power, c.toughness]).toEqual([3, 3]);
    expect(ids(s, HID_ID, 'graveyard').length).toBe(0);
  });

  it('scenario 3: 9/9 trample blocked by a 2/2 deals 2 + 7 (one counter, tally 7, no loss); in an extra combat 10 more to the player: the tally reaches 17 and the player loses', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: HIDETSUGU, face: 1, counters: { p1p1: 6 } }, { card: TestBear.id, controller: 1 }, 'Mountain'],
      hands: [[TestBolt.id], []], life: [20, 30], libraries: [lib(5), lib(5)],
    });
    insertExtraCombat(s); // Fear of Missing Out stand-in: two combat phases this turn (CR 500.8 (extra phases))
    const vessel = id1(s, HID_ID);
    const bear = id1(s, TestBear.id);
    until(s, (x) => x.pendingChoice?.kind === 'declareAttackers');
    act(s, { type: 'declareAttackers', assignments: [[vessel, { kind: 'player', p: 1 }]] });
    until(s, (x) => x.pendingChoice?.kind === 'declareBlockers');
    act(s, { type: 'declareBlockers', assignments: [[bear, vessel]] });
    until(s, (x) => x.step === 'endCombat' || x.pendingChoice?.kind === 'declareAttackers');
    expect(s.players[1].life).toBe(23);
    expect(s.turnFlags.damageTally[vessel]).toEqual([0, 7]);
    // One damage event (blocker and player at once): exactly one +1/+1 counter.
    expect(s.objects[vessel]?.counters.p1p1).toBe(7);
    expect(s.result).toBeNull();
    // Second combat this turn (Fear of Missing Out also untaps the creature): 10/10 unblocked.
    s.objects[vessel]!.tapped = false;
    invalidateMemo(s);
    until(s, (x) => x.pendingChoice?.kind === 'declareAttackers');
    expect(s.turn).toBe(3);
    act(s, { type: 'declareAttackers', assignments: [[vessel, { kind: 'player', p: 1 }]] });
    until(s, (x) => x.result !== null);
    expect(s.players[1].life).toBe(13);
    expect(s.turnFlags.damageTally[vessel]).toEqual([0, 17]);
    expect(s.turn).toBe(3);
    expect(s.result?.winner).toBe(0);
    expect(s.result?.reason).toContain('Vessel');
  });

  it('CR 603.4 (intervening if): damage below 10 to the player never loses; damage to a creature only still grows Vessel', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: HIDETSUGU, face: 1 }, { card: Wall.id, controller: 1 }, 'Mountain'],
      hands: [[TestBolt.id], []], life: [20, 20], libraries: [lib(5), lib(5)],
    });
    const vessel = id1(s, HID_ID);
    const wall = id1(s, Wall.id);
    until(s, (x) => x.pendingChoice?.kind === 'declareAttackers');
    act(s, { type: 'declareAttackers', assignments: [[vessel, { kind: 'player', p: 1 }]] });
    until(s, (x) => x.pendingChoice?.kind === 'declareBlockers');
    act(s, { type: 'declareBlockers', assignments: [[wall, vessel]] });
    until(s, (x) => x.step === 'main2' || x.turn > 3);
    expect(s.players[1].life).toBe(20);
    expect(s.turnFlags.damageTally[vessel]).toBeUndefined();
    expect(s.objects[vessel]?.counters.p1p1).toBe(1);
    expect(s.result).toBeNull();
  });
});
