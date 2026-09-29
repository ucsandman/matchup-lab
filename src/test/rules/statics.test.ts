import { describe, expect, it } from 'vitest';
import { given, id1, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { act, adventure, card, face, land, mana, room, stat } from '../../cards/dsl.js';
import { characteristics, classKey, controlsLandType, hasKeyword, KW, LAND, TYPE, urborgActive } from '../../engine/statics.js';
import { addCounter, addEffect, allocId, setField } from '../../engine/mutate.js';
import { createToken, moveObject } from '../../engine/zones.js';
import type { ObjId } from '../../engine/types.js';

const TestUrborg = registerTestDef(card('Test Urborg', [land({
  name: 'Test Urborg', supertypes: ['Legendary'], abilities: [stat({ category: 'allLandsAreSwamps' })],
})]));
const TestManland = registerTestDef(card('Test Manland', [land({
  name: 'Test Manland', mana: [mana({ produce: ['C'] })],
  abilities: [act({ cost: { mana: '{1}' }, resolve: (ctx) => { setField(ctx.state, ctx.source, 'animated', { types: ['Creature'], allCreatureTypes: true, pt: [2, 2] }); } })],
})]));
const TestFlip = registerTestDef(card('Test Front // Test Back', [
  face({ name: 'Test Front', types: ['Enchantment'], subtypes: ['Saga'], cost: '{2}{R}' }),
  face({ name: 'Test Back', types: ['Enchantment', 'Creature'], subtypes: ['Goblin'], colors: ['R'], pt: [2, 2] }),
], 'transform'));
const TestAdv = registerTestDef(adventure('Test Giant // Test Stomp',
  face({ name: 'Test Giant', types: ['Creature'], subtypes: ['Giant'], cost: '{2}{R}', pt: [4, 3] }),
  face({ name: 'Test Stomp', types: ['Instant'], subtypes: ['Adventure'], cost: '{1}{R}' })));
const TestRoom2 = registerTestDef(room('Test Annex // Test Chamber',
  face({ name: 'Test Annex', types: ['Enchantment'], subtypes: ['Room'], cost: '{2}{B}' }),
  face({ name: 'Test Chamber', types: ['Enchantment'], subtypes: ['Room'], cost: '{3}{B}{B}' })));
const TestHearse = registerTestDef(card('Test Hearse', [face({
  name: 'Test Hearse', types: ['Artifact'], subtypes: ['Vehicle'], cost: '{2}',
  abilities: [stat({ category: 'ptCda', cda: (state, id) => { const n = state.objects[id]?.exiledWith ?? 0; return [n, n]; } })],
})]));

describe('characteristics', () => {
  it('basic land: type, subtype bitmask and the intrinsic mana ability (CR 305.6 (basic land types))', () => {
    const s = given({ battlefield: ['Swamp', 'Mountain'] });
    const sw = characteristics(s, id1(s, 'Swamp'));
    expect(sw.types).toBe(TYPE.Land);
    expect(sw.basic).toBe(true);
    expect(sw.landTypes).toBe(LAND.Swamp);
    expect(sw.abilities).toEqual(['basic:B']);
    expect(characteristics(s, id1(s, 'Mountain')).abilities).toEqual(['basic:R']);
  });

  it('Urborg makes every land a Swamp in addition, as one global boolean', () => {
    const s = given({ battlefield: ['Mountain', { card: 'Mountain', controller: 1 }] });
    expect(urborgActive(s)).toBe(false);
    expect(controlsLandType(s, 1, ['Swamp'])).toBe(false);
    const s2 = given({ battlefield: ['Mountain', { card: 'Mountain', controller: 1 }, TestUrborg.id] });
    expect(urborgActive(s2)).toBe(true);
    const m = characteristics(s2, id1(s2, 'Mountain', 'battlefield', 1));
    expect(m.subtypes).toEqual(['Mountain', 'Swamp']);
    expect(m.landTypes).toBe(LAND.Mountain | LAND.Swamp);
    expect(m.abilities).toEqual(['basic:B', 'basic:R']);
    expect(controlsLandType(s2, 1, ['Swamp'])).toBe(true);
    const u2 = characteristics(s2, id1(s2, TestUrborg.id));
    expect(u2.landTypes).toBe(LAND.Swamp);
    expect(u2.legendary).toBe(true);
  });

  it('manland overlay: creature with all creature types and base P/T, still a land', () => {
    const s = given({ battlefield: [TestManland.id] });
    const id = id1(s, TestManland.id);
    expect(characteristics(s, id).types).toBe(TYPE.Land);
    setField(s, id, 'animated', { types: ['Creature'], allCreatureTypes: true, pt: [2, 2] });
    const c = characteristics(s, id);
    expect(c.types).toBe(TYPE.Land | TYPE.Creature);
    expect(c.allCreatureTypes).toBe(true);
    expect([c.power, c.toughness]).toEqual([2, 2]);
  });

  it('P/T: counters, until-EOT deltas and a Monster Role add up; the Role grants trample (CR 613.4 (layer 7))', () => {
    const s = given({ battlefield: [TestBear.id] });
    const bear = id1(s, TestBear.id);
    addCounter(s, bear, 'p1p1', 2);
    addCounter(s, bear, 'm1m1', 1);
    addEffect(s, { eid: allocId(s), kind: 'ptDelta', target: bear, p: 2, t: 0, until: 'eot' });
    createToken(s, 'MonsterRole', 0, { attachedTo: bear });
    const c = characteristics(s, bear);
    expect([c.power, c.toughness]).toEqual([2 + 1 + 2 + 1, 2 + 1 + 0 + 1]);
    expect(hasKeyword(s, bear, 'trample')).toBe(true);
    expect(c.kw & KW.haste).toBe(0);
  });

  it('memo returns the cached object until a mutation, then recomputes', () => {
    const s = given({ battlefield: [TestBear.id] });
    const bear = id1(s, TestBear.id);
    const a = characteristics(s, bear);
    expect(characteristics(s, bear)).toBe(a);
    addEffect(s, { eid: allocId(s), kind: 'keywords', target: bear, keywords: ['haste'], until: 'eot' });
    const b = characteristics(s, bear);
    expect(b).not.toBe(a);
    expect(hasKeyword(s, bear, 'haste')).toBe(true);
  });

  it('copy token: copiable values of the original plus haste (CR 707.9b (copy exceptions)); mana value copied', () => {
    const s = given();
    const cp = createToken(s, 'Copy', 0, { copyOf: TestBear.id });
    const c = characteristics(s, cp);
    expect(c).toMatchObject({ name: 'Test Bear', power: 2, toughness: 2, manaValue: 2, isToken: true });
    expect(c.kw & KW.haste).toBe(KW.haste);
    const tr = createToken(s, 'Treasure', 0);
    expect(characteristics(s, tr).manaValue).toBe(0);
  });

  it('transformed back face uses the front face mana value (CR 712.8e (back face mana value))', () => {
    const s = given({ battlefield: [{ card: TestFlip.id, face: 1 }], hands: [[TestFlip.id], []] });
    const back = characteristics(s, id1(s, TestFlip.id));
    expect(back).toMatchObject({ name: 'Test Back', power: 2, toughness: 2, manaValue: 3 });
    expect(back.types & TYPE.Creature).toBe(TYPE.Creature);
    const inHand = characteristics(s, id1(s, TestFlip.id, 'hand'));
    expect(inHand.name).toBe('Test Front');
  });

  it('adventurer card: creature face everywhere except an Adventure spell on the stack (CR 715.4 (adventurer card))', () => {
    const s = given({ hands: [[TestAdv.id], []] });
    const id = id1(s, TestAdv.id, 'hand');
    expect(characteristics(s, id)).toMatchObject({ name: 'Test Giant', manaValue: 3 });
    const onStack = moveObject(s, id, 'stack', { face: 1 }) as ObjId;
    expect(characteristics(s, onStack)).toMatchObject({ name: 'Test Stomp', manaValue: 2 });
    const exiled = moveObject(s, onStack, 'exile', { onAdventure: true }) as ObjId;
    expect(s.objects[exiled]!.onAdventure).toBe(true);
    expect(characteristics(s, exiled).name).toBe('Test Giant');
  });

  it('room: locked halves have no name or mana cost on the battlefield (CR 709.5 (locked half))', () => {
    const s = given({ battlefield: [{ card: TestRoom2.id, unlocked: [true, false] }], hands: [[TestRoom2.id], []] });
    const onField = id1(s, TestRoom2.id);
    expect(characteristics(s, onField)).toMatchObject({ name: 'Test Annex', manaValue: 3 });
    setField(s, onField, 'unlocked', [true, true]);
    expect(characteristics(s, onField)).toMatchObject({ name: 'Test Annex // Test Chamber', manaValue: 8 });
    expect(characteristics(s, id1(s, TestRoom2.id, 'hand')).manaValue).toBe(8);
  });

  it('characteristic-defining P/T (Hearse-style) reads the object', () => {
    const s = given({ battlefield: [TestHearse.id] });
    const h = id1(s, TestHearse.id);
    setField(s, h, 'exiledWith', 3);
    expect([characteristics(s, h).power, characteristics(s, h).toughness]).toEqual([3, 3]);
  });

  it('classKey collapses identical permanents and separates tapped ones', () => {
    const s = given({ battlefield: ['Swamp', 'Swamp', { card: 'Swamp', tapped: true }, TestBolt.id] });
    const [a, b, c] = s.zones.battlefield as [ObjId, ObjId, ObjId];
    expect(classKey(s, a)).toBe(classKey(s, b));
    expect(classKey(s, a)).not.toBe(classKey(s, c));
  });
});
