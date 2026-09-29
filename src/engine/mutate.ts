// Primitive mutators. Every state change in the engine goes through this file so that, when
// state.journal is present (journal mode), each change appends its inverse and undoTo can rewind.
// In copy mode (no journal) the same functions run without recording.
//
// Rule for callers: never share one sub-object between two places in state, and never mutate a
// state array or object directly. Values passed in become owned by state.
import { nextInt, cloneRng } from './rng.js';
import type {
  ContinuousEffect, CounterType, GameEvent, GameObject, GameState, Inverse, ManaPoolEntry, ObjId, PathKey,
  PlayerId, PlayerState, StackItem, Zone,
} from './types.js';

// ---- characteristics memo (lives outside state; see statics.ts) ------------------------------

const memos = new WeakMap<GameState, unknown>();
/** Second, finer memo for data that also reads non-characteristic object fields (classKey). */
const objMemos = new WeakMap<GameState, unknown>();
// The last state looked up and its two memos, so the hot path skips the WeakMap lookups (perf,
// docs/PERF.md T1.5). setMemo, setObjMemo and invalidateMemo keep them in step with the maps.
let lastState: GameState | null = null;
let lastMemo: unknown;
let lastObjMemo: unknown;
function useState(state: GameState): void {
  if (lastState === state) return;
  lastState = state;
  lastMemo = memos.get(state);
  lastObjMemo = objMemos.get(state);
}
export function getMemo<T>(state: GameState): T | undefined {
  useState(state);
  return lastMemo as T | undefined;
}
export function setMemo<T>(state: GameState, memo: T): void {
  memos.set(state, memo);
  useState(state);
  lastMemo = memo;
}
export function getObjMemo<T>(state: GameState): T | undefined {
  useState(state);
  return lastObjMemo as T | undefined;
}
export function setObjMemo<T>(state: GameState, memo: T): void {
  objMemos.set(state, memo);
  useState(state);
  lastObjMemo = memo;
}
/** Drops both memos. Mutators call this; tests that edit state by hand must too. */
export function invalidateMemo(state: GameState): void {
  memos.delete(state);
  objMemos.delete(state);
  if (lastState === state) { lastMemo = undefined; lastObjMemo = undefined; }
  contentTick++;
}

// ---- content tick (docs/PERF.md, T1.5) ------------------------------------------------------

/**
 * A process-wide counter bumped by every write to any state except the priority bookkeeping
 * (TIMING_KEYS) and the event buffer, and by invalidateMemo (undo, hand edits in tests). A result
 * computed from state fields other than those, and stamped with the tick it was computed at, is
 * still valid while the tick is unchanged. A write to another state bumps it too, which only costs
 * a recomputation. Used by the auto-pass check (moves.ts) and the state-based action skip (apply.ts).
 */
let contentTick = 0;
export function getContentTick(): number {
  return contentTick;
}
/** Top-level keys whose writes do not bump the tick: who has priority, the pass count and the step. */
const TIMING_KEYS: ReadonlySet<PathKey> = new Set<PathKey>(['priority', 'passes', 'step', 'phaseQueue', 'stepPriority']);
function bumpFor(path: readonly PathKey[]): void {
  const head = path[0] as PathKey;
  if (head === 'events' || (path.length === 1 && TIMING_KEYS.has(head))) return;
  contentTick++;
}
/**
 * Object fields that computeChars (statics.ts), the card CDAs, the static list and the listener
 * index never read, so changing them keeps the characteristics memo (perf, docs/PERF.md). classKey
 * reads some of them, so they still drop the object memo.
 */
const NON_CHAR_FIELDS: ReadonlySet<PathKey> = new Set<PathKey>([
  'tapped', 'damage', 'sick', 'knownTo', 'damagedThisTurnBy', 'valiantUsed', 'attacksThisTurn', 'attacking', 'blocking',
  'blocked', 'deathtouched', 'crewed', 'onAdventure', 'chosenName',
]);
/** Counter types characteristics read (P/T); others (loyalty, lore, charge...) only drop the object memo. */
const CHAR_COUNTERS: ReadonlySet<PathKey> = new Set<PathKey>(['p1p1', 'm1m1']);
/** For an objects path: is that object on the battlefield now (called before and after the change). */
function onFieldAt(state: GameState, path: readonly PathKey[]): boolean {
  return path[0] === 'objects' && state.objects[path[1] as ObjId]?.zone === 'battlefield';
}
/**
 * Drops what a change at path can make stale. Mana pools, life, log, events, the stack array and
 * hidden zones touch neither memo. The characteristics of an object off the battlefield read only
 * its own fields, and every memoized aggregate (Urborg, land masks, static lists, the trigger
 * listener index) reads battlefield objects only, so a change to an object that is not on the
 * battlefield before or after it drops only that object's entries; a non-characteristic field of
 * a battlefield object drops only its classKey. Everything else drops both memos.
 */
function invalidateFor(state: GameState, path: readonly PathKey[], wasOnField: boolean, changed?: readonly unknown[]): void {
  bumpFor(path);
  const head = path[0];
  if (head === 'objects') {
    const id = path[1] as ObjId;
    const field = path[2];
    const nonChar = field !== undefined && (NON_CHAR_FIELDS.has(field)
      || (field === 'counters' && path[3] !== undefined && !CHAR_COUNTERS.has(path[3] as PathKey)));
    if (nonChar || !(wasOnField || onFieldAt(state, path))) {
      const keys = getObjMemo<Record<number, unknown>>(state);
      if (keys) delete keys[id];
      if (!nonChar) {
        // Layout shared with statics.ts (Memo.chars and Memo.actKeys, which derives from chars).
        const m = getMemo<{ chars?: Record<number, unknown>; actKeys?: Record<number, unknown> }>(state);
        if (m?.chars) delete m.chars[id];
        if (m?.actKeys) delete m.actKeys[id];
      }
      return;
    }
    // A battlefield object's animation overlay changes its own characteristics and the battlefield
    // aggregates only; adding or deleting a battlefield object that is not in the battlefield array
    // (moveObject adds before pushZone and deletes after removeZone) touches only its own entries.
    if (partialDrop && path.length === 3 && field === 'animated' && partialDrop(state, [id], true)) return;
    if (partialDrop && path.length === 2 && !state.zones.battlefield.includes(id) && partialDrop(state, [id], false)) return;
    invalidateMemo(state);
    return;
  }
  if (head === 'effects' || head === 'dayNight') { invalidateMemo(state); return; }
  if (head === 'zones' && path[1] === 'battlefield') {
    // Objects entering or leaving: their own entries, their hosts' and the aggregates (statics.ts).
    if (partialDrop && changed && partialDrop(state, changed as ObjId[], true)) return;
    invalidateMemo(state);
  }
}

/**
 * Finer memo invalidation, installed by statics.ts (which owns the memo layout and knows which
 * objects' characteristics read which): drops the entries of ids (and, with aggregates, their
 * hosts' entries and the battlefield-wide aggregates) and returns true, or returns false when only
 * a full drop is safe (perf, docs/PERF.md T1.5).
 */
type PartialDrop = (state: GameState, ids: readonly ObjId[], aggregates: boolean) => boolean;
let partialDrop: PartialDrop | null = null;
export function setPartialDrop(fn: PartialDrop): void {
  partialDrop = fn;
}

/**
 * Deep copy of plain JSON-like data (arrays, plain objects, primitives), keeping key order.
 * Several times faster than structuredClone for the small objects the engine snapshots (LKI,
 * overlays); state holds only plain data (PLAN.md section 6), so the two agree (docs/PERF.md).
 */
export function cloneData<T>(x: T): T {
  if (typeof x !== 'object' || x === null) return x;
  if (Array.isArray(x)) {
    const n = x.length;
    const out: unknown[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = cloneData(x[i]);
    return out as T;
  }
  const out: Record<string, unknown> = {};
  for (const k in x) out[k] = cloneData((x as Record<string, unknown>)[k]);
  return out as T;
}

// ---- journal --------------------------------------------------------------------------------

export function beginJournal(state: GameState): void {
  if (!state.journal) state.journal = [];
}
export function endJournal(state: GameState): void {
  // Not delete: deleting a key moves the state into V8 dictionary mode (docs/PERF.md).
  state.journal = undefined;
}
/** Current journal position; pass it to undoTo later. */
export function mark(state: GameState): number {
  if (!state.journal) throw new Error('mark: journal mode is off (call beginJournal first)');
  return state.journal.length;
}

function resolve(state: GameState, path: readonly PathKey[]): Record<PathKey, unknown> {
  let cur: unknown = state;
  for (let i = 0; i < path.length - 1; i++) {
    cur = (cur as Record<PathKey, unknown>)[path[i] as PathKey];
    if (cur === undefined || cur === null) throw new Error(`mutate: bad path ${path.join('.')}`);
  }
  return cur as Record<PathKey, unknown>;
}

export function undoTo(state: GameState, markAt: number): void {
  const j = state.journal;
  if (!j) throw new Error('undoTo: journal mode is off');
  if (markAt > j.length) throw new Error(`undoTo: mark ${markAt} is past the journal end ${j.length}`);
  while (j.length > markAt) {
    const inv = j.pop() as Inverse;
    if (inv.op === 'set') {
      const container = resolve(state, inv.path);
      const key = inv.path[inv.path.length - 1] as PathKey;
      if (inv.had) container[key] = inv.old;
      else delete container[key];
    } else {
      const arr = resolve(state, [...inv.path, 0]) as unknown as unknown[];
      arr.splice(inv.index, inv.del, ...inv.ins);
    }
  }
  invalidateMemo(state);
}

// ---- generic primitives -----------------------------------------------------------------------

/** Sets container[key] = value where container is reached by path (last element is the key). */
export function setIn(state: GameState, path: PathKey[], value: unknown): void {
  const container = resolve(state, path);
  const key = path[path.length - 1] as PathKey;
  const wasOnField = onFieldAt(state, path);
  if (state.journal) {
    const had = Object.prototype.hasOwnProperty.call(container, key);
    state.journal.push(had ? { op: 'set', path, had, old: container[key] } : { op: 'set', path, had });
  }
  container[key] = value;
  invalidateFor(state, path, wasOnField);
}

/** Deletes container[key] (for optional fields). */
export function deleteIn(state: GameState, path: PathKey[]): void {
  const container = resolve(state, path);
  const key = path[path.length - 1] as PathKey;
  if (!Object.prototype.hasOwnProperty.call(container, key)) return;
  const wasOnField = onFieldAt(state, path);
  if (state.journal) state.journal.push({ op: 'set', path, had: true, old: container[key] });
  delete container[key];
  invalidateFor(state, path, wasOnField);
}

/** Array splice on the array at arrPath; returns the removed items. */
export function spliceIn<T>(state: GameState, arrPath: PathKey[], index: number, del: number, ...ins: T[]): T[] {
  const arr = resolve(state, [...arrPath, 0]) as unknown as T[];
  if (!Array.isArray(arr)) throw new Error(`spliceIn: ${arrPath.join('.')} is not an array`);
  const removed = arr.splice(index, del, ...ins);
  if (state.journal) state.journal.push({ op: 'splice', path: arrPath, index, del: ins.length, ins: removed });
  invalidateFor(state, arrPath, onFieldAt(state, arrPath), arrPath[0] === 'zones' && arrPath[1] === 'battlefield' ? [...ins, ...removed] : undefined);
  return removed;
}

// ---- named primitives (PLAN.md section 6) --------------------------------------------------

export function setField<K extends keyof GameObject>(state: GameState, id: ObjId, key: K, value: GameObject[K]): void {
  setIn(state, ['objects', id, key], value);
}
export function clearField(state: GameState, id: ObjId, key: keyof GameObject): void {
  deleteIn(state, ['objects', id, key]);
}
export function setPlayer<K extends keyof PlayerState>(state: GameState, p: PlayerId, key: K, value: PlayerState[K]): void {
  setIn(state, ['players', p, key], value);
}
export function setTop<K extends keyof GameState>(state: GameState, key: K, value: GameState[K]): void {
  setIn(state, [key], value);
}

type ObjZone = Exclude<Zone, 'stack'>;
function zonePath(zone: ObjZone, owner: PlayerId): PathKey[] {
  return zone === 'battlefield' ? ['zones', 'battlefield'] : ['zones', zone, owner];
}
export function zoneArray(state: GameState, zone: ObjZone, owner: PlayerId): ObjId[] {
  return zone === 'battlefield' ? state.zones.battlefield : state.zones[zone][owner];
}

/** Adds id to a zone array. Library: 'top' (default) appends, 'bottom' prepends. */
export function pushZone(state: GameState, zone: ObjZone, owner: PlayerId, id: ObjId, position: 'top' | 'bottom' = 'top'): void {
  const arr = zoneArray(state, zone, owner);
  spliceIn(state, zonePath(zone, owner), position === 'bottom' ? 0 : arr.length, 0, id);
}

/** Removes id from a zone array; returns its former index, or -1 if absent. */
export function removeZone(state: GameState, zone: ObjZone, owner: PlayerId, id: ObjId): number {
  const arr = zoneArray(state, zone, owner);
  const i = arr.lastIndexOf(id);
  if (i >= 0) spliceIn(state, zonePath(zone, owner), i, 1);
  return i;
}

export function pushStack(state: GameState, item: StackItem): void {
  spliceIn(state, ['zones', 'stack'], state.zones.stack.length, 0, item);
}
export function removeStackItem(state: GameState, id: ObjId): StackItem | undefined {
  const i = state.zones.stack.findIndex((s) => s.id === id);
  if (i < 0) return undefined;
  return spliceIn<StackItem>(state, ['zones', 'stack'], i, 1)[0];
}

/** Adds n (may be negative) counters; the key is removed when the count reaches zero. */
export function addCounter(state: GameState, id: ObjId, type: CounterType, n: number): void {
  const obj = state.objects[id];
  if (!obj) throw new Error(`addCounter: no object ${id}`);
  const next = (obj.counters[type] ?? 0) + n;
  if (next < 0) throw new Error(`addCounter: ${type} on ${id} would go negative`);
  if (next === 0) deleteIn(state, ['objects', id, 'counters', type]);
  else setIn(state, ['objects', id, 'counters', type], next);
}

export function addEffect(state: GameState, effect: ContinuousEffect): void {
  spliceIn(state, ['effects'], state.effects.length, 0, effect);
}
export function removeEffect(state: GameState, eid: number): void {
  const i = state.effects.findIndex((e) => e.eid === eid);
  if (i >= 0) spliceIn(state, ['effects'], i, 1);
}

export function setPool(state: GameState, p: PlayerId, entries: ManaPoolEntry[]): void {
  setIn(state, ['players', p, 'manaPool'], entries);
}
export function addPoolEntry(state: GameState, p: PlayerId, entry: ManaPoolEntry): void {
  spliceIn(state, ['players', p, 'manaPool'], state.players[p].manaPool.length, 0, entry);
}
export function removePoolEntry(state: GameState, p: PlayerId, index: number): ManaPoolEntry {
  const removed = spliceIn<ManaPoolEntry>(state, ['players', p, 'manaPool'], index, 1);
  if (removed.length !== 1) throw new Error(`removePoolEntry: no entry ${index}`);
  return removed[0] as ManaPoolEntry;
}

export function allocId(state: GameState): ObjId {
  const id = state.nextId;
  setTop(state, 'nextId', id + 1);
  return id;
}

export function addObject(state: GameState, obj: GameObject): void {
  if (state.objects[obj.id]) throw new Error(`addObject: id ${obj.id} exists`);
  setIn(state, ['objects', obj.id], obj);
}
export function deleteObject(state: GameState, id: ObjId): void {
  deleteIn(state, ['objects', id]);
}

export function pushEvent(state: GameState, ev: GameEvent): void {
  spliceIn(state, ['events'], state.events.length, 0, ev);
}
/** Removes and returns all buffered events. */
export function drainEvents(state: GameState): GameEvent[] {
  if (state.events.length === 0) return [];
  return spliceIn<GameEvent>(state, ['events'], 0, state.events.length);
}

/** Draws from the game RNG stream (game-private) with a journaled state change. */
export function randomInt(state: GameState, n: number): number {
  const s = cloneRng(state.seed);
  const r = nextInt(s, n);
  setTop(state, 'seed', s);
  return r;
}
