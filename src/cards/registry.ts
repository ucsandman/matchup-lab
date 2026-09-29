// The card registry: DefId -> CardDef, name -> DefId, AbilityKey -> ability. Module-level and
// never part of GameState. cards/index.ts registers the real cards; tests register test defs.
import type { AbilityDef, AbilityKey, CardDef, DefId, ManaAbilityDef, ManaColor } from '../engine/types.js';

export interface AbilityEntry {
  key: AbilityKey;
  defId: DefId;
  face: number;
  index: number;
  ability: AbilityDef;
}

const defs = new Map<DefId, CardDef>();
const byName = new Map<string, DefId>();
const abilities = new Map<AbilityKey, AbilityEntry>();

export function abilityKey(defId: DefId, face: number, index: number): AbilityKey {
  return `${defId}:${face}:${index}`;
}

/** Registers a def and indexes its abilities. Re-registering the same object is a no-op. */
export function registerCard(def: CardDef): void {
  const existing = defs.get(def.id);
  if (existing === def) return;
  if (existing) throw new Error(`registerCard: duplicate def id ${def.id}`);
  defs.set(def.id, def);
  byName.set(def.name, def.id);
  def.faces.forEach((f, fi) => {
    if (fi > 0 && def.layout !== 'token') byName.set(f.name, def.id);
    f.abilities.forEach((ability, ai) => {
      const key = abilityKey(def.id, fi, ai);
      abilities.set(key, { key, defId: def.id, face: fi, index: ai, ability });
    });
  });
}

export function findDef(defId: DefId): CardDef | undefined {
  return defs.get(defId);
}
export function getDef(defId: DefId): CardDef {
  const d = defs.get(defId);
  if (!d) throw new Error(`no card def '${defId}'`);
  return d;
}
/** Exact deck/oracle name ('Blood Crypt', 'Blightstep Pathway // Searstep Pathway') to DefId. */
export function defIdByName(name: string): DefId | undefined {
  return byName.get(name);
}
export function allDefs(): CardDef[] {
  return [...defs.values()];
}

// Intrinsic mana abilities of basic land types (CR 305.6 (basic land types intrinsic ability)).
const BASIC_KEYS: Record<string, ManaColor> = { 'basic:W': 'W', 'basic:U': 'U', 'basic:B': 'B', 'basic:R': 'R', 'basic:G': 'G' };
const basicAbility = (c: ManaColor): ManaAbilityDef => ({ kind: 'mana', produce: [c], cost: { tap: true } });
const basicEntries = new Map<AbilityKey, AbilityEntry>();

export function getAbility(key: AbilityKey): AbilityEntry {
  const e = abilities.get(key);
  if (e) return e;
  const basic = BASIC_KEYS[key];
  if (basic) {
    // One shared entry per basic key (perf, docs/PERF.md); callers treat ability defs as read-only.
    let b = basicEntries.get(key);
    if (!b) { b = { key, defId: 'basic', face: 0, index: 0, ability: basicAbility(basic) }; basicEntries.set(key, b); }
    return b;
  }
  throw new Error(`no ability '${key}'`);
}

/** True when the face has an activated ability that is not a mana ability (manlands, Castle). */
export function hasNonManaActivated(defId: DefId, face: number): boolean {
  const f = getDef(defId).faces[face];
  return !!f && f.abilities.some((a) => a.kind === 'activated');
}
