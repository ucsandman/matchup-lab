// Local web UI server (PLAN.md section 8, Phase 5; docs/WEB-UI.md): node:http on 127.0.0.1, no
// framework and no runtime dependency.
//
//   node --import tsx src/web/server.ts [--port 3456]
//   node dist/web/server.js [--port 3456]            (after npm run build)
//   scripts/web.ps1 [--port 3456]                     (builds dist when it is missing or older than src)
//
// Routes:
//   GET  /, /app.js, /style.css   the page (web/)
//   GET  /api/decks               both main decks with oracle text, image links and the token names
//   GET  /api/example             spots/example.json (the page's Load the example board button)
//   POST /api/spot                a spot (docs/SPOT-FORMAT.md) plus "player" and "budget"; runs the
//                                 same loader, search and report code as the spot command
//   POST /api/hand                {hand, play, mulligans, bottom?, maxGames?}; runs the hand tool
//   POST /api/match               {a, b, games, seed?, workers?}; runs the match command's runner
//   GET  /api/progress            the running (or last) analysis: kind, games played so far, seconds
//   GET  /img/<set>/<number>      a card image, proxied from Scryfall (see the image proxy below)
// Card images come from Scryfall's image endpoint, built from each card's scryfall_uri in
// decks/oracle.json (oracle.json has no image URIs); the page shows the card name when an image
// cannot load. Bad input answers 400 with {"error": message}; one analysis runs at a time (409).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKENS } from '../cards/tokens.js';
import { loadDeckFile } from '../engine/setup.js';
import { SpotError, loadSpot } from '../tools/spot-schema.js';
import { DeterminizeError } from '../agents/determinize.js';
import { defaultSearchWorkers, searchViewParallel } from '../agents/ismcts.js';
import { DETERMINIZATION_SENTENCE, HEURISTIC_SENTENCE, fmtStep, formatSpotReport, type SpotArgs } from '../cli/spot.js';
import { analyzeHand, DEFAULTS as HAND_DEFAULTS, formatHandReport, resolveHand } from '../tools/goldfish.js';
import { defaultWorkers, runMatch } from '../sim/runner.js';
import { DEFAULT_KEY_CARDS, type MatchJob } from '../sim/games.js';
import { formatReport, parseMatchArgs } from '../cli/index.js';
import { UsageError } from '../cli/args.js';
import { validationNote } from '../cli/validation.js';
import type { PlayerId } from '../engine/types.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = join(ROOT, 'web');
const IMAGE_CACHE = join(ROOT, 'out', 'card-images');
export const DEFAULT_PORT = 3456;

/** Search budgets offered by the page: the plain UCT search. 'standard' is the spot command's --mode uct (8 x 400); since D27 the spot command's default is the validated mode, which the page does not run. */
export const BUDGETS = {
  quick: { samples: 4, iterations: 100, label: 'Quick: 4 samples x 100 searches each' },
  standard: { samples: 8, iterations: 400, label: 'Standard: 8 samples x 400 searches each (the spot command with --mode uct)' },
  deep: { samples: 16, iterations: 2000, label: 'Deep: 16 samples x 2000 searches each' },
} as const;
type BudgetName = keyof typeof BUDGETS;

class BadRequest extends Error {}

// ---- decks --------------------------------------------------------------------------------------

interface OracleFace { name: string; mana_cost: string; type_line: string; oracle_text: string; power: string | null; toughness: string | null; loyalty: string | null }
interface OracleCard extends OracleFace { layout: string; card_faces: OracleFace[]; scryfall_uri: string }

/** Set code and collector number from a card's scryfall_uri. */
function setAndNumber(scryfallUri: string): [string, string] | null {
  const m = /scryfall\.com\/card\/([a-z0-9]+)\/([a-z0-9]+)\//.exec(scryfallUri);
  return m ? [m[1] as string, m[2] as string] : null;
}

/** The page's link for a card image: /img/<set>/<number>, served by the proxy below. */
export function imageUrl(scryfallUri: string, back = false): string | null {
  const sn = setAndNumber(scryfallUri);
  return sn ? `/img/${sn[0]}/${sn[1]}${back ? '?face=back' : ''}` : null;
}

// ---- card image proxy -------------------------------------------------------------------------
// Scryfall's image endpoint (api.scryfall.com/cards/<set>/<number>?format=image) is rate limited
// (about 10 requests a second); a page of 41 tiles asking at once got most images refused. The
// proxy fetches one image at a time, only for cards in decks/oracle.json, and keeps each image in
// out/card-images/ so later starts are instant and work offline.

let allowed: Set<string> | null = null;
function allowedImages(): Set<string> {
  if (allowed) return allowed;
  const oracle = JSON.parse(readFileSync(join(ROOT, 'decks', 'oracle.json'), 'utf8')) as Record<string, { scryfall_uri: string }>;
  allowed = new Set(Object.values(oracle).map((o) => setAndNumber(o.scryfall_uri)).filter((x): x is [string, string] => x !== null).map((x) => x.join('/')));
  return allowed;
}

let upstream: Promise<unknown> = Promise.resolve();
const SPACING_MS = 120;

function fetchQueued(url: string): Promise<Buffer> {
  const job = upstream.then(async () => {
    const res = await fetch(url, { headers: { 'user-agent': 'mtg-matchup-solver/0.0.1 (local web UI)', accept: 'image/*' } });
    await new Promise((ok) => setTimeout(ok, SPACING_MS));
    if (!res.ok) throw new Error(`Scryfall answered ${res.status} for ${url}`);
    return Buffer.from(await res.arrayBuffer());
  });
  upstream = job.catch(() => undefined);
  return job;
}

const inFlight = new Map<string, Promise<Buffer>>();

/** The image bytes for set/number (front or back face), from the disk cache or Scryfall; null when the card is not in oracle.json. */
export async function cardImage(set: string, num: string, back: boolean): Promise<Buffer | null> {
  const key = `${set}/${num}`;
  if (!allowedImages().has(key)) return null;
  const file = join(IMAGE_CACHE, `${set}-${num}${back ? '-back' : ''}.jpg`);
  if (existsSync(file)) return readFileSync(file);
  const id = `${key}${back ? '/back' : ''}`;
  let p = inFlight.get(id);
  if (!p) {
    p = fetchQueued(`https://api.scryfall.com/cards/${set}/${num}?format=image&version=normal${back ? '&face=back' : ''}`).then((buf) => {
      mkdirSync(IMAGE_CACHE, { recursive: true });
      writeFileSync(file, buf);
      return buf;
    }).finally(() => inFlight.delete(id));
    inFlight.set(id, p);
  }
  return p;
}

const DFC_LAYOUTS = new Set(['transform', 'modal_dfc']);

function faceOut(f: OracleFace): Record<string, unknown> {
  return {
    name: f.name, manaCost: f.mana_cost, typeLine: f.type_line, oracleText: f.oracle_text,
    pt: f.power !== null && f.toughness !== null ? `${f.power}/${f.toughness}` : null, loyalty: f.loyalty === null ? null : Number(f.loyalty),
  };
}

let decksCache: unknown = null;
export function decksPayload(): unknown {
  if (decksCache) return decksCache;
  const oracle = JSON.parse(readFileSync(join(ROOT, 'decks', 'oracle.json'), 'utf8')) as Record<string, OracleCard>;
  const deck = (file: string, player: PlayerId): unknown => {
    const list = loadDeckFile(file);
    const cards = list.main.map(({ count, name }) => {
      const o = oracle[name];
      if (!o) throw new Error(`decks/${file}.json: ${name} is not in decks/oracle.json`);
      const faces = o.card_faces.length > 0 ? o.card_faces : [o];
      const dfc = DFC_LAYOUTS.has(o.layout);
      const front = faces[0] as OracleFace;
      return {
        name, count, layout: o.layout, dfc,
        frontName: front.name,
        faces: faces.map(faceOut),
        typeLine: o.type_line,
        image: imageUrl(o.scryfall_uri), backImage: dfc ? imageUrl(o.scryfall_uri, true) : null,
        land: /\bLand\b/.test(front.type_line),
        saga: /\bSaga\b/.test(front.type_line),
        planeswalker: /\bPlaneswalker\b/.test(front.type_line),
        creature: /\bCreature\b/.test(front.type_line),
        scryfall: o.scryfall_uri,
      };
    });
    return { player, label: player === 0 ? 'A' : 'B', archetype: list.archetype ?? file, size: list.main.reduce((s, c) => s + c.count, 0), cards };
  };
  // Monster (a Role, needs attachedTo) and Copy (needs the copied card) come only from an imported spot.
  const tokens = TOKENS.filter((t) => t.name !== 'Monster' && t.name !== 'Copy').map((t) => {
    const f = t.faces[0];
    return { name: t.name, typeLine: f ? [...f.types, ...(f.subtypes.length ? ['-', ...f.subtypes] : [])].join(' ') : '', pt: f?.pt ? `${f.pt[0]}/${f.pt[1]}` : null, creature: f?.types.includes('Creature') ?? false };
  });
  decksCache = {
    decks: [deck('deckA', 0), deck('deckB', 1)], tokens, budgets: BUDGETS,
    notes: [HEURISTIC_SENTENCE, DETERMINIZATION_SENTENCE],
  };
  return decksCache;
}

// ---- spot ---------------------------------------------------------------------------------------

const EXTRA_KEYS = ['player', 'budget', 'seed', 'top', 'workers'] as const;

function parsePlayer(x: unknown): PlayerId | null {
  if (x === undefined || x === null || x === '') return null;
  if (x === 0 || x === 'A' || x === 'a' || x === '0') return 0;
  if (x === 1 || x === 'B' || x === 'b' || x === '1') return 1;
  throw new BadRequest(`player must be "A" or "B", got ${JSON.stringify(x)}`);
}

function intIn(x: unknown, name: string, dflt: number, min: number, max: number): number {
  if (x === undefined || x === null) return dflt;
  if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < min || x > max) throw new BadRequest(`${name} must be an integer from ${min} to ${max}, got ${JSON.stringify(x)}`);
  return x;
}

function parseBudget(x: unknown): { samples: number; iterations: number; name: string } {
  if (x === undefined || x === null) return { ...BUDGETS.standard, name: 'standard' };
  if (typeof x === 'string') {
    if (!(x in BUDGETS)) throw new BadRequest(`budget must be one of ${Object.keys(BUDGETS).join(', ')} or {"samples": D, "iterations": I}, got ${JSON.stringify(x)}`);
    return { ...BUDGETS[x as BudgetName], name: x };
  }
  if (typeof x === 'object' && !Array.isArray(x)) {
    const o = x as Record<string, unknown>;
    return { samples: intIn(o.samples, 'budget.samples', 8, 1, 64), iterations: intIn(o.iterations, 'budget.iterations', 400, 1, 20000), name: 'custom' };
  }
  throw new BadRequest(`budget must be a name or {"samples": D, "iterations": I}, got ${JSON.stringify(x)}`);
}

export async function runSpot(body: unknown): Promise<Record<string, unknown>> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new BadRequest('the body must be a spot object (docs/SPOT-FORMAT.md) with optional "player" and "budget"');
  const b = body as Record<string, unknown>;
  const spot: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) if (!(EXTRA_KEYS as readonly string[]).includes(k)) spot[k] = v;
  const player = parsePlayer(b.player);
  const budget = parseBudget(b.budget);
  const seed = intIn(b.seed, 'seed', 1, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const top = intIn(b.top, 'top', 5, 1, 50);
  const workers = intIn(b.workers, 'workers', Math.min(budget.samples, defaultSearchWorkers()), 0, 256);
  let loaded;
  try { loaded = loadSpot(spot); } catch (e) {
    if (e instanceof SpotError) throw new BadRequest(e.message);
    throw e;
  }
  const args: SpotArgs = {
    file: '(board from the web page)', player, samples: budget.samples, iterations: budget.iterations, ms: null,
    rollout: 'truncated', turns: 2, seed, workers, top, json: false,
  };
  let r;
  try {
    r = await searchViewParallel(loaded.view, {
      samples: args.samples, iterations: budget.iterations, rollout: args.rollout, rolloutTurns: args.turns, seed,
      decks: loaded.decks, player: player ?? loaded.view.viewer,
    }, workers);
  } catch (e) {
    if (e instanceof DeterminizeError || (e instanceof Error && e.message.includes('determinize:'))) throw new BadRequest(e.message);
    throw e;
  }
  const note = typeof spot.note === 'string' ? spot.note : undefined;
  const lines = r.lines.slice(0, top).map((l, i) => ({
    rank: i + 1, move: l.text, stat: fmtStep(l), visits: `visits ${l.visits} of ${r.rollouts}, in ${l.samples} of ${r.samples} samples`,
    win: l.win, visitsN: l.visits, samples: l.samples,
    pv: l.pv.map((s) => ({ move: s.text, stat: fmtStep(s) })),
  }));
  return {
    report: formatSpotReport(r, args, note),
    budget: { name: budget.name, samples: budget.samples, iterations: budget.iterations },
    perspective: r.perspective === 0 ? 'A' : 'B', viewer: r.viewer === 0 ? 'A' : 'B',
    decider: r.decider === null ? null : r.decider === 0 ? 'A' : 'B',
    rootMoves: r.lines.length, rollouts: r.rollouts, samples: r.samples,
    total: { stat: fmtStep(r.total), win: r.total.win },
    lines, seconds: r.seconds, elapsed: `elapsed ${r.seconds.toFixed(1)} s (one run)`,
    notes: [HEURISTIC_SENTENCE, DETERMINIZATION_SENTENCE],
  };
}

// ---- hand ---------------------------------------------------------------------------------------

function nameList(x: unknown, what: string): string[] {
  if (!Array.isArray(x) || !x.every((c) => typeof c === 'string')) throw new BadRequest(`${what} must be an array of card names`);
  return x as string[];
}

/** Progress reporter: games played so far and the most the run can play (null when unknown). */
export type OnProgress = (games: number, total: number | null) => void;

export async function runHand(body: unknown, onProgress?: OnProgress): Promise<Record<string, unknown>> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new BadRequest('the body must be {"hand": [...], "play": true|false, "mulligans": N}');
  const b = body as Record<string, unknown>;
  const hand = nameList(b.hand, 'hand');
  if (typeof b.play !== 'boolean') throw new BadRequest('play must be true (on the play) or false (on the draw)');
  const mulligans = intIn(b.mulligans, 'mulligans', 0, 0, 5);
  const bottom = b.bottom === undefined || b.bottom === null ? [] : nameList(b.bottom, 'bottom');
  const opts = {
    hand, onThePlay: b.play, mulligans, ...(bottom.length ? { bottom } : {}),
    seed: intIn(b.seed, 'seed', 1, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    workers: intIn(b.workers, 'workers', defaultWorkers(), 0, 256),
    maxGames: intIn(b.maxGames, 'maxGames', HAND_DEFAULTS.maxGames, 1, 20000),
    batch: intIn(b.batch, 'batch', HAND_DEFAULTS.batch, 1, 20000),
    goldfishGames: intIn(b.goldfishGames, 'goldfishGames', HAND_DEFAULTS.goldfishGames, 0, 20000),
  };
  try { resolveHand(opts); } catch (e) { throw new BadRequest((e as Error).message); }
  const total = 2 * opts.maxGames + opts.goldfishGames;
  onProgress?.(0, total);
  // The goldfish games ride on the first look, so after a look they are all played.
  const r = await analyzeHand(opts, onProgress ? { onLook: (_look, keep, mull) => onProgress(keep.n + mull.n + opts.goldfishGames, total) } : {});
  return { report: formatHandReport(r), result: r, notes: [r.sentence] };
}

// ---- match --------------------------------------------------------------------------------------

const AGENT_KINDS = ['random', 'greedy', 'mcts'];

/** Agent vs agent: the match command's argument parser, runner and report (src/cli/index.ts). */
export async function runMatchApi(body: unknown, onProgress?: OnProgress): Promise<Record<string, unknown>> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new BadRequest('the body must be {"a": "greedy"|"mcts", "b": "greedy"|"mcts", "games": N}');
  const b = body as Record<string, unknown>;
  for (const side of ['a', 'b'] as const) {
    const v = b[side] ?? 'greedy';
    if (typeof v !== 'string' || !AGENT_KINDS.includes(v)) throw new BadRequest(`${side} must be one of ${AGENT_KINDS.join(', ')}, got ${JSON.stringify(v)}`);
  }
  const games = intIn(b.games, 'games', 100, 1, 2000);
  const seed = intIn(b.seed, 'seed', 1, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const workers = intIn(b.workers, 'workers', defaultWorkers(), 0, 256);
  let a;
  try {
    a = parseMatchArgs(['--a', String(b.a ?? 'greedy'), '--b', String(b.b ?? 'greedy'), '--games', String(games), '--seed', String(seed), '--workers', String(workers)]);
  } catch (e) {
    if (e instanceof UsageError) throw new BadRequest(e.message);
    throw e;
  }
  const job: MatchJob = {
    deckA: 'deckA', deckB: 'deckB', agentA: { kind: a.a, mcts: a.mcts }, agentB: { kind: a.b, mcts: a.mcts }, play: a.play,
    keyCards: [...DEFAULT_KEY_CARDS],
  };
  onProgress?.(0, games);
  const r = await runMatch(job, { games, seed, workers, blockSize: a.blockSize, ...(onProgress ? { onProgress: (n: number) => onProgress(n, games) } : {}) });
  const { perGame: _perGame, gamesPerSecPerCore: _wallRate, ...rest } = r;
  return {
    report: formatReport(r, a), agents: { a: a.a, b: a.b }, ...rest,
    elapsed: `elapsed ${r.seconds.toFixed(1)} s (one run)`,
    validation: a.a === 'mcts' || a.b === 'mcts' ? validationNote(a.mcts.mode, a.mcts) : null,
    notes: [HEURISTIC_SENTENCE],
  };
}

// ---- http ---------------------------------------------------------------------------------------

const STATIC: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

const MAX_BODY = 1 << 20;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { fail(new BadRequest('request body over 1 MB')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { ok(JSON.parse(text)); } catch (e) { fail(new BadRequest(`the body is not valid JSON: ${(e as Error).message}`)); }
    });
    req.on('error', fail);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

interface Progress { running: boolean; kind: string | null; games: number; total: number | null; seconds: number }

export function createWebServer(): Server {
  let busy = false;
  let progress: Progress = { running: false, kind: null, games: 0, total: null, seconds: 0 };
  let started = 0;
  const report: OnProgress = (games, total) => { progress = { ...progress, games, total, seconds: (Date.now() - started) / 1000 }; };
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    void (async () => {
      try {
        if (req.method === 'GET' && STATIC[path]) {
          const [file, type] = STATIC[path] as [string, string];
          res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
          res.end(readFileSync(join(WEB, file)));
          return;
        }
        const img = /^\/img\/([a-z0-9]+)\/([a-z0-9]+)$/.exec(path);
        if (req.method === 'GET' && img) {
          let buf: Buffer | null;
          try { buf = await cardImage(img[1] as string, img[2] as string, url.searchParams.get('face') === 'back'); } catch (e) {
            send(res, 502, { error: (e as Error).message }); return;
          }
          if (!buf) { send(res, 404, { error: `no card image ${path} (only cards in decks/oracle.json)` }); return; }
          res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' });
          res.end(buf);
          return;
        }
        if (req.method === 'GET' && path === '/api/decks') { send(res, 200, decksPayload()); return; }
        if (req.method === 'GET' && path === '/api/example') { send(res, 200, JSON.parse(readFileSync(join(ROOT, 'spots', 'example.json'), 'utf8'))); return; }
        if (req.method === 'GET' && path === '/api/progress') {
          send(res, 200, progress.running ? { ...progress, seconds: (Date.now() - started) / 1000 } : progress);
          return;
        }
        if (req.method === 'POST' && (path === '/api/spot' || path === '/api/hand' || path === '/api/match')) {
          const body = await readBody(req);
          if (busy) { send(res, 409, { error: 'another analysis is still running; wait for it to finish' }); return; }
          busy = true;
          started = Date.now();
          const kind = path.slice(5);
          progress = { running: true, kind, games: 0, total: null, seconds: 0 };
          try {
            send(res, 200, kind === 'spot' ? await runSpot(body) : kind === 'hand' ? await runHand(body, report) : await runMatchApi(body, report));
          } finally {
            busy = false;
            progress = { ...progress, running: false, seconds: (Date.now() - started) / 1000 };
          }
          return;
        }
        send(res, 404, { error: `no route ${req.method ?? ''} ${path}` });
      } catch (e) {
        if (e instanceof BadRequest) send(res, 400, { error: e.message });
        else send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });
}

/** Starts the server on 127.0.0.1 (port 0 picks a free port); resolves with its URL. */
export function startWebServer(port = DEFAULT_PORT): Promise<{ server: Server; url: string }> {
  const server = createWebServer();
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      ok({ server, url: `http://127.0.0.1:${p}/` });
    });
  });
}

function portArg(argv: readonly string[]): number {
  const i = argv.indexOf('--port');
  if (i < 0) return DEFAULT_PORT;
  const n = Number(argv[i + 1]);
  if (!Number.isSafeInteger(n) || n < 0 || n > 65535) throw new Error(`--port must be an integer from 0 to 65535, got ${argv[i + 1] ?? '(nothing)'}`);
  return n;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startWebServer(portArg(process.argv.slice(2))).then(({ url }) => {
    console.log(`MTG matchup web UI: open ${url} in your browser (Ctrl+C stops the server)`);
  }, (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
