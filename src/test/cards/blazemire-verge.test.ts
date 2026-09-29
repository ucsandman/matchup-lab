import { describe, expect, it } from 'vitest';
import { given, id1 } from '../helpers.js';
import { canPay, sourceOptions } from '../../engine/mana.js';
import { parseMana } from '../../engine/cost.js';
import type { GameState } from '../../engine/types.js';

const NONCREATURE = { creatureSpell: false };
const vergeColors = (s: GameState): string[] => sourceOptions(s, id1(s, 'Blazemire Verge')).flatMap((o) => o.colors).sort();

describe('Blazemire Verge', () => {
  it('with only a Blightstep Pathway (no Swamp or Mountain type) the {R} ability is unavailable', () => {
    const s = given({ battlefield: ['Blazemire Verge', { card: 'Blightstep Pathway // Searstep Pathway', face: 0 }] });
    expect(vergeColors(s)).toEqual(['B']);
    expect(canPay(s, 0, parseMana('{R}'), NONCREATURE)).toBe(false);
    expect(canPay(s, 0, parseMana('{B}{B}'), NONCREATURE)).toBe(true);
  });

  it('a tapped Blood Crypt is still a Mountain, so the Verge pays {R}', () => {
    const s = given({ battlefield: ['Blazemire Verge', { card: 'Blood Crypt', tapped: true }] });
    expect(vergeColors(s)).toEqual(['B', 'R']);
    expect(canPay(s, 0, parseMana('{R}'), NONCREATURE)).toBe(true);
  });

  it('CR 305.7 (land type changing): with Urborg the Verge is itself a Swamp, so {R} is active', () => {
    const s = given({ battlefield: ['Blazemire Verge', 'Urborg, Tomb of Yawgmoth'] });
    expect(vergeColors(s)).toEqual(['B', 'B', 'R']); // printed {B}, intrinsic Swamp {B}, conditional {R}
    expect(canPay(s, 0, parseMana('{R}'), NONCREATURE)).toBe(true);
  });

  it('an opponent\'s Mountain does not enable it', () => {
    const s = given({ battlefield: ['Blazemire Verge', { card: 'Mountain', controller: 1 }] });
    expect(vergeColors(s)).toEqual(['B']);
  });
});
