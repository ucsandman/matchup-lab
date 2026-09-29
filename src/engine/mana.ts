// Mana: pool entries (color, restriction, expiry), mana abilities (tap, life-costed, sacrifice,
// conditional), and the payment solver.
//
// Payment is a solver, not a move (PLAN.md section 6). solvePayment enumerates ways to pay a cost
// from the pool and untapped sources, collapses identical sources into classes, and returns one
// plan per distinct residual (what is left untapped plus what is left in the pool) that is not
// dominated by another residual. The first plan is canonical. Ordering rules, in priority order:
//   1. costless before life-costed (lower life paid first)
//   2. lands before Treasure (fewer sacrifices, then fewer nonland sources)
//   3. restricted mana is spent first when the cost allows it (Rockface R on a creature spell,
//      PLAN.md section 5); otherwise restricted mana is simply unusable
//   4. keep the more flexible residual (basics before duals: tapping Swamp keeps Blood Crypt)
// A residual A dominates B when every unit left in B can be matched to a distinct unit in A that
// produces the same colors or more, at no higher cost, and (for sources with non-mana abilities,
// such as manlands or Castle Locthwain) is the same card. Dominated residuals are dropped, so an
// alternative exists only when it leaves a different set of future options.
import { getAbility, hasNonManaActivated } from '../cards/index.js';
import { addPoolEntry, getContentTick, pushEvent, removePoolEntry, setField, setPool } from './mutate.js';
import { characteristics, classKey, isType, hasKeyword } from './statics.js';
import { canPayLife, payLife } from './life.js';
import { costString } from './cost.js';
import { sacrifice, type Picker } from './zones.js';
import { makeCtx } from './ctx.js';
import type { AbilityKey, GameState, ManaColor, ManaCost, ManaPoolEntry, ObjId, PlayerId } from './types.js';

const ALL_COLORS: readonly ManaColor[] = ['W', 'U', 'B', 'R', 'G'];
const PIP_ORDER: readonly ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

export interface ManaOption {
  objId: ObjId;
  key: AbilityKey;
  colors: ManaColor[];
  life: number;
  sacrifice: boolean;
  restriction?: 'creatureSpell';
  expires?: 'endOfCombat';
}

export interface PayContext {
  /** The cost belongs to casting a creature spell (restricted Rockface mana is allowed). */
  creatureSpell: boolean;
  /** Permanents that may not be used for this payment (the source of a {T} ability, a bargained or sacrificed permanent). */
  exclude?: readonly ObjId[];
}

/** Mana options of one permanent that can be activated now (ignoring life totals). */
export function sourceOptions(state: GameState, id: ObjId): ManaOption[] {
  const o = state.objects[id];
  if (!o || o.zone !== 'battlefield') return [];
  const out: ManaOption[] = [];
  const c = characteristics(state, id);
  for (const key of c.abilities) {
    const ab = getAbility(key).ability;
    if (ab.kind !== 'mana') continue;
    if (ab.cost.tap) {
      if (o.tapped) continue;
      // CR 302.6 (summoning sickness): an animated land that is a creature can't tap for mana while sick.
      if (isType(state, id, 'Creature') && o.sick && !hasKeyword(state, id, 'haste')) continue;
    }
    if (ab.condition && !ab.condition(makeCtx(state, id, o.controller, key))) continue;
    const opt: ManaOption = {
      objId: id, key, colors: ab.produce === 'any' ? [...ALL_COLORS] : [...ab.produce],
      life: ab.cost.life ?? 0, sacrifice: !!ab.cost.sacrificeSelf,
    };
    if (ab.restriction) opt.restriction = ab.restriction;
    if (ab.expires) opt.expires = ab.expires;
    out.push(opt);
  }
  return out;
}

export interface ManaSource { objId: ObjId; options: ManaOption[] }

/** All mana sources the player controls with at least one usable option. */
export function manaSources(state: GameState, player: PlayerId): ManaSource[] {
  const out: ManaSource[] = [];
  for (const id of state.zones.battlefield) {
    if (state.objects[id]?.controller !== player) continue;
    const options = sourceOptions(state, id);
    if (options.length) out.push({ objId: id, options });
  }
  return out;
}

/**
 * Activates one mana ability and adds the mana to the pool; it resolves immediately.
 * CR 605.3b (mana ability stack). Side costs (tap, life, sacrifice) are paid first.
 */
export function activateManaAbility(state: GameState, player: PlayerId, objId: ObjId, key: AbilityKey, color: ManaColor, pick?: Picker): void {
  const opt = sourceOptions(state, objId).find((o) => o.key === key);
  if (!opt) throw new Error(`activateManaAbility: ${key} on ${objId} is not usable`);
  if (state.objects[objId]?.controller !== player) throw new Error('activateManaAbility: not your permanent');
  if (!opt.colors.includes(color)) throw new Error(`activateManaAbility: ${key} cannot make ${color}`);
  const ab = getAbility(key).ability;
  if (ab.kind !== 'mana') throw new Error(`${key} is not a mana ability`);
  if (ab.cost.tap) setField(state, objId, 'tapped', true);
  if (opt.life) payLife(state, player, opt.life);
  const entry: ManaPoolEntry = { color };
  if (opt.restriction) entry.restriction = opt.restriction;
  if (opt.expires) entry.expires = opt.expires;
  addPoolEntry(state, player, entry);
  pushEvent(state, { e: 'manaAdded', player, color, sourceId: objId });
  if (opt.sacrifice) sacrifice(state, objId, pick);
}

/**
 * Empties a pool. CR 106.4 (mana pool empties at end of each step); firebending mana survives
 * until end of combat (CR 702.189a (firebending)).
 */
export function emptyPool(state: GameState, player: PlayerId, at: 'step' | 'endOfCombat'): void {
  const pool = state.players[player].manaPool;
  const keep = at === 'step' ? pool.filter((e) => e.expires === 'endOfCombat') : [];
  if (keep.length !== pool.length) setPool(state, player, keep.map((e) => ({ ...e })));
}

// ---- payment solver ----------------------------------------------------------------------------

interface Unit { pool?: number; objId?: ObjId }
interface Class {
  key: string;
  members: Unit[];
  isPool: boolean;
  /** color -> cheapest usable option for this payment. */
  best: Partial<Record<ManaColor, { life: number; sac: boolean; restricted: boolean; key: AbilityKey }>>;
  /** Every option (for dominance), including restricted ones. */
  all: { colors: ManaColor[]; life: number; sac: boolean; restriction?: 'creatureSpell'; expires?: 'endOfCombat' }[];
  land: boolean;
  basic: boolean;
  /** Has non-mana activated abilities (manlands, Castle, Ramunap): only the same def covers it. */
  special: boolean;
  defId: string;
  /** Flexibility of one unit: distinct unrestricted colors, doubled for sources (set by buildClasses). */
  flexUnit: number;
}

export interface PaymentTap { objId: ObjId; key: AbilityKey; color: ManaColor }
export interface PaymentPlan {
  /** Pool entry indexes spent (indexes into the pool before the payment). */
  pool: number[];
  /** Mana abilities to activate, each producing one mana. */
  taps: PaymentTap[];
  life: number;
  sacrifices: number;
  /** Identifies the residual; equal keys mean equal futures. */
  residualKey: string;
}

function buildClasses(state: GameState, player: PlayerId, ctx: PayContext, sources: readonly ManaSource[]): Class[] {
  const map = new Map<string, Class>();
  state.players[player].manaPool.forEach((e, i) => {
    const key = `pool|${e.color}|${e.restriction ?? ''}|${e.expires ?? ''}`;
    let c = map.get(key);
    if (!c) {
      const usable = !e.restriction || ctx.creatureSpell;
      const best: Class['best'] = {};
      if (usable) best[e.color] = { life: 0, sac: false, restricted: !!e.restriction, key: 'pool' };
      const opt: Class['all'][number] = { colors: [e.color], life: 0, sac: false };
      if (e.restriction) opt.restriction = e.restriction;
      if (e.expires) opt.expires = e.expires;
      c = { key, members: [], isPool: true, best, all: [opt], land: false, basic: false, special: false, defId: 'pool', flexUnit: 0 };
      map.set(key, c);
    }
    c.members.push({ pool: i });
  });
  for (const src of sources) {
    const o = state.objects[src.objId];
    if (!o || ctx.exclude?.includes(src.objId)) continue;
    const sig = src.options.map((op) => `${op.colors.join('')}/${op.life}/${op.sacrifice ? 1 : 0}/${op.restriction ?? ''}/${op.expires ?? ''}`).join(';');
    const key = `src|${classKey(state, src.objId)}|${sig}`;
    let c = map.get(key);
    if (!c) {
      const best: Class['best'] = {};
      for (const op of src.options) {
        if (op.restriction && !ctx.creatureSpell) continue;
        for (const col of op.colors) {
          const cur = best[col];
          const cand = { life: op.life, sac: op.sacrifice, restricted: !!op.restriction, key: op.key };
          // Cheapest first; on equal cost prefer the restricted option (it is useless elsewhere).
          if (!cur || cand.life < cur.life || (cand.life === cur.life && cand.restricted && !cur.restricted)) best[col] = cand;
        }
      }
      const ch = characteristics(state, src.objId);
      c = {
        key, members: [], isPool: false, best,
        all: src.options.map((op) => {
          const a: Class['all'][number] = { colors: op.colors, life: op.life, sac: op.sacrifice };
          if (op.restriction) a.restriction = op.restriction;
          if (op.expires) a.expires = op.expires;
          return a;
        }),
        land: isType(state, src.objId, 'Land'), basic: ch.basic, special: hasNonManaActivated(o.defId, o.face) || isType(state, src.objId, 'Creature'),
        defId: o.defId, flexUnit: 0,
      };
      map.set(key, c);
    }
    c.members.push({ objId: src.objId });
  }
  const classes = [...map.values()];
  for (const c of classes) {
    const cols = new Set<ManaColor>();
    for (const o of c.all) if (!o.restriction) for (const col of o.colors) cols.add(col);
    c.flexUnit = cols.size * (c.isPool ? 1 : 2);
  }
  classes.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const c of classes) c.members.sort((x, y) => (x.pool ?? x.objId ?? 0) - (y.pool ?? y.objId ?? 0));
  return classes;
}

/** Does a unit of class a offer at least what a unit of class b offers, at no higher cost? */
function covers(a: Class, b: Class): boolean {
  if (a === b) return true;
  if (b.special && a.defId !== b.defId) return false;
  if (a.isPool && !b.isPool) return false; // pool mana empties; an untapped source does not
  for (const ob of b.all) {
    for (const col of ob.colors) {
      const ok = a.all.some((oa) =>
        oa.colors.includes(col) && oa.life <= ob.life && (!oa.sac || ob.sac) && (!oa.restriction || !!ob.restriction)
        && (oa.expires === 'endOfCombat' || !ob.expires || !a.isPool));
      if (!ok) return false;
    }
  }
  return true;
}

/** covers(classes[i], classes[j]) for one solve, computed on first use (perf, docs/PERF.md T1.5). */
function coverTable(classes: Class[]): (i: number, j: number) => boolean {
  const n = classes.length;
  const t = new Int8Array(n * n).fill(-1);
  const { at } = { at(i: number, j: number): boolean {
    const k = i * n + j;
    let v = t[k] as number;
    if (v < 0) { v = covers(classes[i] as Class, classes[j] as Class) ? 1 : 0; t[k] = v; }
    return v === 1;
  } };
  return at;
}

/** Bipartite matching: can every unit of residual b be matched to a distinct covering unit of a? */
function dominates(cov: (i: number, j: number) => boolean, a: number[], b: number[]): boolean {
  // Fast path: a keeps at least as many units of every class (each unit covers its own class).
  let within = true;
  for (let i = 0; i < b.length; i++) if ((b[i] as number) > (a[i] as number)) { within = false; break; }
  if (within) return true;
  // Necessary (Hall) condition per class of b: enough units of a that cover it.
  for (let j = 0; j < b.length; j++) {
    const need = b[j] as number;
    if (need === 0) continue;
    let cap = 0;
    for (let i = 0; i < a.length && cap < need; i++) if ((a[i] as number) > 0 && cov(i, j)) cap += a[i] as number;
    if (cap < need) return false;
  }
  const aUnits: number[] = [];
  const bUnits: number[] = [];
  a.forEach((n, ci) => { for (let k = 0; k < n; k++) aUnits.push(ci); });
  b.forEach((n, ci) => { for (let k = 0; k < n; k++) bUnits.push(ci); });
  if (bUnits.length > aUnits.length) return false;
  const matchA: number[] = aUnits.map(() => -1);
  const { tryAssign } = {
    tryAssign(bi: number, seen: boolean[]): boolean {
      for (let ai = 0; ai < aUnits.length; ai++) {
        if (seen[ai] || !cov(aUnits[ai] as number, bUnits[bi] as number)) continue;
        seen[ai] = true;
        if (matchA[ai] === -1 || tryAssign(matchA[ai] as number, seen)) { matchA[ai] = bi; return true; }
      }
      return false;
    },
  };
  for (let bi = 0; bi < bUnits.length; bi++) if (!tryAssign(bi, aUnits.map(() => false))) return false;
  return true;
}

interface Candidate {
  used: number[];
  residual: number[];
  assign: { cls: number; color: ManaColor }[];
  life: number;
  sac: number;
  nonland: number;
  restricted: number;
  flex: number;
  basicsUsed: number;
  rkey: string;
}

const MAX_LEAVES = 20000;

/**
 * All non-dominated ways to pay cost, canonical first. Empty when the cost cannot be paid.
 * CR 601.2g (activate mana abilities) and CR 601.2h (pay the total cost).
 */
export interface SolveOpts {
  /** Existence check (hasAction, canPay): stop at the first payable assignment and return it alone. */
  firstOnly?: boolean;
  /** manaSources(state, player), when the caller already has it for this exact state. */
  sources?: readonly ManaSource[];
  /**
   * Payment classes by PayContext, reused across solves of one unchanged state with the same
   * sources (the move generator's per-tick cache; perf, docs/PERF.md T1.5). Solves only read them.
   */
  classCache?: ClassCache;
}

/** Opaque cache of solver classes; create with new Map() and keep it for one unchanged state. */
export type ClassCache = Map<string, unknown>;

export function solvePayment(state: GameState, player: PlayerId, cost: ManaCost, ctx: PayContext, opts: SolveOpts = {}): PaymentPlan[] {
  const firstOnly = opts.firstOnly === true;
  let classes: Class[];
  if (opts.classCache) {
    const cache = opts.classCache;
    const ck = `${ctx.creatureSpell ? 1 : 0}|${(ctx.exclude ?? []).join(',')}`;
    const hit = cache.get(ck) as Class[] | undefined;
    if (hit) classes = hit;
    else {
      const exclude = ctx.exclude ?? [];
      if (exclude.length > 0) {
        // The same classes without the excluded sources: buildClasses skips them, and class fields
        // depend only on the class key, so dropping members (and emptied classes) is equivalent.
        const bk = `${ctx.creatureSpell ? 1 : 0}|`;
        let base = cache.get(bk) as Class[] | undefined;
        if (!base) {
          base = buildClasses(state, player, { creatureSpell: ctx.creatureSpell }, opts.sources ?? manaSources(state, player));
          cache.set(bk, base);
        }
        classes = [];
        for (const c of base) {
          if (c.isPool || !c.members.some((u) => u.objId !== undefined && exclude.includes(u.objId))) { classes.push(c); continue; }
          const members = c.members.filter((u) => u.objId === undefined || !exclude.includes(u.objId));
          if (members.length > 0) classes.push({ ...c, members });
        }
      } else classes = buildClasses(state, player, ctx, opts.sources ?? manaSources(state, player));
      cache.set(ck, classes);
    }
  } else classes = buildClasses(state, player, ctx, opts.sources ?? manaSources(state, player));
  const pips: ManaColor[] = [];
  for (const col of PIP_ORDER) for (let k = 0; k < cost[col as keyof ManaCost]; k++) pips.push(col);
  const used = classes.map(() => 0);
  const assign: { cls: number; color: ManaColor }[] = [];
  // Candidates by used vector (equivalently by residual): a mixed-radix number kept up to date as
  // the search moves, or the joined vector when the classes are too many for exact integers. The
  // residual array, its key string and the copies are built only for a candidate that is kept, and
  // flex is the total minus what is used (perf, docs/PERF.md T1.5).
  const radix: number[] = [];
  let mul = 1;
  let totalFlex = 0;
  for (const c of classes) {
    radix.push(mul);
    mul *= c.members.length + 1;
    totalFlex += c.members.length * c.flexUnit;
  }
  const numericKey = mul <= Number.MAX_SAFE_INTEGER;
  let usedKey = 0;
  let usedFlex = 0;
  const best = new Map<number | string, Candidate>();
  const lifeAvail = state.players[player].life;
  let leaves = 0;
  // firstOnly (hasAction's existence check): stop at the first payable assignment.
  let stop = false;

  // Method shorthand, not named arrows: tsx (esbuild keepNames) wraps each named arrow in an
  // Object.defineProperty call per solvePayment call (docs/PERF.md).
  const fns = {
  cheapestAny(c: Class): ManaColor | null {
    let pickCol: ManaColor | null = null;
    let pickLife = Infinity;
    let pickRestricted = false;
    for (const col of PIP_ORDER) {
      const b = c.best[col];
      if (!b) continue;
      if (b.life < pickLife || (b.life === pickLife && b.restricted && !pickRestricted)) {
        pickCol = col; pickLife = b.life; pickRestricted = b.restricted;
      }
    }
    return pickCol;
  },

  emit(): void {
    leaves++;
    let life = 0, sac = 0, nonland = 0, restricted = 0, basicsUsed = 0;
    for (const a of assign) {
      const c = classes[a.cls] as Class;
      const b = c.best[a.color];
      if (!b) return;
      life += b.life;
      if (b.sac) sac++;
      if (b.restricted) restricted++;
      if (!c.isPool && !c.land) nonland++;
      if (c.basic) basicsUsed++;
    }
    if (life > 0 && !canPayLife(state, player, life)) return;
    if (life > lifeAvail) return;
    const flex = totalFlex - usedFlex;
    const key = numericKey ? usedKey : used.join(',');
    const prev = best.get(key);
    // compare(cand, prev) on the scalar fields before building the candidate (same residual: the
    // tie-break on rkey is 0).
    if (!prev || (life - prev.life || sac - prev.sac || nonland - prev.nonland || prev.restricted - restricted
      || prev.flex - flex || prev.basicsUsed - basicsUsed) < 0) {
      const residual = classes.map((c, i) => c.members.length - (used[i] as number));
      best.set(key, { used: [...used], residual, assign: [...assign], life, sac, nonland, restricted, flex, basicsUsed, rkey: residual.join(',') });
    }
    if (firstOnly) stop = true;
  },

  genericDfs(remaining: number, start: number): void {
    if (leaves >= MAX_LEAVES || stop) return;
    if (remaining === 0) { emit(); return; }
    for (let ci = start; ci < classes.length; ci++) {
      const c = classes[ci] as Class;
      if ((used[ci] as number) >= c.members.length) continue;
      const col = cheapestAny(c);
      if (!col) continue;
      used[ci] = (used[ci] as number) + 1;
      usedKey += radix[ci] as number;
      usedFlex += c.flexUnit;
      assign.push({ cls: ci, color: col });
      genericDfs(remaining - 1, ci);
      assign.pop();
      used[ci] = (used[ci] as number) - 1;
      usedKey -= radix[ci] as number;
      usedFlex -= c.flexUnit;
    }
  },

  colorDfs(i: number, start: number): void {
    if (leaves >= MAX_LEAVES || stop) return;
    if (i === pips.length) { genericDfs(cost.generic, 0); return; }
    const col = pips[i] as ManaColor;
    const from = i > 0 && pips[i - 1] === col ? start : 0;
    for (let ci = from; ci < classes.length; ci++) {
      const c = classes[ci] as Class;
      if ((used[ci] as number) >= c.members.length || !c.best[col]) continue;
      used[ci] = (used[ci] as number) + 1;
      usedKey += radix[ci] as number;
      usedFlex += c.flexUnit;
      assign.push({ cls: ci, color: col });
      colorDfs(i + 1, ci);
      assign.pop();
      used[ci] = (used[ci] as number) - 1;
      usedKey -= radix[ci] as number;
      usedFlex -= c.flexUnit;
    }
  },
  };
  const { cheapestAny, emit, genericDfs, colorDfs } = fns;

  colorDfs(0, 0);

  if (firstOnly) {
    const first = best.values().next();
    return first.done ? [] : [materialize(classes, first.value)];
  }
  const cands = [...best.values()].sort(compare);
  const cov = coverTable(classes);
  const kept = cands.filter((b, bi) => !cands.some((a, ai) => ai !== bi
    && dominates(cov, a.residual, b.residual)
    && (!dominates(cov, b.residual, a.residual) || ai < bi)));
  return kept.map((cand) => materialize(classes, cand));
}

function compare(a: Candidate, b: Candidate): number {
  return a.life - b.life || a.sac - b.sac || a.nonland - b.nonland || b.restricted - a.restricted
    || b.flex - a.flex || b.basicsUsed - a.basicsUsed || (a.rkey < b.rkey ? -1 : a.rkey > b.rkey ? 1 : 0);
}

function materialize(classes: Class[], cand: Candidate): PaymentPlan {
  const next = classes.map(() => 0);
  const plan: PaymentPlan = { pool: [], taps: [], life: cand.life, sacrifices: cand.sac, residualKey: cand.rkey };
  for (const a of cand.assign) {
    const c = classes[a.cls] as Class;
    const unit = c.members[next[a.cls] as number] as Unit;
    next[a.cls] = (next[a.cls] as number) + 1;
    if (unit.pool !== undefined) plan.pool.push(unit.pool);
    else plan.taps.push({ objId: unit.objId as ObjId, key: (c.best[a.color] as { key: AbilityKey }).key, color: a.color });
  }
  plan.pool.sort((x, y) => x - y);
  return plan;
}

// ---- per-tick payment cache (perf, docs/PERF.md T1.5) -------------------------------------------

/**
 * Payment data of one player in one unchanged state (same content tick, mutate.ts): mana sources,
 * solver classes and plans. Sources, classes and plans read no timing field and not the event
 * buffer, so the move generator (hasAction, legalMoves) and the move that follows (castSpell,
 * activateAbility, unlockDoor) share them for as long as the tick stands.
 */
interface PayCache {
  sources: ManaSource[] | null;
  upper: number;
  classes: ClassCache;
  /** 'f|' + key: firstOnly plans (existence); 'a|' + key: all plans. */
  plans: Map<string, PaymentPlan[]>;
}
const payCaches = new WeakMap<GameState, { tick: number; pay: [PayCache | undefined, PayCache | undefined] }>();

function payCache(state: GameState, player: PlayerId): PayCache {
  const tick = getContentTick();
  let e = payCaches.get(state);
  if (!e || e.tick !== tick) {
    e = { tick, pay: [undefined, undefined] };
    payCaches.set(state, e);
  }
  let pc = e.pay[player];
  if (!pc) {
    pc = { sources: null, upper: -1, classes: new Map(), plans: new Map() };
    e.pay[player] = pc;
  }
  return pc;
}

/** manaSources(state, player), computed once per content tick. Read-only. */
export function cachedManaSources(state: GameState, player: PlayerId): ManaSource[] {
  const pc = payCache(state, player);
  if (!pc.sources) pc.sources = manaSources(state, player);
  return pc.sources;
}

/** Pool entries plus mana sources with a usable option (no cost above this can be paid), per tick. */
export function manaUpperBound(state: GameState, player: PlayerId): number {
  const pc = payCache(state, player);
  if (pc.upper < 0) pc.upper = state.players[player].manaPool.length + cachedManaSources(state, player).length;
  return pc.upper;
}

/**
 * solvePayment(state, player, cost, ctx, { firstOnly }) through the per-tick cache: the same plans,
 * shared (read-only). An existence question (firstOnly) may get all plans (same emptiness).
 */
export function paymentPlans(state: GameState, player: PlayerId, cost: ManaCost, ctx: PayContext, firstOnly: boolean): PaymentPlan[] {
  const pc = payCache(state, player);
  const key = `${costString(cost)}|${ctx.creatureSpell ? 1 : 0}|${(ctx.exclude ?? []).join(',')}`;
  let plans = pc.plans.get(`a|${key}`) ?? (firstOnly ? pc.plans.get(`f|${key}`) : undefined);
  if (!plans) {
    plans = solvePayment(state, player, cost, ctx, { firstOnly, sources: cachedManaSources(state, player), classCache: pc.classes });
    pc.plans.set(`${firstOnly ? 'f' : 'a'}|${key}`, plans);
  }
  return plans;
}

// WIRE-DARK[test helper, used by the land scenario tests in src/test/cards]
export function canPay(state: GameState, player: PlayerId, cost: ManaCost, ctx: PayContext): boolean {
  return solvePayment(state, player, cost, ctx, { firstOnly: true }).length > 0;
}

/**
 * Executes a plan: activates its mana abilities, then spends exactly the planned pool entries and
 * the newly produced mana. Throws if the spent mana does not satisfy the cost.
 */
export function payMana(state: GameState, player: PlayerId, cost: ManaCost, plan: PaymentPlan, ctx: PayContext, pick?: Picker): void {
  const before = state.players[player].manaPool.length;
  for (const t of plan.taps) activateManaAbility(state, player, t.objId, t.key, t.color, pick);
  const pool = state.players[player].manaPool;
  const spend = [...plan.pool, ...Array.from({ length: pool.length - before }, (_, i) => before + i)];
  const spent = spend.map((i) => pool[i] as ManaPoolEntry);
  if (!satisfies(spent, cost, ctx)) throw new Error('payMana: planned mana does not pay the cost');
  for (const i of [...spend].sort((a, b) => b - a)) removePoolEntry(state, player, i);
}

/** Colored pips first (each needs its color), then generic from anything usable. */
function satisfies(entries: ManaPoolEntry[], cost: ManaCost, ctx: PayContext): boolean {
  if (entries.some((e) => e.restriction === 'creatureSpell' && !ctx.creatureSpell)) return false;
  const left = entries.map((e) => e.color);
  for (const col of PIP_ORDER) {
    for (let k = 0; k < cost[col as keyof ManaCost]; k++) {
      const i = left.indexOf(col);
      if (i < 0) return false;
      left.splice(i, 1);
    }
  }
  return left.length === cost.generic;
}
