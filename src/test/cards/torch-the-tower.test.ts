// Torch the Tower scenarios (docs/CARD-ANALYSIS.json). Player 0 is A (the caster), player 1 is B.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face } from '../../cards/dsl.js';
import { TOKEN_IDS } from '../../cards/index.js';
import { view } from '../../engine/view.js';
import { checkViewLeak } from '../../tools/play.js';
import { act, answer, castMove, O, pass } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
/** Stands in for Screaming Nemesis: a 3/3. */
const Three = registerTestDef(card('Test Torch Three', [face({ name: 'Test Torch Three', types: ['Creature'], cost: '{2}{R}', pt: [3, 3] })]));
/** A distinct top card for the scry test. */
const Marker = registerTestDef(card('Test Torch Marker', [face({ name: 'Test Torch Marker', types: ['Sorcery'], cost: '{B}' })]));
const TREASURE = TOKEN_IDS.Treasure as string;

function resolveAll(s: GameState): void {
  while (s.zones.stack.length > 0 && !s.pendingChoice && !s.result) pass(s);
}

describe('Torch the Tower', () => {
  it('scenario 1: unbargained, 2 damage kills Swiftspear (1/2): it is exiled, not put into the graveyard', () => {
    const s = given({
      turn: 3, step: 'main1', battlefield: ['Mountain', 'Mountain', { card: 'Monastery Swiftspear', controller: 1 }],
      hands: [['Torch the Tower', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Torch the Tower', [O(id1(s, 'Monastery Swiftspear'))], (m) => m.bargain === undefined));
    resolveAll(s);
    expect(s.zones.graveyard[1].length).toBe(0);
    expect(s.zones.exile[1].map((id) => s.objects[id]?.defId)).toEqual(['monastery-swiftspear']);
  });

  it('scenario 2: bargaining a Treasure: 3 damage exiles a 3/3, revolt is on, and A scries 1 (bottom)', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: ['Mountain', 'Mountain', { card: TREASURE, token: true }, { card: Three.id, controller: 1 }],
      hands: [['Torch the Tower', TestBolt.id], []], libraries: [[Marker.id, ...lib(4)], lib(5)],
    });
    const three = id1(s, Three.id);
    const top = id1(s, Marker.id, 'library', 0);
    act(s, castMove(s, 'Torch the Tower', [O(three)], (m) => m.bargain !== undefined));
    // CR 702.166a (bargain): the sacrifice is part of casting, so revolt is on before resolution.
    expect(s.turnFlags.permanentLeft[0]).toBe(true);
    expect(ids(s, TREASURE).length).toBe(0);
    resolveAll(s);
    if (s.pendingChoice?.kind !== 'pickObjects') throw new Error('expected the scry choice');
    expect(s.pendingChoice).toMatchObject({ player: 0, reason: 'scry1', from: [top], min: 0, max: 1 });
    // The scried card is shown to A while the choice is pending, and not to B.
    expect(view(s, 0).objects[top]?.defId).toBe(Marker.id);
    expect(view(s, 1).objects[top]).toBeUndefined();
    const hidden = checkViewLeak(s, 0) + checkViewLeak(s, 1);
    console.log(`torch scry view leak check: hidden objects checked=${hidden}`);
    expect(hidden).toBeGreaterThan(0);
    answer(s, { ids: [top] });
    expect(s.zones.exile[1].map((id) => s.objects[id]?.defId)).toEqual([Three.id]);
    expect(s.zones.library[0][0]).toBe(top);
    expect(s.players[0].libraryKnown.bottom[0]).toBe(top);
    expect(s.objects[top]?.knownTo).toEqual([true, false]);
  });

  it('scenario 2b: keeping the scried card on top records it as known top', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: ['Mountain', 'Mountain', { card: TREASURE, token: true }, { card: Three.id, controller: 1 }],
      hands: [['Torch the Tower', TestBolt.id], []], libraries: [[Marker.id, ...lib(4)], lib(5)],
    });
    const top = id1(s, Marker.id, 'library', 0);
    act(s, castMove(s, 'Torch the Tower', [O(id1(s, Three.id))], (m) => m.bargain !== undefined));
    resolveAll(s);
    answer(s, { ids: [] });
    expect(s.zones.library[0][s.zones.library[0].length - 1]).toBe(top);
    expect(s.players[0].libraryKnown.top[0]).toBe(top);
  });

  it('scenario 3: Sunspine Lynx survives 2 damage, then dies later this turn: it is exiled instead', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: ['Mountain', 'Mountain', 'Mountain', { card: 'Sunspine Lynx', controller: 1 }],
      hands: [['Torch the Tower', TestBolt.id, TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    const lynx = id1(s, 'Sunspine Lynx');
    act(s, castMove(s, 'Torch the Tower', [O(lynx)], (m) => m.bargain === undefined));
    resolveAll(s);
    expect(s.objects[lynx]?.zone).toBe('battlefield');
    expect(s.effects.some((e) => e.kind === 'exileIfDies' && e.target === lynx)).toBe(true);
    act(s, castMove(s, TestBolt.name, [O(lynx)]));
    resolveAll(s);
    expect(s.zones.graveyard[1].length).toBe(0);
    expect(s.zones.exile[1].map((id) => s.objects[id]?.defId)).toEqual(['sunspine-lynx']);
  });

  it('with Kalitas also applying, the dying creature\'s controller chooses the replacement (CR 616.1 (affected controller chooses))', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: ['Mountain', 'Mountain', 'Kalitas, Traitor of Ghet', { card: 'Monastery Swiftspear', controller: 1 }],
      hands: [['Torch the Tower', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Torch the Tower', [O(id1(s, 'Monastery Swiftspear'))], (m) => m.bargain === undefined));
    resolveAll(s);
    expect(s.pendingChoice).toMatchObject({ kind: 'dieReplacement', player: 1 });
    if (s.pendingChoice?.kind !== 'dieReplacement') throw new Error('no choice');
    const kalitasIdx = s.pendingChoice.options.findIndex((o) => o.source !== null);
    answer(s, { index: kalitasIdx });
    expect(s.zones.exile[1].map((id) => s.objects[id]?.defId)).toEqual(['monastery-swiftspear']);
    expect(ids(s, TOKEN_IDS.Zombie as string, 'battlefield', 0).length).toBe(1);
  });

  it('the exile tag ends at cleanup (until end of turn)', () => {
    const s = given({
      turn: 3, step: 'main1',
      battlefield: ['Mountain', 'Mountain', { card: 'Sunspine Lynx', controller: 1 }],
      hands: [['Torch the Tower', TestBolt.id], []], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Torch the Tower', [O(id1(s, 'Sunspine Lynx'))], (m) => m.bargain === undefined));
    resolveAll(s);
    while (s.turn === 3 && !s.result) pass(s);
    expect(s.effects.filter((e) => e.kind === 'exileIfDies').length).toBe(0);
  });
});
