// Fear of Missing Out: ETB discard then draw; delirium first-attack trigger with an intervening if,
// CR 603.4 (if condition), that untaps a creature and adds an extra combat, CR 500.8 (add phases).
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face, spell, t } from '../../cards/dsl.js';
import { characteristics } from '../../engine/statics.js';
import { makeCtx } from '../../engine/ctx.js';
import { deliriumCount } from '../../cards/defs/fear-of-missing-out.js';
import { act, answer, castMove, O, pass } from '../scenario.js';
import type { GameState, ObjId, Step } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const FOMO = 'Fear of Missing Out';

const Ritual = registerTestDef(card('Test Fo Ritual', [face({
  name: 'Test Fo Ritual', types: ['Sorcery'], cost: '{R}', abilities: [spell({ resolve: () => {} })],
})]));
/** {R} instant: exile target card from a graveyard (graveyard hate stand-in). */
const Purge = registerTestDef(card('Test Fo Purge', [face({
  name: 'Test Fo Purge', types: ['Instant'], cost: '{R}',
  abilities: [spell({ target: t.cardInGraveyard(), resolve: (ctx, [tg]) => { if (tg && tg.kind === 'obj') ctx.exile(tg.id); } })],
})]));

function resolveStack(s: GameState): void {
  let guard = 0;
  while (s.zones.stack.length > 0 && !s.pendingChoice) { pass(s); if (++guard > 50) throw new Error('stack did not resolve'); }
}

/** Player 0 main 1 with FOMO ready to attack and this graveyard. */
function attackSetup(graveyard: string[], p1Hand: string[] = [TestBolt.id]): GameState {
  return given({
    turn: 2, step: 'main1', active: 0,
    battlefield: [FOMO, 'Mountain', { card: 'Mountain', controller: 1 }],
    hands: [[TestBolt.id], p1Hand], graveyards: [graveyard, []], libraries: [lib(5), lib(5)],
  });
}

function declareFomo(s: GameState): ObjId {
  while (s.pendingChoice?.kind !== 'declareAttackers') pass(s);
  const f = id1(s, FOMO);
  act(s, { type: 'declareAttackers', assignments: [[f, { kind: 'player', p: 1 }]] });
  return f;
}

const FOUR_TYPES = ['Swamp', TestBolt.id, Ritual.id, TestBear.id]; // land, instant, sorcery, creature

describe('Fear of Missing Out', () => {
  it('matches its oracle characteristics', () => {
    const s = given({ battlefield: [FOMO] });
    const c = characteristics(s, id1(s, FOMO));
    expect([c.power, c.toughness, c.manaValue, c.subtypes]).toEqual([2, 3, 2, ['Nightmare']]);
  });

  it('delirium counts card types, a two-typed card counting both (CR 205.2a (card types))', () => {
    const s = given({ battlefield: [FOMO], graveyards: [[FOMO, 'Swamp', 'Swamp'], []] });
    // Enchantment + Creature + Land.
    expect(deliriumCount(makeCtx(s, id1(s, FOMO), 0, 'test'))).toBe(3);
  });

  it('scenario 1: ETB discards the chosen card first, then draws; the drawn card stays hidden from the opponent', () => {
    const s = given({
      turn: 2, step: 'main1', active: 0,
      battlefield: ['Mountain', 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[FOMO, 'Swamp', TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const swamp = id1(s, 'Swamp', 'hand', 0);
    const libBefore = s.zones.library[0].length;
    act(s, castMove(s, FOMO));
    resolveStack(s);
    expect(s.pendingChoice).toMatchObject({ kind: 'pickObjects', player: 0 });
    // Nothing is drawn before the discard is chosen.
    expect(s.zones.library[0].length).toBe(libBefore);
    answer(s, { ids: [swamp] });
    resolveStack(s);
    expect(ids(s, 'Swamp', 'graveyard', 0).length).toBe(1);
    expect(s.zones.library[0].length).toBe(libBefore - 1);
    const hand = s.zones.hand[0];
    expect(hand.length).toBe(2);
    const drawn = hand.find((id) => s.objects[id]?.defId === TestBear.id) as ObjId;
    expect(s.objects[drawn]?.knownTo).toEqual([true, false]);
  });

  it('scenario 2: with delirium, the first attack untaps it and adds a combat; the second attack does not trigger', () => {
    const s = attackSetup(FOUR_TYPES);
    const f = declareFomo(s);
    expect(s.zones.stack.filter((i) => i.kind === 'triggered').length).toBe(1);
    resolveStack(s);
    expect(s.objects[f]?.tapped).toBe(false);
    const steps: Step[] = [];
    while (s.pendingChoice?.kind !== 'declareAttackers') { steps.push(s.step); pass(s); }
    // The extra combat directly follows this one, with no main phase between.
    expect(steps).not.toContain('main2');
    expect(s.step).toBe('declareAttackers');
    expect(s.players[1].life).toBe(18);
    act(s, { type: 'declareAttackers', assignments: [[f, { kind: 'player', p: 1 }]] });
    expect(s.zones.stack.length).toBe(0);
    while (s.step !== 'main2') pass(s);
    expect(s.players[1].life).toBe(16);
    expect(s.phaseQueue).not.toContain('beginCombat');
  });

  it('scenario 3: with three card types there is no trigger and no extra combat', () => {
    const s = attackSetup(['Swamp', TestBolt.id, TestBear.id]);
    declareFomo(s);
    expect(s.zones.stack.length).toBe(0);
    expect(s.phaseQueue.filter((x) => x === 'beginCombat').length).toBe(0);
  });

  it('scenario 3 variant: CR 603.4 (if condition): delirium lost in response, the trigger does nothing', () => {
    const s = attackSetup(FOUR_TYPES, [Purge.id]);
    const f = declareFomo(s);
    expect(s.zones.stack.length).toBe(1);
    if (s.priority === 0) pass(s);
    act(s, castMove(s, 'Test Fo Purge', [O(id1(s, Ritual.id, 'graveyard', 0))]));
    resolveStack(s);
    expect(s.objects[f]?.tapped).toBe(true);
    expect(s.phaseQueue.filter((x) => x === 'beginCombat').length).toBe(0);
  });
});
