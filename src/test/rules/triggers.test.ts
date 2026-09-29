// Triggered abilities: APNAP order, the controller's order choice, intervening-if, delayed
// triggers, triggers with no legal target, ward, prowess, summed simultaneous damage, dies
// triggers that look back in time.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt, type Given } from '../helpers.js';
import { card, face, spell, stat, t, trig } from '../../cards/dsl.js';
import { characteristics } from '../../engine/statics.js';
import { act, advance, answer, castMove, moves, O, P, pass, who } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);

const EachUpkeep = registerTestDef(card('Test Tr Clock', [face({
  name: 'Test Tr Clock', types: ['Enchantment'], cost: '{1}',
  abilities: [trig('upkeep', { scope: 'any' }, (ctx) => { ctx.loseLife(ctx.controller, 1); })],
})]));
const Twin = registerTestDef(card('Test Tr Twin', [face({
  name: 'Test Tr Twin', types: ['Enchantment'], cost: '{1}',
  abilities: [
    trig('upkeep', (ctx) => { ctx.gainLife(ctx.controller, 1); }),
    trig('upkeep', (ctx) => { ctx.loseLife(ctx.opponent, 1); }),
  ],
})]));
const Scholar = registerTestDef(card('Test Tr Scholar', [face({
  name: 'Test Tr Scholar', types: ['Enchantment'], cost: '{1}',
  abilities: [trig('upkeep', { interveningIf: (ctx) => ctx.state.players[ctx.controller].life >= 10 }, (ctx) => { ctx.draw(ctx.controller); })],
})]));
const Timer = registerTestDef(card('Test Tr Timer', [face({
  name: 'Test Tr Timer', types: ['Instant'], cost: '{R}',
  abilities: [
    spell({ resolve: (ctx) => { ctx.addDelayed('endStep', 1); } }),
    trig('delayed', (ctx) => { ctx.loseLife(ctx.opponent, 2); }),
  ],
})]));
const Sniper = registerTestDef(card('Test Tr Sniper', [face({
  name: 'Test Tr Sniper', types: ['Creature'], cost: '{1}{R}', pt: [1, 1],
  abilities: [trig('etb', { targets: [t.creature({ controller: 'opponent' })] }, (ctx, [tg]) => { if (tg) ctx.dealDamage(tg, 1); })],
})]));
const Warded = registerTestDef(card('Test Tr Warded', [face({
  name: 'Test Tr Warded', types: ['Creature'], cost: '{2}', pt: [2, 5], keywords: ['ward'],
  abilities: [stat({ category: 'marker', marker: 'ward', wardCost: { discard: 1 } })],
})]));
const Monk = registerTestDef(card('Test Tr Monk', [face({ name: 'Test Tr Monk', types: ['Creature'], cost: '{R}', pt: [1, 2], keywords: ['prowess'] })]));
const Screamer = registerTestDef(card('Test Tr Screamer', [face({
  name: 'Test Tr Screamer', types: ['Creature'], cost: '{2}{R}', pt: [3, 6],
  abilities: [trig('dealtDamage', (ctx, _t, info) => { ctx.dealDamage({ kind: 'player', p: ctx.opponent }, info.amount ?? 0); })],
})]));
const Mourner = registerTestDef(card('Test Tr Mourner', [face({
  name: 'Test Tr Mourner', types: ['Creature'], cost: '{1}', pt: [1, 1],
  abilities: [trig('dies', { scope: 'any', filter: (_ctx, info) => info.objId !== undefined }, (ctx) => { ctx.gainLife(ctx.controller, 1); })],
})]));
const Pyro = registerTestDef(card('Test Tr Pyro', [face({
  name: 'Test Tr Pyro', types: ['Sorcery'], cost: '{R}',
  abilities: [spell({ resolve: (ctx) => { for (const id of [...ctx.state.zones.battlefield]) if (ctx.isType(id, 'Creature')) ctx.dealDamage({ kind: 'obj', id }, 2); } })],
})]));

function upkeepState(bf: Given['battlefield'], extra: Partial<Given> = {}): GameState {
  return given({
    turn: 1, step: 'draw', active: 0, battlefield: bf ?? [], hands: [[TestBolt.id], [TestBolt.id]],
    libraries: [lib(10), lib(10)], ...extra,
  });
}

describe('triggers', () => {
  it('CR 603.3b (APNAP order): the active player\'s trigger goes on the stack first, so the other resolves first', () => {
    // Start at player 1's end step so the next turn's upkeep is player 0's.
    const s = given({
      turn: 1, step: 'end', active: 1,
      battlefield: [EachUpkeep.id, { card: EachUpkeep.id, controller: 1 }, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(10), lib(10)],
    });
    while (s.step !== 'upkeep') pass(s);
    expect(s.activePlayer).toBe(0);
    expect(s.zones.stack.map((x) => x.controller)).toEqual([0, 1]);
    pass(s, 2);
    expect(s.players[1].life).toBe(19);
    expect(s.players[0].life).toBe(20);
    expect(s.zones.stack.length).toBe(1);
  });

  it('the controller orders their own simultaneous triggers when order can matter', () => {
    const s = given({
      turn: 1, step: 'end', active: 1,
      battlefield: [Twin.id, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(10), lib(10)],
    });
    while (s.step !== 'upkeep' && !s.pendingChoice) pass(s);
    expect(s.pendingChoice).toMatchObject({ kind: 'pickIndex', player: 0, reason: 'orderTriggers', count: 2 });
    expect(moves(s).length).toBe(2);
    answer(s, { index: 1 }); // the second ability goes on the stack first (resolves last)
    const keys = s.zones.stack.map((x) => x.abilityKey);
    expect(keys).toEqual([`${Twin.id}:0:1`, `${Twin.id}:0:0`]);
  });

  it('identical simultaneous triggers are not ordered (no Choice)', () => {
    const s = given({
      turn: 1, step: 'end', active: 1,
      battlefield: [EachUpkeep.id, EachUpkeep.id, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(10), lib(10)],
    });
    while (s.step !== 'upkeep') pass(s);
    expect(s.pendingChoice).toBeNull();
    expect(s.zones.stack.length).toBe(2);
  });

  it('CR 603.4 (intervening if): checked when it triggers and again on resolution', () => {
    const s = upkeepState([Scholar.id, 'Mountain', { card: 'Mountain', controller: 1 }], { step: 'end', active: 1 });
    while (s.step !== 'upkeep') pass(s);
    expect(s.zones.stack.length).toBe(1);
    const hand = s.zones.hand[0].length;
    // In response, player 1 drops player 0 to 9: the draw does not happen.
    s.players[0].life = 12;
    pass(s);
    act(s, castMove(s, TestBolt.name, [P(0)]));
    pass(s, 2);
    expect(s.players[0].life).toBe(9);
    expect(s.zones.stack.length).toBe(0);
    expect(s.zones.hand[0].length).toBe(hand);
    // Below 10 at the trigger event: it does not trigger at all.
    const s2 = upkeepState([Scholar.id, 'Mountain', { card: 'Mountain', controller: 1 }], { step: 'end', active: 1, life: [5, 20] });
    while (s2.step !== 'upkeep') pass(s2);
    expect(s2.zones.stack.length).toBe(0);
  });

  it('CR 603.7a (delayed trigger): fires at the next end step only, once', () => {
    const s = given({
      turn: 1, step: 'main1', active: 0,
      battlefield: ['Mountain', 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[Timer.id, TestBolt.id], [TestBolt.id]], libraries: [lib(10), lib(10)],
    });
    act(s, castMove(s, Timer.name));
    pass(s, 2);
    expect(s.delayed.length).toBe(1);
    expect(s.players[1].life).toBe(20);
    while (s.step !== 'end') pass(s);
    expect(s.zones.stack.length).toBe(1);
    pass(s, 2);
    expect(s.players[1].life).toBe(18);
    expect(s.delayed.length).toBe(0);
    while (s.turn < 3) pass(s);
    while ((s.step as string) !== 'main1') pass(s);
    expect(s.players[1].life).toBe(18);
  });

  it('CR 603.3d (no legal target): the trigger is removed; with several targets the controller picks', () => {
    const s = given({ turn: 1, step: 'main1', battlefield: ['Mountain', 'Mountain'], hands: [[Sniper.id], []], libraries: [lib(5), lib(5)] });
    act(s, castMove(s, Sniper.name));
    // Sniper resolved and its ETB had no opposing creature to target: nothing on the stack.
    expect(ids(s, Sniper.id).length).toBe(1);
    expect(s.zones.stack.length).toBe(0);
    const s2 = given({
      turn: 1, step: 'main1',
      battlefield: ['Mountain', 'Mountain', { card: TestBear.id, controller: 1 }, { card: Monk.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[Sniper.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    act(s2, castMove(s2, Sniper.name));
    pass(s2); // player 1 lets Sniper resolve
    expect(s2.pendingChoice).toMatchObject({ kind: 'pickTargets', player: 0 });
    answer(s2, { index: 1 });
    pass(s2); // player 1 lets the trigger resolve
    expect(s2.objects[id1(s2, Monk.id)]!.damage + s2.objects[id1(s2, TestBear.id)]!.damage).toBe(1);
  });

  it('CR 702.21a (ward): the targeting player pays (discard) or the spell is countered', () => {
    const mk = (): GameState => given({
      turn: 1, step: 'main1', battlefield: ['Mountain', { card: Warded.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id, TestBear.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const s = mk();
    const w = id1(s, Warded.id);
    act(s, castMove(s, TestBolt.name, [O(w)]));
    pass(s); // player 1 lets the ward trigger resolve
    expect(s.pendingChoice).toMatchObject({ kind: 'pickIndex', player: 0, reason: 'wardPay' });
    answer(s, { index: 0 }); // decline
    expect(s.objects[w]!.damage).toBe(0);
    expect(ids(s, TestBolt.id, 'graveyard', 0).length).toBe(1);
    const s2 = mk();
    const w2 = id1(s2, Warded.id);
    act(s2, castMove(s2, TestBolt.name, [O(w2)]));
    pass(s2);
    answer(s2, { index: 1 }); // pay: the only card left in hand is discarded
    pass(s2); // player 1 lets Bolt resolve
    expect(s2.zones.hand[0].length).toBe(0);
    expect(s2.objects[w2]!.damage).toBe(3);
  });

  it('CR 702.108a (prowess): a noncreature spell gives +1/+1 until end of turn', () => {
    const s = given({ turn: 1, step: 'main1', battlefield: ['Mountain', Monk.id], hands: [[TestBolt.id], []], libraries: [lib(5), lib(5)] });
    const monk = id1(s, Monk.id);
    act(s, castMove(s, TestBolt.name, [P(1)]));
    expect(characteristics(s, monk).power).toBe(2);
  });

  it('simultaneous damage from several sources triggers a dealt-damage ability once with the total (PLAN.md D12)', () => {
    const s = given({
      turn: 1, step: 'main1', battlefield: ['Mountain', { card: Screamer.id, controller: 1 }],
      hands: [[Pyro.id], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, Pyro.name));
    expect(s.players[0].life).toBe(18);
    // Combat: two blockers dealing 2 + 2 at once make one trigger for 4.
    const s2 = given({
      turn: 2, step: 'main1', active: 1,
      battlefield: [{ card: Screamer.id, controller: 1 }, TestBear.id, TestBear.id],
      libraries: [lib(10), lib(10)],
    });
    const scr = id1(s2, Screamer.id);
    pass(s2, 0);
    while (s2.pendingChoice?.kind !== 'declareAttackers') act(s2, { type: 'pass' });
    act(s2, { type: 'declareAttackers', assignments: [[scr, { kind: 'player', p: 0 }]] });
    const [b1, b2] = ids(s2, TestBear.id);
    act(s2, { type: 'declareBlockers', assignments: [[b1!, scr], [b2!, scr]] });
    expect(s2.players[0].life).toBe(16);
  });

  it('CR 603.10a (look back in time): creatures dying together see each other die', () => {
    const s = given({
      turn: 1, step: 'main1', battlefield: ['Mountain', { card: Mourner.id, controller: 1 }, { card: Mourner.id, controller: 1 }],
      hands: [[Pyro.id], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, Pyro.name));
    // Each Mourner triggers for both deaths: 4 life.
    expect(ids(s, Mourner.id, 'graveyard', 1).length).toBe(2);
    expect(s.players[1].life).toBe(24);
    expect(advance).toBeDefined();
    expect(who).toBeDefined();
  });
});
