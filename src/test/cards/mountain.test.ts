// Mountain: the basic land. Its only rules text is the intrinsic mana ability of the Mountain type.
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

describe('Mountain', () => {
  it('CR 305.6 (basic land types intrinsic ability): taps for R only, with no printed ability', () => {
    const def = getDef(defIdByName('Mountain')!);
    expect(def.faces[0]!.abilities.length).toBe(0);
    const s = given({ battlefield: ['Mountain'] });
    const mt = id1(s, 'Mountain');
    expect(colors(s, mt)).toEqual(['R']);
    expect(characteristics(s, mt).basic).toBe(true);
    expect(canPay(s, 0, parseMana('{R}'), ANY)).toBe(true);
    expect(canPay(s, 0, parseMana('{B}'), ANY)).toBe(false);
    expect(canPay(s, 0, parseMana('{R}{R}'), ANY)).toBe(false);
  });

  it('CR 305.2 (one land during their turn): playing a Mountain uses the land drop; the second is not offered', () => {
    const s = given({ turn: 3, step: 'main1', active: 0, hands: [['Mountain', 'Mountain'], []] });
    const lands = (): number => moves(s).filter((m) => m.type === 'playLand').length;
    // Two identical Mountains in hand collapse to one move.
    expect(lands()).toBe(1);
    const mt = playLandNow(s, 'Mountain');
    expect(s.objects[mt]!.tapped).toBe(false);
    expect(s.turnFlags.landsPlayed[0]).toBe(1);
    expect(lands()).toBe(0);
  });

  it('CR 205.4c (basic supertype): four Mountains are not legendary; the legend rule removes none (CR 704.5j (legend rule))', () => {
    const s = given({ battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain'] });
    checkSBA(s);
    expect(ids(s, 'Mountain').length).toBe(4);
    expect(canPay(s, 0, parseMana('{R}{R}{R}{R}'), ANY)).toBe(true);
  });
});
