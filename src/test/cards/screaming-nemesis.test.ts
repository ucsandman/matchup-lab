// Screaming Nemesis scenarios (docs/CARD-ANALYSIS.json). Nemesis is B's (player 0); A is player 1.
import { describe, expect, it } from 'vitest';
import { given, id1, TestBolt } from '../helpers.js';
import { ScreamingNemesis } from '../../cards/defs/screaming-nemesis.js';
import { act, castMove, O, P, pass } from '../scenario.js';
import { Aeth, drain, expectOracle, Harv, lib, pickTargets, Push, Salve, Sheol, Spear, until } from './burn-pump-fixtures.js';
import type { GameState } from '../../engine/types.js';

const NEM = 'Screaming Nemesis';
const nemItems = (s: GameState): number => s.zones.stack.filter((x) => x.abilityKey?.startsWith(ScreamingNemesis.id)).length;

describe('Screaming Nemesis', () => {
  it('def matches oracle.json: {2}{R} 3/3 Spirit with haste', () => {
    expectOracle(ScreamingNemesis);
  });

  it('scenario 1: killed by damage, it still triggers; A is dealt 3 and can\'t gain life for the rest of the game (CR 119.7 (can\'t gain life))', () => {
    const s = given({
      turn: 2, active: 1,
      battlefield: [NEM, { card: Harv.id, controller: 1 }, { card: 'Mountain', controller: 1 }, { card: 'Swamp', controller: 1 }],
      hands: [[], [TestBolt.id, Salve.id]], libraries: [lib(5), lib(5)],
    });
    const nem = id1(s, NEM);
    act(s, castMove(s, TestBolt.name, [O(nem)]));
    drain(s);
    expect(s.objects[nem]).toBeUndefined();
    pickTargets(s, [P(1)]);
    drain(s);
    expect(s.players[1].life).toBe(17);
    expect(s.players[1].cantGainLife).toBe(true);
    act(s, castMove(s, Salve.name));
    drain(s);
    expect(s.players[1].life).toBe(17);
  });

  it('scenario 2: a double block is one damage event: exactly one trigger for the total (Scryfall ruling; CR 510.2 (combat damage))', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: [NEM, { card: Aeth.id, controller: 1 }, { card: Harv.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const nem = id1(s, NEM);
    until(s, 'declareAttackers');
    act(s, { type: 'declareAttackers', assignments: [[nem, { kind: 'player', p: 1 }]] });
    until(s, 'declareBlockers');
    act(s, { type: 'declareBlockers', assignments: [[id1(s, Aeth.id), nem], [id1(s, Harv.id), nem]] });
    for (let i = 0; i < 10 && s.pendingChoice?.kind !== 'pickTargets'; i++) pass(s);
    // Combat damage: Nemesis is dealt 5 at once, dies (deathtouch), and A gained 2 from lifelink.
    expect(s.objects[nem]).toBeUndefined();
    expect(s.players[1].life).toBe(22);
    const c = s.pendingChoice;
    expect(c?.kind).toBe('pickTargets');
    pickTargets(s, [P(1)]);
    expect(nemItems(s)).toBe(1);
    expect(s.zones.stack[s.zones.stack.length - 1]?.trigger?.amount).toBe(5);
    drain(s);
    expect(nemItems(s)).toBe(0);
    expect(s.players[1].life).toBe(17);
    expect(s.players[1].cantGainLife).toBe(true);
  });

  it('scenario 3: non-damage removal: no trigger, the flag is unchanged', () => {
    const s = given({
      turn: 2, active: 1,
      battlefield: [NEM, { card: 'Swamp', controller: 1 }],
      hands: [[], [Push.id]], libraries: [lib(5), lib(5)],
    });
    const nem = id1(s, NEM);
    act(s, castMove(s, Push.name, [O(nem)]));
    drain(s);
    expect(s.objects[nem]).toBeUndefined();
    expect(s.pendingChoice?.kind).not.toBe('pickTargets');
    expect(nemItems(s)).toBe(0);
    expect(s.players[1].cantGainLife).toBe(false);
    expect(s.players[1].life).toBe(20);
  });

  it('"any other target": the trigger never offers Nemesis itself', () => {
    const s = given({
      battlefield: [NEM, Spear.id, 'Mountain'],
      hands: [['Burst Lightning'], []], libraries: [lib(5), lib(5)],
    });
    const nem = id1(s, NEM);
    act(s, castMove(s, 'Burst Lightning', [O(nem)]));
    drain(s);
    const c = s.pendingChoice;
    if (!c || c.kind !== 'pickTargets') throw new Error('expected a target choice');
    console.log(`nemesis: ${c.options.length} target options checked`);
    expect(c.options.length).toBeGreaterThan(0);
    expect(c.options.some((o) => o.some((tg) => tg.kind === 'obj' && tg.id === nem))).toBe(false);
    pickTargets(s, [P(1)]);
    drain(s);
    expect(s.players[1].life).toBe(18);
    expect(s.objects[nem]?.damage).toBe(2);
  });

  it('source gone: the trigger still deals damage with the last known controller, so B\'s Soul-Scar converts it (CR 113.7a (last known information))', () => {
    const s = given({
      turn: 2, active: 1,
      battlefield: [NEM, 'Soul-Scar Mage', { card: Sheol.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const nem = id1(s, NEM);
    const sh = id1(s, Sheol.id);
    act(s, castMove(s, TestBolt.name, [O(nem)]));
    drain(s);
    expect(s.objects[nem]).toBeUndefined();
    pickTargets(s, [O(sh)]);
    drain(s);
    expect(s.objects[sh]).toMatchObject({ damage: 0, counters: { m1m1: 3 } });
    pass(s);
  });
});
