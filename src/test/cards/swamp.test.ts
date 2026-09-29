// Swamp: the basic land. Its only rules text is the intrinsic mana ability of the Swamp type.
import { describe, expect, it } from 'vitest';
import { given, id1, ids } from '../helpers.js';
import { moves } from '../scenario.js';
import { playLandNow } from './lands-util.js';
import { canPay, sourceOptions } from '../../engine/mana.js';
import { parseMana } from '../../engine/cost.js';
import { characteristics } from '../../engine/statics.js';
import { checkSBA } from '../../engine/sba.js';
import { getDef, defIdByName } from '../../cards/index.js';
import type { GameState } from '../../engine/types.js';

const ANY = { creatureSpell: false };
const colors = (s: GameState, id: number): string[] => [...new Set(sourceOptions(s, id).flatMap((o) => o.colors))].sort();

describe('Swamp', () => {
  it('CR 305.6 (basic land types intrinsic ability): taps for B only, with no printed ability', () => {
    const def = getDef(defIdByName('Swamp')!);
    expect(def.faces[0]!.abilities.length).toBe(0);
    const s = given({ battlefield: ['Swamp'] });
    const sw = id1(s, 'Swamp');
    expect(colors(s, sw)).toEqual(['B']);
    expect(characteristics(s, sw).basic).toBe(true);
    expect(canPay(s, 0, parseMana('{B}'), ANY)).toBe(true);
    expect(canPay(s, 0, parseMana('{R}'), ANY)).toBe(false);
    expect(canPay(s, 0, parseMana('{B}{B}'), ANY)).toBe(false);
  });

  it('CR 305.2 (one land during their turn): playing a Swamp uses the land drop; the second is not offered', () => {
    const s = given({ turn: 3, step: 'main1', active: 0, hands: [['Swamp', 'Swamp'], []] });
    const lands = (): number => moves(s).filter((m) => m.type === 'playLand').length;
    // Two identical Swamps in hand collapse to one move.
    expect(lands()).toBe(1);
    const sw = playLandNow(s, 'Swamp');
    expect(s.objects[sw]!.tapped).toBe(false);
    expect(s.turnFlags.landsPlayed[0]).toBe(1);
    expect(lands()).toBe(0);
  });

  it('CR 205.4c (basic supertype): four Swamps are not legendary; the legend rule removes none (CR 704.5j (legend rule))', () => {
    const s = given({ battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp'] });
    checkSBA(s);
    expect(ids(s, 'Swamp').length).toBe(4);
    expect(canPay(s, 0, parseMana('{B}{B}{B}{B}'), ANY)).toBe(true);
  });
});
