// Casting, activation, special actions and resolution.
//
// Cast pipeline (CR 601.2 (casting a spell)): the move carries every announcement at once (face or
// half, mode, kicker, bargain, additional-cost choice and discards, targets, payment plan index).
// Validation happens first, then: move the card to the stack,
// CR 601.2a (moves card to the stack); pay the mana plan and the non-mana costs; then the spell becomes cast,
// CR 601.2i (becomes cast): cast and becomes-the-target events are buffered and the trigger
// system reads them before anyone gets priority again.
//
// Resolution (CR 608.2b (checks whether the targets are still legal)): a spell or ability whose
// targets are all illegal does not resolve; otherwise illegal targets are skipped by the ctx
// actions (ctx.isLegalTarget). An Adventure spell is exiled instead of going to the graveyard
// (CR 715.3d (exiles it)). A permanent spell enters under its controller's control; a Room enters
// with the cast door unlocked and that door's unlock ability triggers (CR 709.5h (unlocks)).
import { getAbility, getDef } from '../cards/index.js';
import {
  allocId, cloneData, pushEvent, pushStack, removeEffect, removeStackItem, setField, setIn, spliceIn,
} from './mutate.js';
import { battlefieldActivatedKeys, characteristics, isType } from './statics.js';
import { parseMana, reduceGeneric, spellDefOf, spellManaCost, checkNonMana, payNonMana } from './cost.js';
import { payMana, paymentPlans, type PayContext, type PaymentPlan } from './mana.js';
import { moveObject, sacrifice, type Picker } from './zones.js';
import { makeCtx } from './ctx.js';
import { recheckTargets, targetKey } from './targets.js';
import { resolveBuiltin } from './triggers.js';
import type {
  AbilityKey, ActivatedDef, CardDef, FaceDef, GameObject, GameState, ManaCost, Move, MoveOpts, ObjId, PlayerId, SpellDef,
  StackItem, Target, TargetSpec,
} from './types.js';

export type CastMove = Extract<Move, { type: 'cast' }>;
export type ActivateMove = Extract<Move, { type: 'activate' }>;
export type UnlockMove = Extract<Move, { type: 'unlockDoor' }>;
export type PlayLandMove = Extract<Move, { type: 'playLand' }>;

// ---- timing -----------------------------------------------------------------------------------

export function isMain(state: GameState): boolean {
  return state.step === 'main1' || state.step === 'main2';
}

/** CR 307.1 (sorcery timing): own main phase, empty stack, with priority. */
export function sorcerySpeed(state: GameState, p: PlayerId): boolean {
  return state.activePlayer === p && isMain(state) && state.zones.stack.length === 0 && state.priority === p;
}

/** CR 305.2 (one land per turn): sorcery timing and no land played yet this turn. */
export function canPlayLandNow(state: GameState, p: PlayerId): boolean {
  return sorcerySpeed(state, p) && state.turnFlags.landsPlayed[p] < 1;
}

// ---- where cards can be played from --------------------------------------------------------------

/** Exile permissions (Emberheart valiant, Roku chapter I) for player p. */
function exilePermission(state: GameState, p: PlayerId, id: ObjId): number | null {
  for (const e of state.effects) {
    if (e.kind === 'playFromExile' && e.objId === id && e.player === p && e.untilTurn >= state.turn) return e.eid;
  }
  return null;
}

/** Cards player p may play or cast right now as far as zones go: hand, exile with permission, adventure exile. */
export function playableCards(state: GameState, p: PlayerId): ObjId[] {
  const out = [...state.zones.hand[p]];
  for (const q of [0, 1] as const) {
    for (const id of state.zones.exile[q]) {
      const o = state.objects[id];
      if (!o) continue;
      if (exilePermission(state, p, id) !== null || (o.onAdventure && o.owner === p)) out.push(id);
    }
  }
  return out;
}

function fromOk(state: GameState, p: PlayerId, o: GameObject): boolean {
  if (o.zone === 'hand') return o.owner === p;
  if (o.zone === 'exile') return exilePermission(state, p, o.id) !== null || (!!o.onAdventure && o.owner === p);
  // Graveyard and library: no card in the pool grants a permission to cast from there, and while a
  // Weathered Runestone is on the battlefield none could (CR 101.2 (can't beats can)).
  return false;
}

/** Faces that can be cast from where the card is (CR 715.3 (Adventure), CR 709.3 (split card half)). */
const NONE: readonly (0 | 1)[] = [];
const FRONT: readonly (0 | 1)[] = [0];
const BOTH: readonly (0 | 1)[] = [0, 1];
const BACK: readonly (0 | 1)[] = [1];

function isLandFace(f: FaceDef | undefined): boolean {
  return !!f && f.types.includes('Land');
}

/** Faces that can be cast from where the card is (CR 715.3 (Adventure), CR 709.3 (split card half)). Shared arrays: do not mutate. */
export function castFaces(state: GameState, id: ObjId): readonly (0 | 1)[] {
  const o = state.objects[id];
  if (!o) return NONE;
  const def = getDef(o.defId);
  switch (def.layout) {
    case 'adventure': return o.zone === 'exile' && o.onAdventure ? FRONT : BOTH;
    case 'room': return BOTH;
    case 'mdfc': {
      const a = !!def.faces[0] && !isLandFace(def.faces[0]);
      const b = !!def.faces[1] && !isLandFace(def.faces[1]);
      return a && b ? BOTH : a ? FRONT : b ? BACK : NONE;
    }
    default: return isLandFace(def.faces[0]) ? NONE : FRONT;
  }
}

export function landFaces(state: GameState, id: ObjId): readonly (0 | 1)[] {
  const o = state.objects[id];
  if (!o) return NONE;
  const def = getDef(o.defId);
  if (def.layout === 'mdfc') {
    const a = isLandFace(def.faces[0]);
    const b = isLandFace(def.faces[1]);
    return a && b ? BOTH : a ? FRONT : b ? BACK : NONE;
  }
  return def.layout !== 'room' && isLandFace(def.faces[0]) ? FRONT : NONE;
}

export function isInstantSpeed(f: FaceDef): boolean {
  return f.types.includes('Instant');
}

export function faceSpecs(f: FaceDef, mode: number): TargetSpec[] {
  const sp = spellDefOf(f);
  return sp?.modes[mode]?.targets ?? [];
}

export function isCreatureFace(f: FaceDef): boolean {
  return f.types.includes('Creature');
}

export function spellCost(f: FaceDef, kicked: boolean): ManaCost {
  const sp = spellDefOf(f);
  return spellManaCost(f, sp, kicked ? { kicked: true } : {});
}

export function castPayCtx(f: FaceDef, exclude: readonly ObjId[] = []): PayContext {
  return exclude.length ? { creatureSpell: isCreatureFace(f), exclude } : { creatureSpell: isCreatureFace(f) };
}

function pickPlan(plans: PaymentPlan[], index: number | undefined, what: string): PaymentPlan {
  const plan = plans[index ?? 0];
  if (!plan) throw new Error(`${what}: payment ${index ?? 0} not available (${plans.length} plans)`);
  return plan;
}

function checkTargets(state: GameState, specs: readonly TargetSpec[], p: PlayerId, sourceId: ObjId, targets: readonly Target[], what: string): void {
  const required = specs.reduce((s, sp) => s + (sp.min ?? 1), 0);
  const most = specs.reduce((s, sp) => s + (sp.max ?? 1), 0);
  if (targets.length < required || targets.length > most) throw new Error(`${what}: wrong number of targets (${targets.length})`);
  const legal = recheckTargets(state, specs, p, sourceId, targets);
  if (legal.some((x) => !x)) throw new Error(`${what}: illegal target`);
}

// ---- actions ----------------------------------------------------------------------------------

/** Plays a land (CR 305.2 (one land per turn)); MDFC face and shock-land payment come from the move. */
export function playLand(state: GameState, p: PlayerId, move: PlayLandMove): void {
  const o = state.objects[move.objId];
  if (!o || !fromOk(state, p, o)) throw new Error(`playLand: ${move.objId} is not playable`);
  if (!canPlayLandNow(state, p)) throw new Error('playLand: not now');
  const face = move.face ?? 0;
  if (!landFaces(state, o.id).includes(face)) throw new Error('playLand: not a land face');
  const perm = exilePermission(state, p, o.id);
  const opts: MoveOpts = { face, controller: p, cause: 'playLand' };
  if (move.pay) opts.payLife = true;
  moveObject(state, o.id, 'battlefield', opts);
  if (perm !== null) removeEffect(state, perm);
  setIn(state, ['turnFlags', 'landsPlayed', p], state.turnFlags.landsPlayed[p] + 1);
}

/** Casts a spell; see the file comment. */
export function castSpell(state: GameState, p: PlayerId, move: CastMove, pick?: Picker): ObjId {
  const o = state.objects[move.objId];
  if (!o || !fromOk(state, p, o)) throw new Error(`cast: ${move.objId} is not castable from ${o?.zone}`);
  const def = getDef(o.defId);
  const face = (move.face ?? move.half ?? 0) as 0 | 1;
  if (!castFaces(state, o.id).includes(face)) throw new Error(`cast: face ${face} of ${def.id} cannot be cast`);
  const f = def.faces[face] as FaceDef;
  if (!isInstantSpeed(f) && !sorcerySpeed(state, p)) throw new Error('cast: sorcery timing');
  if (state.priority !== p) throw new Error('cast: no priority');
  const sp = spellDefOf(f);
  const mode = move.mode ?? 0;
  if (sp && !sp.modes[mode]) throw new Error(`cast: no mode ${mode}`);
  const specs = faceSpecs(f, mode);
  checkTargets(state, specs, p, o.id, move.targets, 'cast');
  if (move.kicked && !sp?.kicker) throw new Error('cast: no kicker');
  if (move.bargain !== undefined && !sp?.bargain) throw new Error('cast: no bargain');
  if (sp?.additionalChoice && move.costChoice === undefined) throw new Error('cast: additional cost choice missing');
  const cost = spellCost(f, !!move.kicked);
  const exclude = move.bargain !== undefined ? [move.bargain] : [];
  const pctx = castPayCtx(f, exclude);
  const plan = pickPlan(paymentPlans(state, p, cost, pctx, false), move.payment, 'cast');
  const extra = sp?.additionalChoice && move.costChoice !== undefined ? sp.additionalChoice[move.costChoice] : undefined;
  if (sp?.additionalChoice && !extra) throw new Error('cast: bad cost choice');

  const perm = o.zone === 'exile' ? exilePermission(state, p, o.id) : null;
  const nid = moveObject(state, o.id, 'stack', { face, controller: p, cause: 'cast' }) as ObjId;
  if (perm !== null) removeEffect(state, perm);
  const item: StackItem = { id: nid, kind: 'spell', controller: p, sourceId: nid, defId: def.id, face, targets: move.targets.map((t) => ({ ...t })) };
  if (sp) item.mode = mode;
  if (move.kicked) item.kicked = true;
  if (move.bargain !== undefined) item.bargained = true;
  const creature = isCreatureFace(f);
  if (creature && state.turnFlags.nextCreatureBonus[p]) {
    // Kumano chapter II, applied as a flag consumed at cast (PLAN.md D9).
    item.enterCounters = { p1p1: 1 };
    setIn(state, ['turnFlags', 'nextCreatureBonus', p], false);
  }
  pushStack(state, item);
  payMana(state, p, cost, plan, pctx, pick);
  if (extra) payNonMana(state, p, nid, extra, move.discard ? { discard: move.discard } : {}, pick);
  if (move.bargain !== undefined) {
    const b = state.objects[move.bargain];
    if (!b || b.zone !== 'battlefield' || b.controller !== p) throw new Error('cast: bargain permanent gone');
    sacrifice(state, move.bargain, pick);
  }
  setIn(state, ['turnFlags', 'spellsCast', p], state.turnFlags.spellsCast[p] + 1);
  if (!creature) setIn(state, ['turnFlags', 'noncreatureSpellsCast', p], state.turnFlags.noncreatureSpellsCast[p] + 1);
  for (const t of move.targets) if (t.kind === 'obj') pushEvent(state, { e: 'becomesTarget', id: t.id, stackId: nid, player: p, spell: true });
  pushEvent(state, { e: 'cast', player: p, id: nid, creature });
  return nid;
}

/** The activated ability behind a key, or throws. */
export function activatedDef(key: AbilityKey): ActivatedDef {
  const ab = getAbility(key).ability;
  if (ab.kind !== 'activated') throw new Error(`${key} is not an activated ability`);
  return ab;
}

/** Hand-zone activated ability keys per def (channel); pure def data (perf, docs/PERF.md T1.5). */
const handKeys = new Map<CardDef, AbilityKey[]>();

/** Abilities of an object that can be activated from its current zone (keys). */
export function activatableKeys(state: GameState, id: ObjId): AbilityKey[] {
  const o = state.objects[id];
  if (!o) return [];
  if (o.zone === 'battlefield') {
    // Memoized beside the object's characteristics (statics.ts); callers must not mutate it.
    return battlefieldActivatedKeys(state, id);
  }
  if (o.zone === 'hand') {
    const def = getDef(o.defId);
    let keys = handKeys.get(def);
    if (!keys) {
      const ks: AbilityKey[] = [];
      def.faces.forEach((f, fi) => f.abilities.forEach((a, ai) => {
        if (a.kind === 'activated' && a.zone === 'hand') ks.push(`${def.id}:${fi}:${ai}`);
      }));
      keys = ks;
      handKeys.set(def, keys);
    }
    return keys;
  }
  return [];
}

/** Petrified Hamlet: named activations are banned for everyone (CR 602.5 (prohibited from being activated)). */
export function activationBanned(state: GameState, id: ObjId): boolean {
  if (!state.effects.some((e) => e.kind === 'namedBan')) return false;
  const o = state.objects[id];
  if (!o) return true;
  const name = o.zone === 'battlefield' ? characteristics(state, id).name : (getDef(o.defId).faces[0]?.name ?? '');
  return state.effects.some((e) => e.kind === 'namedBan' && e.name === name);
}

/** Mana cost of an activated ability after reductions (channel). */
export function abilityManaCost(state: GameState, id: ObjId, p: PlayerId, key: AbilityKey, ab: ActivatedDef): ManaCost {
  let c = parseMana(ab.cost.mana ?? null);
  if (ab.costReduction) c = reduceGeneric(c, ab.costReduction(makeCtx(state, id, p, key)));
  return c;
}

export function abilityPayCtx(id: ObjId, ab: ActivatedDef, sacrifices: readonly ObjId[] = []): PayContext {
  const exclude = [...(ab.cost.tap || ab.cost.sacrificeSelf ? [id] : []), ...sacrifices];
  return exclude.length ? { creatureSpell: false, exclude } : { creatureSpell: false };
}

/** Timing and once-per-turn checks for an activated ability (no cost check). */
export function canActivateNow(state: GameState, p: PlayerId, id: ObjId, ab: ActivatedDef): boolean {
  const o = state.objects[id];
  if (!o || state.priority !== p) return false;
  if (ab.zone === 'battlefield' && (o.zone !== 'battlefield' || o.controller !== p)) return false;
  if (ab.zone === 'hand' && (o.zone !== 'hand' || o.owner !== p)) return false;
  // CR 606.3 (loyalty ability): sorcery timing, once per turn per permanent.
  if (ab.cost.loyalty !== undefined && (!sorcerySpeed(state, p) || state.turnFlags.loyaltyUsed.includes(id))) return false;
  if (ab.timing === 'sorcery' && !sorcerySpeed(state, p)) return false;
  if (activationBanned(state, id)) return false;
  return true;
}

/** Power a creature crews with: its power plus crewBonus statics (Pilot token). */
export function crewPower(state: GameState, id: ObjId): number {
  const c = characteristics(state, id);
  let p = c.power;
  for (const k of c.abilities) {
    if (k.startsWith('basic:')) continue;
    const ab = getAbility(k).ability;
    if (ab.kind === 'static' && ab.category === 'crewBonus') p += ab.amount ?? 0;
  }
  return p;
}

/** CR 702.122a (crew): other untapped creatures the player controls. */
export function crewCandidates(state: GameState, p: PlayerId, vehicle: ObjId): ObjId[] {
  return state.zones.battlefield.filter((id) => id !== vehicle && state.objects[id]?.controller === p && !state.objects[id]?.tapped && isType(state, id, 'Creature'));
}

export function checkCrew(state: GameState, p: PlayerId, vehicle: ObjId, n: number, ids: readonly ObjId[]): string | null {
  const legal = new Set(crewCandidates(state, p, vehicle));
  if (new Set(ids).size !== ids.length) return 'duplicate crew';
  if (ids.some((id) => !legal.has(id))) return 'bad crew';
  const total = ids.reduce((s, id) => s + crewPower(state, id), 0);
  return total >= n ? null : `crew power ${total} < ${n}`;
}

/** Activates a non-mana ability (CR 602.2 (activating an ability)): costs paid, ability on the stack. */
export function activateAbility(state: GameState, p: PlayerId, move: ActivateMove, pick?: Picker): ObjId {
  const o = state.objects[move.objId];
  if (!o) throw new Error(`activate: no object ${move.objId}`);
  if (!activatableKeys(state, o.id).includes(move.abilityKey)) throw new Error(`activate: ${move.abilityKey} not on ${o.id}`);
  const ab = activatedDef(move.abilityKey);
  if (!canActivateNow(state, p, o.id, ab)) throw new Error('activate: not now');
  const choices = { sacrifice: move.sacrifice ?? [], discard: move.discard ?? [] };
  const why = checkNonMana(state, p, o.id, ab.cost, choices);
  if (why) throw new Error(`activate: ${why}`);
  const crewWith = move.crewWith ?? [];
  if (ab.cost.crew !== undefined) {
    const bad = checkCrew(state, p, o.id, ab.cost.crew, crewWith);
    if (bad) throw new Error(`activate: ${bad}`);
  }
  checkTargets(state, ab.targets ?? [], p, o.id, move.targets, 'activate');
  const cost = abilityManaCost(state, o.id, p, move.abilityKey, ab);
  const pctx = abilityPayCtx(o.id, ab, choices.sacrifice);
  const plan = pickPlan(paymentPlans(state, p, cost, pctx, false), move.payment, 'activate');
  const lki = cloneData(o);
  payMana(state, p, cost, plan, pctx, pick);
  if (ab.cost.loyalty !== undefined) spliceIn(state, ['turnFlags', 'loyaltyUsed'], state.turnFlags.loyaltyUsed.length, 0, o.id);
  payNonMana(state, p, o.id, ab.cost, choices, pick);
  // CR 702.122b (crews a Vehicle): the crew is tapped to pay the cost.
  for (const c of crewWith) setField(state, c, 'tapped', true);
  const id = allocId(state);
  const item: StackItem = {
    id, kind: 'activated', controller: p, sourceId: o.id, defId: o.defId, face: o.face, abilityKey: move.abilityKey,
    targets: move.targets.map((t) => ({ ...t })), lki,
  };
  pushStack(state, item);
  for (const t of move.targets) if (t.kind === 'obj') pushEvent(state, { e: 'becomesTarget', id: t.id, stackId: id, player: p, spell: false });
  return id;
}

/** CR 116.2m (unlock cost): special action, main phase of your turn, empty stack. */
export function canUnlockNow(state: GameState, p: PlayerId, id: ObjId, half: 0 | 1): boolean {
  const o = state.objects[id];
  if (!o || o.zone !== 'battlefield' || o.controller !== p || !o.unlocked || o.unlocked[half]) return false;
  return sorcerySpeed(state, p);
}

export function unlockCost(state: GameState, id: ObjId, half: 0 | 1): ManaCost {
  const o = state.objects[id] as GameObject;
  return parseMana(getDef(o.defId).faces[half]?.cost ?? null);
}

export function unlockDoor(state: GameState, p: PlayerId, move: UnlockMove, pick?: Picker): void {
  if (!canUnlockNow(state, p, move.objId, move.half)) throw new Error('unlockDoor: not now');
  const cost = unlockCost(state, move.objId, move.half);
  const pctx: PayContext = { creatureSpell: false };
  payMana(state, p, cost, pickPlan(paymentPlans(state, p, cost, pctx, false), move.payment, 'unlockDoor'), pctx, pick);
  setIn(state, ['objects', move.objId, 'unlocked', move.half], true);
  pushEvent(state, { e: 'unlock', id: move.objId, half: move.half });
}

// ---- resolution -------------------------------------------------------------------------------

/** CR 701.6a (counter): a countered spell goes to its owner's graveyard; an ability is removed. */
export function counterItem(state: GameState, stackId: ObjId): void {
  const item = state.zones.stack.find((s) => s.id === stackId);
  if (!item) return;
  if (item.kind === 'spell' && state.objects[stackId]) moveObject(state, stackId, 'graveyard', { cause: 'counter' });
  else removeStackItem(state, stackId);
}

function spellKey(def: CardDef, face: number): AbilityKey {
  const f = def.faces[face] as FaceDef;
  const i = f.abilities.findIndex((a) => a.kind === 'spell');
  return `${def.id}:${face}:${i}`;
}

function illegalKeys(state: GameState, specs: readonly TargetSpec[], item: StackItem): { illegal: string[]; allIllegal: boolean } {
  if (specs.length === 0 || item.targets.length === 0) return { illegal: [], allIllegal: false };
  const legal = recheckTargets(state, specs, item.controller, item.sourceId, item.targets);
  const illegal = item.targets.filter((_, i) => !legal[i]).map(targetKey);
  return { illegal, allIllegal: legal.every((x) => !x) };
}

/** Resolves the top of the stack (CR 608.2 (resolving)). */
export function resolveTop(state: GameState, pick?: Picker): void {
  const item = state.zones.stack[state.zones.stack.length - 1];
  if (!item) throw new Error('resolveTop: empty stack');
  if (item.kind === 'spell') { resolveSpell(state, item, pick); return; }
  if (item.abilityKey?.startsWith('builtin:')) {
    resolveBuiltin(state, item, (sid) => counterItem(state, sid), pick);
    removeStackItem(state, item.id);
    return;
  }
  const ab = getAbility(item.abilityKey as AbilityKey).ability;
  if (ab.kind !== 'triggered' && ab.kind !== 'activated') throw new Error(`resolveTop: ${item.abilityKey} is ${ab.kind}`);
  const specs = ab.targets ?? [];
  const { illegal, allIllegal } = illegalKeys(state, specs, item);
  const ctx = makeCtx(state, item.sourceId, item.controller, item.abilityKey as AbilityKey, pick, { item, illegal });
  if (allIllegal) { removeStackItem(state, item.id); return; }
  if (ab.kind === 'triggered') {
    const info = item.trigger ?? { event: ab.event };
    // CR 603.4 (intervening if): checked again on resolution; if false the ability does nothing.
    if (ab.interveningIf && !ab.interveningIf(ctx, info)) { removeStackItem(state, item.id); return; }
    if (ab.optional) {
      if (!pick) throw new Error('resolveTop: optional trigger needs a picker');
      const yes = (pick({ kind: 'pickIndex', player: item.controller, reason: 'optionalTrigger', count: 2 }).index ?? 0) === 1;
      if (!yes) { removeStackItem(state, item.id); return; }
    }
    ab.effect(ctx, item.targets, info);
  } else {
    ab.resolve(ctx, item.targets);
    // CR 702.122c (crewed by): the Vehicle is crewed until end of turn (cleanup clears it).
    if (ab.cost.crew !== undefined && state.objects[item.sourceId]?.zone === 'battlefield') setField(state, item.sourceId, 'crewed', true);
  }
  removeStackItem(state, item.id);
}

function resolveSpell(state: GameState, item: StackItem, pick?: Picker): void {
  const o = state.objects[item.id];
  if (!o) { removeStackItem(state, item.id); return; }
  const def = getDef(o.defId);
  const f = def.faces[item.face] as FaceDef;
  const permanent = !f.types.includes('Instant') && !f.types.includes('Sorcery');
  if (permanent) {
    const opts: MoveOpts = { controller: item.controller, cause: 'resolve' };
    if (def.layout === 'room') { opts.face = 0; opts.unlockHalf = item.face; }
    else opts.face = def.layout === 'mdfc' ? item.face : 0;
    if (item.enterCounters) opts.counters = { ...item.enterCounters };
    const nid = moveObject(state, item.id, 'battlefield', opts);
    if (nid !== null && def.layout === 'room') pushEvent(state, { e: 'unlock', id: nid, half: item.face });
    return;
  }
  const sp = spellDefOf(f) as SpellDef | undefined;
  const mode = sp?.modes[item.mode ?? 0];
  const adventure = def.layout === 'adventure' && item.face === 1;
  if (mode) {
    const { illegal, allIllegal } = illegalKeys(state, mode.targets, item);
    if (allIllegal) {
      // CR 608.2b (targets illegal): all targets illegal, the spell doesn't resolve and goes to the graveyard.
      moveObject(state, item.id, 'graveyard', { cause: 'fizzle' });
      return;
    }
    const ctx = makeCtx(state, item.id, item.controller, spellKey(def, item.face), pick, { item, illegal });
    mode.resolve(ctx, item.targets);
  }
  if (state.objects[item.id]?.zone === 'stack') {
    if (adventure) moveObject(state, item.id, 'exile', { cause: 'adventure', onAdventure: true });
    else moveObject(state, item.id, 'graveyard', { cause: 'resolve' });
  }
}

