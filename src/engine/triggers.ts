// Triggered abilities: the event bus, the per-event listener index, APNAP ordering, targets on
// the way to the stack, delayed triggers, and the built-in keyword triggers (prowess, ward).
//
// Flow: engine code buffers GameEvents (mutate.pushEvent). Before a player would receive priority,
// apply.ts calls collectTriggers, which drains the buffer and turns matching listeners into
// PendingTrigger records (CR 603.2 (triggers when the event occurs)); then putTriggers puts them on
// the stack in APNAP order (CR 603.3b (APNAP order)).
//
// Listener index: at every battlefield or object change the characteristics memo is dropped; the
// index here is keyed to that memo object, so it is rebuilt exactly then and a trigger check costs
// O(listeners for that event), not O(permanents).
//
// Leaves-the-battlefield triggers look back in time (CR 603.10a (look back in time)): a dying
// permanent's own 'dies' and 'ltb' abilities come from its last known information, and permanents
// leaving in the same event can see each other.
//
// Damage triggers are summed per drain: all damage dealt by one resolution or one combat damage
// step is one event, so a creature dealt damage by several sources at once triggers once with the
// total (PLAN.md D12).
import { getAbility, getDef } from '../cards/index.js';
import { allocId, cloneData, drainEvents, getMemo, pushEvent, pushStack, setField, setTop, spliceIn, addEffect } from './mutate.js';
import { characteristics, KW, urborgActive } from './statics.js';
import { makeCtx } from './ctx.js';
import { targetTuples } from './targets.js';
import type { Picker } from './zones.js';
import { discard } from './zones.js';
import { payLife, canPayLife } from './life.js';
import type {
  AbilityKey, GameObject, GameState, ObjId, PendingTrigger, PlayerId, StackItem, Step, Target,
  TriggerEventName, TriggerInfo, TriggeredDef, CostSpec,
} from './types.js';

export const BUILTIN_PROWESS = 'builtin:prowess';
export const BUILTIN_WARD = 'builtin:ward';

interface Listener { sourceId: ObjId; key: AbilityKey; def: TriggeredDef | null }
type Index = Partial<Record<TriggerEventName, Listener[]>>;

const indexCache = new WeakMap<GameState, { memo: unknown; gen: number; index: Index }>();

function faceKeys(defId: string, face: number): AbilityKey[] {
  const f = getDef(defId).faces[face];
  return (f?.abilities ?? []).map((_, i) => `${defId}:${face}:${i}`);
}

function addListener(idx: Index, ev: TriggerEventName, l: Listener): void {
  const arr = idx[ev];
  if (arr) arr.push(l);
  else idx[ev] = [l];
}

function listenersOfKeys(idx: Index, sourceId: ObjId, keys: readonly AbilityKey[], kw: number): void {
  for (const k of keys) {
    if (k.startsWith('basic:')) continue;
    const ab = getAbility(k).ability;
    if (ab.kind === 'triggered' && ab.event !== 'delayed') addListener(idx, ab.event, { sourceId, key: k, def: ab });
  }
  // CR 702.108a (prowess) and CR 702.21a (ward) are keyword triggers built into the engine.
  if (kw & KW.prowess) addListener(idx, 'cast', { sourceId, key: BUILTIN_PROWESS, def: null });
  if (kw & KW.ward) addListener(idx, 'becomesTarget', { sourceId, key: BUILTIN_WARD, def: null });
}

/** The per-event listener index for the current battlefield (rebuilt when the memo is dropped). */
export function listenerIndex(state: GameState): Index {
  urborgActive(state); // makes sure the characteristics memo object exists
  const memo = getMemo<{ gen: number }>(state);
  const gen = memo?.gen ?? 0;
  const hit = indexCache.get(state);
  if (hit && hit.memo === memo && hit.gen === gen) return hit.index;
  const idx: Index = {};
  for (const id of [...state.zones.battlefield].sort((a, b) => a - b)) {
    const c = characteristics(state, id);
    listenersOfKeys(idx, id, c.abilities, c.kw);
  }
  indexCache.set(state, { memo, gen, index: idx });
  return idx;
}

/** Ability keys an object had, from last known information (printed face, copy, overlay, Room halves). */
function lkiKeys(lki: GameObject): { keys: AbilityKey[]; kw: number } {
  let keys: AbilityKey[];
  let kwList: string[] = [];
  const def = getDef(lki.copyOf ?? lki.defId);
  if (lki.copyOf) {
    const cf = lki.copyFace ?? 0; // CR 707.8a (copied face)
    keys = faceKeys(def.id, cf);
    kwList = [...(def.faces[cf]?.keywords ?? [])];
  } else if (def.layout === 'room') {
    keys = [0, 1].filter((h) => lki.unlocked?.[h]).flatMap((h) => faceKeys(def.id, h));
  } else {
    keys = faceKeys(def.id, lki.face);
    kwList = [...(def.faces[lki.face]?.keywords ?? [])];
  }
  if (lki.animated?.abilities) keys.push(...lki.animated.abilities);
  let kw = 0;
  for (const k of [...kwList, ...(lki.animated?.keywords ?? [])]) kw |= KW[k as keyof typeof KW] ?? 0;
  return { keys, kw };
}

const STEP_EVENT: Partial<Record<Step, TriggerEventName>> = { upkeep: 'upkeep', main1: 'precombatMain', end: 'endStep' };

function controllerOf(state: GameState, id: ObjId, lki?: GameObject): PlayerId | undefined {
  return state.objects[id]?.controller ?? lki?.controller;
}

function scopeOk(def: TriggeredDef, l: Listener, controller: PlayerId, ev: TriggerEventName, info: TriggerInfo): boolean {
  const scope = def.scope ?? 'self';
  const stepEvent = ev === 'upkeep' || ev === 'endStep' || ev === 'precombatMain';
  if (scope === 'self') {
    // For beginning-of-step triggers 'self' means 'your' step.
    if (stepEvent) return info.player === controller;
    return info.objId === l.sourceId;
  }
  if (scope === 'you') return info.player === controller;
  if (scope === 'opponent') return info.player !== undefined && info.player !== controller;
  return true;
}

/**
 * Drains the event buffer and records every triggered ability that triggers. Intervening-if
 * clauses are checked here (CR 603.4 (intervening if)) and again on resolution (stack.ts).
 */
export function collectTriggers(state: GameState): number {
  const evs = drainEvents(state);
  if (evs.length === 0) return 0;
  const idx = listenerIndex(state);
  const out: PendingTrigger[] = [];

  // Last known information of everything that left the battlefield in this batch.
  const leftLki: GameObject[] = [];
  for (const ev of evs) if (ev.e === 'zoneChange' && ev.from === 'battlefield' && ev.lki) leftLki.push(ev.lki);
  let lkiIdx: Index | null = null;
  const { lkiIndex } = { lkiIndex(): Index {
    if (!lkiIdx) {
      lkiIdx = {};
      for (const o of leftLki) { const { keys, kw } = lkiKeys(o); listenersOfKeys(lkiIdx, o.id, keys, kw); }
    }
    return lkiIdx;
  } };
  const lkiById = new Map<ObjId, GameObject>(leftLki.map((o) => [o.id, o]));

  const { fire } = { fire(ev: TriggerEventName, info: TriggerInfo, lookBack = false): void {
    const ls = [...(idx[ev] ?? []), ...(lookBack ? lkiIndex()[ev] ?? [] : [])];
    for (const l of ls) {
      const lki = lkiById.get(l.sourceId);
      const controller = controllerOf(state, l.sourceId, lki);
      if (controller === undefined) continue;
      if (l.def === null) continue; // built-ins are handled where their events are read
      const def = l.def;
      if (!scopeOk(def, l, controller, ev, info)) continue;
      if (ev === 'chapter' && def.chapter !== info.chapter) continue;
      if (ev === 'unlock' && Number(l.key.split(':')[1]) !== info.half) continue;
      const ctx = makeCtx(state, l.sourceId, controller, l.key);
      if (def.filter && !def.filter(ctx, info)) continue;
      if (def.interveningIf && !def.interveningIf(ctx, info)) continue;
      if (def.firstTimeEachTurn) {
        // Valiant (CR 207.2c (ability word)): 'for the first time each turn' counts the event, not the
        // resolution, so the flag is set here as it triggers and a later fizzle does not reset it.
        const src = state.objects[l.sourceId];
        if (!src || src.valiantUsed) continue;
        setField(state, l.sourceId, 'valiantUsed', true);
      }
      const t: PendingTrigger = { key: l.key, sourceId: l.sourceId, controller, info: { ...info } };
      if (lki && !state.objects[l.sourceId]) t.lki = cloneData(lki);
      out.push(t);
    }
    // Delayed triggers waiting for this event (CR 603.7a (delayed trigger)): fire once, then go away.
    if (state.delayed.length > 0) {
      for (const d of [...state.delayed]) {
        if (d.on !== ev) continue;
        const i = state.delayed.findIndex((x) => x.id === d.id);
        spliceIn(state, ['delayed'], i, 1);
        const dinfo: TriggerInfo = { ...info, event: ev };
        if (d.objId !== undefined) dinfo.objId = d.objId;
        out.push({ key: d.key, sourceId: d.sourceId, controller: d.controller, info: dinfo });
      }
    }
  } };

  // Lore counters: running count per Saga so several additions in one batch are handled in order.
  const loreSeen = new Map<ObjId, number>();
  const loreTotal = new Map<ObjId, number>();
  for (const ev of evs) if (ev.e === 'counterAdded' && ev.counter === 'lore') loreTotal.set(ev.id, (loreTotal.get(ev.id) ?? 0) + ev.n);
  const dealt = new Map<ObjId, number>();
  const deals = new Map<ObjId, { amount: number; player?: PlayerId }>();

  for (const ev of evs) {
    switch (ev.e) {
      case 'zoneChange': {
        if (ev.to === 'battlefield' && ev.newId !== null) {
          const o = state.objects[ev.newId];
          if (o) fire('etb', { event: 'etb', objId: ev.newId, player: o.controller });
        }
        if (ev.from === 'battlefield' && ev.lki) {
          const info: TriggerInfo = { event: 'ltb', objId: ev.lki.id, player: ev.lki.controller };
          fire('ltb', info, true);
          // CR 700.4 (dies): put into a graveyard from the battlefield.
          if (ev.to === 'graveyard') fire('dies', { ...info, event: 'dies' }, true);
        }
        break;
      }
      case 'draw': fire('draw', { event: 'draw', player: ev.player, amount: 1 }); break;
      case 'discard': fire('discard', { event: 'discard', player: ev.player, objId: ev.id }); break;
      case 'tokenCreated': fire('tokenCreated', { event: 'tokenCreated', player: ev.controller, objId: ev.id }); break;
      case 'lifeGain': fire('lifeGain', { event: 'lifeGain', player: ev.player, amount: ev.amount }); break;
      case 'attacks': {
        const o = state.objects[ev.id];
        if (o) fire('attacks', { event: 'attacks', objId: ev.id, player: o.controller });
        break;
      }
      case 'unlock': fire('unlock', { event: 'unlock', objId: ev.id, half: ev.half, player: state.objects[ev.id]?.controller ?? 0 }); break;
      case 'step': {
        const name = STEP_EVENT[ev.step];
        if (name) fire(name, { event: name, player: ev.player });
        break;
      }
      case 'cast': {
        fire('cast', { event: 'cast', player: ev.player, objId: ev.id });
        if (!ev.creature) {
          for (const l of idx.cast ?? []) {
            if (l.key !== BUILTIN_PROWESS) continue;
            const o = state.objects[l.sourceId];
            if (o && o.controller === ev.player) out.push({ key: BUILTIN_PROWESS, sourceId: l.sourceId, controller: o.controller, info: { event: 'cast', player: ev.player, objId: ev.id } });
          }
        }
        break;
      }
      case 'becomesTarget': {
        const o = state.objects[ev.id];
        if (!o) break;
        fire('becomesTarget', { event: 'becomesTarget', objId: ev.id, player: ev.player, stackId: ev.stackId, amount: ev.spell ? 1 : 0 });
        if (ev.player !== o.controller) {
          for (const l of idx.becomesTarget ?? []) {
            if (l.key === BUILTIN_WARD && l.sourceId === ev.id) {
              out.push({ key: BUILTIN_WARD, sourceId: ev.id, controller: o.controller, info: { event: 'becomesTarget', objId: ev.id, player: ev.player, stackId: ev.stackId } });
            }
          }
        }
        break;
      }
      case 'counterAdded': {
        if (ev.counter !== 'lore') break;
        const o = state.objects[ev.id];
        if (!o || o.zone !== 'battlefield') break;
        const start = loreSeen.get(ev.id) ?? (o.counters.lore ?? 0) - (loreTotal.get(ev.id) ?? 0);
        const after = start + ev.n;
        loreSeen.set(ev.id, after);
        // CR 714.2b (lore counters): triggers when the count goes from below N to at least N.
        for (let n = start + 1; n <= after; n++) fire('chapter', { event: 'chapter', objId: ev.id, chapter: n, player: o.controller });
        break;
      }
      case 'damage': {
        if (ev.target.kind === 'obj') dealt.set(ev.target.id, (dealt.get(ev.target.id) ?? 0) + ev.amount);
        const d = deals.get(ev.source) ?? { amount: 0 };
        d.amount += ev.amount;
        if (ev.target.kind === 'player' && d.player === undefined) d.player = ev.target.p;
        deals.set(ev.source, d);
        break;
      }
      default:
        break;
    }
  }
  for (const [id, amount] of dealt) {
    if (state.objects[id]) fire('dealtDamage', { event: 'dealtDamage', objId: id, amount, player: state.objects[id]?.controller ?? 0 });
  }
  for (const [id, d] of deals) {
    const info: TriggerInfo = { event: 'dealsDamage', objId: id, amount: d.amount };
    if (d.player !== undefined) info.player = d.player;
    fire('dealsDamage', info);
  }
  if (out.length > 0) setTop(state, 'pendingTriggers', [...state.pendingTriggers, ...out]);
  return out.length;
}

/** Targets required by a pending trigger. */
function specsOf(t: PendingTrigger): TriggeredDef['targets'] {
  if (t.key.startsWith('builtin:')) return undefined;
  const ab = getAbility(t.key).ability;
  return ab.kind === 'triggered' ? ab.targets : undefined;
}

/** Order among one player's simultaneous triggers matters unless they are all the same ability. */
export function orderMatters(ts: readonly PendingTrigger[]): boolean {
  if (ts.length < 2) return false;
  return ts.some((t) => t.key !== (ts[0] as PendingTrigger).key);
}

/**
 * Puts every pending trigger on the stack: CR 603.3b (APNAP order), the active player's first, so
 * the nonactive player's resolve first. Within one player's triggers the controller chooses the
 * order through a pickIndex Choice (reason 'orderTriggers': the index of the trigger to put on the
 * stack next; it resolves after the ones put later), asked only when the order can matter.
 */
export function putTriggers(state: GameState, pick?: Picker): void {
  const pend = state.pendingTriggers;
  if (pend.length === 0) return;
  setTop(state, 'pendingTriggers', []);
  const ap = state.activePlayer;
  for (const p of [ap, ap === 0 ? 1 : 0] as PlayerId[]) {
    const mine = pend.filter((t) => t.controller === p);
    while (mine.length > 0) {
      let i = 0;
      if (orderMatters(mine)) {
        const choice = { kind: 'pickIndex' as const, player: p, reason: 'orderTriggers', count: mine.length };
        if (!pick) throw new Error('putTriggers: needs a picker');
        i = pick(choice).index ?? -1;
        if (i < 0 || i >= mine.length) throw new Error(`putTriggers: bad index ${i}`);
      }
      const t = mine.splice(i, 1)[0] as PendingTrigger;
      putOne(state, t, pick);
    }
  }
}

function putOne(state: GameState, t: PendingTrigger, pick?: Picker): void {
  const src = state.objects[t.sourceId] ?? t.lki;
  const specs = specsOf(t) ?? [];
  let targets: Target[] = [];
  if (specs.length > 0) {
    const tuples = targetTuples(state, specs, t.controller, t.sourceId);
    // CR 603.3d (no legal target): the ability is removed from the stack.
    if (tuples.length === 0) return;
    if (tuples.length === 1) targets = tuples[0] as Target[];
    else {
      if (!pick) throw new Error('putOne: needs a picker');
      const i = pick({ kind: 'pickTargets', player: t.controller, reason: 'triggerTargets', options: tuples }).index ?? -1;
      const chosen = tuples[i];
      if (!chosen) throw new Error(`putOne: bad target index ${i}`);
      targets = chosen;
    }
  }
  const id = allocId(state);
  const item: StackItem = {
    id, kind: 'triggered', controller: t.controller, sourceId: t.sourceId,
    defId: src?.defId ?? 'unknown', face: src?.face ?? 0, abilityKey: t.key, targets, trigger: { ...t.info },
  };
  if (t.lki) item.lki = t.lki;
  pushStack(state, item);
  for (const tg of targets) if (tg.kind === 'obj') pushEvent(state, { e: 'becomesTarget', id: tg.id, stackId: id, player: t.controller, spell: false });
}

// ---- built-in keyword triggers ----------------------------------------------------------------

/** The ward cost of a permanent (static marker 'ward'); default: discard a card. */
function wardCost(state: GameState, id: ObjId): CostSpec {
  const o = state.objects[id];
  if (o) {
    for (const k of characteristics(state, id).abilities) {
      if (k.startsWith('basic:')) continue;
      const ab = getAbility(k).ability;
      if (ab.kind === 'static' && ab.category === 'marker' && ab.marker === 'ward' && ab.wardCost) return ab.wardCost;
    }
  }
  return { discard: 1 };
}

/**
 * Resolves a built-in trigger. Prowess: +1/+1 until end of turn. Ward: counter the targeting spell
 * or ability unless its controller pays the ward cost (CR 702.21a (ward)).
 */
export function resolveBuiltin(state: GameState, item: StackItem, counter: (stackId: ObjId) => void, pick?: Picker): void {
  if (item.abilityKey === BUILTIN_PROWESS) {
    if (state.objects[item.sourceId]?.zone === 'battlefield') {
      addEffect(state, { eid: allocId(state), kind: 'ptDelta', target: item.sourceId, p: 1, t: 1, until: 'eot' });
    }
    return;
  }
  if (item.abilityKey === BUILTIN_WARD) {
    const sid = item.trigger?.stackId;
    const targeted = state.zones.stack.find((s) => s.id === sid);
    if (!targeted || sid === undefined) return;
    const payer = targeted.controller;
    const cost = wardCost(state, item.sourceId);
    const n = cost.discard ?? 0;
    const life = cost.life ?? 0;
    const payable = !cost.mana && state.zones.hand[payer].length >= n && canPayLife(state, payer, life);
    let pay = false;
    if (payable) {
      if (!pick) throw new Error('ward: needs a picker');
      pay = (pick({ kind: 'pickIndex', player: payer, reason: 'wardPay', count: 2 }).index ?? 0) === 1;
    }
    if (pay) {
      if (n > 0) {
        const hand = state.zones.hand[payer];
        const ids = n >= hand.length ? [...hand] : (pick as Picker)({ kind: 'pickObjects', player: payer, reason: 'wardDiscard', from: [...hand], min: n, max: n }).ids ?? [];
        if (ids.length !== n) throw new Error('ward: wrong discard count');
        for (const d of ids) discard(state, d);
      }
      if (life > 0) payLife(state, payer, life);
      return;
    }
    counter(sid);
    return;
  }
  throw new Error(`resolveBuiltin: unknown ${item.abilityKey}`);
}

