// London mulligan per CR 103.5 (mulligan) as written in docs/CR.txt.
import { describe, expect, it } from 'vitest';
import { deckOf } from '../helpers.js';
import { newGame } from '../../engine/setup.js';
import { answerPregame, canMulligan } from '../../engine/mulligan.js';
import type { GameState, ObjId } from '../../engine/types.js';

const DECK = deckOf({ Swamp: 20, 'Test Bear': 20, 'Test Bolt': 20 });
const start = (seed = 5): GameState => newGame(DECK, DECK, seed, 0);

describe('London mulligan', () => {
  it('both keep: pregame ends, hands of seven', () => {
    const s = start();
    answerPregame(s, { keep: true });
    expect(s.pendingChoice).toEqual({ kind: 'mulligan', player: 1 });
    answerPregame(s, { keep: true });
    expect(s.pendingChoice).toBeNull();
    expect(s.pregame).toBeNull();
    expect(s.zones.hand[0].length + s.zones.hand[1].length).toBe(14);
  });

  it('mulligan to six: new seven, bottom one, recorded as a known bottom card; library re-id\'d', () => {
    const s = start();
    const oldLibrary = new Set(s.zones.library[0]);
    answerPregame(s, { keep: false });
    answerPregame(s, { keep: true });
    expect(s.pendingChoice).toEqual({ kind: 'bottom', player: 0, count: 1 });
    expect(s.zones.hand[0].length).toBe(7);
    expect(s.zones.library[0].some((id) => oldLibrary.has(id))).toBe(false);
    const chosen = s.zones.hand[0][3] as ObjId;
    const chosenDef = s.objects[chosen]!.defId;
    answerPregame(s, { ids: [chosen] });
    expect(s.zones.hand[0].length).toBe(6);
    expect(s.zones.library[0].length).toBe(54);
    const bottom = s.zones.library[0][0] as ObjId;
    expect(s.objects[bottom]!.defId).toBe(chosenDef);
    expect(s.players[0].libraryKnown.bottom).toEqual([bottom]);
    expect(s.objects[bottom]!.knownTo).toEqual([true, false]);
    // After the round, player 0 is asked again (they have not kept yet).
    expect(s.pendingChoice).toEqual({ kind: 'mulligan', player: 0 });
    answerPregame(s, { keep: true });
    expect(s.pendingChoice).toBeNull();
    expect(s.players[0].mulligans).toBe(1);
  });

  it('second mulligan bottoms two in the chosen order; the last id given is the very bottom', () => {
    const s = start(9);
    answerPregame(s, { keep: false });
    answerPregame(s, { keep: true });
    answerPregame(s, { ids: [s.zones.hand[0][0] as ObjId] });
    answerPregame(s, { keep: false });
    expect(s.pendingChoice).toEqual({ kind: 'bottom', player: 0, count: 2 });
    const [x, y] = [s.zones.hand[0][1] as ObjId, s.zones.hand[0][4] as ObjId];
    const [dx, dy] = [s.objects[x]!.defId, s.objects[y]!.defId];
    answerPregame(s, { ids: [x, y] });
    const known = s.players[0].libraryKnown.bottom;
    expect(known.length).toBe(2);
    expect(s.objects[known[0]!]!.defId).toBe(dy);
    expect(s.objects[known[1]!]!.defId).toBe(dx);
    expect(s.zones.library[0].slice(0, 2)).toEqual(known);
    expect(s.zones.hand[0].length).toBe(5);
  });

  it('simultaneous mulligans: both shuffle and draw, then bottom in turn order', () => {
    const s = start(11);
    answerPregame(s, { keep: false });
    answerPregame(s, { keep: false });
    expect(s.pendingChoice).toEqual({ kind: 'bottom', player: 0, count: 1 });
    answerPregame(s, { ids: [s.zones.hand[0][0] as ObjId] });
    expect(s.pendingChoice).toEqual({ kind: 'bottom', player: 1, count: 1 });
    answerPregame(s, { ids: [s.zones.hand[1][0] as ObjId] });
    expect(s.pendingChoice).toEqual({ kind: 'mulligan', player: 0 });
  });

  it('rejects bad answers and stops at a hand of zero', () => {
    const s = start();
    expect(() => answerPregame(s, {})).toThrow();
    answerPregame(s, { keep: false });
    answerPregame(s, { keep: true });
    expect(() => answerPregame(s, { ids: [] })).toThrow();
    expect(() => answerPregame(s, { ids: [s.zones.hand[1][0] as ObjId] })).toThrow();
    const t = start(3);
    for (let i = 0; i < 7; i++) {
      answerPregame(t, { keep: false });
      if (i === 0) answerPregame(t, { keep: true });
      answerPregame(t, { ids: t.zones.hand[0].slice(0, i + 1) });
    }
    expect(t.players[0].mulligans).toBe(7);
    expect(t.zones.hand[0].length).toBe(0);
    expect(canMulligan(t, 0)).toBe(false);
    expect(() => answerPregame(t, { keep: false })).toThrow();
    const total = t.zones.library[0].length + t.zones.hand[0].length;
    console.log(`mulligan to zero: ${t.players[0].mulligans} mulligans, ${total} cards conserved`);
    expect(total).toBe(60);
  });
});
