// Journal completeness (PLAN.md section 6): 10,000 random primitive operations, each batch undone,
// must leave the state equal to a structuredClone taken before the batch.
import { describe, expect, it } from 'vitest';
import { canon, given } from '../helpers.js';
import {
  addCounter, addEffect, addPoolEntry, allocId, beginJournal, clearField, endJournal, mark, randomInt, removeEffect,
  removePoolEntry, setField, setPlayer, setPool, undoTo,
} from '../../engine/mutate.js';
import { createToken, die, discard, drawCard, exileObj, mill, moveObject, scry1, shuffleLibrary } from '../../engine/zones.js';
import { characteristics } from '../../engine/statics.js';
import { nextInt, seedRng } from '../../engine/rng.js';
import type { GameState, ObjId, PlayerId, RngState } from '../../engine/types.js';

function bigState(): GameState {
  const lib = (n: number): string[] => Array.from({ length: n }, (_, i) => (i % 3 === 0 ? 'Test Bear' : i % 3 === 1 ? 'Swamp' : 'Mountain'));
  return given({
    battlefield: ['Swamp', 'Mountain', 'Test Bear', { card: 'Test Bear', controller: 1 }, { card: 'Mountain', controller: 1 }],
    hands: [['Test Bolt', 'Test Bear', 'Swamp'], ['Mountain', 'Test Bolt']],
    graveyards: [['Test Bolt'], []],
    libraries: [lib(20), lib(20)],
  });
}

const pick = <T>(r: RngState, arr: readonly T[]): T | undefined => (arr.length ? arr[nextInt(r, arr.length)] : undefined);

/** One random primitive or zone operation; returns false when it did nothing. */
function randomOp(state: GameState, r: RngState): boolean {
  const p = nextInt(r, 2) as PlayerId;
  const bf = state.zones.battlefield;
  switch (nextInt(r, 17)) {
    case 0: { const id = pick(r, bf); if (id === undefined) return false; setField(state, id, 'tapped', !state.objects[id]!.tapped); return true; }
    case 1: { const id = pick(r, bf); if (id === undefined) return false; setField(state, id, 'damage', nextInt(r, 5)); return true; }
    case 2: { const id = pick(r, bf); if (id === undefined) return false; addCounter(state, id, 'p1p1', 1 + nextInt(r, 2)); return true; }
    case 3: {
      const id = bf.find((x) => (state.objects[x]!.counters.p1p1 ?? 0) > 0);
      if (id === undefined) return false;
      addCounter(state, id, 'p1p1', -1);
      return true;
    }
    case 4: { const id = pick(r, bf); if (id === undefined) return false; addEffect(state, { eid: allocId(state), kind: 'ptDelta', target: id, p: 1, t: -1, until: 'eot' }); return true; }
    case 5: { const e = pick(r, state.effects); if (!e) return false; removeEffect(state, e.eid); return true; }
    case 6: addPoolEntry(state, p, { color: pick(r, ['B', 'R', 'C'] as const)! }); return true;
    case 7: { const pool = state.players[p].manaPool; if (!pool.length) return false; removePoolEntry(state, p, nextInt(r, pool.length)); return true; }
    case 8: setPool(state, p, []); setPlayer(state, p, 'life', state.players[p].life - 1); return true;
    case 9: return drawCard(state, p) !== null;
    case 10: { const id = pick(r, state.zones.hand[p]); if (id === undefined) return false; discard(state, id); return true; }
    case 11: { const id = pick(r, bf); if (id === undefined) return false; die(state, [id], 'destroy'); return true; }
    case 12: createToken(state, pick(r, ['Blood', 'Treasure', 'GoblinShaman'])!, p); return true;
    case 13: { const id = pick(r, state.zones.graveyard[p]); if (id === undefined) return false; exileObj(state, id); return true; }
    case 14: {
      const id = pick(r, state.zones.hand[p]);
      if (id === undefined) return false;
      moveObject(state, id, 'library', { position: nextInt(r, 2) ? 'bottom' : 'top' });
      return true;
    }
    case 15: {
      const which = nextInt(r, 4);
      if (which === 0) mill(state, p, 1);
      else if (which === 1) scry1(state, p, nextInt(r, 2) === 1);
      else if (which === 2) shuffleLibrary(state, p);
      else randomInt(state, 10);
      return true;
    }
    default: {
      const id = pick(r, bf);
      if (id === undefined) return false;
      if (state.objects[id]!.attachedTo !== undefined) clearField(state, id, 'attachedTo');
      else setField(state, id, 'attachedTo', pick(r, bf)!);
      return true;
    }
  }
}

describe('journal and undoTo', () => {
  it('10,000 random primitive ops undone equal the clone taken before', () => {
    const state = bigState();
    beginJournal(state);
    const r = seedRng(2026);
    let ops = 0;
    let batches = 0;
    let committed = 0;
    while (ops < 10000) {
      const before = canon(structuredClone(state));
      const m = mark(state);
      const n = 1 + nextInt(r, 5);
      for (let i = 0; i < n; i++) if (randomOp(state, r)) ops++;
      const warm = state.zones.battlefield[0];
      if (warm !== undefined) characteristics(state, warm); // warm the memo so undo must invalidate it
      undoTo(state, m);
      batches++;
      const after = canon(structuredClone(state));
      if (after !== before) throw new Error(`state differs after undo in batch ${batches} (ops so far ${ops})`);
      // Every 25th batch keep a few ops so the walk visits varied states; reset the journal.
      if (batches % 25 === 0) {
        for (let i = 0; i < 3; i++) randomOp(state, r);
        committed++;
        endJournal(state);
        beginJournal(state);
        if (state.zones.library[0].length < 5 || state.zones.library[1].length < 5) {
          // refill by moving graveyard cards back so draws keep working
          for (const pl of [0, 1] as const) for (const id of [...state.zones.graveyard[pl]]) moveObject(state, id, 'library');
        }
      }
    }
    console.log(`journal completeness: ${ops} primitive ops in ${batches} batches undone and compared (${committed} commits)`);
    expect(ops).toBeGreaterThanOrEqual(10000);
    expect(batches).toBeGreaterThan(1000);
    // Its own time limit: about 8.5 s alone, 61 to 82 s in the full parallel suite (two structuredClone
    // plus canon per batch, about 3,300 batches). The checks above are unchanged; only the wall-clock
    // budget differs from the suite's 60 s default (vitest.config.ts).
  }, 300_000);

  it('the comparison catches a mutation that skipped the journal (the check can fail)', () => {
    const state = bigState();
    beginJournal(state);
    const before = canon(structuredClone(state));
    const m = mark(state);
    const id = state.zones.battlefield[0] as ObjId;
    setField(state, id, 'damage', 2);
    state.objects[id]!.tapped = true; // bypasses mutate.ts: no inverse recorded
    undoTo(state, m);
    expect(canon(structuredClone(state))).not.toBe(before);
  });

  it('undo invalidates the characteristics memo', () => {
    const state = bigState();
    beginJournal(state);
    const bear = state.zones.battlefield[2] as ObjId;
    expect(characteristics(state, bear).power).toBe(2);
    const m = mark(state);
    addCounter(state, bear, 'p1p1', 3);
    expect(characteristics(state, bear).power).toBe(5);
    undoTo(state, m);
    expect(characteristics(state, bear).power).toBe(2);
  });

  it('mark and undoTo refuse to run with the journal off', () => {
    const state = bigState();
    expect(() => mark(state)).toThrow();
    expect(() => undoTo(state, 0)).toThrow();
  });
});
