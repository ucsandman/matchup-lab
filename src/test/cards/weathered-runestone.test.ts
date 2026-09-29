// Weathered Runestone scenarios (docs/CARD-ANALYSIS.json). Player 0 is B (mono-red), player 1 is A.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear } from '../helpers.js';
import { card, face, spell, t } from '../../cards/dsl.js';
import { characteristics, isType } from '../../engine/statics.js';
import { moveObject } from '../../engine/zones.js';
import { castSpell } from '../../engine/stack.js';
import { act, castMove, moves, O } from '../scenario.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const RUNE = 'Weathered Runestone';

/** Abrade's destroy-artifact mode stand-in: destroy target artifact. */
const Shatter = registerTestDef(card('Test Rs Shatter', [face({
  name: 'Test Rs Shatter', types: ['Instant'], cost: '{1}{R}',
  abilities: [spell({ target: t.artifact(), resolve: (ctx, [tg]) => { if (tg?.kind === 'obj') ctx.destroy(tg.id); } })],
})]));

describe('Weathered Runestone', () => {
  it('def matches oracle: {2} colorless Artifact', () => {
    const s = given({ battlefield: [RUNE] });
    const r = id1(s, RUNE);
    const c = characteristics(s, r);
    expect([c.manaValue, c.colors]).toEqual([2, 0]);
    expect(isType(s, r, 'Artifact')).toBe(true);
  });

  it('scenario 1: B casts it; it is an artifact on the battlefield and A\'s destroy-artifact spell can target it', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: ['Mountain', 'Mountain', { card: 'Mountain', controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[RUNE], [Shatter.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, RUNE));
    // A holds priority with Shatter while the Runestone is on the stack; let it resolve.
    while (s.zones.stack.length > 0) act(s, { type: 'pass' });
    const r = id1(s, RUNE);
    // Pass until A has priority with the Runestone on the battlefield (A's response window).
    let guard = 0;
    while (s.priority !== 1 && guard++ < 50) act(s, { type: 'pass' });
    const m = castMove(s, Shatter.name, [O(r)]);
    act(s, m);
    while (s.zones.stack.length > 0) act(s, { type: 'pass' });
    expect(ids(s, RUNE, 'graveyard', 0).length).toBe(1);
  });

  it('scenario 2 (guard): a nonland permanent card can\'t enter from a graveyard or library while it is out; lands still can (CR 101.2 (can\'t beats can))', () => {
    const s = given({
      battlefield: [RUNE],
      graveyards: [[TestBear.id, 'Mountain'], []], libraries: [[TestBear.id], []],
    });
    const bearGy = id1(s, TestBear.id, 'graveyard');
    const bearLib = id1(s, TestBear.id, 'library');
    const mtnGy = id1(s, 'Mountain', 'graveyard');
    let tried = 0;
    expect(moveObject(s, bearGy, 'battlefield')).toBeNull(); tried++;
    expect(s.objects[bearGy]?.zone).toBe('graveyard');
    expect(moveObject(s, bearLib, 'battlefield')).toBeNull(); tried++;
    expect(s.objects[bearLib]?.zone).toBe('library');
    expect(moveObject(s, mtnGy, 'battlefield')).not.toBeNull(); tried++;
    expect(ids(s, 'Mountain', 'battlefield').length).toBe(1);
    // Other origins are unaffected: the bear can still go graveyard -> hand -> battlefield.
    const inHand = moveObject(s, bearGy, 'hand');
    expect(inHand).not.toBeNull(); tried++;
    expect(moveObject(s, inHand!, 'battlefield')).not.toBeNull(); tried++;
    console.log("runestone guard: moves tried=" + tried);
  });

  it('control: without the Runestone the same graveyard creature enters (the guard is what stops it)', () => {
    const s = given({ graveyards: [[TestBear.id], []] });
    const bear = id1(s, TestBear.id, 'graveyard');
    expect(moveObject(s, bear, 'battlefield')).not.toBeNull();
    expect(ids(s, TestBear.id, 'battlefield').length).toBe(1);
  });

  it('casting from a graveyard is never offered and castSpell rejects it (stack.ts fromOk)', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: [RUNE, 'Mountain', { card: 'Mountain', controller: 0 }],
      graveyards: [[TestBear.id], []], libraries: [lib(5), lib(5)],
    });
    const bear = id1(s, TestBear.id, 'graveyard');
    expect(moves(s).some((m) => m.type === 'cast' && m.objId === bear)).toBe(false);
    expect(() => castSpell(s, 0, { type: 'cast', objId: bear, targets: [] })).toThrow(/not castable/);
  });
});
