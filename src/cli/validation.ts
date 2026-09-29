// What was validated (PLAN.md D25, D27; docs/ACCEPTANCE.md): the note the spot and match commands
// print about their search mode. Only the default mode, the Phase 4 acceptance agent's settings, was
// tested against greedy; any other mode or setting is unvalidated and the note says which.
import { MCTS_VALIDATED, type MctsMode } from '../agents/mcts-agent.js';

/** The acceptance run's evidence, every number with its n and 95 percent interval (docs/ACCEPTANCE.md). */
export const VALIDATION_EVIDENCE = 'Only the default mode with its default settings (8 samples x 3 iterations, greedy rollouts cut after 2 turns, greedy top-3 pruning at the root, margin 3, override at 2 standard errors and 0.02) was tested against greedy: over 1,000 games per side it won 54.9% [95% CI 51.8-58.0%, n=1000] as Rakdos against greedy\'s own 46.5% [95% CI 43.4-49.6%, n=1000] from that seat, and 63.9% [95% CI 60.9-66.8%, n=1000] as Mono-Red against 53.5% [95% CI 50.4-56.6%, n=1000] (docs/ACCEPTANCE.md). That says it beats this greedy player, nothing about optimal play.';

/** The plain UCT search's only measurement against greedy (docs/ACCEPTANCE.md, diagnosis). */
export const UCT_EVIDENCE = 'The uct mode is the plain Phase 4 search and was not validated against greedy; as a match agent (4 samples x 50 iterations) it won 41.3% [95% CI 28.3-55.7%, n=46] as Rakdos in the Phase 4 screen.';

/** A search configuration as the commands hold it (null and undefined both mean not set). */
export interface SearchConfig {
  samples: number; iterations?: number | null | undefined; ms?: number | null | undefined; rollout: 'truncated' | 'full'; rolloutTurns: number;
  policy?: 'fast' | 'greedy' | undefined; prune?: number | undefined; pruneDepth?: number | undefined;
  margin?: number | undefined; override?: number | undefined; minGain?: number | undefined;
}

/** The settings of c that differ from the validated agent's, as flag=value (empty when c is the validated agent). */
export function changedFromValidated(c: SearchConfig): string[] {
  const v = MCTS_VALIDATED;
  const out: string[] = [];
  if (c.samples !== v.samples) out.push(`--samples ${c.samples}`);
  if (c.ms !== undefined && c.ms !== null) out.push(`--ms ${c.ms}`);
  else if ((c.iterations ?? null) !== v.iterations) out.push(`--iterations ${String(c.iterations)}`);
  if (c.rollout !== 'truncated') out.push(`--rollout ${c.rollout}`);
  if (c.rolloutTurns !== v.rolloutTurns) out.push(`--turns ${c.rolloutTurns}`);
  if ((c.policy ?? 'fast') !== v.policy) out.push(`--policy ${c.policy ?? 'fast'}`);
  if ((c.prune ?? 0) !== v.prune) out.push(`--prune ${c.prune ?? 0}`);
  if ((c.pruneDepth ?? 1) !== v.pruneDepth) out.push(`--prune-depth ${c.pruneDepth ?? 1}`);
  if (c.margin !== v.margin) out.push(c.margin === undefined ? 'no margin' : `--margin ${c.margin}`);
  if (c.override !== v.override) out.push(c.override === undefined ? 'no override' : `--override ${c.override}`);
  if (c.override !== undefined && (c.minGain ?? 0.02) !== v.minGain) out.push(`--min-gain ${c.minGain ?? 0.02}`);
  return out;
}

/** The note for a mode and configuration: which part was validated, with the acceptance numbers. */
export function validationNote(mode: MctsMode, c: SearchConfig): string {
  if (mode === 'uct') return `note: ${UCT_EVIDENCE} ${VALIDATION_EVIDENCE}`;
  const changed = changedFromValidated(c);
  if (changed.length > 0) return `note: this run changes the validated settings (${changed.join(', ')}), so it is not the validated agent. ${VALIDATION_EVIDENCE}`;
  return `note: validated mode with the settings of the Phase 4 acceptance run. ${VALIDATION_EVIDENCE}`;
}
