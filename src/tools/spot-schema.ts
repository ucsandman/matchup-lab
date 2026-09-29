// Spot files (docs/SPOT-FORMAT.md): a JSON description of one game position as one player sees it,
// written by a person or saved from a live game, and turned into a PlayerView for the Phase 4
// analyzer and the Phase 5 'spot' CLI.
//  - SPOT_SCHEMA is the JSON Schema of the file (draft 2020-12 keywords, the subset validate() checks:
//    type, const, enum, properties, required, additionalProperties, items, minItems, maxItems,
//    minimum, maximum, anyOf). It is the source of truth for field names and shapes.
//  - loadSpot validates the file against the schema, then against the oracle names and the two
//    decklists (copies, zone sizes, ids, references), and builds the PlayerView.
//  - saveSpot writes a PlayerView (for example view(state, p) from a live game) as a spot file.
//    loadSpot(saveSpot(v)) rebuilds v byte for byte (JSON.stringify equal): fields equal to their
//    defaults are left out and every other object field keeps its order.
// Players are 0 (deck A, decks/deckA.json) and 1 (deck B, decks/deckB.json) everywhere.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allDefs, getDef } from '../cards/index.js';
import { emptyState, loadDeckFile, type DeckInput } from '../engine/setup.js';
import { cloneData } from '../engine/mutate.js';
import { priorityStep } from '../engine/turn.js';
import { blankObject } from '../engine/zones.js';
import { TURN_STEPS } from '../engine/types.js';
import type { CounterType, DefId, GameObject, ObjId, PlayerId, StackItem, Step, TurnFlags, Zone } from '../engine/types.js';
import type { HandView, LibraryView, PlayerView, ViewPlayer } from '../engine/view.js';
import { deckDefIds, freshBase } from '../agents/determinize.js';

export const SPOT_VERSION = 1;

type Json = Record<string, unknown>;
type Schema = Json;

// ---- schema ----------------------------------------------------------------------------------

const STEPS: Step[] = ['mulligan', ...TURN_STEPS];
const PLAYER: Schema = { type: 'integer', enum: [0, 1], description: '0 = deck A, 1 = deck B' };
const BOOL: Schema = { type: 'boolean' };
const INT0: Schema = { type: 'integer', minimum: 0 };
const pair = (s: Schema): Schema => ({ type: 'array', items: s, minItems: 2, maxItems: 2 });
const NOTE: Schema = { type: 'string', description: 'Free text for people; ignored by the loader.' };
const COUNTERS: Schema = {
  type: 'object', additionalProperties: false,
  properties: Object.fromEntries(['p1p1', 'm1m1', 'lore', 'loyalty', 'charge'].map((k) => [k, { type: 'integer', minimum: 1 }])),
};

/** Fields of a card object other than name and id (also the 'card' of a spell on the stack). */
const CARD_FIELDS: Record<string, Schema> = {
  note: NOTE,
  controller: PLAYER,
  owner: PLAYER,
  face: { type: 'integer', enum: [0, 1], description: '1 = back face (transformed, or the MDFC back played)' },
  tapped: BOOL,
  damage: INT0,
  sick: { type: 'boolean', description: 'Summoning sick (came under this control since the controller\'s turn began)' },
  counters: COUNTERS,
  lore: { type: 'integer', minimum: 1, description: 'Shorthand for counters.lore' },
  loyalty: { type: 'integer', minimum: 1, description: 'Shorthand for counters.loyalty' },
  knownTo: { ...pair(BOOL), description: 'Who knows the card: [player 0, player 1]' },
  token: { type: 'string' },
  copyOf: { type: 'string' },
  copyFace: { type: 'integer', const: 1 },
  attachedTo: { type: 'integer', minimum: 1 },
  unlocked: pair(BOOL),
  onAdventure: BOOL,
  exiledWith: { type: 'integer' },
  damagedThisTurnBy: pair(BOOL),
  valiantUsed: BOOL,
  attacksThisTurn: INT0,
  attacking: { type: 'object', required: ['kind'] },
  blocking: { type: 'array', items: { type: 'integer', minimum: 1 } },
  blocked: BOOL,
  deathtouched: BOOL,
  animated: { type: 'object' },
  crewed: BOOL,
  chosenName: { type: 'string' },
};
const CARD_OBJECT: Schema = {
  type: 'object', required: ['name'], additionalProperties: false,
  properties: { name: { type: 'string' }, id: { type: 'integer', minimum: 1 }, ...CARD_FIELDS },
};
const CARD: Schema = { anyOf: [{ type: 'string' }, CARD_OBJECT], description: 'A card name, or an object with name and state' };
const CARDS: Schema = { type: 'array', items: CARD };

const STACK_ITEM: Schema = {
  type: 'object', required: ['name'], additionalProperties: false,
  properties: {
    name: { type: 'string', description: 'The spell, or the source of the ability' },
    note: NOTE,
    card: { type: 'object', additionalProperties: false, properties: CARD_FIELDS, description: 'State of the spell card (spells only)' },
    id: { type: 'integer', minimum: 1 },
    kind: { type: 'string', enum: ['spell', 'activated', 'triggered'] },
    controller: PLAYER,
    sourceId: { type: 'integer', minimum: 1 },
    defId: { type: 'string' },
    face: { type: 'integer', enum: [0, 1] },
    abilityKey: { type: 'string' },
    targets: { type: 'array', items: { type: 'object', required: ['kind'] } },
    mode: INT0,
    kicked: BOOL,
    bargained: BOOL,
    x: INT0,
    trigger: { type: 'object', required: ['event'] },
    lki: { type: 'object' },
    enterCounters: COUNTERS,
  },
};

const PLAYER_OBJECT: Schema = {
  type: 'object', additionalProperties: false,
  properties: {
    note: NOTE,
    life: { type: 'integer' },
    mulligans: { type: 'integer', minimum: 0, maximum: 7 },
    kept: BOOL,
    cantGainLife: BOOL,
    drewFromEmpty: BOOL,
    manaPool: {
      type: 'array',
      items: {
        type: 'object', required: ['color'], additionalProperties: false,
        properties: {
          color: { type: 'string', enum: ['W', 'U', 'B', 'R', 'G', 'C'] },
          restriction: { type: 'string', enum: ['creatureSpell'] },
          expires: { type: 'string', enum: ['endOfCombat'] },
        },
      },
    },
    hand: { ...CARDS, description: 'The viewer: the whole hand. The opponent: the cards the viewer knows (revealed).' },
    handHidden: { ...INT0, description: 'Opponent only (required): how many cards in their hand the viewer does not know' },
    graveyard: CARDS,
    exile: CARDS,
    library: {
      type: 'object', additionalProperties: false,
      properties: {
        size: { ...INT0, description: 'Cards in the library; left out, it is the deck size minus every other card of this player' },
        knownTop: { ...CARDS, description: 'Viewer only: known cards from the top down (a scry kept on top)' },
        knownBottom: { ...CARDS, description: 'Viewer only: known cards from the very bottom up (London mulligan bottoms, scry to the bottom)' },
        revealed: { ...CARDS, description: 'Library cards a pending choice shows the viewer (pendingChoice.reveal)' },
      },
    },
  },
};

export const SPOT_SCHEMA: Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Spot file (one position as one player sees it)',
  type: 'object',
  required: ['spot', 'viewer', 'turn', 'step', 'activePlayer', 'players'],
  additionalProperties: false,
  properties: {
    spot: { const: SPOT_VERSION, description: 'Format version' },
    note: NOTE,
    decks: {
      type: 'array', minItems: 2, maxItems: 2, description: 'Deck files under decks/ or lists; default ["deckA", "deckB"]',
      items: { anyOf: [{ type: 'string' }, { type: 'object', required: ['main'], properties: { main: { type: 'array' } } }] },
    },
    viewer: { ...PLAYER, description: 'Whose eyes the spot is seen through' },
    turn: { type: 'integer', minimum: 0, description: 'Turn number counting both players\' turns; 0 = before the game (mulligans)' },
    step: { type: 'string', enum: STEPS },
    activePlayer: PLAYER,
    priority: { ...PLAYER, description: 'Default: the active player' },
    startingPlayer: { ...PLAYER, description: 'Who took turn 1; default follows from turn and activePlayer' },
    phaseQueue: { type: 'array', items: { type: 'string', enum: STEPS }, description: 'Steps left this turn; default: the normal rest of the turn' },
    dayNight: { type: 'string', enum: ['none', 'day', 'night'] },
    flags: {
      type: 'object', additionalProperties: false, description: 'This turn\'s counts, per player [0, 1]; default all zero',
      properties: {
        landsPlayed: pair(INT0), spellsCast: pair(INT0), noncreatureSpellsCast: pair(INT0), permanentLeft: pair(BOOL),
        nextCreatureBonus: pair(BOOL), damageTally: { type: 'object' }, loyaltyUsed: { type: 'array', items: { type: 'integer' } },
      },
    },
    passes: { type: 'integer', minimum: 0, maximum: 1, description: 'Priority passes in a row so far (1 = the other player just passed)' },
    stepPriority: BOOL,
    effects: { type: 'array', items: { type: 'object', required: ['kind'] } },
    delayed: { type: 'array', items: { type: 'object', required: ['key'] } },
    pendingChoice: { type: ['object', 'null'] },
    pregame: { type: ['object', 'null'] },
    result: { type: ['object', 'null'] },
    players: { type: 'array', items: PLAYER_OBJECT, minItems: 2, maxItems: 2 },
    battlefield: { ...CARDS, description: 'Every permanent in play; each needs a controller' },
    stack: { type: 'array', items: STACK_ITEM, description: 'Bottom first: the last item resolves first' },
  },
};

// ---- a small validator for the schema subset -----------------------------------------------------

function editDistance(a: string, b: string): number {
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0] as number;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j] as number;
      d[j] = Math.min((d[j] as number) + 1, (d[j - 1] as number) + 1, prev + (a[i - 1]?.toLowerCase() === b[j - 1]?.toLowerCase() ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length] as number;
}

function closest(word: string, options: Iterable<string>): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const o of options) {
    const dist = editDistance(word, o);
    if (dist < bestD) { bestD = dist; best = o; }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

const typeOf = (x: unknown): string => (x === null ? 'null' : Array.isArray(x) ? 'array' : Number.isInteger(x) ? 'integer' : typeof x);
const show = (x: unknown): string => JSON.stringify(x) ?? String(x);

/** Checks value against the schema subset; pushes one message per problem, each starting with its path. */
export function validate(schema: Schema, value: unknown, path: string, errors: string[]): void {
  if (schema.anyOf) {
    const branches = schema.anyOf as Schema[];
    const match = branches.find((b) => typeMatches(b.type, value));
    if (!match) { errors.push(`${path}: expected ${branches.map((b) => String(b.type)).join(' or ')}, got ${show(value)}`); return; }
    validate(match, value, path, errors);
    return;
  }
  if (schema.type !== undefined && !typeMatches(schema.type, value)) {
    errors.push(`${path}: expected ${[schema.type].flat().join(' or ')}, got ${show(value)}`);
    return;
  }
  if ('const' in schema && value !== schema.const) errors.push(`${path}: must be ${show(schema.const)}, got ${show(value)}`);
  if (schema.enum && !(schema.enum as unknown[]).includes(value)) {
    errors.push(`${path}: ${show(value)} is not one of ${(schema.enum as unknown[]).map(show).join(', ')}`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path}: ${value} is below the minimum ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path}: ${value} is above the maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} items, has ${value.length}`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(`${path}: allows at most ${schema.maxItems} items, has ${value.length}`);
    if (schema.items) value.forEach((v, i) => validate(schema.items as Schema, v, `${path}[${i}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Json;
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const r of (schema.required ?? []) as string[]) if (!(r in obj)) errors.push(`${path}: missing required field "${r}"`);
    for (const [k, v] of Object.entries(obj)) {
      const ps = props[k];
      if (ps) validate(ps, v, `${path}.${k}`, errors);
      else if (schema.additionalProperties === false) {
        const hint = closest(k, Object.keys(props));
        errors.push(`${path}: unknown field "${k}"${hint ? `; did you mean "${hint}"?` : ''}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validate(schema.additionalProperties as Schema, v, `${path}.${k}`, errors);
      }
    }
  }
}

function typeMatches(type: unknown, value: unknown): boolean {
  if (type === undefined) return true;
  const t = typeOf(value);
  return [type].flat().some((x) => x === t || (x === 'number' && t === 'integer'));
}

// ---- names -----------------------------------------------------------------------------------

interface NameHit { defId: DefId; face?: 0 | 1; token: boolean }

const ORACLE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'decks', 'oracle.json');
let nameCache: { valid: Set<string>; hits: Map<string, NameHit> } | null = null;

/** Oracle card names and face names, plus token names, and what each resolves to. */
function names(): { valid: Set<string>; hits: Map<string, NameHit> } {
  if (nameCache) return nameCache;
  const oracle = JSON.parse(readFileSync(ORACLE_FILE, 'utf8')) as Record<string, { card_faces?: { name: string }[] }>;
  const valid = new Set<string>();
  for (const [name, c] of Object.entries(oracle)) {
    valid.add(name);
    for (const f of c.card_faces ?? []) valid.add(f.name);
  }
  const hits = new Map<string, NameHit>();
  for (const d of allDefs()) {
    if (d.testOnly) continue;
    const token = d.layout === 'token';
    if (token) valid.add(d.name);
    hits.set(d.name, { defId: d.id, token });
    d.faces.forEach((f, i) => { if (f.name !== d.name && !hits.has(f.name)) hits.set(f.name, { defId: d.id, face: i as 0 | 1, token }); });
  }
  nameCache = { valid, hits };
  return nameCache;
}

// ---- errors and deck labels ------------------------------------------------------------------

export class SpotError extends Error {
  constructor(readonly errors: string[]) {
    super(`spot file rejected (${errors.length} problem${errors.length === 1 ? '' : 's'}):\n  - ${errors.join('\n  - ')}`);
  }
}

const AB = (p: PlayerId): string => (p === 0 ? 'A' : 'B');
function deckLabel(d: DeckInput, p: PlayerId): string {
  const list = typeof d === 'string' ? loadDeckFile(d) : d;
  return `deck ${AB(p)} (${list.archetype ?? (typeof d === 'string' ? d : 'custom list')})`;
}

// ---- defaults shared by the loader and the saver ---------------------------------------------

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const BASE_KEYS = new Set(Object.keys(blankObject(1, 'x', 0, 'hand')));
/** Keys a card entry carries that are not GameObject fields, or that the entry's place implies. */
const ENTRY_ONLY = new Set(['name', 'id', 'owner', 'controller', 'note', 'lore', 'loyalty', 'zone', 'defId']);

function defaultKnownTo(zone: Zone, owner: PlayerId, viewer: PlayerId): [boolean, boolean] {
  if (zone !== 'hand' && zone !== 'library') return [true, true];
  const k: [boolean, boolean] = [false, false];
  k[owner] = true;
  k[other(owner)] = owner !== viewer;
  return k;
}

/** Counters a permanent enters with by default: a saga's first lore counter, a planeswalker's printed loyalty. */
function defaultCounters(defId: DefId, face: number, zone: Zone): Partial<Record<CounterType, number>> {
  const c: Partial<Record<CounterType, number>> = {};
  if (zone !== 'battlefield') return c;
  const f = getDef(defId).faces[face];
  if (f?.subtypes.includes('Saga')) c.lore = 1;
  if (f?.loyalty !== undefined) c.loyalty = f.loyalty;
  return c;
}

const defaultStarting = (turn: number, active: PlayerId): PlayerId => (turn === 0 || turn % 2 === 1 ? active : other(active));
const defaultQueue = (step: Step): Step[] => { const at = TURN_STEPS.indexOf(step); return at >= 0 ? TURN_STEPS.slice(at + 1) : []; };
const defaultFlags = (): TurnFlags => emptyState(0).turnFlags;

// ---- loader ----------------------------------------------------------------------------------

export interface LoadedSpot { view: PlayerView; decks: [DeckInput, DeckInput] }

interface Placed { e: Json; path: string; hit: NameHit; zone: Zone; owner: PlayerId; controller: PlayerId; id: ObjId }

const asEntry = (c: unknown): Json => (typeof c === 'string' ? { name: c } : (c as Json));

/**
 * Validates a spot file (a JSON string or its parsed value) and builds the PlayerView. Throws
 * SpotError listing every problem found. The decks come from the file's 'decks', else opts.decks,
 * else decks/deckA.json and decks/deckB.json.
 */
export function loadSpot(input: unknown, opts: { decks?: [DeckInput, DeckInput] } = {}): LoadedSpot {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try { raw = JSON.parse(input); } catch (e) { throw new SpotError([`not valid JSON: ${(e as Error).message}`]); }
  }
  const errors: string[] = [];
  validate(SPOT_SCHEMA, raw, 'spot', errors);
  if (errors.length) throw new SpotError(errors);
  const f = raw as Json;
  const decks = (f.decks as [DeckInput, DeckInput] | undefined) ?? opts.decks ?? ['deckA', 'deckB'];
  let lists: [DefId[], DefId[]];
  try { lists = [deckDefIds(decks[0]), deckDefIds(decks[1])]; } catch (e) { throw new SpotError([`decks: ${(e as Error).message}`]); }
  const viewer = f.viewer as PlayerId;
  const opp = other(viewer);
  const turn = f.turn as number;
  const step = f.step as Step;
  const players = f.players as Json[];
  const { valid, hits } = names();

  if (turn === 0 && step !== 'mulligan') errors.push(`spot.step: turn 0 is the mulligan pregame, so step must be "mulligan", got "${step}"`);
  if (turn > 0 && step === 'mulligan') errors.push(`spot.step: "mulligan" is only for turn 0, got turn ${turn}`);
  if (turn === 0 && (f.pregame === undefined || f.pregame === null)) errors.push('spot.pregame: required at turn 0 (who still declares, mulligans and bottoms)');

  // Every card entry, with where it is.
  const placed: Placed[] = [];
  const resolveName = (name: string, path: string): NameHit | null => {
    if (!valid.has(name)) {
      const hint = closest(name, valid);
      errors.push(`${path}: unknown card name "${name}" (not in decks/oracle.json)${hint ? `; did you mean "${hint}"?` : ''}`);
      return null;
    }
    const hit = hits.get(name);
    if (!hit) { errors.push(`${path}: "${name}" has no card definition in src/cards`); return null; }
    return hit;
  };
  const add = (c: unknown, path: string, zone: Zone, owner: PlayerId | null, controller: PlayerId | null): void => {
    const e = asEntry(c);
    const hit = resolveName(e.name as string, `${path} (${String(e.name)})`);
    if (!hit) return;
    const where = `${path} (${String(e.name)})`;
    let own: PlayerId;
    let ctl: PlayerId;
    if (zone === 'battlefield') {
      if (e.controller === undefined) { errors.push(`${where}: controller is required on the battlefield (0 = deck A, 1 = deck B)`); return; }
      ctl = e.controller as PlayerId;
      own = (e.owner as PlayerId | undefined) ?? ctl;
    } else if (zone === 'stack') {
      ctl = (e.controller as PlayerId | undefined) ?? (controller as PlayerId);
      own = (e.owner as PlayerId | undefined) ?? ctl;
    } else {
      own = owner as PlayerId;
      if (e.owner !== undefined && e.owner !== own) errors.push(`${where}: owner ${String(e.owner)} does not match the player whose ${zone} it is in (${own})`);
      ctl = (e.controller as PlayerId | undefined) ?? own;
    }
    if (hit.token && zone !== 'battlefield') errors.push(`${where}: a token exists only on the battlefield (CR 111.7 (token leaves the battlefield))`);
    placed.push({ e, path: where, hit, zone, owner: own, controller: ctl, id: (e.id as ObjId | undefined) ?? 0 });
  };

  ((f.battlefield ?? []) as unknown[]).forEach((c, i) => add(c, `spot.battlefield[${i}]`, 'battlefield', null, null));
  const stack = (f.stack ?? []) as Json[];
  const stackCard = new Map<number, Placed>();
  stack.forEach((it, i) => {
    const path = `spot.stack[${i}]`;
    if (it.controller === undefined) { errors.push(`${path} (${String(it.name)}): controller is required`); return; }
    const kind = (it.kind as string | undefined) ?? 'spell';
    if (kind === 'spell') {
      const before = placed.length;
      add({ name: it.name, ...((it.card ?? {}) as Json), ...(it.id !== undefined ? { id: it.id } : {}) }, path, 'stack', null, it.controller as PlayerId);
      if (placed.length > before) stackCard.set(i, placed[placed.length - 1] as Placed);
    } else {
      if (it.card !== undefined) errors.push(`${path}: "card" is only for spells`);
      if (it.sourceId === undefined || it.abilityKey === undefined) errors.push(`${path}: an ability on the stack needs sourceId and abilityKey (copy it from a saved spot)`);
      // A saved ability names its def id (it may be a def no deck lists, such as a manland's granted abilities).
      if (it.defId === undefined) resolveName(it.name as string, `${path} (${String(it.name)})`);
      else if (!allDefs().some((d) => d.id === it.defId)) errors.push(`${path}: defId "${String(it.defId)}" has no card definition`);
    }
  });
  for (const p of [0, 1] as const) {
    const pl = players[p] as Json;
    const base = `spot.players[${p}]`;
    ((pl.hand ?? []) as unknown[]).forEach((c, i) => add(c, `${base}.hand[${i}]`, 'hand', p, null));
    ((pl.graveyard ?? []) as unknown[]).forEach((c, i) => add(c, `${base}.graveyard[${i}]`, 'graveyard', p, null));
    ((pl.exile ?? []) as unknown[]).forEach((c, i) => add(c, `${base}.exile[${i}]`, 'exile', p, null));
    const lib = (pl.library ?? {}) as Json;
    for (const k of ['knownTop', 'knownBottom', 'revealed'] as const) {
      const cards = (lib[k] ?? []) as unknown[];
      if (k !== 'revealed' && p !== viewer && cards.length) {
        errors.push(`${base}.library.${k}: the opponent's library order is not part of a spot (only the viewer's own known positions are; no card in either 75 shows you the order of the opponent's library)`);
      }
      cards.forEach((c, i) => add(c, `${base}.library.${k}[${i}]`, 'library', p, null));
    }
    if (p === viewer && (pl.handHidden ?? 0) !== 0) errors.push(`${base}.handHidden: the viewer knows their own hand; list every card in hand`);
    if (p === opp && pl.handHidden === undefined) errors.push(`${base}.handHidden: required for the opponent (how many of their hand cards you do not know; 0 if none)`);
  }

  // Decklists: every card in its owner's list, no more copies than the list has.
  const seen = new Map<string, string[]>();
  for (const c of placed) {
    if (c.hit.token) continue;
    const list = lists[c.owner];
    if (!list.includes(c.hit.defId)) {
      const inOther = lists[other(c.owner)].includes(c.hit.defId) ? `; it is in ${deckLabel(decks[other(c.owner)], other(c.owner))}` : '';
      errors.push(`${c.path}: not in ${deckLabel(decks[c.owner], c.owner)}, which owns this zone${inOther}`);
      continue;
    }
    const key = `${c.owner}:${c.hit.defId}`;
    seen.set(key, [...(seen.get(key) ?? []), c.path]);
  }
  for (const [key, paths] of seen) {
    const [ps, defId] = key.split(':') as [string, DefId];
    const p = Number(ps) as PlayerId;
    const have = lists[p].filter((d) => d === defId).length;
    if (paths.length > have) {
      errors.push(`${deckLabel(decks[p], p)}: ${paths.length} copies of "${getDef(defId).name}" in the spot, the list has ${have} (${paths.join(', ')})`);
    }
  }

  // Zone sizes add up to the deck size; library.size defaults to what is left.
  const libSize: [number, number] = [0, 0];
  for (const p of [0, 1] as const) {
    const pl = players[p] as Json;
    const lib = (pl.library ?? {}) as Json;
    const cardsOf = placed.filter((c) => c.owner === p && !c.hit.token);
    const outside = cardsOf.filter((c) => c.zone !== 'library').length;
    const inLib = cardsOf.filter((c) => c.zone === 'library').length;
    const hidden = (pl.handHidden ?? 0) as number;
    const deckSize = lists[p].length;
    const label = deckLabel(decks[p], p);
    if (lib.size === undefined) {
      libSize[p] = deckSize - outside - hidden;
      if (libSize[p] < inLib) errors.push(`${label}: ${outside} cards placed outside the library + ${hidden} unseen in hand = ${outside + hidden}, which leaves ${libSize[p]} for the library, fewer than the ${inLib} known library cards (the list has ${deckSize})`);
    } else {
      libSize[p] = lib.size as number;
      const total = outside + hidden + libSize[p];
      if (libSize[p] < inLib) errors.push(`spot.players[${p}].library.size: ${libSize[p]} is fewer than the ${inLib} known library cards listed`);
      else if (total !== deckSize) {
        errors.push(`${label}: ${outside} cards placed outside the library + ${hidden} unseen in hand + ${libSize[p]} in library = ${total}, the list has ${deckSize} (leave library.size out and it is computed)`);
      }
    }
  }

  // Ids: explicit ids unique; the rest are assigned above every number in the file.
  const idOwner = new Map<number, string>();
  const claim = (id: number, path: string): void => {
    const prev = idOwner.get(id);
    if (prev !== undefined) errors.push(`${path}: id ${id} is already used by ${prev}`);
    else idOwner.set(id, path);
  };
  for (const c of placed) if (c.id) claim(c.id, c.path);
  stack.forEach((it, i) => { if (it.id !== undefined && (it.kind ?? 'spell') !== 'spell') claim(it.id as number, `spot.stack[${i}]`); });
  let nextId = freshBase(f);
  for (const c of placed) if (!c.id) c.id = nextId++;
  const stackIds = stack.map((it, i) => stackCard.get(i)?.id ?? (it.id as number | undefined) ?? nextId++);

  // References among cards.
  const bf = new Set(placed.filter((c) => c.zone === 'battlefield').map((c) => c.id));
  for (const c of placed) {
    if (c.e.attachedTo !== undefined && !bf.has(c.e.attachedTo as number)) errors.push(`${c.path}: attachedTo ${String(c.e.attachedTo)} is not the id of a permanent in spot.battlefield`);
    // 'blocking' is not checked: a blocker keeps the id of an attacker removed from combat, as a spell keeps a gone target's id.
    if (c.zone !== 'battlefield') {
      for (const k of ['tapped', 'damage', 'attacking', 'blocking', 'blocked', 'attachedTo', 'animated', 'sick', 'crewed'] as const) {
        if (c.e[k] !== undefined && c.e[k] !== false && c.e[k] !== 0) errors.push(`${c.path}: "${k}" is battlefield-only state`);
      }
    }
  }
  const pc = f.pendingChoice as Json | null | undefined;
  const reveal = new Set(pc && pc.kind === 'pickObjects' && pc.player === viewer ? ((pc.reveal ?? []) as number[]) : []);
  for (const c of placed) {
    if (c.path.includes('.library.revealed') && !reveal.has(c.id)) errors.push(`${c.path}: library.revealed is only for cards the viewer's pending choice reveals (pendingChoice.reveal); give the card the id listed there`);
  }
  if (errors.length) throw new SpotError(errors);

  // Build the view, field by field in view()'s order.
  const objects: Record<number, GameObject> = {};
  for (const c of placed) objects[c.id] = buildObject(c, viewer);
  const idsOf = (pred: (c: Placed) => boolean): ObjId[] => placed.filter(pred).map((c) => c.id);
  const activePlayer = f.activePlayer as PlayerId;
  const flags = defaultFlags();
  for (const [k, v] of Object.entries((f.flags ?? {}) as Json)) (flags as unknown as Json)[k] = cloneData(v);
  let vid = 0;
  const hand = ([0, 1] as const).map((p): HandView => ({
    known: idsOf((c) => c.zone === 'hand' && c.owner === p),
    hidden: Array.from({ length: ((players[p] as Json).handHidden ?? 0) as number }, () => ({ vid: `h${vid++}`, zone: 'hand' as Zone, owner: p, hidden: true as const })),
  })) as [HandView, HandView];
  const library = ([0, 1] as const).map((p): LibraryView => {
    const lv: LibraryView = { size: libSize[p] };
    if (p === viewer) {
      lv.knownTop = idsOf((c) => c.owner === p && c.path.includes('.library.knownTop'));
      lv.knownBottom = idsOf((c) => c.owner === p && c.path.includes('.library.knownBottom'));
    }
    return lv;
  }) as [LibraryView, LibraryView];
  const viewPlayers = ([0, 1] as const).map((p): ViewPlayer => {
    const pl = players[p] as Json;
    return {
      life: (pl.life ?? 20) as number,
      cantGainLife: (pl.cantGainLife ?? false) as boolean,
      manaPool: cloneData((pl.manaPool ?? []) as ViewPlayer['manaPool']),
      mulligans: (pl.mulligans ?? 0) as number,
      kept: (pl.kept ?? turn > 0) as boolean,
      drewFromEmpty: (pl.drewFromEmpty ?? false) as boolean,
    };
  }) as [ViewPlayer, ViewPlayer];
  const stackItems = stack.map((it, i): StackItem => {
    const item: Json = {};
    for (const [k, v] of Object.entries(it)) if (k !== 'name' && k !== 'card' && k !== 'note') item[k] = cloneData(v);
    const hit = stackCard.get(i)?.hit ?? hits.get(it.name as string);
    item.id ??= stackIds[i];
    item.kind ??= 'spell';
    item.sourceId ??= item.id;
    item.defId ??= hit?.defId;
    item.face ??= stackCard.get(i) ? objects[item.id as number]?.face ?? 0 : 0;
    item.targets ??= [];
    return item as unknown as StackItem;
  });

  const view: PlayerView = {
    viewer,
    turn,
    activePlayer,
    priority: (f.priority ?? activePlayer) as PlayerId,
    startingPlayer: (f.startingPlayer ?? defaultStarting(turn, activePlayer)) as PlayerId,
    phaseQueue: [...((f.phaseQueue ?? defaultQueue(step)) as Step[])],
    step,
    dayNight: (f.dayNight ?? 'none') as PlayerView['dayNight'],
    turnFlags: flags,
    effects: cloneData((f.effects ?? []) as PlayerView['effects']),
    pendingChoice: cloneData((f.pendingChoice ?? null) as PlayerView['pendingChoice']),
    passes: (f.passes ?? 0) as number,
    stepPriority: (f.stepPriority ?? priorityStep(step)) as boolean,
    delayed: cloneData((f.delayed ?? []) as PlayerView['delayed']),
    pregame: cloneData((f.pregame ?? null) as PlayerView['pregame']),
    result: cloneData((f.result ?? null) as PlayerView['result']),
    players: viewPlayers,
    objects,
    zones: {
      library,
      hand,
      graveyard: [idsOf((c) => c.zone === 'graveyard' && c.owner === 0), idsOf((c) => c.zone === 'graveyard' && c.owner === 1)],
      exile: [idsOf((c) => c.zone === 'exile' && c.owner === 0), idsOf((c) => c.zone === 'exile' && c.owner === 1)],
      battlefield: idsOf((c) => c.zone === 'battlefield'),
      stack: stackItems,
    },
  };
  return { view, decks };
}

/** A GameObject from a card entry: engine field order, defaults for its place, then the entry's fields in file order. */
function buildObject(c: Placed, viewer: PlayerId): GameObject {
  const { e, hit } = c;
  const o = blankObject(c.id, hit.defId, c.owner, c.zone);
  o.controller = c.controller;
  const face = (e.face as 0 | 1 | undefined) ?? ((c.zone === 'battlefield' || c.zone === 'stack') ? hit.face ?? 0 : 0);
  o.face = face;
  o.knownTo = defaultKnownTo(c.zone, c.owner, viewer);
  if (!('counters' in e) && !('lore' in e) && !('loyalty' in e)) o.counters = defaultCounters(hit.defId, face, c.zone);
  if (hit.token && !('token' in e)) o.token = hit.defId;
  const rec = o as unknown as Json;
  for (const [k, v] of Object.entries(e)) {
    if (k === 'lore' || k === 'loyalty') { o.counters = { ...o.counters, [k]: v as number }; continue; }
    if (ENTRY_ONLY.has(k)) continue;
    rec[k] = cloneData(v);
  }
  return o;
}

export function readSpotFile(path: string, opts: { decks?: [DeckInput, DeckInput] } = {}): LoadedSpot {
  return loadSpot(readFileSync(path, 'utf8'), opts);
}

// ---- saver -----------------------------------------------------------------------------------

/** A card entry for an object: name and id, then every field that differs from what its place implies. */
function saveObject(o: GameObject, impliedOwner: PlayerId | null, impliedController: PlayerId | null, viewer: PlayerId): Json {
  const def = getDef(o.defId);
  const e: Json = { name: def.name, id: o.id };
  if (impliedController === null) e.controller = o.controller;
  else if (o.controller !== impliedController) e.controller = o.controller;
  if (o.owner !== (impliedOwner ?? o.controller)) e.owner = o.owner;
  const defaults: Json = {
    face: 0, tapped: false, damage: 0, sick: false, damagedThisTurnBy: [false, false],
    knownTo: defaultKnownTo(o.zone, o.owner, viewer), counters: defaultCounters(o.defId, o.face, o.zone),
  };
  const rec = o as unknown as Json;
  let firstOptional = true;
  for (const k of Object.keys(o)) {
    const v = rec[k];
    if (v === undefined || k === 'id' || k === 'defId' || k === 'owner' || k === 'controller' || k === 'zone') continue;
    if (BASE_KEYS.has(k)) {
      if (!same(v, defaults[k])) e[k] = cloneData(v);
      continue;
    }
    // A token's own def id as its first optional field is what the loader adds for a token name.
    if (!(k === 'token' && firstOptional && v === o.defId && def.layout === 'token')) e[k] = cloneData(v);
    firstOptional = false;
  }
  return e;
}

/**
 * The spot file for a view (a PlayerView from view(state, p), or from loadSpot). Pass the decks the
 * game uses when they are not decks/deckA.json and decks/deckB.json (a sideboard configuration).
 */
export function saveSpot(v: PlayerView, opts: { decks?: [DeckInput, DeckInput]; note?: string } = {}): Json {
  const viewer = v.viewer;
  const objOf = (id: ObjId): GameObject => {
    const o = v.objects[id];
    if (!o) throw new Error(`saveSpot: id ${id} is in a zone but not in view.objects`);
    return o;
  };
  const placedIds = new Set<ObjId>();
  const entry = (id: ObjId, owner: PlayerId | null, controller: PlayerId | null): Json => {
    placedIds.add(id);
    return saveObject(objOf(id), owner, controller, viewer);
  };
  const f: Json = { spot: SPOT_VERSION };
  if (opts.note !== undefined) f.note = opts.note;
  if (opts.decks && !same(opts.decks, ['deckA', 'deckB'])) f.decks = cloneData(opts.decks);
  f.viewer = viewer;
  f.turn = v.turn;
  f.step = v.step;
  f.activePlayer = v.activePlayer;
  if (v.priority !== v.activePlayer) f.priority = v.priority;
  if (v.startingPlayer !== defaultStarting(v.turn, v.activePlayer)) f.startingPlayer = v.startingPlayer;
  if (!same(v.phaseQueue, defaultQueue(v.step))) f.phaseQueue = [...v.phaseQueue];
  if (v.dayNight !== 'none') f.dayNight = v.dayNight;
  const flagDefaults = defaultFlags() as unknown as Json;
  const flags: Json = {};
  for (const [k, val] of Object.entries(v.turnFlags)) if (!same(val, flagDefaults[k])) flags[k] = cloneData(val);
  if (!same(Object.keys(v.turnFlags), Object.keys(flagDefaults))) throw new Error('saveSpot: turnFlags fields differ from the engine\'s');
  if (Object.keys(flags).length) f.flags = flags;
  if (v.passes !== 0) f.passes = v.passes;
  if (v.stepPriority !== priorityStep(v.step)) f.stepPriority = v.stepPriority;
  if (v.effects.length) f.effects = cloneData(v.effects);
  if (v.delayed.length) f.delayed = cloneData(v.delayed);
  if (v.pendingChoice !== null) f.pendingChoice = cloneData(v.pendingChoice);
  if (v.pregame !== null) f.pregame = cloneData(v.pregame);
  if (v.result !== null) f.result = cloneData(v.result);

  const players = ([0, 1] as const).map((p): Json => {
    const vp = v.players[p];
    const pl: Json = { life: vp.life, mulligans: vp.mulligans };
    if (vp.kept !== v.turn > 0) pl.kept = vp.kept;
    if (vp.cantGainLife) pl.cantGainLife = true;
    if (vp.drewFromEmpty) pl.drewFromEmpty = true;
    if (vp.manaPool.length) pl.manaPool = cloneData(vp.manaPool);
    pl.hand = v.zones.hand[p].known.map((id) => entry(id, p, p));
    if (p !== viewer) pl.handHidden = v.zones.hand[p].hidden.length;
    pl.graveyard = v.zones.graveyard[p].map((id) => entry(id, p, p));
    pl.exile = v.zones.exile[p].map((id) => entry(id, p, p));
    const lv = v.zones.library[p];
    const lib: Json = { size: lv.size };
    if (lv.knownTop?.length) lib.knownTop = lv.knownTop.map((id) => entry(id, p, p));
    if (lv.knownBottom?.length) lib.knownBottom = lv.knownBottom.map((id) => entry(id, p, p));
    pl.library = lib;
    return pl;
  });
  f.players = players;
  f.battlefield = v.zones.battlefield.map((id) => entry(id, null, null));
  const stack = v.zones.stack.map((it): Json => {
    const s: Json = { name: getDef(it.defId).name };
    for (const [k, val] of Object.entries(it)) if (val !== undefined) s[k] = cloneData(val);
    if (it.kind === 'spell' && v.objects[it.id]) {
      const card = entry(it.id, null, it.controller);
      delete card.name;
      delete card.id;
      if (Object.keys(card).length) s.card = card;
    }
    return s;
  });
  if (stack.length) f.stack = stack;
  // Library cards a pending choice reveals (not in a known position): listed so the view keeps them.
  for (const o of Object.values(v.objects)) {
    if (placedIds.has(o.id)) continue;
    if (o.zone !== 'library') throw new Error(`saveSpot: object ${o.id} (${o.defId}, ${o.zone}) is in view.objects but in no zone of the view`);
    const lib = (players[o.owner] as Json).library as Json;
    lib.revealed = [...((lib.revealed ?? []) as Json[]), entry(o.id, o.owner, o.owner)];
  }
  return f;
}

/** The spot file text: two-space JSON and a final newline. */
// WIRE-DARK[test helper, used by src/test/tools/spot.test.ts round-trip test]
export function spotJson(v: PlayerView, opts: { decks?: [DeckInput, DeckInput]; note?: string } = {}): string {
  return `${JSON.stringify(saveSpot(v, opts), null, 2)}\n`;
}

