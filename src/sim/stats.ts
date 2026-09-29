// Interval estimates for simulation output (PLAN.md section 6, Parallel simulation; D18). Every
// number shown to a user carries n and a 95 percent interval:
//  - proportions: Wilson score interval;
//  - means: Student t interval (mean +- t(0.975, n-1) x s / root n), t from the exact CDF
//    (regularized incomplete beta) inverted by bisection;
//  - medians and percentiles: distribution-free order-statistic interval from the binomial;
//  - two proportions: pooled two-proportion z-test with a two-sided p-value;
//  - sequential stopping: stop when two Wilson intervals separate, or at max n with a
//    'too close to call' verdict. Repeated looks make the effective error rate higher than 5
//    percent; the verdict is a stopping rule, not a significance test.
// No runtime dependencies; pure functions.

export interface Proportion { k: number; n: number; est: number; lo: number; hi: number }
export interface MeanCI { n: number; mean: number; sd: number; lo: number; hi: number; t: number }
export interface QuantileCI {
  n: number; q: number; est: number; lo: number; hi: number;
  /** Exact coverage of [lo, hi] under the binomial (at least 0.95 when n allows it). */
  coverage: number;
}

const Z95 = 1.959963984540054;

/** Wilson score interval for k successes in n trials. n = 0 gives est NaN and [0, 1]. */
export function wilson(k: number, n: number, z = Z95): Proportion {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || n < 0 || k > n) throw new Error(`wilson: bad counts ${k}/${n}`);
  if (n === 0) return { k, n, est: NaN, lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  // Exact ends at k = 0 and k = n (the closed forms are 0 and 1; floating point misses by an ulp).
  return { k, n, est: p, lo: k === 0 ? 0 : Math.max(0, center - half), hi: k === n ? 1 : Math.min(1, center + half) };
}

// ---- special functions ------------------------------------------------------------------------

/** ln Gamma(x) for x > 0 (Lanczos, g = 7, 9 terms; about 15 significant digits). */
export function lnGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  const xx = x - 1;
  let a = c[0] as number;
  const t = xx + 7.5;
  for (let i = 1; i < 9; i++) a += (c[i] as number) / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta (modified Lentz). */
function betacf(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbt = lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const bt = Math.exp(lbt);
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Student t CDF with df degrees of freedom. */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * incBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** Student t quantile (inverse CDF) by bisection on the exact CDF; |error| < 1e-10. */
export function tQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) throw new Error(`tQuantile: p must be in (0, 1), got ${p}`);
  if (!(df > 0)) throw new Error(`tQuantile: df must be positive, got ${df}`);
  if (p === 0.5) return 0;
  if (p < 0.5) return -tQuantile(1 - p, df);
  let lo = 0;
  let hi = 1;
  while (tCdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Complementary error function (Chebyshev fit, Numerical Recipes erfcc; fractional error below 1.2e-7). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418
    + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587
    + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

// ---- means ------------------------------------------------------------------------------------

/** Student t interval for the mean. n < 2 gives lo = hi = NaN (no spread estimate). */
export function tInterval(values: readonly number[], level = 0.95): MeanCI {
  const n = values.length;
  if (n === 0) return { n, mean: NaN, sd: NaN, lo: NaN, hi: NaN, t: NaN };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  if (n < 2) return { n, mean, sd: NaN, lo: NaN, hi: NaN, t: NaN };
  let ss = 0;
  for (const v of values) ss += (v - mean) * (v - mean);
  const sd = Math.sqrt(ss / (n - 1));
  const t = tQuantile(1 - (1 - level) / 2, n - 1);
  const half = (t * sd) / Math.sqrt(n);
  return { n, mean, sd, lo: mean - half, hi: mean + half, t };
}

// ---- order statistics -------------------------------------------------------------------------

/** Binomial(n, q) pmf for i = 0..n, computed in log space (stable for large n). */
function binomPmf(n: number, q: number): Float64Array {
  const out = new Float64Array(n + 1);
  if (q <= 0) { out[0] = 1; return out; }
  if (q >= 1) { out[n] = 1; return out; }
  const lnN = lnGamma(n + 1);
  const lq = Math.log(q);
  const l1q = Math.log(1 - q);
  for (let i = 0; i <= n; i++) out[i] = Math.exp(lnN - lnGamma(i + 1) - lnGamma(n - i + 1) + i * lq + (n - i) * l1q);
  return out;
}

/**
 * Distribution-free interval for the q-quantile of a sample: [x(l), x(u)] (1-based order
 * statistics) with P(x(l) <= xi_q <= x(u)) = sum_{i=l}^{u-1} C(n,i) q^i (1-q)^(n-i) >= level.
 * l and u are the equal-tailed choice. When n is too small for the level, the interval is
 * [min, max] and 'coverage' says what it achieves (n = 5, median: 0.9375).
 */
export function quantileInterval(values: readonly number[], q: number, level = 0.95): QuantileCI {
  const n = values.length;
  if (!(q > 0 && q < 1)) throw new Error(`quantileInterval: q must be in (0, 1), got ${q}`);
  if (n === 0) return { n, q, est: NaN, lo: NaN, hi: NaN, coverage: 0 };
  const x = [...values].sort((a, b) => a - b);
  const at = (i: number): number => x[Math.min(n, Math.max(1, i)) - 1] as number;
  // Point estimate: the order statistic of rank ceil(n q) (type 1 sample quantile).
  const est = at(Math.max(1, Math.ceil(n * q)));
  const pmf = binomPmf(n, q);
  const alpha = (1 - level) / 2;
  // cdf[i] = P(B <= i).
  const cdf = new Float64Array(n + 1);
  let acc = 0;
  for (let i = 0; i <= n; i++) { acc += pmf[i] as number; cdf[i] = acc; }
  // l: largest rank with P(B <= l-1) <= alpha; u: smallest rank with P(B <= u-1) >= 1 - alpha.
  let l = 1;
  for (let r = 1; r <= n; r++) if ((cdf[r - 1] as number) <= alpha) l = r;
  let u = n;
  for (let r = n; r >= 1; r--) if ((cdf[r - 1] as number) >= 1 - alpha) u = r;
  if (u < l) u = l;
  // x(l) <= xi iff B >= l; x(u) >= xi iff B <= u - 1 (B = observations below xi).
  const coverage = (cdf[u - 1] as number) - (cdf[l - 1] as number);
  return { n, q, est, lo: at(l), hi: at(u), coverage: Math.min(1, coverage) };
}

// ---- two proportions --------------------------------------------------------------------------

export interface ZTest { z: number; p: number; diff: number; a: Proportion; b: Proportion }

/** Pooled two-proportion z-test, two-sided p-value. */
export function twoProportionZ(k1: number, n1: number, k2: number, n2: number): ZTest {
  const a = wilson(k1, n1);
  const b = wilson(k2, n2);
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const pool = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
  const diff = p1 - p2;
  if (se === 0) return { z: 0, p: diff === 0 ? 1 : 0, diff, a, b };
  const z = diff / se;
  return { z, p: Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))), diff, a, b };
}

// ---- sequential stopping ----------------------------------------------------------------------

export type SeqVerdict = 'A' | 'B' | 'too close to call';

/** True when the two intervals do not overlap. */
export function separated(a: Proportion, b: Proportion): boolean {
  return a.lo > b.hi || b.lo > a.hi;
}

export interface SeqResult { verdict: SeqVerdict; a: Proportion; b: Proportion; looks: number }

/**
 * Sequential comparison of two proportions: draws batches until the two Wilson intervals separate
 * (the higher one wins) or both arms reach maxN (verdict 'too close to call', both intervals kept
 * for printing). draw(batch) returns the successes and trials of each arm for one batch.
 */
export async function sequentialCompare(
  draw: (batch: number, look: number) => Promise<{ a: [number, number]; b: [number, number] }> | { a: [number, number]; b: [number, number] },
  opts: { batch: number; maxN: number; minN?: number },
): Promise<SeqResult> {
  let ka = 0, na = 0, kb = 0, nb = 0;
  let looks = 0;
  const minN = opts.minN ?? opts.batch;
  for (;;) {
    const left = opts.maxN - Math.min(na, nb);
    const r = await draw(Math.min(opts.batch, Math.max(1, left)), looks);
    looks++;
    ka += r.a[0]; na += r.a[1]; kb += r.b[0]; nb += r.b[1];
    const a = wilson(ka, na);
    const b = wilson(kb, nb);
    if (na >= minN && nb >= minN && separated(a, b)) return { verdict: a.est > b.est ? 'A' : 'B', a, b, looks };
    if (na >= opts.maxN && nb >= opts.maxN) return { verdict: 'too close to call', a, b, looks };
    if (r.a[1] === 0 && r.b[1] === 0) throw new Error('sequentialCompare: a batch drew no trials');
  }
}

// ---- formatting -------------------------------------------------------------------------------

export function fmtPct(p: Proportion, digits = 1): string {
  const f = (x: number): string => (100 * x).toFixed(digits);
  return `${f(p.est)}% [95% CI ${f(p.lo)}-${f(p.hi)}%, n=${p.n}]`;
}
export function fmtMean(m: MeanCI, digits = 2): string {
  // Below 2 values there is no t interval (and at 0 no mean): the estimate is not printed as a number.
  if (!(Number.isFinite(m.lo) && Number.isFinite(m.hi))) return `not shown [95% CI undefined, n=${m.n} is too few for a t interval]`;
  return `${m.mean.toFixed(digits)} [95% CI ${m.lo.toFixed(digits)}-${m.hi.toFixed(digits)}, n=${m.n}]`;
}
/**
 * A quantile with its order-statistic interval, the coverage printed (at least 95 percent). When n
 * is too small for any such interval to reach 95 percent, the quantile is not printed as a number:
 * every number shown carries a 95 percent interval. digits: fixed decimals (default as is); after:
 * text after the estimate (a unit); unit: the unit of n; note: text after n inside the bracket.
 */
export function fmtQuantile(qi: QuantileCI, o: { digits?: number; after?: string; unit?: string; note?: string } = {}): string {
  const f = (x: number): string => (o.digits === undefined ? String(x) : x.toFixed(o.digits));
  const n = `n=${qi.n}${o.unit ? ` ${o.unit}` : ''}`;
  const note = o.note ? `, ${o.note}` : '';
  if (!(qi.n > 0 && qi.coverage >= 0.95)) return `not shown [95% CI undefined, ${n} is too few for a 95% order-statistic interval${note}]`;
  return `${f(qi.est)}${o.after ?? ''} [${(100 * qi.coverage).toFixed(1)}% CI ${f(qi.lo)}-${f(qi.hi)}, ${n}${note}]`;
}
