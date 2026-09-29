// Sagas. Lore counters: one as the Saga enters (CR 714.3a (enters with a lore counter), done in
// zones.ts moveObject) and one on each Saga the active player controls as their precombat main
// phase begins (CR 714.3c (lore counter precombat main)). A chapter ability triggers when lore
// counters are added and the count goes from below N to at least N (CR 714.2b (lore counters)); the
// trigger system reads counterAdded events (triggers.ts). The final-chapter sacrifice
// is a state-based action (CR 714.4 (saga sacrifice), sba.ts). Exile-and-return-transformed
// (Fable, Kumano, Hidetsugu, Roku chapter III) is ctx.exileAndReturnTransformed: the returned
// permanent is a new object (CR 400.7 (new object)).
import { getAbility } from '../cards/index.js';
import { addCounter, pushEvent } from './mutate.js';
import { characteristics } from './statics.js';
import type { GameState, ObjId } from './types.js';

/** CR 714.2d (final chapter number): the greatest chapter number among its chapter abilities; 0 if none. */
export function finalChapter(state: GameState, id: ObjId): number {
  let max = 0;
  for (const k of characteristics(state, id).abilities) {
    if (k.startsWith('basic:')) continue;
    const ab = getAbility(k).ability;
    if (ab.kind === 'triggered' && ab.event === 'chapter' && (ab.chapter ?? 0) > max) max = ab.chapter ?? 0;
  }
  return max;
}

export function isSaga(state: GameState, id: ObjId): boolean {
  return characteristics(state, id).subtypes.includes('Saga');
}

/** CR 714.3c (lore counter precombat main): the active player's Sagas with chapter abilities get one lore counter. */
export function addLoreForTurn(state: GameState): void {
  const ap = state.activePlayer;
  for (const id of [...state.zones.battlefield]) {
    const o = state.objects[id];
    if (!o || o.controller !== ap || !isSaga(state, id) || finalChapter(state, id) === 0) continue;
    addCounter(state, id, 'lore', 1);
    pushEvent(state, { e: 'counterAdded', id, counter: 'lore', n: 1 });
  }
}
