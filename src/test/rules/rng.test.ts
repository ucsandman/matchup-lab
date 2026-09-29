import { describe, expect, it } from 'vitest';
import { cloneRng, jump, nextFloat, nextInt, nextU32, seedRng, shuffle } from '../../engine/rng.js';
import type { RngState } from '../../engine/types.js';

describe('xoshiro128**', () => {
  it('matches the reference known-answer vector for state [1,2,3,4]', () => {
    // Reference output of xoshiro128** (Blackman and Vigna) from state {1, 2, 3, 4}, as used by the
    // rand_xoshiro crate test suite.
    const s: RngState = [1, 2, 3, 4];
    const got = Array.from({ length: 10 }, () => nextU32(s));
    expect(got).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597, 4258142804]);
  });

  it('is deterministic per seed and differs across seeds, including seeds that differ above bit 31', () => {
    const a = seedRng(12345);
    const b = seedRng(12345);
    const seqA = Array.from({ length: 100 }, () => nextU32(a));
    const seqB = Array.from({ length: 100 }, () => nextU32(b));
    expect(seqA).toEqual(seqB);
    expect(seedRng(1)).not.toEqual(seedRng(2));
    expect(seedRng(1)).not.toEqual(seedRng(1 + 2 ** 32));
    expect(seedRng(0).some((w) => w !== 0)).toBe(true);
    for (const w of seedRng(-7)) expect(w >>> 0).toBe(w);
  });

  it('nextInt stays in range and is roughly uniform; nextFloat is in [0, 1)', () => {
    const s = seedRng(99);
    const counts = [0, 0, 0, 0, 0, 0];
    const n = 60000;
    for (let i = 0; i < n; i++) counts[nextInt(s, 6)]! += 1;
    for (const c of counts) expect(Math.abs(c - n / 6)).toBeLessThan(600); // about 6 sigma
    for (let i = 0; i < 1000; i++) {
      const f = nextFloat(s);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    expect(() => nextInt(s, 0)).toThrow();
  });

  it('jump() gives a deterministic, separate stream', () => {
    const base = seedRng(7);
    const j1 = cloneRng(base);
    const j2 = cloneRng(base);
    jump(j1);
    jump(j2);
    expect(j1).toEqual(j2);
    const plain = cloneRng(base);
    const first = new Set(Array.from({ length: 2000 }, () => nextU32(plain)));
    const jumped = Array.from({ length: 2000 }, () => nextU32(j1));
    const overlap = jumped.filter((x) => first.has(x)).length;
    expect(overlap).toBeLessThan(5); // chance collisions only
  });

  it('shuffle is a deterministic permutation', () => {
    const arr = Array.from({ length: 60 }, (_, i) => i);
    const a = shuffle(seedRng(3), [...arr]);
    const b = shuffle(seedRng(3), [...arr]);
    const c = shuffle(seedRng(4), [...arr]);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect([...a].sort((x, y) => x - y)).toEqual(arr);
  });
});
