// Phase 6 decision log (src/sim/decision-log.ts, src/tools/selfplay-log.ts, docs/JSONL-SCHEMA.md):
// every line of a 20-game run passes the schema and the join, a PlayerView survives the trip
// through a line, no line carries anything hidden from its decider (the fuzz view-leak checker on
// the view, plus the same id and card rules over the legal moves, the chosen move and the search
// statistics), every game has its end line, the log is the same file for any worker count, and the
// checks fail when a line is broken on purpose.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLogged, validateLine, validateLogFile } from '../../tools/selfplay-log.js';
import { setLineObserver, type DecisionLine, type LogLine } from '../../sim/decision-log.js';
import { checkViewLeak } from '../../tools/play.js';
import { hiddenFrom } from '../../agents/sample.js';
import { view } from '../../engine/view.js';
import { cloneData } from '../../engine/mutate.js';
import { getDef } from '../../cards/index.js';
import { parseMatchArgs } from '../../cli/index.js';
import type { MatchJob } from '../../sim/games.js';
import type { GameState, ObjId } from '../../engine/types.js';

const GG: MatchJob = { deckA: 'deckA', deckB: 'deckB', agentA: { kind: 'greedy' }, agentB: { kind: 'greedy' }, play: 'alternate' };
const tmp = (): string => mkdtempSync(join(tmpdir(), 'selfplay-'));

const ID_KEYS = new Set(['id', 'sourceId', 'objId', 'target', 'attachedTo', 'stackId', 'bargain']);
const ID_ARRAYS = new Set(['battlefield', 'graveyard', 'exile', 'known', 'knownTop', 'knownBottom', 'from', 'ids', 'blocking', 'loyaltyUsed', 'discard', 'sacrifice', 'crewWith', 'assignments']);

/**
 * Throws when a decision line holds anything hidden from its decider: the view part is checked by
 * the fuzz view-leak checker (checkViewLeak, invariant 8) on the state the line was built from; the
 * rest of the line (legal moves, chosen move, search statistics) by the same rules: no hidden id
 * under an id key or in an id array, no hidden defId that no visible object shares, and no name of
 * such a card in any move text. Returns the hidden objects checked.
 */
function checkLineLeak(state: GameState, line: DecisionLine): number {
  const p = line.player;
  const n = checkViewLeak(state, p);
  const [h0, h1] = hiddenFrom(state, p);
  const hidden = new Set<ObjId>([...h0, ...h1]);
  const visibleDefs = new Set(Object.values(line.view.objects).map((o) => o.defId));
  const hiddenDefs = [...new Set([...hidden].map((id) => state.objects[id]?.defId as string))].filter((d) => !visibleDefs.has(d));
  const hiddenNames = hiddenDefs.flatMap((d) => { const def = getDef(d); return [def.name, ...def.faces.map((f) => f.name)]; });
  const walk = (x: unknown, key: string): void => {
    if (typeof x === 'number') {
      if ((ID_KEYS.has(key) || ID_ARRAYS.has(key)) && hidden.has(x)) throw new Error(`leak: hidden id ${x} under ${key} (game ${line.game}, d ${line.d})`);
      return;
    }
    if (Array.isArray(x)) { for (const y of x) walk(y, key); return; }
    if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) walk(y, k);
  };
  const rest = { legal: line.legal, move: line.move, search: line.search };
  walk(rest, '');
  const json = JSON.stringify(rest);
  for (const d of hiddenDefs) if (json.includes(`"${d}"`)) throw new Error(`leak: hidden defId ${d} (game ${line.game}, d ${line.d})`);
  const texts = [...line.legal.map((l) => l.text), ...(line.search?.root ?? []).map((r) => r.text)];
  for (const t of texts) for (const name of hiddenNames) if (t.includes(name)) throw new Error(`leak: hidden card ${name} in '${t}' (game ${line.game}, d ${line.d})`);
  return n;
}

/** Runs a logged match in-process and keeps each line with a copy of the state it was built from. */
async function observed(job: MatchJob, games: number, seed: number, out: string): Promise<{ pairs: { state: GameState; line: LogLine }[]; stats: Awaited<ReturnType<typeof runLogged>> }> {
  const pairs: { state: GameState; line: LogLine }[] = [];
  setLineObserver((state, line) => pairs.push({ state: cloneData(state), line: JSON.parse(JSON.stringify(line)) as LogLine }));
  try {
    const stats = await runLogged(job, { games, seed, workers: 0, blockSize: 5 }, out);
    return { pairs, stats };
  } finally {
    setLineObserver(null);
  }
}

describe('self-play decision log', () => {
  it('20 greedy games: every line passes the schema and the join, views round-trip, nothing hidden leaks, one end line per game', async () => {
    const out = join(tmp(), 'g20.jsonl');
    const { pairs, stats } = await observed(GG, 20, 11, out);
    const v = await validateLogFile(out);
    console.log(`schema: ${v.lines} lines validated (${v.decisionLines} decision, ${v.endLines} end), ${v.games} games joined, ${v.errorCount} errors`);
    expect(v.errors).toEqual([]);
    expect(v.errorCount).toBe(0);
    expect(v.endLines).toBe(20);
    expect(v.games).toBe(20);
    expect(v.decisionLines).toBe(stats.report.decisions);
    expect(v.lines).toBe(stats.log.lines);
    expect(v.decisionLines).toBeGreaterThan(20 * 20);
    // The file holds exactly the observed lines, in order.
    const fileLines = readFileSync(out, 'utf8').trimEnd().split('\n');
    expect(fileLines.length).toBe(pairs.length);
    expect(fileLines.map((l) => JSON.parse(l) as unknown)).toEqual(pairs.map((x) => x.line));
    // Outcome line per game, matching the runner's summary.
    const ends = pairs.map((x) => x.line).filter((l): l is Extract<LogLine, { type: 'end' }> => l.type === 'end');
    expect(ends.map((e) => e.game)).toEqual([...Array(20).keys()]);
    for (const e of ends) {
      const g = stats.report.perGame[e.game];
      expect(g).toBeDefined();
      expect(e.winner).toBe(g!.winner);
      expect(e.turns).toBe(g!.turns);
      expect(e.reason).toBe(g!.reason);
      expect(e.aOnPlay).toBe(g!.aOnPlay);
    }
    // Round trip and leak check on every decision line.
    let roundTrips = 0;
    let hiddenChecked = 0;
    for (const { state, line } of pairs) {
      if (line.type !== 'decision') continue;
      expect(line.view).toEqual(view(state, line.player));
      roundTrips++;
      hiddenChecked += checkLineLeak(state, line);
    }
    console.log(`round trip: ${roundTrips} PlayerViews equal after JSON; leak check: ${roundTrips} lines, ${hiddenChecked} hidden objects checked`);
    expect(roundTrips).toBe(v.decisionLines);
    expect(hiddenChecked).toBeGreaterThan(roundTrips * 10);
  }, 300_000);

  it('the checks fail on broken lines: a schema break and an injected hidden card are both caught', async () => {
    const out = join(tmp(), 'g2.jsonl');
    const { pairs } = await observed(GG, 2, 12, out);
    const pick = pairs.find((x) => x.line.type === 'decision' && x.line.turn >= 3 && x.line.legal.length > 1);
    expect(pick).toBeDefined();
    const { state, line } = pick as { state: GameState; line: DecisionLine };
    expect(validateLine(line)).toEqual([]);
    const broken: [string, (l: DecisionLine) => void][] = [
      ['chosen out of range', (l) => { l.chosen = l.legal.length; }],
      ['move differs from legal[chosen]', (l) => { l.move = { type: 'pass' }; l.chosen = l.legal.findIndex((m) => m.move.type !== 'pass'); }],
      ['view of the other player', (l) => { l.view.viewer = (1 - l.player) as 0 | 1; }],
      ['search on a greedy line', (l) => { l.search = { mode: 'forced' }; }],
      ['missing seed', (l) => { delete (l as Partial<DecisionLine>).seed; }],
    ];
    for (const [what, f] of broken) {
      const l = JSON.parse(JSON.stringify(line)) as DecisionLine;
      f(l);
      expect(validateLine(l).length, what).toBeGreaterThan(0);
    }
    expect(validateLine({ type: 'end', v: 1, game: 0, seed: 1, winner: 'A', winnerPlayer: 1, reason: 'life', turns: 9, decisions: 5, aOnPlay: true, agents: { A: 'greedy', B: 'greedy' } }).length).toBeGreaterThan(0);
    // An opponent's hidden hand card named in a move text, and its id in a move, are leaks.
    const opp = (1 - line.player) as 0 | 1;
    const hiddenId = hiddenFrom(state, line.player)[opp][0] as ObjId;
    expect(hiddenId).toBeDefined();
    expect(() => checkLineLeak(state, line)).not.toThrow();
    const withId = JSON.parse(JSON.stringify(line)) as DecisionLine;
    withId.legal.push({ text: 'x', move: { type: 'playLand', objId: hiddenId } });
    expect(() => checkLineLeak(state, withId)).toThrow(/hidden id/);
    const defId = state.objects[hiddenId]!.defId;
    const visible = new Set(Object.values(line.view.objects).map((o) => o.defId));
    const unseen = [...hiddenFrom(state, line.player)[opp]].map((id) => state.objects[id]!.defId).find((d) => !visible.has(d));
    if (unseen) {
      const withName = JSON.parse(JSON.stringify(line)) as DecisionLine;
      (withName.legal[0] as { text: string }).text += ` ${getDef(unseen).name}`;
      expect(() => checkLineLeak(state, withName)).toThrow(/hidden card/);
    }
    console.log(`negative checks: 5 schema breaks caught, hidden id ${hiddenId} (${defId}) caught${unseen ? `, hidden name of ${unseen} caught` : ''}`);
  }, 120_000);

  it('mcts lines carry root search statistics mapped to legal moves, without hidden information', async () => {
    const job: MatchJob = { ...GG, agentA: { kind: 'mcts', mcts: { samples: 2, iterations: 8 } } };
    const out = join(tmp(), 'm1.jsonl');
    const { pairs } = await observed(job, 1, 5, out);
    const v = await validateLogFile(out);
    expect(v.errors).toEqual([]);
    const lines = pairs.filter((x): x is { state: GameState; line: DecisionLine } => x.line.type === 'decision');
    const mcts = lines.filter((x) => x.line.agent === 'mcts');
    const searched = mcts.filter((x) => x.line.search?.mode === 'searched');
    console.log(`mcts: ${mcts.length} mcts decision lines, ${searched.length} searched, modes ${[...new Set(mcts.map((x) => x.line.search?.mode))].join(',')}`);
    expect(mcts.every((x) => x.line.search !== null)).toBe(true);
    expect(lines.filter((x) => x.line.agent === 'greedy').every((x) => x.line.search === null)).toBe(true);
    expect(searched.length).toBeGreaterThan(5);
    for (const { state, line } of searched) {
      const s = line.search!;
      expect(s.samples).toBe(2);
      const visits = s.root!.reduce((a, r) => a + r.visits, 0);
      expect(visits).toBe(s.rollouts);
      for (const r of s.root!) {
        expect(r.win.n).toBe(r.visits);
        if (r.legal !== null) expect(line.legal[r.legal]).toBeDefined();
      }
      // The move played is one of the searched root moves.
      expect(s.root!.some((r) => r.legal === line.chosen)).toBe(true);
      checkLineLeak(state, line);
    }
  }, 300_000);

  it('same file for 0 and 2 worker threads; gzip output validates', async () => {
    const dir = tmp();
    const a = await runLogged(GG, { games: 6, seed: 21, workers: 0, blockSize: 2 }, join(dir, 'w0.jsonl'));
    const b = await runLogged(GG, { games: 6, seed: 21, workers: 2, blockSize: 2 }, join(dir, 'w2.jsonl'));
    expect(readFileSync(join(dir, 'w2.jsonl')).equals(readFileSync(join(dir, 'w0.jsonl')))).toBe(true);
    expect(b.log.lines).toBe(a.log.lines);
    const gz = await runLogged(GG, { games: 6, seed: 21, workers: 0, blockSize: 2 }, join(dir, 'w0.jsonl.gz'));
    expect(gz.log.gzip).toBe(true);
    expect(gz.log.bytes).toBeLessThan(gz.log.rawBytes / 4);
    const v = await validateLogFile(join(dir, 'w0.jsonl.gz'));
    console.log(`workers: ${a.log.lines} lines identical on 0 and 2 workers; gzip ${gz.log.bytes} of ${gz.log.rawBytes} bytes, ${v.lines} lines validated`);
    expect(v.errorCount).toBe(0);
    expect(v.lines).toBe(a.log.lines);
  }, 300_000);

  it('match --log is parsed', () => {
    expect(parseMatchArgs(['--log', 'out/x.jsonl']).log).toBe('out/x.jsonl');
    expect('log' in parseMatchArgs([])).toBe(false);
  });
});
