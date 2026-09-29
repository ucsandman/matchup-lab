// Zone changes. moveObject is the single path for an object changing zones; it re-ids the object
// (CR 400.7 (new object)), keeps libraryKnown and knownTo consistent, applies the entering
// permanent's own enters-tapped and enters-with-counters replacements, and buffers a zoneChange
// event with last known information. The die choke point (die) consults every applicable
// 'would die' replacement and asks the affected object's controller when two or more apply.
import { getDef, TOKEN_IDS, getAbility } from '../cards/index.js';
import {
  addObject, allocId, cloneData, deleteObject, pushEvent, pushZone, randomInt, removeStackItem, removeZone, setField, setIn,
  setPlayer, spliceIn, removeEffect,
} from './mutate.js';
import { staticAbilities } from './statics.js';
import { payLife, canPayLife } from './life.js';
import { makeCtx } from './ctx.js';
import type {
  Choice, ChoiceAnswer, CounterType, DefId, DieReplacementRef, GameObject, GameState, MoveOpts, ObjId, PlayerId,
  TokenOpts, Zone,
} from './types.js';

/** Thrown when an engine function needs a decision it was not given (see ctx.ts runWithChoices). */
export class NeedChoice extends Error {
  readonly choice: Choice;
  constructor(choice: Choice) {
    // Control flow, not a failure (runWithChoices catches it): skip the stack capture, which
    // cost about 2 percent of a random game (docs/PERF.md).
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 0;
    super(`need choice: ${choice.kind} for player ${choice.player}`);
    Error.stackTraceLimit = limit;
    this.choice = choice;
  }
}
/** Answers a Choice; engine code calls it where the rules give a player a decision. */
export type Picker = (choice: Choice) => ChoiceAnswer;

const PUBLIC: Readonly<Record<Zone, boolean>> = {
  library: false, hand: false, graveyard: true, exile: true, battlefield: true, stack: true,
};

export function getObj(state: GameState, id: ObjId): GameObject {
  const o = state.objects[id];
  if (!o) throw new Error(`no object ${id}`);
  return o;
}

/** A fresh object with default fields (used by setup, tokens and moveObject). */
export function blankObject(id: ObjId, defId: DefId, owner: PlayerId, zone: Zone): GameObject {
  return {
    id, defId, face: 0, owner, controller: owner, zone, tapped: false, damage: 0, counters: {}, sick: false,
    knownTo: [false, false], damagedThisTurnBy: [false, false],
  };
}

function snapshot(o: GameObject): GameObject {
  return cloneData(o);
}

function pruneKnown(state: GameState, owner: PlayerId, id: ObjId): void {
  const k = state.players[owner].libraryKnown;
  if (k.top.includes(id)) setIn(state, ['players', owner, 'libraryKnown', 'top'], k.top.filter((x) => x !== id));
  if (k.bottom.includes(id)) setIn(state, ['players', owner, 'libraryKnown', 'bottom'], k.bottom.filter((x) => x !== id));
}

/**
 * Evaluates the entering permanent's own enters-tapped replacements before it enters
 * (CR 614.12 (enters replacement)); 'other lands' therefore excludes the entering land.
 */
function entersTapped(state: GameState, defId: DefId, face: number, controller: PlayerId, oldId: ObjId, opts: MoveOpts): boolean {
  if (opts.tapped) return true;
  const f = getDef(defId).faces[face];
  let tapped = false;
  f?.abilities.forEach((a, i) => {
    if (a.kind !== 'static' || a.category !== 'entersTapped') return;
    const ctx = makeCtx(state, oldId, controller, `${defId}:${face}:${i}`);
    if (a.entersTapped && a.entersTapped(ctx)) tapped = true;
    if (a.payLifeToUntap) {
      if (opts.payLife && canPayLife(state, controller, a.payLifeToUntap)) payLife(state, controller, a.payLifeToUntap);
      else tapped = true;
    }
  });
  return tapped;
}

/**
 * Moves an object to another zone and returns its new id (null when a token left the battlefield
 * and ceased to exist). Moving to the stack does not push a StackItem: the caller (stack.ts) does.
 */
const PERMANENT_TYPES = ['Artifact', 'Creature', 'Enchantment', 'Planeswalker', 'Battle'];

/** Weathered Runestone (static 'graveyardLibraryLock'): a nonland permanent card can't enter from a graveyard or library. */
function lockedFromBattlefield(state: GameState, defId: string, face: number): boolean {
  if (staticAbilities(state, 'graveyardLibraryLock').length === 0) return false;
  const f = getDef(defId).faces[face];
  return !!f && !f.types.includes('Land') && f.types.some((x) => PERMANENT_TYPES.includes(x));
}

export function moveObject(state: GameState, id: ObjId, to: Zone, opts: MoveOpts = {}): ObjId | null {
  const old = getObj(state, id);
  const from = old.zone;
  if (from === to) throw new Error(`moveObject: ${id} is already in ${to}`);
  const cause = opts.cause ?? 'move';
  if (to === 'battlefield' && (from === 'graveyard' || from === 'library') && lockedFromBattlefield(state, old.defId, opts.face ?? 0)) {
    // Weathered Runestone: CR 101.2 (can't beats can): the card can't enter, so it stays where it is.
    return null;
  }

  if (from === 'stack') removeStackItem(state, id);
  else if (removeZone(state, from, old.owner, id) < 0) throw new Error(`moveObject: ${id} missing from ${from}`);
  if (from === 'library') pruneKnown(state, old.owner, id);
  // Revolt (Fatal Push) reads this; tokens count too.
  if (from === 'battlefield') setIn(state, ['turnFlags', 'permanentLeft', old.controller], true);
  if (from === 'battlefield') {
    // CR 611.3a (static ability effect): Petrified Hamlet's ban and grant stop when it leaves the battlefield.
    for (const e of [...state.effects]) if (e.kind === 'namedBan' && e.sourceId === id) removeEffect(state, e.eid);
  }

  const lki = snapshot(old);
  deleteObject(state, id);
  if (old.token && to !== 'battlefield') {
    // CR 111.7 (token ceases to exist) and CR 704.5d (token ceases to exist): a token outside the
    // battlefield ceases to exist. The event still fires, so leaves/dies triggers see it; removing it
    // at once instead of at the next SBA check is equivalent because no card in the pool looks at a
    // token in another zone.
    pushEvent(state, { e: 'zoneChange', oldId: id, newId: null, from, to, cause, lki });
    return null;
  }

  const newId = allocId(state);
  // CR 400.3 (owner's zone): hand, library and graveyard are always the owner's.
  const controller: PlayerId = to === 'battlefield' || to === 'stack'
    ? (opts.controller ?? (from === 'battlefield' || from === 'stack' ? old.controller : old.owner))
    : old.owner;
  let face: 0 | 1 = opts.face ?? (from === 'stack' && to === 'battlefield' ? old.face : 0);
  // CR 702.145b (daybound): if it is night, a daybound double-faced permanent enters transformed.
  // Decided here, before it enters, so its ETB trigger is the back face's (Graveyard Glutton).
  if (to === 'battlefield' && face === 0 && state.dayNight === 'night') {
    const d = getDef(old.defId);
    if (d.layout === 'transform' && d.faces[0]?.keywords.includes('daybound')) face = 1;
  }
  const obj = blankObject(newId, old.defId, old.owner, to);
  obj.controller = controller;
  obj.face = face;
  // Identity knowledge: public zones reveal to both; a card leaving a public zone stays known to
  // both; drawing or returning a card to hand shows it to its owner.
  if (PUBLIC[to] || PUBLIC[from]) obj.knownTo = [true, true];
  else obj.knownTo = [old.knownTo[0], old.knownTo[1]];
  if (to === 'hand' || to === 'library') obj.knownTo[old.owner] = obj.knownTo[old.owner] || from === 'hand' || PUBLIC[from] || to === 'hand';

  if (to === 'battlefield') {
    const def = getDef(old.defId);
    obj.tapped = entersTapped(state, old.defId, face, controller, id, opts);
    obj.sick = true; // CR 302.6 (summoning sickness); turn start clears it for the active player.
    const f = def.faces[face];
    const counters: Partial<Record<CounterType, number>> = {};
    // CR 714.3a (saga lore counter), CR 306.5b (loyalty counters), printed 'enters with' counters.
    if (f?.subtypes.includes('Saga')) counters.lore = 1;
    if (f?.loyalty !== undefined) counters.loyalty = f.loyalty;
    for (const [k, v] of Object.entries(f?.entersWithCounters ?? {})) counters[k as CounterType] = (counters[k as CounterType] ?? 0) + (v ?? 0);
    for (const [k, v] of Object.entries(opts.counters ?? {})) counters[k as CounterType] = (counters[k as CounterType] ?? 0) + (v ?? 0);
    obj.counters = counters;
    if (def.layout === 'room') {
      // CR 709.5d (unlocked designation): the half cast as a spell enters unlocked.
      obj.unlocked = [opts.unlockHalf === 0, opts.unlockHalf === 1];
    }
  }
  if (to === 'exile' && opts.onAdventure) obj.onAdventure = true;

  addObject(state, obj);
  if (to !== 'stack') pushZone(state, to, old.owner, newId, opts.position === 'bottom' ? 'bottom' : 'top');
  if (to === 'library') {
    const k = state.players[old.owner].libraryKnown;
    if (obj.knownTo[old.owner]) {
      if (opts.position === 'bottom') setIn(state, ['players', old.owner, 'libraryKnown', 'bottom'], [newId, ...k.bottom]);
      else setIn(state, ['players', old.owner, 'libraryKnown', 'top'], [newId, ...k.top]);
    }
  }
  pushEvent(state, { e: 'zoneChange', oldId: id, newId, from, to, cause, lki });
  if (to === 'battlefield') {
    for (const [k, v] of Object.entries(obj.counters)) {
      if (v) pushEvent(state, { e: 'counterAdded', id: newId, counter: k as CounterType, n: v });
    }
  }
  return newId;
}

/** Resolves a token name ('Blood', 'GoblinShaman') or token def id to its def id. */
export function tokenDefId(token: string): DefId {
  const id = TOKEN_IDS[token] ?? token;
  const def = getDef(id);
  if (def.layout !== 'token') throw new Error(`${token} is not a token def`);
  return id;
}

/** CR 111.2 (token owner): the creator owns the token and it enters under their control. */
export function createToken(state: GameState, token: string, controller: PlayerId, opts: TokenOpts = {}): ObjId {
  const defId = tokenDefId(token);
  const id = allocId(state);
  const obj = blankObject(id, defId, controller, 'battlefield');
  obj.token = defId;
  obj.sick = true;
  obj.knownTo = [true, true];
  obj.tapped = !!opts.tapped;
  if (opts.copyOf) obj.copyOf = opts.copyOf;
  if (opts.copyOf && opts.copyFace === 1) obj.copyFace = 1;
  if (opts.attachedTo !== undefined) obj.attachedTo = opts.attachedTo;
  if (opts.attacking) obj.attacking = opts.attacking;
  addObject(state, obj);
  pushZone(state, 'battlefield', controller, id);
  pushEvent(state, { e: 'tokenCreated', id, controller, token: defId });
  pushEvent(state, { e: 'zoneChange', oldId: null, newId: id, from: null, to: 'battlefield', cause: 'token', lki: null });
  return id;
}

/**
 * Draws one card. CR 121.2 (draw one at a time); an empty library sets the flag read by
 * CR 704.5b (draw from empty library). Returns the new hand id or null.
 */
export function drawCard(state: GameState, p: PlayerId): ObjId | null {
  const lib = state.zones.library[p];
  const top = lib[lib.length - 1];
  if (top === undefined) {
    setPlayer(state, p, 'drewFromEmpty', true);
    return null;
  }
  const id = moveObject(state, top, 'hand', { cause: 'draw' });
  if (id === null) throw new Error('drawCard: card vanished');
  pushEvent(state, { e: 'draw', player: p, id });
  return id;
}
export function drawCards(state: GameState, p: PlayerId, n: number): void {
  for (let i = 0; i < n; i++) drawCard(state, p);
}

/** CR 701.9a (discard): hand to owner's graveyard. */
export function discard(state: GameState, id: ObjId): ObjId {
  const o = getObj(state, id);
  if (o.zone !== 'hand') throw new Error(`discard: ${id} is not in a hand`);
  const nid = moveObject(state, id, 'graveyard', { cause: 'discard' }) as ObjId;
  pushEvent(state, { e: 'discard', player: o.owner, id: nid });
  return nid;
}

/** CR 701.17a (mill): top cards of the library into the graveyard. */
export function mill(state: GameState, p: PlayerId, n: number): void {
  for (let i = 0; i < n; i++) {
    const lib = state.zones.library[p];
    const top = lib[lib.length - 1];
    if (top === undefined) return;
    const nid = moveObject(state, top, 'graveyard', { cause: 'mill' }) as ObjId;
    pushEvent(state, { e: 'mill', player: p, id: nid });
  }
}

export function exileObj(state: GameState, id: ObjId, opts: MoveOpts = {}): ObjId | null {
  return moveObject(state, id, 'exile', { cause: 'exile', ...opts });
}

/**
 * Scry 1 (Torch the Tower). CR 701.22a (scry): look at the top card, keep it on top or put it on
 * the bottom. Reordering inside the library is not a zone change, so the id is kept; the owner's
 * libraryKnown records the position.
 */
export function scry1(state: GameState, p: PlayerId, toBottom: boolean): void {
  const lib = state.zones.library[p];
  const top = lib[lib.length - 1];
  if (top === undefined) return;
  setField(state, top, 'knownTo', p === 0 ? [true, getObj(state, top).knownTo[1]] : [getObj(state, top).knownTo[0], true]);
  const k = state.players[p].libraryKnown;
  if (toBottom) {
    spliceIn(state, ['zones', 'library', p], lib.length - 1, 1);
    spliceIn(state, ['zones', 'library', p], 0, 0, top);
    setIn(state, ['players', p, 'libraryKnown', 'top'], k.top.filter((x) => x !== top));
    setIn(state, ['players', p, 'libraryKnown', 'bottom'], [top, ...k.bottom.filter((x) => x !== top)]);
  } else if (k.top[0] !== top) {
    setIn(state, ['players', p, 'libraryKnown', 'top'], [top, ...k.top.filter((x) => x !== top)]);
  }
}

/**
 * CR 701.24a (shuffle): randomizes the library so no player knows its order. The library is
 * re-issued with fresh ids in the new order (PLAN.md D16) so no id links a card to its past.
 */
export function shuffleLibrary(state: GameState, p: PlayerId): void {
  const lib = state.zones.library[p];
  const defIds = lib.map((id) => getObj(state, id).defId);
  for (const id of [...lib]) deleteObject(state, id);
  for (let i = defIds.length - 1; i > 0; i--) {
    const j = randomInt(state, i + 1);
    const tmp = defIds[i] as DefId;
    defIds[i] = defIds[j] as DefId;
    defIds[j] = tmp;
  }
  const ids: ObjId[] = [];
  for (const defId of defIds) {
    const id = allocId(state);
    addObject(state, blankObject(id, defId, p, 'library'));
    ids.push(id);
  }
  setIn(state, ['zones', 'library', p], ids);
  setIn(state, ['players', p, 'libraryKnown'], { top: [], bottom: [] });
}

// ---- the die choke point ----------------------------------------------------------------------

/** Applicable 'would die' replacements for one permanent: effects first, then statics by source id. */
export function dieReplacementsFor(state: GameState, id: ObjId): DieReplacementRef[] {
  const out: DieReplacementRef[] = [];
  for (const e of state.effects) if (e.kind === 'exileIfDies' && e.target === id) out.push({ source: null, key: `effect:${e.eid}` });
  for (const s of staticAbilities(state, 'dieReplacement')) {
    const src = state.objects[s.sourceId];
    if (!src || !s.def.applies) continue;
    if (s.def.applies(makeCtx(state, s.sourceId, src.controller, s.key), id)) out.push({ source: s.sourceId, key: s.key });
  }
  return out;
}

/**
 * Puts permanents into their owners' graveyards (destroy, sacrifice, lethal damage), all as one
 * event. Every 'would die' replacement is collected first; when two or more apply to one object,
 * CR 616.1 (affected object's controller chooses) the controller picks one via pick, or NeedChoice
 * is thrown. All replacements in this pool exile instead (Kalitas, Etching of Kumano, Torch).
 * CR 700.4 (dies): dies means put into a graveyard from the battlefield.
 * Returns the new ids (graveyard or exile; null for tokens).
 */
export function die(state: GameState, ids: readonly ObjId[], cause: string, pick?: Picker): (ObjId | null)[] {
  const chosen: (DieReplacementRef | null)[] = ids.map((id) => {
    const o = getObj(state, id);
    if (o.zone !== 'battlefield') throw new Error(`die: ${id} is not on the battlefield`);
    const reps = dieReplacementsFor(state, id);
    if (reps.length === 0) return null;
    if (reps.length === 1) return reps[0] as DieReplacementRef;
    const choice: Choice = { kind: 'dieReplacement', player: o.controller, objId: id, options: reps };
    if (!pick) throw new NeedChoice(choice);
    const idx = pick(choice).index ?? -1;
    const r = reps[idx];
    if (!r) throw new Error(`die: bad replacement index ${idx}`);
    return r;
  });
  // The replacement source's controller as the event begins: the source may be dying in the same
  // event (Kalitas and an opponent's creature dealt lethal damage together); its replacement still
  // applies (CR 614.1a (instead): the event is modified as it happens) and Kalitas's controller,
  // not the dying creature's, gets the Zombie.
  const repController = chosen.map((r) => (r && r.source !== null ? state.objects[r.source]?.controller : undefined));
  return ids.map((id, i) => {
    const rep = chosen[i];
    if (!rep) return moveObject(state, id, 'graveyard', { cause });
    const lki = cloneData(getObj(state, id));
    const nid = moveObject(state, id, 'exile', { cause: `${cause}:replaced` });
    if (rep.source !== null) {
      const ab = getAbility(rep.key).ability;
      if (ab.kind === 'static' && ab.after) {
        const controller = repController[i] ?? lki.controller;
        ab.after(makeCtx(state, rep.source, controller, rep.key, pick), lki);
      }
    }
    return nid;
  });
}

/** CR 701.8a (destroy): battlefield to graveyard, through the die choke point. */
export function destroy(state: GameState, id: ObjId, pick?: Picker): ObjId | null {
  return die(state, [id], 'destroy', pick)[0] ?? null;
}

/** CR 701.21a (sacrifice): only the controller's own permanents; through the die choke point. */
export function sacrifice(state: GameState, id: ObjId, pick?: Picker): ObjId | null {
  return die(state, [id], 'sacrifice', pick)[0] ?? null;
}
