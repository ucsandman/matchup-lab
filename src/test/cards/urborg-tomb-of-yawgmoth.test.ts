import { describe, expect, it } from 'vitest';
import { given, id1 } from '../helpers.js';
import { playLandNow } from './lands-util.js';
import { canPay, sourceOptions } from '../../engine/mana.js';
import { parseMana } from '../../engine/cost.js';
import { characteristics } from '../../engine/statics.js';
import { destroy } from '../../engine/zones.js';
import { checkSBA } from '../../engine/sba.js';
import type { GameState } from '../../engine/types.js';

const NONCREATURE = { creatureSpell: false };
const colors = (s: GameState, id: number): string[] => [...new Set(sourceOptions(s, id).flatMap((o) => o.colors))].sort();

describe('Urborg, Tomb of Yawgmoth', () => {
  it('Blackcleave Cliffs makes B or R; Urborg itself makes B', () => {
    const s = given({ battlefield: ['Urborg, Tomb of Yawgmoth', 'Blackcleave Cliffs'] });
    expect(colors(s, id1(s, 'Blackcleave Cliffs'))).toEqual(['B', 'R']);
    expect(colors(s, id1(s, 'Urborg, Tomb of Yawgmoth'))).toEqual(['B']);
    expect(characteristics(s, id1(s, 'Urborg, Tomb of Yawgmoth')).subtypes).toEqual(['Swamp']);
  });

  it('with Urborg and no other Swamp, Castle Locthwain enters untapped', () => {
    const s = given({ battlefield: ['Urborg, Tomb of Yawgmoth'], hands: [['Castle Locthwain'], []] });
    expect(s.objects[playLandNow(s, 'Castle Locthwain')]!.tapped).toBe(false);
  });

  it('two Searstep Pathways, Urborg, Blood Crypt and a Swamp pay {1}{B}{B}{B}{B}: every land is a Swamp', () => {
    const P = 'Blightstep Pathway // Searstep Pathway';
    const s = given({ battlefield: [{ card: P, face: 1 }, { card: P, face: 1 }, 'Urborg, Tomb of Yawgmoth', 'Blood Crypt', 'Swamp'] });
    expect(canPay(s, 0, parseMana('{1}{B}{B}{B}{B}'), NONCREATURE)).toBe(true);
    // Without Urborg the Searsteps only make R.
    const t = given({ battlefield: [{ card: P, face: 1 }, { card: P, face: 1 }, 'Mountain', 'Blood Crypt', 'Swamp'] });
    expect(canPay(t, 0, parseMana('{1}{B}{B}{B}{B}'), NONCREATURE)).toBe(false);
  });

  it('CR 305.7 (land type changing): both players\' lands are Swamps in addition to their types; it ends when Urborg leaves', () => {
    const s = given({ battlefield: ['Urborg, Tomb of Yawgmoth', { card: 'Mountain', controller: 1 }] });
    const m = id1(s, 'Mountain');
    expect(characteristics(s, m).subtypes).toEqual(['Mountain', 'Swamp']);
    expect(colors(s, m)).toEqual(['B', 'R']);
    destroy(s, id1(s, 'Urborg, Tomb of Yawgmoth'));
    checkSBA(s);
    expect(colors(s, m)).toEqual(['R']);
  });
});
