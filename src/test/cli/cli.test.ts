// Phase 5 CLI (PLAN.md section 8, Phase 5; D27): the hand, spot and match commands share --seed,
// --workers, --json and --help, exit 0 on success and 2 on bad input with a message naming the
// problem; every number line carries n and a 95 percent interval; spot and match default to the
// search that passed the Phase 4 acceptance run, and --mode uct is the unvalidated plain search.
// The PowerShell wrappers pass a quoted hand with commas and // names through PowerShell 5 intact.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, MATCH_USAGE, parseMatchArgs } from '../../cli/index.js';
import { HAND_USAGE, parseHandArgs } from '../../cli/hand.js';
import { parseSpotArgs, SPOT_USAGE } from '../../cli/spot.js';
import { MCTS_UCT, MCTS_VALIDATED, resolveMctsOptions } from '../../agents/mcts-agent.js';
import { UsageError } from '../../cli/args.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const HAND7 = 'Blood Crypt,Swamp,Blackcleave Cliffs,Thoughtseize,Bloodtithe Harvester,Fable of the Mirror-Breaker,Sheoldred, the Apocalypse';
const HAND7_NAMES = ['Blood Crypt', 'Swamp', 'Blackcleave Cliffs', 'Thoughtseize', 'Bloodtithe Harvester', 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', 'Sheoldred, the Apocalypse'];
const TINY_HAND = ['--hand', HAND7, '--play', '--max-games', '6', '--batch', '6', '--goldfish-games', '4', '--seed', '3', '--workers', '0'];

/** Runs main() in this process and captures stdout, stderr and the exit code. */
async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  const error = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
  const write = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => { err.push(String(s).replace(/\n$/, '')); return true; });
  try {
    const code = await main(argv);
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally {
    log.mockRestore(); error.mockRestore(); write.mockRestore();
  }
}

/**
 * Every line that shows an estimate (a percentage, or a mean, median, p95, gain or value followed by
 * a number) has at least as many interval brackets as estimates, and every interval bracket names its
 * n. Returns the number of estimate lines checked.
 */
function checkNumberLines(text: string): number {
  let lines = 0;
  for (const l of text.split('\n')) {
    const brackets = l.match(/\[[^\]]*\]/g) ?? [];
    const outside = l.replace(/\[[^\]]*\]/g, '');
    const estimates = (outside.match(/\d%|\b(mean|median|p95|gain|value) [+-]?\d/g) ?? []).length;
    const ci = brackets.filter((b) => /CI|no interval/.test(b)); // spot prints [no interval below 2 rollouts, n=1]
    for (const b of ci) expect(b, l).toMatch(/n=\d+/);
    if (estimates === 0 && ci.length === 0) continue;
    expect(ci.length, l).toBeGreaterThanOrEqual(estimates);
    for (const b of ci) expect(b, l).toMatch(/^\[(9[5-9](\.\d)?% CI|95% CI undefined|no interval below 2)/);
    lines++;
  }
  return lines;
}

describe('help and exit codes', () => {
  beforeEach(() => { process.exitCode = undefined; });
  afterEach(() => { process.exitCode = undefined; });

  it('--help exits 0 for each command, with the shared flags in each help', async () => {
    for (const [cmd, usage] of [['hand', HAND_USAGE], ['spot', SPOT_USAGE], ['match', MATCH_USAGE]] as const) {
      const r = await run([cmd, '--help']);
      expect(r.code).toBe(0);
      expect(r.out).toBe(usage);
      expect(r.out).toContain(`usage: ${cmd}`);
      for (const f of ['--seed S', '--workers W', '--json', '--help', 'Exit codes: 0 done, 2 bad input']) expect(r.out).toContain(f);
    }
    const all = await run(['--help']);
    expect(all.code).toBe(0);
    for (const cmd of ['hand', 'spot', 'match']) expect(all.out).toContain(`usage: ${cmd}`);
    expect((await run([])).code).toBe(2);
    const unknown = await run(['solve']);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('unknown command solve');
  });

  it('bad input exits 2 with a message naming the problem, before any game is played', async () => {
    const cases: [string[], RegExp][] = [
      [['hand', '--hand', 'Blood Crypt,Swamp,Foo', '--play'], /no card named 'Foo'/],
      [['hand', '--hand', 'Thoughtseize;Thoughtseize;Thoughtseize;Thoughtseize;Thoughtseize;Swamp;Swamp', '--play'], /illegal hand: .*Thoughtseize/],
      [['hand', '--hand', HAND7], /give exactly one of --play and --draw/],
      [['hand', '--hand-file', 'no-such-hand.json', '--draw'], /--hand-file no-such-hand\.json/],
      [['hand', '--hand', 'Blood Crypt,Swamp', 'Thoughtseize', '--play'], /unexpected argument 'Thoughtseize'/],
      [['spot', '--file', 'no-such-spot.json'], /--file no-such-spot\.json: no such file/],
      [['spot', '--file', 'spots/example.json', '--mode', 'deep'], /--mode must be validated or uct, got deep/],
      [['spot'], /--file is required/],
      [['match', '--a', 'solver'], /--a must be random, greedy or mcts, got solver/],
      [['match', '--game', '10'], /unknown flag --game/],
      [['match', '--mode', 'gto'], /--mode must be validated or uct/],
      [['match', '--seed', '1', '--seed', '2'], /--seed is given twice/],
    ];
    for (const cmd of ['hand', 'spot', 'match']) {
      const base = cmd === 'hand' ? ['--hand', HAND7, '--play'] : cmd === 'spot' ? ['--file', 'spots/example.json'] : [];
      cases.push([[cmd, ...base, '--workers', '-1'], /--workers must be an integer >= 0, got -1/]);
      cases.push([[cmd, ...base, '--seed', 'x'], /--seed must be an integer >= -\d+, got x/]);
      cases.push([[cmd, ...base, '--seed'], /--seed needs a value/]);
    }
    for (const [argv, re] of cases) {
      const r = await run(argv);
      expect(r.code, argv.join(' ')).toBe(2);
      expect(r.err, argv.join(' ')).toMatch(re);
      expect(r.out, argv.join(' ')).toBe('');
    }
    console.log(`bad input: ${cases.length} command lines, each exit code 2 with the problem named`);
    expect(cases.length).toBe(21);
  });

  it('--seed and --workers parse the same way in all three commands', () => {
    const common = ['--seed', '-7', '--workers', '3'];
    const h = parseHandArgs(['--hand', HAND7, '--play', ...common]);
    const s = parseSpotArgs(['--file', 'spots/example.json', ...common]);
    const m = parseMatchArgs(common);
    for (const x of [h, s, m]) { expect(x.seed).toBe(-7); expect(x.workers).toBe(3); }
    expect(() => parseMatchArgs(['--workers', '1.5'])).toThrow(UsageError);
  });
});

describe('default search: the validated agent (docs/ACCEPTANCE.md)', () => {
  it('the mcts agent, match --a mcts and spot default to the acceptance settings; --mode uct is the plain search', () => {
    const agent = resolveMctsOptions({});
    expect(agent).toMatchObject({ ...MCTS_VALIDATED, mode: 'validated' });
    expect(MCTS_VALIDATED).toEqual({ samples: 8, iterations: 3, rolloutTurns: 2, policy: 'greedy', prune: 3, pruneDepth: 1, margin: 3, override: 2, minGain: 0.02 });
    // The match command's default equals the explicit flags of the acceptance run (docs/ACCEPTANCE.md, Commands).
    const acceptance = parseMatchArgs(['--policy', 'greedy', '--prune', '3', '--samples', '8', '--iterations', '3', '--margin', '3', '--override', '2', '--min-gain', '0.02']).mcts;
    expect(parseMatchArgs(['--a', 'mcts']).mcts).toEqual(acceptance);
    expect(resolveMctsOptions(acceptance)).toMatchObject(agent);
    const uct = parseMatchArgs(['--a', 'mcts', '--mode', 'uct']).mcts;
    expect(uct).toMatchObject({ mode: 'uct', samples: MCTS_UCT.samples, iterations: MCTS_UCT.iterations, policy: 'fast', prune: 0 });
    expect(uct.margin).toBeUndefined();
    expect(uct.override).toBeUndefined();
    expect(resolveMctsOptions({ mode: 'uct' })).toMatchObject({ ...MCTS_UCT, mode: 'uct' });
    expect(resolveMctsOptions({ ms: 100 }).iterations).toBeUndefined();
    const spot = parseSpotArgs(['--file', 'x.json']);
    expect(spot).toMatchObject({ mode: 'validated', samples: 8, iterations: 3, policy: 'greedy', prune: 3, turns: 2, margin: 3, override: 2, minGain: 0.02 });
    expect(parseSpotArgs(['--file', 'x.json', '--mode', 'uct'])).toMatchObject({ mode: 'uct', samples: 8, iterations: 400, policy: 'fast', prune: 0 });
  });
});

describe('fixture runs: JSON keys and text, n and CI on every number line', () => {
  it('hand: JSON keys and a text report', async () => {
    const j = await run(['hand', ...TINY_HAND, '--json']);
    expect(j.code).toBe(0);
    const r = JSON.parse(j.out) as Record<string, unknown> & { input: { hand: string[] }; keep: { win: { n: number } } };
    for (const k of ['input', 'verdict', 'looks', 'keep', 'mulligan', 'goldfishKillTurn', 'keepWinTurn', 'keyCards', 'games', 'speed', 'sentence']) expect(r).toHaveProperty(k);
    expect(r.input.hand).toEqual(HAND7_NAMES);
    expect(r.keep.win.n).toBe(6);
    const t = await run(['hand', ...TINY_HAND]);
    expect(t.code).toBe(0);
    expect(t.out).toMatch(/^verdict: (KEEP|MULLIGAN|TOO CLOSE TO CALL)$/m);
    expect(t.out).toContain('Win rates reflect heuristic play, not perfect play.');
    const n = checkNumberLines(t.out) + checkNumberLines(t.err);
    console.log(`hand text: ${n} number lines checked`);
    expect(n).toBeGreaterThanOrEqual(12);
  }, 120_000);

  it('spot, default (validated) mode: recommendation, paired gains, lines and the validation note', async () => {
    const argv = ['spot', '--file', 'spots/example.json', '--seed', '5', '--workers', '0'];
    const j = await run([...argv, '--json']);
    expect(j.code).toBe(0);
    const r = JSON.parse(j.out) as Record<string, unknown> & { args: { mode: string }; recommendation: { key: string; reason: string; greedy: { lead: number; onSamples: { samples: number; first: { n: number; lo: number; hi: number }; lead: { n: number; mean: number; lo: number; hi: number } } }; gains: { n: number; lo: number; hi: number }[] }; rollouts: number; validation: string };
    for (const k of ['args', 'perspective', 'viewer', 'decider', 'samples', 'rollouts', 'total', 'lines', 'recommendation', 'notes', 'validation']) expect(r).toHaveProperty(k);
    expect(r.args.mode).toBe('validated');
    expect(r.rollouts).toBe(24); // 8 samples x 3 iterations
    expect(r.recommendation.key).toEqual(expect.any(String));
    expect(r.recommendation.greedy.lead).toEqual(expect.any(Number));
    // Greedy's lead over the samples: n = 8 samples with a t interval that holds the mean, and a Wilson interval on how often greedy picks the move.
    const on = r.recommendation.greedy.onSamples;
    expect(on.samples).toBe(8);
    expect(on.first.n).toBe(8);
    expect(on.first.lo).toBeLessThanOrEqual(on.first.hi);
    expect(on.lead.n).toBeGreaterThanOrEqual(2);
    expect(on.lead.lo).toBeLessThanOrEqual(on.lead.mean);
    expect(on.lead.mean).toBeLessThanOrEqual(on.lead.hi);
    for (const g of r.recommendation.gains) { expect(g.n).toBe(8); expect(g.lo).toBeLessThanOrEqual(g.hi); }
    expect(r.validation).toMatch(/^note: validated mode with the settings of the Phase 4 acceptance run/);
    expect(r.validation).toContain('54.9% [95% CI 51.8-58.0%, n=1000]');
    const t = await run(argv);
    expect(t.code).toBe(0);
    expect(t.out).toMatch(/^mode: validated/m);
    expect(t.out).toMatch(/^recommendation: A: /m);
    expect(t.out).toMatch(/^greedy's first choice on the validated agent's own sample: A: .*\((at least|less than) the margin of 3 evaluation points ahead of greedy's second choice on that sample; the agent's margin step, a yes or no\)$/m);
    expect(t.out).toMatch(/^ {2}over n=8 samples \(the first is the agent's own\): greedy picks it in [\d.]+% \[95% CI [\d.]+-[\d.]+%, n=8\]; its lead over greedy's best other move, in evaluation points: mean -?[\d.]+ \[95% CI -?[\d.]+ to -?[\d.]+, t interval, n=\d+ samples\]/m);
    expect(t.out).not.toMatch(/no interval\)/);
    expect(t.out).toContain('search: 8 samples, 3 iterations per sample, greedy rollouts truncated after 2 turns, greedy top-3 pruning at the root');
    expect(t.err).toContain('63.9% [95% CI 60.9-66.8%, n=1000]');
    const n = checkNumberLines(t.out) + checkNumberLines(t.err);
    console.log(`spot validated text: ${n} number lines checked\n${t.out}`);
    expect(n).toBeGreaterThanOrEqual(5);
  }, 120_000);

  it('spot --mode uct: the plain search, with the note that it was not validated', async () => {
    const t = await run(['spot', '--file', 'spots/example.json', '--mode', 'uct', '--samples', '2', '--iterations', '20', '--workers', '0']);
    expect(t.code).toBe(0);
    expect(t.out).toMatch(/^mode: uct/m);
    expect(t.out).not.toMatch(/^recommendation:/m);
    expect(t.err).toContain('not validated against greedy');
    expect(t.err).toContain('41.3% [95% CI 28.3-55.7%, n=46]');
    expect(t.err).toContain('46.5% [95% CI 43.4-49.6%, n=1000]');
    const n = checkNumberLines(t.out) + checkNumberLines(t.err);
    expect(n).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it('match: JSON keys and a text report', async () => {
    const argv = ['match', '--a', 'greedy', '--b', 'random', '--games', '6', '--seed', '3', '--workers', '0'];
    const j = await run([...argv, '--json']);
    expect(j.code).toBe(0);
    const r = JSON.parse(j.out) as Record<string, unknown> & { winA: { n: number } };
    for (const k of ['args', 'games', 'winA', 'winB', 'draws', 'winAOnPlay', 'winAOnDraw', 'turns', 'killTurnA', 'killTurnB', 'keyCards', 'decisions', 'speed']) expect(r).toHaveProperty(k);
    expect(r).not.toHaveProperty('validation'); // no mcts side
    expect(r.winA.n).toBe(6);
    const t = await run(argv);
    expect(t.code).toBe(0);
    expect(t.out).toMatch(/^A win rate: \d+\.\d% \[95% CI [\d.]+-[\d.]+%, n=6\]$/m);
    expect(t.out).not.toContain('NaN');
    const n = checkNumberLines(t.out);
    console.log(`match text: ${n} number lines checked`);
    expect(n).toBeGreaterThanOrEqual(10);
  }, 120_000);

  it('match with an mcts side prints the validation note (the validated agent by default)', async () => {
    const t = await run(['match', '--a', 'mcts', '--b', 'greedy', '--games', '1', '--seed', '3', '--workers', '0', '--samples', '1']);
    expect(t.code).toBe(0);
    expect(t.out).toContain('mcts budget: 1 samples x 3 iterations per decision, greedy rollouts cut after 2 turns, greedy top-3 pruning at the root');
    expect(t.err).toMatch(/^note: this run changes the validated settings \(--samples 1\), so it is not the validated agent/);
  }, 300_000);
});

// PowerShell 5 (powershell.exe) parses these command lines exactly as a user's console would.
describe.runIf(process.platform === 'win32')('PowerShell wrappers (Windows PowerShell 5)', () => {
  const ps = (command: string) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { cwd: ROOT, encoding: 'utf8', timeout: 240_000 });
  const handTail = "--play --json --max-games 4 --batch 4 --goldfish-games 0 --workers 0";
  const dfc = "Blood Crypt,Swamp,Blackcleave Cliffs,Thoughtseize,Bloodtithe Harvester,Fable of the Mirror-Breaker // Reflection of Kiki-Jiki,Sheoldred, the Apocalypse";

  it('a single-quoted hand with commas and a // name survives, run as .\\scripts\\hand.ps1 and through -File', () => {
    const forms = [
      `.\\scripts\\hand.ps1 --hand '${dfc}' ${handTail}`,
      `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\hand.ps1 --hand '${dfc}' ${handTail}`,
      `.\\scripts\\hand.ps1 --hand "${dfc}" ${handTail}`,
    ];
    for (const f of forms) {
      const r = ps(f);
      expect(r.status, `${f}\n${r.stderr}`).toBe(0);
      const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))) as { input: { hand: string[] } };
      expect(j.input.hand, f).toEqual(HAND7_NAMES);
    }
    console.log(`PowerShell 5: ${forms.length} quoting forms passed the 7 names intact`);
  }, 600_000);

  it('the wrappers pass --help (exit 0) and bad input (exit 2) through', () => {
    for (const cmd of ['hand', 'spot', 'match']) {
      const h = ps(`.\\scripts\\${cmd}.ps1 --help; exit $LASTEXITCODE`);
      expect(h.status, h.stderr).toBe(0);
      expect(h.stdout).toContain(`usage: ${cmd}`);
    }
    const bad = ps(".\\scripts\\match.ps1 --a solver; exit $LASTEXITCODE");
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('--a must be random, greedy or mcts, got solver');
    // Without quotes PowerShell splits the list at the commas into separate words; the CLI names the stray word.
    const unquoted = ps('.\\scripts\\hand.ps1 --hand Blood Crypt,Swamp --play; exit $LASTEXITCODE');
    expect(unquoted.status).toBe(2);
    expect(unquoted.stderr).toMatch(/unexpected argument/);
  }, 600_000);
});
