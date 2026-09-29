import { describe, expect, it } from 'vitest';
import { given, id1, ids } from '../helpers.js';
import { activateNow, activations } from './lands-util.js';
import { activateManaAbility, solvePayment, sourceOptions } from '../../engine/mana.js';
import { parseMana } from '../../engine/cost.js';
import { resolveTop } from '../../engine/stack.js';
import { checkSBA } from '../../engine/sba.js';

const BURN = 'ramunap-ruins:0:2';

describe('Ramunap Ruins', () => {
  it('paying {R}: the solver taps the Mountain (no life); the Ruins red costs 1 life when used', () => {
    const s = given({ battlefield: ['Ramunap Ruins', 'Mountain'] });
    const plans = solvePayment(s, 0, parseMana('{R}'), { creatureSpell: false });
    expect(plans[0]!.life).toBe(0);
    expect(plans[0]!.taps.map((t) => s.objects[t.objId]!.defId)).toEqual(['mountain']);
    const ruins = id1(s, 'Ramunap Ruins');
    const red = sourceOptions(s, ruins).find((o) => o.colors.includes('R'))!;
    expect(red.life).toBe(1);
    activateManaAbility(s, 0, ruins, red.key, 'R');
    expect(s.players[0].life).toBe(19);
    expect(s.players[0].manaPool).toEqual([{ color: 'R' }]);
  });

  it('CR 113.7a (source left): sacrificing itself, the ability still deals 2 and the opponent at 2 loses', () => {
    const s = given({ life: [20, 2], battlefield: ['Ramunap Ruins', 'Mountain', 'Mountain', 'Mountain', 'Mountain'] });
    const ruins = id1(s, 'Ramunap Ruins');
    expect(activations(s, ruins).some((m) => m.abilityKey === BURN && m.sacrifice?.[0] === ruins)).toBe(true);
    activateNow(s, 0, ruins, BURN, { sacrifice: [ruins] });
    expect(s.zones.stack.length).toBe(1);
    expect(ids(s, 'Ramunap Ruins', 'graveyard', 0).length).toBe(1);
    expect(s.zones.battlefield.length).toBe(4);
    resolveTop(s);
    expect(s.players[1].life).toBe(0);
    checkSBA(s);
    expect(s.result).toMatchObject({ winner: 0 });
  });

  it('with two Ruins, the activated one may sacrifice the other and stays on the battlefield tapped', () => {
    const s = given({ battlefield: ['Ramunap Ruins', 'Ramunap Ruins', 'Mountain', 'Mountain', 'Mountain', 'Mountain'] });
    const [a, b] = ids(s, 'Ramunap Ruins');
    activateNow(s, 0, a!, BURN, { sacrifice: [b!] });
    expect(s.objects[a!]).toMatchObject({ zone: 'battlefield', tapped: true });
    expect(s.objects[b!]).toBeUndefined();
    resolveTop(s);
    expect(s.players[1].life).toBe(18);
  });

  it('a non-Desert land cannot be sacrificed for the cost', () => {
    const s = given({ battlefield: ['Ramunap Ruins', 'Mountain', 'Mountain', 'Mountain', 'Mountain'] });
    const ruins = id1(s, 'Ramunap Ruins');
    const sacs = activations(s, ruins).filter((m) => m.abilityKey === BURN).map((m) => m.sacrifice);
    expect(sacs).toEqual([[ruins]]);
    expect(() => activateNow(s, 0, ruins, BURN, { sacrifice: [id1(s, 'Mountain')] })).toThrow();
  });
});
