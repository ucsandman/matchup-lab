import { describe, expect, it } from 'vitest';
import { given } from '../helpers.js';
import { playLandNow } from './lands-util.js';
import { canPay, emptyPool, sourceOptions, activateManaAbility } from '../../engine/mana.js';
import { parseMana } from '../../engine/cost.js';

const NONCREATURE = { creatureSpell: false };

describe('Blackcleave Cliffs', () => {
  it('with two other lands it enters untapped and pays {B} the same turn', () => {
    const s = given({ battlefield: ['Mountain', 'Mountain'], hands: [['Blackcleave Cliffs'], []] });
    expect(canPay(s, 0, parseMana('{B}'), NONCREATURE)).toBe(false);
    const id = playLandNow(s, 'Blackcleave Cliffs');
    expect(s.objects[id]!.tapped).toBe(false);
    expect(sourceOptions(s, id).flatMap((o) => o.colors).sort()).toEqual(['B', 'R']);
    expect(canPay(s, 0, parseMana('{B}'), NONCREATURE)).toBe(true);
  });

  it('CR 614.12 (enters replacement): with three other lands it enters tapped; the entering land is not counted', () => {
    const s = given({ battlefield: ['Swamp', 'Blood Crypt', 'Mutavault'], hands: [['Blackcleave Cliffs'], []] });
    const id = playLandNow(s, 'Blackcleave Cliffs');
    expect(s.objects[id]!.tapped).toBe(true);
    // Available mana this turn is unchanged: the three old lands only.
    expect(canPay(s, 0, parseMana('{3}'), NONCREATURE)).toBe(true);
    expect(canPay(s, 0, parseMana('{4}'), NONCREATURE)).toBe(false);
  });

  it('turn 1 with no lands: untapped, taps for {R}, and the pool empties at end of step (CR 106.4 (mana empties))', () => {
    const s = given({ hands: [['Blackcleave Cliffs'], []] });
    const id = playLandNow(s, 'Blackcleave Cliffs');
    expect(s.objects[id]!.tapped).toBe(false);
    const key = sourceOptions(s, id)[0]!.key;
    activateManaAbility(s, 0, id, key, 'R');
    expect(s.players[0].manaPool).toEqual([{ color: 'R' }]);
    emptyPool(s, 0, 'step');
    expect(s.players[0].manaPool).toEqual([]);
    expect(s.players[0].life).toBe(20);
  });

  it('an opponent\'s lands do not count toward the three', () => {
    const s = given({
      battlefield: ['Swamp', 'Swamp', { card: 'Mountain', controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [['Blackcleave Cliffs'], []],
    });
    expect(s.objects[playLandNow(s, 'Blackcleave Cliffs')]!.tapped).toBe(false);
  });
});
