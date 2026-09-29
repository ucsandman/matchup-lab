// Per-player view (PLAN.md section 6). Rules:
//  (1) seed, nextId, journal, log and the event buffer are dropped;
//  (2) a hidden object the viewer does not know becomes {vid, zone, owner, hidden:true} with a
//      view-local id (h0, h1, ... in zone order), never its real id;
//  (3) a library is its size plus, for the viewer's own library only, the known top and bottom
//      positions from libraryKnown;
//  (4) the opponent's hand is its known cards plus hidden refs (the unknown count);
//  (5) everything public is copied verbatim.
// CR 400.2 (public zones): graveyard, battlefield, stack and exile are public; library and hand are hidden.
import { cloneData } from './mutate.js';
import type {
  Choice, ContinuousEffect, DelayedTrigger, GameObject, GameState, ObjId, PlayerId, PlayerState, Pregame, StackItem, Step, TurnFlags, Zone,
} from './types.js';

export interface HiddenRef { vid: string; zone: Zone; owner: PlayerId; hidden: true }
export interface LibraryView { size: number; knownTop?: ObjId[]; knownBottom?: ObjId[] }
export interface HandView { known: ObjId[]; hidden: HiddenRef[] }
export type ViewPlayer = Omit<PlayerState, 'libraryKnown'>;
export type ViewChoice = Choice | { kind: Choice['kind']; player: PlayerId; hidden: true };

export interface PlayerView {
  viewer: PlayerId;
  turn: number;
  activePlayer: PlayerId;
  priority: PlayerId;
  startingPlayer: PlayerId;
  phaseQueue: Step[];
  step: Step;
  dayNight: GameState['dayNight'];
  turnFlags: TurnFlags;
  effects: ContinuousEffect[];
  pendingChoice: ViewChoice | null;
  /** Public priority bookkeeping (Phase 4 determinizer): consecutive passes and whether the step has priority. */
  passes: number;
  stepPriority: boolean;
  /** Delayed triggered abilities waiting (public); an objId of a hidden object is dropped, a trigger whose source is hidden is dropped. */
  delayed: DelayedTrigger[];
  pregame: Pregame | null;
  result: GameState['result'];
  players: [ViewPlayer, ViewPlayer];
  /** Public and known objects only, keyed by real id. */
  objects: Record<number, GameObject>;
  zones: {
    library: [LibraryView, LibraryView];
    hand: [HandView, HandView];
    graveyard: [ObjId[], ObjId[]];
    exile: [ObjId[], ObjId[]];
    battlefield: ObjId[];
    stack: StackItem[];
  };
}

// cloneData: plain-data deep copy, equal to structuredClone on state data and several times faster (docs/PERF.md).
const clone = <T>(x: T): T => cloneData(x);

function viewPlayer(p: PlayerState): ViewPlayer {
  return {
    life: p.life, cantGainLife: p.cantGainLife, manaPool: clone(p.manaPool), mulligans: p.mulligans, kept: p.kept,
    drewFromEmpty: p.drewFromEmpty,
  };
}

export function view(state: GameState, viewer: PlayerId): PlayerView {
  const visible = new Set<ObjId>();
  const objects: Record<number, GameObject> = {};
  const show = (id: ObjId): void => {
    const o = state.objects[id];
    if (!o) throw new Error(`view: dangling id ${id}`);
    visible.add(id);
    objects[id] = clone(o);
  };

  for (const id of state.zones.battlefield) show(id);
  for (const p of [0, 1] as const) {
    for (const id of state.zones.graveyard[p]) show(id);
    for (const id of state.zones.exile[p]) show(id);
  }
  for (const s of state.zones.stack) if (state.objects[s.id]) show(s.id);

  // A pending pickObjects Choice of the viewer may reveal hidden cards to them (Duress,
  // Thoughtseize, scry 1): those are shown as known while the choice is pending.
  const pc = state.pendingChoice;
  const revealed: readonly ObjId[] = pc && pc.kind === 'pickObjects' && pc.player === viewer ? pc.reveal ?? [] : [];

  let vid = 0;
  const hand = ([0, 1] as const).map((p): HandView => {
    const hv: HandView = { known: [], hidden: [] };
    for (const id of state.zones.hand[p]) {
      const o = state.objects[id];
      if (o && (p === viewer || o.knownTo[viewer] || revealed.includes(id))) {
        show(id);
        hv.known.push(id);
      } else {
        hv.hidden.push({ vid: `h${vid++}`, zone: 'hand', owner: p, hidden: true });
      }
    }
    return hv;
  }) as [HandView, HandView];

  const library = ([0, 1] as const).map((p): LibraryView => {
    const lv: LibraryView = { size: state.zones.library[p].length };
    if (p === viewer) {
      const k = state.players[p].libraryKnown;
      lv.knownTop = [...k.top];
      lv.knownBottom = [...k.bottom];
      for (const id of [...k.top, ...k.bottom]) show(id);
    }
    return lv;
  }) as [LibraryView, LibraryView];
  for (const id of revealed) if (state.objects[id]?.zone === 'library' && !visible.has(id)) show(id);

  const stack = state.zones.stack.map((s) => {
    const c = clone(s);
    if (c.trigger?.objId !== undefined && !visible.has(c.trigger.objId)) delete c.trigger.objId;
    return c;
  });

  const refersToHidden = (e: ContinuousEffect): boolean => {
    const id = e.kind === 'playFromExile' ? e.objId : e.kind === 'namedBan' ? e.sourceId : e.target;
    return !visible.has(id);
  };

  // A live object the viewer cannot see (a dangling id of an object that left names nothing).
  const hiddenObj = (id: ObjId): boolean => state.objects[id] !== undefined && !visible.has(id);

  const ch = state.pendingChoice;
  const pendingChoice: ViewChoice | null = ch === null ? null
    : ch.player === viewer ? clone(ch) : { kind: ch.kind, player: ch.player, hidden: true };

  return {
    viewer,
    turn: state.turn,
    activePlayer: state.activePlayer,
    priority: state.priority,
    startingPlayer: state.startingPlayer,
    phaseQueue: [...state.phaseQueue],
    step: state.step,
    dayNight: state.dayNight,
    turnFlags: clone(state.turnFlags),
    effects: state.effects.filter((e) => !refersToHidden(e)).map(clone),
    pendingChoice,
    passes: state.passes,
    stepPriority: state.stepPriority,
    delayed: state.delayed.filter((d) => !hiddenObj(d.sourceId)).map((d) => {
      const c = clone(d);
      if (c.objId !== undefined && hiddenObj(c.objId)) delete c.objId;
      return c;
    }),
    pregame: state.pregame ? clone(state.pregame) : null,
    result: state.result ? clone(state.result) : null,
    players: [viewPlayer(state.players[0]), viewPlayer(state.players[1])],
    objects,
    zones: {
      library,
      hand,
      graveyard: [[...state.zones.graveyard[0]], [...state.zones.graveyard[1]]],
      exile: [[...state.zones.exile[0]], [...state.zones.exile[1]]],
      battlefield: [...state.zones.battlefield],
      stack,
    },
  };
}
