#!/usr/bin/env node
// check-cards: the card defs against the decklists and decks/oracle.json (PLAN.md section 6).
//   1. every card name in decks/deckA.json and decks/deckB.json (main and side) has a def;
//   2. every def's mana cost, types, supertypes, subtypes, colors, P/T and loyalty match
//      decks/oracle.json, face by face;
//   3. every card has a scenario test file src/test/cards/<def id>.test.ts with at least one test.
// Prints a coverage table (card, faces checked, tests) and the counts; exits 1 on any gap.
// Needs tsx to load the TypeScript defs: node --import tsx scripts/check-cards.mjs
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { defIdByName, getDef } = await import(pathToFileURL(join(repo, 'src', 'cards', 'index.ts')).href);

const readJson = (p) => JSON.parse(readFileSync(join(repo, p), 'utf8'));
const oracle = readJson('decks/oracle.json');
const decks = { deckA: readJson('decks/deckA.json'), deckB: readJson('decks/deckB.json') };

const SUPERTYPES = new Set(['Legendary', 'Basic', 'Snow', 'World']);
const COLOR_SYMBOLS = ['W', 'U', 'B', 'R', 'G'];

/** 'Legendary Creature — Phyrexian Praetor' -> { supertypes, types, subtypes } */
function parseTypeLine(line) {
  const [left, right = ''] = line.split(' — ');
  const words = left.trim().split(/\s+/).filter(Boolean);
  return {
    supertypes: words.filter((w) => SUPERTYPES.has(w)),
    types: words.filter((w) => !SUPERTYPES.has(w)),
    subtypes: right.trim().split(/\s+/).filter(Boolean),
  };
}
/** CR 202.2 (color): a face's colors come from the colored symbols in its mana cost. */
const colorsOfCost = (cost) => COLOR_SYMBOLS.filter((c) => new RegExp(`\\{[^}]*${c}[^}]*\\}`).test(cost));
const sortJ = (a) => JSON.stringify([...a].sort());
const num = (s) => (s === null || s === undefined ? undefined : /^\d+$/.test(s) ? Number(s) : s);

/** Oracle faces with the fields compared. */
function oracleFaces(card) {
  const faces = card.card_faces.length > 0 ? card.card_faces : [card];
  return faces.map((f, i) => {
    const cost = f.mana_cost ?? '';
    // Back faces with no mana cost carry a color indicator Scryfall does not list per face; every
    // such face in this pool (Reflection, Glutton, Vessel, Etching, Avatar Roku) has the card's
    // colors, and a cost-less front face (a land) has none.
    const colors = cost !== '' ? colorsOfCost(cost) : i > 0 && card.layout === 'transform' ? card.colors : [];
    return {
      name: f.name, cost: cost === '' ? null : cost, colors, ...parseTypeLine(f.type_line),
      power: num(f.power), toughness: num(f.toughness), loyalty: num(f.loyalty),
    };
  });
}

function compareFace(defFace, of) {
  const errs = [];
  const eq = (what, a, b) => { if (a !== b) errs.push(`${what}: def ${a} vs oracle ${b}`); };
  eq('name', defFace.name, of.name);
  eq('cost', defFace.cost ?? null, of.cost);
  eq('types', sortJ(defFace.types), sortJ(of.types));
  eq('supertypes', sortJ(defFace.supertypes), sortJ(of.supertypes));
  eq('subtypes', sortJ(defFace.subtypes), sortJ(of.subtypes));
  eq('colors', sortJ(defFace.colors), sortJ(of.colors));
  if (of.power === '*' || of.toughness === '*') {
    // A characteristic-defining P/T (Unlicensed Hearse) has no printed numbers in the def.
    if (defFace.pt !== undefined) errs.push(`pt: def ${JSON.stringify(defFace.pt)} vs oracle */*`);
  } else {
    const opt = of.power === undefined ? undefined : JSON.stringify([of.power, of.toughness]);
    eq('pt', defFace.pt === undefined ? undefined : JSON.stringify(defFace.pt), opt);
  }
  eq('loyalty', defFace.loyalty, of.loyalty);
  return errs;
}

function countTests(file) {
  if (!existsSync(file)) return 0;
  const src = readFileSync(file, 'utf8');
  return (src.match(/^\s*(?:it|test)(?:\.each\([^)]*\))?\(\s*['"`]/gm) ?? []).length;
}

// Names from both decklists, main and side, in first-seen order.
const names = [];
const where = new Map();
for (const [deck, list] of Object.entries(decks)) {
  for (const part of ['main', 'side']) {
    for (const e of list[part] ?? []) {
      if (!where.has(e.name)) { where.set(e.name, new Set()); names.push(e.name); }
      where.get(e.name).add(`${deck}.${part}`);
    }
  }
}

const rows = [];
const gaps = [];
let facesChecked = 0;
let testsTotal = 0;
for (const name of names) {
  const row = { name, def: '-', faces: 0, tests: 0, status: 'ok' };
  const card = oracle[name];
  const id = defIdByName(name);
  if (!card) { gaps.push(`${name}: not in decks/oracle.json`); row.status = 'NO ORACLE'; }
  if (!id) { gaps.push(`${name}: no card def`); row.status = 'NO DEF'; rows.push(row); continue; }
  row.def = id;
  const def = getDef(id);
  if (card) {
    const ofs = oracleFaces(card);
    if (def.faces.length !== ofs.length) {
      gaps.push(`${name}: def has ${def.faces.length} face(s), oracle ${ofs.length}`);
      row.status = 'FACES';
    }
    def.faces.forEach((f, i) => {
      const of = ofs[i];
      if (!of) return;
      facesChecked++;
      row.faces++;
      for (const e of compareFace(f, of)) { gaps.push(`${name} face ${i}: ${e}`); row.status = 'MISMATCH'; }
    });
  }
  const testFile = join(repo, 'src', 'test', 'cards', `${id}.test.ts`);
  row.tests = countTests(testFile);
  testsTotal += row.tests;
  if (row.tests === 0) { gaps.push(`${name}: no scenario tests in src/test/cards/${id}.test.ts`); if (row.status === 'ok') row.status = 'NO TESTS'; }
  rows.push(row);
}

const w = Math.max(...rows.map((r) => r.name.length), 4);
console.log(`${'card'.padEnd(w)}  faces  tests  status`);
for (const r of rows) console.log(`${r.name.padEnd(w)}  ${String(r.faces).padStart(5)}  ${String(r.tests).padStart(5)}  ${r.status}`);
const withTests = rows.filter((r) => r.tests > 0).length;
console.log('');
console.log(`check:cards ${names.length} card name(s) from deckA and deckB (main + side); ${rows.filter((r) => r.def !== '-').length} with a def; ${facesChecked} face(s) checked against oracle.json; ${withTests} of ${names.length} with scenario tests (${testsTotal} tests); ${gaps.length} gap(s)`);
for (const g of gaps) console.log(`  GAP ${g}`);
process.exit(gaps.length === 0 && names.length > 0 ? 0 : 1);
