// Fable of the Mirror-Breaker // Reflection of Kiki-Jiki: saga chapters, the Goblin Shaman token's
// Treasure attack trigger, the capped rummage, transform as a new object, and the hasty copy token
// that is sacrificed at the next end step (CR 707.9b (copy exceptions), CR 603.7 (delayed trigger)).
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, trig } from '../../cards/dsl.js';
import { characteristics } from '../../engine/statics.js';
import { act, answer, castMove, moves, O, pass } from '../scenario.js';
import type { GameState, Move, ObjId } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const FABLE = 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki';
const FABLE_ID = 'fable-of-the-mirror-breaker';
const SHAMAN = 'token-goblin-shaman';
const TREASURE = 'token-treasure';
const COPY = 'token-copy';
const BLOOD = 'token-blood';

/** {1}{B} 2/1 that makes a Blood token when it enters (a Bloodtithe Harvester stand-in). */
const EtbGuy = registerTestDef(card('Test Fable Etb', [face({
  name: 'Test Fable Etb', types: ['Creature'], subtypes: ['Vampire'], cost: '{1}{B}', pt: [2, 1],
  abilities: [trig('etb', (ctx) => { ctx.createToken('Blood', ctx.controller); })],
})]));
const Legend = registerTestDef(card('Test Fable Legend', [face({
  name: 'Test Fable Legend', types: ['Creature'], supertypes: ['Legendary'], cost: '{1}{R}', pt: [2, 2],
})]));
/** Eight distinct names with mana values 1..8 for the rummage cap. */
const Fillers = Array.from({ length: 8 }, (_, i) => registerTestDef(card(`Test Fable Filler ${i + 1}`, [face({
  name: `Test Fable Filler ${i + 1}`, types: ['Sorcery'], cost: `{${i + 1}}`,
})])));

/** Passes until pred holds. */
function until(s: GameState, pred: (s: GameState) => boolean, max = 60): void {
  for (let i = 0; i < max; i++) {
    if (pred(s)) return;
    pass(s);
  }
  throw new Error(`condition not reached; step ${s.step}, stack ${s.zones.stack.length}, choice ${JSON.stringify(s.pendingChoice)}`);
}
function activation(s: GameState, objId: ObjId, pred: (m: Extract<Move, { type: 'activate' }>) => boolean = () => true): Extract<Move, { type: 'activate' }> {
  const m = moves(s).find((x): x is Extract<Move, { type: 'activate' }> => x.type === 'activate' && x.objId === objId && pred(x));
  if (!m) throw new Error(`no activation for ${objId}: ${JSON.stringify(moves(s))}`);
  return m;
}
const fableOnField = (s: GameState): ObjId => id1(s, FABLE_ID);

describe('Fable of the Mirror-Breaker', () => {
  it('def matches oracle: {2}{R} Saga, back face 2/2 red Enchantment Creature Goblin Shaman, transform layout', () => {
    const s = given({ battlefield: [FABLE, { card: FABLE, face: 1 }], libraries: [lib(3), lib(3)] });
    const [front, back] = ids(s, FABLE_ID);
    const cf = characteristics(s, front as ObjId);
    const cb = characteristics(s, back as ObjId);
    expect([cf.name, cf.manaValue, cf.subtypes]).toEqual(['Fable of the Mirror-Breaker', 3, ['Saga']]);
    expect([cb.name, cb.power, cb.toughness, cb.subtypes, cb.manaValue]).toEqual(['Reflection of Kiki-Jiki', 2, 2, ['Goblin', 'Shaman'], 3]);
  });

  it('scenario 1: chapter I makes a sick Goblin Shaman; next turn chapter II rummages two lands; the token attacks for a Treasure', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[FABLE, TestBolt.id], [TestBolt.id]], libraries: [lib(10), lib(10)],
    });
    act(s, castMove(s, FABLE));
    until(s, (x) => ids(x, SHAMAN).length === 1 && x.zones.stack.length === 0);
    const fable = fableOnField(s);
    expect(s.objects[fable]?.counters.lore).toBe(1);
    const shaman = id1(s, SHAMAN);
    expect(s.objects[shaman]?.sick).toBe(true);
    expect(characteristics(s, shaman).power).toBe(2);

    // Player 0's next turn (turn 5).
    until(s, (x) => x.turn === 4 && x.step === 'main1');
    until(s, (x) => x.turn === 5 && x.step === 'upkeep');
    const handBefore = s.zones.hand[0].length;
    until(s, (x) => x.pendingChoice?.kind === 'pickObjects');
    expect(s.objects[fable]?.counters.lore).toBe(2);
    // The draw step drew one card. Discard two (the Bolt and the drawn card), then draw two.
    const hand = [...s.zones.hand[0]];
    expect(hand.length).toBe(handBefore + 1);
    const discardIds = hand.slice(0, 2);
    answer(s, { ids: discardIds });
    expect(s.zones.hand[0].length).toBe(hand.length);
    expect(s.zones.graveyard[0].length).toBe(2);
    // The discarded cards are public (graveyard is a public zone).
    for (const id of s.zones.graveyard[0]) expect(s.objects[id]?.knownTo).toEqual([true, true]);

    until(s, (x) => x.pendingChoice?.kind === 'declareAttackers');
    act(s, { type: 'declareAttackers', assignments: [[id1(s, SHAMAN), { kind: 'player', p: 1 }]] });
    until(s, (x) => ids(x, TREASURE).length === 1);
    expect(ids(s, TREASURE, 'battlefield', 0).length).toBe(1);
  });

  it('chapter II: discarding nothing draws nothing (If you do, draw that many)', () => {
    const s = given({
      turn: 3, step: 'upkeep', active: 0,
      battlefield: [{ card: FABLE, counters: { lore: 1 } }],
      hands: [['Mountain'], []], libraries: [lib(10), lib(10)],
    });
    until(s, (x) => x.pendingChoice?.kind === 'pickObjects');
    const n = s.zones.hand[0].length;
    const libN = s.zones.library[0].length;
    answer(s, { ids: [] });
    expect(s.zones.hand[0].length).toBe(n);
    expect(s.zones.library[0].length).toBe(libN);
  });

  it('PLAN.md section 5: rummage choices collapse by name and are capped at 20 (count printed)', () => {
    const s = given({
      turn: 3, step: 'upkeep', active: 0,
      battlefield: [{ card: FABLE, counters: { lore: 1 } }, 'Mountain', 'Mountain', 'Mountain', 'Mountain'],
      hands: [[...Fillers.map((f) => f.id), 'Mountain', 'Mountain'], []], libraries: [lib(10), lib(10)],
    });
    until(s, (x) => x.pendingChoice?.kind === 'pickObjects');
    const ch = s.pendingChoice;
    if (ch?.kind !== 'pickObjects') throw new Error('no rummage choice');
    const options = moves(s).filter((m) => m.type === 'choose');
    console.log(`fable rummage: hand ${s.zones.hand[0].length} cards, ${ch.from.length} offered, ${options.length} options`);
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(20);
    // Four lands controlled: excess lands rank first, so discarding two Mountains is offered.
    const mountains = ids(s, 'Mountain', 'hand', 0);
    expect(options.some((m) => m.type === 'choose' && JSON.stringify([...(m.answer.ids ?? [])].sort()) === JSON.stringify([...mountains].sort()))).toBe(true);
    // The highest mana value filler is offered, the lowest is not.
    expect(ch.from).toContain(id1(s, Fillers[7]!.id, 'hand'));
    expect(ch.from).not.toContain(id1(s, Fillers[0]!.id, 'hand'));
  });

  it('scenario 3: the Goblin token killed in response to chapter II does not stop the rummage', () => {
    const s = given({
      turn: 3, step: 'upkeep', active: 0,
      battlefield: [{ card: FABLE, counters: { lore: 1 } }, { card: SHAMAN, token: true }, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [['Mountain', TestBolt.id], [TestBolt.id]], libraries: [lib(10), lib(10)],
    });
    until(s, (x) => x.zones.stack.length === 1 && x.priority === 1);
    act(s, castMove(s, TestBolt.name, [O(id1(s, SHAMAN))]));
    until(s, (x) => x.pendingChoice?.kind === 'pickObjects');
    expect(ids(s, SHAMAN).length).toBe(0);
    answer(s, { ids: [id1(s, 'Mountain', 'hand', 0)] });
    expect(ids(s, 'Mountain', 'graveyard', 0).length).toBe(1);
    expect(s.objects[fableOnField(s)]?.counters.lore).toBe(2);
  });

  it('scenario 2: chapter III returns Reflection as a new sick object (CR 400.7 (new object), CR 302.6 (summoning sickness)); next turn it copies with haste; the copy is sacrificed at the end step', () => {
    const s = given({
      turn: 3, step: 'upkeep', active: 0,
      battlefield: [{ card: FABLE, counters: { lore: 2 } }, EtbGuy.id, 'Mountain', 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id]], libraries: [lib(10), lib(10)],
    });
    const oldId = fableOnField(s);
    until(s, (x) => x.step === 'main1' && x.zones.stack.length === 0 && ids(x, FABLE_ID).some((id) => x.objects[id]?.face === 1));
    const refl = fableOnField(s);
    expect(refl).not.toBe(oldId);
    expect(s.objects[oldId]).toBeUndefined();
    expect(s.objects[refl]?.face).toBe(1);
    expect(s.objects[refl]?.sick).toBe(true);
    expect(s.objects[refl]?.counters.lore).toBeUndefined();
    // The saga-sacrifice SBA does not touch the returned creature (it is no longer a Saga).
    expect(ids(s, FABLE_ID, 'graveyard').length).toBe(0);
    // CR 302.6 (tap symbol in its activation cost): {1},{T} is not available while sick.
    expect(moves(s).some((m) => m.type === 'activate' && m.objId === refl)).toBe(false);

    // Player 0's next turn.
    until(s, (x) => x.turn === 5 && x.step === 'main1' && x.zones.stack.length === 0 && x.priority === 0);
    const guy = id1(s, EtbGuy.id);
    act(s, activation(s, refl, (m) => JSON.stringify(m.targets) === JSON.stringify([O(guy)])));
    until(s, (x) => ids(x, COPY).length === 1 && x.zones.stack.length === 0);
    const copy = id1(s, COPY);
    const cc = characteristics(s, copy);
    expect([cc.name, cc.power, cc.toughness]).toEqual(['Test Fable Etb', 2, 1]);
    expect(s.objects[copy]?.copyOf).toBe(EtbGuy.id);
    // The copy's own enters trigger made a Blood.
    expect(ids(s, BLOOD, 'battlefield', 0).length).toBe(1);
    // Haste: it can attack this turn.
    until(s, (x) => x.pendingChoice?.kind === 'declareAttackers');
    act(s, { type: 'declareAttackers', assignments: [[copy, { kind: 'player', p: 1 }]] });
    until(s, (x) => x.step === 'main2' || x.step === 'end');
    expect(s.players[1].life).toBe(18);
    expect(ids(s, COPY).length).toBe(1);
    // CR 603.7 (delayed triggered ability): at the beginning of the next end step the copy is sacrificed.
    until(s, (x) => x.turn === 6);
    expect(ids(s, COPY).length).toBe(0);
    expect(ids(s, EtbGuy.id).length).toBe(1);
    expect(s.delayed.length).toBe(0);
  });

  it('targets: another nonlegendary creature you control only (not itself, not a legend, not an opponent creature)', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: FABLE, face: 1 }, Legend.id, EtbGuy.id, 'Mountain', { card: TestBear.id, controller: 1 }],
      libraries: [lib(5), lib(5)],
    });
    const refl = fableOnField(s);
    const targets = moves(s).filter((m): m is Extract<Move, { type: 'activate' }> => m.type === 'activate' && m.objId === refl).map((m) => m.targets);
    console.log(`fable reflection: ${targets.length} target options`);
    expect(targets).toEqual([[O(id1(s, EtbGuy.id))]]);
  });

  it('CR 707.8a (copy of a double-faced permanent) and CR 712.8e (copying the back face): a copy of another Reflection copies the back face and has mana value 0', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: FABLE, face: 1 }, { card: FABLE, face: 1 }, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const [a, b] = ids(s, FABLE_ID);
    act(s, activation(s, a as ObjId, (m) => JSON.stringify(m.targets) === JSON.stringify([O(b as ObjId)])));
    until(s, (x) => ids(x, COPY).length === 1 && x.zones.stack.length === 0);
    const c = characteristics(s, id1(s, COPY));
    expect([c.name, c.power, c.toughness, c.manaValue]).toEqual(['Reflection of Kiki-Jiki', 2, 2, 0]);
    expect(c.isToken).toBe(true);
  });
});
