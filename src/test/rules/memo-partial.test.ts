// Partial memo drops (T1.5, docs/PERF.md): an object entering or leaving the battlefield, or
// changing its animation overlay, drops only its own memo entries, its host's and the battlefield
// aggregates (statics.ts setPartialDrop); Urborg's static still drops everything. Each case warms
// every memo, makes the change through the mutators, and compares the memoized characteristics,
// classKey, static lists and trigger listener index with a fresh computation on a clone.
import { describe, expect, it } from 'vitest';
import { given, id1, registerTestDef, TestBear } from '../helpers.js';
import { card, land, stat, trig } from '../../cards/dsl.js';
import { cloneState } from '../../engine/apply.js';
import { clearField, setField } from '../../engine/mutate.js';
import { characteristics, classKey, staticAbilities } from '../../engine/statics.js';
import { listenerIndex } from '../../engine/triggers.js';
import { createToken, moveObject } from '../../engine/zones.js';
import type { GameState, StaticCategory } from '../../engine/types.js';

const PartialUrborg = registerTestDef(card('Partial Test Urborg', [land({
  name: 'Partial Test Urborg', supertypes: ['Legendary'], abilities: [stat({ category: 'allLandsAreSwamps' })],
})]));
const PartialWatcher = registerTestDef(card('Partial Test Watcher', [land({
  name: 'Partial Test Watcher', abilities: [trig('dies', { scope: 'any' }, () => {})],
})]));

const CATEGORIES: StaticCategory[] = ['allLandsAreSwamps', 'enchantedGets', 'entersTapped', 'marker'];

function snapshot(state: GameState): string {
  const ids = [...state.zones.battlefield].sort((a, b) => a - b);
  return JSON.stringify({
    chars: ids.map((id) => characteristics(state, id)),
    keys: ids.map((id) => classKey(state, id)),
    statics: CATEGORIES.map((c) => staticAbilities(state, c).map((r) => [r.sourceId, r.key])),
    listeners: Object.entries(listenerIndex(state)).map(([ev, ls]) => [ev, (ls ?? []).map((l) => [l.sourceId, l.key])]),
  });
}

/** Memoized view equals a fresh one; returns the fresh snapshot. */
function check(state: GameState): string {
  const fresh = snapshot(cloneState(state));
  expect(snapshot(state)).toBe(fresh);
  return fresh;
}

describe('partial memo drops', () => {
  it('a Role entering attached and leaving updates its host', () => {
    const s = given({ battlefield: [TestBear.id, 'Mountain'] });
    const bear = id1(s, TestBear.id);
    check(s);
    const role = createToken(s, 'MonsterRole', 0, { attachedTo: bear });
    check(s);
    expect(characteristics(s, bear).power).toBe(3);
    moveObject(s, role, 'graveyard');
    check(s);
    expect(characteristics(s, bear).power).toBe(2);
  });

  it('an animation overlay set and cleared updates the land and the aggregates', () => {
    const s = given({ battlefield: ['Mountain', 'Swamp', PartialWatcher.id] });
    const m = id1(s, 'Mountain');
    check(s);
    setField(s, m, 'animated', { types: ['Creature'], subtypes: ['Elemental'], pt: [3, 3], keywords: ['haste'] });
    check(s);
    clearField(s, m, 'animated');
    check(s);
  });

  it('Urborg entering and leaving changes every land (full drop)', () => {
    const s = given({ battlefield: ['Mountain', TestBear.id], hands: [[PartialUrborg.id], []] });
    const mountain = id1(s, 'Mountain');
    check(s);
    const u = moveObject(s, id1(s, PartialUrborg.id, 'hand', 0), 'battlefield');
    check(s);
    expect(characteristics(s, mountain).subtypes).toContain('Swamp');
    moveObject(s, u as number, 'graveyard');
    check(s);
    expect(characteristics(s, mountain).subtypes).not.toContain('Swamp');
  });

  it('a creature leaving drops its listeners and static entries', () => {
    const s = given({ battlefield: [PartialWatcher.id, TestBear.id, 'Swamp'] });
    check(s);
    moveObject(s, id1(s, PartialWatcher.id), 'graveyard');
    check(s);
    moveObject(s, id1(s, TestBear.id), 'exile');
    check(s);
    console.log('partial memo drops: 4 cases, 13 memo comparisons');
  });
});
