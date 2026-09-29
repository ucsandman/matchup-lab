// The hand command (PLAN.md section 8, Phase 3; src/tools/goldfish.ts does the work):
//
//   node --import tsx src/cli/index.ts hand --hand 'Blood Crypt,Thoughtseize,...' --play [--mulligans N]
//        [--bottom 'Swamp'] [--seed S] [--workers W] [--max-games N] [--batch N] [--goldfish-games N]
//        [--key-cards file.json] [--json]
//   node --import tsx src/cli/index.ts hand --hand-file hand.json --draw
//   scripts/hand.ps1 --hand 'Blood Crypt,Thoughtseize,...' --play
//
// Card names are the decklist names; names that contain a comma ('Sheoldred, the Apocalypse') are
// rejoined automatically, or separate the cards with ';' instead. A leading count ('2 Swamp' or
// '2x Swamp') repeats a card. --hand-file holds a JSON array of names or {"hand": [...],
// "bottom": [...]}. Progress goes to stderr, the report to stdout.
import { readFileSync } from 'node:fs';
import { defaultWorkers } from '../sim/runner.js';
import { fmtPct } from '../sim/stats.js';
import { analyzeHand, cardId, DEFAULTS, formatHandReport, loadKeyCards, resolveHand, type HandOptions, type HandReport } from '../tools/goldfish.js';
import { COMMON_HELP, UsageError, checkFlags } from './args.js';

export const HAND_USAGE = `usage: hand (--hand 'Card,Card,...' | --hand-file hand.json) (--play | --draw) [--mulligans N] [--bottom 'Card,...']
            [--seed S] [--workers W] [--max-games N] [--batch N] [--goldfish-games N] [--key-cards file.json] [--json]
  Keep or mulligan: plays the hand against greedy Mono-Red and compares it with one more mulligan (docs/HAND-TOOL.md).
  The hand is deck A's (Rakdos Midrange, decks/deckA.json): the 7 cards drawn, or the ${'7 - N'} kept after N mulligans.
  Put the whole card list in single quotes: --hand 'Blood Crypt,Swamp,Sheoldred, the Apocalypse,...'. Names with a comma are
  recognised; ';' also separates cards; '2 Swamp' repeats a card; a double-faced card may be given by its front face or in full.
  --max-games caps each branch (default ${DEFAULTS.maxGames}); --batch is games per branch per look (default ${DEFAULTS.batch});
  --goldfish-games (default ${DEFAULTS.goldfishGames}); --key-cards (default decks/key-cards.json). Progress lines go to stderr.
${COMMON_HELP}`;

/** The hand command's flags beyond the common ones (src/cli/args.ts). */
export const HAND_VALUE_FLAGS = ['--hand', '--hand-file', '--mulligans', '--bottom', '--max-games', '--batch', '--goldfish-games', '--key-cards'] as const;
export const HAND_SWITCHES = ['--play', '--draw'] as const;

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new UsageError(`${name} needs a value\n${HAND_USAGE}`);
  return v;
}

function intFlag(argv: readonly string[], name: string, dflt: number, min: number): number {
  const v = flag(argv, name);
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min) throw new UsageError(`${name} must be an integer >= ${min}, got ${v}`);
  return n;
}

/**
 * Splits a card list. With ';' the separator is ';'. Otherwise commas separate cards, and
 * neighbouring pieces are rejoined with ', ' when together they name a card (longest match first),
 * so 'Sheoldred, the Apocalypse' survives. A leading 'N ' or 'Nx ' repeats the card N times.
 */
export function splitCards(s: string): string[] {
  const raw = s.includes(';') ? s.split(';') : s.split(',');
  const parts = raw.map((p) => p.trim()).filter((p) => p.length > 0);
  const joined: string[] = [];
  if (s.includes(';')) joined.push(...parts);
  else {
    for (let i = 0; i < parts.length;) {
      let took = 1;
      for (let len = Math.min(3, parts.length - i); len > 1; len--) {
        const name = parts.slice(i, i + len).join(', ').replace(/^\d+x?\s+/, '');
        if (cardId(name) !== undefined) { took = len; break; }
      }
      joined.push(parts.slice(i, i + took).join(', '));
      i += took;
    }
  }
  const out: string[] = [];
  for (const p of joined) {
    const m = /^(\d+)x?\s+(.+)$/.exec(p);
    if (m) for (let k = 0; k < Number(m[1]); k++) out.push((m[2] as string).trim());
    else out.push(p);
  }
  return out;
}

export function parseHandArgs(argv: readonly string[]): HandOptions & { json: boolean } {
  const handFlag = flag(argv, '--hand');
  const file = flag(argv, '--hand-file');
  if ((handFlag === undefined) === (file === undefined)) throw new UsageError(`give exactly one of --hand and --hand-file\n${HAND_USAGE}`);
  let hand: string[];
  let bottom: string[] | undefined;
  if (file !== undefined) {
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(file, 'utf8')) as unknown; } catch (e) { throw new UsageError(`--hand-file ${file}: ${(e as Error).message}`); }
    const obj = Array.isArray(raw) ? { hand: raw } : (raw as { hand?: unknown; bottom?: unknown });
    if (!Array.isArray(obj.hand) || !obj.hand.every((c) => typeof c === 'string')) throw new UsageError(`${file}: expected a JSON array of card names or {"hand": [...]}`);
    hand = obj.hand as string[];
    if (obj.bottom !== undefined) {
      if (!Array.isArray(obj.bottom) || !obj.bottom.every((c) => typeof c === 'string')) throw new UsageError(`${file}: bottom must be an array of card names`);
      bottom = obj.bottom as string[];
    }
  } else hand = splitCards(handFlag as string);
  const b = flag(argv, '--bottom');
  if (b !== undefined) bottom = splitCards(b);
  const play = argv.includes('--play');
  const draw = argv.includes('--draw');
  if (play === draw) throw new UsageError(`give exactly one of --play and --draw\n${HAND_USAGE}`);
  const kc = flag(argv, '--key-cards');
  return {
    hand, onThePlay: play,
    mulligans: intFlag(argv, '--mulligans', 0, 0),
    ...(bottom ? { bottom } : {}),
    seed: intFlag(argv, '--seed', 1, Number.MIN_SAFE_INTEGER),
    workers: intFlag(argv, '--workers', defaultWorkers(), 0),
    maxGames: intFlag(argv, '--max-games', DEFAULTS.maxGames, 1),
    batch: intFlag(argv, '--batch', DEFAULTS.batch, 1),
    goldfishGames: intFlag(argv, '--goldfish-games', DEFAULTS.goldfishGames, 0),
    ...(kc ? { keyCardsFile: kc } : {}),
    json: argv.includes('--json'),
  };
}

export async function handCommand(argv: readonly string[]): Promise<HandReport> {
  checkFlags(argv, HAND_VALUE_FLAGS, HAND_SWITCHES, HAND_USAGE);
  const { json, ...opts } = parseHandArgs(argv);
  // Bad input (an unknown or illegal card, a wrong count, a bad key-card file) before any game is played.
  try { resolveHand(opts); } catch (e) { throw new UsageError((e as Error).message); }
  if (opts.keyCardsFile !== undefined) {
    try { loadKeyCards(opts.keyCardsFile); } catch (e) { throw new UsageError(`--key-cards: ${(e as Error).message}`); }
  }
  const r = await analyzeHand(opts, {
    onLook: (look, k, m) => { process.stderr.write(`look ${look}: keep ${fmtPct(k)}, mulligan ${fmtPct(m)}\n`); },
  });
  if (json) console.log(JSON.stringify(r, null, 2));
  else console.log(formatHandReport(r));
  return r;
}
