// View-based determinizer (PLAN.md sections 6 and 7, Phase 4). Builds a full GameState from a
// PlayerView and the two decklists, consistent with everything the viewer can see:
//  - public zones, the viewer's hand, the opponent's known hand cards and the viewer's known library
//    positions are copied verbatim with their real ids (a searcher's move names the same objects in
//    the sample and in the real game);
//  - every unknown slot (the opponent's unseen hand cards, the unknown part of both libraries) is
//    dealt from the owner's list minus every card of that owner the view shows, shuffled with the
//    caller's RNG stream: uniform over the unseen cards, no inference from what the opponent kept,
//    bottomed or has not played (the determinization weakness the Phase 4 README documents);
//  - known library positions are pinned: the viewer's known bottom (London mulligan bottoms, scry to
//    the bottom) stays at the bottom in order and the known top (scry to the top) is the next draw;
//  - unknown slots get fresh ids above every number in the view, so no id links a sampled card to a
//    real hidden object (CR 400.7 (new object)); the game seed comes from the caller's stream, never
//    from the game (the view carries no seed).
// The view carries no pending operation (state.pending) and no pending triggers, so a view whose
// choice is answered in the middle of an operation (pickObjects, pickIndex, pickTargets,
// dieReplacement) cannot be continued: prepareDeterminizer throws DeterminizeError for it. Priority,
// declareAttackers, declareBlockers, mulligan and bottom decisions are supported; the opponent's
// hidden pregame and combat choices are rebuilt from public data.
// The opponent's library order known only to the opponent (their own mulligan bottoms) is not in
// the view: the sample gives the opponent an empty libraryKnown. The view has no field for an
// opponent library card the viewer knows; no card in either 75 reveals one (docs/SPOT-FORMAT.md).
import { loadDeckFile, resolveDeck, emptyState, type DeckInput, type DeckList } from '../engine/setup.js';
import { cloneData, invalidateMemo } from '../engine/mutate.js';
import { nextU32, seedRng, shuffle } from '../engine/rng.js';
import { blankObject } from '../engine/zones.js';
import type { Choice, DefId, GameObject, GameState, ObjId, PlayerId, RngState } from '../engine/types.js';
import type { PlayerView } from '../engine/view.js';

/** A deck: a file name under decks/, a DeckList (a sideboard configuration is a DeckList), or its expanded def ids. */
export type DeckSource = DeckInput | readonly DefId[];

export class DeterminizeError extends Error {}

/** The 60 (or configured) def ids of a deck, in list order. */
export function deckDefIds(d: DeckSource): DefId[] {
  if (typeof d === 'string') return resolveDeck(loadDeckFile(d));
  if (!Array.isArray(d)) return resolveDeck(d as DeckList);
  return [...(d as readonly DefId[])];
}

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const MID_OPERATION: readonly Choice['kind'][] = ['pickObjects', 'pickIndex', 'pickTargets', 'dieReplacement'];

/** 1 + the largest non-negative integer anywhere in x (values and numeric keys). */
export function freshBase(x: unknown): number {
  let max = 0;
  const walk = (y: unknown): void => {
    if (typeof y === 'number') { if (Number.isSafeInteger(y) && y > max) max = y; return; }
    if (Array.isArray(y)) { for (const z of y) walk(z); return; }
    if (y && typeof y === 'object') {
      for (const [k, z] of Object.entries(y)) {
        const n = Number(k);
        if (Number.isSafeInteger(n) && n > max) max = n;
        walk(z);
      }
    }
  };
  walk(x);
  return max + 1;
}

/** The engine Choice the view's pendingChoice stands for, or a DeterminizeError. */
function rebuildChoice(v: PlayerView): Choice | null {
  const ch = v.pendingChoice;
  if (ch === null) return null;
  if (MID_OPERATION.includes(ch.kind)) {
    const whose = ch.player === v.viewer ? 'the viewer\'s' : 'the opponent\'s';
    throw new DeterminizeError(
      `determinize: the view's pending choice is ${whose} ${ch.kind}, asked in the middle of an operation; `
      + 'a sample would need the engine\'s pending operation, which a view does not carry');
  }
  if (!('hidden' in ch)) return cloneData(ch);
  if (ch.kind === 'mulligan' || ch.kind === 'declareAttackers' || ch.kind === 'declareBlockers') return { kind: ch.kind, player: ch.player };
  if (ch.kind === 'bottom') return { kind: 'bottom', player: ch.player, count: v.players[ch.player].mulligans };
  throw new DeterminizeError(`determinize: cannot rebuild the opponent's hidden ${ch.kind} choice`);
}

export interface Determinizer {
  /** Unknown slots per player: [hand, library] (the viewer's hand has none). */
  readonly unknown: [[number, number], [number, number]];
  /** One sample; draws from rng (the searcher's stream) and never touches the view. */
  sample(rng: RngState): GameState;
}

/**
 * Checks the view against the decklists once and returns a sampler. Throws DeterminizeError when
 * the view shows more copies of a card than a list holds, when the zone sizes do not add up to the
 * deck size, or when the pending choice cannot be continued without the engine's pending operation.
 */
export function prepareDeterminizer(v: PlayerView, decks: [DeckSource, DeckSource]): Determinizer {
  const viewer = v.viewer;
  const opp = other(viewer);
  const choice = rebuildChoice(v);
  if (v.zones.hand[viewer].hidden.length > 0) throw new DeterminizeError('determinize: the viewer\'s own hand has hidden cards');
  if (v.zones.library[opp].knownTop?.length || v.zones.library[opp].knownBottom?.length) {
    throw new DeterminizeError('determinize: known positions in the opponent\'s library are not part of a view');
  }

  // Pools: each list minus every card of that owner the view shows (tokens are not cards of the list).
  const pools: [DefId[], DefId[]] = [[], []];
  for (const p of [0, 1] as const) {
    const left = new Map<DefId, number>();
    const list = deckDefIds(decks[p]);
    for (const d of list) left.set(d, (left.get(d) ?? 0) + 1);
    for (const o of Object.values(v.objects)) {
      if (o.owner !== p || o.token !== undefined) continue;
      const n = left.get(o.defId) ?? 0;
      if (n <= 0) {
        const have = list.filter((d) => d === o.defId).length;
        throw new DeterminizeError(`determinize: player ${p}'s visible cards include more ${o.defId} than the list's ${have}`);
      }
      left.set(o.defId, n - 1);
    }
    for (const [d, n] of left) for (let i = 0; i < n; i++) pools[p].push(d);
    const lib = v.zones.library[p];
    const knownLib = (lib.knownTop?.length ?? 0) + (lib.knownBottom?.length ?? 0);
    const slots = v.zones.hand[p].hidden.length + lib.size - knownLib;
    if (slots !== pools[p].length) {
      throw new DeterminizeError(
        `determinize: player ${p} has ${slots} unknown slots (hand ${v.zones.hand[p].hidden.length}, library ${lib.size - knownLib}) `
        + `but ${pools[p].length} cards of the list are unseen (list ${list.length})`);
    }
  }

  const base = freshBase(v);
  const knownTop = v.zones.library[viewer].knownTop ?? [];
  const knownBottom = v.zones.library[viewer].knownBottom ?? [];
  const unknown: [[number, number], [number, number]] = [[0, 0], [0, 0]];
  for (const p of [0, 1] as const) {
    const lib = v.zones.library[p];
    unknown[p] = [v.zones.hand[p].hidden.length, lib.size - (lib.knownTop?.length ?? 0) - (lib.knownBottom?.length ?? 0)];
  }

  function sample(rng: RngState): GameState {
    const s = emptyState(0);
    s.seed = seedRng(nextU32(rng) * 2097152 + (nextU32(rng) >>> 11));
    s.turn = v.turn;
    s.activePlayer = v.activePlayer;
    s.priority = v.priority;
    s.startingPlayer = v.startingPlayer;
    s.phaseQueue = [...v.phaseQueue];
    s.step = v.step;
    for (const p of [0, 1] as const) {
      const vp = v.players[p];
      s.players[p] = {
        life: vp.life, cantGainLife: vp.cantGainLife, manaPool: cloneData(vp.manaPool), mulligans: vp.mulligans, kept: vp.kept,
        libraryKnown: p === viewer ? { top: [...knownTop], bottom: [...knownBottom] } : { top: [], bottom: [] },
        drewFromEmpty: vp.drewFromEmpty,
      };
    }
    for (const [k, o] of Object.entries(v.objects)) s.objects[Number(k)] = cloneData(o);
    let nextId = base;
    const deal = (p: PlayerId, defId: DefId, zone: 'hand' | 'library'): ObjId => {
      const id = nextId++;
      const o: GameObject = blankObject(id, defId, p, zone);
      if (zone === 'hand') o.knownTo[p] = true;
      s.objects[id] = o;
      return id;
    };
    for (const p of [0, 1] as const) {
      const pool = shuffle(rng, [...pools[p]]);
      let i = 0;
      const hand = [...v.zones.hand[p].known];
      for (let h = 0; h < unknown[p][0]; h++) hand.push(deal(p, pool[i++] as DefId, 'hand'));
      // Library arrays are bottom first: known bottom (bottom[0] is the very bottom), the unknown
      // middle, then the known top reversed (top[0] is the top card).
      const lib: ObjId[] = p === viewer ? [...knownBottom] : [];
      for (let l = 0; l < unknown[p][1]; l++) lib.push(deal(p, pool[i++] as DefId, 'library'));
      if (p === viewer) for (let t = knownTop.length - 1; t >= 0; t--) lib.push(knownTop[t] as ObjId);
      s.zones.hand[p] = hand;
      s.zones.library[p] = lib;
      s.zones.graveyard[p] = [...v.zones.graveyard[p]];
      s.zones.exile[p] = [...v.zones.exile[p]];
    }
    s.zones.battlefield = [...v.zones.battlefield];
    s.zones.stack = cloneData(v.zones.stack);
    s.nextId = nextId;
    s.dayNight = v.dayNight;
    s.turnFlags = cloneData(v.turnFlags);
    s.effects = cloneData(v.effects);
    s.pendingChoice = cloneData(choice);
    s.pending = null;
    s.passes = v.passes;
    s.stepPriority = v.stepPriority;
    s.pendingTriggers = [];
    s.delayed = cloneData(v.delayed);
    s.pregame = v.pregame ? cloneData(v.pregame) : null;
    s.result = v.result ? cloneData(v.result) : null;
    s.events = [];
    invalidateMemo(s);
    return s;
  }

  return { unknown, sample };
}

/** One determinized state for the view (see prepareDeterminizer; a searcher sampling many times should prepare once). */
export function determinize(v: PlayerView, decks: [DeckSource, DeckSource], rng: RngState): GameState {
  return prepareDeterminizer(v, decks).sample(rng);
}
