// Cross-card interactions from PLAN.md section 7 Phase 1, with the real game-1 card defs (no
// stand-ins): Nemesis vs non-damage removal, Soul-Scar vs Etching, prowess plus valiant ordering,
// Sheoldred's trigger surviving her death, the Lynx double-loss draw, Urborg with Castle and Verge,
// Blackcleave sequencing. Plus the pool assertion: no card in decks/oracle.json has first strike,
// flash, hexproof, protection, reach, vigilance or a damage prevention effect (PLAN.md section 4).
// Player 0 is A (Rakdos Midrange), player 1 is B (Mono-Red Aggro) unless a test says otherwise.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { given, id1, ids, TestBear } from '../helpers.js';
import { act, answer, castMove, O, pass } from '../scenario.js';
import { playLandNow } from '../cards/lands-util.js';
import { characteristics } from '../../engine/statics.js';
import { sourceOptions } from '../../engine/mana.js';
import type { GameState, ObjId } from '../../engine/types.js';

const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);
const pt = (s: GameState, id: ObjId): [number, number] => { const c = characteristics(s, id); return [c.power, c.toughness]; };
const colors = (s: GameState, id: ObjId): string[] => [...new Set(sourceOptions(s, id).flatMap((o) => o.colors))].sort();
/** Passes until the stack is at most n items deep (answering nothing else); fails if a Choice interrupts. */
function resolveTo(s: GameState, n: number, cap = 40): void {
  for (let i = 0; i < cap && s.zones.stack.length > n && !s.result; i++) {
    const k = s.pendingChoice?.kind;
    if (k && k !== 'declareAttackers' && k !== 'declareBlockers') throw new Error(`unexpected choice ${JSON.stringify(s.pendingChoice)}`);
    pass(s);
  }
  expect(s.zones.stack.length).toBeLessThanOrEqual(n);
}
const NEM = 'Screaming Nemesis';
const SSM = 'Soul-Scar Mage';
const KUMANO = 'Kumano Faces Kakkazan // Etching of Kumano';
const EMBER = 'Emberheart Challenger';
const SHEOLDRED = 'Sheoldred, the Apocalypse';
const LYNX = 'Sunspine Lynx';
const nemTriggers = (s: GameState): number => s.zones.stack.filter((x) => x.abilityKey?.startsWith('screaming-nemesis:')).length;

describe('cross-card interactions (PLAN.md section 7)', () => {
  it('Nemesis vs non-damage removal: Go for the Throat and Bitter Triumph kill it with no trigger; A can still gain life', () => {
    // Bitter Triumph's additional cost is paid with 3 life here (no other card to discard).
    for (const [removal, life] of [['Go for the Throat', 20], ['Bitter Triumph', 17]] as const) {
      const s = given({
        turn: 3, step: 'main1', active: 0,
        battlefield: ['Swamp', 'Swamp', { card: NEM, controller: 1 }, { card: 'Mountain', controller: 1 }],
        hands: [[removal], ['Burst Lightning']], libraries: [lib(5), lib(5)],
      });
      const nem = id1(s, NEM);
      act(s, castMove(s, removal, [O(nem)]));
      resolveTo(s, 0);
      // The trigger condition is 'is dealt damage'; destroy is not damage (CR 120.3 (damage results)).
      expect(s.objects[nem]).toBeUndefined();
      expect(ids(s, NEM, 'graveyard', 1).length).toBe(1);
      expect(nemTriggers(s)).toBe(0);
      expect(s.pendingChoice?.kind).not.toBe('pickTargets');
      expect(s.players[0].life).toBe(life);
      expect(s.players[0].cantGainLife).toBe(false);
    }
  });

  it('Nemesis control: Stomp (2 damage) does trigger it; A is dealt 2 and can\'t gain life for the rest of the game (CR 119.7 (can\'t gain life))', () => {
    const s = given({
      turn: 3, step: 'main1', active: 0,
      battlefield: ['Blood Crypt', 'Swamp', { card: NEM, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [['Bonecrusher Giant // Stomp'], ['Burst Lightning']], libraries: [lib(5), lib(5)],
    });
    const nem = id1(s, NEM);
    act(s, castMove(s, 'Bonecrusher Giant // Stomp', [O(nem)], (m) => m.face === 1));
    resolveTo(s, 0);
    // A has no creature, and player targets collapse to the opponent (PLAN.md section 6), so the
    // trigger's only offered target is A and no choice is asked.
    expect(s.objects[nem]?.damage).toBe(2);
    expect(s.players[0].life).toBe(18);
    expect(s.players[0].cantGainLife).toBe(true);
  });

  it('Soul-Scar vs Etching: burn becomes -1/-1 counters, so the creature was never dealt damage and dies to the graveyard, not exile (CR 614.1a (instead), CR 704.5f (toughness 0 or less))', () => {
    const board = (withMage: boolean): GameState => given({
      turn: 4, step: 'main1', active: 1,
      battlefield: [
        'Bloodtithe Harvester',
        ...(withMage ? [{ card: SSM, controller: 1 as const }] : []),
        { card: KUMANO, face: 1, controller: 1 }, { card: 'Mountain', controller: 1 }, { card: 'Mountain', controller: 1 },
      ],
      hands: [[], ['Burst Lightning', 'Burst Lightning']], libraries: [lib(5), lib(5)],
    });
    const s = board(true);
    const h = id1(s, 'Bloodtithe Harvester');
    act(s, castMove(s, 'Burst Lightning', [O(h)], (m) => !m.kicked));
    resolveTo(s, 0);
    expect(s.objects[h]).toBeUndefined();
    expect(ids(s, 'Bloodtithe Harvester', 'graveyard', 0).length).toBe(1);
    expect(ids(s, 'Bloodtithe Harvester', 'exile', 0).length).toBe(0);

    // Control: without Soul-Scar the same Burst deals damage, and Etching exiles the Harvester.
    const c = board(false);
    const h2 = id1(c, 'Bloodtithe Harvester');
    act(c, castMove(c, 'Burst Lightning', [O(h2)], (m) => !m.kicked));
    resolveTo(c, 0);
    expect(ids(c, 'Bloodtithe Harvester', 'graveyard', 0).length).toBe(0);
    expect(ids(c, 'Bloodtithe Harvester', 'exile', 0).length).toBe(1);
  });

  it('prowess plus valiant: Monstrous Rage on Emberheart triggers both at once and B orders them (CR 603.3b (order)); either order ends 6/4 with one card exiled', () => {
    const orders: string[] = [];
    for (const first of [0, 1]) {
      const s = given({
        turn: 3, step: 'main1', active: 1,
        battlefield: [{ card: EMBER, controller: 1 }, { card: 'Mountain', controller: 1 }, { card: 'Mountain', controller: 1 }],
        hands: [[], ['Monstrous Rage', 'Burst Lightning']], libraries: [lib(5), ['Mountain', ...lib(5)]],
      });
      const e = id1(s, EMBER);
      act(s, castMove(s, 'Monstrous Rage', [O(e)]));
      expect(s.pendingChoice).toMatchObject({ kind: 'pickIndex', reason: 'orderTriggers', player: 1, count: 2 });
      answer(s, { index: first });
      // Stack bottom to top: Rage, then the two triggers in the chosen order.
      const keys = s.zones.stack.map((x) => x.abilityKey ?? 'spell');
      expect(keys.length).toBe(3);
      orders.push(keys.slice(1).join(' < '));
      resolveTo(s, 0);
      // 2/2, prowess +1/+1, Rage +2/+0, Monster Role +1/+1 and trample.
      expect(pt(s, e)).toEqual([6, 4]);
      expect(ids(s, 'Mountain', 'exile', 1).length).toBe(1);
    }
    // The choice is real: the two answers stack the triggers in different orders.
    expect(new Set(orders).size).toBe(2);
  });

  it('Sheoldred\'s trigger survives her death: B kills her in response and still loses 2 (CR 113.7a (independently of its source))', () => {
    const s = given({
      turn: 2, step: 'upkeep', active: 1,
      battlefield: [SHEOLDRED, { card: 'Monastery Swiftspear', controller: 1 },
        { card: 'Mountain', controller: 1 }, { card: 'Mountain', controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[], ['Reckless Rage', 'Burst Lightning', 'Burst Lightning']], libraries: [lib(5), lib(5)],
    });
    const sh = id1(s, SHEOLDRED);
    const spear = id1(s, 'Monastery Swiftspear');
    while (s.step !== 'draw') pass(s);
    expect(s.zones.stack.map((x) => x.abilityKey)).toEqual(['sheoldred-the-apocalypse:0:1']);
    expect(s.priority).toBe(1);
    // 4 to Sheoldred and 2 to B's own Swiftspear (prowess makes it 2/3, it survives).
    act(s, castMove(s, 'Reckless Rage', [O(sh), O(spear)]));
    resolveTo(s, 1);
    act(s, castMove(s, 'Burst Lightning', [O(sh)], (m) => !m.kicked));
    resolveTo(s, 1);
    expect(s.objects[sh]).toBeUndefined();
    expect(ids(s, SHEOLDRED, 'graveyard', 0).length).toBe(1);
    expect(s.zones.stack.map((x) => x.abilityKey)).toEqual(['sheoldred-the-apocalypse:0:1']);
    expect(s.players[1].life).toBe(20);
    resolveTo(s, 0);
    expect(s.players[1].life).toBe(18);
  });

  it('Sunspine Lynx double loss: A at 2 with two nonbasics, B at 1 with Mutavault; both reach 0 at once and the game is a draw (CR 104.4a (all players lose simultaneously))', () => {
    const s = given({
      turn: 4, step: 'main1', active: 1, life: [2, 1],
      battlefield: ['Blood Crypt', 'Blackcleave Cliffs', 'Swamp',
        { card: 'Mountain', controller: 1 }, { card: 'Mountain', controller: 1 }, { card: 'Mountain', controller: 1 }, { card: 'Mutavault', controller: 1 }],
      hands: [[], [LYNX]], libraries: [lib(5), lib(5)],
    });
    act(s, castMove(s, LYNX));
    for (let i = 0; i < 20 && s.result === null && s.zones.stack.length > 0; i++) pass(s);
    expect(s.players[0].life).toBe(0);
    expect(s.players[1].life).toBe(0);
    expect(s.result?.winner).toBe('draw');
  });

  it('Urborg with Castle and Verge: every land is a Swamp (CR 305.7 (land type changing)), so Verge makes R and Castle enters untapped', () => {
    const s = given({ turn: 3, step: 'main1', battlefield: ['Urborg, Tomb of Yawgmoth', 'Blazemire Verge'], hands: [['Castle Locthwain'], []] });
    const v = id1(s, 'Blazemire Verge');
    expect(characteristics(s, v).subtypes).toContain('Swamp');
    expect(colors(s, v)).toEqual(['B', 'R']);
    expect(s.objects[playLandNow(s, 'Castle Locthwain')]!.tapped).toBe(false);

    // Control: a Blightstep Pathway is neither a Swamp nor a Mountain; Verge makes only B and Castle enters tapped.
    const c = given({ turn: 3, step: 'main1', battlefield: ['Blightstep Pathway // Searstep Pathway', 'Blazemire Verge'], hands: [['Castle Locthwain'], []] });
    expect(colors(c, id1(c, 'Blazemire Verge'))).toEqual(['B']);
    expect(c.objects[playLandNow(c, 'Castle Locthwain')]!.tapped).toBe(true);
  });

  it('Blackcleave sequencing: untapped as the first, second or third land, tapped as the fourth (CR 614.12 (enters replacement)); Mutavault counts, the entering Cliffs does not', () => {
    const others = ['Swamp', 'Mutavault', 'Blood Crypt'];
    const tappedWith = (k: number): boolean => {
      const s = given({ turn: k + 1, step: 'main1', battlefield: others.slice(0, k), hands: [['Blackcleave Cliffs'], []] });
      return s.objects[playLandNow(s, 'Blackcleave Cliffs')]!.tapped;
    };
    expect([0, 1, 2, 3].map(tappedWith)).toEqual([false, false, false, true]);
    // The opponent's lands never count.
    const s = given({ turn: 4, step: 'main1', battlefield: ['Swamp', 'Swamp', ...others.map((card) => ({ card, controller: 1 as const }))], hands: [['Blackcleave Cliffs'], []] });
    expect(s.objects[playLandNow(s, 'Blackcleave Cliffs')]!.tapped).toBe(false);
  });
});

describe('pool assertions (PLAN.md section 4, skipped rules)', () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const oracle = JSON.parse(readFileSync(join(repo, 'decks', 'oracle.json'), 'utf8')) as Record<string, {
    name: string; oracle_text: string | null; keywords: string[]; card_faces: { oracle_text: string | null }[];
  }>;
  const cards = Object.values(oracle);
  const textOf = (c: (typeof cards)[number]): string => [c.oracle_text ?? '', ...c.card_faces.map((f) => f.oracle_text ?? '')].join('\n');

  it('no first strike, double strike, flash, hexproof, protection, reach or vigilance in either 75', () => {
    const banned: [string, RegExp][] = [
      ['first strike', /first strike/i], ['double strike', /double strike/i], ['flash', /\bflash\b/i], ['hexproof', /hexproof/i],
      ['protection', /protection from/i], ['reach', /\breach\b/i], ['vigilance', /vigilance/i],
    ];
    const hits = cards.flatMap((c) => banned.filter(([, re]) => re.test(textOf(c)) || c.keywords.some((k) => re.test(k))).map(([k]) => `${c.name}: ${k}`));
    console.log(`pool assertion: ${cards.length} oracle entries scanned for ${banned.length} skipped keywords; ${hits.length} hit(s)`);
    expect(cards.length).toBe(56);
    expect(hits).toEqual([]);
  });

  it('no damage prevention: every mention of prevention is a can\'t-be-prevented clause', () => {
    const lines = cards.flatMap((c) => textOf(c).split('\n').filter((l) => /prevent/i.test(l)).map((l) => ({ name: c.name, l })));
    console.log(`pool assertion: ${lines.length} line(s) mention prevention`);
    expect(lines.length).toBeGreaterThan(0);
    for (const { name, l } of lines) {
      // Remove every "can't be prevented" clause; nothing about preventing may remain.
      expect({ name, rest: l.replace(/can['’]t be prevented/gi, '') }).toEqual({ name, rest: expect.not.stringMatching(/prevent/i) });
    }
  });
});
