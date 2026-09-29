// Phase 3 hand tool (PLAN.md section 7, Phase 3): London mulligan setup (7 drawn, N bottomed, hand
// size), hand validation, sequential stopping (each exit: keep separated, mulligan separated, too
// close at max n), goldfish metrics on a scripted known game, the heuristic-play sentence and n plus
// a 95 percent interval on every number of the text output, and determinism for a fixed seed.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newGame, loadDeckFile, resolveDeck } from '../../engine/setup.js';
import { legalMoves } from '../../engine/moves.js';
import { applyMoveInPlace } from '../../engine/apply.js';
import { applyHandSetup } from '../../sim/hand-setup.js';
import { checkedChoice, makeAgent, runBlock, type BlockResult, type GameSummary, type MatchJob } from '../../sim/games.js';
import { aggregate, makeBlocks } from '../../sim/runner.js';
import type { Pool, Task } from '../../sim/pool.js';
import {
  analyzeHand, cardId, formatHandReport, greedyBottom, HEURISTIC_SENTENCE, loadKeyCards, resolveHand, type HandReport,
} from '../../tools/goldfish.js';
import { parseHandArgs, splitCards } from '../../cli/hand.js';
import type { DefId, GameState } from '../../engine/types.js';

const HAND = ['Blood Crypt', 'Swamp', 'Blackcleave Cliffs', 'Thoughtseize', 'Bloodtithe Harvester', 'Fable of the Mirror-Breaker', 'Sheoldred, the Apocalypse'];
const defsOf = (s: GameState, ids: readonly number[]): DefId[] => ids.map((id) => s.objects[id]?.defId as DefId);
const ownedCount = (s: GameState, p: 0 | 1): number => Object.values(s.objects).filter((o) => o.owner === p).length;

describe('London mulligan setup (src/sim/hand-setup.ts)', () => {
  it('keep branch after 2 mulligans: the 7 drawn, 2 pinned cards on the bottom, 5 in hand, 60 intact', () => {
    const r = resolveHand({ hand: HAND, mulligans: 2, bottom: ['Swamp', 'Sheoldred, the Apocalypse'] });
    const s = newGame(r.deck, 'deckB', 4, 0);
    applyHandSetup(s, { branch: 'keep', mulligans: 2, hand: r.hand, bottom: r.bottom });
    const lib = s.zones.library[0];
    expect(s.zones.hand[0]).toHaveLength(5);
    expect(lib).toHaveLength(55);
    expect(ownedCount(s, 0)).toBe(60);
    expect(defsOf(s, s.zones.hand[0]).sort()).toEqual(['blackcleave-cliffs', 'blood-crypt', 'bloodtithe-harvester', 'fable-of-the-mirror-breaker', 'thoughtseize']);
    // Library index 0 is the bottom (mutate.ts pushZone).
    expect(defsOf(s, lib.slice(0, 2)).sort()).toEqual(['sheoldred-the-apocalypse', 'swamp']);
    expect([...s.players[0].libraryKnown.bottom].sort()).toEqual([...lib.slice(0, 2)].sort());
    expect(s.players[0].mulligans).toBe(2);
    expect(s.players[0].kept).toBe(true);
    // A never declares again: B (not on the play) is the only one asked.
    expect(s.pendingChoice).toEqual({ kind: 'mulligan', player: 1 });
  });

  it('keep branch with no mulligan asks only B; a 6-card hand after 1 mulligan bottoms 1 unknown card', () => {
    const s = newGame('deckA', 'deckB', 5, 1);
    applyHandSetup(s, { branch: 'keep', mulligans: 0, hand: resolveHand({ hand: HAND, mulligans: 0 }).hand });
    expect(s.pendingChoice).toEqual({ kind: 'mulligan', player: 1 });
    expect(s.zones.hand[0]).toHaveLength(7);

    const six = HAND.slice(0, 6);
    const r = resolveHand({ hand: six, mulligans: 1 });
    expect(r.bottomSource).toBe('already bottomed');
    expect(r.warnings.join(' ')).toMatch(/not known/);
    const t = newGame('deckA', 'deckB', 6, 0);
    applyHandSetup(t, { branch: 'keep', mulligans: 1, hand: r.hand });
    expect(defsOf(t, t.zones.hand[0]).sort()).toEqual([...r.hand].sort());
    expect(t.zones.library[0]).toHaveLength(54);
    expect(t.players[0].libraryKnown.bottom).toHaveLength(1);
    expect(ownedCount(t, 0)).toBe(60);
  });

  it('mulligan branch: a fresh 7, the agent bottoms mulligans + 1, then decides again with the reduced hand', () => {
    const s = newGame('deckA', 'deckB', 8, 0);
    applyHandSetup(s, { branch: 'mulligan', mulligans: 1 });
    expect(s.zones.hand[0]).toHaveLength(7);
    expect(s.pendingChoice).toEqual({ kind: 'bottom', player: 0, count: 2 });
    const agent = makeAgent({ kind: 'greedy' }, 3);
    const moves = legalMoves(s, 0);
    const s0: Record<number, DefId> = Object.fromEntries(s.zones.hand[0].map((id) => [id, s.objects[id]?.defId as DefId]));
    const m = checkedChoice(agent, s, 0, moves, 'bottom');
    const bottomed = m.type === 'choose' ? m.answer.ids ?? [] : [];
    expect(bottomed).toHaveLength(2);
    let st = applyMoveInPlace(s, m);
    expect(st.zones.hand[0]).toHaveLength(5);
    expect(st.zones.library[0]).toHaveLength(55);
    expect(st.players[0].libraryKnown.bottom).toHaveLength(2);
    expect(st.players[0].mulligans).toBe(2);
    // Starting player A declares next; greedy always keeps after two mulligans.
    expect(st.pendingChoice).toEqual({ kind: 'mulligan', player: 0 });
    expect(st.zones.library[0].slice(0, 2).map((id) => st.objects[id]?.defId).sort()).toEqual(bottomed.map((id) => s0[id]).sort());
    const keep = checkedChoice(agent, st, 0, legalMoves(st, 0), 'keep');
    expect(keep).toEqual({ type: 'choose', answer: { keep: true } });
    st = applyMoveInPlace(st, keep);
    expect(st.zones.hand[0]).toHaveLength(5);
  });

  it('greedy bottoming keeps the better hand: a land from a 6-land hand, a spell from a 1-land hand', () => {
    const floody: DefId[] = ['swamp', 'swamp', 'blood-crypt', 'blood-crypt', 'mutavault', 'mutavault', 'fable-of-the-mirror-breaker'];
    const b1 = greedyBottom(floody, 1);
    expect(b1).toHaveLength(1);
    expect(['swamp', 'blood-crypt', 'mutavault']).toContain(b1[0]);
    const b2 = greedyBottom(floody, 2);
    expect(b2.every((d) => d !== 'fable-of-the-mirror-breaker')).toBe(true);
    const r = resolveHand({ hand: HAND, mulligans: 1 });
    expect(r.bottomSource).toBe('greedy');
    expect(r.bottom).toHaveLength(1);
    // Deterministic: same hand, same bottom.
    expect(resolveHand({ hand: HAND, mulligans: 1 }).bottom).toEqual(r.bottom);
  });
});

describe('hand validation', () => {
  it('rejects unknown cards, wrong sizes and bad bottoms', () => {
    expect(() => resolveHand({ hand: [...HAND.slice(0, 6), 'Lightning Bolt'], mulligans: 0 })).toThrow(/no card named 'Lightning Bolt'/);
    expect(() => resolveHand({ hand: [...HAND, 'Swamp'], mulligans: 0 })).toThrow(/8 cards/);
    expect(() => resolveHand({ hand: HAND.slice(0, 6), mulligans: 0 })).toThrow(/6 cards/);
    expect(() => resolveHand({ hand: HAND, mulligans: 6 })).toThrow(/mulligans must be 0 to 5/);
    expect(() => resolveHand({ hand: HAND, mulligans: 0, bottom: ['Swamp'] })).toThrow(/needs --mulligans/);
    expect(() => resolveHand({ hand: HAND, mulligans: 1, bottom: ['Fatal Push'] })).toThrow(/does not hold/);
    expect(() => resolveHand({ hand: HAND, mulligans: 2, bottom: ['Swamp'] })).toThrow(/must name 2/);
    expect(() => resolveHand({ hand: HAND.slice(0, 6), mulligans: 1, bottom: ['Swamp'] })).toThrow(/already bottomed/);
  });

  it('a legal hand has no warning; an illegal draw is rejected with a clear message', () => {
    const ok = resolveHand({ hand: HAND, mulligans: 0 });
    expect(ok.warnings).toEqual([]);
    expect(resolveDeck(ok.deck)).toHaveLength(60);
    const five = ['Thoughtseize', 'Thoughtseize', 'Thoughtseize', 'Thoughtseize', 'Thoughtseize', 'Swamp', 'Swamp'];
    expect(() => resolveHand({ hand: five, mulligans: 0 })).toThrow(/illegal hand: .*not a legal draw from decks\/deckA\.json.*5 x Thoughtseize \(the list has 4\)/);
    // A card deck A does not run at all (Mono-Red's Monastery Swiftspear) is rejected the same way.
    expect(() => resolveHand({ hand: [...HAND.slice(0, 6), 'Monastery Swiftspear'], mulligans: 0 })).toThrow(/illegal hand: .*1 x Monastery Swiftspear \(the list has 0\)/);
    // An already-bottomed 6-card hand is checked too.
    expect(() => resolveHand({ hand: five.slice(0, 6), mulligans: 1 })).toThrow(/illegal hand/);
    // Exactly 4 copies is legal.
    expect(resolveHand({ hand: ['Thoughtseize', 'Thoughtseize', 'Thoughtseize', 'Thoughtseize', 'Swamp', 'Swamp', 'Blood Crypt'], mulligans: 0 }).warnings).toEqual([]);
    expect(resolveDeck(loadDeckFile('deckA'))).toHaveLength(60); // the deck file is untouched
    const side = resolveHand({ hand: [...HAND.slice(0, 6), 'Duress'], mulligans: 0 });
    expect(side.warnings).toEqual([]);
  });

  it('parses card lists with commas inside names, counts, front faces and files', () => {
    expect(splitCards('Sheoldred, the Apocalypse,Swamp,Urborg, Tomb of Yawgmoth')).toEqual(['Sheoldred, the Apocalypse', 'Swamp', 'Urborg, Tomb of Yawgmoth']);
    expect(splitCards('2 Swamp;Fatal Push; 2x Blood Crypt')).toEqual(['Swamp', 'Swamp', 'Fatal Push', 'Blood Crypt', 'Blood Crypt']);
    // A full double-faced name (as the tool prints it) followed by a comma and another card.
    const strong = 'Blood Crypt,Blackcleave Cliffs,Swamp,Thoughtseize,Bloodtithe Harvester,Fable of the Mirror-Breaker // Reflection of Kiki-Jiki,Fatal Push';
    expect(splitCards(strong)).toEqual(['Blood Crypt', 'Blackcleave Cliffs', 'Swamp', 'Thoughtseize', 'Bloodtithe Harvester', 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', 'Fatal Push']);
    expect(resolveHand({ hand: splitCards(strong), mulligans: 0 }).hand).toHaveLength(7);
    expect(splitCards('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki,Sheoldred, the Apocalypse,Swamp')).toEqual(['Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', 'Sheoldred, the Apocalypse', 'Swamp']);
    expect(cardId('fable of the mirror-breaker // reflection of kiki-jiki')).toBe(cardId('Fable of the Mirror-Breaker'));
    expect(cardId('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki, Fatal Push')).toBeUndefined();
    expect(cardId('Fable of the Mirror-Breaker // Fatal Push')).toBeUndefined();
    expect(resolveHand({ hand: splitCards('blood crypt,swamp,blackcleave cliffs,thoughtseize,bloodtithe harvester,fable of the mirror-breaker,sheoldred, the apocalypse'), mulligans: 0 }).hand).toHaveLength(7);
    const dir = mkdtempSync(join(tmpdir(), 'hand-'));
    const f = join(dir, 'hand.json');
    writeFileSync(f, JSON.stringify({ hand: HAND, bottom: ['Swamp'] }));
    const a = parseHandArgs(['--hand-file', f, '--draw', '--mulligans', '1', '--workers', '0']);
    expect(a.hand).toEqual(HAND);
    expect(a.bottom).toEqual(['Swamp']);
    expect(a.onThePlay).toBe(false);
    expect(() => parseHandArgs(['--hand', 'Swamp'])).toThrow(/--play and --draw/);
    expect(() => parseHandArgs(['--play'])).toThrow(/--hand and --hand-file/);
  });
});

// A pool that plays no games: each task gets scripted results (winner by branch and a rule), so the
// stopping logic runs in milliseconds.
function scriptedPool(winA: (branch: 'keep' | 'mulligan' | 'goldfish', i: number) => boolean): Pool & { tasks: number } {
  const pool = {
    workers: 0,
    tasks: 0,
    async run(tasks: readonly Task[]): Promise<BlockResult[]> {
      pool.tasks += tasks.length;
      return tasks.map((t) => {
        const branch = t.job.agentB.kind === 'passive' ? 'goldfish' : t.job.handSetup?.branch === 'mulligan' ? 'mulligan' : 'keep';
        const games: GameSummary[] = [];
        for (let k = 0; k < t.block.games; k++) {
          const i = t.block.first + k;
          const a = winA(branch, i);
          games.push({
            i, winner: a ? 'A' : 'B', reason: 'life', turns: 12 + (i % 3), killTurn: 6 + (i % 3), aOnPlay: true,
            key: (t.job.keyCards ?? []).map((_, j) => (i + j) % 2 === 0), moves: 100,
          });
        }
        return { index: t.block.index, games, decisions: 0, invariantChecks: 0, seconds: 0.5 + (i0(t) % 5) / 10 };
      });
    },
    async close() {},
  };
  return pool;
}
const i0 = (t: Task): number => t.block.index;

const BASE = { hand: HAND, onThePlay: true, mulligans: 0, seed: 1 };

describe('sequential stopping (each exit)', () => {
  it('KEEP when the keep interval separates above the mulligan one', async () => {
    const r = await analyzeHand({ ...BASE, maxGames: 1000, batch: 50, goldfishGames: 20 }, { pool: scriptedPool((b, i) => (b === 'keep' ? i % 10 < 7 : i % 10 < 3)) });
    console.log(formatHandReport(r));
    expect(r.verdict).toBe('KEEP');
    expect(r.looks).toBe(1);
    expect(r.keep.win.n).toBe(50);
    expect(r.keep.win.lo).toBeGreaterThan(r.mulligan.win.hi);
  });

  it('MULLIGAN when the mulligan interval separates above the keep one, after more than one look', async () => {
    const r = await analyzeHand({ ...BASE, maxGames: 1000, batch: 50, goldfishGames: 0 }, { pool: scriptedPool((b, i) => (b === 'keep' ? i % 20 < 8 : i % 20 < 12)) });
    expect(r.verdict).toBe('MULLIGAN');
    expect(r.looks).toBeGreaterThan(1);
    expect(r.mulligan.win.lo).toBeGreaterThan(r.keep.win.hi);
    expect(r.keep.win.n).toBe(r.mulligan.win.n);
    expect(formatHandReport(r)).toMatch(/verdict: MULLIGAN/);
  });

  it('TOO CLOSE TO CALL at max n, both intervals printed with n = max games', async () => {
    const r = await analyzeHand({ ...BASE, maxGames: 300, batch: 100, goldfishGames: 10 }, { pool: scriptedPool((_b, i) => i % 2 === 0) });
    expect(r.verdict).toBe('TOO CLOSE TO CALL');
    expect(r.keep.win.n).toBe(300);
    expect(r.mulligan.win.n).toBe(300);
    expect(r.looks).toBe(3);
    const text = formatHandReport(r);
    expect(text).toMatch(/keep this hand: A wins 50\.0% \[95% CI [\d.]+-[\d.]+%, n=300\]/);
    expect(text).toMatch(/mulligan to 6: A wins 50\.0% \[95% CI [\d.]+-[\d.]+%, n=300\]/);
    expect(text).toMatch(/still overlap at the cap of 300 games per branch/);
  });
});

/** Every line with a digit is an input echo, a note, a warning or the sample line, or has a 95 percent CI and n. */
function checkEveryNumber(text: string): number {
  let checked = 0;
  for (const line of text.split('\n')) {
    if (!/\d/.test(line) || /^(input|note|sample|WARNING):/.test(line)) continue;
    expect(line, line).toMatch(/\[9\d(\.\d)?% CI [^\]]*n=\d+/);
    checked++;
  }
  return checked;
}

describe('output', () => {
  it('carries the heuristic-play sentence and n with a 95 percent interval on every number', async () => {
    const r = await analyzeHand({ ...BASE, mulligans: 1, maxGames: 200, batch: 100, goldfishGames: 20 }, { pool: scriptedPool((_b, i) => i % 3 === 0) });
    const text = formatHandReport(r);
    expect(text).toContain('Win rates reflect heuristic play, not perfect play.');
    expect(r.sentence).toBe(HEURISTIC_SENTENCE);
    const checked = checkEveryNumber(text);
    // The check itself fails on a number without its interval (seen failing, L1).
    expect(() => checkEveryNumber('keep this hand: A wins 45.0% (n=100)')).toThrow();
    console.log(`output check: ${checked} numeric lines carry n and a 95% CI`);
    expect(checked).toBeGreaterThanOrEqual(12); // verdict pair, 2 turn lines, 7 key cards, draws, speed
    expect(text).toMatch(/input: bottom: .+ \(greedy bottoming heuristic\)/);
    expect(text).toMatch(/elapsed [\d.]+ s wall/);
    expect(JSON.parse(JSON.stringify(r)).sentence).toBe(HEURISTIC_SENTENCE);
    await expect(analyzeHand({ ...BASE, hand: ['Thoughtseize', 'Thoughtseize', 'Thoughtseize', 'Thoughtseize', 'Thoughtseize', 'Swamp', 'Swamp'], maxGames: 100, batch: 100, goldfishGames: 0 }, { pool: scriptedPool(() => true) })).rejects.toThrow(/illegal hand/);
  });
});

describe('goldfish metrics on a scripted known game', () => {
  // Deck A is 56 Mountains and 4 Monastery Swiftspear with all 4 Swiftspears and 3 Mountains in the
  // opening hand, so every draw is a Mountain. Against the passive opponent (no blocks) greedy casts
  // a Swiftspear on turn 1 and attacks for 1, casts two on turn 2 and attacks for 3, casts the last
  // on turn 3 and attacks for 4, then 4 a turn: 1 + 3 + 4 + 4 + 4 + 4 = 20, a kill on own turn 6 on
  // the play and on the draw. It has 4 lands by own turn 4 but never 5.
  const dir = mkdtempSync(join(tmpdir(), 'keycards-'));
  const file = join(dir, 'key-cards.json');
  writeFileSync(file, JSON.stringify({ keyCards: [
    { label: '4 lands by own turn 4', how: 'lands', count: 4, byTurn: 4 },
    { label: '5 lands by own turn 4', how: 'lands', count: 5, byTurn: 4 },
    { label: 'Swiftspear cast by own turn 1', how: 'cast', cards: ['Monastery Swiftspear'], byTurn: 1 },
    { label: 'Fable cast by own turn 3', how: 'cast', cards: ['Fable of the Mirror-Breaker'], byTurn: 3 },
  ] }));
  const hand: DefId[] = ['mountain', 'mountain', 'mountain', 'monastery-swiftspear', 'monastery-swiftspear', 'monastery-swiftspear', 'monastery-swiftspear'];
  for (const play of ['A', 'B'] as const) {
    it(`kill turn 6 and the key-card flags, ${play === 'A' ? 'on the play' : 'on the draw'}`, () => {
      const job: MatchJob = {
        deckA: { main: [{ count: 56, name: 'Mountain' }, { count: 4, name: 'Monastery Swiftspear' }] }, deckB: 'deckB',
        agentA: { kind: 'greedy' }, agentB: { kind: 'passive' }, play, keyCards: loadKeyCards(file),
        handSetup: { branch: 'keep', mulligans: 0, hand },
      };
      const res = makeBlocks(6, 9, 3).map((b) => runBlock(job, b));
      const r = aggregate(res, job, 1, 1);
      console.log(`scripted goldfish (${play}): kill turn ${r.killTurnA.mean} [${r.killTurnA.lo}-${r.killTurnA.hi}, n=${r.killTurnA.n}], key ${r.keyCards.map((k) => `${k.label} ${k.p.k}/${k.p.n}`).join('; ')}`);
      expect(r.games).toBe(6);
      expect(r.winA.k).toBe(6);
      expect(r.killTurnA).toMatchObject({ n: 6, mean: 6, lo: 6, hi: 6 });
      expect(r.perGame.every((g) => g.reason === r.perGame[0]?.reason && g.turns === (play === 'A' ? 11 : 12))).toBe(true);
      expect(r.keyCards.map((k) => k.p.k)).toEqual([6, 0, 6, 0]);
    });
  }
});

describe('key cards are observed at the end of turns without a decision', () => {
  // Deck A is 60 Swamps, so greedy Rakdos's only decision in a turn is its land drop. Deck B is 60
  // Sheoldred: greedy Mono-Red mulligans to 5 and has no land, so it has no decision until its
  // hand passes 7 (a cleanup discard in its fourth turn). After A's land drop the engine runs on to
  // A's next land drop, a turn later. Looking only at decision points missed every land played in
  // own turns 1 and 2 (seen failing: 0 of 2 for '1 land by own turn 1'); the end-of-turn observer
  // (setTurnEndObserver in src/engine/turn.ts) sees them.
  const dir = mkdtempSync(join(tmpdir(), 'keycards-eot-'));
  const file = join(dir, 'key-cards.json');
  writeFileSync(file, JSON.stringify({ keyCards: [
    { label: '1 land by own turn 1', how: 'lands', count: 1, byTurn: 1 },
    { label: '2 lands by own turn 2', how: 'lands', count: 2, byTurn: 2 },
    { label: '3 lands by own turn 3', how: 'lands', count: 3, byTurn: 3 },
    { label: '4 lands by own turn 3', how: 'lands', count: 4, byTurn: 3 },
    { label: 'Swamp on the battlefield by own turn 1', how: 'battlefield', cards: ['Swamp'], byTurn: 1 },
  ] }));
  for (const play of ['A', 'B'] as const) {
    it(`every land drop counts by its own turn, ${play === 'A' ? 'on the play' : 'on the draw'}`, () => {
      const job: MatchJob = {
        deckA: { main: [{ count: 60, name: 'Swamp' }] }, deckB: { main: [{ count: 60, name: 'Sheoldred, the Apocalypse' }] },
        agentA: { kind: 'greedy' }, agentB: { kind: 'greedy' }, play, keyCards: loadKeyCards(file),
        handSetup: { branch: 'keep', mulligans: 0, hand: ['swamp', 'swamp', 'swamp', 'swamp', 'swamp', 'swamp', 'swamp'] },
      };
      const res = makeBlocks(2, 5, 2).map((b) => runBlock(job, b));
      const games = res.flatMap((b) => b.games);
      console.log(`end-of-turn key cards (${play}): ${games.map((g) => g.key.map((k) => (k ? 1 : 0)).join('')).join(' ')} over ${games.length} games`);
      expect(games).toHaveLength(2);
      for (const g of games) expect(g.key).toEqual([true, true, true, false, true]);
    }, 60_000);
  }
});

describe('determinism', () => {
  it('same seed, same report in this thread and on 2 worker threads; another seed differs', async () => {
    const opts = { ...BASE, maxGames: 10, batch: 5, goldfishGames: 5, blockSize: 5 };
    const strip = (r: HandReport): unknown => ({ ...r, seconds: 0, speed: null, input: { ...r.input, workers: null } });
    const a = await analyzeHand({ ...opts, workers: 0 });
    const b = await analyzeHand({ ...opts, workers: 2 });
    const c = await analyzeHand({ ...opts, seed: 2, workers: 0 });
    console.log(formatHandReport(a));
    expect(a.games).toBe(a.keep.games + a.mulligan.games + 5);
    expect(strip(b)).toEqual(strip(a));
    expect(strip(c)).not.toEqual(strip(a));
    checkEveryNumber(formatHandReport(a));
  }, 300_000);
});
