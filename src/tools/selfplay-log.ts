// Phase 6 self-play logging (PLAN.md section 8; schema in docs/JSONL-SCHEMA.md). Runs a match on
// the worker runner with the decision log on (src/sim/decision-log.ts), joins the per-block part
// files in block order into one JSONL file (gzip when the path ends in .gz) and validates a log
// file line by line. No training code: the log is the input a later value or policy network
// would be trained on.
//
//   node dist/tools/selfplay-log.js --games 10000 --a greedy --b greedy --seed 1 --workers 8 --out out/selfplay-10k.jsonl
//   node dist/tools/selfplay-log.js --validate out/selfplay-10k.jsonl
//   node dist/cli/index.js match --a greedy --b greedy --games 100 --log out/match.jsonl
//
// The mcts side here uses the agent's default budget (src/agents/mcts-agent.ts MCTS_DEFAULTS); the
// match command with --log takes every search flag.
import { createReadStream, createWriteStream, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip, createGzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { defaultWorkers, runMatch, type MatchReport, type RunOptions } from '../sim/runner.js';
import { DEFAULT_KEY_CARDS, type MatchJob } from '../sim/games.js';
import { LOG_VERSION } from '../sim/decision-log.js';
import type { AgentKind } from '../agents/types.js';

export interface LogStats {
  path: string;
  /** All lines written (decision + end). */
  lines: number;
  decisionLines: number;
  endLines: number;
  /** Bytes on disk (compressed size for .gz). */
  bytes: number;
  /** Uncompressed JSONL bytes. */
  rawBytes: number;
  gzip: boolean;
}

const END_MARK = Buffer.from('{"type":"end","v":');

/** End lines in a buffer of whole lines. */
function countEnd(buf: Buffer): number {
  let n = 0;
  if (buf.subarray(0, END_MARK.length).equals(END_MARK)) n++;
  let at = buf.indexOf(0x0a);
  while (at >= 0) {
    if (buf.subarray(at + 1, at + 1 + END_MARK.length).equals(END_MARK)) n++;
    at = buf.indexOf(0x0a, at + 1);
  }
  return n;
}

function countNewlines(buf: Buffer): number {
  let n = 0;
  for (let at = buf.indexOf(0x0a); at >= 0; at = buf.indexOf(0x0a, at + 1)) n++;
  return n;
}

/** Joins the part files of dir (block-NNNNNN.jsonl, in block order) into out and counts the lines. */
export async function joinParts(dir: string, out: string): Promise<LogStats> {
  const parts = readdirSync(dir).filter((f) => /^block-\d+\.jsonl$/.test(f)).sort();
  mkdirSync(dirname(resolve(out)), { recursive: true });
  const gzip = out.endsWith('.gz');
  const file = createWriteStream(out);
  const sink: Writable = gzip ? createGzip() : file;
  const done = new Promise<void>((res, rej) => { file.on('finish', () => res()); file.on('error', rej); sink.on('error', rej); });
  if (gzip) sink.pipe(file);
  let lines = 0;
  let endLines = 0;
  let rawBytes = 0;
  for (const p of parts) {
    // A part is one block (25 games by default), small enough to hold whole.
    const b = readFileSync(join(dir, p));
    rawBytes += b.length;
    lines += countNewlines(b);
    endLines += countEnd(b);
    if (!sink.write(b)) await new Promise<void>((r) => sink.once('drain', () => r()));
  }
  sink.end();
  await done;
  return { path: out, lines, decisionLines: lines - endLines, endLines, bytes: statSync(out).size, rawBytes, gzip };
}

/** Runs the match with the decision log on and writes the joined JSONL to out. */
export async function runLogged(job: MatchJob, opts: RunOptions, out: string): Promise<{ report: MatchReport; log: LogStats; logSeconds: number }> {
  const dir = `${resolve(out)}.parts`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    const report = await runMatch({ ...job, log: dir }, opts);
    const t0 = performance.now();
    const log = await joinParts(dir, out);
    return { report, log, logSeconds: (performance.now() - t0) / 1000 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- schema validation (docs/JSONL-SCHEMA.md) ----------

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isPlayer = (x: unknown): boolean => x === 0 || x === 1;
const AGENTS = new Set(['random', 'greedy', 'passive', 'mcts']);
const MOVE_TYPES = new Set(['playLand', 'cast', 'activate', 'unlockDoor', 'declareAttackers', 'declareBlockers', 'choose', 'pass']);
const MODES = new Set(['searched', 'forced', 'pregame', 'fallback', 'skipped', 'unknown']);

function checkProportion(x: unknown, where: string, err: string[]): void {
  if (!isObj(x)) { err.push(`${where}: not an object`); return; }
  for (const k of ['k', 'n']) if (!isInt(x[k])) err.push(`${where}.${k}: not an integer`);
  for (const k of ['est', 'lo', 'hi']) if (!(isNum(x[k]) || (x[k] === null && x.n === 0))) err.push(`${where}.${k}: not a number`);
}

function checkView(v: unknown, player: unknown, turn: unknown, err: string[]): void {
  if (!isObj(v)) { err.push('view: not an object'); return; }
  if (v.viewer !== player) err.push('view.viewer: differs from player');
  if (v.turn !== turn) err.push('view.turn: differs from turn');
  for (const k of ['activePlayer', 'priority', 'startingPlayer']) if (!isPlayer(v[k])) err.push(`view.${k}: not 0 or 1`);
  if (typeof v.step !== 'string') err.push('view.step: not a string');
  if (!Array.isArray(v.players) || v.players.length !== 2 || !v.players.every((p) => isObj(p) && isInt(p.life))) err.push('view.players: not two players with integer life');
  if (!isObj(v.objects)) err.push('view.objects: not an object');
  else for (const [k, o] of Object.entries(v.objects)) if (!isObj(o) || o.id !== Number(k) || typeof o.defId !== 'string') err.push(`view.objects.${k}: bad object`);
  const z = v.zones;
  if (!isObj(z)) { err.push('view.zones: not an object'); return; }
  const lib = z.library;
  if (!Array.isArray(lib) || lib.length !== 2 || !lib.every((l) => isObj(l) && isInt(l.size))) err.push('view.zones.library: not two {size}');
  const hand = z.hand;
  if (!Array.isArray(hand) || hand.length !== 2 || !hand.every((h) => isObj(h) && Array.isArray(h.known) && Array.isArray(h.hidden))) err.push('view.zones.hand: not two {known, hidden}');
  for (const k of ['graveyard', 'exile']) {
    const zz = z[k];
    if (!Array.isArray(zz) || zz.length !== 2 || !zz.every((a) => Array.isArray(a) && a.every(isInt))) err.push(`view.zones.${k}: not two id arrays`);
  }
  if (!Array.isArray(z.battlefield) || !z.battlefield.every(isInt)) err.push('view.zones.battlefield: not an id array');
  if (!Array.isArray(z.stack)) err.push('view.zones.stack: not an array');
}

function checkMove(m: unknown, where: string, err: string[]): void {
  if (!isObj(m) || typeof m.type !== 'string' || !MOVE_TYPES.has(m.type)) err.push(`${where}: not a move`);
}

/** Schema errors of one parsed line (empty when it is valid). */
export function validateLine(x: unknown): string[] {
  const err: string[] = [];
  if (!isObj(x)) return ['line: not an object'];
  if (x.v !== LOG_VERSION) err.push(`v: expected ${LOG_VERSION}`);
  if (!isInt(x.game) || x.game < 0) err.push('game: not an integer >= 0');
  if (!isInt(x.seed)) err.push('seed: not an integer');
  if (x.type === 'decision') {
    if (!isInt(x.d) || x.d < 0) err.push('d: not an integer >= 0');
    if (!isPlayer(x.player)) err.push('player: not 0 or 1');
    if (x.side !== (x.player === 0 ? 'A' : 'B')) err.push('side: does not match player');
    if (typeof x.agent !== 'string' || !AGENTS.has(x.agent)) err.push('agent: unknown');
    if (!isInt(x.turn) || x.turn < 0) err.push('turn: not an integer');
    if (typeof x.step !== 'string') err.push('step: not a string');
    checkView(x.view, x.player, x.turn, err);
    if (!Array.isArray(x.legal) || x.legal.length === 0) err.push('legal: not a non-empty array');
    else x.legal.forEach((l, i) => {
      if (!isObj(l) || typeof l.text !== 'string' || l.text.length === 0) err.push(`legal[${i}].text: not a string`);
      else checkMove(l.move, `legal[${i}].move`, err);
    });
    const n = Array.isArray(x.legal) ? x.legal.length : 0;
    if (!isInt(x.chosen) || x.chosen < 0 || x.chosen >= n) err.push('chosen: not an index into legal');
    checkMove(x.move, 'move', err);
    if (Array.isArray(x.legal) && isInt(x.chosen) && JSON.stringify((x.legal[x.chosen] as { move?: unknown } | undefined)?.move) !== JSON.stringify(x.move)) err.push('move: differs from legal[chosen].move');
    if (x.search !== null) {
      const s = x.search;
      if (!isObj(s) || typeof s.mode !== 'string' || !MODES.has(s.mode)) err.push('search: not null or {mode}');
      else if (x.agent !== 'mcts') err.push('search: set for a non-mcts agent');
      else if (s.mode === 'searched') {
        for (const k of ['samples', 'iterations', 'rollouts']) if (!isInt(s[k])) err.push(`search.${k}: not an integer`);
        if (!isNum(s.seconds)) err.push('search.seconds: not a number');
        if (!Array.isArray(s.root) || s.root.length === 0) err.push('search.root: not a non-empty array');
        else s.root.forEach((r, i) => {
          if (!isObj(r) || typeof r.text !== 'string') { err.push(`search.root[${i}]: bad`); return; }
          if (!(r.legal === null || (isInt(r.legal) && r.legal >= 0 && r.legal < n))) err.push(`search.root[${i}].legal: not null or an index`);
          if (!isInt(r.visits) || !isInt(r.samples)) err.push(`search.root[${i}]: visits or samples not an integer`);
          for (const k of ['mean', 'meanLo', 'meanHi']) if (!(r[k] === null || isNum(r[k]))) err.push(`search.root[${i}].${k}: not a number or null`);
          checkProportion(r.win, `search.root[${i}].win`, err);
        });
      }
    } else if (x.agent === 'mcts') err.push('search: null for an mcts agent');
  } else if (x.type === 'end') {
    if (!['A', 'B', 'draw'].includes(x.winner as string)) err.push('winner: not A, B or draw');
    if (x.winnerPlayer !== (x.winner === 'A' ? 0 : x.winner === 'B' ? 1 : null)) err.push('winnerPlayer: does not match winner');
    if (typeof x.reason !== 'string') err.push('reason: not a string');
    if (!isInt(x.turns) || x.turns < 1) err.push('turns: not an integer >= 1');
    if (!isInt(x.decisions) || x.decisions < 1) err.push('decisions: not an integer >= 1');
    if (typeof x.aOnPlay !== 'boolean') err.push('aOnPlay: not a boolean');
    if (!isObj(x.agents) || !AGENTS.has(x.agents.A as string) || !AGENTS.has(x.agents.B as string)) err.push('agents: not {A, B} agent kinds');
  } else err.push('type: not decision or end');
  return err;
}

export interface ValidationReport {
  lines: number;
  decisionLines: number;
  endLines: number;
  games: number;
  /** Line-numbered errors (first 20 kept) and their total. */
  errors: string[];
  errorCount: number;
}

/**
 * Validates every line of a log (plain or .gz) and the join: each game has exactly one end line,
 * after its decision lines, whose decisions count equals the game's decision lines, numbered 0 to
 * decisions - 1 in order.
 */
export async function validateLogFile(path: string): Promise<ValidationReport> {
  const src: Readable = path.endsWith('.gz') ? createReadStream(path).pipe(createGunzip()) : createReadStream(path);
  const rl = createInterface({ input: src, crlfDelay: Infinity });
  const r: ValidationReport = { lines: 0, decisionLines: 0, endLines: 0, games: 0, errors: [], errorCount: 0 };
  const fail = (msg: string): void => { r.errorCount++; if (r.errors.length < 20) r.errors.push(msg); };
  const seen = new Map<number, number>();
  const ended = new Set<number>();
  for await (const text of rl) {
    r.lines++;
    let x: unknown;
    try { x = JSON.parse(text); } catch { fail(`line ${r.lines}: not JSON`); continue; }
    for (const e of validateLine(x)) fail(`line ${r.lines}: ${e}`);
    if (!isObj(x) || !isInt(x.game)) continue;
    const g = x.game;
    if (x.type === 'decision') {
      r.decisionLines++;
      const next = seen.get(g) ?? 0;
      if (ended.has(g)) fail(`line ${r.lines}: decision of game ${g} after its end line`);
      if (x.d !== next) fail(`line ${r.lines}: game ${g} decision index ${String(x.d)}, expected ${next}`);
      seen.set(g, next + 1);
    } else if (x.type === 'end') {
      r.endLines++;
      if (ended.has(g)) fail(`line ${r.lines}: second end line for game ${g}`);
      ended.add(g);
      if (x.decisions !== (seen.get(g) ?? 0)) fail(`line ${r.lines}: game ${g} end says ${String(x.decisions)} decisions, log has ${seen.get(g) ?? 0}`);
    }
  }
  for (const g of seen.keys()) if (!ended.has(g)) fail(`game ${g}: no end line`);
  r.games = ended.size;
  return r;
}

// ---------- command line ----------

export const SELFPLAY_USAGE = `usage: selfplay-log --games N --a greedy|mcts --b greedy|mcts --out path.jsonl[.gz] [--seed S] [--workers W] [--block-size G]
       selfplay-log --validate path.jsonl[.gz]
  Plays N games (A = Rakdos Midrange, B = Mono-Red Aggro, play alternates) and writes one JSON line per decision
  plus one end line per game (schema: docs/JSONL-SCHEMA.md). mcts uses its default budget; for other budgets use
  match ... --log path.jsonl.`;

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${name} needs a value\n${SELFPLAY_USAGE}`);
  return v;
}

function intFlag(argv: readonly string[], name: string, dflt: number, min: number): number {
  const v = flag(argv, name);
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}, got ${v}`);
  return n;
}

export function fmtBytes(n: number): string {
  return n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(2)} GiB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MiB` : `${(n / 1024).toFixed(1)} KiB`;
}

export function fmtLogStats(s: LogStats): string {
  return `log: ${s.path}: ${s.lines} lines (${s.decisionLines} decision lines, ${s.endLines} game-end lines), ${fmtBytes(s.bytes)} on disk${s.gzip ? ` (${fmtBytes(s.rawBytes)} uncompressed)` : ''}`;
}

export function fmtValidation(path: string, v: ValidationReport): string {
  return [
    `validate ${path}: ${v.lines} lines checked (${v.decisionLines} decision, ${v.endLines} end), ${v.games} games joined, ${v.errorCount} errors`,
    ...v.errors.map((e) => `  ${e}`),
  ].join('\n');
}

export async function selfplayCommand(argv: readonly string[]): Promise<number> {
  const vpath = flag(argv, '--validate');
  if (vpath !== undefined) {
    const v = await validateLogFile(vpath);
    console.log(fmtValidation(vpath, v));
    return v.errorCount === 0 && v.lines > 0 ? 0 : 1;
  }
  const kind = (name: string): AgentKind => {
    const v = flag(argv, name) ?? 'greedy';
    if (v !== 'greedy' && v !== 'mcts') throw new Error(`${name} must be greedy or mcts, got ${v}\n${SELFPLAY_USAGE}`);
    return v;
  };
  const out = flag(argv, '--out');
  if (out === undefined) throw new Error(`--out is required\n${SELFPLAY_USAGE}`);
  const a = kind('--a');
  const b = kind('--b');
  const games = intFlag(argv, '--games', 1000, 1);
  const seed = intFlag(argv, '--seed', 1, Number.MIN_SAFE_INTEGER);
  const workers = intFlag(argv, '--workers', defaultWorkers(), 0);
  const blockSize = intFlag(argv, '--block-size', 25, 1);
  const job: MatchJob = { deckA: 'deckA', deckB: 'deckB', agentA: { kind: a }, agentB: { kind: b }, play: 'alternate', keyCards: [...DEFAULT_KEY_CARDS] };
  const t0 = performance.now();
  const { report, log, logSeconds } = await runLogged(job, { games, seed, workers, blockSize }, out);
  const total = (performance.now() - t0) / 1000;
  console.log(`selfplay-log: A = Rakdos Midrange (${a}) vs B = Mono-Red Aggro (${b}), seed ${seed}, ${report.games} games on ${report.workers} worker${report.workers === 1 ? '' : 's'}`);
  console.log(fmtLogStats(log));
  console.log(`elapsed: ${total.toFixed(1)} s wall (${report.seconds.toFixed(1)} s playing and writing parts, ${logSeconds.toFixed(1)} s joining)`);
  if (log.endLines !== report.games) throw new Error(`selfplay-log: ${log.endLines} end lines for ${report.games} games`);
  if (log.decisionLines !== report.decisions) throw new Error(`selfplay-log: ${log.decisionLines} decision lines for ${report.decisions} decisions`);
  console.log(`checked: ${log.endLines} end lines = ${report.games} games; ${log.decisionLines} decision lines = ${report.decisions} runner decisions`);
  return 0;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  selfplayCommand(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
