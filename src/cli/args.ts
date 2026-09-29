// Command-line parsing shared by the hand, spot and match commands (PLAN.md section 8, Phase 5;
// D27): one spelling and one meaning for --seed, --workers, --json and --help, unknown flags and
// stray words rejected by name, and bad input thrown as UsageError, which the entry point
// (src/cli/index.ts) turns into exit code 2. Any other error is a failure of the tool (exit code 1).
import { defaultWorkers } from '../sim/runner.js';

/** Bad input: a flag, a value, a card name or a file the user gave. Exit code 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** The lines every command's help ends with. */
export const COMMON_HELP = `  --seed S      any integer (default 1); the same seed and flags give the same numbers whatever --workers is
                (spot with --ms depends on the machine's speed instead)
  --workers W   worker threads (default: logical processors minus 1); 0 runs everything in this thread
  --json        the report as JSON on stdout instead of text
  --help        this text (exit code 0)
  Exit codes: 0 done, 2 bad input (the message names the problem), 1 the tool failed.`;

/** The flags every command takes: those that take a value, and switches. */
export const COMMON_VALUE_FLAGS = ['--seed', '--workers'] as const;
export const COMMON_SWITCHES = ['--json', '--help', '-h'] as const;

export const wantsHelp = (argv: readonly string[]): boolean => argv.includes('--help') || argv.includes('-h');

/** The value after a flag (undefined when the flag is absent); a missing value is a UsageError. */
export function flag(argv: readonly string[], name: string, usage: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new UsageError(`${name} needs a value\n${usage}`);
  return v;
}

/** An integer flag at least min (the default when absent). */
export function intFlag(argv: readonly string[], name: string, dflt: number, min: number, usage: string): number {
  const v = flag(argv, name, usage);
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min) throw new UsageError(`${name} must be an integer >= ${min}, got ${v}`);
  return n;
}

/**
 * Rejects anything that is not one of the command's flags: an unknown --flag (a typo such as --game
 * would otherwise be ignored silently) or a word that is not a flag's value (usually a card list or
 * a path with spaces that lost its quotes).
 */
export function checkFlags(argv: readonly string[], valueFlags: readonly string[], switches: readonly string[], usage: string): void {
  const values = new Set<string>([...valueFlags, ...COMMON_VALUE_FLAGS]);
  const sw = new Set<string>([...switches, ...COMMON_SWITCHES]);
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (values.has(a) || sw.has(a)) {
      if (seen.has(a)) throw new UsageError(`${a} is given twice`);
      seen.add(a);
      if (values.has(a)) i++;
      continue;
    }
    if (a.startsWith('-')) throw new UsageError(`unknown flag ${a}\n${usage}`);
    throw new UsageError(`unexpected argument '${a}' (a value with spaces or commas needs quotes, see the command's help)\n${usage}`);
  }
}

