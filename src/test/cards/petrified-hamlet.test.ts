import { describe, expect, it } from 'vitest';
import { given, id1, TestBolt } from '../helpers.js';
import { answer, act, moves } from '../scenario.js';
import { passUntil } from './lands-util.js';
import { HAMLET_NAMES } from '../../cards/defs/petrified-hamlet.js';
import { legalMoves } from '../../engine/moves.js';
import { activatedDef, canActivateNow } from '../../engine/stack.js';
import { sourceOptions } from '../../engine/mana.js';
import { characteristics, isType } from '../../engine/statics.js';
import { makeCtx } from '../../engine/ctx.js';
import { destroy } from '../../engine/zones.js';
import type { GameState, ObjId } from '../../engine/types.js';

const HAMLET_C = 'petrified-hamlet:0:0';
const ban = (s: GameState, name: string): void => { makeCtx(s, id1(s, 'Petrified Hamlet'), 0, 'petrified-hamlet:0:1').addNamedBan(name, HAMLET_C); };
const lib = (n: number): string[] => Array.from({ length: n }, () => 'Swamp');

describe('Petrified Hamlet', () => {
  it('naming Den of the Bugbear: the Den cannot animate but still taps for R, and now also for C', () => {
    const s = given({
      battlefield: [...Array.from({ length: 4 }, () => ({ card: 'Mountain', controller: 1 as const })), { card: 'Den of the Bugbear', controller: 1 }],
      hands: [['Petrified Hamlet'], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const play = moves(s).find((m) => m.type === 'playLand');
    act(s, play!);
    passUntil(s, (x) => x.pendingChoice !== null);
    // The enters trigger resolves and asks its controller for a name.
    expect(s.pendingChoice).toMatchObject({ kind: 'pickIndex', player: 0, count: HAMLET_NAMES.length });
    answer(s, { index: HAMLET_NAMES.indexOf('Den of the Bugbear') });
    expect(s.effects.filter((e) => e.kind === 'namedBan').map((e) => (e.kind === 'namedBan' ? e.name : ''))).toEqual(['Den of the Bugbear']);
    const den = id1(s, 'Den of the Bugbear');
    const key = 'den-of-the-bugbear:0:2';
    s.priority = 1;
    expect(canActivateNow(s, 1, den, activatedDef(key))).toBe(false);
    expect(legalMoves(s, 1).some((m) => m.type === 'activate' && m.objId === den)).toBe(false);
    expect([...new Set(sourceOptions(s, den).flatMap((o) => o.colors))].sort()).toEqual(['C', 'R']);
  });

  it('CR 602.5 (prohibited activation): naming Sokenzan stops the channel from the hand', () => {
    const s = given({
      step: 'declareAttackers', active: 0,
      battlefield: ['Petrified Hamlet', ...Array.from({ length: 4 }, () => ({ card: 'Mountain', controller: 1 as const }))],
      hands: [[], ['Sokenzan, Crucible of Defiance']],
    });
    s.priority = 1;
    const channel = (): boolean => legalMoves(s, 1).some((m) => m.type === 'activate');
    expect(channel()).toBe(true);
    ban(s, 'Sokenzan, Crucible of Defiance');
    expect(channel()).toBe(false);
  });

  it('naming Mutavault: an animated Mutavault stays a 2/2 this turn, and neither player can animate one', () => {
    const s = given({ battlefield: ['Petrified Hamlet', 'Mutavault', 'Swamp', { card: 'Mutavault', controller: 1 }, { card: 'Swamp', controller: 1 }] });
    const [mine, theirs] = [id1(s, 'Mutavault', 'battlefield', 0), id1(s, 'Mutavault', 'battlefield', 1)] as [ObjId, ObjId];
    makeCtx(s, theirs, 1, 'test').animate(theirs, { types: ['Creature'], allCreatureTypes: true, pt: [2, 2] });
    ban(s, 'Mutavault');
    expect(isType(s, theirs, 'Creature')).toBe(true);
    expect(characteristics(s, theirs).power).toBe(2);
    const key = 'mutavault:0:1';
    expect(canActivateNow(s, 0, mine, activatedDef(key))).toBe(false);
    s.priority = 1;
    expect(canActivateNow(s, 1, theirs, activatedDef(key))).toBe(false);
  });

  it('CR 611.3a (static ability effect): when the Hamlet leaves the battlefield the ban and the granted {C} end', () => {
    const s = given({ battlefield: ['Petrified Hamlet', 'Castle Locthwain', 'Swamp', 'Swamp', 'Swamp'] });
    ban(s, 'Castle Locthwain');
    const castle = id1(s, 'Castle Locthwain');
    const key = 'castle-locthwain:0:2';
    expect(canActivateNow(s, 0, castle, activatedDef(key))).toBe(false);
    expect([...new Set(sourceOptions(s, castle).flatMap((o) => o.colors))].sort()).toEqual(['B', 'C']);
    destroy(s, id1(s, 'Petrified Hamlet'));
    expect(s.effects.some((e) => e.kind === 'namedBan')).toBe(false);
    expect(canActivateNow(s, 0, castle, activatedDef(key))).toBe(true);
    expect(sourceOptions(s, castle).flatMap((o) => o.colors)).toEqual(['B']);
  });
});
