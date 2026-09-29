// Memo correctness (T1.4, docs/PERF.md): the characteristics memo and the classKey memo survive
// many mutations (mutate.ts invalidateFor keeps them across non-characteristic fields and objects
// off the battlefield). After every applyMove of random games, the memoized characteristics,
// classKey, static lists and trigger listener index of every object must equal a fresh computation
// on a clone (a clone has no memo). Prints how many comparisons it made (L2).
import { describe, expect, it } from 'vitest';
import '../helpers.js';
import { randomAgent } from '../../agents/random.js';
import { applyMoveInPlace } from '../../engine/apply.js';
import { decider, legalMoves } from '../../engine/moves.js';
import { newGame } from '../../engine/setup.js';
import { characteristics, classKey, staticAbilities } from '../../engine/statics.js';
import { listenerIndex } from '../../engine/triggers.js';
import type { GameState, ObjId, StaticCategory } from '../../engine/types.js';
import { agentSeedsFor, poolDecks, type PoolName } from '../../tools/fuzz.js';

const CATEGORIES: StaticCategory[] = [
  'allLandsAreSwamps', 'entersTapped', 'dieReplacement', 'cantGainLife', 'enchantedGets', 'ptCda', 'crewBonus', 'damageReplacement',
  'activationRestriction', 'marker', 'graveyardLibraryLock',
];

function snapshot(state: GameState): string {
  const ids = Object.keys(state.objects).map(Number).sort((a, b) => a - b) as ObjId[];
  return JSON.stringify({
    chars: ids.map((id) => characteristics(state, id)),
    keys: ids.map((id) => classKey(state, id)),
    statics: CATEGORIES.map((c) => staticAbilities(state, c).map((r) => [r.sourceId, r.key])),
    listeners: Object.entries(listenerIndex(state)).map(([ev, ls]) => [ev, (ls ?? []).map((l) => [l.sourceId, l.key])]),
  });
}

function run(pool: PoolName, games: number, seed0: number): { states: number; objects: number } {
  const [a, b] = poolDecks(pool);
  let states = 0;
  let objects = 0;
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
      const memoized = snapshot(state);
      const { journal: _j, ...rest } = state;
      const fresh = snapshot(structuredClone(rest) as GameState);
      if (memoized !== fresh) throw new Error(`stale memo: pool ${pool}, seed ${seed}, move ${n}`);
      states++;
      objects += Object.keys(state.objects).length;
    }
  }
  return { states, objects };
}

describe('characteristics and classKey memo', () => {
  it('matches a fresh computation after every move of random games (decks, sideboard, extended pools)', () => {
    let states = 0;
    let objects = 0;
    for (const [pool, games, seed] of [['decks', 40, 700_001], ['sideboard', 30, 710_001], ['extended', 30, 720_001]] as const) {
      const r = run(pool, games, seed);
      states += r.states;
      objects += r.objects;
    }
    console.log(`memo check: ${states} states, ${objects} object comparisons`);
    expect(states).toBeGreaterThan(1000);
  }, 600_000);
});
