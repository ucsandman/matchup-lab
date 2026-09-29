// Interval math against published values (PLAN.md section 7, Phase 3 CI tests; D18).
import { describe, expect, it } from 'vitest';
import {
  fmtQuantile, normalCdf, quantileInterval, sequentialCompare, separated, tCdf, tInterval, tQuantile, twoProportionZ, wilson,
} from '../../sim/stats.js';

describe('Wilson score interval', () => {
  it('50 of 100 is 0.4038 to 0.5962', () => {
    const w = wilson(50, 100);
    expect(w.est).toBe(0.5);
    expect(w.lo).toBeCloseTo(0.4038, 4);
    expect(w.hi).toBeCloseTo(0.5962, 4);
  });
  it('0 of 10 is 0 to 0.2775; 10 of 10 is 0.7225 to 1', () => {
    expect(wilson(0, 10).lo).toBe(0);
    expect(wilson(0, 10).hi).toBeCloseTo(0.2775, 4);
    expect(wilson(10, 10).lo).toBeCloseTo(0.7225, 4);
    expect(wilson(10, 10).hi).toBe(1);
  });
  it('0 of n has the closed form hi = z^2 / (n + z^2)', () => {
    const z2 = 1.959963984540054 ** 2;
    for (const n of [1, 7, 250]) expect(wilson(0, n).hi).toBeCloseTo(z2 / (n + z2), 12);
  });
  it('rejects bad counts', () => {
    expect(() => wilson(5, 4)).toThrow();
    expect(() => wilson(-1, 4)).toThrow();
  });
});

describe('Student t', () => {
  it('t(0.975) matches the table: df 1, 4, 10, 30, 120', () => {
    expect(tQuantile(0.975, 1)).toBeCloseTo(12.7062, 3);
    expect(tQuantile(0.975, 4)).toBeCloseTo(2.7764, 4);
    expect(tQuantile(0.975, 10)).toBeCloseTo(2.2281, 4);
    expect(tQuantile(0.975, 30)).toBeCloseTo(2.0423, 4);
    expect(tQuantile(0.975, 120)).toBeCloseTo(1.9799, 4);
    expect(tQuantile(0.995, 4)).toBeCloseTo(4.6041, 4);
    expect(tQuantile(0.025, 4)).toBeCloseTo(-2.7764, 4);
  });
  it('CDF is symmetric and 0.5 at 0', () => {
    expect(tCdf(0, 7)).toBeCloseTo(0.5, 12);
    expect(tCdf(1.5, 7) + tCdf(-1.5, 7)).toBeCloseTo(1, 12);
  });
  it('interval for n = 5: 1..5 gives 3 +- 2.7764 x 1.5811 / root 5', () => {
    const m = tInterval([1, 2, 3, 4, 5]);
    expect(m.n).toBe(5);
    expect(m.mean).toBe(3);
    expect(m.sd).toBeCloseTo(1.5811, 4);
    expect(m.lo).toBeCloseTo(3 - 2.7764 * 1.5811 / Math.sqrt(5), 3);
    expect(m.hi).toBeCloseTo(3 + 2.7764 * 1.5811 / Math.sqrt(5), 3);
  });
  it('n < 2 has no interval', () => {
    expect(Number.isNaN(tInterval([4]).lo)).toBe(true);
    expect(tInterval([]).n).toBe(0);
  });
});

describe('order-statistic interval', () => {
  it('formatting: a quantile below 95 percent coverage is not printed as a number', () => {
    const small = quantileInterval([5, 1, 4, 2, 3], 0.5);
    expect(fmtQuantile(small)).toBe('not shown [95% CI undefined, n=5 is too few for a 95% order-statistic interval]');
    const p95 = quantileInterval(Array.from({ length: 30 }, (_, i) => i + 1), 0.95);
    expect(p95.coverage).toBeLessThan(0.95);
    expect(fmtQuantile(p95, { unit: 'games' })).toMatch(/^not shown \[95% CI undefined, n=30 games/);
    const big = quantileInterval(Array.from({ length: 100 }, (_, i) => i + 1), 0.5);
    expect(fmtQuantile(big, { digits: 2, after: ' games/sec/core', unit: 'blocks', note: 'one worker thread per block' }))
      .toBe('50.00 games/sec/core [96.5% CI 40.00-61.00, n=100 blocks, one worker thread per block]');
    expect(fmtQuantile(quantileInterval([], 0.5))).toMatch(/^not shown \[95% CI undefined, n=0/);
  });
  it('median of 1..100: ranks 40 and 61, coverage 0.9648', () => {
    const q = quantileInterval(Array.from({ length: 100 }, (_, i) => i + 1), 0.5);
    expect(q.est).toBe(50);
    expect(q.lo).toBe(40);
    expect(q.hi).toBe(61);
    expect(q.coverage).toBeCloseTo(0.9648, 4);
  });
  it('n = 5 median: min to max with coverage 0.9375 (below 95 percent, reported as such)', () => {
    const q = quantileInterval([5, 1, 4, 2, 3], 0.5);
    expect([q.est, q.lo, q.hi]).toEqual([3, 1, 5]);
    expect(q.coverage).toBeCloseTo(0.9375, 10);
  });
  it('coverage is at least 0.95 once n allows it', () => {
    for (const n of [10, 37, 200, 1000]) {
      expect(quantileInterval(Array.from({ length: n }, (_, i) => i), 0.5).coverage).toBeGreaterThanOrEqual(0.95);
    }
    // p95 needs n large enough that the top order statistic is not always required.
    for (const n of [200, 1000]) {
      expect(quantileInterval(Array.from({ length: n }, (_, i) => i), 0.95).coverage).toBeGreaterThanOrEqual(0.95);
    }
  });
});

describe('two-proportion z-test', () => {
  it('60/100 vs 40/100: z = 2.828, p = 0.00468', () => {
    const t = twoProportionZ(60, 100, 40, 100);
    expect(t.z).toBeCloseTo(2.8284, 4);
    expect(t.p).toBeCloseTo(0.00468, 5);
  });
  it('equal rates: z = 0, p = 1', () => {
    const t = twoProportionZ(30, 60, 50, 100);
    expect(t.z).toBeCloseTo(0, 12);
    expect(t.p).toBeCloseTo(1, 6);
  });
  it('normal CDF at 1.96 is 0.975', () => {
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 6);
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
  });
});

describe('sequential stopping', () => {
  it('stops early when the intervals separate', async () => {
    // Arm A wins 9 of 10, arm B 1 of 10, every batch.
    const r = await sequentialCompare(() => ({ a: [9, 10], b: [1, 10] }), { batch: 10, maxN: 1000 });
    expect(r.verdict).toBe('A');
    expect(separated(r.a, r.b)).toBe(true);
    expect(r.a.n).toBeLessThan(1000);
    console.log(`sequential early stop after ${r.looks} looks: A n=${r.a.n}, B n=${r.b.n}`);
  });
  it('returns too close to call at max n, with both intervals', async () => {
    const r = await sequentialCompare(() => ({ a: [5, 10], b: [5, 10] }), { batch: 10, maxN: 200 });
    expect(r.verdict).toBe('too close to call');
    expect(r.a.n).toBe(200);
    expect(r.b.n).toBe(200);
    expect(separated(r.a, r.b)).toBe(false);
  });
  it('B wins when B is higher', async () => {
    const r = await sequentialCompare(() => ({ a: [2, 20], b: [18, 20] }), { batch: 20, maxN: 500 });
    expect(r.verdict).toBe('B');
  });
});
