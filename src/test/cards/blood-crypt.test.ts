import { describe, expect, it } from 'vitest';
import { given, id1 } from '../helpers.js';
import { playLandNow } from './lands-util.js';
import { legalMoves } from '../../engine/moves.js';
import { canPay, sourceOptions } from '../../engine/mana.js';
import { parseMana } from '../../engine/cost.js';
import { characteristics } from '../../engine/statics.js';
import { cloneState } from '../../engine/apply.js';
import type { GameState, Move } from '../../engine/types.js';

const NONCREATURE = { creatureSpell: false };
const cryptPlays = (s: GameState): Move[] => legalMoves(s, 0).filter((m) => m.type === 'playLand' && m.objId === id1(s, 'Blood Crypt', 'hand'));

describe('Blood Crypt', () => {
  it('turn 1 at 20: paying 2 gives an untapped B/R source at 18; not paying gives a tapped one at 20', () => {
    const s = given({ life: [20, 20], hands: [['Blood Crypt'], []] });
    expect(cryptPlays(s)).toEqual(expect.arrayContaining([expect.objectContaining({ pay: true }), expect.objectContaining({ pay: false })]));
    const paid = cloneState(s);
    const a = playLandNow(paid, 'Blood Crypt', { pay: true });
    expect(paid.objects[a]!.tapped).toBe(false);
    expect(paid.players[0].life).toBe(18);
    expect(sourceOptions(paid, a).flatMap((o) => o.colors).sort()).toEqual(['B', 'R']);
    expect(canPay(paid, 0, parseMana('{B}'), NONCREATURE)).toBe(true);

    const b = playLandNow(s, 'Blood Crypt', { pay: false });
    expect(s.objects[b]!.tapped).toBe(true);
    expect(s.players[0].life).toBe(20);
    expect(canPay(s, 0, parseMana('{B}'), NONCREATURE)).toBe(false);
  });

  it('at 2 life only the enters-tapped play is offered (CR 119.4 (pay life) allows it, CR 704.5a (0 life) would lose)', () => {
    const s = given({ life: [2, 20], hands: [['Blood Crypt'], []] });
    const plays = cryptPlays(s);
    expect(plays.length).toBe(1);
    expect(plays[0]).toMatchObject({ pay: false });
    // Paying down to exactly 0 is still a legal action (CR 119.4 (pay life)); the generator prunes it.
    const id = playLandNow(s, 'Blood Crypt', { pay: true });
    expect(s.objects[id]!.tapped).toBe(false);
    expect(s.players[0].life).toBe(0);
    // At 3 life both plays are offered again.
    const t = given({ life: [3, 20], hands: [['Blood Crypt'], []] });
    expect(cryptPlays(t).length).toBe(2);
  });

  it('a tapped Blood Crypt is a Swamp for Castle Locthwain, and nonbasic', () => {
    const s = given({ battlefield: [{ card: 'Blood Crypt', tapped: true }], hands: [['Castle Locthwain'], []] });
    const castle = playLandNow(s, 'Castle Locthwain');
    expect(s.objects[castle]!.tapped).toBe(false);
    const c = characteristics(s, id1(s, 'Blood Crypt'));
    expect(c.basic).toBe(false);
    expect(c.subtypes).toEqual(['Swamp', 'Mountain']);
  });
});
