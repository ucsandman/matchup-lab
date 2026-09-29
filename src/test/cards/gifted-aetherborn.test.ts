// Gifted Aetherborn: deathtouch and lifelink in combat.
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { card, face } from '../../cards/dsl.js';
import { invalidateMemo } from '../../engine/mutate.js';
import { characteristics, KW } from '../../engine/statics.js';
import { act, pass } from '../scenario.js';
import type { GameState } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const AB = 'Gifted Aetherborn';

/** A 1/2 attacker (Monastery Swiftspear stand-in, without prowess). */
const Striker = registerTestDef(card('Test Ga Striker', [face({ name: 'Test Ga Striker', types: ['Creature'], cost: '{R}', pt: [1, 2] })]));
/** A 5/4 trampler (Swiftspear after Monstrous Rage). */
const Trampler = registerTestDef(card('Test Ga Trampler', [face({ name: 'Test Ga Trampler', types: ['Creature'], cost: '{R}', pt: [5, 4], keywords: ['trample'] })]));

const kind = (s: GameState): string | undefined => s.pendingChoice?.kind;

/** Player 1 attacks player 0 with the attacker; player 0 blocks with Aetherborn. */
function attackIntoAetherborn(attackerDef: string, life: [number, number] = [20, 20]): GameState {
  const s = given({
    turn: 2, step: 'main1', active: 1, life,
    battlefield: [AB, 'Mountain', { card: attackerDef, controller: 1 }, { card: 'Mountain', controller: 1 }],
    hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
  });
  while (kind(s) !== 'declareAttackers') pass(s);
  const a = id1(s, attackerDef);
  act(s, { type: 'declareAttackers', assignments: [[a, { kind: 'player', p: 0 }]] });
  while (kind(s) !== 'declareBlockers') pass(s);
  act(s, { type: 'declareBlockers', assignments: [[id1(s, AB), a]] });
  while (s.step !== 'combatDamage') pass(s);
  return s;
}

describe('Gifted Aetherborn', () => {
  it('matches its oracle characteristics', () => {
    const s = given({ battlefield: [AB] });
    const c = characteristics(s, id1(s, AB));
    expect([c.power, c.toughness, c.manaValue, c.subtypes]).toEqual([2, 3, 2, ['Aetherborn', 'Vampire']]);
    expect(c.kw & KW.deathtouch && c.kw & KW.lifelink).toBeTruthy();
  });

  it('scenario 1: blocks a 1/2; the attacker dies to deathtouch, Aetherborn survives with 1 damage, controller gains 2', () => {
    const s = attackIntoAetherborn(Striker.id);
    // CR 702.2b (deathtouch): any damage from it is lethal; CR 702.15b (lifelink): life gained with the damage.
    expect(ids(s, Striker.id, 'graveyard', 1).length).toBe(1);
    expect(s.objects[id1(s, AB)]?.damage).toBe(1);
    expect(s.players[0].life).toBe(22);
  });

  it('scenario 2: a 5/4 trampler assigns 3 to Aetherborn and 2 to the player; both creatures die; net life 0', () => {
    const s = attackIntoAetherborn(Trampler.id);
    // CR 702.19b (trample): lethal damage to the blocker is its toughness, 3, the rest (2) tramples over.
    expect(ids(s, AB, 'graveyard', 0).length).toBe(1);
    expect(ids(s, Trampler.id, 'graveyard', 1).length).toBe(1);
    // CR 510.2 (dealt simultaneously): 2 dealt to player 0 and 2 gained at the same time.
    expect(s.players[0].life).toBe(20);
  });

  it('scenario 3: with cantGainLife set, damage is dealt and life does not change (CR 119.7 (gain life))', () => {
    const s = given({
      turn: 2, step: 'main1', active: 0,
      battlefield: [AB, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    s.players[0].cantGainLife = true;
    invalidateMemo(s);
    while (s.pendingChoice?.kind !== 'declareAttackers') pass(s);
    act(s, { type: 'declareAttackers', assignments: [[id1(s, AB), { kind: 'player', p: 1 }]] });
    while (s.step !== 'combatDamage') pass(s);
    expect(s.players[1].life).toBe(18);
    expect(s.players[0].life).toBe(20);
  });
});
