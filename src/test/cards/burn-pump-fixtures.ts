// Shared stand-ins and helpers for the burn-pump card family tests (not a test file itself).
// Player 0 is B (mono-red), player 1 is A (Rakdos), unless a test says otherwise. Stand-ins are
// test-only defs named 'Test BP ...' so these tests do not depend on other families' defs.
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { registerTestDef, TestBear } from '../helpers.js';
import { act as actDef, adventure, card, face, land, room, spell, stat, t, trig } from '../../cards/dsl.js';
import { getDef } from '../../cards/index.js';
import { characteristics } from '../../engine/statics.js';
import { act, pass } from '../scenario.js';
import type { CardDef, GameState, ObjId, Target } from '../../engine/types.js';

export const lib = (n: number): string[] => Array.from({ length: n }, () => TestBear.id);

export const pt = (s: GameState, id: ObjId): [number, number] => {
  const c = characteristics(s, id);
  return [c.power, c.toughness];
};

/** Passes until the stack is empty, stopping at any pending Choice other than combat declarations. */
export function drain(s: GameState, cap = 50): void {
  for (let i = 0; i < cap && s.zones.stack.length > 0 && !s.result; i++) {
    const k = s.pendingChoice?.kind;
    if (k && k !== 'declareAttackers' && k !== 'declareBlockers') return;
    pass(s);
  }
}

/** Answers a pending pickTargets Choice with the option whose targets equal want. */
export function pickTargets(s: GameState, want: Target[]): void {
  const c = s.pendingChoice;
  if (!c || c.kind !== 'pickTargets') throw new Error(`expected pickTargets, got ${JSON.stringify(c)}`);
  const i = c.options.findIndex((o) => JSON.stringify(o) === JSON.stringify(want));
  if (i < 0) throw new Error(`target ${JSON.stringify(want)} not offered: ${JSON.stringify(c.options)}`);
  act(s, { type: 'choose', answer: { index: i } });
}

/** Passes until a Choice of this kind is pending (combat declarations). */
export function until(s: GameState, kind: string, cap = 50): void {
  for (let i = 0; i < cap && s.pendingChoice?.kind !== kind && !s.result; i++) act(s, { type: 'pass' });
}

/** Passes until the turn number changes (runs cleanup), answering combat declarations with nothing. */
export function toNextTurn(s: GameState, cap = 200): void {
  const turn = s.turn;
  for (let i = 0; i < cap && s.turn === turn && !s.result; i++) pass(s);
}

interface OracleCard {
  name: string; mana_cost: string; type_line: string; colors: string[]; power: string | null; toughness: string | null;
}
const ORACLE = JSON.parse(readFileSync(new URL('../../../decks/oracle.json', import.meta.url), 'utf8')) as Record<string, OracleCard>;

/** The def's cost, types, subtypes, colors and P/T equal decks/oracle.json exactly. */
export function expectOracle(def: CardDef): void {
  const o = ORACLE[def.name];
  if (!o) throw new Error(`oracle.json has no ${def.name}`);
  const f = getDef(def.id).faces[0];
  if (!f) throw new Error('no face');
  const [left, right] = o.type_line.split(' — ');
  expect(f.cost).toBe(o.mana_cost);
  expect([...f.supertypes, ...f.types].join(' ')).toBe(left);
  expect(f.subtypes.join(' ')).toBe(right ?? '');
  expect(f.colors).toEqual(o.colors);
  expect(f.pt ?? null).toEqual(o.power === null ? null : [Number(o.power), Number(o.toughness)]);
}

// ---- stand-ins ---------------------------------------------------------------------------------

/** Sheoldred, the Apocalypse stand-in: black 4/5. */
export const Sheol = registerTestDef(card('Test BP Sheoldred', [face({ name: 'Test BP Sheoldred', types: ['Creature'], cost: '{2}{B}{B}', pt: [4, 5] })]));
/** Bloodtithe Harvester stand-in: black and red 3/2. */
export const Harv = registerTestDef(card('Test BP Harvester', [face({ name: 'Test BP Harvester', types: ['Creature'], cost: '{B}{R}', pt: [3, 2] })]));
/** Gifted Aetherborn stand-in: 2/3 deathtouch lifelink. */
export const Aeth = registerTestDef(card('Test BP Aetherborn', [face({
  name: 'Test BP Aetherborn', types: ['Creature'], cost: '{B}{B}', pt: [2, 3], keywords: ['deathtouch', 'lifelink'],
})]));
/** Goblin Shaman token stand-in: red 2/2. */
export const Gob = registerTestDef(card('Test BP Goblin', [face({ name: 'Test BP Goblin', types: ['Creature'], cost: '{1}{R}', pt: [2, 2] })]));
/** A 1/1 for pruning tests. */
export const Elf = registerTestDef(card('Test BP Elf', [face({ name: 'Test BP Elf', types: ['Creature'], cost: '{G}', pt: [1, 1] })]));
/** Monastery Swiftspear stand-in: red 1/2 haste prowess. */
export const Spear = registerTestDef(card('Test BP Spear', [face({
  name: 'Test BP Spear', types: ['Creature'], cost: '{R}', pt: [1, 2], keywords: ['haste', 'prowess'],
})]));
/** Graveyard Trespasser stand-in: 3/3 with ward (discard a card). */
export const Tresp = registerTestDef(card('Test BP Trespasser', [face({
  name: 'Test BP Trespasser', types: ['Creature'], cost: '{2}{B}', pt: [3, 3], keywords: ['ward'],
  abilities: [stat({ category: 'marker', marker: 'ward', wardCost: { discard: 1 } })],
})]));
/** Etching of Kumano stand-in: a creature dealt damage this turn by a source you controlled is exiled instead of dying. */
export const Etching = registerTestDef(card('Test BP Etching', [face({
  name: 'Test BP Etching', types: ['Enchantment'], cost: '{2}{R}',
  abilities: [stat({
    category: 'dieReplacement',
    applies: (ctx, dying) => { const o = ctx.obj(dying); return !!o && ctx.isType(dying, 'Creature') && o.damagedThisTurnBy[ctx.controller]; },
  })],
})]));
/** Mutavault stand-in: a land that taps for R and becomes a 2/2 creature until end of turn for {1}. */
export const Vault = registerTestDef(card('Test BP Vault', [land({
  name: 'Test BP Vault', subtypes: ['Mountain'],
  abilities: [actDef({ cost: { mana: '{1}' }, resolve: (ctx) => { ctx.animate(ctx.source, { types: ['Creature'], pt: [2, 2] }); } })],
})]));
/** Fatal Push stand-in: destroy target creature (non-damage removal). */
export const Push = registerTestDef(card('Test BP Push', [face({
  name: 'Test BP Push', types: ['Instant'], cost: '{B}',
  abilities: [spell({ target: t.creature(), resolve: (ctx, [tg]) => { if (tg?.kind === 'obj') ctx.destroy(tg.id); } })],
})]));
/** A {B} instant: you gain 3 life. */
export const Salve = registerTestDef(card('Test BP Salve', [face({
  name: 'Test BP Salve', types: ['Instant'], cost: '{B}', abilities: [spell({ resolve: (ctx) => { ctx.gainLife(ctx.controller, 3); } })],
})]));
/** Thoughtseize stand-in: {B} sorcery, you lose 2 life. */
export const Seize = registerTestDef(card('Test BP Seize', [face({
  name: 'Test BP Seize', types: ['Sorcery'], cost: '{B}', abilities: [spell({ resolve: (ctx) => { ctx.loseLife(ctx.controller, 2); } })],
})]));
/** Bonecrusher Giant stand-in: 4/3; becoming the target of a spell deals 2 damage to that spell's controller. */
export const Crusher = registerTestDef(adventure('Test BP Crusher // Test BP Stomp',
  face({
    name: 'Test BP Crusher', types: ['Creature'], subtypes: ['Giant'], cost: '{2}{R}', pt: [4, 3],
    abilities: [trig('becomesTarget', { filter: (_ctx, info) => info.amount === 1 }, (ctx, _t, info) => {
      if (info.player !== undefined) ctx.dealDamage({ kind: 'player', p: info.player }, 2);
    })],
  }),
  face({
    name: 'Test BP Stomp', types: ['Instant'], subtypes: ['Adventure'], cost: '{1}{R}',
    abilities: [spell({ target: t.any(), resolve: (ctx, [tg]) => { if (tg) ctx.dealDamage(tg, 2); } })],
  })));
/** Unholy Annex // Ritual Chamber stand-in: a Room; the Chamber door is unlocked as a special action. */
export const Annex = registerTestDef(room('Test BP Annex // Test BP Chamber',
  face({ name: 'Test BP Annex', types: ['Enchantment'], subtypes: ['Room'], cost: '{2}{B}' }),
  face({ name: 'Test BP Chamber', types: ['Enchantment'], subtypes: ['Room'], cost: '{1}{B}' })));
