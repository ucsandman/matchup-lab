// Combat: declaring attackers and blockers, their enumeration for the move generator (collapsed
// and capped), and the single combat damage step (no first strike in the pool, PLAN.md section 4).
//
// Approximation (documented in ENGINE-NOTES): when two or more creatures block one attacker, the
// attacker's controller would divide its damage as they choose:
// CR 510.1c (divided as its controller chooses). The engine divides it by a fixed rule instead of exposing a choice:
// blockers in ascending order of damage needed to be lethal (ties by id), each assigned lethal
// damage in turn, the rest to the defending player with trample (CR 702.19b (trample)), or to the
// last blocker without trample.
import { clearField, pushEvent, setField, setIn } from './mutate.js';
import { characteristics, classKey, hasKeyword, isType } from './statics.js';
import { dealDamage } from './damage.js';
import { clearIfSet } from './ctx.js';
import type { Defender, GameState, ObjId, PlayerId, Target } from './types.js';

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const ATTACK_CAP = 64;
const BLOCK_CAP = 64;
/** Upper bound on raw combinations generated before ranking and capping. */
const RAW_CAP = 4096;

/**
 * CR 508.1a (attack): untapped creatures the active player controls that have haste or were
 * controlled continuously since the turn began (CR 302.6 (summoning sickness)).
 */
export function canAttack(state: GameState, id: ObjId, player: PlayerId): boolean {
  const o = state.objects[id];
  if (!o || o.zone !== 'battlefield' || o.controller !== player || o.tapped) return false;
  if (!isType(state, id, 'Creature')) return false;
  if (o.sick && !hasKeyword(state, id, 'haste')) return false;
  return true;
}

export function attackCandidates(state: GameState, player: PlayerId): ObjId[] {
  return state.zones.battlefield.filter((id) => canAttack(state, id, player));
}

/** CR 508.1b (attack planeswalkers): the defending player and each planeswalker they control. */
export function defenders(state: GameState, attackingPlayer: PlayerId): Defender[] {
  const dp = other(attackingPlayer);
  const out: Defender[] = [{ kind: 'player', p: dp }];
  for (const id of [...state.zones.battlefield].sort((a, b) => a - b)) {
    const o = state.objects[id];
    if (o && o.controller === dp && isType(state, id, 'Planeswalker')) out.push({ kind: 'planeswalker', id });
  }
  return out;
}

const defKey = (d: Defender): string => (d.kind === 'player' ? `p${d.p}` : `w${d.id}`);

/** Declares attackers (answer to the declareAttackers Choice). Throws on an illegal declaration. */
export function declareAttackers(state: GameState, assignments: readonly [ObjId, Defender][]): void {
  const ap = state.activePlayer;
  const legalDefs = new Set(defenders(state, ap).map(defKey));
  const seen = new Set<ObjId>();
  for (const [id, d] of assignments) {
    if (seen.has(id)) throw new Error(`declareAttackers: ${id} declared twice`);
    seen.add(id);
    if (!canAttack(state, id, ap)) throw new Error(`declareAttackers: ${id} cannot attack`);
    if (!legalDefs.has(defKey(d))) throw new Error(`declareAttackers: bad defender ${defKey(d)}`);
  }
  for (const [id, d] of assignments) {
    // CR 508.1f (tap attackers): attacking causes the creatures to become tapped.
    setField(state, id, 'tapped', true);
    setField(state, id, 'attacking', { ...d });
    setIn(state, ['objects', id, 'attacksThisTurn'], (state.objects[id]?.attacksThisTurn ?? 0) + 1);
  }
  for (const [id, d] of assignments) pushEvent(state, { e: 'attacks', id, defender: { ...d } });
  if (assignments.length === 0) {
    // CR 508.8 (no attackers): skip declare blockers and combat damage.
    const q = state.phaseQueue;
    if (q[0] === 'declareBlockers' && q[1] === 'combatDamage') setIn(state, ['phaseQueue'], q.slice(2));
  }
}

export function attackers(state: GameState): ObjId[] {
  return state.zones.battlefield.filter((id) => state.objects[id]?.attacking !== undefined);
}

/** CR 509.1a (block): an untapped creature of the defending player; flying needs flying (CR 702.9b (flying)). */
export function canBlock(state: GameState, blocker: ObjId, attacker: ObjId): boolean {
  const b = state.objects[blocker];
  const a = state.objects[attacker];
  if (!b || !a || b.zone !== 'battlefield' || b.tapped || !a.attacking) return false;
  if (b.controller === a.controller || !isType(state, blocker, 'Creature')) return false;
  if (hasKeyword(state, attacker, 'flying') && !hasKeyword(state, blocker, 'flying')) return false;
  return true;
}

export function blockerCandidates(state: GameState, player: PlayerId): ObjId[] {
  const atk = attackers(state);
  return state.zones.battlefield.filter((id) => {
    const o = state.objects[id];
    return !!o && o.controller === player && atk.some((a) => canBlock(state, id, a));
  });
}

export function blockersAvailable(state: GameState, player: PlayerId): boolean {
  return blockerCandidates(state, player).length > 0;
}

/** Returns null when the block declaration is legal, else the reason. */
export function checkBlocks(state: GameState, assignments: readonly [ObjId, ObjId][]): string | null {
  const seen = new Set<ObjId>();
  const count = new Map<ObjId, number>();
  for (const [b, a] of assignments) {
    if (seen.has(b)) return `blocker ${b} blocks twice`;
    seen.add(b);
    if (!canBlock(state, b, a)) return `${b} cannot block ${a}`;
    count.set(a, (count.get(a) ?? 0) + 1);
  }
  // CR 702.111b (menace): blocked by two or more creatures, or not at all.
  for (const [a, n] of count) if (n === 1 && hasKeyword(state, a, 'menace')) return `menace: ${a} needs two blockers`;
  return null;
}

/** Declares blockers (answer to the declareBlockers Choice). */
export function declareBlockers(state: GameState, assignments: readonly [ObjId, ObjId][]): void {
  const why = checkBlocks(state, assignments);
  if (why) throw new Error(`declareBlockers: ${why}`);
  const blockedSet = new Set<ObjId>();
  for (const [b, a] of assignments) {
    setField(state, b, 'blocking', [a]);
    blockedSet.add(a);
  }
  // CR 509.1h (blocked creature): stays blocked even if its blockers leave combat.
  for (const a of blockedSet) setField(state, a, 'blocked', true);
}

/** CR 511.3 (removed from combat): at the end of the end of combat step. */
export function removeFromCombat(state: GameState): void {
  for (const id of state.zones.battlefield) {
    const o = state.objects[id];
    if (!o) continue;
    if (o.attacking) clearField(state, id, 'attacking');
    if (o.blocking) clearField(state, id, 'blocking');
    clearIfSet(state, id, 'blocked');
  }
}

// ---- combat damage ---------------------------------------------------------------------------

/** Damage still needed to be lethal (CR 702.2c (deathtouch lethal): 1 for a deathtouch source). */
function lethalNeeded(state: GameState, id: ObjId, deathtouch: boolean, pending: number): number {
  const c = characteristics(state, id);
  const o = state.objects[id];
  const left = Math.max(0, c.toughness - (o?.damage ?? 0) - pending);
  if (deathtouch) return left > 0 ? Math.min(1, left) : 0;
  return left;
}

function defenderTarget(state: GameState, d: Defender): Target | null {
  if (d.kind === 'player') return { kind: 'player', p: d.p };
  const w = state.objects[d.id];
  // CR 510.1b (unblocked damage): a creature attacking a planeswalker that left assigns no damage.
  return w && w.zone === 'battlefield' && isType(state, d.id, 'Planeswalker') ? { kind: 'obj', id: d.id } : null;
}

/** The combat damage step: assign all combat damage, then deal it simultaneously (CR 510.2 (dealt simultaneously)). */
export function combatDamage(state: GameState): void {
  const assigns: { src: ObjId; target: Target; n: number }[] = [];
  const pendingOn = new Map<ObjId, number>();
  const atk = attackers(state).sort((a, b) => a - b);
  for (const a of atk) {
    const o = state.objects[a];
    if (!o || !o.attacking || !isType(state, a, 'Creature')) continue;
    const power = characteristics(state, a).power;
    // CR 510.1a (assigns combat damage equal to its power): 0 or less assigns none.
    if (power <= 0) continue;
    const trample = hasKeyword(state, a, 'trample');
    const deathtouch = hasKeyword(state, a, 'deathtouch');
    const dt = defenderTarget(state, o.attacking);
    if (!o.blocked) {
      if (dt) assigns.push({ src: a, target: dt, n: power });
      continue;
    }
    const blockers = state.zones.battlefield
      .filter((id) => state.objects[id]?.blocking?.includes(a) && isType(state, id, 'Creature'))
      .sort((x, y) => lethalNeeded(state, x, deathtouch, pendingOn.get(x) ?? 0) - lethalNeeded(state, y, deathtouch, pendingOn.get(y) ?? 0) || x - y);
    if (blockers.length === 0) {
      // CR 702.19d (trample, no blockers left): all damage to the player or planeswalker attacked.
      // CR 510.1c (blocking it): without trample it assigns no combat damage.
      if (trample && dt) assigns.push({ src: a, target: dt, n: power });
      continue;
    }
    let left = power;
    for (let i = 0; i < blockers.length && left > 0; i++) {
      const b = blockers[i] as ObjId;
      const need = lethalNeeded(state, b, deathtouch, pendingOn.get(b) ?? 0);
      const last = i === blockers.length - 1;
      const n = last && !trample ? left : Math.min(left, need);
      if (n > 0) {
        assigns.push({ src: a, target: { kind: 'obj', id: b }, n });
        pendingOn.set(b, (pendingOn.get(b) ?? 0) + n);
        left -= n;
      }
    }
    if (left > 0 && trample && dt) assigns.push({ src: a, target: dt, n: left });
    else if (left > 0) {
      const b = blockers[blockers.length - 1] as ObjId;
      assigns.push({ src: a, target: { kind: 'obj', id: b }, n: left });
    }
  }
  // CR 510.1d (blocking creature assigns): all its damage to the creature it blocks.
  for (const b of [...state.zones.battlefield].sort((x, y) => x - y)) {
    const o = state.objects[b];
    if (!o?.blocking || !isType(state, b, 'Creature')) continue;
    const a = o.blocking.find((x) => state.objects[x]?.zone === 'battlefield' && state.objects[x]?.attacking);
    if (a === undefined) continue;
    const power = characteristics(state, b).power;
    if (power > 0) assigns.push({ src: b, target: { kind: 'obj', id: a }, n: power });
  }
  for (const x of assigns) dealDamage(state, x.src, x.target, x.n, true);
}

// ---- enumeration for the move generator ------------------------------------------------------

function power(state: GameState, id: ObjId): number {
  return characteristics(state, id).power;
}

/**
 * Attack declarations, collapsed by identical attackers (classKey) and capped at ATTACK_CAP,
 * heuristic-ranked: no attack first, then all-in at the player, then by total power attacking the
 * player, descending. Each option lists [attacker, defender] pairs.
 */
export function attackOptions(state: GameState, player: PlayerId, cap = ATTACK_CAP): [ObjId, Defender][][] {
  const cands = attackCandidates(state, player).sort((a, b) => a - b);
  const defs = defenders(state, player);
  const classes = new Map<string, ObjId[]>();
  for (const id of cands) {
    const k = classKey(state, id);
    const arr = classes.get(k);
    if (arr) arr.push(id);
    else classes.set(k, [id]);
  }
  const cls = [...classes.values()];
  const raw: [ObjId, Defender][][] = [];
  const cur: [ObjId, Defender][] = [];
  // Distribute each class's members over (not attacking, defender 0, defender 1, ...).
  const rec = (ci: number): void => {
    if (raw.length >= RAW_CAP) return;
    if (ci === cls.length) { raw.push([...cur]); return; }
    const members = cls[ci] as ObjId[];
    const dist = (di: number, next: number): void => {
      if (raw.length >= RAW_CAP) return;
      if (di === defs.length) { rec(ci + 1); return; }
      for (let k = members.length - next; k >= 0; k--) {
        for (let i = 0; i < k; i++) cur.push([members[next + i] as ObjId, { ...(defs[di] as Defender) }]);
        dist(di + 1, next + k);
        cur.length -= k;
      }
    };
    dist(0, 0);
  };
  rec(0);
  const score = (opt: [ObjId, Defender][]): number => opt.reduce((s, [id, d]) => s + (d.kind === 'player' ? power(state, id) * 2 : power(state, id)), 0);
  const empty = raw.filter((o) => o.length === 0);
  const rest = raw.filter((o) => o.length > 0)
    .map((o) => ({ o, s: score(o), k: JSON.stringify(o) }))
    .sort((x, y) => y.s - x.s || y.o.length - x.o.length || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0))
    .map((x) => x.o);
  return [...empty, ...rest].slice(0, cap);
}

/**
 * Block declarations, collapsed by identical blockers and identical attackers, menace-validated,
 * capped at BLOCK_CAP and heuristic-ranked: no blocks first, then by attacking power stopped.
 */
export function blockOptions(state: GameState, player: PlayerId, cap = BLOCK_CAP): [ObjId, ObjId][][] {
  const atk = attackers(state).sort((a, b) => a - b);
  const blk = blockerCandidates(state, player).sort((a, b) => a - b);
  const aClass = new Map<ObjId, string>();
  for (const a of atk) aClass.set(a, classKey(state, a));
  const raw: [ObjId, ObjId][][] = [];
  const cur: [ObjId, ObjId][] = [];
  const bKeys = blk.map((b) => classKey(state, b));
  const rec = (i: number, prevChoice: number): void => {
    if (raw.length >= RAW_CAP) return;
    if (i === blk.length) { raw.push([...cur]); return; }
    const b = blk[i] as ObjId;
    // Identical blockers choose non-decreasing options (symmetry breaking); -1 = no block.
    const sameAsPrev = i > 0 && bKeys[i] === bKeys[i - 1];
    const from = sameAsPrev ? prevChoice : -1;
    for (let c = from; c < atk.length; c++) {
      if (c >= 0 && !canBlock(state, b, atk[c] as ObjId)) continue;
      if (c >= 0) cur.push([b, atk[c] as ObjId]);
      rec(i + 1, c);
      if (c >= 0) cur.pop();
    }
  };
  rec(0, -1);
  const seen = new Set<string>();
  const valid: { o: [ObjId, ObjId][]; s: number; k: string }[] = [];
  for (const o of raw) {
    if (checkBlocks(state, o) !== null) continue;
    // Canonical signature: attacker class -> sorted blocker classes, so blocking either of two
    // identical attackers the same way is one option.
    const per = new Map<ObjId, string[]>();
    for (const [b, a] of o) {
      const arr = per.get(a);
      const bk = classKey(state, b);
      if (arr) arr.push(bk);
      else per.set(a, [bk]);
    }
    const sig = [...per.entries()].map(([a, bs]) => `${aClass.get(a)}=>${bs.sort().join('+')}`).sort().join('||');
    if (seen.has(sig)) continue;
    seen.add(sig);
    let s = 0;
    for (const a of per.keys()) s += power(state, a);
    valid.push({ o, s, k: sig });
  }
  valid.sort((x, y) => (x.o.length === 0 ? -1 : y.o.length === 0 ? 1 : y.s - x.s || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0)));
  return valid.slice(0, cap).map((v) => v.o);
}
