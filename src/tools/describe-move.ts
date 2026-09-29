// Human-readable move descriptions for the spot analyzer (PLAN.md section 8, Phase 4). A move names
// objects by id; this turns it into card names ("cast Fatal Push -> Emberheart Challenger (B)").
// It reads only the objects map it is given: the analyzer passes a determinized sample, so a
// description may name a card the viewer has not seen; such cards carry the marker '(sampled)'
// when the caller says which ids the determinizer dealt (sampled), so a line never presents a
// sampled card as seen. Objects created later in the search (a spell cast from a sampled hand gets
// a new id on the stack, CR 400.7 (new object)) are named without the marker; the cast itself
// carries it.
import { getDef } from '../cards/index.js';
import type { Choice, Defender, GameObject, Move, ObjId, PlayerId, Target } from '../engine/types.js';

export interface DescribeOpts {
  /** True for the ids of cards the determinizer dealt into hidden slots (marked '(sampled)'). */
  sampled?: ((id: ObjId) => boolean) | undefined;
  /** The pending choice the move answers (names the choice for 'choose' moves). */
  choice?: Choice | null | undefined;
}

const SIDE = ['A', 'B'] as const;

/** The card name of an object (its current face), with the controller's side and a '(sampled)' marker when unseen. */
export function objName(objects: Readonly<Record<number, GameObject>>, id: ObjId, opts: DescribeOpts = {}): string {
  const o = objects[id];
  if (!o) return `object ${id}`;
  const def = getDef(o.defId);
  const name = def.faces[o.face]?.name ?? def.name;
  const sampled = opts.sampled?.(id) ? ' (sampled)' : '';
  return `${name} (${SIDE[o.controller]})${sampled}`;
}

function target(objects: Readonly<Record<number, GameObject>>, t: Target, opts: DescribeOpts): string {
  return t.kind === 'player' ? `player ${SIDE[t.p]}` : objName(objects, t.id, opts);
}

function defender(objects: Readonly<Record<number, GameObject>>, d: Defender, opts: DescribeOpts): string {
  return d.kind === 'player' ? `player ${SIDE[d.p]}` : objName(objects, d.id, opts);
}

const list = (xs: string[]): string => xs.join(', ');

/** Ability number within its face, from a key 'defId:face:index' (intrinsic land mana 'basic:B' stays as is). */
function abilityLabel(key: string): string {
  const parts = key.split(':');
  const idx = parts[parts.length - 1];
  return parts.length === 3 && idx !== undefined ? `ability ${Number(idx) + 1}` : key;
}

/** One line for a move, by card names. player is the mover (for 'pass' and choices). */
export function describeMove(objects: Readonly<Record<number, GameObject>>, move: Move, player: PlayerId, opts: DescribeOpts = {}): string {
  const who = SIDE[player];
  const n = (id: ObjId): string => objName(objects, id, opts);
  const extra: string[] = [];
  switch (move.type) {
    case 'pass':
      return `${who}: pass priority`;
    case 'playLand': {
      if (move.pay) extra.push('pay 2 life, untapped');
      const o = objects[move.objId];
      const face = move.face !== undefined && o ? getDef(o.defId).faces[move.face]?.name : undefined;
      return `${who}: play ${face ?? n(move.objId).replace(/ \([AB]\)/, '')}${extra.length ? ` (${list(extra)})` : ''}`;
    }
    case 'cast': {
      const o = objects[move.objId];
      const def = o ? getDef(o.defId) : null;
      const faceIdx = move.half ?? move.face ?? 0;
      const name = def ? (def.faces[faceIdx]?.name ?? def.name) : `object ${move.objId}`;
      if (move.mode !== undefined) extra.push(`mode ${move.mode + 1}`);
      if (move.kicked) extra.push('kicked');
      if (move.bargain !== undefined) extra.push(`bargaining ${n(move.bargain)}`);
      if (move.costChoice !== undefined) extra.push(`cost option ${move.costChoice + 1}`);
      if (move.discard?.length) extra.push(`discarding ${list(move.discard.map(n))}`);
      if (move.payment) extra.push(`payment ${move.payment + 1}`);
      const tg = move.targets.length ? ` -> ${list(move.targets.map((t) => target(objects, t, opts)))}` : '';
      const sampled = opts.sampled?.(move.objId) ? ' (sampled)' : '';
      return `${who}: cast ${name}${sampled}${tg}${extra.length ? ` (${list(extra)})` : ''}`;
    }
    case 'activate': {
      if (move.crewWith?.length) extra.push(`crew with ${list(move.crewWith.map(n))}`);
      if (move.sacrifice?.length) extra.push(`sacrificing ${list(move.sacrifice.map(n))}`);
      if (move.discard?.length) extra.push(`discarding ${list(move.discard.map(n))}`);
      if (move.payment) extra.push(`payment ${move.payment + 1}`);
      const tg = move.targets.length ? ` -> ${list(move.targets.map((t) => target(objects, t, opts)))}` : '';
      return `${who}: activate ${n(move.objId)} ${abilityLabel(move.abilityKey)}${tg}${extra.length ? ` (${list(extra)})` : ''}`;
    }
    case 'unlockDoor': {
      const o = objects[move.objId];
      const door = o ? getDef(o.defId).faces[move.half]?.name : undefined;
      return `${who}: unlock ${door ?? `door ${move.half + 1}`} of ${n(move.objId)}${move.payment ? ` (payment ${move.payment + 1})` : ''}`;
    }
    case 'declareAttackers':
      return move.assignments.length === 0 ? `${who}: no attack`
        : `${who}: attack with ${list(move.assignments.map(([a, d]) => `${n(a)} -> ${defender(objects, d, opts)}`))}`;
    case 'declareBlockers':
      return move.assignments.length === 0 ? `${who}: no blocks`
        : `${who}: block ${list(move.assignments.map(([b, a]) => `${n(a)} with ${n(b)}`))}`;
    case 'choose': {
      const a = move.answer;
      const kind = opts.choice?.kind;
      if (a.keep !== undefined) return `${who}: ${a.keep ? 'keep' : 'mulligan'}`;
      const what = kind === 'bottom' ? 'put on the bottom' : kind === 'dieReplacement' ? 'apply replacement' : 'choose';
      if (a.ids) return `${who}: ${what} ${a.ids.length ? list(a.ids.map(n)) : 'nothing'}`;
      if (a.index !== undefined) {
        if (opts.choice?.kind === 'pickTargets') {
          const opt = opts.choice.options[a.index];
          if (opt) return `${who}: target ${opt.length ? list(opt.map((t) => target(objects, t, opts))) : 'nothing'}`;
        }
        return `${who}: ${what} option ${a.index + 1}${opts.choice?.kind === 'pickIndex' ? ` (${opts.choice.reason})` : ''}`;
      }
      return `${who}: choose`;
    }
  }
}
