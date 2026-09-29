import { describe, expect, it } from 'vitest';
import { given, id1, TestBear, TestBolt } from '../helpers.js';
import { activations, passUntil, playLandNow } from './lands-util.js';
import { act, moves } from '../scenario.js';
import { characteristics, hasKeyword, isType } from '../../engine/statics.js';
import { checkBlocks } from '../../engine/combat.js';
import { dealDamage } from '../../engine/damage.js';
import { checkSBA } from '../../engine/sba.js';
import { sourceOptions } from '../../engine/mana.js';
import { makeCtx } from '../../engine/ctx.js';
import type { GameState, ObjId } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => 'Swamp');

/** Animates the Hive (resolving its ability through the engine) and reaches the attack declaration. */
function animateAndAttack(s: GameState): ObjId {
  const hive = id1(s, 'Hive of the Eye Tyrant');
  const [m] = activations(s, hive);
  expect(m).toBeDefined();
  act(s, m!);
  passUntil(s, (x) => x.pendingChoice?.kind === 'declareAttackers');
  act(s, { type: 'declareAttackers', assignments: [[hive, { kind: 'player', p: 1 }]] });
  return hive;
}

describe('Hive of the Eye Tyrant', () => {
  it('enters tapped with Swamp and Blood Crypt; with one other land it enters untapped and taps for B', () => {
    const s = given({ battlefield: ['Swamp', 'Blood Crypt'], hands: [['Hive of the Eye Tyrant'], []] });
    expect(s.objects[playLandNow(s, 'Hive of the Eye Tyrant')]!.tapped).toBe(true);
    const t = given({ battlefield: ['Swamp'], hands: [['Hive of the Eye Tyrant'], []] });
    const h = playLandNow(t, 'Hive of the Eye Tyrant');
    expect(t.objects[h]!.tapped).toBe(false);
    expect(sourceOptions(t, h).flatMap((o) => o.colors)).toEqual(['B']);
  });

  it('CR 702.111b (menace): one blocker is not offered, two are; the attack trigger exiles a card from the defender\'s graveyard', () => {
    const s = given({
      battlefield: ['Hive of the Eye Tyrant', 'Swamp', 'Swamp', 'Swamp', 'Swamp',
        { card: TestBear.id, controller: 1 }, { card: TestBear.id, controller: 1 }],
      graveyards: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const hive = animateAndAttack(s);
    expect(hasKeyword(s, hive, 'menace')).toBe(true);
    passUntil(s, (x) => x.pendingChoice?.kind === 'declareBlockers');
    // The trigger resolved before blocks: the Bolt left player 1's graveyard for exile.
    expect(s.zones.graveyard[1].length).toBe(0);
    expect(s.zones.exile[1].length).toBe(1);
    const bears = s.zones.battlefield.filter((id) => s.objects[id]!.defId === TestBear.id);
    const blocks = moves(s).filter((m) => m.type === 'declareBlockers').map((m) => (m.type === 'declareBlockers' ? m.assignments.length : -1)).sort();
    expect(blocks).toEqual([0, 2]);
    expect(checkBlocks(s, [[bears[0]!, hive]])).not.toBeNull();
    expect(checkBlocks(s, [[bears[0]!, hive], [bears[1]!, hive]])).toBeNull();
  });

  it('with a single untapped blocker the only block declaration is no block', () => {
    const s = given({
      battlefield: ['Hive of the Eye Tyrant', 'Swamp', 'Swamp', 'Swamp', 'Swamp', { card: TestBear.id, controller: 1 }],
      graveyards: [[], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    animateAndAttack(s);
    passUntil(s, (x) => x.pendingChoice?.kind === 'declareBlockers');
    expect(moves(s)).toEqual([{ type: 'declareBlockers', assignments: [] }]);
  });

  it('CR 603.3d (no legal target): with an empty defending graveyard the trigger never goes on the stack', () => {
    const s = given({
      battlefield: ['Hive of the Eye Tyrant', 'Swamp', 'Swamp', 'Swamp', 'Swamp', { card: TestBear.id, controller: 1 }, { card: TestBear.id, controller: 1 }],
      libraries: [lib(5), lib(5)],
    });
    animateAndAttack(s);
    expect(s.zones.stack.length).toBe(0);
    expect(s.pendingChoice?.kind).toBe('declareBlockers');
  });

  it('animated Hive survives 2 damage; 4 damage kills it and it goes to the graveyard as a land card, setting revolt', () => {
    const s = given({ battlefield: ['Hive of the Eye Tyrant', { card: 'Mountain', controller: 1 }] });
    const hive = id1(s, 'Hive of the Eye Tyrant');
    const mountain = id1(s, 'Mountain');
    makeCtx(s, hive, 0, 'test').animate(hive, { types: ['Creature'], subtypes: ['Beholder'], colors: ['B'], pt: [3, 3], keywords: ['menace'] });
    dealDamage(s, mountain, { kind: 'obj', id: hive }, 2, false, { controller: 1 });
    checkSBA(s);
    expect(s.objects[hive]?.zone).toBe('battlefield');
    dealDamage(s, mountain, { kind: 'obj', id: hive }, 2, false, { controller: 1 });
    checkSBA(s);
    expect(s.objects[hive]).toBeUndefined();
    const card = id1(s, 'Hive of the Eye Tyrant', 'graveyard');
    expect(isType(s, card, 'Land')).toBe(true);
    expect(isType(s, card, 'Creature')).toBe(false);
    expect(characteristics(s, card).manaValue).toBe(0);
    expect(s.turnFlags.permanentLeft[0]).toBe(true);
  });
});
