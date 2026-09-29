import { describe, expect, it } from 'vitest';
import { given, id1 } from '../helpers.js';
import { playLandNow } from './lands-util.js';
import { legalMoves } from '../../engine/moves.js';
import { sourceOptions } from '../../engine/mana.js';
import { characteristics } from '../../engine/statics.js';
import { drawCard } from '../../engine/zones.js';
import { view } from '../../engine/view.js';

const PATHWAY = 'Blightstep Pathway // Searstep Pathway';

describe('Blightstep Pathway // Searstep Pathway', () => {
  it('played as Searstep: untapped, taps for exactly {R}, one land drop used; both faces were offered', () => {
    const s = given({ battlefield: ['Swamp'], hands: [[PATHWAY], []] });
    const plays = legalMoves(s, 0).filter((m) => m.type === 'playLand');
    // Never collapse the two faces: they are different futures.
    expect(plays.map((m) => (m.type === 'playLand' ? m.face ?? 0 : -1)).sort()).toEqual([0, 1]);
    const id = playLandNow(s, PATHWAY, { face: 1 });
    const o = s.objects[id]!;
    expect(o.face).toBe(1);
    expect(o.tapped).toBe(false);
    expect(characteristics(s, id).name).toBe('Searstep Pathway');
    expect(sourceOptions(s, id).flatMap((x) => x.colors)).toEqual(['R']);
    expect(s.turnFlags.landsPlayed[0]).toBe(1);
  });

  it('with a land already played this turn, no land play is offered', () => {
    const s = given({ battlefield: ['Swamp'], hands: [[PATHWAY, PATHWAY], []] });
    s.turnFlags.landsPlayed[0] = 1;
    expect(legalMoves(s, 0).some((m) => m.type === 'playLand')).toBe(false);
  });

  it('drawn from the library: the opponent sees one more hidden card and no identity', () => {
    const s = given({ libraries: [[PATHWAY], []] });
    drawCard(s, 0);
    const v = view(s, 1);
    expect(v.zones.hand[0].known).toEqual([]);
    expect(v.zones.hand[0].hidden.length).toBe(1);
    expect(JSON.stringify(v)).not.toContain('blightstep');
  });

  it('CR 712.8a (front face): in the hand and graveyard it has only the Blightstep characteristics', () => {
    const s = given({ hands: [[PATHWAY], []], graveyards: [[PATHWAY], []] });
    expect(characteristics(s, id1(s, PATHWAY, 'hand')).name).toBe('Blightstep Pathway');
    expect(characteristics(s, id1(s, PATHWAY, 'graveyard')).name).toBe('Blightstep Pathway');
  });
});
