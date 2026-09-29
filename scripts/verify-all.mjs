// npm run verify:all (PLAN.md section 8, Phase 5; D27): typecheck, the test suite, the CR citation
// lint and the card coverage check, one after another, each with the count of what it processed.
// A step passes only when its exit code is 0 AND it processed more than zero items, so a run that
// checked nothing cannot pass. Exit code 0 when every step passes, 1 otherwise.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;

/** Each step: the command, which output lines to echo, and how to read its processed count. */
const steps = [
  {
    name: 'typecheck',
    args: [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.json'), '--noEmit', '--listFiles'],
    echo: (l) => !/\.(d\.)?[cm]?ts$/.test(l.trim()), // the file list is counted, not printed; errors are printed
    count: (out) => { const n = out.split(/\r?\n/).filter((l) => /[\\/]src[\\/].*\.ts$/.test(l.trim())).length; return { n, what: 'source files under src typechecked' }; },
  },
  {
    name: 'tests',
    args: [join(root, 'node_modules/vitest/vitest.mjs'), 'run'],
    echo: () => true,
    count: (out) => {
      const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
      const m = /Tests\s+(?:(\d+) failed \| )?(\d+) passed/.exec(clean);
      return { n: m ? Number(m[2]) : 0, what: `tests passed${m && m[1] ? `, ${m[1]} failed` : ''}` };
    },
  },
  {
    name: 'lint:cr',
    args: [join(root, 'scripts/lint-cr.mjs')],
    echo: () => true,
    count: (out) => { const m = /checked (\d+) citation/.exec(out); return { n: m ? Number(m[1]) : 0, what: 'CR citations checked' }; },
  },
  {
    name: 'check:cards',
    args: ['--import', 'tsx', join(root, 'scripts/check-cards.mjs')],
    echo: (l) => l.startsWith('check:cards') || l.includes('GAP'), // the 56-row table is left out; run npm run check:cards to see it
    count: (out) => { const m = /check:cards (\d+) card name/.exec(out); return { n: m ? Number(m[1]) : 0, what: 'card names checked' }; },
  },
];

function run(step) {
  return new Promise((resolveStep) => {
    const p = spawn(node, step.args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let pending = '';
    const onData = (d) => {
      const s = d.toString();
      out += s;
      pending += s;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const l of lines) if (step.echo(l)) process.stdout.write(`${l}\n`);
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('close', (code) => {
      if (pending && step.echo(pending)) process.stdout.write(`${pending}\n`);
      resolveStep({ code: code ?? 1, out });
    });
  });
}

const results = [];
for (const step of steps) {
  console.log(`\n== ${step.name}: node ${step.args.map((a) => a.replace(root, '.')).join(' ')}`);
  const t0 = Date.now();
  const { code, out } = await run(step);
  const { n, what } = step.count(out);
  const ok = code === 0 && n > 0;
  results.push({ name: step.name, ok, code, n, what, s: (Date.now() - t0) / 1000 });
}
console.log('\nverify:all summary');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(12)} exit ${r.code}, ${r.n} ${r.what}${r.n === 0 ? ' (nothing processed counts as a failure)' : ''} (${r.s.toFixed(1)} s)`);
const passed = results.filter((r) => r.ok).length;
console.log(`verify:all: ${passed} of ${results.length} steps passed`);
process.exit(passed === results.length ? 0 : 1);
