#!/usr/bin/env node
// lint-cr: every CR citation in src/**/*.ts must name a real rule in docs/CR.txt,
// and at least one of its topic words must appear in that rule's text.
// Citation format: CR 704.5g (lethal damage)
// A rule's text is its own line plus the lines of its subrules (704.5 includes 704.5a-z,
// 731 includes 731.1 and its subrules). Topic words shorter than 3 letters and stopwords
// are ignored; a word matches if it or its stem (common suffix removed) occurs in the text.
// Any "CR <number>" that is not followed by a (topic) is reported as malformed.
// Usage: node scripts/lint-cr.mjs [root ...]   (default root: src)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crPath = join(repo, 'docs', 'CR.txt');
if (!existsSync(crPath)) {
  // docs/CR.txt is not committed (it is Wizards of the Coast's text); fetch it on first use.
  const { fetchCr } = await import('./fetch-cr.mjs');
  try { await fetchCr(); } catch (e) {
    console.error(`lint:cr FAIL docs/CR.txt is missing and the download failed: ${e.message} (see docs/RULES-NOTES.md)`);
    process.exit(1);
  }
}

const norm = (s) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

// Parse rule lines: "704.5g text", "704.5. text", "731. text".
const rules = new Map(); // number -> text (own line)
for (const line of readFileSync(crPath, 'utf8').split(/\r?\n/)) {
  // [\s\S]* rather than .*: some rule lines contain U+2028, which . does not match.
  const m = /^(\d{3}(?:\.\d+)?[a-z]?)\.?\s+([\s\S]*)$/.exec(line);
  if (!m) continue;
  const num = m[1];
  rules.set(num, (rules.get(num) ?? '') + ' ' + norm(m[2]));
}
if (rules.size < 1000) {
  console.error(`lint:cr FAIL parsed only ${rules.size} rules from docs/CR.txt; file looks wrong`);
  process.exit(1);
}

function ruleText(num) {
  if (!rules.has(num)) return null;
  // Children: 704.5 -> 704.5a..; 731 -> 731.1, 731.1a ..; 704.5g has none.
  const childRe = /^\d{3}$/.test(num)
    ? new RegExp('^' + num + '[.]')
    : /^\d{3}\.\d+$/.test(num)
      ? new RegExp('^' + num.replace('.', '[.]') + '[a-z]$')
      : null;
  let text = rules.get(num);
  if (childRe) for (const [k, v] of rules) if (childRe.test(k)) text += ' ' + v;
  return text;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'rule', 'rules', 'that', 'this', 'into', 'onto', 'its', 'are', 'not', 'per', 'via', 'see']);
function stem(w) {
  for (const suf of ['ations', 'ation', 'ings', 'ing', 'ies', 'ied', 'ed', 'es', 's', 'al', 'ity', 'ion', 'ly', 'er', 'e']) {
    if (w.endsWith(suf) && w.length - suf.length >= 4) return w.slice(0, -suf.length);
  }
  return w;
}
function topicHit(topic, text) {
  const words = norm(topic).split(/[^a-z0-9']+/).filter((w) => w.length >= 3 && !STOP.has(w));
  if (words.length === 0) return { ok: false, why: 'no usable topic words' };
  const hit = words.find((w) => text.includes(w) || text.includes(stem(w)));
  return hit ? { ok: true, hit } : { ok: false, why: `none of [${words.join(', ')}] appears in the rule text` };
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const roots = (process.argv.slice(2).length ? process.argv.slice(2) : ['src']).map((r) => resolve(repo, r));
const files = roots.filter(existsSync).flatMap((r) => (statSync(r).isDirectory() ? walk(r, []) : [r]));

const CITE = /\bCR\s+(\d{3}(?:\.\d+)?[a-z]?)\s*\(([^)]*)\)/g;
const ANY = /\bCR\s+\d{3}/g;
let checked = 0;
const failures = [];
for (const f of files) {
  const rel = relative(repo, f).split(String.fromCharCode(92)).join('/');
  readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const loc = `${rel}:${i + 1}`;
    const good = new Set();
    for (const m of line.matchAll(CITE)) {
      checked++;
      good.add(m.index);
      const [, num, topic] = m;
      const text = ruleText(num);
      if (text === null) { failures.push(`${loc} CR ${num} (${topic}): no such rule in docs/CR.txt`); continue; }
      const r = topicHit(topic, text);
      if (!r.ok) failures.push(`${loc} CR ${num} (${topic}): ${r.why}`);
    }
    for (const m of line.matchAll(ANY)) {
      if (good.has(m.index)) continue;
      checked++;
      failures.push(`${loc} malformed citation near "${line.slice(m.index, m.index + 24).trim()}": use the form CR 704.5g (lethal damage)`);
    }
  });
}

for (const f of failures) console.error('lint:cr FAIL ' + f);
console.log(`lint:cr checked ${checked} citation(s) in ${files.length} file(s) against ${rules.size} rules; ${failures.length} failure(s)`);
process.exit(failures.length ? 1 : 0);
