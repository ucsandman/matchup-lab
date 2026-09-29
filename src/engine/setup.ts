// newGame: builds the initial GameState. Deck names resolve through the card registry; each
// library is shuffled as a list of def ids BEFORE any object id is assigned, so ids follow the
// shuffled order and carry no decklist information (PLAN.md D16). Then both players draw seven
// and the London mulligan starts (mulligan.ts).
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defIdByName, getDef } from '../cards/index.js';
import { nextInt, seedRng, shuffle } from './rng.js';
import { cloneData } from './mutate.js';
import { blankObject, drawCards } from './zones.js';
import type { DefId, GameState, PlayerId, PlayerState } from './types.js';

export interface DeckEntry { count: number; name: string }
export interface DeckList { main: DeckEntry[]; side?: DeckEntry[]; archetype?: string }
/** A deck file name under decks/ ('deckA'), or a list. */
export type DeckInput = string | DeckList;

const DECKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'decks');

/**
 * Parsed deck files by path, read once per process (perf, docs/PERF.md T1.5: a read and a stat per
 * game were several percent of a random game). An edit to a deck file needs a new process.
 */
const deckFiles = new Map<string, DeckList>();

export function loadDeckFile(name: string): DeckList {
  const file = join(DECKS_DIR, name.endsWith('.json') ? name : `${name}.json`);
  let list = deckFiles.get(file);
  if (!list) {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as DeckList;
    if (!Array.isArray(raw.main)) throw new Error(`${file}: no main list`);
    list = raw;
    deckFiles.set(file, list);
  }
  // A fresh copy per call, as a fresh parse was: callers may edit it.
  return cloneData(list);
}

/** Expands a list to def ids in list order. Throws naming every card without a def. */
export function resolveDeck(list: DeckList): DefId[] {
  const out: DefId[] = [];
  const missing: string[] = [];
  for (const e of list.main) {
    const id = defIdByName(e.name);
    if (!id || getDef(id).layout === 'token') { missing.push(e.name); continue; }
    for (let i = 0; i < e.count; i++) out.push(id);
  }
  if (missing.length) throw new Error(`no card def for ${missing.length} name(s): ${missing.join(', ')}`);
  return out;
}

function newPlayer(): PlayerState {
  return {
    life: 20, cantGainLife: false, manaPool: [], mulligans: 0, kept: false,
    libraryKnown: { top: [], bottom: [] }, drewFromEmpty: false,
  };
}

/** An empty two-player state (no cards). Used by newGame and by the test state builder. */
export function emptyState(seed: number): GameState {
  return {
    seed: seedRng(seed), nextId: 1, turn: 0, activePlayer: 0, priority: 0, startingPlayer: 0,
    phaseQueue: [], step: 'mulligan',
    players: [newPlayer(), newPlayer()],
    objects: {},
    zones: { library: [[], []], hand: [[], []], graveyard: [[], []], exile: [[], []], battlefield: [], stack: [] },
    dayNight: 'none',
    turnFlags: {
      landsPlayed: [0, 0], spellsCast: [0, 0], noncreatureSpellsCast: [0, 0], permanentLeft: [false, false],
      nextCreatureBonus: [false, false], damageTally: {}, loyaltyUsed: [],
    },
    effects: [], pendingChoice: null, pending: null, passes: 0, stepPriority: false, pendingTriggers: [], delayed: [],
    pregame: null, result: null, events: [],
  };
}

/**
 * Starts a game: player 0 plays deckA, player 1 deckB. onThePlay picks the starting player;
 * 'random' rolls it from the game stream first (CR 103.1 (starting player)). Then each library is
 * shuffled (CR 103.3 (shuffle deck)) and both players draw seven (CR 103.5 (mulligan)).
 * Construction is not journaled.
 */
export function newGame(deckA: DeckInput, deckB: DeckInput, seed: number, onThePlay: PlayerId | 'random' = 'random'): GameState {
  const lists = [deckA, deckB].map((d) => resolveDeck(typeof d === 'string' ? loadDeckFile(d) : d));
  const state = emptyState(seed);
  const starting: PlayerId = onThePlay === 'random' ? (nextInt(state.seed, 2) as PlayerId) : onThePlay;
  state.startingPlayer = starting;
  state.activePlayer = starting;
  state.priority = starting;
  for (const p of [0, 1] as const) {
    const defIds = shuffle(state.seed, [...(lists[p] as DefId[])]);
    for (const defId of defIds) {
      const id = state.nextId++;
      state.objects[id] = blankObject(id, defId, p, 'library');
      state.zones.library[p].push(id);
    }
  }
  for (const p of [starting, starting === 0 ? 1 : 0] as const) drawCards(state, p, 7);
  state.events = [];
  const other: PlayerId = starting === 0 ? 1 : 0;
  state.pregame = { toDeclare: [starting, other], mulling: [], toBottom: [] };
  state.pendingChoice = { kind: 'mulligan', player: starting };
  return state;
}
