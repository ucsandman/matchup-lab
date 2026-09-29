// xoshiro128** (Blackman and Vigna) on four uint32 words, seeded from an integer through
// splitmix32. Functions mutate the RngState array in place; engine code that draws from the
// game stream goes through mutate.ts (randomInt) so the change is journaled.
import type { RngState } from './types.js';

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** One splitmix32 step: advances the 32-bit counter and returns a mixed output. */
function splitmix32(counter: number): [number, number] {
  const next = (counter + 0x9e3779b9) >>> 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  z = (z ^ (z >>> 15)) >>> 0;
  return [next, z];
}

/**
 * Seeds a generator from a safe integer (up to 53 bits; negative values allowed). The low and high
 * 32-bit halves both feed splitmix32, so seeds that differ only above bit 31 give different streams.
 */
export function seedRng(seed: number): RngState {
  if (!Number.isSafeInteger(seed)) throw new Error(`seedRng: seed must be a safe integer, got ${seed}`);
  const lo = seed >>> 0;
  const hi = Math.floor(seed / 4294967296) >>> 0;
  let [c, h] = splitmix32(hi);
  c = (lo ^ h) >>> 0;
  const s: RngState = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const [nc, out] = splitmix32(c);
    c = nc;
    s[i] = out;
  }
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1; // the all-zero state is a fixed point
  return s;
}

export function nextU32(s: RngState): number {
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return result;
}

/** Uniform float in [0, 1) with 32 bits of resolution. */
export function nextFloat(s: RngState): number {
  return nextU32(s) / 4294967296;
}

/** Uniform integer in [0, n) by rejection sampling (no modulo bias). */
export function nextInt(s: RngState, n: number): number {
  if (!Number.isInteger(n) || n <= 0 || n > 4294967296) throw new Error(`nextInt: bad bound ${n}`);
  const limit = 4294967296 - (4294967296 % n);
  for (;;) {
    const x = nextU32(s);
    if (x < limit) return x % n;
  }
}

const JUMP = [0x8764000b, 0xf542d2d3, 0x6fa035c3, 0x77f2db5b];

/** Advances the state by 2^64 steps: call once per worker to get non-overlapping streams. */
export function jump(s: RngState): void {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  for (const word of JUMP) {
    for (let b = 0; b < 32; b++) {
      if ((word >>> b) & 1) {
        s0 ^= s[0]; s1 ^= s[1]; s2 ^= s[2]; s3 ^= s[3];
      }
      nextU32(s);
    }
  }
  s[0] = s0 >>> 0; s[1] = s1 >>> 0; s[2] = s2 >>> 0; s[3] = s3 >>> 0;
}

/** Fisher-Yates in place, drawing from s. */
export function shuffle<T>(s: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(s, i + 1);
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

export function cloneRng(s: RngState): RngState {
  return [s[0], s[1], s[2], s[3]];
}
