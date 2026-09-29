import { describe, expect, it } from 'vitest';
import { given, id1 } from '../helpers.js';
import { activations, playLandNow } from './lands-util.js';
import { act } from '../scenario.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => 'Swamp');

describe('Castle Locthwain', () => {
  it('with no Swamp (only Blackcleave Cliffs) it enters tapped', () => {
    const s = given({ battlefield: ['Blackcleave Cliffs'], hands: [['Castle Locthwain'], []] });
    expect(s.objects[playLandNow(s, 'Castle Locthwain')]!.tapped).toBe(true);
  });

  it('with a Swamp it enters untapped; at 10 life with 2 cards in hand the ability leaves hand 3, life 7', () => {
    const s = given({ battlefield: ['Swamp'], hands: [['Castle Locthwain'], []] });
    expect(s.objects[playLandNow(s, 'Castle Locthwain')]!.tapped).toBe(false);

    const t = given({
      life: [10, 20], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Castle Locthwain'],
      hands: [['Swamp', 'Swamp'], []], libraries: [lib(5), lib(5)],
    });
    const castle = id1(t, 'Castle Locthwain');
    const [m] = activations(t, castle);
    expect(m).toBeDefined();
    act(t, m!);
    // The ability used the stack and resolved; p0 now holds priority with a land drop available.
    expect(t.zones.stack.length).toBe(0);
    expect(t.zones.hand[0].length).toBe(3);
    expect(t.players[0].life).toBe(7);
    expect(t.objects[castle]!.tapped).toBe(true);
  });

  it('CR 704.5a (0 life): at 3 life with 2 cards and Sheoldred out, the loss is checked before the draw trigger resolves', () => {
    const s = given({
      life: [3, 20], battlefield: ['Sheoldred, the Apocalypse', 'Swamp', 'Swamp', 'Swamp', 'Castle Locthwain'],
      hands: [['Swamp', 'Swamp'], []], libraries: [lib(5), lib(5)],
    });
    const [m] = activations(s, id1(s, 'Castle Locthwain'));
    act(s, m!);
    expect(s.players[0].life).toBe(0);
    expect(s.result).toMatchObject({ winner: 1 });
  });
});
