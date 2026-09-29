// Per-player view leak tests (PLAN.md section 6): (a) no hidden identity, id or private field;
// (b) indistinguishability under permutation of hidden objects; (c) own knowledge kept.
import { describe, expect, it } from 'vitest';
import { deckOf, given, registerTestDef, TestBear } from '../helpers.js';
import { card, face } from '../../cards/dsl.js';
import { view } from '../../engine/view.js';
import { beginJournal, invalidateMemo, pushEvent } from '../../engine/mutate.js';
import { scry1 } from '../../engine/zones.js';
import { newGame } from '../../engine/setup.js';
import { answerPregame } from '../../engine/mulligan.js';
import { seedRng } from '../../engine/rng.js';
import type { GameState, ObjId } from '../../engine/types.js';

const SECRETS = Array.from({ length: 16 }, (_, i) =>
  registerTestDef(card(`Test Secret ${i + 1}`, [face({ name: `Test Secret ${i + 1}`, types: ['Sorcery'], cost: '{B}' })])).id);
const sec = (n: number): string => SECRETS[n - 1] as string;

/** Rewrites object ids everywhere they occur in these test states. */
function renumber(s: GameState, map: Map<ObjId, ObjId>): void {
  const m = (id: ObjId): ObjId => map.get(id) ?? id;
  const objects: GameState['objects'] = {};
  for (const o of Object.values(s.objects)) objects[m(o.id)] = { ...o, id: m(o.id) };
  s.objects = objects;
  for (const z of ['library', 'hand', 'graveyard', 'exile'] as const) for (const p of [0, 1] as const) s.zones[z][p] = s.zones[z][p].map(m);
  s.zones.battlefield = s.zones.battlefield.map(m);
  for (const p of [0, 1] as const) {
    const k = s.players[p].libraryKnown;
    s.players[p].libraryKnown = { top: k.top.map(m), bottom: k.bottom.map(m) };
  }
  const ch = s.pendingChoice;
  if (ch && ch.kind === 'pickObjects') ch.from = ch.from.map(m);
  for (const it of s.zones.stack) if (it.trigger?.objId !== undefined) it.trigger.objId = m(it.trigger.objId);
  invalidateMemo(s);
}

/** A mid-game state with hidden cards whose ids are moved to 90001+ so a leak is easy to spot. */
function secretState(): { s: GameState; hidden: ObjId[]; hiddenDefs: string[] } {
  const s = given({
    battlefield: ['Mountain', TestBear.id, { card: 'Swamp', controller: 1 }],
    hands: [['Test Bolt'], [sec(1), sec(2), { card: sec(3), knownToOpponent: true }]],
    graveyards: [[], ['Test Bolt']],
    libraries: [[sec(11), sec(12), sec(13), sec(14), sec(15), sec(16)], [sec(4), sec(5), sec(6), sec(7), sec(8), sec(9), sec(10)]],
  });
  // A learns two library positions: one card scried to the bottom, then the new top kept on top.
  scry1(s, 0, true);
  scry1(s, 0, false);
  const known = new Set([...s.players[0].libraryKnown.top, ...s.players[0].libraryKnown.bottom]);
  const hidden: ObjId[] = [
    ...s.zones.hand[1].filter((id) => !s.objects[id]!.knownTo[0]),
    ...s.zones.library[1],
    ...s.zones.library[0].filter((id) => !known.has(id)),
  ];
  const map = new Map<ObjId, ObjId>(hidden.map((id, i) => [id, 90001 + i]));
  renumber(s, map);
  const hiddenIds = hidden.map((id) => map.get(id) as ObjId);
  // Private material that must never reach a view.
  beginJournal(s);
  s.log = ['secret log line'];
  pushEvent(s, { e: 'draw', player: 1, id: hiddenIds[0] as ObjId });
  s.pendingChoice = { kind: 'pickObjects', player: 1, reason: 'discard', from: [...s.zones.hand[1]], min: 1, max: 1 };
  s.zones.stack.push({
    id: 5000, kind: 'triggered', controller: 1, sourceId: s.zones.battlefield[2] as ObjId, defId: 'swamp', face: 0, targets: [],
    trigger: { event: 'draw', player: 1, objId: hiddenIds[0] as ObjId },
  });
  return { s, hidden: hiddenIds, hiddenDefs: hiddenIds.map((id) => s.objects[id]!.defId) };
}

const containsId = (json: string, id: ObjId): boolean => new RegExp(`(^|[^0-9])${id}([^0-9]|$)`).test(json);

describe('per-player view', () => {
  it('(a) no hidden defId, no hidden real id, no seed/nextId/journal/log/events key', () => {
    const { s, hidden, hiddenDefs } = secretState();
    const json = JSON.stringify(view(s, 0));
    for (const d of hiddenDefs) expect(json.includes(`"${d}"`)).toBe(false);
    for (const id of hidden) expect(containsId(json, id)).toBe(false);
    for (const key of ['seed', 'nextId', 'journal', 'log', 'events', 'libraryKnown']) expect(json.includes(`"${key}"`)).toBe(false);
    expect(json.includes('secret log line')).toBe(false);
    console.log(`view leak (a): ${hidden.length} hidden objects, ${hiddenDefs.length} hidden defIds checked`);
    expect(hidden.length).toBe(2 + 7 + 4);
    // What must be there: the revealed card, A's own known library positions, public objects.
    const v = view(s, 0);
    expect(json.includes(`"${sec(3)}"`)).toBe(true);
    expect(v.zones.hand[1].known.length).toBe(1);
    expect(v.zones.hand[1].hidden.map((h) => h.vid)).toEqual(['h0', 'h1']);
    expect(v.zones.library[0]).toMatchObject({ size: 6 });
    expect(v.zones.library[0].knownTop!.length).toBe(1);
    expect(v.zones.library[0].knownBottom!.length).toBe(1);
    expect(v.zones.library[1]).toEqual({ size: 7 });
    expect(v.pendingChoice).toEqual({ kind: 'pickObjects', player: 1, hidden: true });
    // B, choosing, sees its own choice verbatim.
    expect(view(s, 1).pendingChoice).toMatchObject({ kind: 'pickObjects', from: s.zones.hand[1] });
  });

  it('(b) permuting hidden defIds and ids, reordering unknown library parts and changing the seed leaves the view byte-identical', () => {
    const { s, hidden } = secretState();
    const base = JSON.stringify(view(s, 0));
    const t = structuredClone(s);
    // rotate defIds among hidden objects
    const defs = hidden.map((id) => t.objects[id]!.defId);
    hidden.forEach((id, i) => { t.objects[id]!.defId = defs[(i + 1) % defs.length] as string; });
    // rotate real ids among hidden objects
    renumber(t, new Map(hidden.map((id, i) => [id, hidden[(i + 3) % hidden.length] as ObjId])));
    // reorder the unknown middle of A's library and all of B's library
    const kA = new Set([...t.players[0].libraryKnown.top, ...t.players[0].libraryKnown.bottom]);
    const libA = t.zones.library[0];
    const unknownA = libA.filter((id) => !kA.has(id)).reverse();
    t.zones.library[0] = libA.map((id) => (kA.has(id) ? id : (unknownA.shift() as ObjId)));
    t.zones.library[1] = [...t.zones.library[1]].reverse();
    t.seed = seedRng(999);
    t.nextId += 17;
    invalidateMemo(t);
    expect(JSON.stringify(view(t, 0))).toBe(base);

    // The check can fail: changing a card A does know (the revealed one) changes A's view.
    const u = structuredClone(s);
    const revealed = u.zones.hand[1].find((id) => u.objects[id]!.knownTo[0]) as ObjId;
    u.objects[revealed]!.defId = sec(16);
    expect(JSON.stringify(view(u, 0))).not.toBe(base);
  });

  it('(c) own knowledge kept: London mulligan bottom and a scry to top show in the owner\'s view only', () => {
    const deck = deckOf({ Swamp: 15, Mountain: 15, 'Test Bear': 15, 'Test Bolt': 15 });
    const s = newGame(deck, deck, 21, 0);
    answerPregame(s, { keep: false });
    answerPregame(s, { keep: true });
    const chosen = s.zones.hand[0][2] as ObjId;
    const chosenDef = s.objects[chosen]!.defId;
    answerPregame(s, { ids: [chosen] });
    answerPregame(s, { keep: true });
    expect(s.pendingChoice).toBeNull();

    const bottomId = s.zones.library[0][0] as ObjId;
    const va = view(s, 0);
    expect(va.zones.library[0].knownBottom).toEqual([bottomId]);
    expect(va.objects[bottomId]!.defId).toBe(chosenDef);
    const vb = view(s, 1);
    expect(vb.zones.library[0]).toEqual({ size: 54 });
    expect(vb.objects[bottomId]).toBeUndefined();

    // Scry 1 (Torch the Tower's scry; the card def arrives in T1.2) keeping the card on top.
    const topId = s.zones.library[0][s.zones.library[0].length - 1] as ObjId;
    scry1(s, 0, false);
    const va2 = view(s, 0);
    expect(va2.zones.library[0].knownTop).toEqual([topId]);
    expect(va2.zones.library[0].knownBottom).toEqual([bottomId]);
    expect(va2.objects[topId]!.defId).toBe(s.objects[topId]!.defId);
    expect(view(s, 1).objects[topId]).toBeUndefined();
  });
});
