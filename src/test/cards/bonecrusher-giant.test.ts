// Bonecrusher Giant // Stomp: the Adventure, CR 715.3d (exiles it), and the
// becomes-the-target-of-a-spell trigger (spells only, any controller).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { given, id1, ids, registerTestDef, TestBear, TestBolt } from '../helpers.js';
import { act as actDef, card, face, t } from '../../cards/dsl.js';
import { characteristics } from '../../engine/statics.js';
import { act, castMove, moves, O, pass } from '../scenario.js';
import type { GameState, Move } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const BG = 'Bonecrusher Giant // Stomp';

const Striker = registerTestDef(card('Test Bg Striker', [face({ name: 'Test Bg Striker', types: ['Creature'], cost: '{R}', pt: [1, 2] })]));
/** A permanent with a targeted activated ability (Screaming Nemesis trigger stand-in: an ability, not a spell). */
const Pinger = registerTestDef(card('Test Bg Pinger', [face({
  name: 'Test Bg Pinger', types: ['Artifact'], cost: '{1}',
  abilities: [actDef({ cost: { tap: true }, target: t.creature(), resolve: (ctx, [tg]) => { if (tg) ctx.dealDamage(tg, 1); } })],
})]));

function resolveStack(s: GameState): void {
  let guard = 0;
  while (s.zones.stack.length > 0 && !s.pendingChoice) { pass(s); if (++guard > 50) throw new Error('stack did not resolve'); }
}

describe('Bonecrusher Giant // Stomp', () => {
  it('matches its oracle characteristics outside the stack, CR 715.4 (normal characteristics)', () => {
    const s = given({ battlefield: [BG], hands: [[BG], []] });
    const c = characteristics(s, id1(s, BG));
    expect([c.name, c.power, c.toughness, c.manaValue]).toEqual(['Bonecrusher Giant', 4, 3, 3]);
    expect(characteristics(s, id1(s, BG, 'hand', 0)).manaValue).toBe(3);
  });

  it('scenario 1: Stomp kills a 1/2, goes on an adventure, and the Giant is then castable from exile', () => {
    const s = given({
      turn: 2, step: 'main1', active: 0,
      battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain', { card: Striker.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[BG], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, BG, [O(id1(s, Striker.id))], (m) => m.face === 1));
    resolveStack(s);
    expect(ids(s, Striker.id, 'graveyard', 1).length).toBe(1);
    const ex = id1(s, BG, 'exile', 0);
    expect(s.objects[ex]?.onAdventure).toBe(true);
    if (s.priority !== 0) pass(s);
    const casts = moves(s).filter((m): m is Extract<Move, { type: 'cast' }> => m.type === 'cast' && m.objId === ex);
    expect(casts.length).toBe(1);
    act(s, casts[0]!);
    resolveStack(s);
    expect(ids(s, BG, 'battlefield', 0).length).toBe(1);
  });

  it('scenario 2: an opponent spell targeting the Giant: the trigger resolves first (2 to that player), then the spell', () => {
    const s = given({
      turn: 2, step: 'main1', active: 1, life: [20, 10],
      battlefield: [BG, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Test Bolt', [O(id1(s, BG))]));
    // CR 603.3 (next time a player would receive priority): above the spell.
    const top = s.zones.stack[s.zones.stack.length - 1];
    expect(top?.kind).toBe('triggered');
    let guard = 0;
    while (s.players[1].life === 10) { pass(s); if (++guard > 20) throw new Error('trigger never resolved'); }
    expect(s.players[1].life).toBe(8);
    expect(s.zones.stack.some((i) => i.kind === 'spell')).toBe(true);
    resolveStack(s);
    expect(ids(s, BG, 'graveyard', 0).length).toBe(1);
  });

  it('scenario 3: an ability that targets the Giant does not trigger it', () => {
    const s = given({
      turn: 2, step: 'main1', active: 1, life: [20, 10],
      battlefield: [BG, 'Mountain', { card: Pinger.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    const m = moves(s).find((x) => x.type === 'activate' && x.objId === id1(s, Pinger.id));
    if (!m) throw new Error('no Pinger activation');
    act(s, m);
    expect(s.zones.stack.filter((i) => i.kind === 'triggered').length).toBe(0);
    resolveStack(s);
    expect(s.players[1].life).toBe(10);
    expect(s.objects[id1(s, BG)]?.damage).toBe(1);
  });

  it('the controller own spell targeting the Giant triggers it too (a spell, any controller)', () => {
    const s = given({
      turn: 2, step: 'main1', active: 0,
      battlefield: [BG, 'Mountain', { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, 'Test Bolt', [O(id1(s, BG))]));
    resolveStack(s);
    expect(s.players[0].life).toBe(18);
  });

  it('pool check: only Stomp and Sunspine Lynx mention prevention, both as can not be prevented (no prevention effect exists)', () => {
    const raw = JSON.parse(readFileSync(new URL('../../../decks/oracle.json', import.meta.url), 'utf8')) as Record<string, { name: string; oracle_text?: string }>;
    const oracle = Object.values(raw);
    const hits = oracle.filter((c) => /prevent/i.test(c.oracle_text ?? ''));
    console.log(`oracle prevention scan: ${oracle.length} cards scanned, ${hits.length} mention prevention`);
    expect(oracle.length).toBeGreaterThan(50);
    expect(hits.map((c) => c.name).sort()).toEqual([BG, 'Sunspine Lynx']);
    for (const c of hits) expect(c.oracle_text).toMatch(/can.t be prevented/i);
  });
});
