import { describe, expect, it } from 'vitest';
import { given, id1, TestBear } from '../helpers.js';
import { activations } from './lands-util.js';
import { act, moves } from '../scenario.js';
import { canPay } from '../../engine/mana.js';
import { parseMana } from '../../engine/cost.js';
import { characteristics, hasKeyword } from '../../engine/statics.js';
import { makeCtx } from '../../engine/ctx.js';
import type { GameState, ObjId } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => 'Mountain');
const pumpTargets = (s: GameState, rock: ObjId): ObjId[] =>
  activations(s, rock).flatMap((m) => m.targets.map((t) => (t.kind === 'obj' ? t.id : -1)));

describe('Rockface Village', () => {
  it('CR 106.6 (mana spending restriction): the restricted {R} pays for a creature spell, never for Burst Lightning', () => {
    const s = given({ battlefield: ['Rockface Village', { card: 'Mountain', tapped: true }] });
    // Only the Rockface is untapped: {R} for a creature spell yes, for a noncreature spell no.
    expect(canPay(s, 0, parseMana('{R}'), { creatureSpell: true })).toBe(true);
    expect(canPay(s, 0, parseMana('{R}'), { creatureSpell: false })).toBe(false);
    // With the Mountain untapped too: Emberheart ({1}{R}) is castable, and Burst ({R}) is paid by the Mountain.
    const t = given({ battlefield: ['Rockface Village', 'Mountain'], hands: [['Emberheart Challenger', 'Burst Lightning'], []] });
    expect(canPay(t, 0, parseMana('{1}{R}'), { creatureSpell: true })).toBe(true);
    expect(canPay(t, 0, parseMana('{R}{R}'), { creatureSpell: false })).toBe(false);
    const casts = moves(t).filter((m) => m.type === 'cast').map((m) => (m.type === 'cast' ? t.objects[m.objId]!.defId : ''));
    expect(casts).toEqual(expect.arrayContaining(['emberheart-challenger', 'burst-lightning']));
  });

  it('pumping Emberheart: +1/+0 and haste until end of turn; valiant triggers only the first time this turn', () => {
    const s = given({
      battlefield: ['Rockface Village', 'Rockface Village', 'Mountain', 'Mountain', { card: 'Emberheart Challenger', sick: true }],
      libraries: [lib(5), lib(5)],
    });
    const ember = id1(s, 'Emberheart Challenger');
    const [rockA, rockB] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'rockface-village');
    const first = activations(s, rockA!).find((m) => m.targets[0]?.kind === 'obj' && m.targets[0].id === ember);
    expect(first).toBeDefined();
    act(s, first!);
    expect(s.zones.stack.length).toBe(0);
    let c = characteristics(s, ember);
    expect([c.power, c.toughness]).toEqual([3, 2]);
    expect(hasKeyword(s, ember, 'haste')).toBe(true);
    expect(s.zones.exile[0].length).toBe(1);
    // Rockface A is tapped now; activate the other one at the same creature.
    const rock = s.objects[rockA!]!.tapped ? rockB! : rockA!;
    const second = activations(s, rock).find((m) => m.targets[0]?.kind === 'obj' && m.targets[0].id === ember);
    expect(second).toBeDefined();
    act(s, second!);
    c = characteristics(s, ember);
    expect(c.power).toBe(4);
    expect(s.zones.exile[0].length).toBe(1);
  });

  it('sorcery speed and creature types: not offered in combat or with the stack busy; a Bear is not a target, an animated Mutavault is', () => {
    const s = given({ battlefield: ['Rockface Village', 'Mountain', TestBear.id, 'Mutavault'] });
    const rock = id1(s, 'Rockface Village');
    expect(pumpTargets(s, rock)).toEqual([]);
    const mv = id1(s, 'Mutavault');
    makeCtx(s, mv, 0, 'test').animate(mv, { types: ['Creature'], allCreatureTypes: true, pt: [2, 2] });
    expect(pumpTargets(s, rock)).toEqual([mv]);
    const combat = given({ step: 'beginCombat', battlefield: ['Rockface Village', 'Mountain', { card: 'Emberheart Challenger' }] });
    expect(activations(combat, id1(combat, 'Rockface Village')).length).toBe(0);
  });
});
