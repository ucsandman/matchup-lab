// Casting and activation: adventure, Room and unlock, loyalty abilities, channel from hand, two
// required targets with different restrictions and partial fizzle, full fizzle, kicker.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { act as actDef, adventure, card, crew, face, room, spell, t, trig } from '../../cards/dsl.js';
import { isType } from '../../engine/statics.js';
import { act, castMove, hasCast, moves, O, P, pass } from '../scenario.js';
import type { Move } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);

const Giant = registerTestDef(adventure('Test St Giant // Test St Stomp',
  face({ name: 'Test St Giant', types: ['Creature'], subtypes: ['Giant'], cost: '{2}{R}', pt: [4, 3] }),
  face({
    name: 'Test St Stomp', types: ['Instant'], subtypes: ['Adventure'], cost: '{1}{R}',
    abilities: [spell({ target: t.any(), resolve: (ctx, [tg]) => { if (tg) ctx.dealDamage(tg, 2); } })],
  })));
const Annex = registerTestDef(room('Test St Annex // Test St Chamber',
  face({
    name: 'Test St Annex', types: ['Enchantment'], subtypes: ['Room'], cost: '{2}{B}',
    abilities: [trig('unlock', (ctx) => { ctx.gainLife(ctx.controller, 1); })],
  }),
  face({
    name: 'Test St Chamber', types: ['Enchantment'], subtypes: ['Room'], cost: '{1}{B}',
    abilities: [trig('unlock', (ctx) => { ctx.createToken('Demon', ctx.controller); })],
  })));
const Walker = registerTestDef(card('Test St Walker', [face({
  name: 'Test St Walker', types: ['Planeswalker'], cost: '{1}{B}', loyalty: 3,
  abilities: [
    actDef({ cost: { loyalty: 1 }, resolve: (ctx) => { ctx.loseLife(ctx.opponent, 1); } }),
    actDef({ cost: { loyalty: -2 }, target: t.creature(), resolve: (ctx, [tg]) => { if (tg?.kind === 'obj') ctx.destroy(tg.id); } }),
  ],
})]));
const Channel = registerTestDef(card('Test St Channel', [face({
  name: 'Test St Channel', types: ['Land'], supertypes: ['Legendary'],
  abilities: [actDef({ cost: { mana: '{1}{R}', discardSelf: true }, zone: 'hand', resolve: (ctx) => { ctx.createToken('Spirit', ctx.controller); } })],
})]));
const Rage = registerTestDef(card('Test St Rage', [face({
  name: 'Test St Rage', types: ['Instant'], cost: '{R}',
  abilities: [spell({
    targets: [t.creature({ controller: 'opponent' }), t.creature({ controller: 'you' })],
    resolve: (ctx, [a, b]) => { if (a) ctx.dealDamage(a, 4); if (b) ctx.dealDamage(b, 2); },
  })],
})]));
const Burst = registerTestDef(card('Test St Burst', [face({
  name: 'Test St Burst', types: ['Instant'], cost: '{R}',
  abilities: [spell({ kicker: '{4}', target: t.any(), resolve: (ctx, [tg]) => { if (tg) ctx.dealDamage(tg, ctx.item?.kicked ? 4 : 2); } })],
})]));
const Fizzler = registerTestDef(card('Test St Fizzler', [face({
  name: 'Test St Fizzler', types: ['Instant'], cost: '{R}',
  abilities: [spell({ target: t.creature(), resolve: (ctx, [tg]) => { if (tg) ctx.dealDamage(tg, 1); ctx.gainLife(ctx.controller, 3); } })],
})]));
const Buster = registerTestDef(card('Test St Buster', [face({
  name: 'Test St Buster', types: ['Artifact'], subtypes: ['Vehicle'], cost: '{2}', pt: [4, 4], abilities: [crew(3)],
})]));
const Goblin1 = registerTestDef(card('Test St Goblin', [face({ name: 'Test St Goblin', types: ['Creature'], cost: '{R}', pt: [1, 1] })]));
const Big = registerTestDef(card('Test St Big', [face({ name: 'Test St Big', types: ['Creature'], cost: '{2}', pt: [3, 5] })]));

describe('casting and activation', () => {
  it('CR 715.3d (exiles it): an Adventure resolves into exile and the creature is then cast from there', () => {
    const s = given({
      turn: 1, step: 'main1', battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[Giant.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Test St Giant // Test St Stomp', [P(1)], (m) => m.face === 1));
    pass(s);
    expect(s.players[1].life).toBe(18);
    const ex = s.zones.exile[0][0]!;
    expect(s.objects[ex]).toMatchObject({ onAdventure: true });
    // From exile only the creature half is castable.
    const cm = moves(s).filter((m): m is Extract<Move, { type: 'cast' }> => m.type === 'cast' && m.objId === ex);
    expect(cm.length).toBe(1);
    expect(cm[0]!.face).toBeUndefined();
    act(s, cm[0]!);
    pass(s);
    expect(ids(s, Giant.id).length).toBe(1);
  });

  it('Rooms: the cast door enters unlocked and its unlock ability triggers (CR 709.5h (unlocks)); CR 116.2m (unlock cost) special action', () => {
    const s = given({
      turn: 1, step: 'main1', battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', { card: 'Mountain', controller: 1 }],
      hands: [[Annex.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Test St Annex // Test St Chamber', [], (m) => (m.face ?? 0) === 0));
    pass(s);
    const annex = id1(s, Annex.id);
    expect(s.objects[annex]!.unlocked).toEqual([true, false]);
    pass(s); // player 1 lets the unlock trigger resolve
    expect(s.players[0].life).toBe(21);
    const unlock = moves(s).find((m) => m.type === 'unlockDoor');
    expect(unlock).toEqual({ type: 'unlockDoor', objId: annex, half: 1 });
    act(s, unlock!);
    // A special action: player 0 keeps priority, the stack holds only the trigger.
    expect(s.objects[annex]!.unlocked).toEqual([true, true]);
    pass(s);
    expect(ids(s, 'token-demon').length).toBe(1);
  });

  it('CR 606.3 (loyalty ability): sorcery timing, once per turn per planeswalker', () => {
    const s = given({
      turn: 1, step: 'main1', battlefield: [{ card: Walker.id, counters: { loyalty: 3 } }, { card: TestBear.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const w = id1(s, Walker.id);
    const acts = moves(s).filter((m) => m.type === 'activate');
    expect(acts.length).toBe(2);
    act(s, acts[0]!);
    expect(s.objects[w]!.counters.loyalty).toBe(4);
    pass(s);
    expect(s.players[1].life).toBe(19);
    // Player 0 has priority again with an empty stack, but the walker was used this turn.
    expect(moves(s).filter((m) => m.type === 'activate').length).toBe(0);
  });

  it('channel: an ability activated from the hand, discarding the card as a cost', () => {
    const s = given({ turn: 1, step: 'main1', battlefield: ['Mountain', 'Mountain'], hands: [[Channel.id], []], libraries: [lib(5), lib(5)] });
    const m = moves(s).find((x) => x.type === 'activate');
    expect(m).toBeDefined();
    act(s, m!);
    expect(ids(s, Channel.id, 'graveyard', 0).length).toBe(1);
    expect(ids(s, 'token-spirit').length).toBe(1);
  });

  it('two required targets with different restrictions; CR 608.2b (illegal targets) partial fizzle', () => {
    const s = given({
      turn: 1, step: 'main1',
      battlefield: ['Mountain', 'Mountain', Big.id, { card: TestBear.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[Rage.id, TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const mine = id1(s, Big.id);
    const theirs = id1(s, TestBear.id);
    const rage = moves(s).filter((m) => m.type === 'cast' && s.objects[m.objId]!.defId === Rage.id);
    expect(rage.length).toBe(1);
    expect((rage[0] as Extract<Move, { type: 'cast' }>).targets).toEqual([O(theirs), O(mine)]);
    act(s, rage[0]!);
    pass(s); // player 0 passes, player 1 responds
    // Player 1 kills its own Bear in response: Rage still deals 2 to Big.
    act(s, castMove(s, TestBolt.name, [O(theirs)]));
    pass(s); // player 0 passes (player 1 auto-passes): the Bolt resolves
    expect(ids(s, TestBear.id, 'graveyard', 1).length).toBe(1);
    pass(s); // Rage resolves with one illegal target
    expect(s.zones.stack.length).toBe(0);
    expect(s.objects[mine]!.damage).toBe(2);
    expect(ids(s, Rage.id, 'graveyard', 0).length).toBe(1);
  });

  it('CR 608.2b (illegal): a spell whose only target is gone does not resolve (no part of its effect happens)', () => {
    const s = given({
      turn: 1, step: 'main1',
      battlefield: ['Mountain', { card: TestBear.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[Fizzler.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const bear = id1(s, TestBear.id);
    act(s, castMove(s, Fizzler.name, [O(bear)]));
    act(s, castMove(s, TestBolt.name, [O(bear)]));
    expect(ids(s, TestBear.id, 'graveyard', 1).length).toBe(1);
    expect(ids(s, Fizzler.id, 'graveyard', 0).length).toBe(1);
    expect(s.players[0].life).toBe(20);
  });

  it('CR 702.33a (kicker): the kicked variant is offered only when the kicker can be paid', () => {
    const one = given({ turn: 1, step: 'main1', battlefield: ['Mountain'], hands: [[Burst.id], []], libraries: [lib(5), lib(5)] });
    expect(moves(one).some((m) => m.type === 'cast' && m.kicked)).toBe(false);
    const five = given({ turn: 1, step: 'main1', battlefield: ['Mountain', 'Mountain', 'Mountain', 'Swamp', 'Swamp'], hands: [[Burst.id], []], libraries: [lib(5), lib(5)] });
    expect(hasCast(five, Burst.name)).toBe(true);
    const kicked = moves(five).find((m) => m.type === 'cast' && m.kicked === true);
    expect(kicked).toBeDefined();
    act(five, kicked!);
    expect(five.players[1].life).toBe(16);
  });

  it('CR 702.122a (crew): minimal crews offered, the crew is tapped, the Vehicle becomes a creature until end of turn', () => {
    const s = given({
      turn: 1, step: 'main1', battlefield: [Buster.id, TestBear.id, TestBear.id, { card: Goblin1.id, sick: true }, { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const bus = id1(s, Buster.id);
    const crews = moves(s).filter((m): m is Extract<Move, { type: 'activate' }> => m.type === 'activate' && m.objId === bus);
    // Bear + Goblin (3) and Bear + Bear (4); summoning-sick creatures may crew; no crew of three.
    expect(crews.map((m) => m.crewWith!.map((id) => s.objects[id]!.defId).sort())).toEqual([
      [Goblin1.id, TestBear.id].sort(), [TestBear.id, TestBear.id],
    ]);
    expect(isType(s, bus, 'Creature')).toBe(false);
    act(s, crews[0]!);
    pass(s);
    expect(isType(s, bus, 'Creature')).toBe(true);
    expect(s.objects[bus]!.crewed).toBe(true);
    expect(crews[0]!.crewWith!.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
});
