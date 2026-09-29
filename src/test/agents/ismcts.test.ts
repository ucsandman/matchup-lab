// ISMCTS spot analyzer and agent (src/agents/ismcts.ts, mcts-agent.ts, rollout.ts; PLAN.md section 7,
// Phase 4): UCT selection math on a hand-built tree, a scripted lethal spot, a scripted hold-up-
// Fatal-Push spot, journal replay against stored states, determinism (seed, worker count), and the
// agent's information boundary: the type says it analyzes a PlayerView, and at run time the real
// state behind every searched decision is a sealed proxy whose hidden fields throw on access.
import { describe, expect, expectTypeOf, it } from 'vitest';
import '../../cards/index.js';
import { newGame } from '../../engine/setup.js';
import { applyMoveInPlace } from '../../engine/apply.js';
import { decider, legalMoves } from '../../engine/moves.js';
import { view, type PlayerView } from '../../engine/view.js';
import { seedRng } from '../../engine/rng.js';
import { loadSpot } from '../../tools/spot-schema.js';
import { greedyAgent } from '../../agents/greedy.js';
import { sampleHidden, hiddenFrom } from '../../agents/sample.js';
import { mctsAgent, type MctsAgent, type MctsStats } from '../../agents/mcts-agent.js';
import { parseMatchArgs } from '../../cli/index.js';
import {
  aggregate, moveKey, searchView, searchViewParallel, selectChild, uctScore, type SearchResult, type TopLine,
} from '../../agents/ismcts.js';
import { leafValue, squash } from '../../agents/rollout.js';
import type { Agent, Decision } from '../../agents/types.js';
import type { GameState, Move, PlayerId } from '../../engine/types.js';

/** A declares attackers; B is at 3 life with no creatures and no cards in hand: Harvester (3 power) is lethal, the Goblin Shaman token (2) is not. */
export const LETHAL_SPOT = {
  spot: 1, note: 'A has lethal on board', viewer: 0, turn: 7, step: 'declareAttackers', activePlayer: 0,
  pendingChoice: { kind: 'declareAttackers', player: 0 },
  players: [
    { life: 10, hand: [], graveyard: [], exile: [] },
    { life: 3, hand: [], handHidden: 0, graveyard: [], exile: [] },
  ],
  battlefield: [
    { name: 'Swamp', controller: 0, tapped: true }, { name: 'Swamp', controller: 0, tapped: true }, { name: 'Blood Crypt', controller: 0, tapped: true },
    { name: 'Bloodtithe Harvester', controller: 0 }, { name: 'Goblin Shaman', controller: 0 },
    { name: 'Mountain', controller: 1, tapped: true }, { name: 'Mountain', controller: 1, tapped: true },
  ],
};

/**
 * A at 2 life in its main phase 1 with one untapped Swamp, Fatal Push and Duress in hand, land
 * already played. B holds a known Emberheart Challenger (haste, 2 power; revealed earlier) and three
 * Mountains. Casting Duress taps A out, and the Challenger then attacks for lethal; passing keeps
 * Fatal Push up for it.
 */
export const HOLD_PUSH_SPOT = {
  spot: 1, note: 'Duress now, or hold up Fatal Push for a haste threat', viewer: 0, turn: 7, step: 'main1', activePlayer: 0,
  flags: { landsPlayed: [1, 0] },
  players: [
    { life: 2, hand: ['Fatal Push', 'Duress'], graveyard: [], exile: [] },
    { life: 10, hand: ['Emberheart Challenger'], handHidden: 0, graveyard: [], exile: [] },
  ],
  battlefield: [
    { name: 'Swamp', controller: 0 }, { name: 'Swamp', controller: 0, tapped: true }, { name: 'Blood Crypt', controller: 0, tapped: true },
    { name: 'Mountain', controller: 1 }, { name: 'Mountain', controller: 1 }, { name: 'Mountain', controller: 1 },
  ],
};

const strip = (r: SearchResult): unknown => ({ ...r, seconds: 0 });
const lineOf = (r: SearchResult, pred: (l: TopLine) => boolean): TopLine[] => r.lines.filter(pred);
const fmt = (l: TopLine): string => `${l.text}: visits ${l.visits}, mean ${l.mean.toFixed(3)} [95% CI ${l.meanLo.toFixed(3)}-${l.meanHi.toFixed(3)}], win ${(100 * l.win.est).toFixed(1)}% [95% CI ${(100 * l.win.lo).toFixed(1)}-${(100 * l.win.hi).toFixed(1)}%, n=${l.win.n}]`;

describe('UCT', () => {
  it('scores mean + c sqrt(ln N / n), Infinity when unvisited', () => {
    expect(uctScore(0.5, 10, 100, 0.7)).toBeCloseTo(0.5 + 0.7 * Math.sqrt(Math.log(100) / 10), 12);
    expect(uctScore(0.9, 1, 1, 0.7)).toBe(0.9); // ln 1 = 0: no exploration bonus at N = 1
    expect(uctScore(0, 0, 50, 0.7)).toBe(Infinity);
  });

  it('selects on a hand-built tree from the deciding player\'s side', () => {
    // Sums are from player 0's side. Child 0: mean 0.6 over 30; child 1: mean 0.5 over 5; child 2: mean 0.8 over 65.
    const children = [{ visits: 30, sum: 18 }, { visits: 5, sum: 2.5 }, { visits: 65, sum: 52 }];
    const N = 100;
    const c = 0.7;
    const scores0 = children.map((ch) => uctScore(ch.sum / ch.visits, ch.visits, N, c));
    const scores1 = children.map((ch) => uctScore(1 - ch.sum / ch.visits, ch.visits, N, c));
    // Player 0: 0.6 + 0.7 sqrt(ln 100 / 30) = 0.8743, 0.5 + 0.7 sqrt(ln 100 / 5) = 1.1718, 0.8 + 0.7 sqrt(ln 100 / 65) = 0.9863.
    expect(scores0.map((s) => Number(s.toFixed(4)))).toEqual([0.8743, 1.1718, 0.9863]);
    expect(selectChild({ player: 0, visits: N, children }, 0, c)).toBe(1);
    // With c = 0.1 exploitation wins: child 2 (0.8 + 0.0266) over child 1 (0.5 + 0.0960).
    expect(selectChild({ player: 0, visits: N, children }, 0, 0.1)).toBe(2);
    // Player 1 decides at this node: its means are 0.4, 0.5, 0.2, so child 1 is still first (1.1718) and child 0 next.
    expect(scores1.map((s) => Number(s.toFixed(4)))).toEqual([0.6743, 1.1718, 0.3863]);
    expect(selectChild({ player: 1, visits: N, children }, 0, c)).toBe(1);
    expect(selectChild({ player: 1, visits: N, children }, 0, 0.1)).toBe(1);
    expect(selectChild({ player: 1, visits: N, children: [children[0] as never, children[2] as never] }, 0, 0.1)).toBe(0);
    // An unvisited child is taken first.
    expect(selectChild({ player: 0, visits: N, children: [...children, { visits: 0, sum: 0 }] }, 0, c)).toBe(3);
  });

  it('maps the evaluation to [0, 1] and finished games to 1, 0 or one half', () => {
    expect(squash(0)).toBe(0.5);
    expect(squash(1e9)).toBe(1);
    expect(squash(-16)).toBeCloseTo(1 / (1 + Math.E), 12);
    const s = newGame('deckA', 'deckB', 1, 0);
    s.result = { winner: 1, reason: 'test' };
    expect(leafValue(s, 1)).toBe(1);
    expect(leafValue(s, 0)).toBe(0);
    s.result = { winner: 'draw', reason: 'test' };
    expect(leafValue(s, 0)).toBe(0.5);
  });
});

describe('scripted spots', () => {
  it('lethal on board: the top line is a lethal attack and visits concentrate on the lethal attacks', () => {
    const { view: v } = loadSpot(LETHAL_SPOT);
    const r = searchView(v, { samples: 4, iterations: 200, seed: 3 });
    const lethal = lineOf(r, (l) => l.text.includes('Bloodtithe Harvester (A) -> player B'));
    const lethalVisits = lethal.reduce((a, l) => a + l.visits, 0);
    console.log(`lethal spot (${r.rollouts} rollouts, ${r.samples} samples):\n  ${r.lines.map(fmt).join('\n  ')}`);
    expect(r.rollouts).toBe(800);
    expect(r.lines.length).toBe(4); // no attack, Harvester, Shaman, both
    expect(lethal.length).toBe(2);
    expect(lethal.map((l) => l.key)).toContain(r.lines[0]?.key);
    expect(lethalVisits / r.rollouts).toBeGreaterThan(0.6);
    for (const l of lethal) {
      expect(l.win.k).toBe(l.win.n);
      expect(l.mean).toBe(1);
    }
    const none = lineOf(r, (l) => l.text === 'A: no attack')[0] as TopLine;
    expect(none.visits).toBeLessThan((lethal[0] as TopLine).visits);
  });

  it('hold up Fatal Push against a known haste threat: passing is preferred to tapping out for Duress', () => {
    const { view: v } = loadSpot(HOLD_PUSH_SPOT);
    const r = searchView(v, { samples: 4, iterations: 400, seed: 3 });
    console.log(`hold-Push spot (${r.rollouts} rollouts, ${r.samples} samples):\n  ${r.lines.map(fmt).join('\n  ')}`);
    const pass = lineOf(r, (l) => l.text === 'A: pass priority')[0] as TopLine;
    const duress = lineOf(r, (l) => l.text.startsWith('A: cast Duress'))[0] as TopLine;
    expect(r.lines.length).toBe(2);
    expect(r.lines[0]?.key).toBe(pass.key);
    expect(pass.visits).toBeGreaterThan(duress.visits);
    // The mean-value intervals separate: holding Push is better in these samples.
    expect(pass.meanLo).toBeGreaterThan(duress.meanHi);
    // After Duress the principal variation is the Challenger cast and its attack.
    expect(duress.pv[0]?.text).toBe('B: cast Emberheart Challenger');
  });
});

describe('search mechanics', () => {
  it('journal replay from the root equals stored node states (copy mode at expansion)', () => {
    const { view: v } = loadSpot(HOLD_PUSH_SPOT);
    const a = searchView(v, { samples: 2, iterations: 150, seed: 11 });
    const b = searchView(v, { samples: 2, iterations: 150, seed: 11, storeCap: 1 });
    expect(a.rollouts).toBe(300);
    expect(strip(b)).toEqual(strip(a));
  });

  it('is deterministic for a seed, differs for another seed, and gives the same result on 2 worker threads', async () => {
    const { view: v } = loadSpot(LETHAL_SPOT);
    const opts = { samples: 4, iterations: 60, seed: 5 };
    const a = searchView(v, opts);
    const b = searchView(v, opts);
    const c = searchView(v, { ...opts, seed: 6 });
    const w = await searchViewParallel(v, opts, 2);
    expect(strip(b)).toEqual(strip(a));
    expect(strip(c)).not.toEqual(strip(a));
    expect(strip(w)).toEqual(strip(a));
  }, 120_000);

  it('aggregates root moves across samples by key, summing visits and wins', () => {
    const t = (key: string, visits: number, sum: number, wins: number) => ({ key, text: key, mover: 0 as PlayerId, visits, sum, sumSq: sum, wins, children: [] });
    const s = (index: number, kids: ReturnType<typeof t>[]) => ({
      index, decider: 0 as PlayerId, iterations: 10, rollouts: 10, rolloutMoves: 0, storedStates: 1, seconds: 0,
      root: { key: 'root', text: 'root', mover: null, visits: 10, sum: 5, sumSq: 5, wins: 5, children: kids },
    });
    const r = aggregate([s(1, [t('x', 4, 4, 4), t('y', 6, 1, 1)]), s(0, [t('y', 7, 2, 2), t('x', 3, 3, 3)])],
      { perspective: 0, viewer: 0, seconds: 0, options: { samples: 2, iterations: 10, ms: null, rollout: 'truncated', rolloutTurns: 2, c: 0.7, seed: 1 } });
    expect(r.lines.map((l) => [l.key, l.visits, l.win.k, l.samples])).toEqual([['y', 13, 3, 2], ['x', 7, 7, 2]]);
    expect(r.total.visits).toBe(20);
  });
});

// ---- the agent never reads the real state --------------------------------------------------------

/**
 * A proxy of the real state whose hidden fields throw on access: the game-private fields, both
 * libraries, the opponent's hand, and every object hidden from the viewer.
 */
function sealed(real: GameState, viewer: PlayerId): GameState {
  const hidden = new Set(hiddenFrom(real, viewer).flat());
  for (const zone of ['library'] as const) for (const id of real.zones[zone][viewer]) hidden.add(id);
  const boom = (what: string): never => { throw new Error(`sealed state: read ${what}`); };
  const PRIVATE = new Set(['seed', 'nextId', 'journal', 'log', 'events', 'pending', 'pendingTriggers']);
  const objects = new Proxy(real.objects, { get: (t, k) => (typeof k === 'string' && hidden.has(Number(k)) ? boom(`objects[${k}]`) : Reflect.get(t, k)) });
  const hand = new Proxy(real.zones.hand, { get: (t, k) => (k === String(1 - viewer) ? boom('the opponent\'s hand') : Reflect.get(t, k)) });
  const zones = new Proxy(real.zones, { get: (t, k) => (k === 'library' ? boom('a library') : k === 'hand' ? hand : Reflect.get(t, k)) });
  return new Proxy(real, {
    get: (t, k) => (typeof k === 'string' && PRIVATE.has(k) ? boom(k) : k === 'objects' ? objects : k === 'zones' ? zones : Reflect.get(t, k)),
  });
}

/** Mid-operation choices (the view cannot be determinized there; the agent falls back to Decision.sample). */
const MID_OP = new Set(['pickObjects', 'pickIndex', 'pickTargets', 'dieReplacement']);

/**
 * Plays games of an MCTS agent against greedy (MCTS alternates A and B) until 40 searched decisions
 * were made with the real state sealed (at most 8 games), checking every move is legal and that the
 * seal is live (greedy, which reads Decision.sample, trips it). Returns the counts and summed stats.
 */
function sealedGames(label: string, make: (g: number) => MctsAgent): { sealedDecisions: number; probeThrew: number; games: number; stats: MctsStats } {
  let sealedDecisions = 0;
  let probeThrew = 0;
  let games = 0;
  const total: MctsStats = { searched: 0, fallbacks: 0, forced: 0, pregame: 0, skipped: 0, overrides: 0, searchSeconds: 0, rollouts: 0 };
  const log: string[] = [];
  for (let g = 0; sealedDecisions < 40 && g < 8; g++, games++) {
    const s = newGame('deckA', 'deckB', 424242 + g, 'random');
    const seat = (g % 2) as PlayerId;
    const mcts = make(g);
    const agents: Agent[] = seat === 0 ? [mcts, greedyAgent(10 + g)] : [greedyAgent(10 + g), mcts];
    let moves = 0;
    while (!s.result) {
      const p = decider(s);
      if (p === null) break;
      const legal = legalMoves(s, p);
      let d: Decision;
      const st = s;
      if (p === seat && !(s.pendingChoice && MID_OP.has(s.pendingChoice.kind))) {
        const v = view(s, p);
        const box = sealed(s, p);
        d = { player: p, moves: legal, view: () => v, sample: (r) => sampleHidden(box, p, r) };
        // L1: the seal is live; the greedy agent (which reads Decision.sample) trips it.
        if (legal.length > 1 && probeThrew < 3) {
          expect(() => greedyAgent(1).choose(d)).toThrow(/sealed state/);
          probeThrew++;
        }
        if (legal.length > 1) sealedDecisions++;
      } else d = { player: p, moves: legal, view: () => view(st, p), sample: (r) => sampleHidden(st, p, r) };
      const m: Move = (agents[p] as Agent).choose(d);
      expect(legal).toContain(m);
      applyMoveInPlace(s, m);
      if (++moves > 5000) throw new Error('game did not end');
    }
    expect(s.result).not.toBeNull();
    const ms = mcts.stats();
    for (const k of Object.keys(total) as (keyof MctsStats)[]) total[k] += ms[k];
    log.push(`game ${g}: mcts as ${seat === 0 ? 'A' : 'B'}, ${moves} moves, winner ${String(s.result?.winner)}, stats ${JSON.stringify({ ...ms, searchSeconds: undefined })}`);
  }
  console.log(`sealed games (${label}): ${games} games, ${sealedDecisions} searched decisions with the state sealed\n  ${log.join('\n  ')}`);
  return { sealedDecisions, probeThrew, games, stats: total };
}

describe('information boundary', () => {
  it('type level: the analyzer takes a PlayerView; a GameState is rejected', () => {
    expectTypeOf<Parameters<MctsAgent['analyze']>[0]>().toEqualTypeOf<PlayerView>();
    expectTypeOf<Parameters<typeof searchView>[0]>().toEqualTypeOf<PlayerView>();
    const agent = mctsAgent(1, { samples: 1, iterations: 1 });
    const s = newGame('deckA', 'deckB', 1, 0);
    // @ts-expect-error a GameState is not a PlayerView
    expect(() => agent.analyze(s)).toThrow();
  });

  it('run time: games against greedy with the real state sealed at every searched decision', () => {
    // The plain UCT agent (mode 'uct', the Phase 4 default before PLAN.md D27); the validated default is the next test.
    const r = sealedGames('uct agent', (g) => mctsAgent(9 + g, { mode: 'uct', samples: 2, iterations: 12 }));
    expect(r.probeThrew).toBeGreaterThan(0);
    expect(r.sealedDecisions).toBeGreaterThanOrEqual(40);
  }, 300_000);

  it('run time: the acceptance configuration (margin and override path) with the real state sealed', () => {
    // The agent of docs/ACCEPTANCE.md (PLAN.md D25), parsed from the acceptance flags: greedy rollouts,
    // root pruning to 3, 8 samples x 3 iterations, skip margin 3, paired override at 2 standard errors
    // with a minimum gain of 0.02. Its margin and override step scores moves with greedy on a sample
    // the agent deals itself from the view; the seal shows that step never reads Decision.sample.
    const acc = parseMatchArgs(['--policy', 'greedy', '--prune', '3', '--samples', '8', '--iterations', '3', '--margin', '3', '--override', '2', '--min-gain', '0.02']).mcts;
    const r = sealedGames('acceptance agent', (g) => mctsAgent(9 + g, acc));
    expect(r.probeThrew).toBeGreaterThan(0);
    expect(r.sealedDecisions).toBeGreaterThanOrEqual(40);
    // The margin step ran on every searched or skipped decision; both outcomes occurred under the seal.
    expect(r.stats.skipped).toBeGreaterThan(0);
    expect(r.stats.searched).toBeGreaterThan(0);
  }, 600_000);

  it('the agent maps the searched root move back to a legal move by key', () => {
    const { view: v } = loadSpot(LETHAL_SPOT);
    const agent = mctsAgent(4, { mode: 'uct', samples: 2, iterations: 60 });
    const r = agent.analyze(v);
    const best = r.lines[0] as TopLine;
    expect(best.move).not.toBeNull();
    const known = new Set(Object.keys(v.objects).map(Number));
    expect(moveKey(best.move as Move, known, v.objects)).toBe(best.key);
    expect(seedRng(1)).toHaveLength(4);
  });
});
