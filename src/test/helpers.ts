// Test helpers: a declarative state builder and two test-only card defs (TestBear, TestBolt).
// Importing this file registers the test defs; production code never imports it.
import { defIdByName, findDef, registerCard } from '../cards/index.js';
import { card, face, spell, t } from '../cards/dsl.js';
import { emptyState } from '../engine/setup.js';
import { blankObject } from '../engine/zones.js';
import { invalidateMemo } from '../engine/mutate.js';
import { priorityStep } from '../engine/turn.js';
import { TURN_STEPS } from '../engine/types.js';
import type { CardDef, CounterType, DefId, GameObject, GameState, ObjId, PlayerId, Step, Zone } from '../engine/types.js';

/** 2/2 vanilla creature for {1}{G}. */
export const TestBear: CardDef = { ...card('Test Bear', [face({ name: 'Test Bear', types: ['Creature'], subtypes: ['Bear'], cost: '{1}{G}', pt: [2, 2] })]), testOnly: true };

/** {R} instant: 3 damage to any target. */
export const TestBolt: CardDef = {
  ...card('Test Bolt', [face({
    name: 'Test Bolt', types: ['Instant'], cost: '{R}',
    abilities: [spell({ target: t.any(), resolve: (ctx, targets) => { const tg = targets[0]; if (tg) ctx.dealDamage(tg, 3); } })],
  })]),
  testOnly: true,
};

registerCard(TestBear);
registerCard(TestBolt);

/** Registers a test def once per test module (safe to call from several tests). */
export function registerTestDef(def: CardDef): CardDef {
  const d: CardDef = { ...def, testOnly: true };
  const existing = findDef(d.id);
  if (existing) return existing;
  registerCard(d);
  return d;
}

export interface ObjSpec {
  card: string;
  tapped?: boolean;
  sick?: boolean;
  damage?: number;
  face?: 0 | 1;
  counters?: Partial<Record<CounterType, number>>;
  controller?: PlayerId;
  token?: boolean;
  unlocked?: [boolean, boolean];
  knownToOpponent?: boolean;
}
type Spec = string | ObjSpec;

export interface Given {
  /** Permanents; controller defaults to 0. */
  battlefield?: Spec[];
  hands?: [Spec[], Spec[]];
  graveyards?: [Spec[], Spec[]];
  exiles?: [Spec[], Spec[]];
  /** Libraries listed top card first. */
  libraries?: [Spec[], Spec[]];
  life?: [number, number];
  turn?: number;
  step?: Step;
  active?: PlayerId;
  seed?: number;
}

export function defOf(nameOrId: string): DefId {
  if (findDef(nameOrId)) return nameOrId;
  const id = defIdByName(nameOrId);
  if (!id) throw new Error(`test: unknown card ${nameOrId}`);
  return id;
}

function place(state: GameState, spec: Spec, zone: Zone, owner: PlayerId): ObjId {
  const s: ObjSpec = typeof spec === 'string' ? { card: spec } : spec;
  const id = state.nextId++;
  const defId = defOf(s.card);
  const o: GameObject = blankObject(id, defId, owner, zone);
  o.controller = s.controller ?? owner;
  o.face = s.face ?? 0;
  o.tapped = !!s.tapped;
  o.damage = s.damage ?? 0;
  o.counters = { ...(s.counters ?? {}) };
  o.sick = !!s.sick;
  if (s.token) o.token = defId;
  if (s.unlocked) o.unlocked = s.unlocked;
  if (zone === 'battlefield' || zone === 'graveyard' || zone === 'exile') o.knownTo = [true, true];
  if (zone === 'hand') {
    o.knownTo[owner] = true;
    if (s.knownToOpponent) o.knownTo[owner === 0 ? 1 : 0] = true;
  }
  state.objects[id] = o;
  return id;
}

/** Builds a mid-game state directly (not journaled). Pregame is over; turn 1 main phase by default. */
export function given(g: Given = {}): GameState {
  const state = emptyState(g.seed ?? 1);
  state.turn = g.turn ?? 1;
  state.step = g.step ?? 'main1';
  // The rest of the turn after this step, and priority as the step normally has it (turn.ts).
  const at = TURN_STEPS.indexOf(state.step);
  state.phaseQueue = at >= 0 ? TURN_STEPS.slice(at + 1) : [];
  state.stepPriority = priorityStep(state.step);
  state.activePlayer = g.active ?? 0;
  state.priority = state.activePlayer;
  state.startingPlayer = 0;
  state.players[0].kept = true;
  state.players[1].kept = true;
  if (g.life) { state.players[0].life = g.life[0]; state.players[1].life = g.life[1]; }
  for (const spec of g.battlefield ?? []) {
    const owner = typeof spec === 'string' ? 0 : spec.controller ?? 0;
    state.zones.battlefield.push(place(state, spec, 'battlefield', owner));
  }
  for (const p of [0, 1] as const) {
    for (const s of g.hands?.[p] ?? []) state.zones.hand[p].push(place(state, s, 'hand', p));
    for (const s of g.graveyards?.[p] ?? []) state.zones.graveyard[p].push(place(state, s, 'graveyard', p));
    for (const s of g.exiles?.[p] ?? []) state.zones.exile[p].push(place(state, s, 'exile', p));
    // Listed top first; stored bottom first.
    for (const s of [...(g.libraries?.[p] ?? [])].reverse()) state.zones.library[p].push(place(state, s, 'library', p));
  }
  invalidateMemo(state);
  return state;
}

/** Ids of objects with this card name (or def id) in a zone, optionally one player's. */
export function ids(state: GameState, nameOrId: string, zone: Zone = 'battlefield', player?: PlayerId): ObjId[] {
  const defId = defOf(nameOrId);
  return Object.values(state.objects)
    .filter((o) => (o.defId === defId || o.token === defId) && o.zone === zone && (player === undefined || o.controller === player))
    .map((o) => o.id)
    .sort((a, b) => a - b);
}
export function id1(state: GameState, nameOrId: string, zone: Zone = 'battlefield', player?: PlayerId): ObjId {
  const found = ids(state, nameOrId, zone, player);
  if (found.length === 0) throw new Error(`test: no ${nameOrId} in ${zone}`);
  return found[0] as ObjId;
}

/** Deterministic JSON with sorted keys, for exact state comparison. */
export function canon(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'undefined';
  if (Array.isArray(x)) return `[${x.map(canon).join(',')}]`;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o).sort().filter((k) => o[k] !== undefined);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
}

/** A deck list from name:count pairs. */
export function deckOf(entries: Record<string, number>): { main: { count: number; name: string }[] } {
  return { main: Object.entries(entries).map(([name, count]) => ({ name, count })) };
}
