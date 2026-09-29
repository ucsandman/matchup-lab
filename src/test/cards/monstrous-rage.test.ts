// Monstrous Rage scenarios (docs/CARD-ANALYSIS.json). Player 0 is B, player 1 is A.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, TestBolt } from '../helpers.js';
import { MonstrousRage } from '../../cards/defs/monstrous-rage.js';
import { MonsterRole } from '../../cards/tokens.js';
import { characteristics, hasKeyword } from '../../engine/statics.js';
import { act, castMove, moves, O } from '../scenario.js';
import { drain, expectOracle, lib, pt, Spear, toNextTurn, Vault } from './burn-pump-fixtures.js';
import type { GameState, ObjId } from '../../engine/types.js';

const RAGE = 'Monstrous Rage';
const roles = (s: GameState): ObjId[] => ids(s, MonsterRole.id);

describe('Monstrous Rage', () => {
  it('def matches oracle.json: {R} instant', () => {
    expectOracle(MonstrousRage);
  });

  it('scenario 1: on a 1/2 prowess creature: prowess then Rage: 5/4 trample; after cleanup 2/3 trample with the Role (CR 613.4c (modify power and toughness))', () => {
    const s = given({
      turn: 1, step: 'main1',
      battlefield: [Spear.id, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[RAGE], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const sp = id1(s, Spear.id);
    act(s, castMove(s, RAGE, [O(sp)]));
    drain(s);
    expect(pt(s, sp)).toEqual([5, 4]);
    expect(hasKeyword(s, sp, 'trample')).toBe(true);
    const r = roles(s);
    expect(r.length).toBe(1);
    expect(s.objects[r[0]!]).toMatchObject({ attachedTo: sp, controller: 0 });
    toNextTurn(s);
    expect(pt(s, sp)).toEqual([2, 3]);
    expect(hasKeyword(s, sp, 'trample')).toBe(true);
    expect(roles(s).length).toBe(1);
  });

  it('the Role is a colorless enchantment Aura token with mana value 0 (CR 111.10k (Monster Role))', () => {
    const s = given({ battlefield: [Spear.id, 'Mountain'], hands: [[RAGE], []], libraries: [lib(5), lib(5)] });
    act(s, castMove(s, RAGE, [O(id1(s, Spear.id))]));
    drain(s);
    const c = characteristics(s, roles(s)[0]!);
    expect(c.subtypes).toEqual(['Aura', 'Role']);
    expect([c.colors, c.manaValue]).toEqual([0, 0]);
  });

  it('scenario 2: a second Rage on the same creature: the older Role goes to the graveyard (CR 303.7a (Role))', () => {
    const s = given({
      battlefield: [Spear.id, 'Mountain', 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[RAGE, RAGE], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const sp = id1(s, Spear.id);
    act(s, castMove(s, RAGE, [O(sp)]));
    drain(s);
    const first = roles(s)[0]!;
    act(s, castMove(s, RAGE, [O(sp)]));
    drain(s);
    const now = roles(s);
    expect(now.length).toBe(1);
    expect(now[0]).not.toBe(first);
    expect(s.objects[first]).toBeUndefined(); // a token that left the battlefield ceases to exist
    // 1/2 base, two prowess (+2/+2), two Rages (+4/+0), one Role (+1/+1).
    expect(pt(s, sp)).toEqual([8, 5]);
  });

  it('scenario 3: on an animated land: when the animation ends at cleanup the Role falls off (CR 704.5m (Aura attached illegally)), then ceases to exist (CR 704.5d (token not on the battlefield))', () => {
    const s = given({
      turn: 1, step: 'main1',
      battlefield: [Vault.id, 'Mountain', 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[RAGE], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const v = id1(s, Vault.id);
    const anim = moves(s).find((m) => m.type === 'activate' && m.objId === v);
    if (!anim) throw new Error('no animation move');
    act(s, anim);
    drain(s);
    expect(pt(s, v)).toEqual([2, 2]);
    act(s, castMove(s, RAGE, [O(v)]));
    drain(s);
    expect(pt(s, v)).toEqual([5, 3]);
    expect(roles(s).length).toBe(1);
    toNextTurn(s);
    expect(s.objects[v]?.zone).toBe('battlefield');
    expect(roles(s).length).toBe(0);
    expect(s.zones.graveyard[0].filter((id) => s.objects[id]?.token !== undefined).length).toBe(0);
  });
});
