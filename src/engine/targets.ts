// Target specs and legality. A TargetSpec (types.ts) names a kind (creature, player, opponent,
// any, creatureOrPlaneswalker, planeswalker, artifact, permanent, cardInGraveyard), an optional
// controller restriction, an optional min/max (up to N targets) and an optional filter.
//
// legalTargets lists every legal single target for one spec. targetTuples builds the cross
// product over a spell's or ability's specs, with the move-generator collapsing rules
// (PLAN.md section 6): player targets collapse to the opponent unless the controller is the only
// legal player, and identical objects (same classKey) collapse to one representative.
// CR 115.1 (targets), CR 601.2c (choose targets): the same object can't be chosen twice for one
// instance of the word target, but may be chosen once for each instance.
import { classKey, isType } from './statics.js';
import { makeCtx } from './ctx.js';
import type { GameState, ObjId, PlayerId, Target, TargetSpec } from './types.js';

export function targetKey(t: Target): string {
  return t.kind === 'player' ? `p${t.p}` : `o${t.id}`;
}

/** Type and zone part of legality, without the spec's filter. */
function kindOk(state: GameState, spec: TargetSpec, controller: PlayerId, t: Target): boolean {
  if (t.kind === 'player') {
    if (spec.kind !== 'player' && spec.kind !== 'opponent' && spec.kind !== 'any') return false;
    if (spec.kind === 'opponent' && t.p === controller) return false;
    if (spec.controller === 'you' && t.p !== controller) return false;
    if (spec.controller === 'opponent' && t.p === controller) return false;
    return true;
  }
  const o = state.objects[t.id];
  if (!o) return false;
  if (spec.kind === 'cardInGraveyard') {
    if (o.zone !== 'graveyard') return false;
    if (spec.controller === 'you' && o.owner !== controller) return false;
    if (spec.controller === 'opponent' && o.owner === controller) return false;
    return true;
  }
  if (o.zone !== 'battlefield') return false;
  if (spec.controller === 'you' && o.controller !== controller) return false;
  if (spec.controller === 'opponent' && o.controller === controller) return false;
  switch (spec.kind) {
    case 'creature': return isType(state, t.id, 'Creature');
    case 'planeswalker': return isType(state, t.id, 'Planeswalker');
    // CR 115.4 (any target): a creature, player, planeswalker or battle.
    case 'any':
    case 'creatureOrPlaneswalker': return isType(state, t.id, 'Creature') || isType(state, t.id, 'Planeswalker');
    case 'artifact': return isType(state, t.id, 'Artifact');
    case 'permanent': return true;
    default: return false;
  }
}

/** Is t a legal target for spec, for a spell or ability controlled by controller from sourceId? */
export function isLegalTarget(state: GameState, spec: TargetSpec, controller: PlayerId, sourceId: ObjId, t: Target): boolean {
  if (!kindOk(state, spec, controller, t)) return false;
  if (spec.filter && !spec.filter(makeCtx(state, sourceId, controller, 'target'), t)) return false;
  return true;
}

/** Every legal single target for one spec, players first, then objects by id. */
export function legalTargets(state: GameState, spec: TargetSpec, controller: PlayerId, sourceId: ObjId): Target[] {
  const out: Target[] = [];
  const ctx = spec.filter ? makeCtx(state, sourceId, controller, 'target') : null;
  const { ok } = { ok(t: Target): boolean { return kindOk(state, spec, controller, t) && (!ctx || !spec.filter || spec.filter(ctx, t)); } };
  if (spec.kind === 'player' || spec.kind === 'opponent' || spec.kind === 'any') {
    for (const p of [0, 1] as const) { const t: Target = { kind: 'player', p }; if (ok(t)) out.push(t); }
  }
  if (spec.kind === 'cardInGraveyard') {
    for (const p of [0, 1] as const) for (const id of state.zones.graveyard[p]) { const t: Target = { kind: 'obj', id }; if (ok(t)) out.push(t); }
  } else if (spec.kind !== 'player' && spec.kind !== 'opponent') {
    for (const id of state.zones.battlefield) { const t: Target = { kind: 'obj', id }; if (ok(t)) out.push(t); }
  }
  return out;
}

/** Collapsing key of a target: players by seat, objects by classKey (graveyard cards by def and owner). */
function collapseKey(state: GameState, t: Target): string {
  if (t.kind === 'player') return `p${t.p}`;
  const o = state.objects[t.id];
  if (!o) return `o${t.id}`;
  return o.zone === 'graveyard' ? `g|${o.defId}|${o.owner}` : `b|${classKey(state, t.id)}`;
}

/**
 * Collapses one spec's candidates: identical objects become one representative (lowest id), and
 * player targets collapse to the opponent unless the controller is the only legal player
 * (PLAN.md D9). Returns [representative, class size] pairs.
 */
export function collapseCandidates(state: GameState, controller: PlayerId, cands: readonly Target[]): [Target, number][] {
  const players = cands.filter((t) => t.kind === 'player');
  const keepPlayers = players.length > 1 || cands.length > players.length
    ? players.filter((t) => t.kind === 'player' && t.p !== controller)
    : players;
  const groups = new Map<string, [Target, number]>();
  for (const t of keepPlayers) groups.set(targetKey(t), [t, 1]);
  const objs = cands.filter((t): t is { kind: 'obj'; id: ObjId } => t.kind === 'obj').sort((a, b) => a.id - b.id);
  for (const t of objs) {
    const k = collapseKey(state, t);
    const g = groups.get(k);
    if (g) g[1]++;
    else groups.set(k, [t, 1]);
  }
  return [...groups.values()];
}

/** Choices of size min..max from collapsed classes (multiplicity respected), capped. */
function upToChoices(state: GameState, cands: readonly Target[], min: number, max: number, cap: number): Target[][] {
  // Expand classes back to member lists so a 2-of choice can take two identical cards.
  const byClass = new Map<string, Target[]>();
  for (const t of [...cands].sort((a, b) => targetKey(a) < targetKey(b) ? -1 : 1)) {
    const k = collapseKey(state, t);
    const arr = byClass.get(k);
    if (arr) arr.push(t);
    else byClass.set(k, [t]);
  }
  const classes = [...byClass.values()];
  const out: Target[][] = [];
  const cur: Target[] = [];
  const { rec } = { rec(ci: number): void {
    if (out.length >= cap) return;
    if (ci === classes.length) {
      if (cur.length >= min) out.push([...cur]);
      return;
    }
    const members = classes[ci] as Target[];
    for (let k = 0; k <= members.length && cur.length + k <= max; k++) {
      for (let i = 0; i < k; i++) cur.push(members[i] as Target);
      rec(ci + 1);
      cur.length -= k;
    }
  } };
  rec(0);
  return out;
}

export const TUPLE_CAP = 256;

/** One choice per size min..max (size 0 only when min is 0), taking the lowest ids first. */
function countOnly(cands: readonly Target[], min: number, max: number): Target[][] {
  const sorted = [...cands].sort((a, b) => (a.kind === 'obj' ? a.id : -1) - (b.kind === 'obj' ? b.id : -1));
  const out: Target[][] = [];
  for (let k = min; k <= Math.min(max, sorted.length); k++) out.push(sorted.slice(0, k));
  return out;
}

/**
 * Target tuples for a list of specs, flattened in spec order. With collapse, identical objects and
 * the controller's own face are pruned (move generation); without, every legal tuple is listed.
 * A spec with min < max (up to N) must be the last spec, because the flattened tuple does not
 * record where each spec's targets start.
 */
export function targetTuples(
  state: GameState, specs: readonly TargetSpec[], controller: PlayerId, sourceId: ObjId, collapse = true, cap = TUPLE_CAP,
): Target[][] {
  let tuples: Target[][] = [[]];
  specs.forEach((spec, si) => {
    const min = spec.min ?? 1;
    const max = spec.max ?? 1;
    if (min < max && si !== specs.length - 1) throw new Error('targetTuples: an up-to-N spec must be the last spec');
    let cands = legalTargets(state, spec, controller, sourceId);
    let options: Target[][];
    if (min === 1 && max === 1) {
      if (collapse) cands = collapseCandidates(state, controller, cands).map(([t]) => t);
      options = cands.map((t) => [t]);
    } else {
      if (collapse) {
        const players = collapseCandidates(state, controller, cands.filter((t) => t.kind === 'player')).map(([t]) => t);
        cands = [...players, ...cands.filter((t) => t.kind === 'obj')];
      }
      const choices = (cs: Target[]): Target[][] => (collapse ? upToChoices(state, cs, min, max, cap) : upToChoices(state, cs, min, max, cap * 16));
      if (spec.sameOwner) {
        // CR 601.2c (targets): 'from a single graveyard' restricts the whole choice, so each owner's
        // cards are enumerated on their own and the results merged (the empty choice once).
        options = [];
        const seen = new Set<string>();
        const opp: PlayerId = controller === 0 ? 1 : 0;
        const owners: PlayerId[] = collapse && spec.countOnlyOpponent ? [opp, controller] : [0, 1];
        for (const owner of owners) {
          const mine = cands.filter((t) => t.kind === 'obj' && state.objects[t.id]?.owner === owner);
          // Count-only collapse (PLAN.md D9): from the opponent's graveyard only how many cards are
          // exiled is offered, one tuple per size made of the lowest ids; listed first so the tuple
          // cap never drops them.
          const opts = collapse && spec.countOnlyOpponent && owner === opp
            ? countOnly(mine, min, max)
            : choices(mine);
          for (const op of opts) {
            const k = op.map(targetKey).join(',');
            if (!seen.has(k)) { seen.add(k); options.push(op); }
          }
        }
      } else options = choices(cands);
    }
    const next: Target[][] = [];
    for (const tu of tuples) {
      for (const op of options) {
        if (next.length >= cap) break;
        next.push([...tu, ...op]);
      }
    }
    tuples = next;
  });
  return tuples;
}

/**
 * CR 608.2b (target legality on resolution): which of a stack item's flattened targets are still
 * legal. Specs are matched to flattened targets in order (up-to specs take the rest).
 */
export function recheckTargets(
  state: GameState, specs: readonly TargetSpec[], controller: PlayerId, sourceId: ObjId, targets: readonly Target[],
): boolean[] {
  const legal: boolean[] = [];
  let ti = 0;
  specs.forEach((spec, si) => {
    const min = spec.min ?? 1;
    const max = spec.max ?? 1;
    const n = min < max && si === specs.length - 1 ? targets.length - ti : max;
    let owner: PlayerId | undefined;
    for (let k = 0; k < n && ti < targets.length; k++, ti++) {
      const tg = targets[ti] as Target;
      let ok = isLegalTarget(state, spec, controller, sourceId, tg);
      if (ok && spec.sameOwner && tg.kind === 'obj') {
        // sameOwner: every target of this spec shares the owner of the first one still present.
        const o = state.objects[tg.id] as { owner: PlayerId };
        if (owner === undefined) owner = o.owner;
        else if (o.owner !== owner) ok = false;
      }
      legal.push(ok);
    }
  });
  while (legal.length < targets.length) legal.push(false);
  return legal;
}
