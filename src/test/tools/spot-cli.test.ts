// The spot command (src/cli/spot.ts; PLAN.md section 7, Phase 4 and 5): every number printed
// carries its sample size and a 95 percent interval, the report states both limits, --json gives
// the same result as text, and bad arguments are rejected.
import { describe, expect, it } from 'vitest';
import { DETERMINIZATION_SENTENCE, HEURISTIC_SENTENCE, parseSpotArgs, spotCommand } from '../../cli/spot.js';
import type { SearchResult } from '../../agents/ismcts.js';

// The plain UCT mode's report (--mode uct; the default validated mode is tested in src/test/cli/cli.test.ts).
const ARGS = ['--file', 'spots/example.json', '--mode', 'uct', '--samples', '2', '--iterations', '40', '--seed', '7', '--workers', '0'];

async function run(argv: string[]): Promise<{ text: string; r: SearchResult }> {
  const out: string[] = [];
  const r = await spotCommand(argv, (s) => out.push(s));
  return { text: out.join('\n'), r };
}

describe('spot command', () => {
  it('text report: n and a CI on every estimate, totals, the top 5 lines and both sentences', async () => {
    const { text, r } = await run(ARGS);
    console.log(text);
    const lines = text.split('\n');
    expect(lines).toContain(HEURISTIC_SENTENCE);
    expect(lines).toContain(DETERMINIZATION_SENTENCE);
    expect(HEURISTIC_SENTENCE).toBe('Win rates reflect heuristic play, not perfect play.');
    expect(DETERMINIZATION_SENTENCE).toBe('The search samples hidden cards; it can act as if it knew cards the player has not seen.');
    expect(text).toContain(`total: ${r.rollouts} rollouts over 2 samples`);
    expect(r.rollouts).toBe(80);
    // Every line with an estimate (a percentage or a mean value) carries a 95% CI and n.
    const estimates = lines.filter((l) => l.includes('%') || l.includes('mean value'));
    let checked = 0;
    for (const l of estimates) {
      if (l.startsWith('spot:')) continue; // the file's own note
      expect(l).toMatch(/95% CI/);
      expect(l).toMatch(/n=\d+/);
      const wins = l.match(/win [\d.]+% \[95% CI [\d.]+%-[\d.]+%, n=\d+ rollouts\]/g) ?? [];
      const means = l.match(/mean value [\d.]+ \[(95% CI [\d.-]+-[\d.]+, t interval, SE [\d.]+|no interval below 2 rollouts), n=\d+\]/g) ?? [];
      expect(wins.length).toBeGreaterThan(0);
      expect(means.length).toBe(wins.length);
      checked++;
    }
    console.log(`checked ${checked} estimate lines`);
    const top = lines.filter((l) => /^\d\. /.test(l));
    expect(top.length).toBe(Math.min(5, r.lines.length));
    expect(checked).toBeGreaterThanOrEqual(1 + 2 * top.length);
  }, 120_000);

  it('--json carries the same numbers, the top lines with n and CI, and both sentences', async () => {
    const { r } = await run(ARGS);
    const { text } = await run([...ARGS, '--json']);
    const j = JSON.parse(text) as { lines: { visits: number; win: { n: number; lo: number; hi: number } }[]; rollouts: number; notes: string[] };
    expect(j.rollouts).toBe(r.rollouts);
    expect(j.lines.length).toBe(Math.min(5, r.lines.length));
    for (const l of j.lines) {
      expect(l.win.n).toBe(l.visits);
      expect(l.win.lo).toBeLessThanOrEqual(l.win.hi);
    }
    expect(j.notes).toEqual([HEURISTIC_SENTENCE, DETERMINIZATION_SENTENCE]);
  }, 120_000);

  it('rejects bad arguments', () => {
    expect(() => parseSpotArgs([])).toThrow(/--file is required/);
    expect(() => parseSpotArgs(['--file', 'x.json', '--player', 'C'])).toThrow(/--player/);
    expect(() => parseSpotArgs(['--file', 'x.json', '--ms', '100', '--iterations', '5'])).toThrow(/not both/);
    expect(() => parseSpotArgs(['--file', 'x.json', '--rollout', 'deep'])).toThrow(/--rollout/);
    expect(parseSpotArgs(['--file', 'x.json', '--player', 'b']).player).toBe(1);
  });
});
