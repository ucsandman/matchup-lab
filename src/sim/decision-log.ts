// Phase 6 learning hooks (PLAN.md section 8): one JSON line per agent decision and one line per
// game end, written by the match runner's blocks so a value or policy network can be trained later
// (no training code here). The schema is docs/JSONL-SCHEMA.md; LOG_VERSION changes with it.
//
// Every block writes its own part file (<dir>/block-<index>.jsonl) synchronously, so a line never
// crosses threads and a worker needs no message traffic; src/tools/selfplay-log.ts joins the parts
// in block order, which makes the log the same file for any worker count. A decision line holds
// only what the deciding player may know: their PlayerView (src/engine/view.ts), their legal moves
// (described from the view's objects, never the real state) and, for the ISMCTS agent, its root
// statistics. Leaf module: imports nothing from src/sim or src/tools/selfplay-log.ts.
import { closeSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { view, type PlayerView } from '../engine/view.js';
import { describeMove } from '../tools/describe-move.js';
import { knownIds, moveKey, type SearchResult } from '../agents/ismcts.js';
import type { Agent, AgentKind } from '../agents/types.js';
import type { MctsAgent, MctsStats } from '../agents/mcts-agent.js';
import type { Proportion } from './stats.js';
import type { Choice, GameState, Move, PlayerId, Step } from '../engine/types.js';

export const LOG_VERSION = 1;

export type Side = 'A' | 'B';

/** How the ISMCTS agent answered (which MctsStats counter the decision moved). */
export type SearchMode = 'searched' | 'forced' | 'pregame' | 'fallback' | 'skipped' | 'unknown';

export interface SearchRootLine {
  /** The root move in words, from the searcher's sample. */
  text: string;
  /** Index into the line's legal array (null when the searched move matches no legal move). */
  legal: number | null;
  /** Rollouts through this root move, summed over the samples. */
  visits: number;
  /** Samples whose tree has the move. */
  samples: number;
  /** Mean rollout value for the decider, with its 95 percent t interval (null below 2 rollouts). */
  mean: number | null;
  meanLo: number | null;
  meanHi: number | null;
  /** Wilson 95 percent interval over the rollouts' win outcomes (n = visits). */
  win: Proportion;
}

export interface SearchStats {
  mode: SearchMode;
  /** Present when mode is 'searched'. */
  samples?: number;
  iterations?: number;
  rollouts?: number;
  seconds?: number;
  /** Every root move, most visited first (mode 'searched' only). */
  root?: SearchRootLine[];
}

export interface DecisionLine {
  type: 'decision';
  v: number;
  /** Global game index within the run (join key with the end line). */
  game: number;
  /** Engine seed of the game (a replay key; it fixes the shuffle, so it is not a model input). */
  seed: number;
  /** 0-based decision index within the game. */
  d: number;
  player: PlayerId;
  side: Side;
  agent: AgentKind;
  turn: number;
  step: Step;
  view: PlayerView;
  legal: { text: string; move: Move }[];
  /** Index into legal of the chosen move. */
  chosen: number;
  move: Move;
  /** ISMCTS agent only; null for other agents. */
  search: SearchStats | null;
}

export interface EndLine {
  type: 'end';
  v: number;
  game: number;
  seed: number;
  winner: Side | 'draw';
  /** Player id of the winner (A is 0, B is 1), null for a draw. */
  winnerPlayer: PlayerId | null;
  reason: string;
  /** Turns played, both players' turns counted. */
  turns: number;
  /** Decision lines written for this game (d runs 0 to decisions - 1). */
  decisions: number;
  aOnPlay: boolean;
  agents: { A: AgentKind; B: AgentKind };
}

export type LogLine = DecisionLine | EndLine;

/** In-process observer of every line with the state it was built from (tests; never set in workers). */
let observer: ((state: GameState, line: LogLine) => void) | null = null;
// WIRE-DARK[test hook, used by src/test/tools/selfplay-log.test.ts]
export function setLineObserver(f: ((state: GameState, line: LogLine) => void) | null): void {
  observer = f;
}

const isMcts = (a: Agent): a is MctsAgent => typeof (a as Partial<MctsAgent>).last === 'function' && typeof (a as Partial<MctsAgent>).stats === 'function';

export interface SearchSnap { stats: MctsStats; last: SearchResult | null }

/** The ISMCTS agent's counters before a decision (null for other agents). */
export function snapSearch(agent: Agent): SearchSnap | null {
  return isMcts(agent) ? { stats: agent.stats(), last: agent.last() } : null;
}

const num = (x: number): number | null => (Number.isFinite(x) ? x : null);

function searchStats(agent: Agent, before: SearchSnap | null, v: PlayerView, legal: readonly Move[]): SearchStats | null {
  if (!before || !isMcts(agent)) return null;
  const s = agent.stats();
  const b = before.stats;
  const mode: SearchMode = s.searched > b.searched ? 'searched' : s.forced > b.forced ? 'forced' : s.pregame > b.pregame ? 'pregame'
    : s.fallbacks > b.fallbacks ? 'fallback' : s.skipped > b.skipped ? 'skipped' : 'unknown';
  const r = agent.last();
  if (mode !== 'searched' || !r || r === before.last) return { mode };
  const known = knownIds(v);
  const index = new Map<string, number>();
  legal.forEach((m, i) => index.set(moveKey(m, known, v.objects), i));
  return {
    mode, samples: r.samples, iterations: r.iterations, rollouts: r.rollouts, seconds: r.seconds,
    root: r.lines.map((l) => ({
      text: l.text, legal: index.get(l.key) ?? null, visits: l.visits, samples: l.samples,
      mean: num(l.mean), meanLo: num(l.meanLo), meanHi: num(l.meanHi), win: l.win,
    })),
  };
}

export interface GameMeta { game: number; seed: number; agents: { A: AgentKind; B: AgentKind } }

export interface BlockLog {
  decision(state: GameState, p: PlayerId, legal: readonly Move[], move: Move, agent: Agent, before: SearchSnap | null, meta: GameMeta): void;
  end(state: GameState, g: { winner: Side | 'draw'; reason: string; turns: number; aOnPlay: boolean }, meta: GameMeta): void;
  close(): void;
}

export function partPath(dir: string, block: number): string {
  return join(dir, `block-${String(block).padStart(6, '0')}.jsonl`);
}

/** Opens the part file of one block (overwritten); lines are buffered and written synchronously. */
export function openBlockLog(dir: string, block: number): BlockLog {
  const fd = openSync(partPath(dir, block), 'w');
  let buf: string[] = [];
  let bytes = 0;
  const flush = (): void => {
    if (buf.length === 0) return;
    writeSync(fd, buf.join(''));
    buf = [];
    bytes = 0;
  };
  const put = (state: GameState, line: LogLine): void => {
    if (observer) observer(state, line);
    const s = `${JSON.stringify(line)}\n`;
    buf.push(s);
    bytes += s.length;
    if (bytes > 1 << 20) flush();
  };
  const count = new Map<number, number>();
  return {
    decision(state, p, legal, move, agent, before, meta) {
      const d = count.get(meta.game) ?? 0;
      count.set(meta.game, d + 1);
      const v = view(state, p);
      // The Choice the move answers, as the decider sees it (their own pending choice is verbatim in the view).
      const choice = v.pendingChoice && !('hidden' in v.pendingChoice) ? (v.pendingChoice as Choice) : null;
      const chosen = legal.indexOf(move) >= 0 ? legal.indexOf(move) : legal.findIndex((m) => JSON.stringify(m) === JSON.stringify(move));
      const side: Side = p === 0 ? 'A' : 'B';
      put(state, {
        type: 'decision', v: LOG_VERSION, game: meta.game, seed: meta.seed, d, player: p, side, agent: meta.agents[side],
        turn: state.turn, step: state.step, view: v,
        legal: legal.map((m) => ({ text: describeMove(v.objects, m, p, { choice }), move: m })),
        chosen, move: legal[chosen] ?? move,
        search: searchStats(agent, before, v, legal),
      });
    },
    end(state, g, meta) {
      put(state, {
        type: 'end', v: LOG_VERSION, game: meta.game, seed: meta.seed, winner: g.winner,
        winnerPlayer: g.winner === 'A' ? 0 : g.winner === 'B' ? 1 : null, reason: g.reason, turns: g.turns,
        decisions: count.get(meta.game) ?? 0, aOnPlay: g.aOnPlay, agents: meta.agents,
      });
    },
    close() {
      flush();
      closeSync(fd);
    },
  };
}
