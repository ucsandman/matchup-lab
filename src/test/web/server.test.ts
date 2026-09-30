// The web UI (src/web/server.ts, web/; docs/WEB-UI.md; PLAN.md section 8, Phase 5): the JSON
// endpoints return n and a 95 percent interval with every number and the warning sentences, bad
// input answers 400 with a message, and the page's own state code (web/app.js, loaded in node
// without a DOM) turns clicks into a spot file the loader accepts.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWebServer } from '../../web/server.js';
import { DETERMINIZATION_SENTENCE, HEURISTIC_SENTENCE } from '../../cli/spot.js';
import { loadSpot } from '../../tools/spot-schema.js';

let server: Server;
let base = '';

beforeAll(async () => {
  const s = await startWebServer(0);
  server = s.server;
  base = s.url.replace(/\/$/, '');
});
afterAll(() => new Promise<void>((ok) => { server.close(() => ok()); }));

const post = async (path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

const example = (): Record<string, unknown> => JSON.parse(readFileSync('spots/example.json', 'utf8')) as Record<string, unknown>;

/** Every report line with a percentage (except input echoes, notes, warnings and the file's own note) carries an interval and n. Returns the count checked. */
function checkLines(report: string, skip: RegExp): number {
  let checked = 0;
  for (const l of report.split('\n')) {
    if (!l.includes('%') || skip.test(l)) continue;
    expect(l, l).toMatch(/\d+(\.\d+)?% CI/);
    expect(l, l).toMatch(/n=\d+/);
    checked++;
  }
  return checked;
}

interface Deck { size: number; archetype: string; cards: { name: string; count: number; image: string | null; faces: { oracleText: string }[] }[] }
interface DecksPayload { decks: Deck[]; tokens: { name: string }[]; budgets: Record<string, unknown>; notes: string[] }

describe('web server: static page', () => {
  it('serves index.html, app.js and style.css', async () => {
    const pages = [['/', 'text/html', 'Rakdos Midrange vs Mono-Red Aggro'], ['/app.js', 'text/javascript', 'MTGBoard'], ['/style.css', 'text/css', '.tile']] as const;
    for (const [path, type, text] of pages) {
      const res = await fetch(base + path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain(type);
      expect(await res.text()).toContain(text);
    }
    const html = await (await fetch(base + '/')).text();
    expect(html).toContain('>Matchup Lab</a></h1>');
    expect(html).toContain('Rakdos Midrange vs Mono-Red Aggro (Pioneer). Ask a question, get win rates from thousands of simulated games.');
    expect(html).toContain(HEURISTIC_SENTENCE);
    console.log(`checked ${pages.length} static files`);
  });

  it('the image proxy refuses a card that is not in decks/oracle.json (404, no network call)', async () => {
    const res = await fetch(base + '/img/xyz/999');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/only cards in decks\/oracle.json/);
  });

  it('404 with a message for an unknown route', async () => {
    const res = await fetch(base + '/nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/no route GET \/nope/);
  });
});

describe('GET /api/decks', () => {
  it('both 60-card main decks with oracle text and a Scryfall image link per card, the tokens and the two sentences', async () => {
    const j = (await (await fetch(base + '/api/decks')).json()) as DecksPayload;
    expect(j.decks.map((d) => d.archetype)).toEqual(['Rakdos Midrange', 'Mono-Red Aggro']);
    let cards = 0;
    for (const d of j.decks) {
      expect(d.size).toBe(60);
      expect(d.cards.reduce((s, c) => s + c.count, 0)).toBe(60);
      for (const c of d.cards) {
        expect(c.image, c.name).toMatch(/^\/img\/[a-z0-9]+\/[a-z0-9]+$/);
        expect(c.faces.length).toBeGreaterThan(0);
        expect(c.faces.every((f) => f.oracleText.length > 0 || c.name === 'Swamp' || c.name === 'Mountain'), c.name).toBe(true);
        cards++;
      }
    }
    expect(j.tokens.map((t) => t.name)).toContain('Blood');
    expect(j.notes).toEqual([HEURISTIC_SENTENCE, DETERMINIZATION_SENTENCE]);
    console.log(`checked ${cards} distinct cards in 2 decks`);
    expect(cards).toBe(41);
  });
});

describe('POST /api/spot', () => {
  it('runs the spot analyzer on a spot fixture (worker threads): n and a CI on every number, the CLI report, both sentences', async () => {
    const body = { ...example(), player: 'A', budget: { samples: 2, iterations: 40 }, seed: 7, workers: 2 };
    const { status, json } = await post('/api/spot', body);
    expect(status, JSON.stringify(json)).toBe(200);
    const lines = json.lines as { move: string; stat: string; visits: string; visitsN: number; win: { n: number; lo: number; hi: number; est: number } }[];
    expect(json.rollouts).toBe(80);
    expect(lines.length).toBe(Math.min(5, json.rootMoves as number));
    for (const l of lines) {
      expect(l.stat).toMatch(/^win [\d.]+% \[95% CI [\d.]+%-[\d.]+%, n=\d+ rollouts\]; mean value [\d.]+ \[(95% CI [\d.-]+-[\d.]+, t interval, SE [\d.]+|no interval below 2 rollouts), n=\d+\]$/);
      expect(l.win.n).toBe(l.visitsN);
      expect(l.win.lo).toBeLessThanOrEqual(l.win.hi);
      expect(l.visits).toMatch(/^visits \d+ of 80, in \d of 2 samples$/);
    }
    expect((json.total as { stat: string }).stat).toMatch(/n=80 rollouts/);
    expect(json.notes).toEqual([HEURISTIC_SENTENCE, DETERMINIZATION_SENTENCE]);
    expect(json.elapsed).toMatch(/^elapsed \d+\.\d s \(one run\)$/);
    const report = json.report as string;
    expect(report.split('\n').slice(-2)).toEqual([HEURISTIC_SENTENCE, DETERMINIZATION_SENTENCE]);
    for (const l of lines) expect(report).toContain(l.stat);
    const n = checkLines(report, /^spot:/);
    console.log(`checked ${lines.length} top lines and ${n} report lines`);
    expect(n).toBeGreaterThanOrEqual(1 + 2 * lines.length);
  }, 120_000);

  it('bad input: 400 with the loader\'s message', async () => {
    const cases: [unknown, RegExp][] = [
      ['{not json', /not valid JSON/],
      [[1, 2], /must be a spot object/],
      [{ spot: 1 }, /missing required field "viewer"/],
      [{ ...example(), budget: 'huge' }, /budget must be one of quick, standard, deep/],
      [{ ...example(), player: 'C' }, /player must be "A" or "B"/],
      [{ ...example(), battlefield: [{ name: 'Sheoldred the Apocalypse', controller: 0 }] }, /did you mean "Sheoldred, the Apocalypse"/],
      [{ ...example(), budget: { samples: 0, iterations: 10 } }, /budget.samples must be an integer from 1 to 64/],
    ];
    for (const [body, msg] of cases) {
      const { status, json } = await post('/api/spot', body);
      expect(status, JSON.stringify(json)).toBe(400);
      expect(json.error).toMatch(msg);
    }
    console.log(`checked ${cases.length} bad inputs`);
  });
});

describe('POST /api/hand', () => {
  const HAND = ['Blood Crypt', 'Blackcleave Cliffs', 'Swamp', 'Fatal Push', 'Fatal Push', 'Bloodtithe Harvester', 'Fable of the Mirror-Breaker'];

  it('runs the hand tool on a hand fixture: verdict, n and a CI on every number, the sentence', async () => {
    const { status, json } = await post('/api/hand', { hand: HAND, play: false, mulligans: 1, bottom: ['Swamp'], maxGames: 20, batch: 10, goldfishGames: 8, workers: 4, seed: 1 });
    expect(status, JSON.stringify(json)).toBe(200);
    const r = json.result as { verdict: string; keep: { win: { n: number; lo: number; hi: number } }; mulligan: { win: { n: number } }; games: number; sentence: string };
    expect(['KEEP', 'MULLIGAN', 'TOO CLOSE TO CALL']).toContain(r.verdict);
    expect(r.keep.win.n).toBeGreaterThan(0);
    expect(r.mulligan.win.n).toBeGreaterThan(0);
    expect(r.keep.win.lo).toBeLessThanOrEqual(r.keep.win.hi);
    expect(json.notes).toEqual([HEURISTIC_SENTENCE]);
    const report = json.report as string;
    expect(report).toContain(`verdict: ${r.verdict}`);
    expect(report).toContain('input: bottom: Swamp (pinned with --bottom)');
    expect(report.split('\n').at(-1)).toBe(HEURISTIC_SENTENCE);
    const n = checkLines(report, /^(input|note|WARNING):/);
    console.log(`checked ${n} report lines over ${r.games} games`);
    expect(n).toBeGreaterThanOrEqual(8);
  }, 120_000);

  it('bad input: 400 with the hand tool\'s message', async () => {
    const cases: [unknown, RegExp][] = [
      [{ hand: ['Thoughtseize', 'Thoughtseize', 'Thoughtseize', 'Thoughtseize', 'Thoughtseize', 'Swamp', 'Swamp'], play: true }, /illegal hand: .*5 x Thoughtseize \(the list has 4\)/],
      [{ hand: HAND.slice(0, 5), play: true }, /the hand has 5 cards/],
      [{ hand: HAND }, /play must be true/],
      [{ hand: [...HAND.slice(0, 6), 'Lightning Bolt'], play: true }, /no card named 'Lightning Bolt'/],
      [{ hand: HAND, play: true, mulligans: 9 }, /mulligans must be an integer from 0 to 5/],
      [{ hand: 'Swamp', play: true }, /hand must be an array of card names/],
    ];
    for (const [body, msg] of cases) {
      const { status, json } = await post('/api/hand', body);
      expect(status, JSON.stringify(json)).toBe(400);
      expect(json.error).toMatch(msg);
    }
    console.log(`checked ${cases.length} bad inputs`);
  });
});

describe('POST /api/match and GET /api/progress', () => {
  it('plays agent vs agent games with the match runner: every win rate with n and a CI, the report, the sentence, the progress count', async () => {
    const idle = (await (await fetch(base + '/api/progress')).json()) as { running: boolean };
    expect(idle.running).toBe(false);
    const { status, json } = await post('/api/match', { a: 'greedy', b: 'greedy', games: 6, seed: 3, workers: 2 });
    expect(status, JSON.stringify(json)).toBe(200);
    type P = { k: number; n: number; est: number; lo: number; hi: number };
    const winA = json.winA as P;
    const winB = json.winB as P;
    expect(json.games).toBe(6);
    for (const p of [winA, winB, json.draws as P]) {
      expect(p.n).toBe(6);
      expect(p.lo).toBeLessThanOrEqual(p.est);
      expect(p.est).toBeLessThanOrEqual(p.hi);
    }
    expect(winA.k + winB.k + (json.draws as P).k).toBe(6);
    const turns = json.turns as { mean: { n: number; lo: number; hi: number } };
    expect(turns.mean.n).toBe(6);
    expect(json.agents).toEqual({ a: 'greedy', b: 'greedy' });
    expect(json.validation).toBeNull();
    expect(json.notes).toEqual([HEURISTIC_SENTENCE]);
    expect(json.elapsed).toMatch(/^elapsed \d+\.\d s \(one run\)$/);
    const report = json.report as string;
    expect(report).toContain('match: A = Rakdos Midrange (greedy) vs B = Mono-Red Aggro (greedy), seed 3, play alternate');
    const n = checkLines(report, /^(match|games):/);
    expect(n).toBeGreaterThanOrEqual(5);
    const done = (await (await fetch(base + '/api/progress')).json()) as { running: boolean; kind: string; games: number; total: number };
    expect(done).toMatchObject({ running: false, kind: 'match', games: 6, total: 6 });
    console.log(`checked ${n} report lines over 6 games`);
  }, 120_000);

  it('bad input: 400 with a message', async () => {
    const cases: [unknown, RegExp][] = [
      [{ a: 'perfect', b: 'greedy', games: 10 }, /a must be one of random, greedy, mcts/],
      [{ a: 'greedy', b: 7, games: 10 }, /b must be one of random, greedy, mcts/],
      [{ a: 'greedy', b: 'greedy', games: 0 }, /games must be an integer from 1 to 2000/],
      [[1], /the body must be/],
    ];
    for (const [body, msg] of cases) {
      const { status, json } = await post('/api/match', body);
      expect(status, JSON.stringify(json)).toBe(400);
      expect(json.error).toMatch(msg);
    }
    console.log(`checked ${cases.length} bad inputs`);
  });
});

// ---- the page's state code, without a browser --------------------------------------------------

interface Board { turn: number; step: string; players: { hand: unknown[] }[] }
interface Core {
  newBoard(): Board;
  findCard(decks: unknown, name: string): { card: { name: string; count: number } } | null;
  addCard(b: Board, info: unknown, p: number, zone: string): string | null;
  toSpot(b: Board): Record<string, unknown>;
  fromSpot(j: unknown, decks: unknown): Board;
}

describe('web/app.js state code (no DOM)', () => {
  const ctx: { MTGBoard?: Core } = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync('web/app.js', 'utf8'), ctx);
  const B = ctx.MTGBoard as Core;

  it('loads without a document and exposes the state functions', () => {
    expect(typeof B.toSpot).toBe('function');
  });

  it('import then export of spots/example.json gives the same view through the loader', async () => {
    const decks = ((await (await fetch(base + '/api/decks')).json()) as DecksPayload).decks;
    const ex = example();
    const out = B.toSpot(B.fromSpot(ex, decks));
    expect(JSON.stringify(loadSpot(out).view)).toBe(JSON.stringify(loadSpot(ex).view));
  });

  it('clicks build a board the loader accepts; a fifth copy and a token in hand are refused', async () => {
    const decks = ((await (await fetch(base + '/api/decks')).json()) as DecksPayload).decks;
    const card = (n: string): unknown => { const hit = B.findCard(decks, n); return { name: hit?.card.name, card: hit?.card }; };
    const b = B.newBoard();
    const clicks: [string, number, string][] = [
      ['Blood Crypt', 0, 'battlefield'], ['Swamp', 0, 'battlefield'], ['Sheoldred, the Apocalypse', 0, 'hand'],
      ['Fable of the Mirror-Breaker', 0, 'battlefield'], ['Thoughtseize', 0, 'graveyard'],
      ['Mountain', 1, 'battlefield'], ['Monastery Swiftspear', 1, 'battlefield'], ['Burst Lightning', 1, 'graveyard'], ['Screaming Nemesis', 1, 'hand'],
    ];
    for (const [n, p, z] of clicks) expect(B.addCard(b, card(n), p, z), n).toBeNull();
    expect(B.addCard(b, { name: 'Blood', token: true, card: {} }, 0, 'battlefield')).toBeNull();
    expect(B.addCard(b, { name: 'Blood', token: true, card: {} }, 0, 'hand')).toMatch(/only on the battlefield/);
    for (let i = 0; i < 3; i++) expect(B.addCard(b, card('Thoughtseize'), 0, 'exile')).toBeNull();
    expect(B.addCard(b, card('Thoughtseize'), 0, 'hand')).toMatch(/All 4 copies of Thoughtseize are already placed/);
    b.turn = 5;
    const spot = B.toSpot(b);
    const v = loadSpot(spot).view;
    expect(v.turn).toBe(5);
    expect(spot.battlefield).toEqual([
      { name: 'Blood Crypt', controller: 0 }, { name: 'Swamp', controller: 0 },
      { name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', controller: 0, counters: { lore: 1 } },
      { name: 'Mountain', controller: 1 }, { name: 'Monastery Swiftspear', controller: 1 }, { name: 'Blood', controller: 0 },
    ]);
    console.log(`checked ${clicks.length + 6} clicks`);
  });
});
