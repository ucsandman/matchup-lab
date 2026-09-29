// Combat: menace, trample with deathtouch, lifelink timing, tokens entering attacking, summoning
// sickness of animated lands, flying, attacking planeswalkers, and the collapsed attack options.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt, type Given } from '../helpers.js';
import { act as actDef, card, face, land, trig } from '../../cards/dsl.js';
import { attackCandidates, attackOptions, blockOptions, checkBlocks } from '../../engine/combat.js';
import { makeCtx } from '../../engine/ctx.js';
import { act, pass, who } from '../scenario.js';
import type { Defender, GameState, ObjId } from '../../engine/types.js';

const mk = (name: string, pt: [number, number], keywords: Parameters<typeof face>[0]['keywords'] = [], abilities: Parameters<typeof face>[0]['abilities'] = []) =>
  registerTestDef(card(name, [face({ name, types: ['Creature'], cost: '{1}', pt, keywords, abilities })]));

const Menace = mk('Test Cb Menace', [3, 3], ['menace']);
const Tramp = mk('Test Cb Trampler', [3, 3], ['trample', 'deathtouch']);
const Wall = mk('Test Cb Wall', [2, 4]);
const Linker = mk('Test Cb Linker', [2, 2], ['lifelink']);
const Flier = mk('Test Cb Flier', [1, 1], ['flying']);
const Den = mk('Test Cb Den', [3, 2], [], [
  trig('attacks', (ctx) => {
    const d = ctx.obj(ctx.source)?.attacking;
    if (d) ctx.createToken('Goblin', ctx.controller, { tapped: true, attacking: d });
  }),
]);
const Vault = registerTestDef(card('Test Cb Vault', [land({
  name: 'Test Cb Vault', mana: [],
  abilities: [actDef({ cost: { mana: '{1}' }, resolve: (ctx) => { ctx.animate(ctx.source, { types: ['Creature'], pt: [2, 2], allCreatureTypes: true }); } })],
})]));

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const toP1: Defender = { kind: 'player', p: 1 };

/** Player 0 at declare attackers with these permanents. */
function combat(bf: Given['battlefield'], life: [number, number] = [20, 20]): GameState {
  const s = given({ turn: 2, step: 'main1', active: 0, battlefield: bf ?? [], life, libraries: [lib(10), lib(10)] });
  pass(s, 0);
  act(s, { type: 'pass' });
  return s;
}

describe('combat', () => {
  it('CR 702.111b (menace): one blocker is illegal, two are legal', () => {
    const s = combat([Menace.id, { card: Wall.id, controller: 1 }, { card: TestBear.id, controller: 1 }]);
    const m = id1(s, Menace.id);
    act(s, { type: 'declareAttackers', assignments: [[m, toP1]] });
    expect(s.pendingChoice).toMatchObject({ kind: 'declareBlockers', player: 1 });
    const wall = id1(s, Wall.id);
    const bear = id1(s, TestBear.id);
    expect(checkBlocks(s, [[wall, m]])).toMatch(/menace/);
    expect(checkBlocks(s, [[wall, m], [bear, m]])).toBeNull();
    const opts = blockOptions(s, 1);
    expect(opts.every((o) => o.length !== 1)).toBe(true);
    expect(opts.some((o) => o.length === 2)).toBe(true);
    expect(() => act(s, { type: 'declareBlockers', assignments: [[wall, m]] })).toThrow(/menace/);
  });

  it('CR 702.19b (trample) with CR 702.2c (deathtouch lethal): 1 to the blocker, the rest to the player', () => {
    const s = combat([Tramp.id, { card: Wall.id, controller: 1 }]);
    const t = id1(s, Tramp.id);
    const wall = id1(s, Wall.id);
    act(s, { type: 'declareAttackers', assignments: [[t, toP1]] });
    act(s, { type: 'declareBlockers', assignments: [[wall, t]] });
    expect(s.players[1].life).toBe(18);
    expect(ids(s, Wall.id, 'graveyard', 1).length).toBe(1);
    expect(ids(s, Tramp.id).length).toBe(1); // 2 damage from the wall on a 3/3
  });

  it('CR 702.15b (lifelink): gain is simultaneous with the damage, so a lifelinking blocker saves its controller', () => {
    // Player 1 is at 2. Two attackers: one unblocked deals 2; the other is blocked by the lifelinker.
    const s = combat([TestBear.id, { card: Wall.id }, { card: Linker.id, controller: 1 }], [20, 2]);
    const bear = id1(s, TestBear.id);
    const wall = id1(s, Wall.id);
    const linker = id1(s, Linker.id);
    act(s, { type: 'declareAttackers', assignments: [[bear, toP1], [wall, toP1]] });
    act(s, { type: 'declareBlockers', assignments: [[linker, wall]] });
    // 2 - 2 + 2 = 2: without simultaneity player 1 would be at 0 when SBAs are checked.
    expect(s.result).toBeNull();
    expect(s.players[1].life).toBe(2);
  });

  it('a token put onto the battlefield attacking deals damage but was never declared (no attack trigger)', () => {
    const s = given({
      turn: 2, step: 'main1', active: 0, battlefield: [Den.id, { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id]], libraries: [lib(10), lib(10)],
    });
    while (s.pendingChoice?.kind !== 'declareAttackers') act(s, { type: 'pass' });
    const den = id1(s, Den.id);
    act(s, { type: 'declareAttackers', assignments: [[den, toP1]] });
    // Player 1 (holding an instant) gets priority in the declare attackers step with the trigger on the stack.
    expect(s.step).toBe('declareAttackers');
    expect(who(s)).toBe(1);
    expect(s.zones.stack.map((x) => x.kind)).toEqual(['triggered']);
    pass(s);
    expect(who(s)).toBe(1);
    const goblin = id1(s, 'token-goblin');
    expect(s.objects[goblin]).toMatchObject({ tapped: true, attacking: toP1 });
    expect(s.objects[goblin]!.attacksThisTurn).toBeUndefined();
    while (s.step !== 'main2') pass(s);
    expect(s.players[1].life).toBe(16);
  });

  it('CR 302.6 (summoning sickness): an animated land that came under control this turn cannot attack', () => {
    const s = given({ turn: 2, step: 'main1', battlefield: [{ card: Vault.id, sick: true }, { card: Vault.id }], libraries: [lib(5), lib(5)] });
    const [sick, old] = ids(s, Vault.id) as [ObjId, ObjId];
    const ctx = makeCtx(s, sick, 0, 'test');
    ctx.animate(sick, { types: ['Creature'], pt: [2, 2] });
    ctx.animate(old, { types: ['Creature'], pt: [2, 2] });
    expect(attackCandidates(s, 0)).toEqual([old]);
  });

  it('CR 702.9b (flying): only flying creatures block a flier', () => {
    const s = combat([Flier.id, { card: Wall.id, controller: 1 }, { card: Flier.id, controller: 1 }]);
    const mine = ids(s, Flier.id, 'battlefield', 0)[0]!;
    act(s, { type: 'declareAttackers', assignments: [[mine, toP1]] });
    const opts = blockOptions(s, 1);
    const wall = id1(s, Wall.id);
    expect(opts.some((o) => o.some(([b]) => b === wall))).toBe(false);
    expect(opts.length).toBe(2);
  });

  it('attack options collapse identical attackers and include a planeswalker defender', () => {
    const s = combat([TestBear.id, TestBear.id, TestBear.id]);
    const opts = attackOptions(s, 0);
    // 0, 1, 2 or 3 identical attackers at the player: 4 options, not 8.
    expect(opts.length).toBe(4);
    expect(opts[0]).toEqual([]);
    expect(opts[1]!.length).toBe(3);
  });
});
