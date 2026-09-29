// Auto-pass cache correctness (T1.5, docs/PERF.md): hasAction caches its timing-free work per
// content tick (mutate.ts getContentTick), which writes to priority, passes, step, phaseQueue,
// stepPriority and the event buffer do not bump. At every decision of random games this test walks
// the state through every step and both priority holders by writing only those timing fields (the
// writes the advance loop makes between two auto-pass checks), and compares the cached answer with
// a fresh one on a clone (no cache) and with the full move list. Prints how many comparisons it
// made (L2).
import { describe, expect, it } from 'vitest';
import { given, id1 } from '../helpers.js';
import { randomAgent } from '../../agents/random.js';
import { applyMoveInPlace, cloneState } from '../../engine/apply.js';
import { decider, hasAction, legalMoves } from '../../engine/moves.js';
import { newGame } from '../../engine/setup.js';
import {
  addCounter, addPoolEntry, drainEvents, getContentTick, invalidateMemo, pushEvent, pushZone, removeZone, setField, setPlayer, setTop,
} from '../../engine/mutate.js';
import type { GameState, PlayerId, Step } from '../../engine/types.js';
import { agentSeedsFor, poolDecks, type PoolName } from '../../tools/fuzz.js';

const STEPS: Step[] = ['upkeep', 'draw', 'main1', 'beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat', 'main2', 'end'];

function compareAt(state: GameState): number {
  const saved = { step: state.step, priority: state.priority, stepPriority: state.stepPriority, passes: state.passes };
  let n = 0;
  try {
    for (const step of STEPS) {
      for (const p of [0, 1] as PlayerId[]) {
        // Timing fields only, written directly: they are exactly the fields that do not bump the tick.
        state.step = step;
        state.priority = p;
        state.stepPriority = true;
        const cached = hasAction(state, p);
        const clone = cloneState(state);
        const fresh = hasAction(clone, p);
        const full = legalMoves(clone, p).some((m) => m.type !== 'pass');
        if (cached !== fresh || fresh !== full) {
          throw new Error(`auto-pass mismatch at turn ${state.turn} step ${step} player ${p}: cached ${cached}, fresh ${fresh}, full ${full}`);
        }
        n++;
      }
    }
  } finally {
    state.step = saved.step;
    state.priority = saved.priority;
    state.stepPriority = saved.stepPriority;
    state.passes = saved.passes;
  }
  return n;
}

function run(pool: PoolName, games: number, seed0: number): { states: number; comparisons: number } {
  const [a, b] = poolDecks(pool);
  let states = 0;
  let comparisons = 0;
  for (let g = 0; g < games; g++) {
    const seed = seed0 + g;
    const [s0, s1] = agentSeedsFor(seed);
    const agents = [randomAgent(s0), randomAgent(s1)] as const;
    const state = newGame(a, b, seed, 'random');
    for (let n = 0; !state.result && n < 5000; n++) {
      const p = decider(state);
      if (p === null) break;
      const moves = legalMoves(state, p);
      applyMoveInPlace(state, agents[p].choose({ player: p, moves, view: () => { throw new Error('unused'); } }));
      if (state.result || state.pendingChoice || state.pregame) continue;
      comparisons += compareAt(state);
      states++;
    }
  }
  return { states, comparisons };
}

describe('auto-pass cache', () => {
  it('the content tick moves on every content write and stays on timing writes and events', () => {
    const s = given({ battlefield: ['Swamp', 'Mountain'], hands: [['Swamp'], []] });
    const swamp = id1(s, 'Swamp');
    const handSwamp = id1(s, 'Swamp', 'hand', 0);
    const bumps: [string, () => void][] = [
      ['object field', () => setField(s, swamp, 'tapped', true)],
      ['object off the battlefield', () => setField(s, handSwamp, 'knownTo', [true, true])],
      ['counter', () => addCounter(s, swamp, 'charge', 1)],
      ['player', () => setPlayer(s, 1, 'life', 19)],
      ['mana pool', () => addPoolEntry(s, 0, { color: 'B' })],
      ['zone', () => { removeZone(s, 'hand', 0, handSwamp); pushZone(s, 'hand', 0, handSwamp); }],
      ['top-level content', () => setTop(s, 'turn', s.turn + 1)],
      ['hand edit', () => invalidateMemo(s)],
    ];
    for (const [what, write] of bumps) {
      const t = getContentTick();
      write();
      expect(getContentTick(), what).toBeGreaterThan(t);
    }
    const t = getContentTick();
    setTop(s, 'priority', 1);
    setTop(s, 'passes', 1);
    setTop(s, 'step', 'end');
    setTop(s, 'phaseQueue', ['cleanup']);
    setTop(s, 'stepPriority', true);
    pushEvent(s, { e: 'step', step: 'end', player: 0 });
    drainEvents(s);
    expect(getContentTick()).toBe(t);
    console.log(`content tick: ${bumps.length} write kinds bump it, 7 timing and event writes do not`);
  });

  it('gives the uncached answer at every step and priority holder of random games (decks, sideboard, extended pools)', () => {
    let states = 0;
    let comparisons = 0;
    for (const [pool, games, seed] of [['decks', 25, 730_001], ['sideboard', 15, 740_001], ['extended', 15, 750_001]] as const) {
      const r = run(pool, games, seed);
      states += r.states;
      comparisons += r.comparisons;
    }
    console.log(`auto-pass check: ${states} states, ${comparisons} comparisons`);
    expect(comparisons).toBeGreaterThan(10_000);
  }, 600_000);
});
