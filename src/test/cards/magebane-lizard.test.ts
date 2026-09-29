// Magebane Lizard scenarios (docs/CARD-ANALYSIS.json). The Lizard is B's (player 0); A is player 1.
import { describe, expect, it } from 'vitest';
import { given, id1, TestBolt } from '../helpers.js';
import { MagebaneLizard } from '../../cards/defs/magebane-lizard.js';
import { act, castMove, moves, O, P } from '../scenario.js';
import { Annex, Crusher, drain, Elf, expectOracle, lib, Push, Seize } from './burn-pump-fixtures.js';

const LIZ = 'Magebane Lizard';
const lizardItems = (s: { zones: { stack: { abilityKey?: string }[] } }): number =>
  s.zones.stack.filter((x) => x.abilityKey?.startsWith(MagebaneLizard.id)).length;

describe('Magebane Lizard', () => {
  it('def matches oracle.json: {1}{R} 1/4 Lizard', () => {
    expectOracle(MagebaneLizard);
  });

  it('scenario 1: A\'s first noncreature spell: the trigger resolves first (1 damage), then the spell (CR 603.2 (triggers on cast))', () => {
    const s = given({
      turn: 2, active: 1, battlefield: [LIZ, 'Mountain', { card: 'Swamp', controller: 1 }],
      hands: [[TestBolt.id], [Seize.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, Seize.name));
    expect(lizardItems(s)).toBe(1);
    expect(s.zones.stack[s.zones.stack.length - 1]?.kind).toBe('triggered');
    drain(s);
    expect(s.players[1].life).toBe(17);
  });

  it('scenario 2: second noncreature spell deals 2; a creature spell does not trigger; an Adventure counts as noncreature (CR 715.3b (Adventure))', () => {
    const lands = [
      { card: 'Swamp', controller: 1 as const }, { card: 'Swamp', controller: 1 as const },
      ...Array.from({ length: 5 }, () => ({ card: 'Mountain', controller: 1 as const })),
    ];
    const s = given({
      turn: 2, active: 1, battlefield: [LIZ, Elf.id, 'Mountain', ...lands],
      hands: [[TestBolt.id], [Seize.id, Push.id, Crusher.id, Crusher.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, Seize.name));
    drain(s);
    expect(s.players[1].life).toBe(17);
    act(s, castMove(s, Push.name, [O(id1(s, Elf.id))]));
    drain(s);
    expect(s.players[1].life).toBe(15);
    act(s, castMove(s, Crusher.name, undefined, (m) => m.face === undefined));
    expect(lizardItems(s)).toBe(0);
    drain(s);
    expect(s.players[1].life).toBe(15);
    act(s, castMove(s, Crusher.name, [P(0)], (m) => m.face === 1));
    expect(lizardItems(s)).toBe(1);
    drain(s);
    expect(s.players[1].life).toBe(12);
    expect(s.turnFlags.noncreatureSpellsCast[1]).toBe(3);
  });

  it('scenario 3: B\'s own spells ping B: 1 then 2', () => {
    const s = given({
      battlefield: [LIZ, 'Mountain', 'Mountain'],
      hands: [['Burst Lightning', 'Monstrous Rage'], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Burst Lightning', [P(1)]));
    drain(s);
    expect(s.players[0].life).toBe(19);
    act(s, castMove(s, 'Monstrous Rage', [O(id1(s, LIZ))]));
    drain(s);
    expect(s.players[0].life).toBe(17);
  });

  it('unlocking a door is a special action, not a cast: no trigger (CR 709.5 (unlock))', () => {
    const s = given({
      turn: 2, active: 1,
      battlefield: [LIZ, { card: Annex.id, controller: 1, unlocked: [true, false] }, { card: 'Swamp', controller: 1 }, { card: 'Swamp', controller: 1 }],
      hands: [[], []], libraries: [lib(5), lib(5)],
    });
    const unlock = moves(s).find((m) => m.type === 'unlockDoor');
    if (!unlock) throw new Error('no unlock move');
    act(s, unlock);
    expect(lizardItems(s)).toBe(0);
    drain(s);
    expect(s.players[1].life).toBe(20);
    expect(s.turnFlags.noncreatureSpellsCast[1]).toBe(0);
  });
});
