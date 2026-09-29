#!/usr/bin/env node
// fetch-cr: download the Magic comprehensive rules text into docs/CR.txt.
// The file is Wizards of the Coast's document, so it is not committed; every clone fetches it.
// The URL is the one docs/RULES-NOTES.md records; override with CR_URL=... for a newer release
// (the rules page https://magic.wizards.com/en/rules links the current txt file).
// Usage: node scripts/fetch-cr.mjs [--force]
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_URL = 'https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crPath = join(repo, 'docs', 'CR.txt');

export async function fetchCr({ force = false, log = console.error } = {}) {
  if (existsSync(crPath) && !force) return { path: crPath, downloaded: false };
  const url = process.env.CR_URL || DEFAULT_URL;
  log(`fetch-cr downloading ${url}`);
  const res = await fetch(url, { headers: { 'user-agent': 'matchup-lab fetch-cr' } });
  if (!res.ok) throw new Error(`fetch-cr HTTP ${res.status} for ${url}`);
  const text = await res.text();
  const rules = (text.match(/^\d{3}(\.\d+)?[a-z]?\.?\s/gm) || []).length;
  if (rules < 1000) throw new Error(`fetch-cr parsed only ${rules} rule lines; the download does not look like the comprehensive rules`);
  mkdirSync(dirname(crPath), { recursive: true });
  writeFileSync(crPath, text);
  log(`fetch-cr wrote docs/CR.txt (${text.length} chars, ${rules} rule lines)`);
  return { path: crPath, downloaded: true, rules };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchCr({ force: process.argv.includes('--force') }).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
