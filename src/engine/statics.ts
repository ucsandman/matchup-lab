// Characteristics function: computes an object's current characteristics from its def, face and
// the continuous effects in the pool. There is no general layer system (PLAN.md D8); the fixed
// order below covers exactly this card pool (CR 613.1 (layers)):
//   1. copy values (Reflection copies)                         layer 1
//   2. type and subtype additions (Urborg, manland overlays)   layer 4
//   3. colors (manland overlays)                               layer 5
//   4. ability additions (overlays, until-EOT grants, Roles)   layer 6
//   5. P/T: overlay base, then CDA, then counters, then until-EOT deltas, then Roles   layer 7
// Results are memoized per state in a WeakMap owned by mutate.ts; every mutation of objects,
// battlefield, stack or effects drops the memo, except object fields computeChars never reads
// (tapped, damage, sick, combat flags, non-P/T counters; mutate.ts NON_CHAR_FIELDS).
import { getAbility, getDef } from '../cards/index.js';
import { getMemo, getObjMemo, setMemo, setObjMemo, setPartialDrop } from './mutate.js';
import type {
  AbilityKey, CardType, Characteristics, Color, FaceDef, GameObject, GameState, Keyword, ObjId, PlayerId,
  StaticCategory, StaticDef,
} from './types.js';
import { manaValueOfString } from './cost.js';

import { COLOR, KW, TYPE } from './bits.js';
export { COLOR, KW, TYPE };
/** Land-subtype bitmask. The five basic land types come first. */
export const LAND = { Plains: 1, Island: 2, Swamp: 4, Mountain: 8, Forest: 16, Desert: 32 } as const;
export type LandTypeName = keyof typeof LAND;
const BASIC_LAND_MANA: ReadonlyArray<[number, AbilityKey]> = [
  [LAND.Plains, 'basic:W'], [LAND.Island, 'basic:U'], [LAND.Swamp, 'basic:B'], [LAND.Mountain, 'basic:R'], [LAND.Forest, 'basic:G'],
];

interface Memo {
  chars: Record<number, Characteristics>;
  /** Battlefield activated ability keys per object, derived from chars (dropped with it, mutate.ts). */
  actKeys: Record<number, AbilityKey[]>;
  urborg?: boolean;
  landMask?: [number, number] | undefined;
  statics: Partial<Record<StaticCategory, StaticRef[]>>;
  /** Bumped when a partial drop resets the aggregates; the trigger listener index checks it. */
  gen: number;
}
export interface StaticRef { sourceId: ObjId; key: AbilityKey; def: StaticDef }

function memo(state: GameState): Memo {
  let m = getMemo<Memo>(state);
  if (!m) {
    m = { chars: {}, actKeys: {}, statics: {}, gen: 0 };
    setMemo(state, m);
  }
  return m;
}

function maskOf<T extends string>(table: Readonly<Record<T, number>>, items: readonly T[]): number {
  let m = 0;
  for (const it of items) m |= table[it] ?? 0;
  return m;
}
function landMaskOfSubtypes(subtypes: readonly string[]): number {
  let m = 0;
  for (const s of subtypes) m |= (LAND as Record<string, number>)[s] ?? 0;
  return m;
}

function faceKeys(defId: string, faceIndex: number, f: FaceDef): AbilityKey[] {
  return f.abilities.map((_, i) => `${defId}:${faceIndex}:${i}`);
}

/**
 * Per-face data computeChars reads on every call, computed once per face (perf, docs/PERF.md
 * T1.5): the printed ability keys, the masks, the mana value of the face's own cost, the
 * supertype flags and each printed ability's P/T CDA. Keyed by the FaceDef object; keys also
 * depend on the def id and face index, which are checked on every hit.
 */
interface FaceInfo {
  defId: string;
  fi: number;
  keys: readonly AbilityKey[];
  cdas: readonly (((state: GameState, id: ObjId) => [number, number]) | null)[];
  types: number;
  colors: number;
  kw: number;
  manaValue: number;
  legendary: boolean;
  basic: boolean;
}
const faceInfos = new WeakMap<FaceDef, FaceInfo>();
function faceInfo(defId: string, fi: number, f: FaceDef): FaceInfo {
  const hit = faceInfos.get(f);
  if (hit && hit.defId === defId && hit.fi === fi) return hit;
  const keys = faceKeys(defId, fi, f);
  const info: FaceInfo = {
    defId, fi, keys,
    cdas: f.abilities.map((ab) => (ab.kind === 'static' && ab.category === 'ptCda' && ab.cda ? ab.cda : null)),
    types: maskOf(TYPE, f.types), colors: maskOf(COLOR, f.colors), kw: maskOf(KW, f.keywords),
    manaValue: manaValueOfString(f.cost),
    legendary: f.supertypes.includes('Legendary'), basic: f.supertypes.includes('Basic'),
  };
  faceInfos.set(f, info);
  return info;
}

function hasUrborgStatic(o: GameObject): boolean {
  const f = getDef(o.defId).faces[o.face];
  return !!f && f.abilities.some((a) => a.kind === 'static' && a.category === 'allLandsAreSwamps');
}

/**
 * Finer invalidation (mutate.ts setPartialDrop; perf, docs/PERF.md T1.5). computeChars of an
 * object on the battlefield reads other objects only through Urborg (printed statics), the objects
 * attached to it (printed faces) and effects; the aggregates (static lists, land masks, listener
 * index) read every battlefield object. So an object entering or leaving the battlefield, or
 * changing its animation overlay, changes its own entries, its host's (the host's P/T, keywords and
 * classKey read attachments) and the aggregates, unless it carries Urborg's static, which changes
 * every land: then only a full drop will do.
 */
setPartialDrop((state, ids, aggregates) => {
  const m = getMemo<Memo>(state);
  const km = getObjMemo<Record<number, string>>(state);
  const drop = (id: ObjId): void => {
    if (m) { delete m.chars[id]; delete m.actKeys[id]; }
    if (km) delete km[id];
  };
  for (const id of ids) {
    const o = state.objects[id];
    if (!o) return false;
    if (aggregates) {
      if (hasUrborgStatic(o)) return false;
      if (o.attachedTo !== undefined) drop(o.attachedTo);
    }
    drop(id);
  }
  if (aggregates && m) {
    m.statics = {};
    m.landMask = undefined;
    m.gen++;
  }
  return true;
});

/**
 * Urborg is a single global boolean (PLAN.md D8), read from printed abilities of battlefield
 * permanents so it never recurses into characteristics().
 */
export function urborgActive(state: GameState): boolean {
  const m = memo(state);
  if (m.urborg === undefined) {
    m.urborg = state.zones.battlefield.some((id) => {
      const o = state.objects[id];
      return !!o && hasUrborgStatic(o);
    });
  }
  return m.urborg;
}

function computeChars(state: GameState, obj: GameObject): Characteristics {
  const def = getDef(obj.defId);
  const onField = obj.zone === 'battlefield';
  const onStack = obj.zone === 'stack';
  let name: string;
  let base: FaceDef;
  let abilities: AbilityKey[];
  let manaValue: number;
  let extraKw: Keyword[] = [];
  /** Face data of base when abilities starts with exactly its printed keys (CDA lookup below). */
  let printed: FaceInfo | null = null;

  // 1. Copy values (CR 707.2 (copiable values)); the copy token adds haste (CR 707.9b (copy exceptions)).
  if (obj.copyOf) {
    const src = getDef(obj.copyOf);
    // CR 707.8a (copy of a double-faced permanent): copyFace 1 copies the back face.
    const cf = obj.copyFace ?? 0;
    base = src.faces[cf] as FaceDef;
    name = base.name;
    printed = faceInfo(src.id, cf, base);
    abilities = [...printed.keys];
    // CR 712.8e (back face mana value): a permanent copying a back face has mana value 0.
    manaValue = cf === 1 ? 0 : printed.manaValue;
    extraKw = (def.faces[0] as FaceDef).keywords;
  } else if (def.layout === 'room') {
    // CR 709.5 (locked half): a locked door has no name, mana cost or rules text on the battlefield.
    // CR 709.4b (split card mana value): elsewhere both halves count; on the stack only the cast half.
    const halves = onField
      ? [0, 1].filter((h) => obj.unlocked?.[h] === true)
      : onStack ? [obj.face] : [0, 1];
    base = def.faces[0] as FaceDef;
    name = halves.map((h) => (def.faces[h] as FaceDef).name).join(' // ');
    abilities = halves.flatMap((h) => faceKeys(def.id, h, def.faces[h] as FaceDef));
    manaValue = halves.reduce((s, h) => s + manaValueOfString((def.faces[h] as FaceDef).cost), 0);
  } else {
    // CR 712.8a (front face): outside battlefield and stack a double-faced card has its front face.
    // CR 715.4 (adventurer card): only an Adventure spell on the stack uses the Adventure face.
    let fi: number = onField || onStack ? obj.face : 0;
    if (def.layout === 'adventure' && !onStack) fi = 0;
    base = def.faces[fi] as FaceDef;
    if (!base) throw new Error(`${def.id} has no face ${fi}`);
    name = base.name;
    printed = faceInfo(def.id, fi, base);
    abilities = [...printed.keys];
    // CR 712.8e (back face mana value): a transformed permanent uses its front face's mana cost.
    const costFace = def.layout === 'transform' ? (def.faces[0] as FaceDef) : base;
    manaValue = obj.token ? 0 : costFace === base ? printed.manaValue : manaValueOfString(costFace.cost);
  }

  // Masks and supertypes of base (the same for any def id, so the room's faces[0] may use its own).
  const baseInfo = printed ?? faceInfo(def.id, 0, base);
  let types = baseInfo.types;
  const subtypes = [...base.subtypes];
  let allCreatureTypes = false;
  let colors = baseInfo.colors;
  let kw = baseInfo.kw | maskOf(KW, extraKw);
  const ov = onField ? obj.animated : undefined;

  // 2. Types (layer 4).
  if (ov) {
    if (ov.types) types |= maskOf(TYPE, ov.types);
    if (ov.subtypes) for (const s of ov.subtypes) if (!subtypes.includes(s)) subtypes.push(s);
    if (ov.allCreatureTypes) allCreatureTypes = true; // CR 205.3m (creature types)
  }
  if (onField && (types & TYPE.Land) && urborgActive(state) && !subtypes.includes('Swamp')) subtypes.push('Swamp');
  const landTypes = types & TYPE.Land ? landMaskOfSubtypes(subtypes) : 0;
  if (landTypes) {
    // CR 305.6 (basic land types intrinsic ability): each basic land type grants its mana ability.
    for (const [bit, key] of BASIC_LAND_MANA) if (landTypes & bit) abilities.push(key);
  }

  // 3. Colors (layer 5).
  if (ov?.colors) colors = maskOf(COLOR, ov.colors);

  // 4. Abilities (layer 6).
  if (ov) {
    if (ov.keywords) kw |= maskOf(KW, ov.keywords);
    if (ov.abilities) abilities.push(...ov.abilities);
  }
  if (onField && (types & TYPE.Land)) {
    // Petrified Hamlet: CR 613.1f (layer 6 ability-adding): lands with the chosen name have its mana ability.
    for (const e of state.effects) if (e.kind === 'namedBan' && e.grant && e.name === name && !abilities.includes(e.grant)) abilities.push(e.grant);
  }
  let roleP = 0;
  let roleT = 0;
  if (onField) {
    for (const e of state.effects) if (e.kind === 'keywords' && e.target === obj.id) kw |= maskOf(KW, e.keywords);
    for (const aid of state.zones.battlefield) {
      const a = state.objects[aid];
      if (!a || a.attachedTo !== obj.id) continue;
      const af = getDef(a.defId).faces[a.face];
      for (const ab of af?.abilities ?? []) {
        if (ab.kind === 'static' && ab.category === 'enchantedGets') {
          if (ab.keywords) kw |= maskOf(KW, ab.keywords);
          roleP += ab.p ?? 0;
          roleT += ab.t ?? 0;
        }
      }
    }
  }

  // 5. Power and toughness (layer 7, CR 613.4 (layer 7 sublayers)); all modifications are additive.
  let [power, toughness] = ov?.pt ?? base.pt ?? [0, 0];
  // Printed keys (the prefix of abilities) use the face's precomputed CDAs; the rest look up the registry.
  const nPrinted = printed ? printed.keys.length : 0;
  for (let i = 0; i < abilities.length; i++) {
    if (i < nPrinted) {
      const cda = (printed as FaceInfo).cdas[i];
      if (cda) [power, toughness] = cda(state, obj.id);
      continue;
    }
    const k = abilities[i] as AbilityKey;
    if (k.startsWith('basic:')) continue;
    const ab = getAbility(k).ability;
    if (ab.kind === 'static' && ab.category === 'ptCda' && ab.cda) [power, toughness] = ab.cda(state, obj.id);
  }
  const plus = obj.counters.p1p1 ?? 0;
  const minus = obj.counters.m1m1 ?? 0;
  power += plus - minus;
  toughness += plus - minus;
  if (onField) {
    for (const e of state.effects) {
      if (e.kind === 'ptDelta' && e.target === obj.id) { power += e.p; toughness += e.t; }
    }
  }
  power += roleP;
  toughness += roleT;

  return {
    name, types, subtypes, allCreatureTypes, legendary: baseInfo.legendary,
    basic: baseInfo.basic, colors, power, toughness, kw, abilities, manaValue, landTypes,
    isToken: obj.token !== undefined,
  };
}

export function characteristics(state: GameState, id: ObjId): Characteristics {
  const m = memo(state);
  const hit = m.chars[id];
  if (hit) return hit;
  const obj = state.objects[id];
  if (!obj) throw new Error(`characteristics: no object ${id}`);
  const c = computeChars(state, obj);
  m.chars[id] = c;
  return c;
}

/**
 * Keys of the activated abilities an object has on the battlefield (not mana abilities), in
 * ability order. Memoized with its characteristics (perf, docs/PERF.md T1.5); read-only.
 */
export function battlefieldActivatedKeys(state: GameState, id: ObjId): AbilityKey[] {
  const m = memo(state);
  const hit = m.actKeys[id];
  if (hit) return hit;
  const keys = characteristics(state, id).abilities.filter((k) => {
    if (k.startsWith('basic:')) return false;
    const ab = getAbility(k).ability;
    return ab.kind === 'activated' && ab.zone === 'battlefield';
  });
  m.actKeys[id] = keys;
  return keys;
}

export function isType(state: GameState, id: ObjId, type: CardType): boolean {
  return (characteristics(state, id).types & TYPE[type]) !== 0;
}
export function hasKeyword(state: GameState, id: ObjId, k: Keyword): boolean {
  return (characteristics(state, id).kw & KW[k]) !== 0;
}
export function manaValue(state: GameState, id: ObjId): number {
  return characteristics(state, id).manaValue;
}

/** OR of the land types of every land the player controls (Urborg-aware). */
export function landTypeMask(state: GameState, player: PlayerId): number {
  const m = memo(state);
  if (!m.landMask) {
    const masks: [number, number] = [0, 0];
    for (const id of state.zones.battlefield) {
      const o = state.objects[id];
      if (o) masks[o.controller] |= characteristics(state, id).landTypes;
    }
    m.landMask = masks;
  }
  return m.landMask[player];
}
export function controlsLandType(state: GameState, player: PlayerId, types: readonly string[]): boolean {
  return (landTypeMask(state, player) & landMaskOfSubtypes(types)) !== 0;
}

/** Static abilities of one category on the battlefield, in source-id order. */
export function staticAbilities(state: GameState, category: StaticCategory): StaticRef[] {
  const m = memo(state);
  const hit = m.statics[category];
  if (hit) return hit;
  const out: StaticRef[] = [];
  const ids = [...state.zones.battlefield].sort((a, b) => a - b);
  for (const id of ids) {
    for (const key of characteristics(state, id).abilities) {
      if (key.startsWith('basic:')) continue;
      const ab = getAbility(key).ability;
      if (ab.kind === 'static' && ab.category === category) out.push({ sourceId: id, key, def: ab });
    }
  }
  m.statics[category] = out;
  return out;
}

/**
 * Collapsing key: two objects with the same key are interchangeable for move generation and
 * payment (defId, face, copy, controller, tapped, sick, damage, counters, attachments, animation).
 */
export function classKey(state: GameState, id: ObjId): string {
  // classKey reads tapped, sick, damage and attacking too, so it lives in the object memo, which
  // any object change drops (mutate.ts invalidateFor).
  let keys = getObjMemo<Record<number, string>>(state);
  if (!keys) { keys = {}; setObjMemo(state, keys); }
  const hit = keys[id];
  if (hit !== undefined) return hit;
  const k = computeClassKey(state, id);
  keys[id] = k;
  return k;
}

function computeClassKey(state: GameState, id: ObjId): string {
  const o = state.objects[id];
  if (!o) throw new Error(`classKey: no object ${id}`);
  const counters = Object.keys(o.counters).sort().map((k) => `${k}${o.counters[k as keyof typeof o.counters]}`).join(',');
  const attached: string[] = [];
  if (o.zone === 'battlefield') {
    for (const aid of state.zones.battlefield) {
      const a = state.objects[aid];
      if (a && a.attachedTo === id) attached.push(a.defId);
    }
    attached.sort();
  }
  const anim = o.animated ? JSON.stringify(o.animated) : '';
  return [o.defId, o.face, o.copyOf ? `${o.copyOf}${o.copyFace ?? ''}` : '', o.controller, o.zone, o.tapped ? 1 : 0, o.sick ? 1 : 0, o.damage, counters,
    attached.join('+'), anim, o.unlocked ? o.unlocked.map(Number).join('') : '', o.attacking ? JSON.stringify(o.attacking) : ''].join('|');
}
