// Costs: mana cost parsing and arithmetic, additional costs (kicker, bargain, Bitter Triumph's
// choice), cost reductions, and non-mana cost checks and payment (tap, life, sacrifice, discard,
// remove counters, loyalty). Mana payment itself is in mana.ts.
import type {
  CardDef, CostSpec, FaceDef, GameState, ManaCost, ObjId, PlayerId, SpellDef,
} from './types.js';
import { characteristics, hasKeyword, isType, classKey } from './statics.js';
import { canPayLife, payLife } from './life.js';
import { addCounter, setField } from './mutate.js';
import { discard, sacrifice, type Picker } from './zones.js';
import { makeCtx } from './ctx.js';

export const ZERO_COST: Readonly<ManaCost> = { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
const COLOR_SYMS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

/** Parses '{2}{B}{B}'. CR 107.4 (mana symbols); hybrid, Phyrexian and X are not in this pool. */
const parsedMana = new Map<string, ManaCost>();

/** Parses a mana cost string; results are cached by string and returned as fresh copies (perf, docs/PERF.md). */
export function parseMana(s: string | null | undefined): ManaCost {
  if (!s) return { ...ZERO_COST };
  const hit = parsedMana.get(s);
  if (hit) return { ...hit };
  const c = parseManaUncached(s);
  parsedMana.set(s, { ...c });
  return c;
}

function parseManaUncached(s: string): ManaCost {
  const c: ManaCost = { ...ZERO_COST };
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(s)) !== null) {
    consumed += m[0].length;
    const sym = m[1] as string;
    if (/^\d+$/.test(sym)) c.generic += Number(sym);
    else if ((COLOR_SYMS as readonly string[]).includes(sym)) c[sym as (typeof COLOR_SYMS)[number]] += 1;
    else throw new Error(`parseMana: unsupported symbol {${sym}} in '${s}'`);
  }
  if (consumed !== s.length) throw new Error(`parseMana: malformed cost '${s}'`);
  return c;
}

/** CR 202.3 (mana value): total amount of mana in the cost, regardless of color. */
export function manaValueOf(c: ManaCost): number {
  return c.generic + c.W + c.U + c.B + c.R + c.G + c.C;
}

const manaValues = new Map<string, number>();
/** manaValueOf(parseMana(s)), cached by string (perf, docs/PERF.md T1.5). */
export function manaValueOfString(s: string | null | undefined): number {
  if (!s) return 0;
  let v = manaValues.get(s);
  if (v === undefined) {
    v = manaValueOf(parseMana(s));
    manaValues.set(s, v);
  }
  return v;
}

export function addCosts(a: ManaCost, b: ManaCost): ManaCost {
  return { generic: a.generic + b.generic, W: a.W + b.W, U: a.U + b.U, B: a.B + b.B, R: a.R + b.R, G: a.G + b.G, C: a.C + b.C };
}

/** CR 118.7a (reduce generic): a generic reduction affects only the generic component. */
export function reduceGeneric(c: ManaCost, n: number): ManaCost {
  return { ...c, generic: Math.max(0, c.generic - Math.max(0, n)) };
}

export function costString(c: ManaCost): string {
  let s = c.generic > 0 ? `{${c.generic}}` : '';
  for (const k of COLOR_SYMS) s += `{${k}}`.repeat(c[k]);
  return s === '' ? '{0}' : s;
}

export interface SpellCostOpts {
  kicked?: boolean;
  /** Generic reduction from effects. */
  reduction?: number;
}

/**
 * CR 601.2f (total cost): mana cost plus additional mana costs (kicker, CR 702.33a (kicker)), minus
 * generic reductions. Bargain and Bitter Triumph's choice add non-mana costs only.
 */
export function spellManaCost(f: FaceDef, sp: SpellDef | undefined, opts: SpellCostOpts = {}): ManaCost {
  let c = parseMana(f.cost);
  if (opts.kicked) {
    if (!sp?.kicker) throw new Error(`${f.name} has no kicker`);
    c = addCosts(c, parseMana(sp.kicker));
  }
  if (opts.reduction) c = reduceGeneric(c, opts.reduction);
  return c;
}

export function spellDefOf(f: FaceDef): SpellDef | undefined {
  return f.abilities.find((a): a is SpellDef => a.kind === 'spell');
}

// ---- non-mana costs ----------------------------------------------------------------------------

export interface NonManaChoices {
  sacrifice?: ObjId[];
  discard?: ObjId[];
}

/**
 * Returns null when the non-mana part of cost can be paid with these choices, else a reason.
 * CR 118.3 (necessary resources): a cost can't be paid without the resources to pay it fully.
 */
export function checkNonMana(state: GameState, player: PlayerId, sourceId: ObjId, cost: CostSpec, ch: NonManaChoices = {}): string | null {
  const src = state.objects[sourceId];
  if (!src) return 'no source';
  if (cost.tap) {
    if (src.tapped) return 'tapped';
    // CR 302.6 (summoning sickness): a creature's {T} ability needs continuous control since turn start.
    if (src.zone === 'battlefield' && isType(state, sourceId, 'Creature') && src.sick && !hasKeyword(state, sourceId, 'haste')) return 'summoning sick';
  }
  if (cost.life && !canPayLife(state, player, cost.life)) return 'not enough life';
  if (cost.removeCounter && (src.counters[cost.removeCounter.type] ?? 0) < cost.removeCounter.n) return 'not enough counters';
  if (cost.loyalty !== undefined && cost.loyalty < 0 && (src.counters.loyalty ?? 0) < -cost.loyalty) return 'not enough loyalty';
  if (cost.discardSelf && src.zone !== 'hand') return 'not in hand';
  const discards = ch.discard ?? [];
  if ((cost.discard ?? 0) !== discards.length) return 'wrong discard count';
  for (const id of discards) {
    const o = state.objects[id];
    if (!o || o.zone !== 'hand' || o.owner !== player || id === sourceId) return 'bad discard';
  }
  const sacs = ch.sacrifice ?? [];
  if ((cost.sacrifice?.count ?? 0) !== sacs.length) return 'wrong sacrifice count';
  if (cost.sacrifice) {
    const legal = new Set(sacrificeCandidates(state, player, cost, sourceId));
    for (const id of sacs) if (!legal.has(id)) return 'bad sacrifice';
    if (new Set(sacs).size !== sacs.length) return 'duplicate sacrifice';
  }
  if (cost.sacrificeSelf && src.zone !== 'battlefield') return 'source not on battlefield';
  return null;
}

/** Permanents the player could sacrifice for cost.sacrifice (CR 701.21a (sacrifice)). */
export function sacrificeCandidates(state: GameState, player: PlayerId, cost: CostSpec, sourceId: ObjId): ObjId[] {
  const spec = cost.sacrifice;
  if (!spec) return [];
  return state.zones.battlefield.filter((id) => {
    const o = state.objects[id];
    if (!o || o.controller !== player) return false;
    if (spec.another && id === sourceId) return false;
    if (!spec.filter(state, id, sourceId)) return false;
    return !spec.ctxFilter || spec.ctxFilter(makeCtx(state, sourceId, player, 'cost'), id);
  });
}

/** CR 702.166a (bargain): sacrifice an artifact, enchantment, or token. */
export function bargainCandidates(state: GameState, player: PlayerId): ObjId[] {
  return state.zones.battlefield.filter((id) => {
    const o = state.objects[id];
    if (!o || o.controller !== player) return false;
    const c = characteristics(state, id);
    return c.isToken || isType(state, id, 'Artifact') || isType(state, id, 'Enchantment');
  });
}

/** One representative (lowest id) per collapsing class, preserving first-seen order. */
// WIRE-DARK[test helper, used by src/test/rules/cost.test.ts]
export function collapseByClass(state: GameState, ids: readonly ObjId[]): ObjId[] {
  const seen = new Map<string, ObjId>();
  for (const id of [...ids].sort((a, b) => a - b)) {
    const k = classKey(state, id);
    if (!seen.has(k)) seen.set(k, id);
  }
  return [...seen.values()];
}

/** Hand cards collapsed by name (PLAN.md collapsing rule for discard choices). */
// WIRE-DARK[test helper, used by src/test/rules/cost.test.ts]
export function discardCandidates(state: GameState, player: PlayerId, exclude: ObjId | null = null): ObjId[] {
  const seen = new Map<string, ObjId>();
  for (const id of state.zones.hand[player]) {
    if (id === exclude) continue;
    const n = characteristics(state, id).name;
    if (!seen.has(n)) seen.set(n, id);
  }
  return [...seen.values()];
}

/**
 * Pays the non-mana part of a cost. CR 601.2h (pay costs): costs are paid in any order; this pays
 * loyalty, counters, tap, life, discards, then sacrifices (sacrifices last so the source can still
 * be tapped first).
 */
export function payNonMana(state: GameState, player: PlayerId, sourceId: ObjId, cost: CostSpec, ch: NonManaChoices = {}, pick?: Picker): void {
  const why = checkNonMana(state, player, sourceId, cost, ch);
  if (why) throw new Error(`payNonMana: cannot pay (${why})`);
  if (cost.loyalty) addCounter(state, sourceId, 'loyalty', cost.loyalty);
  if (cost.removeCounter) addCounter(state, sourceId, cost.removeCounter.type, -cost.removeCounter.n);
  if (cost.tap) setField(state, sourceId, 'tapped', true);
  if (cost.life) payLife(state, player, cost.life);
  if (cost.discardSelf) discard(state, sourceId);
  for (const id of ch.discard ?? []) discard(state, id);
  for (const id of ch.sacrifice ?? []) sacrifice(state, id, pick);
  if (cost.sacrificeSelf) sacrifice(state, sourceId, pick);
}
