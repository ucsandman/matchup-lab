import { describe, expect, it } from 'vitest';
import { given, id1, ids, TestBolt } from '../helpers.js';
import { activateNow, passUntil } from './lands-util.js';
import { act } from '../scenario.js';
import { legalMoves } from '../../engine/moves.js';
import { resolveTop, activatableKeys, abilityManaCost, activatedDef } from '../../engine/stack.js';
import { canAttack, canBlock } from '../../engine/combat.js';
import { hasKeyword } from '../../engine/statics.js';
import { sourceOptions } from '../../engine/mana.js';
import { manaValueOf } from '../../engine/cost.js';
import type { GameState, Move } from '../../engine/types.js';

const SOKENZAN = 'Sokenzan, Crucible of Defiance';
const CHANNEL = 'sokenzan-crucible-of-defiance:0:1';
const lib = (n: number): string[] => Array.from({ length: n }, () => 'Mountain');
const channels = (s: GameState, p: 0 | 1): Move[] => legalMoves(s, p).filter((m) => m.type === 'activate' && m.abilityKey === CHANNEL);

describe('Sokenzan, Crucible of Defiance', () => {
  it('channelled in the opponent\'s declare attackers step: two 1/1 Spirits enter and can block the attacking Mutavault', () => {
    const s = given({
      step: 'declareAttackers', active: 0,
      battlefield: ['Mutavault', ...Array.from({ length: 4 }, () => ({ card: 'Mountain', controller: 1 as const }))],
      hands: [[], [SOKENZAN]],
    });
    const mv = id1(s, 'Mutavault');
    s.objects[mv]!.animated = { types: ['Creature'], allCreatureTypes: true, pt: [2, 2] };
    s.objects[mv]!.attacking = { kind: 'player', p: 1 };
    s.priority = 1;
    expect(channels(s, 1).length).toBe(1);
    const card = id1(s, SOKENZAN, 'hand', 1);
    activateNow(s, 1, card, CHANNEL);
    expect(ids(s, SOKENZAN, 'graveyard', 1).length).toBe(1);
    resolveTop(s);
    const spirits = ids(s, 'Spirit');
    expect(spirits.length).toBe(2);
    for (const sp of spirits) {
      expect(s.objects[sp]!.controller).toBe(1);
      expect(hasKeyword(s, sp, 'haste')).toBe(true);
      expect(canBlock(s, sp, mv)).toBe(true);
    }
  });

  it('in its controller\'s precombat main the hasty Spirits attack for 2; after cleanup they remain without haste', () => {
    const s = given({
      battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[SOKENZAN], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const m = channels(s, 0)[0];
    expect(m).toBeDefined();
    act(s, m!);
    passUntil(s, (x) => x.pendingChoice?.kind === 'declareAttackers');
    const spirits = ids(s, 'Spirit');
    expect(spirits.every((id) => canAttack(s, id, 0))).toBe(true);
    act(s, { type: 'declareAttackers', assignments: spirits.map((id) => [id, { kind: 'player', p: 1 }] as [number, { kind: 'player'; p: 1 }]) });
    passUntil(s, (x) => x.step === 'main2' || x.step === 'endCombat');
    expect(s.players[1].life).toBe(18);
    passUntil(s, (x) => x.turn === 2);
    expect(ids(s, 'Spirit').length).toBe(2);
    expect(ids(s, 'Spirit').some((id) => hasKeyword(s, id, 'haste'))).toBe(false);
  });

  it('played as a land it taps for R and the channel ability is gone (it works only from the hand)', () => {
    const s = given({ battlefield: [SOKENZAN, 'Mountain', 'Mountain', 'Mountain', 'Mountain'] });
    const id = id1(s, SOKENZAN);
    expect(activatableKeys(s, id)).toEqual([]);
    expect(sourceOptions(s, id).flatMap((o) => o.colors)).toEqual(['R']);
    expect(channels(s, 0).length).toBe(0);
  });

  it('CR 601.2f (cost reduction): {1} less for each legendary creature you control', () => {
    const s = given({ battlefield: ['Sheoldred, the Apocalypse'], hands: [[SOKENZAN], []] });
    const card = id1(s, SOKENZAN, 'hand');
    expect(manaValueOf(abilityManaCost(s, card, 0, CHANNEL, activatedDef(CHANNEL)))).toBe(3);
    const t = given({ hands: [[SOKENZAN], []] });
    expect(manaValueOf(abilityManaCost(t, id1(t, SOKENZAN, 'hand'), 0, CHANNEL, activatedDef(CHANNEL)))).toBe(4);
  });
});
