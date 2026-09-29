// View-based determinizer (src/agents/determinize.ts; PLAN.md section 7, Phase 4): samples never
// contradict the view (the sample's view is byte-identical to the input view), zone sizes and card
// multisets match the decklists, known library positions are pinned (London mulligan bottoms, a
// scried-to-top card is the next draw), unknown slots get fresh ids, and every sample plays out to
// the end under the fuzz invariants.
import { describe, expect, it } from 'vitest';
import '../../cards/index.js';
import { newGame } from '../../engine/setup.js';
import { applyMoveInPlace, cloneState } from '../../engine/apply.js';
import { decider, legalMoves } from '../../engine/moves.js';
import { view } from '../../engine/view.js';
import { answerPregame } from '../../engine/mulligan.js';
import { drawCard, scry1 } from '../../engine/zones.js';
import { seedRng } from '../../engine/rng.js';
import { CAPS, checkInvariants, checkViewLeak } from '../../tools/play.js';
import { randomAgent } from '../../agents/random.js';
import { deckDefIds, DeterminizeError, prepareDeterminizer } from '../../agents/determinize.js';
import type { DefId, GameState, ObjId, PlayerId } from '../../engine/types.js';

const DECKS: [string, string] = ['deckA', 'deckB'];
const LISTS = [deckDefIds('deckA'), deckDefIds('deckB')] as const;
const sorted = (xs: DefId[]): string => [...xs].sort().join(',');

/** Plays random vs random from seed until pick(state) accepts a decision point; null if the game ends first. */
function playTo(seed: number, pick: (s: GameState) => boolean): GameState | null {
  const s = newGame('deckA', 'deckB', seed, 'random');
  const agents = [randomAgent(seed * 2 + 11), randomAgent(seed * 2 + 12)];
  while (!s.result) {
    const p = decider(s);
    if (p === null) return null;
    if (pick(s)) return s;
    const moves = legalMoves(s, p);
    const st = s;
    applyMoveInPlace(s, (agents[p] as ReturnType<typeof randomAgent>).choose({ player: p, moves, view: () => view(st, p) }));
  }
  return null;
}

const priorityOrCombat = (s: GameState): boolean => s.pending === null && (s.pendingChoice === null
  || s.pendingChoice.kind === 'declareAttackers' || s.pendingChoice.kind === 'declareBlockers');

/** Plays a sample to the end with random agents, checking invariants 1-5 after every move. Returns moves played. */
function playOut(s: GameState, seed: number): number {
  const agents = [randomAgent(seed), randomAgent(seed + 1)];
  let moves = 0;
  while (!s.result) {
    const p = decider(s);
    if (p === null) break;
    const legal = legalMoves(s, p);
    expect(legal.length).toBeGreaterThan(0);
    const st = s;
    applyMoveInPlace(s, (agents[p] as ReturnType<typeof randomAgent>).choose({ player: p, moves: legal, view: () => view(st, p) }));
    checkInvariants(s, [60, 60]);
    if (++moves > CAPS.movesPerGame) throw new Error('playout cap');
  }
  return moves;
}

describe('determinize', () => {
  it('1,000 samples of 20 mid-game views: never contradict the view, right zone sizes and lists, pinned known positions, fuzz invariants', () => {
    const views: { real: GameState; viewer: PlayerId }[] = [];
    for (let seed = 7001; views.length < 20; seed++) {
      const i = views.length;
      const minTurn = 3 + (i % 6);
      const s = playTo(seed, (st) => st.turn >= minTurn && priorityOrCombat(st) && st.pendingTriggers.length === 0 && st.events.length === 0);
      if (!s) continue;
      const viewer = (i % 2) as PlayerId;
      // Half the views also carry a scry-to-top (Torch the Tower's scry) for the viewer.
      if (i % 4 < 2 && s.zones.library[viewer].length > 0) scry1(s, viewer, false);
      views.push({ real: s, viewer });
    }
    let samples = 0, withBottom = 0, withTop = 0, moves = 0, legalChecks = 0, varied = 0, oppHidden = 0;
    for (const [vi, { real, viewer }] of views.entries()) {
      const v = view(real, viewer);
      const base = JSON.stringify(v);
      const det = prepareDeterminizer(v, DECKS);
      const rng = seedRng(90_000 + vi);
      const known = v.zones.library[viewer];
      const top = known.knownTop ?? [];
      const bottom = known.knownBottom ?? [];
      const visibleIds = Object.keys(v.objects).map(Number);
      const hands = new Set<string>();
      if (bottom.length) withBottom++;
      if (top.length) withTop++;
      for (let k = 0; k < 50; k++) {
        const s = det.sample(rng);
        samples++;
        // Everything the viewer sees is exactly as in the view (known cards, public zones, sizes, flags).
        expect(JSON.stringify(view(s, viewer))).toBe(base);
        // Fuzz invariants 1-5 and the view leak check (8) for both players.
        checkInvariants(s, [60, 60]);
        checkViewLeak(s, 0);
        checkViewLeak(s, 1);
        // The opponent knows their own sampled hand.
        expect(view(s, (1 - viewer) as PlayerId).zones.hand[1 - viewer as PlayerId].hidden).toHaveLength(0);
        for (const p of [0, 1] as const) {
          expect(s.zones.hand[p].length).toBe(real.zones.hand[p].length);
          expect(s.zones.library[p].length).toBe(real.zones.library[p].length);
          const cards = Object.values(s.objects).filter((o) => o.owner === p && o.token === undefined).map((o) => o.defId);
          expect(sorted(cards)).toBe(sorted([...LISTS[p]]));
        }
        // Known positions pinned: bottom[0] is the very bottom, top[0] the top card.
        const lib = s.zones.library[viewer];
        bottom.forEach((id, j) => expect(lib[j]).toBe(id));
        top.forEach((id, j) => expect(lib[lib.length - 1 - j]).toBe(id));
        // Unknown slots have fresh ids above everything in the view.
        const hiddenIds = [...s.zones.hand[1 - viewer as PlayerId].filter((id) => !v.zones.hand[1 - viewer as PlayerId].known.includes(id)),
          ...s.zones.library[0], ...s.zones.library[1]].filter((id) => !(id in v.objects));
        for (const id of hiddenIds) expect(id).toBeGreaterThan(Math.max(...visibleIds));
        // The viewer's legal moves are the same as in the real game.
        if (decider(real) === viewer) {
          expect(JSON.stringify(legalMoves(s, viewer))).toBe(JSON.stringify(legalMoves(real, viewer)));
          legalChecks++;
        }
        const opp = (1 - viewer) as PlayerId;
        hands.add(sorted(s.zones.hand[opp].map((id) => (s.objects[id] as { defId: DefId }).defId)));
        moves += playOut(s, 50_000 + samples);
      }
      if (v.zones.hand[1 - viewer as PlayerId].hidden.length > 0) { oppHidden++; if (hands.size > 1) varied++; }
    }
    console.log(`determinize: ${samples} samples of ${views.length} views (${withBottom} with known bottoms, ${withTop} with a known top), `
      + `${legalChecks} legal-move comparisons, ${moves} playout moves with invariants checked, `
      + `${varied} of ${oppHidden} views with unseen opponent cards gave more than one opponent hand`);
    expect(samples).toBe(1000);
    expect(withBottom).toBeGreaterThan(0);
    expect(withTop).toBeGreaterThanOrEqual(5);
    expect(legalChecks).toBeGreaterThan(0);
    expect(oppHidden).toBeGreaterThan(0);
    expect(varied).toBe(oppHidden);
  }, 600_000);

  it('London mulligan bottoms stay at the bottom and a scried-to-top card is the next draw in every sample', () => {
    const s = newGame('deckA', 'deckB', 4242, 0);
    // Player 0 mulligans twice (to five, two cards on the bottom); player 1 keeps.
    for (let guard = 0; s.pendingChoice !== null && guard < 20; guard++) {
      const ch = s.pendingChoice;
      if (ch.kind === 'mulligan') answerPregame(s, { keep: ch.player === 1 || s.players[0].mulligans >= 2 });
      else if (ch.kind === 'bottom') answerPregame(s, { ids: s.zones.hand[ch.player].slice(0, ch.count) });
    }
    expect(s.pendingChoice).toBeNull();
    expect(s.players[0].mulligans).toBe(2);
    scry1(s, 0, false);
    const topId = s.zones.library[0][s.zones.library[0].length - 1] as ObjId;
    const v = view(s, 0);
    expect(v.zones.library[0].knownBottom).toHaveLength(2);
    expect(v.zones.library[0].knownTop).toEqual([topId]);
    const det = prepareDeterminizer(v, DECKS);
    const rng = seedRng(1);
    const bottomsReal = v.zones.library[0].knownBottom as ObjId[];
    let n = 0;
    for (let k = 0; k < 200; k++) {
      const t = det.sample(rng);
      const lib = t.zones.library[0];
      expect(lib.slice(0, 2)).toEqual(bottomsReal);
      expect(lib.slice(0, 2).map((id) => t.objects[id]!.defId)).toEqual(bottomsReal.map((id) => s.objects[id]!.defId));
      // The next draw is the scried card (a fresh id in hand, CR 400.7 (new object)).
      const c = cloneState(t);
      const drawn = drawCard(c, 0);
      expect(drawn).not.toBeNull();
      expect(c.objects[drawn as ObjId]!.defId).toBe(s.objects[topId]!.defId);
      n++;
    }
    console.log(`determinize pins: ${n} samples, 2 bottoms and 1 top pinned in each`);
    expect(n).toBe(200);
  });

  it('rebuilds the opponent\'s hidden pregame choice; refuses a mid-operation choice with a clear message', () => {
    const s = newGame('deckA', 'deckB', 99, 0);
    answerPregame(s, { keep: false }); // player 0 mulligans
    answerPregame(s, { keep: true }); // player 1 keeps; player 0 now bottoms one
    // Player 1 (the viewer) sees only {kind, player, hidden}.
    expect(s.pendingChoice).toEqual({ kind: 'bottom', player: 0, count: 1 });
    expect(view(s, 1).pendingChoice).toEqual({ kind: 'bottom', player: 0, hidden: true });
    const t = prepareDeterminizer(view(s, 1), DECKS).sample(seedRng(3));
    expect(t.pendingChoice).toEqual(s.pendingChoice);
    const answer = legalMoves(t, 0)[0];
    expect(answer).toBeDefined();
    applyMoveInPlace(t, answer!);
    checkInvariants(t, [60, 60]);
    // The sample moves on exactly as the real game does after a bottom answer.
    applyMoveInPlace(s, legalMoves(s, 0)[0]!);
    expect(t.pendingChoice).toEqual(s.pendingChoice);
    expect(t.pregame).toEqual(s.pregame);

    const mid = playTo(123, (st) => st.pending !== null);
    expect(mid).not.toBeNull();
    const chooser = mid!.pendingChoice!.player;
    for (const p of [chooser, (1 - chooser) as PlayerId]) {
      expect(() => prepareDeterminizer(view(mid!, p), DECKS)).toThrow(DeterminizeError);
      expect(() => prepareDeterminizer(view(mid!, p), DECKS)).toThrow(/in the middle of an operation/);
    }
  });

  it('refuses a view that shows more copies than the list has', () => {
    const s = playTo(5, (st) => st.turn >= 3 && priorityOrCombat(st));
    const v = view(s!, 0);
    const bf = v.zones.battlefield.find((id) => v.objects[id]!.owner === 0 && v.objects[id]!.token === undefined)
      ?? v.zones.hand[0].known[0] as ObjId;
    const extra = structuredClone(v);
    for (let i = 0; i < 5; i++) {
      const id = 5000 + i;
      extra.objects[id] = { ...structuredClone(v.objects[bf]!), id, zone: 'graveyard' };
      extra.zones.graveyard[0].push(id);
    }
    expect(() => prepareDeterminizer(extra, DECKS)).toThrow(/more .* than the list/);
  });
});
