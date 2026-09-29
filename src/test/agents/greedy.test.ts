// Greedy agent units (PLAN.md section 7, Phase 2): the determinized sample holds nothing the view
// does not, the London mulligan rule, the static combat estimate, and a lethal-burn scenario.
import { describe, expect, it } from 'vitest';
import { given, id1 } from '../helpers.js';
import { newGame } from '../../engine/setup.js';
import { applyMoveInPlace } from '../../engine/apply.js';
import { decider, legalMoves } from '../../engine/moves.js';
import { invalidateMemo } from '../../engine/mutate.js';
import { seedRng } from '../../engine/rng.js';
import { view } from '../../engine/view.js';
import { randomAgent } from '../../agents/random.js';
import { hiddenFrom, sampleHidden } from '../../agents/sample.js';
import {
  castableByTurn3, combatOutcome, detectProfile, greedyAgent, IN_COMBAT, keepHand, keptHandScore, scoredState, staticBlock,
} from '../../agents/greedy.js';
import { cloneState } from '../../engine/apply.js';
import type { DefId, GameState, PlayerId } from '../../engine/types.js';

function midGame(seed: number, moves: number): GameState {
  const s = newGame('deckA', 'deckB', seed, 0);
  const ag = [randomAgent(seed + 1), randomAgent(seed + 2)];
  for (let i = 0; i < moves && !s.result; i++) {
    const p = decider(s) as PlayerId;
    applyMoveInPlace(s, ag[p]!.choose({ player: p, moves: legalMoves(s, p), view: () => view(s, p) }));
  }
  return s;
}

const defsOf = (s: GameState, ids: readonly number[]): DefId[] => ids.map((id) => s.objects[id]!.defId).sort();

describe('determinized sample', () => {
  it('the deciding player sees the same view; hidden identities are permuted within each owner', () => {
    let permuted = 0;
    let hiddenCards = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = midGame(seed, 60);
      const before = JSON.stringify(s);
      for (const p of [0, 1] as const) {
        const smp = sampleHidden(s, p, seedRng(seed * 10 + p));
        expect(JSON.stringify(view(smp, p))).toBe(JSON.stringify(view(s, p)));
        const hidden = hiddenFrom(s, p);
        for (const owner of [0, 1] as const) {
          expect(defsOf(smp, hidden[owner])).toEqual(defsOf(s, hidden[owner]));
          hiddenCards += hidden[owner].length;
          if (hidden[owner].some((id) => smp.objects[id]!.defId !== s.objects[id]!.defId)) permuted++;
        }
        expect(smp.seed).not.toEqual(s.seed);
      }
      expect(JSON.stringify(s)).toBe(before); // the real state is untouched
    }
    console.log(`sample: ${hiddenCards} hidden cards over 20 samples, ${permuted} of 20 owner pools permuted`);
    expect(hiddenCards).toBeGreaterThan(0);
    expect(permuted).toBeGreaterThanOrEqual(15);
  });
});

describe('London mulligan (greedy)', () => {
  const d = (...names: string[]): DefId[] => names.map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, ''));
  it('keeps 2 to 5 lands with a spell castable by turn 3, else mulligans', () => {
    expect(keepHand(d('Swamp', 'Blood Crypt', 'Thoughtseize', 'Sheoldred, the Apocalypse', 'Fatal Push', 'Duress', 'Abrade'), 0)).toBe(true);
    expect(keepHand(d('Swamp', 'Thoughtseize', 'Sheoldred, the Apocalypse', 'Fatal Push', 'Duress', 'Abrade', 'Bitter Triumph'), 0)).toBe(false);
    expect(keepHand(d('Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Fatal Push'), 0)).toBe(false);
    // Two Swamps and only red-needing spells: nothing castable by turn 3.
    expect(keepHand(d('Swamp', 'Swamp', 'Abrade', 'Fable of the Mirror-Breaker', 'Bloodtithe Harvester', 'Abrade', 'Abrade'), 0)).toBe(false);
    expect(keepHand(d('Swamp', 'Thoughtseize', 'Duress', 'Duress', 'Duress'), 2)).toBe(true);
  });
  it('castable by turn 3 respects colors and one land per turn', () => {
    expect(castableByTurn3('fable-of-the-mirror-breaker', d('Swamp', 'Swamp', 'Swamp'))).toBe(false);
    expect(castableByTurn3('fable-of-the-mirror-breaker', d('Blood Crypt', 'Swamp', 'Swamp'))).toBe(true);
    expect(castableByTurn3('sheoldred-the-apocalypse', d('Swamp', 'Swamp', 'Swamp', 'Swamp'))).toBe(false);
    expect(castableByTurn3('bloodtithe-harvester', d('Blightstep Pathway', 'Blightstep Pathway'))).toBe(true);
  });
  it('bottoms the excess land from a flooded seven', () => {
    const flood = d('Swamp', 'Swamp', 'Blood Crypt', 'Mutavault', 'Swamp', 'Thoughtseize', 'Fable of the Mirror-Breaker');
    const keepLandsOut = flood.filter((_, i) => i !== 4);
    const keepSpellOut = flood.filter((_, i) => i !== 5);
    expect(keptHandScore(keepLandsOut)).toBeGreaterThan(keptHandScore(keepSpellOut));
  });
});

describe('static combat estimate', () => {
  it('Bloodtithe Harvester blocked by Gifted Aetherborn: both die (deathtouch), no damage through', () => {
    const s = given({
      turn: 3, step: 'declareBlockers', active: 0,
      battlefield: ['Bloodtithe Harvester', { card: 'Gifted Aetherborn', controller: 1 }],
      libraries: [['Swamp'], ['Swamp']],
    });
    const h = id1(s, 'bloodtithe-harvester');
    const a = id1(s, 'gifted-aetherborn');
    s.objects[h]!.attacking = { kind: 'player', p: 1 };
    invalidateMemo(s);
    const blocked = combatOutcome(s, [[a, h]]);
    expect(blocked.deadAttackers).toEqual([h]);
    expect(blocked.deadBlockers).toEqual([a]);
    expect(blocked.damage).toBe(0);
    const open = combatOutcome(s, []);
    expect(open.damage).toBe(3);
    expect(open.deadAttackers).toEqual([]);
    // The defender at 3 life must block (3 unblocked damage is lethal).
    s.players[1].life = 3;
    const pick = staticBlock(s, 1, [{ type: 'declareBlockers', assignments: [] }, { type: 'declareBlockers', assignments: [[a, h]] }]);
    expect(pick).toEqual({ type: 'declareBlockers', assignments: [[a, h]] });
  });
});

describe('greedy decisions', () => {
  it('burns face for lethal (Mono-Red, opponent at 2)', () => {
    const s = given({
      turn: 4, step: 'main1', active: 1,
      battlefield: [{ card: 'Mountain', controller: 1 }, { card: 'Monastery Swiftspear', controller: 1 }, { card: 'Bloodtithe Harvester', controller: 0 }],
      hands: [['Swamp'], ['Burst Lightning', 'Mountain']],
      libraries: [['Swamp', 'Swamp'], ['Mountain', 'Mountain']],
      life: [2, 20],
    });
    const g = greedyAgent(7);
    const moves = legalMoves(s, 1);
    const m = g.choose({ player: 1, moves, view: () => view(s, 1), sample: (r) => sampleHidden(s, 1, r) });
    expect(g.profile()?.name).toBe('monored');
    expect(m).toMatchObject({ type: 'cast', targets: [{ kind: 'player', p: 0 }] });
  });
  it('picks the profile from the cards it owns', () => {
    const s = newGame('deckA', 'deckB', 3, 0);
    expect(detectProfile(s, 0).name).toBe('rakdos');
    expect(detectProfile(s, 1).name).toBe('monored');
  });
  it('is deterministic given the state and its seed', () => {
    const s = midGame(9, 40);
    const p = decider(s) as PlayerId;
    const moves = legalMoves(s, p);
    const d = { player: p, moves, view: () => view(s, p), sample: (r: ReturnType<typeof seedRng>) => sampleHidden(s, p, r) };
    const a = greedyAgent(42).explain(d);
    const b = greedyAgent(42).explain(d);
    expect(a.map((x) => x.score)).toEqual(b.map((x) => x.score));
    expect(greedyAgent(42).choose(d)).toEqual(greedyAgent(42).choose(d));
  });
});

describe('greedy scoring point', () => {
  // Every move of one decision is scored at the same point of the game. Inside combat the other
  // moves settle through the combat damage step, so a pass there must too (a pass scored before
  // damage against a cast scored after it made any instant look better by the damage dealt).
  it('in combat windows every move, the pass included, is scored after combat damage; outside combat a quiet pass is the position itself', () => {
    let windows = 0;
    let passes = 0;
    let quiet = 0;
    for (const seed of [7, 8, 9, 10]) {
      const s = newGame('deckA', 'deckB', seed, (seed % 2) as PlayerId);
      const ag = [greedyAgent(seed + 100), greedyAgent(seed + 200)];
      for (let i = 0; i < 2000 && !s.result; i++) {
        const p = decider(s) as PlayerId;
        const moves = legalMoves(s, p);
        const profOf = (q: PlayerId) => detectProfile(s, q);
        const passIdx = moves.findIndex((m) => m.type === 'pass');
        if (!s.pendingChoice && s.zones.stack.length === 0 && passIdx >= 0 && moves.length > 1) {
          if (IN_COMBAT.has(s.step)) {
            windows++;
            for (const m of moves) {
              const at = scoredState(cloneState(s), m, p, profOf);
              expect(at === s).toBe(false);
              if (!at.result) expect(IN_COMBAT.has(at.step) && at.zones.stack.length === 0 && !at.pendingChoice).toBe(false);
              if (m.type === 'pass') passes++;
            }
          } else {
            const c = cloneState(s);
            expect(scoredState(c, moves[passIdx]!, p, profOf)).toBe(c);
            quiet++;
          }
        }
        applyMoveInPlace(s, ag[p]!.choose({ player: p, moves, view: () => view(s, p), sample: (r) => sampleHidden(s, p, r) }));
      }
    }
    console.log(`scoring point: ${windows} combat priority windows with a pass and another move (${passes} passes settled), ${quiet} quiet passes outside combat`);
    expect(windows).toBeGreaterThan(0);
    expect(passes).toBe(windows);
    expect(quiet).toBeGreaterThan(0);
  });
});
