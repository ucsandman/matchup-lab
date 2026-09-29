// legalMoves(state, player): the move generator, with the collapsing rules of PLAN.md section 6:
//  - identical lands, tokens and permanents are one move (classKey); hand cards collapse by name
//    for play, cast, discard, bottom and pick choices;
//  - mana payment is a solver: one move per non-dominated payment plan (mana.ts);
//  - player targets collapse to the opponent unless the controller is the only legal player;
//  - attack and block declarations are collapsed and capped at 64 each (combat.ts);
//  - activations with a window hook are offered only in their window (PLAN.md D9).
// When a Choice is pending, only that player has moves, and they answer the Choice.
import { getDef } from '../cards/index.js';
import { classKey } from './statics.js';
import { canMulligan } from './mulligan.js';
import { manaUpperBound, paymentPlans, type PayContext } from './mana.js';
import {
  bargainCandidates, checkNonMana, sacrificeCandidates, spellDefOf, type NonManaChoices,
} from './cost.js';
import { canPayLife } from './life.js';
import { targetTuples } from './targets.js';
import { attackOptions, blockOptions } from './combat.js';
import {
  abilityManaCost, abilityPayCtx, activatableKeys, activatedDef, canActivateNow, canPlayLandNow, canUnlockNow, crewCandidates, crewPower,
  castFaces, castPayCtx, faceSpecs, isInstantSpeed, landFaces, playableCards, sorcerySpeed, spellCost, unlockCost,
} from './stack.js';
import { makeCtx } from './ctx.js';
import { costString, manaValueOf, manaValueOfString } from './cost.js';
import { getContentTick } from './mutate.js';
import type {
  AbilityKey, ActivatedDef, Choice, FaceDef, GameState, ManaCost, Move, ObjId, PlayerId, StaticDef, Target,
} from './types.js';

/** Cap on subset enumerations (discards, bottoms, picks). */
const PICK_CAP = 64;

// ---- subset enumeration with collapsing ---------------------------------------------------------

/** Collapsing key for an object in a choice: hand and library by name, graveyard by def, battlefield by classKey. */
function pickKey(state: GameState, id: ObjId): string {
  const o = state.objects[id];
  if (!o) return `x${id}`;
  if (o.zone === 'battlefield') return `b|${classKey(state, id)}`;
  return `${o.zone}|${o.owner}|${getDef(o.defId).name}`;
}

/** Subsets of ids with size in [min, max], one per multiset of collapsing classes, capped. */
export function collapsedSubsets(state: GameState, ids: readonly ObjId[], min: number, max: number, cap = PICK_CAP): ObjId[][] {
  const classes = new Map<string, ObjId[]>();
  for (const id of [...ids].sort((a, b) => a - b)) {
    const k = pickKey(state, id);
    const arr = classes.get(k);
    if (arr) arr.push(id);
    else classes.set(k, [id]);
  }
  const cls = [...classes.values()];
  const out: ObjId[][] = [];
  const cur: ObjId[] = [];
  const { rec } = { rec(ci: number): void {
    if (out.length >= cap) return;
    if (ci === cls.length) { if (cur.length >= min) out.push([...cur]); return; }
    const members = cls[ci] as ObjId[];
    for (let k = 0; k <= members.length && cur.length + k <= max; k++) {
      for (let i = 0; i < k; i++) cur.push(members[i] as ObjId);
      rec(ci + 1);
      cur.length -= k;
    }
  } };
  rec(0);
  return out;
}

/** One representative id per collapsing class (lowest id first). */
function reps(state: GameState, ids: readonly ObjId[]): ObjId[] {
  if (ids.length <= 1) return [...ids];
  // pickKey without building 'b|' + classKey: battlefield keys and the others never collide.
  const out: ObjId[] = [];
  const field = new Set<string>();
  const other = new Set<string>();
  for (const id of [...ids].sort((a, b) => a - b)) {
    if (state.objects[id]?.zone === 'battlefield') {
      const k = classKey(state, id);
      if (!field.has(k)) { field.add(k); out.push(id); }
    } else {
      const k = pickKey(state, id);
      if (!other.has(k)) { other.add(k); out.push(id); }
    }
  }
  return out;
}

// ---- choice answers ---------------------------------------------------------------------------

function choiceMoves(state: GameState, ch: Choice): Move[] {
  switch (ch.kind) {
    case 'mulligan': {
      const out: Move[] = [{ type: 'choose', answer: { keep: true } }];
      if (canMulligan(state, ch.player)) out.push({ type: 'choose', answer: { keep: false } });
      return out;
    }
    case 'bottom':
      return collapsedSubsets(state, state.zones.hand[ch.player], ch.count, ch.count).map((ids) => ({ type: 'choose', answer: { ids } }));
    case 'pickObjects':
      return collapsedSubsets(state, ch.from, ch.min, ch.max).map((ids) => ({ type: 'choose', answer: { ids } }));
    case 'dieReplacement':
      return ch.options.map((_, index) => ({ type: 'choose', answer: { index } }));
    case 'pickIndex':
      return Array.from({ length: ch.count }, (_, index) => ({ type: 'choose', answer: { index } }));
    case 'pickTargets':
      return ch.options.map((_, index) => ({ type: 'choose', answer: { index } }));
    case 'declareAttackers':
      return attackOptions(state, ch.player).map((assignments) => ({ type: 'declareAttackers', assignments }));
    case 'declareBlockers':
      return blockOptions(state, ch.player).map((assignments) => ({ type: 'declareBlockers', assignments }));
    default:
      return [];
  }
}

// ---- priority actions -------------------------------------------------------------------------

class Gen {
  readonly out: Move[] = [];
  /** Sorcery timing for castMoves: sorcerySpeed(state, p) unless the auto-pass cache sets it. */
  sorcery: boolean;
  constructor(readonly state: GameState, readonly p: PlayerId, readonly stopAtFirst: boolean) {
    this.sorcery = sorcerySpeed(state, p);
  }
  get done(): boolean { return this.stopAtFirst && this.out.length > 0; }
  /** Pool entries plus mana sources with a usable option: no cost above this can be paid. */
  manaUpper(): number {
    return manaUpperBound(this.state, this.p);
  }
  push(m: Move): void { this.out.push(m); }
  /** Number of payment plans (per-tick cache in mana.ts; generation does not change state). */
  payments(cost: ManaCost, ctx: PayContext): number {
    if (manaValueOf(cost) > this.manaUpper()) return 0;
    // hasAction only needs to know one payment exists (same boolean, far less search).
    return paymentPlans(this.state, this.p, cost, ctx, this.stopAtFirst).length;
  }
}

function landMoves(g: Gen): void {
  const { state, p } = g;
  if (!canPlayLandNow(state, p)) return;
  for (const id of reps(state, playableCards(state, p).filter((x) => landFaces(state, x).length > 0))) {
    for (const face of landFaces(state, id)) {
      const f = getDef(state.objects[id]?.defId ?? '').faces[face] as FaceDef;
      const shock = f.abilities.find((a): a is StaticDef => a.kind === 'static' && a.category === 'entersTapped' && !!a.payLifeToUntap);
      const base: Move = face === 0 ? { type: 'playLand', objId: id } : { type: 'playLand', objId: id, face };
      if (shock?.payLifeToUntap) {
        // Shock land: two plays, paying life (only if affordable) or entering tapped.
        // CR 119.4 (pay life) allows paying down to 0, but CR 704.5a (0 life) then loses the game at
        // once, so the generator prunes it (PLAN.md section 3, Blood Crypt); legality still allows it.
        if (canPayLife(state, p, shock.payLifeToUntap) && state.players[p].life > shock.payLifeToUntap) g.push({ ...base, pay: true } as Move);
        g.push({ ...base, pay: false } as Move);
      } else g.push(base);
      if (g.done) return;
    }
  }
}

/** Discard choices of size n from the hand (collapsed by name), excluding one card. */
function discardSets(state: GameState, p: PlayerId, n: number, exclude: ObjId | null): ObjId[][] {
  const hand = state.zones.hand[p].filter((id) => id !== exclude);
  if (hand.length < n) return [];
  return collapsedSubsets(state, hand, n, n);
}

function castMoves(g: Gen): void {
  const { state, p, sorcery } = g;
  const { castableNow } = { castableNow(x: ObjId, face: 0 | 1): boolean {
    const f = getDef(state.objects[x]?.defId ?? '').faces[face];
    // No mana cost: cannot be cast. Timing. Mana value above every mana the player could make: skip the solver.
    return !!f && !!f.cost && (sorcery || isInstantSpeed(f)) && manaValueOfString(f.cost) <= g.manaUpper();
  } };
  const cands = playableCards(state, p).filter((x) => castFaces(state, x).some((face) => castableNow(x, face)));
  for (const id of reps(state, cands)) {
    const o = state.objects[id];
    if (!o) continue;
    const def = getDef(o.defId);
    for (const face of castFaces(state, id)) {
      const f = def.faces[face] as FaceDef;
      if (!castableNow(id, face)) continue;
      const sp = spellDefOf(f);
      const modes = sp ? sp.modes.map((_, i) => i) : [0];
      for (const mode of modes) {
        let tuples = targetTuples(state, faceSpecs(f, mode), p, id);
        if (tuples.length === 0) continue;
        // Mode prune hook (ModeDef.prune): a generator filter only; never empties a legal tuple list.
        const prune = sp?.modes[mode]?.prune;
        if (prune) {
          const pctx0 = makeCtx(state, id, p, `${def.id}:${face}:prune`);
          const kept = tuples.filter((tu) => prune(pctx0, tu));
          if (kept.length > 0) tuples = kept;
        }
        for (const kicked of sp?.kicker ? [false, true] : [false]) {
          const bargains: (ObjId | undefined)[] = [undefined];
          if (sp?.bargain) bargains.push(...reps(state, bargainCandidates(state, p)));
          for (const bargain of bargains) {
            const extras: { costChoice?: number; discard?: ObjId[] }[] = [];
            if (sp?.additionalChoice) {
              sp.additionalChoice.forEach((c, ci) => {
                if (c.life && !canPayLife(state, p, c.life)) return;
                if (c.discard) for (const d of discardSets(state, p, c.discard, id)) extras.push({ costChoice: ci, discard: d });
                else extras.push({ costChoice: ci });
              });
            } else extras.push({});
            const cost = spellCost(f, kicked);
            const pctx = castPayCtx(f, bargain !== undefined ? [bargain] : []);
            const nPlans = g.payments(cost, pctx);
            for (const ex of extras) {
              for (const targets of tuples) {
                for (let payment = 0; payment < nPlans; payment++) {
                  const m: Move = { type: 'cast', objId: id, targets };
                  if (face !== 0) m.face = face;
                  if (sp && sp.modes.length > 1) m.mode = mode;
                  if (kicked) m.kicked = true;
                  if (bargain !== undefined) m.bargain = bargain;
                  if (ex.costChoice !== undefined) m.costChoice = ex.costChoice;
                  if (ex.discard) m.discard = ex.discard;
                  if (payment > 0) m.payment = payment;
                  g.push(m);
                  if (g.done) return;
                }
              }
            }
          }
        }
      }
    }
  }
}

/** Objects whose activated abilities the generator offers: one per collapsing class, battlefield then hand. */
function activationSources(state: GameState, p: PlayerId): ObjId[] {
  const { hasKeys } = { hasKeys(id: ObjId): boolean { return activatableKeys(state, id).length > 0; } };
  return [
    ...reps(state, state.zones.battlefield.filter((id) => state.objects[id]?.controller === p && hasKeys(id))),
    ...reps(state, state.zones.hand[p].filter(hasKeys)),
  ];
}

/** Timing part of an activation: priority, sorcery timing, loyalty once per turn, bans and the D9 window. */
function activationTimingOk(state: GameState, p: PlayerId, id: ObjId, key: AbilityKey, ab: ActivatedDef): boolean {
  if (!canActivateNow(state, p, id, ab)) return false;
  return !ab.window || ab.window(makeCtx(state, id, p, key));
}

function activateMoves(g: Gen): void {
  const { state, p } = g;
  // The candidates (activationSources x activatableKeys, in that order) of this tick's auto-pass
  // cache: hasAction usually built them for this very state just before.
  for (const a of partActs(state, p, actionPart(state, p))) {
    // Known to have no move in this tick (hasAction found none): nothing to generate.
    if (a.feasible === false) continue;
    if (!activationTimingOk(state, p, a.id, a.key, a.ab)) continue;
    activationMoves(g, a.id, a.key, a.ab);
    if (g.done) return;
  }
}

/**
 * The moves of one activated ability whose timing is already checked. Reads no timing field
 * (priority, passes, step, phaseQueue, stepPriority), so the auto-pass cache may reuse its answer
 * for as long as the content tick is unchanged.
 */
function activationMoves(g: Gen, id: ObjId, key: AbilityKey, ab: ActivatedDef): void {
  const { state, p } = g;
  const sacSets: ObjId[][] = ab.cost.sacrifice
    ? collapsedSubsets(state, sacrificeCandidates(state, p, ab.cost, id), ab.cost.sacrifice.count, ab.cost.sacrifice.count)
    : [[]];
  const discSets: ObjId[][] = ab.cost.discard ? discardSets(state, p, ab.cost.discard, id) : [[]];
  const crewSets: ObjId[][] = ab.cost.crew !== undefined ? crewOptions(state, p, id, ab.cost.crew) : [[]];
  if (crewSets.length === 0) return;
  const tuples: Target[][] = targetTuples(state, ab.targets ?? [], p, id);
  if (tuples.length === 0) return;
  const cost = abilityManaCost(state, id, p, key, ab);
  for (const sac of sacSets) {
    for (const disc of discSets) {
      const ch: NonManaChoices = { sacrifice: sac, discard: disc };
      if (checkNonMana(state, p, id, ab.cost, ch) !== null) continue;
      const nPlans = g.payments(cost, abilityPayCtx(id, ab, sac));
      for (const crewWith of crewSets) {
        for (const targets of tuples) {
          for (let payment = 0; payment < nPlans; payment++) {
            const m: Move = { type: 'activate', objId: id, abilityKey: key, targets };
            if (sac.length) m.sacrifice = sac;
            if (disc.length) m.discard = disc;
            if (crewWith.length) m.crewWith = crewWith;
            if (payment > 0) m.payment = payment;
            g.push(m);
            if (g.done) return;
          }
        }
      }
    }
  }
}

export const CREW_CAP = 4;

/**
 * Crew choices: minimal sufficient sets (dropping any member leaves too little power), collapsed
 * by identical creatures, fewest total power first, capped at CREW_CAP (PLAN.md D9).
 */
export function crewOptions(state: GameState, p: PlayerId, vehicle: ObjId, n: number): ObjId[][] {
  const cands = crewCandidates(state, p, vehicle).sort((a, b) => a - b);
  const classes = new Map<string, ObjId[]>();
  for (const id of cands) {
    const k = classKey(state, id);
    const arr = classes.get(k);
    if (arr) arr.push(id);
    else classes.set(k, [id]);
  }
  const cls = [...classes.values()].map((ids) => ({ ids, power: crewPower(state, ids[0] as ObjId) }));
  const found: { ids: ObjId[]; total: number }[] = [];
  const cur: ObjId[] = [];
  const rec = (ci: number, total: number, minPow: number): void => {
    if (found.length >= 256) return;
    if (total >= n) {
      if (total - minPow < n) found.push({ ids: [...cur], total });
      return;
    }
    if (ci === cls.length) return;
    const c = cls[ci] as { ids: ObjId[]; power: number };
    for (let k = 0; k <= c.ids.length; k++) {
      for (let i = 0; i < k; i++) cur.push(c.ids[i] as ObjId);
      rec(ci + 1, total + k * c.power, k > 0 ? Math.min(minPow, c.power) : minPow);
      cur.length -= k;
      if (total + k * c.power >= n) break;
    }
  };
  rec(0, 0, Infinity);
  return found.sort((a, b) => a.total - b.total || a.ids.length - b.ids.length).slice(0, CREW_CAP).map((f) => f.ids);
}

function unlockMoves(g: Gen): void {
  const { state, p } = g;
  if (!sorcerySpeed(state, p)) return;
  for (const id of reps(state, state.zones.battlefield.filter((x) => state.objects[x]?.controller === p && state.objects[x]?.unlocked))) {
    for (const half of [0, 1] as const) {
      if (!canUnlockNow(state, p, id, half)) continue;
      const nPlans = g.payments(unlockCost(state, id, half), { creatureSpell: false });
      for (let payment = 0; payment < nPlans; payment++) {
        g.push(payment > 0 ? { type: 'unlockDoor', objId: id, half, payment } : { type: 'unlockDoor', objId: id, half });
        if (g.done) return;
      }
    }
  }
}

function generate(state: GameState, p: PlayerId, stopAtFirst: boolean): Move[] {
  if (state.result) return [];
  const ch = state.pendingChoice;
  if (ch) return ch.player === p ? choiceMoves(state, ch) : [];
  if (state.priority !== p || !state.stepPriority) return [];
  const g = new Gen(state, p, stopAtFirst);
  // What hasAction already found impossible in this tick has no moves: skip it.
  const part = actionPart(state, p);
  if (part.land !== false) landMoves(g);
  if (!g.done && part.cast[g.sorcery ? 1 : 0] !== false) castMoves(g);
  if (!g.done) activateMoves(g);
  if (!g.done) unlockMoves(g);
  if (!stopAtFirst) g.push({ type: 'pass' });
  return g.out;
}

/** Every legal move for player (empty when it is not their decision). */
export function legalMoves(state: GameState, player: PlayerId): Move[] {
  return generate(state, player, false);
}

// ---- auto-pass check with a per-tick cache (docs/PERF.md, T1.5) ---------------------------------

/** One activation candidate; feasible caches the timing-free part of its existence check. */
interface ActCand { id: ObjId; key: AbilityKey; ab: ActivatedDef; feasible: boolean | undefined }
/**
 * What player p could do in the current content, apart from timing: whether a land could be
 * played, whether a spell could be cast (per sorcery flag), and the activation candidates. Valid
 * while the content tick (mutate.ts) is unchanged, so steps and priority passes that change only
 * timing fields reuse it; timing (canPlayLandNow, sorcery timing, canActivateNow, D9 windows) is
 * always checked fresh.
 */
interface ActionPart {
  gen: Gen;
  /** Computed on first use: a playable card with a land face; the activation candidates. */
  land: boolean | undefined;
  cast: [boolean | undefined, boolean | undefined];
  acts: ActCand[] | undefined;
}
interface TickEntry {
  tick: number;
  parts: [ActionPart | undefined, ActionPart | undefined];
}
const tickEntries = new WeakMap<GameState, TickEntry>();

/** This state's per-tick cache entry, replaced when the content tick moved. */
function tickEntry(state: GameState): TickEntry {
  const tick = getContentTick();
  let e = tickEntries.get(state);
  if (!e || e.tick !== tick) {
    e = { tick, parts: [undefined, undefined] };
    tickEntries.set(state, e);
  }
  return e;
}

function actionPart(state: GameState, p: PlayerId): ActionPart {
  const e = tickEntry(state);
  let part = e.parts[p];
  if (!part) {
    part = { gen: new Gen(state, p, true), land: undefined, cast: [undefined, undefined], acts: undefined };
    e.parts[p] = part;
  }
  return part;
}

/** The part's activation candidates: activationSources x activatableKeys, in that order. */
function partActs(state: GameState, p: PlayerId, part: ActionPart): ActCand[] {
  if (!part.acts) {
    const acts: ActCand[] = [];
    for (const id of activationSources(state, p)) {
      for (const key of activatableKeys(state, id)) acts.push({ id, key, ab: activatedDef(key), feasible: undefined });
    }
    part.acts = acts;
  }
  return part.acts;
}

/** The stopAtFirst generator of a part, emptied for one more existence question. */
function freshGen(part: ActionPart): Gen {
  part.gen.out.length = 0;
  return part.gen;
}

/**
 * True when the player with priority has something other than passing (used for auto-pass).
 * The same answer as generate(state, player, true).length > 0: the same checks, with the
 * timing-free ones cached per content tick.
 */
export function hasAction(state: GameState, player: PlayerId): boolean {
  if (state.result) return false;
  const ch = state.pendingChoice;
  if (ch) return ch.player === player && choiceMoves(state, ch).length > 0;
  if (state.priority !== player || !state.stepPriority) return false;
  const part = actionPart(state, player);
  if (canPlayLandNow(state, player)) {
    if (part.land === undefined) part.land = playableCards(state, player).some((x) => landFaces(state, x).length > 0);
    if (part.land) return true;
  }
  const sorcery = sorcerySpeed(state, player);
  const si = sorcery ? 1 : 0;
  let cast = part.cast[si];
  if (cast === undefined) {
    const g = freshGen(part);
    g.sorcery = sorcery;
    castMoves(g);
    cast = g.out.length > 0;
    part.cast[si] = cast;
  }
  if (cast) return true;
  for (const a of partActs(state, player, part)) {
    if (a.feasible === false) continue;
    if (!activationTimingOk(state, player, a.id, a.key, a.ab)) continue;
    if (a.feasible === undefined) {
      const g = freshGen(part);
      activationMoves(g, a.id, a.key, a.ab);
      a.feasible = g.out.length > 0;
    }
    if (a.feasible) return true;
  }
  if (sorcery) {
    const g = freshGen(part);
    unlockMoves(g);
    if (g.out.length > 0) return true;
  }
  return false;
}

/** Whose decision it is: the pending choice's player, else the priority holder; null when the game is over. */
export function decider(state: GameState): PlayerId | null {
  if (state.result) return null;
  return state.pendingChoice ? state.pendingChoice.player : state.priority;
}

