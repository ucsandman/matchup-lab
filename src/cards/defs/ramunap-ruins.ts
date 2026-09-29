import { act, card, land, mana } from '../dsl.js';
import { getDef } from '../registry.js';
import { mainOrEndStepWindow } from '../land-windows.js';
import type { GameState, ObjId } from '../../engine/types.js';

/** A Desert permanent (printed subtype; no effect in the pool adds Desert). */
function isDesert(state: GameState, id: ObjId): boolean {
  const o = state.objects[id];
  return !!o && !!getDef(o.defId).faces[o.face]?.subtypes.includes('Desert');
}

/**
 * Ramunap Ruins. Land - Desert. {T}: Add {C}. {T}, Pay 1 life: Add {R} (a mana ability with a life
 * cost, CR 605.1a (mana ability)). {2}{R}{R}, {T}, Sacrifice a Desert: 2 damage to each opponent. It
 * may sacrifice itself; the damage then uses last known information (CR 113.7a (source left)).
 */
export const RamunapRuins = card('Ramunap Ruins', [land({
  name: 'Ramunap Ruins', subtypes: ['Desert'],
  mana: [mana({ produce: ['C'] }), mana({ produce: ['R'], cost: { tap: true, life: 1 } })],
  abilities: [act({
    cost: { mana: '{2}{R}{R}', tap: true, sacrifice: { count: 1, filter: isDesert } },
    window: mainOrEndStepWindow,
    resolve: (ctx) => { ctx.dealDamage({ kind: 'player', p: ctx.opponent }, 2); },
  })],
})]);
