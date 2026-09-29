// Priority and the stack: both players passing resolves the top object; the active player gets
// priority after a resolution; the stack resolves last in, first out; casting keeps priority.
import { describe, expect, it } from 'vitest';
import { given, TestBear, TestBolt } from '../helpers.js';
import { act, castMove, P, pass, who } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);

function duel(): GameState {
  return given({
    turn: 1, step: 'main1', active: 0,
    battlefield: ['Mountain', 'Mountain', { card: 'Mountain', controller: 1 }, { card: 'Mountain', controller: 1 }],
    hands: [[TestBolt.id, TestBolt.id], [TestBolt.id, TestBolt.id]],
    libraries: [lib(5), lib(5)],
  });
}

describe('priority and stack', () => {
  it('CR 117.3c (priority after acting): the caster keeps priority; CR 117.4 (all players pass): both pass resolves', () => {
    const s = duel();
    act(s, castMove(s, TestBolt.name, [P(1)]));
    expect(s.zones.stack.length).toBe(1);
    expect(who(s)).toBe(0);
    pass(s);
    expect(who(s)).toBe(1);
    expect(s.zones.stack.length).toBe(1);
    pass(s);
    expect(s.zones.stack.length).toBe(0);
    expect(s.players[1].life).toBe(17);
    // CR 117.3b (priority after resolution): the active player receives priority.
    expect(who(s)).toBe(0);
    expect(s.step).toBe('main1');
  });

  it('a pass with an empty stack by both players ends the step', () => {
    const s = duel();
    pass(s, 2);
    expect(s.step).toBe('beginCombat');
    expect(who(s)).toBe(0);
  });

  it('the stack resolves last in, first out', () => {
    const s = duel();
    act(s, castMove(s, TestBolt.name, [P(1)]));
    pass(s); // to player 1
    act(s, castMove(s, TestBolt.name, [P(0)]));
    expect(s.zones.stack.map((x) => x.controller)).toEqual([0, 1]);
    pass(s); // player 1 passes
    pass(s); // player 0 passes: top (player 1's Bolt) resolves
    expect(s.players[0].life).toBe(17);
    expect(s.players[1].life).toBe(20);
    expect(s.zones.stack.length).toBe(1);
    expect(who(s)).toBe(0);
    pass(s, 2);
    expect(s.players[1].life).toBe(17);
  });

  it('auto-pass: a player whose only move is pass is not asked', () => {
    const s = given({
      turn: 1, step: 'main1', active: 0,
      battlefield: ['Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]],
      libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, TestBolt.name, [P(1)]));
    // Player 0 has no untapped land left: passes automatically; player 1 holds a Bolt and is asked.
    expect(who(s)).toBe(1);
    pass(s);
    expect(s.players[1].life).toBe(17);
  });
});
