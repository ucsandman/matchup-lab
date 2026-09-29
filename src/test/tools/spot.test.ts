// Spot files (src/tools/spot-schema.ts, docs/SPOT-FORMAT.md): (1) round trip state -> view -> spot
// JSON -> view is byte-identical over many live positions; (2) the documented example loads, matches
// the doc, and determinizes; (3) a spot with a card not in the lists, too many copies, a typo or bad
// sizes is rejected with a clear message.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import '../../cards/index.js';
import { newGame, type DeckInput } from '../../engine/setup.js';
import { applyMoveInPlace, cloneState } from '../../engine/apply.js';
import { scry1 } from '../../engine/zones.js';
import { decider, legalMoves } from '../../engine/moves.js';
import { view, type PlayerView } from '../../engine/view.js';
import { seedRng } from '../../engine/rng.js';
import { randomAgent } from '../../agents/random.js';
import { prepareDeterminizer } from '../../agents/determinize.js';
import { loadSpot, saveSpot, SpotError, spotJson, SPOT_SCHEMA, validate } from '../../tools/spot-schema.js';
import { sideboardDeck } from '../pool.js';

const EXAMPLE = readFileSync(new URL('../../../spots/example.json', import.meta.url), 'utf8');
const DOC = readFileSync(new URL('../../../docs/SPOT-FORMAT.md', import.meta.url), 'utf8');

/** Views of both players at every 'every'-th decision point of random games. */
function liveViews(decks: [DeckInput, DeckInput], games: number, seed0: number, every: number): PlayerView[] {
  const out: PlayerView[] = [];
  let n = 0;
  for (let g = 0; g < games; g++) {
    const s = newGame(decks[0], decks[1], seed0 + g, 'random');
    const agents = [randomAgent(seed0 * 3 + g), randomAgent(seed0 * 5 + g)];
    for (;;) {
      if (n++ % every === 0 || s.result) { out.push(view(s, 0)); out.push(view(s, 1)); }
      if (s.result) break;
      const p = decider(s);
      if (p === null) break;
      const st = s;
      applyMoveInPlace(s, (agents[p] as ReturnType<typeof randomAgent>).choose({ player: p, moves: legalMoves(s, p), view: () => view(st, p) }));
    }
  }
  return out;
}

const mutate = (f: (x: Record<string, any>) => void): Record<string, unknown> => {
  const x = JSON.parse(EXAMPLE) as Record<string, any>;
  f(x);
  return x;
};
const rejects = (spot: unknown): string => {
  try { loadSpot(spot); } catch (e) {
    expect(e).toBeInstanceOf(SpotError);
    return (e as Error).message;
  }
  throw new Error('spot was accepted');
};

describe('spot files', () => {
  it('round trip: state -> view -> spot JSON -> view is byte-identical (real decks and a sideboard configuration)', () => {
    const cases: [PlayerView, [DeckInput, DeckInput] | undefined][] = [
      ...liveViews(['deckA', 'deckB'], 40, 11_001, 5).map((v): [PlayerView, undefined] => [v, undefined]),
      ...liveViews([sideboardDeck('deckA'), sideboardDeck('deckB')], 10, 12_001, 5)
        .map((v): [PlayerView, [DeckInput, DeckInput]] => [v, [sideboardDeck('deckA'), sideboardDeck('deckB')]]),
    ];
    // Known library tops and a pending scry (the scried card revealed to its chooser only) are rare in
    // random games, so ten positions get each: scry1 kept on top, and the scry choice itself.
    for (let g = 0; g < 10; g++) {
      const s = newGame('deckA', 'deckB', 13_001 + g, 'random');
      const agents = [randomAgent(g + 1), randomAgent(g + 101)];
      while (!s.result && s.turn < 4 + g) {
        const p = decider(s);
        if (p === null) break;
        const st = s;
        applyMoveInPlace(s, (agents[p] as ReturnType<typeof randomAgent>).choose({ player: p, moves: legalMoves(s, p), view: () => view(st, p) }));
      }
      const p = (g % 2) as 0 | 1;
      const kept = cloneState(s);
      scry1(kept, p, false);
      cases.push([view(kept, p), undefined], [view(kept, (1 - p) as 0 | 1), undefined]);
      const asking = cloneState(s);
      const top = asking.zones.library[p][asking.zones.library[p].length - 1] as number;
      asking.pendingChoice = { kind: 'pickObjects', player: p, reason: 'scry1', from: [top], min: 0, max: 1, reveal: [top] };
      cases.push([view(asking, p), undefined], [view(asking, (1 - p) as 0 | 1), undefined]);
    }
    const seen = { choice: new Set<string>(), stack: 0, knownBottom: 0, knownTop: 0, oppKnown: 0, delayed: 0, effects: 0, passes: 0, pregame: 0, result: 0, revealed: 0 };
    for (const [v, decks] of cases) {
      const text = spotJson(v, decks ? { decks } : {});
      const back = loadSpot(text).view;
      expect(JSON.stringify(back)).toBe(JSON.stringify(v));
      expect(spotJson(back, decks ? { decks } : {})).toBe(text);
      if (v.pendingChoice) seen.choice.add(v.pendingChoice.kind + ('hidden' in v.pendingChoice ? ' (hidden)' : ''));
      if (v.zones.stack.length) seen.stack++;
      if (v.zones.library[v.viewer].knownBottom?.length) seen.knownBottom++;
      if (v.zones.library[v.viewer].knownTop?.length) seen.knownTop++;
      if (v.zones.hand[1 - v.viewer as 0 | 1].known.length) seen.oppKnown++;
      if (v.delayed.length) seen.delayed++;
      if (v.effects.length) seen.effects++;
      if (v.passes) seen.passes++;
      if (v.pregame) seen.pregame++;
      if (v.result) seen.result++;
      if (Object.values(v.objects).some((o) => o.zone === 'library' && !v.zones.library[o.owner].knownTop?.includes(o.id) && !v.zones.library[o.owner].knownBottom?.includes(o.id))) seen.revealed++;
    }
    console.log(`spot round trip: ${cases.length} views byte-identical; choices ${[...seen.choice].sort().join(', ')}; `
      + `stack ${seen.stack}, known bottom ${seen.knownBottom}, known top ${seen.knownTop}, known opponent cards ${seen.oppKnown}, `
      + `delayed ${seen.delayed}, effects ${seen.effects}, passes ${seen.passes}, pregame ${seen.pregame}, result ${seen.result}, revealed library ${seen.revealed}`);
    expect(cases.length).toBeGreaterThan(500);
    for (const k of ['stack', 'knownBottom', 'knownTop', 'revealed', 'oppKnown', 'pregame', 'result', 'effects', 'delayed', 'passes'] as const) expect(seen[k]).toBeGreaterThan(0);
    expect(seen.choice.size).toBeGreaterThanOrEqual(6);
  }, 600_000);

  it('the documented example loads, is the one in docs/SPOT-FORMAT.md, and determinizes', () => {
    const indented = EXAMPLE.trimEnd().split('\n').map((l) => `    ${l}`).join('\n');
    expect(DOC.includes(indented)).toBe(true);
    const { view: v } = loadSpot(EXAMPLE);
    expect(v.zones.library[0]).toMatchObject({ size: 51 });
    expect(v.zones.library[1]).toEqual({ size: 50 });
    expect(v.zones.hand[1].hidden).toHaveLength(2);
    const byName = (name: string) => Object.values(v.objects).find((o) => o.defId === name);
    expect(byName('fable-of-the-mirror-breaker')?.counters).toEqual({ lore: 2 });
    expect(byName('token-blood')?.token).toBe('token-blood');
    expect(byName('emberheart-challenger')?.sick).toBe(true);
    const bottom = v.zones.library[0].knownBottom?.[0];
    expect(bottom !== undefined && v.objects[bottom]?.defId).toBe('duress');
    // A back-face name on the battlefield means that face.
    const kiki = loadSpot(mutate((x) => { x.battlefield[5] = { name: 'Reflection of Kiki-Jiki', controller: 0 }; })).view;
    expect(Object.values(kiki.objects).find((o) => o.defId === 'fable-of-the-mirror-breaker')?.face).toBe(1);
    const det = prepareDeterminizer(v, ['deckA', 'deckB']);
    const s = det.sample(seedRng(1));
    expect(JSON.stringify(view(s, 0))).toBe(JSON.stringify(v));
    expect(legalMoves(s, 0).length).toBeGreaterThan(1);
    // Saving the loaded example gives a file that loads to the same view.
    expect(JSON.stringify(loadSpot(saveSpot(v)).view)).toBe(JSON.stringify(v));
  });

  it('rejects a card not in the lists, too many copies, typos and sizes that do not add up, with clear messages', () => {
    const notInList = rejects(mutate((x) => { x.players[1].graveyard.push('Fatal Push'); }));
    expect(notInList).toContain('spot.players[1].graveyard[3] (Fatal Push): not in deck B (Mono-Red Aggro), which owns this zone; it is in deck A (Rakdos Midrange)');

    const unknown = rejects(mutate((x) => { x.players[0].hand.push('Lightning Bolt'); }));
    expect(unknown).toContain('spot.players[0].hand[2] (Lightning Bolt): unknown card name "Lightning Bolt" (not in decks/oracle.json)');

    const typo = rejects(mutate((x) => { x.players[0].hand[0] = 'Sheoldred the Apocalypse'; }));
    expect(typo).toContain('did you mean "Sheoldred, the Apocalypse"?');

    const copies = rejects(mutate((x) => { x.players[0].graveyard.push('Fatal Push', 'Fatal Push', 'Fatal Push', 'Fatal Push'); }));
    expect(copies).toContain('deck A (Rakdos Midrange): 5 copies of "Fatal Push" in the spot, the list has 4');

    const legend = rejects(mutate((x) => { x.players[0].hand.push('Sheoldred, the Apocalypse', 'Sheoldred, the Apocalypse', 'Sheoldred, the Apocalypse'); }));
    expect(legend).toContain('4 copies of "Sheoldred, the Apocalypse" in the spot, the list has 3');

    const field = rejects(mutate((x) => { x.battlefield[0].taped = true; }));
    expect(field).toContain('spot.battlefield[0]: unknown field "taped"; did you mean "tapped"?');

    const size = rejects(mutate((x) => { x.players[1].library = { size: 40 }; }));
    expect(size).toContain('deck B (Mono-Red Aggro): 8 cards placed outside the library + 2 unseen in hand + 40 in library = 50, the list has 60');

    const controller = rejects(mutate((x) => { delete x.battlefield[3].controller; }));
    expect(controller).toContain('spot.battlefield[3] (Bloodtithe Harvester): controller is required on the battlefield');

    const hidden = rejects(mutate((x) => { delete x.players[1].handHidden; }));
    expect(hidden).toContain('spot.players[1].handHidden: required for the opponent');

    const oppOrder = rejects(mutate((x) => { x.players[1].library = { knownTop: ['Mountain'] }; }));
    expect(oppOrder).toContain('the opponent\'s library order is not part of a spot');

    const token = rejects(mutate((x) => { x.players[0].graveyard.push('Treasure'); }));
    expect(token).toContain('a token exists only on the battlefield');

    const json = rejects('{ "spot": 1, ');
    expect(json).toContain('not valid JSON');

    // Every problem is listed, not just the first.
    const many = rejects(mutate((x) => { x.players[1].graveyard.push('Fatal Push'); x.battlefield[0].taped = true; }));
    expect(many).toMatch(/^spot file rejected \(1 problem\)/);
    const many2 = rejects(mutate((x) => { x.players[1].graveyard.push('Fatal Push'); x.players[0].hand.push('Lightning Bolt'); }));
    expect(many2).toMatch(/^spot file rejected \(2 problems\)/);
    console.log(`spot rejections: 14 bad files rejected, e.g.\n${copies}`);
  });

  it('the schema validator reports types, enums and ranges with paths', () => {
    const errors: string[] = [];
    validate(SPOT_SCHEMA, { spot: 2, viewer: 3, turn: -1, step: 'combat', activePlayer: 0, players: [{}, { life: 'x' }] }, 'spot', errors);
    expect(errors).toEqual([
      'spot.spot: must be 1, got 2',
      'spot.viewer: 3 is not one of 0, 1',
      'spot.turn: -1 is below the minimum 0',
      expect.stringContaining('spot.step: "combat" is not one of "mulligan", "untap"'),
      'spot.players[1].life: expected integer, got "x"',
    ]);
  });
});
