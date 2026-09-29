// Determinized sample for one-ply and search agents (Decision.sample). Starts from a copy of the
// real state and removes everything the deciding player does not know:
//  - the identities of the cards hidden from them (the opponent's unknown hand cards and unknown
//    library cards; their own library outside the known top and bottom positions) are permuted
//    among those hidden slots with the agent's RNG, one pool per owner;
//  - the game seed is replaced from the agent's RNG.
// The permuted multiset is exactly the owner's deck minus every card the player can see, which the
// player can compute from the public decklist, so the sample carries no information beyond the
// view plus the decklists (PLAN.md D16; the view-based determinizer of Phase 4 samples the same
// distribution from a PlayerView). Hidden ids carry no identity (ids follow the shuffle), so
// keeping them leaks nothing. Uniform over the hidden slots: no inference from what the opponent
// kept or has not played.
import { cloneState } from '../engine/apply.js';
import { invalidateMemo } from '../engine/mutate.js';
import { nextU32, seedRng, shuffle } from '../engine/rng.js';
import type { DefId, GameState, ObjId, PlayerId, RngState } from '../engine/types.js';

/** Ids of the objects whose identity is hidden from viewer (same rule as the fuzz view-leak check). */
export function hiddenFrom(state: GameState, viewer: PlayerId): [ObjId[], ObjId[]] {
  const pc = state.pendingChoice;
  const revealed: readonly ObjId[] = pc && pc.kind === 'pickObjects' && pc.player === viewer ? pc.reveal ?? [] : [];
  const out: [ObjId[], ObjId[]] = [[], []];
  for (const owner of [0, 1] as const) {
    const known = owner === viewer ? state.players[owner].libraryKnown : null;
    for (const zone of ['hand', 'library'] as const) {
      if (zone === 'hand' && owner === viewer) continue;
      for (const id of state.zones[zone][owner]) {
        const o = state.objects[id];
        if (!o || o.knownTo[viewer] || revealed.includes(id)) continue;
        if (known && (known.top.includes(id) || known.bottom.includes(id))) continue;
        out[owner].push(id);
      }
    }
  }
  return out;
}

/** A copy of state with every card hidden from viewer re-dealt from rng (the state is untouched). */
export function sampleHidden(state: GameState, viewer: PlayerId, rng: RngState): GameState {
  const s = cloneState(state);
  const pools = hiddenFrom(s, viewer);
  for (const ids of pools) {
    if (ids.length < 2) continue;
    const defs: DefId[] = ids.map((id) => (s.objects[id] as { defId: DefId }).defId);
    shuffle(rng, defs);
    ids.forEach((id, i) => {
      const o = s.objects[id];
      if (!o) return;
      o.defId = defs[i] as DefId;
      o.face = 0;
    });
  }
  s.seed = seedRng(nextU32(rng) * 2097152 + (nextU32(rng) >>> 11));
  invalidateMemo(s);
  return s;
}
