// Graveyard Trespasser // Graveyard Glutton: ETB/attack graveyard exile with drain, ward (discard a
// card), daybound/nightbound transitions, and entering transformed at night.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, TestBear, TestBolt } from '../helpers.js';
import { invalidateMemo } from '../../engine/mutate.js';
import { characteristics } from '../../engine/statics.js';
import { act, answer, castMove, O, P, pass } from '../scenario.js';
import type { GameState, Target } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const TRESPASSER = 'Graveyard Trespasser // Graveyard Glutton';

function resolveStack(s: GameState): void {
  let guard = 0;
  while (s.zones.stack.length > 0 && !s.pendingChoice) { pass(s); if (++guard > 50) throw new Error('stack did not resolve'); }
}

/** Answers a pending pickTargets with the option that has n targets. */
function pickTargetsOfSize(s: GameState, n: number): Target[] {
  const ch = s.pendingChoice;
  if (!ch || ch.kind !== 'pickTargets') throw new Error(`expected pickTargets, got ${JSON.stringify(ch)}`);
  const index = ch.options.findIndex((o) => o.length === n);
  if (index < 0) throw new Error(`no option of size ${n}: ${JSON.stringify(ch.options)}`);
  const chosen = ch.options[index] as Target[];
  answer(s, { index });
  return chosen;
}

describe('Graveyard Trespasser // Graveyard Glutton', () => {
  it('matches its oracle characteristics on both faces', () => {
    const s = given({ battlefield: [TRESPASSER, { card: TRESPASSER, face: 1 }] });
    const [day, night] = ids(s, TRESPASSER);
    const d = characteristics(s, day!);
    const n = characteristics(s, night!);
    expect([d.name, d.power, d.toughness, d.manaValue, d.subtypes]).toEqual(['Graveyard Trespasser', 3, 3, 3, ['Human', 'Werewolf']]);
    // CR 712.8e (back face mana value): the back face uses the front face's mana value.
    expect([n.name, n.power, n.toughness, n.manaValue, n.subtypes]).toEqual(['Graveyard Glutton', 4, 4, 3, ['Werewolf']]);
  });

  it('scenario 1: cast by day; ETB exiles the creature card from the opponent graveyard; drain 1', () => {
    const s = given({
      turn: 2, step: 'main1', active: 0,
      battlefield: ['Swamp', 'Swamp', 'Swamp', { card: 'Mountain', controller: 1 }],
      hands: [[TRESPASSER], [TestBolt.id]], graveyards: [[], [TestBear.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, TRESPASSER));
    resolveStack(s);
    // CR 702.145d (becomes day): a daybound permanent with neither day nor night makes it day.
    expect(s.dayNight).toBe('day');
    // Up to one target: the options are no target or the creature card (collapsed to creature cards).
    pickTargetsOfSize(s, 1);
    resolveStack(s);
    expect(ids(s, TestBear.id, 'exile', 1).length).toBe(1);
    expect(s.players[1].life).toBe(19);
    expect(s.players[0].life).toBe(21);
  });

  it('noncreature cards in graveyards are not offered; with none the trigger has no targets and does nothing', () => {
    const s = given({
      turn: 2, step: 'main1', active: 0,
      battlefield: ['Swamp', 'Swamp', 'Swamp', { card: 'Mountain', controller: 1 }],
      hands: [[TRESPASSER], [TestBolt.id]], graveyards: [[], [TestBolt.id, 'Mountain']], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, TRESPASSER));
    resolveStack(s);
    expect(s.pendingChoice).toBeNull();
    expect(s.zones.graveyard[1].length).toBe(2);
    expect(s.players[1].life).toBe(20);
  });

  describe('scenario 2: ward, discard a card (CR 702.21a (ward))', () => {
    const setup = (hand: string[]): GameState => {
      const s = given({
        turn: 2, step: 'main1', active: 1,
        battlefield: [TRESPASSER, 'Swamp', { card: 'Mountain', controller: 1 }],
        hands: [[TestBolt.id], hand], libraries: [lib(5), lib(5)],
      });
      s.dayNight = 'day';
      invalidateMemo(s);
      act(s, castMove(s, 'Test Bolt', [O(id1(s, TRESPASSER))]));
      resolveStack(s);
      return s;
    };

    it('the targeting player pays: discards, and the Bolt resolves and kills the 3/3', () => {
      const s = setup([TestBolt.id, TestBear.id, TestBear.id]);
      expect(s.pendingChoice).toMatchObject({ kind: 'pickIndex', player: 1, reason: 'wardPay' });
      answer(s, { index: 1 });
      if (s.pendingChoice?.kind === 'pickObjects') answer(s, { ids: [s.pendingChoice.from[0]!] });
      resolveStack(s);
      expect(ids(s, TestBear.id, 'graveyard', 1).length).toBe(1);
      expect(ids(s, TRESPASSER, 'graveyard', 0).length).toBe(1);
    });

    it('the targeting player declines: the Bolt is countered and Trespasser survives', () => {
      const s = setup([TestBolt.id, TestBear.id]);
      answer(s, { index: 0 });
      resolveStack(s);
      expect(ids(s, TRESPASSER, 'battlefield', 0).length).toBe(1);
      expect(ids(s, TestBolt.id, 'graveyard', 1).length).toBe(1);
      expect(s.zones.hand[1].length).toBe(1);
    });

    it('a player with no card in hand cannot pay: the Bolt is countered', () => {
      // No wardPay decision is asked: the game plays on (nobody has a decision) with the Bolt countered.
      const s = setup([TestBolt.id]);
      expect(s.pendingChoice?.kind).not.toBe('pickIndex');
      expect(ids(s, TRESPASSER, 'battlefield', 0).length).toBe(1);
      expect(ids(s, TestBolt.id, 'graveyard', 1).length).toBe(1);
    });
  });

  it('scenario 3: no spells on a turn makes it night (4/4 Glutton); two spells in a turn make it day (3/3)', () => {
    const s = given({
      turn: 2, step: 'upkeep', active: 1,
      battlefield: [TRESPASSER, 'Mountain', { card: 'Mountain', controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id, TestBolt.id]], libraries: [lib(10), lib(10)],
    });
    s.dayNight = 'day';
    invalidateMemo(s);
    const tr = id1(s, TRESPASSER);
    while (s.turn < 3) pass(s); // player 1 casts nothing on turn 2
    // CR 731.2a (day becomes night) and CR 702.145b (daybound transforms as it becomes night).
    expect(s.dayNight).toBe('night');
    expect(s.objects[tr]?.face).toBe(1);
    expect([characteristics(s, tr).power, characteristics(s, tr).toughness]).toEqual([4, 4]);
    while (s.turn < 4 || s.step !== 'main1') pass(s);
    act(s, castMove(s, 'Test Bolt', [P(0)]));
    resolveStack(s);
    act(s, castMove(s, 'Test Bolt', [P(0)]));
    resolveStack(s);
    while (s.turn < 5) pass(s);
    // CR 731.2b (night becomes day) and CR 702.145e (nightbound transforms as it becomes day).
    expect(s.dayNight).toBe('day');
    expect(s.objects[tr]?.face).toBe(0);
    expect([characteristics(s, tr).power, characteristics(s, tr).toughness]).toEqual([3, 3]);
  });

  it('CR 702.145b (daybound): cast at night it enters transformed, and the Glutton ETB exiles up to two, draining per creature', () => {
    const s = given({
      turn: 2, step: 'main1', active: 0,
      battlefield: ['Swamp', 'Swamp', 'Swamp', { card: 'Mountain', controller: 1 }],
      hands: [[TRESPASSER], [TestBolt.id]], graveyards: [[], [TestBear.id, TestBear.id]], libraries: [lib(5), lib(5)],
    });
    s.dayNight = 'night';
    invalidateMemo(s);
    act(s, castMove(s, TRESPASSER));
    resolveStack(s);
    expect(s.objects[id1(s, TRESPASSER)]?.face).toBe(1);
    pickTargetsOfSize(s, 2);
    resolveStack(s);
    expect(ids(s, TestBear.id, 'exile', 1).length).toBe(2);
    expect(s.players[1].life).toBe(18);
    expect(s.players[0].life).toBe(22);
  });

  it('the attack trigger exiles a creature card and drains', () => {
    const s = given({
      turn: 2, step: 'main1', active: 0,
      battlefield: [TRESPASSER, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], graveyards: [[TestBear.id], []], libraries: [lib(5), lib(5)],
    });
    s.dayNight = 'day';
    invalidateMemo(s);
    while (s.pendingChoice?.kind !== 'declareAttackers') pass(s);
    act(s, { type: 'declareAttackers', assignments: [[id1(s, TRESPASSER), { kind: 'player', p: 1 }]] });
    // A card from any graveyard, the controller's own included.
    pickTargetsOfSize(s, 1);
    resolveStack(s);
    expect(ids(s, TestBear.id, 'exile', 0).length).toBe(1);
    expect(s.players[1].life).toBe(19);
    expect(s.players[0].life).toBe(21);
  });
});
