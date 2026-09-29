import { describe, expect, it } from 'vitest';
import { given, id1, ids, TestBolt } from '../helpers.js';
import { activations, passUntil, playLandNow } from './lands-util.js';
import { act } from '../scenario.js';
import { characteristics, isType } from '../../engine/statics.js';
import { setField } from '../../engine/mutate.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => 'Mountain');

describe('Den of the Bugbear', () => {
  it('enters tapped as the third land (two other lands), untapped with only one other land', () => {
    const s = given({ battlefield: ['Mountain', 'Mutavault'], hands: [['Den of the Bugbear'], []] });
    expect(s.objects[playLandNow(s, 'Den of the Bugbear')]!.tapped).toBe(true);
    const t = given({ battlefield: ['Mountain'], hands: [['Den of the Bugbear'], []] });
    expect(t.objects[playLandNow(t, 'Den of the Bugbear')]!.tapped).toBe(false);
  });

  it('animated 3/2 red Goblin attacks; CR 508.4 (put onto the battlefield attacking): its Goblin token attacks tapped and triggers nothing; cleanup ends the animation', () => {
    // Player 1 holds a Bolt and a Mountain so the engine stops at each of their priority windows.
    const s = given({
      battlefield: ['Den of the Bugbear', 'Mountain', 'Mountain', 'Mountain', 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const den = id1(s, 'Den of the Bugbear');
    const [m] = activations(s, den);
    expect(m).toBeDefined();
    act(s, m!);
    passUntil(s, (x) => x.pendingChoice?.kind === 'declareAttackers');
    const c = characteristics(s, den);
    expect(isType(s, den, 'Creature') && isType(s, den, 'Land')).toBe(true);
    expect([c.power, c.toughness]).toEqual([3, 2]);
    expect(c.subtypes).toContain('Goblin');
    act(s, { type: 'declareAttackers', assignments: [[den, { kind: 'player', p: 1 }]] });
    passUntil(s, (x) => ids(x, 'Goblin').length > 0);
    const [tok] = ids(s, 'Goblin');
    expect(s.objects[tok!]).toMatchObject({ tapped: true, attacking: { kind: 'player', p: 1 } });
    passUntil(s, (x) => x.step === 'main2' || x.step === 'endCombat');
    // No second attack trigger: exactly one token, and 3 + 1 combat damage.
    expect(ids(s, 'Goblin').length).toBe(1);
    expect(s.players[1].life).toBe(16);

    // The Den took 1 damage this turn (marked by hand); cleanup removes it and ends the animation.
    setField(s, den, 'damage', 1);
    passUntil(s, (x) => x.turn === 2);
    expect(isType(s, den, 'Creature')).toBe(false);
    expect(s.objects[den]!.damage).toBe(0);
    const goblin = characteristics(s, tok!);
    expect([goblin.power, goblin.toughness]).toEqual([1, 1]);
    expect(s.objects[tok!]!.zone).toBe('battlefield');
  });

  it('the attack trigger is granted, not printed: an unanimated Den has no attack ability', () => {
    const s = given({ battlefield: ['Den of the Bugbear'] });
    expect(characteristics(s, id1(s, 'Den of the Bugbear')).abilities.some((k) => k.includes('granted'))).toBe(false);
  });
});
