import { describe, expect, it } from 'vitest';
import { given, id1, ids, TestBear } from '../helpers.js';
import { activateNow } from './lands-util.js';
import { legalMoves } from '../../engine/moves.js';
import { resolveTop, activatableKeys } from '../../engine/stack.js';
import { sourceOptions } from '../../engine/mana.js';
import { view } from '../../engine/view.js';
import type { Choice, GameState, Move } from '../../engine/types.js';

const TAKENUMA = 'Takenuma, Abandoned Mire';
const CHANNEL = 'takenuma-abandoned-mire:0:1';
const SHEOLDRED = 'Sheoldred, the Apocalypse';
const channels = (s: GameState): Move[] => legalMoves(s, 0).filter((m) => m.type === 'activate' && m.abilityKey === CHANNEL);

describe('Takenuma, Abandoned Mire', () => {
  it('channel mills 3 and returns Sheoldred; the opponent\'s view shows Sheoldred in hand plus the count', () => {
    const s = given({
      battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp'],
      hands: [[TAKENUMA, 'Swamp'], []],
      libraries: [[TestBear.id, SHEOLDRED, 'Swamp', 'Swamp', 'Swamp'], ['Swamp']],
    });
    expect(channels(s).length).toBe(1);
    activateNow(s, 0, id1(s, TAKENUMA, 'hand'), CHANNEL);
    const asked: Choice[] = [];
    resolveTop(s, (ch) => {
      asked.push(ch);
      if (ch.kind !== 'pickObjects') throw new Error(`unexpected ${ch.kind}`);
      const sheol = ch.from.find((id) => s.objects[id]!.defId === 'sheoldred-the-apocalypse');
      return { ids: [sheol!] };
    });
    expect(asked.length).toBe(1);
    expect(asked[0]).toMatchObject({ kind: 'pickObjects', min: 1, max: 1 });
    expect(s.zones.library[0].length).toBe(2);
    const sheol = id1(s, SHEOLDRED, 'hand');
    expect(ids(s, TestBear.id, 'graveyard').length).toBe(1);
    const v = view(s, 1);
    expect(v.zones.hand[0].known).toEqual([sheol]);
    expect(v.zones.hand[0].hidden.length).toBe(1); // the Swamp stays hidden
  });

  it('controlling Sheoldred (legendary) the channel costs {2}{B}, legal with only three lands', () => {
    const s = given({ battlefield: [SHEOLDRED, 'Swamp', 'Swamp', 'Swamp'], hands: [[TAKENUMA], []], libraries: [['Swamp', 'Swamp', 'Swamp'], []] });
    expect(channels(s).length).toBe(1);
    const t = given({ battlefield: ['Swamp', 'Swamp', 'Swamp'], hands: [[TAKENUMA], []] });
    expect(channels(t).length).toBe(0);
  });

  it('played as a land it taps for B and the channel ability is gone', () => {
    const s = given({ battlefield: [TAKENUMA] });
    const id = id1(s, TAKENUMA);
    expect(activatableKeys(s, id)).toEqual([]);
    expect(sourceOptions(s, id).flatMap((o) => o.colors)).toEqual(['B']);
  });

  it('with no creature or planeswalker in the graveyard after the mill, nothing returns and no choice is asked', () => {
    const s = given({ battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp'], hands: [[TAKENUMA], []], libraries: [['Swamp', 'Swamp', 'Swamp'], []] });
    activateNow(s, 0, id1(s, TAKENUMA, 'hand'), CHANNEL);
    resolveTop(s, () => { throw new Error('no choice expected'); });
    expect(s.zones.graveyard[0].length).toBe(4); // Takenuma plus three milled Swamps
    expect(s.zones.hand[0].length).toBe(0);
  });
});
