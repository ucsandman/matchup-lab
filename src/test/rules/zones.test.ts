import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear } from '../helpers.js';
import { card, face, land, mana, room, saga, stat } from '../../cards/dsl.js';
import {
  createToken, destroy, die, discard, drawCard, mill, moveObject, NeedChoice, sacrifice, scry1, shuffleLibrary,
} from '../../engine/zones.js';
import { runWithChoices } from '../../engine/ctx.js';
import { addEffect, allocId, drainEvents } from '../../engine/mutate.js';
import { characteristics } from '../../engine/statics.js';
import type { GameEvent, GameState, ObjId } from '../../engine/types.js';

// Test-only defs for replacement and enters-the-battlefield behavior.
const TestExiler = registerTestDef(card('Test Exiler', [face({
  name: 'Test Exiler', types: ['Creature'], cost: '{2}{B}{B}', pt: [3, 4],
  abilities: [stat({
    category: 'dieReplacement',
    applies: (ctx, dying) => {
      const o = ctx.obj(dying);
      return !!o && o.controller !== ctx.controller && !o.token && ctx.isType(dying, 'Creature');
    },
    after: (ctx) => { ctx.createToken('Zombie', ctx.controller); },
  })],
})]));
const TestFastLand = registerTestDef(card('Test Fast Land', [land({
  name: 'Test Fast Land', mana: [mana({ produce: ['B', 'R'] })],
  entersTapped: (ctx) => ctx.permanents(ctx.controller, (id) => ctx.isType(id, 'Land')).length >= 3,
})]));
const TestShock = registerTestDef(card('Test Shock', [land({ name: 'Test Shock', subtypes: ['Swamp', 'Mountain'], payLifeToUntap: 2 })]));
const TestSaga = registerTestDef(card('Test Saga', [face({
  name: 'Test Saga', types: ['Enchantment'], subtypes: ['Saga'], cost: '{2}{R}',
  abilities: saga([(ctx) => { ctx.createToken('GoblinShaman', ctx.controller); }, () => {}, () => {}]),
})]));
const TestWalker = registerTestDef(card('Test Walker', [face({ name: 'Test Walker', types: ['Planeswalker'], cost: '{1}{B}{B}', loyalty: 3 })]));
const TestRoom = registerTestDef(room('Test Left // Test Right',
  face({ name: 'Test Left', types: ['Enchantment'], subtypes: ['Room'], cost: '{2}{B}' }),
  face({ name: 'Test Right', types: ['Enchantment'], subtypes: ['Room'], cost: '{3}{B}{B}' })));

const lastEvent = (s: GameState): GameEvent | undefined => s.events[s.events.length - 1];

describe('moveObject', () => {
  it('re-ids on every zone change and records last known information (CR 400.7 (new object))', () => {
    const s = given({ battlefield: [TestBear.id] });
    const bear = id1(s, TestBear.id);
    const nid = moveObject(s, bear, 'graveyard', { cause: 'destroy' }) as ObjId;
    expect(nid).not.toBe(bear);
    expect(s.objects[bear]).toBeUndefined();
    expect(s.objects[nid]!.zone).toBe('graveyard');
    expect(s.zones.graveyard[0]).toEqual([nid]);
    const ev = lastEvent(s);
    expect(ev).toMatchObject({ e: 'zoneChange', oldId: bear, newId: nid, from: 'battlefield', to: 'graveyard' });
    expect(ev && ev.e === 'zoneChange' && ev.lki?.defId).toBe(TestBear.id);
    expect(s.turnFlags.permanentLeft[0]).toBe(true);
  });

  it('a token that leaves the battlefield ceases to exist (CR 111.7 (token ceases to exist))', () => {
    const s = given();
    const t = createToken(s, 'Treasure', 0);
    expect(s.objects[t]!.token).toBe('token-treasure');
    expect(moveObject(s, t, 'graveyard')).toBeNull();
    expect(s.objects[t]).toBeUndefined();
    expect(s.zones.graveyard[0]).toEqual([]);
    expect(lastEvent(s)).toMatchObject({ e: 'zoneChange', oldId: t, newId: null, to: 'graveyard' });
    expect(s.turnFlags.permanentLeft[0]).toBe(true);
  });

  it('drawing reveals the card to its owner only; drawing from an empty library sets the 704.5b flag', () => {
    const s = given({ libraries: [['Swamp'], []] });
    const id = drawCard(s, 0) as ObjId;
    expect(s.objects[id]!.knownTo).toEqual([true, false]);
    expect(drawCard(s, 0)).toBeNull();
    // CR 704.5b (draw from empty library): the SBA reads this flag.
    expect(s.players[0].drewFromEmpty).toBe(true);
  });

  it('discard and mill move to the graveyard and buffer their events', () => {
    const s = given({ hands: [['Swamp'], []], libraries: [['Mountain', 'Swamp', TestBear.id], []] });
    discard(s, id1(s, 'Swamp', 'hand'));
    mill(s, 0, 2);
    expect(s.zones.graveyard[0].map((i) => s.objects[i]!.defId)).toEqual(['swamp', 'mountain', 'swamp']);
    expect(s.zones.library[0].length).toBe(1);
    expect(s.events.filter((e) => e.e === 'mill').length).toBe(2);
    expect(s.events.filter((e) => e.e === 'discard').length).toBe(1);
  });

  it('libraryKnown follows scry and bottoming; a shuffle clears it and re-ids the library', () => {
    const s = given({ hands: [['Swamp'], []], libraries: [['Mountain', TestBear.id, 'Mountain'], []] });
    const top = s.zones.library[0][2] as ObjId;
    scry1(s, 0, false);
    expect(s.players[0].libraryKnown.top).toEqual([top]);
    scry1(s, 0, true);
    expect(s.zones.library[0][0]).toBe(top);
    expect(s.players[0].libraryKnown).toEqual({ top: [], bottom: [top] });
    const b = moveObject(s, id1(s, 'Swamp', 'hand'), 'library', { position: 'bottom' }) as ObjId;
    expect(s.players[0].libraryKnown.bottom).toEqual([b, top]);
    const before = [...s.zones.library[0]];
    shuffleLibrary(s, 0);
    expect(s.players[0].libraryKnown).toEqual({ top: [], bottom: [] });
    expect(s.zones.library[0].some((i) => before.includes(i))).toBe(false);
    expect(s.zones.library[0].length).toBe(4);
  });

  it('enters-tapped replacements are evaluated before the land enters (CR 614.12 (enters replacement))', () => {
    const s = given({ battlefield: ['Swamp', 'Mountain'], hands: [[TestFastLand.id, TestFastLand.id], []] });
    const a = moveObject(s, id1(s, TestFastLand.id, 'hand'), 'battlefield') as ObjId;
    expect(s.objects[a]!.tapped).toBe(false); // two other lands
    const b = moveObject(s, id1(s, TestFastLand.id, 'hand'), 'battlefield') as ObjId;
    expect(s.objects[b]!.tapped).toBe(true); // three other lands
  });

  it('shock land: pay 2 life to enter untapped, otherwise tapped', () => {
    const s = given({ hands: [[TestShock.id, TestShock.id], []] });
    const a = moveObject(s, id1(s, TestShock.id, 'hand'), 'battlefield', { payLife: true }) as ObjId;
    expect(s.objects[a]!.tapped).toBe(false);
    expect(s.players[0].life).toBe(18);
    const b = moveObject(s, id1(s, TestShock.id, 'hand'), 'battlefield') as ObjId;
    expect(s.objects[b]!.tapped).toBe(true);
    expect(s.players[0].life).toBe(18);
  });

  it('sagas enter with a lore counter, planeswalkers with loyalty, rooms with the cast half unlocked', () => {
    const s = given({ hands: [[TestSaga.id, TestWalker.id, TestRoom.id], []] });
    drainEvents(s);
    const sg = moveObject(s, id1(s, TestSaga.id, 'hand'), 'battlefield') as ObjId;
    // CR 714.3a (saga lore counter)
    expect(s.objects[sg]!.counters).toEqual({ lore: 1 });
    expect(s.events.some((e) => e.e === 'counterAdded' && e.id === sg && e.counter === 'lore')).toBe(true);
    const pw = moveObject(s, id1(s, TestWalker.id, 'hand'), 'battlefield') as ObjId;
    // CR 306.5b (loyalty counters)
    expect(s.objects[pw]!.counters).toEqual({ loyalty: 3 });
    const rm = moveObject(s, id1(s, TestRoom.id, 'hand'), 'battlefield', { unlockHalf: 1 }) as ObjId;
    expect(s.objects[rm]!.unlocked).toEqual([false, true]);
    expect(s.objects[rm]!.sick).toBe(true);
  });
});

describe('die choke point', () => {
  it('no replacement: destroy puts the permanent into the graveyard', () => {
    const s = given({ battlefield: [TestBear.id] });
    const nid = destroy(s, id1(s, TestBear.id)) as ObjId;
    expect(s.objects[nid]!.zone).toBe('graveyard');
  });

  it('one replacement (exile-if-dies effect) applies without a choice', () => {
    const s = given({ battlefield: [{ card: TestBear.id, controller: 1 }] });
    const bear = id1(s, TestBear.id);
    addEffect(s, { eid: allocId(s), kind: 'exileIfDies', target: bear, until: 'eot' });
    const nid = sacrifice(s, bear) as ObjId;
    expect(s.objects[nid]!.zone).toBe('exile');
  });

  it('two replacements: the affected creature\'s controller chooses (CR 616.1 (affected object\'s controller))', () => {
    const s = given({ battlefield: [TestExiler.id, { card: TestBear.id, controller: 1 }] });
    const bear = id1(s, TestBear.id);
    addEffect(s, { eid: allocId(s), kind: 'exileIfDies', target: bear, until: 'eot' });
    let thrown: unknown;
    try { die(s, [bear], 'destroy'); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(NeedChoice);
    const ch = (thrown as NeedChoice).choice;
    expect(ch).toMatchObject({ kind: 'dieReplacement', player: 1, objId: bear });
    expect(ch.kind === 'dieReplacement' && ch.options.length).toBe(2);
    // Nothing moved before the choice.
    expect(s.objects[bear]!.zone).toBe('battlefield');

    // Choosing the static (index 1) exiles the creature and runs its 'after' (a Zombie for player 0).
    const [nid] = die(s, [bear], 'destroy', () => ({ index: 1 }));
    expect(s.objects[nid as ObjId]!.zone).toBe('exile');
    expect(ids(s, 'token-zombie', 'battlefield', 0).length).toBe(1);
  });

  it('choosing the effect instead gives no Zombie', () => {
    const s = given({ battlefield: [TestExiler.id, { card: TestBear.id, controller: 1 }] });
    const bear = id1(s, TestBear.id);
    addEffect(s, { eid: allocId(s), kind: 'exileIfDies', target: bear, until: 'eot' });
    die(s, [bear], 'destroy', () => ({ index: 0 }));
    expect(ids(s, 'token-zombie').length).toBe(0);
    expect(s.zones.exile[1].length).toBe(1);
  });

  it('runWithChoices rolls back to the choice point, then completes with the answer', () => {
    const s = given({ battlefield: [TestExiler.id, { card: TestBear.id, controller: 1 }, 'Swamp'] });
    const bear = id1(s, TestBear.id);
    addEffect(s, { eid: allocId(s), kind: 'exileIfDies', target: bear, until: 'eot' });
    const swamp = id1(s, 'Swamp');
    const before = JSON.stringify(s);
    const run = (answers: { index: number }[]) => runWithChoices(s, answers, (pick) => {
      destroy(s, swamp, pick); // a change made before the choice, which must be rolled back
      return destroy(s, bear, pick);
    });
    const first = run([]);
    expect(first.done).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
    expect(s.journal).toBeUndefined();
    const second = run([{ index: 1 }]);
    expect(second.done).toBe(true);
    expect(s.zones.graveyard[0].length).toBe(1);
    expect(s.zones.exile[1].length).toBe(1);
  });

  it('Kalitas-style replacement ignores tokens and own creatures', () => {
    const s = given({ battlefield: [TestExiler.id, TestBear.id, { card: TestBear.id, controller: 1, token: true }] });
    const own = ids(s, TestBear.id, 'battlefield', 0)[0] as ObjId;
    const tok = ids(s, TestBear.id, 'battlefield', 1)[0] as ObjId;
    die(s, [own, tok], 'destroy');
    expect(s.zones.graveyard[0].length).toBe(1);
    expect(s.objects[tok]).toBeUndefined();
    expect(ids(s, 'token-zombie').length).toBe(0);
  });
});

describe('tokens', () => {
  it('createToken: owner and controller are the creator (CR 111.2 (token owner)), summoning sick, public', () => {
    const s = given();
    const t = createToken(s, 'GoblinShaman', 1, { tapped: true });
    const o = s.objects[t]!;
    expect(o).toMatchObject({ owner: 1, controller: 1, zone: 'battlefield', tapped: true, sick: true, knownTo: [true, true] });
    expect(characteristics(s, t)).toMatchObject({ name: 'Goblin Shaman', power: 2, toughness: 2, isToken: true, manaValue: 0 });
    expect(s.events.map((e) => e.e)).toEqual(['tokenCreated', 'zoneChange']);
  });

  it('all eleven token defs can be created', () => {
    const s = given({ battlefield: [TestBear.id] });
    const names = ['Blood', 'Treasure', 'GoblinShaman', 'Zombie', 'Spirit', 'Goblin', 'Pilot', 'Demon', 'Dragon', 'MonsterRole', 'Copy'];
    const bear = id1(s, TestBear.id);
    for (const n of names) createToken(s, n, 0, n === 'MonsterRole' ? { attachedTo: bear } : n === 'Copy' ? { copyOf: TestBear.id } : {});
    console.log(`token defs created: ${names.length}`);
    expect(s.zones.battlefield.length).toBe(1 + names.length);
  });
});
