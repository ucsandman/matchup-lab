// Unholy Annex // Ritual Chamber: scenarios from docs/CARD-ANALYSIS.json plus the Room rulings.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, spell, stat, t } from '../../cards/dsl.js';
import { characteristics } from '../../engine/statics.js';
import { view } from '../../engine/view.js';
import { act, castMove, moves, pass } from '../scenario.js';
import type { GameState, Move } from '../../engine/types.js';

const NAME = 'Unholy Annex // Ritual Chamber';
const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
/** A {B} instant so player 0 has a priority action. */
const Ping = registerTestDef(card('Test Annex Ping', [face({
  name: 'Test Annex Ping', types: ['Instant'], cost: '{B}',
  abilities: [spell({ target: t.player(), resolve: (ctx, [tg]) => { if (tg && tg.kind === 'player') ctx.loseLife(tg.p, 1); } })],
})]));
/** Stand-in for Sunspine Lynx's static: players can't gain life. */
const NoGain = registerTestDef(card('Test Annex No Gain', [face({
  name: 'Test Annex No Gain', types: ['Creature'], cost: '{2}{R}{R}', pt: [5, 4], abilities: [stat({ category: 'cantGainLife' })],
})]));

/** Passes until pred holds (checked before each pass), at most max passes. */
function passUntil(s: GameState, pred: (s: GameState) => boolean, max = 60): void {
  for (let i = 0; i < max && !pred(s); i++) pass(s);
  expect(pred(s)).toBe(true);
}
const unlockMove = (s: GameState): Move | undefined => moves(s).find((m) => m.type === 'unlockDoor');
// Player 1 keeps a Bolt and a Mountain so the engine stops whenever player 1 has priority.
const B_STOP = { card: 'Mountain', controller: 1 as const };

describe('Unholy Annex // Ritual Chamber', () => {
  it('scenario 1: Annex half cast, no Demon: end step draws 1 and loses 2; the opponent sees only the hand count', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: ['Swamp', 'Swamp', 'Swamp', B_STOP],
      hands: [[NAME], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    expect(characteristics(s, id1(s, NAME, 'hand')).manaValue).toBe(8);
    act(s, castMove(s, NAME, [], (m) => (m.face ?? 0) === 0));
    passUntil(s, (x) => ids(x, NAME).length === 1);
    const annex = id1(s, NAME);
    expect(s.objects[annex]!.unlocked).toEqual([true, false]);
    // CR 709.5 (locked half): on the battlefield only the unlocked door counts.
    expect(characteristics(s, annex)).toMatchObject({ name: 'Unholy Annex', manaValue: 3 });
    const handBefore = s.zones.hand[0].length;
    const oppViewBefore = view(s, 1).zones.hand[0];
    passUntil(s, (x) => x.turn === 4);
    expect(s.zones.hand[0].length).toBe(handBefore + 1);
    expect(s.players[0].life).toBe(18);
    expect(s.players[1].life).toBe(20);
    const oppView = view(s, 1).zones.hand[0];
    expect(oppView.known).toEqual(oppViewBefore.known);
    expect(oppView.hidden.length).toBe(oppViewBefore.hidden.length + 1);
    const drawn = s.zones.hand[0].find((id) => !s.objects[id]!.knownTo[1]);
    expect(drawn).toBeDefined();
    expect(JSON.stringify(view(s, 1))).not.toContain(`"id":${drawn}`);
  });

  it('scenario 2: unlocking Ritual Chamber is a special action, not a cast; Demon; end step drains 2', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: NAME, unlocked: [true, false] }, 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', B_STOP],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const annex = id1(s, NAME);
    const casts = s.turnFlags.spellsCast[0];
    const m = unlockMove(s);
    expect(m).toEqual({ type: 'unlockDoor', objId: annex, half: 1 });
    act(s, m!);
    // CR 116.2m (unlock cost): no spell was cast and nothing used the stack for the unlock itself.
    expect(s.turnFlags.spellsCast[0]).toBe(casts);
    expect(s.objects[annex]!.unlocked).toEqual([true, true]);
    expect(characteristics(s, annex)).toMatchObject({ name: 'Unholy Annex // Ritual Chamber', manaValue: 8 });
    passUntil(s, (x) => ids(x, 'token-demon').length === 1);
    const demon = id1(s, 'token-demon');
    expect(characteristics(s, demon)).toMatchObject({ power: 6, toughness: 6, subtypes: ['Demon'] });
    const hand = s.zones.hand[0].length;
    passUntil(s, (x) => x.turn === 4);
    expect(s.zones.hand[0].length).toBe(hand + 1);
    expect(s.players[1].life).toBe(18);
    expect(s.players[0].life).toBe(22);
  });

  it('scenario 3: with a cantGainLife static out, the drain still costs the opponent 2 and gains nothing (CR 119.7 (can\'t gain life))', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: NAME, unlocked: [true, false] }, 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', B_STOP, { card: NoGain.id, controller: 1 }],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    act(s, unlockMove(s)!);
    passUntil(s, (x) => ids(x, 'token-demon').length === 1);
    const hand = s.zones.hand[0].length;
    passUntil(s, (x) => x.turn === 4);
    expect(s.zones.hand[0].length).toBe(hand + 1);
    expect(s.players[1].life).toBe(18);
    expect(s.players[0].life).toBe(20);
  });

  it('casting the Ritual Chamber half unlocks it and its unlock trigger makes the Demon (CR 709.5h (unlocks))', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', B_STOP],
      hands: [[NAME], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, NAME, [], (m) => m.face === 1));
    passUntil(s, (x) => ids(x, 'token-demon').length === 1);
    expect(s.objects[id1(s, NAME)]!.unlocked).toEqual([false, true]);
    // The Annex door is locked: no end-step trigger (CR 709.5 (locked half)), so no draw and no life change.
    const hand = s.zones.hand[0].length;
    passUntil(s, (x) => x.turn === 4);
    expect(s.zones.hand[0].length).toBe(hand);
    expect(s.players[0].life).toBe(20);
  });

  it('unlock is sorcery timing: not offered on the opponent turn or with a spell on the stack', () => {
    const s = given({
      turn: 4, step: 'main1', active: 1,
      battlefield: [{ card: NAME, unlocked: [true, false] }, 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', B_STOP],
      hands: [[Ping.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    // Player 1 is active; when player 1 passes in main1, player 0 gets priority with an empty stack.
    expect(s.priority).toBe(1);
    pass(s);
    expect(s.priority).toBe(0);
    expect(s.zones.stack.length).toBe(0);
    expect(unlockMove(s)).toBeUndefined();
    // Player 0's own turn, but a spell on the stack: still no unlock.
    const s2 = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: [{ card: NAME, unlocked: [true, false] }, 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', B_STOP],
      hands: [[Ping.id, Ping.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    expect(unlockMove(s2)).toBeDefined();
    act(s2, castMove(s2, 'Test Annex Ping', [{ kind: 'player', p: 1 }]));
    expect(s2.priority).toBe(0);
    expect(s2.zones.stack.length).toBe(1);
    expect(unlockMove(s2)).toBeUndefined();
  });
});
