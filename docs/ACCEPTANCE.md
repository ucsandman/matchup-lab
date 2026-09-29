# Phase 4 acceptance: MCTS agent vs greedy

Result: PASS. Run on 2026-09-29, one run, seed 20260930. The MCTS agent beats the greedy agent on both sides at p < 0.01, 1,000 games per side, against the greedy-vs-greedy baseline for that side (PLAN.md section 8, Phase 4 gate).

| Side (MCTS plays) | n | MCTS win rate | greedy win rate | draws | baseline (greedy as that side vs greedy) | two-proportion z-test | games/sec/core | elapsed |
|---|---|---|---|---|---|---|---|---|
| A, Rakdos Midrange | 1000 | 54.9% [95% CI 51.8-58.0%] | 45.1% [95% CI 42.0-48.2%] | 0.0% [95% CI 0.0-0.4%] | 46.5% [95% CI 43.4-49.6%, n=1000] | +8.4 points, z = 3.76, two-sided p = 0.0002 | median 0.02 [95.6% CI 0.02-0.02, n=500 blocks]; pooled 0.0155 (64,369 thread seconds for 1,000 games) | 54.4 min wall |
| B, Mono-Red Aggro | 1000 | 63.9% [95% CI 60.9-66.8%] | 36.1% [95% CI 33.2-39.1%] | 0.0% [95% CI 0.0-0.4%] | 53.5% [95% CI 50.4-56.6%, n=1000] | +10.4 points, z = 4.72, two-sided p = 2.3e-6 | median 0.02 [95.6% CI 0.02-0.03, n=500 blocks]; pooled 0.0174 (57,381 thread seconds for 1,000 games) | 46.6 min wall |

Every interval is 95 percent: Wilson for win rates, the order-statistic interval for the median speed (its coverage is printed because order statistics give 95.6 percent, not exactly 95). The pooled speed is one run and has no interval. The z-test is the pooled two-proportion test, two-sided; a side passes when MCTS is ahead and p < 0.01. Draws were 0 of 1,000 on each side. Every decision of both agents was checked against the legal move list: 97,762 decisions with MCTS as A and 84,519 with MCTS as B, 0 illegal.

Win rates reflect heuristic play, not perfect play: the MCTS agent is greedy plus a rollout search over greedy continuations, and the numbers say it beats this greedy agent, nothing about optimal play.

## Budget

Per decision, with the options of src/agents/mcts-agent.ts (PLAN.md D25):

- 8 determinized samples dealt from the agent's view and the two decklists;
- at the root, greedy's top 3 moves on each sample (--prune 3), each rolled out once per sample (3 iterations per sample, so 24 rollouts per searched decision), every candidate on the same sample, which makes the comparison paired;
- rollouts played by the greedy agent for both players (--policy greedy), cut after 2 turns and scored by the greedy evaluation through the logistic (leafValue, scale 16);
- skip margin 3 (--margin 3): greedy scores the legal moves on one more sample; a move leading the second by 3 evaluation points or more is played without a search;
- conservative override (--override 2 --min-gain 0.02): the agent plays greedy's move unless another root move beats it by a paired mean gain d over the samples with d at least 0.02 and d - 2 x se > 0.

Mulligan and bottom decisions use greedy's rules on the view; mid-operation choices (discard picks, trigger targets, would-die replacements) are answered by greedy on the caller's sample, as in PLAN.md D24 c.

Why this budget: the brief allows about 2 hours for 2,000 games on this machine. The pilot measured 46.7 thread seconds per game, which extrapolated to 1.13 h on 23 workers. The full run took 105.7 min: 64.4 thread seconds per game with MCTS as A and 57.4 as B, 38 and 23 percent above the pilot. Long games are rare, so a 50-game pilot underestimates the mean, and the last blocks run on a few workers. Stretch the plan by 1.4 x when you pilot again.

## Commands (PowerShell or Bash, repository root)

    npm run build
    node dist/tools/acceptance.js --policy greedy --prune 3 --samples 8 --iterations 3 --margin 3 --override 2 --min-gain 0.02 --games 1000 --pilot 50 --max-hours 2 --block-size 2 --seed 20260930 --json acceptance.json

src/tools/acceptance.ts runs the pilot (25 games per side, seeds 20360930 and 20460930, blocks of 1 game), prints the plan and stops if the plan is over --max-hours, then plays MCTS as A (seed 20260930) and MCTS as B (seed 20260931). Each side uses blocks of 2 games on 23 worker threads and alternates who is on the play. It prints the table above and a verdict, and it exits 0 only when both sides pass. The same agent can be played through the match command:

    node dist/cli/index.js match --a mcts --b greedy --games 1000 --seed 20260930 --block-size 2 --policy greedy --prune 3 --samples 8 --iterations 3 --margin 3 --override 2 --min-gain 0.02

Since Phase 5 (PLAN.md D27) these settings are the defaults of the MCTS agent (MCTS_VALIDATED in src/agents/mcts-agent.ts), of --a mcts and of the spot command, so the shorter command below plays the same agent and the same games (src/test/cli/cli.test.ts checks that the parsed defaults equal the flags above). The plain search is --mode uct, which was not validated.

    node dist/cli/index.js match --a mcts --b greedy --games 1000 --seed 20260930 --block-size 2

The baseline is the Phase 2 gate run, greedy vs greedy with n = 1000 at seed 20260929, from CHANGELOG.md and src/test/agents/match.test.ts: A wins 465, B wins 535. It can be rerun with:

    node dist/cli/index.js match --a greedy --b greedy --games 1000 --seed 20260929

A seed gives the same games for any worker count, but not for another block size (src/sim/runner.ts). The run's printed output is reproduced at the end of this file.

Replaying a slice: block b is seeded by b + 1 jumps of the seed's stream whatever the game count, and the match command builds the same job as the acceptance tool, so the match command above with --games 100 plays games 1 to 100 of the MCTS-as-A side (src/test/tools/acceptance.test.ts checks this prefix property on a tiny budget: the first 3 games of a 5-game acceptance side equal a 3-game match run, and another seed differs). The independent verifier ran that slice on 2026-09-29: MCTS as A won 50.0% [95% CI 40.4-59.6%, n=100], 9,188 decisions checked legal, 445 s wall on 23 workers. That is below the full run's 54.9% [95% CI 51.8-58.0%, n=1000] by about one standard error of a 100-game slice (about 5 points); the slice's interval contains 54.9%. The run's per-game results cannot be compared game by game: the JSON of this run held the side summaries only (the SideResult of src/tools/acceptance.ts had no per-game field) and the file was not kept. Since this fix the JSON carries each side's perGame list (game index, winner, who was on the play, turns, kill turn, moves), so a later run can be sliced and checked exactly; write it under docs/ to keep it.

## Machine

- CPU: 13th Gen Intel Core i7-13700KF, 24 logical processors (8 performance cores with two threads each, 8 efficiency cores).
- OS: Windows 11 Pro 10.0.26200.
- Node: v24.15.0, compiled build (npm run build, tsc to dist/).
- Workers: 23 worker_threads (the default, logical processors minus 1), unpinned.
- Load: no other job of this task ran during the pilot or the run.

## How the agent got here (diagnosis and fixes)

The Phase 4 default agent (4 samples x 50 iterations, the fast rollout policy over every legal move, most visited root move) lost ground to greedy: 41.3% [95% CI 28.3-55.7%, n=46] as A (seed 101), and 47.5% [95% CI 32.9-62.5%, n=40] in the earlier speed run with sides alternating. Screens were each one run, 230 games per side at seed 5001 unless noted; the acceptance run used a fresh seed:

| Step | Change | MCTS as A | MCTS as B | Thread seconds per game |
|---|---|---|---|---|
| sanity | prune 1 (greedy's own move), 1 sample x 1 iteration, seed 777, n=460 per side | 42.8% [95% CI 38.4-47.4%] | 56.1% [95% CI 51.5-60.6%] | 0.8 (A), 1.0 (B) |
| C1 | greedy rollouts, root top 3, 6 samples x 3, margin 3, most visited move | 42.6% [95% CI 36.4-49.1%] | 59.6% [95% CI 53.1-65.7%] | 33.0 (A), 37.0 (B) |
| C2 | as C1 with 8 samples and the paired override at 2 standard errors | 48.3% [95% CI 41.9-54.7%] | 60.4% [95% CI 54.0-66.5%] | 49.4 (A), 47.6 (B) |
| C3 | as C2 with 6 samples and rollouts of 4 turns, A only | 47.4% [95% CI 41.0-53.8%] | not run | about 106 (1,060 s wall for 230 games) |
| C4 | as C2 plus a minimum paired gain of 0.02 (the acceptance agent) | 47.8% [95% CI 41.5-54.3%] | 60.0% [95% CI 53.6-66.1%] | 49.0 (A), 51.1 (B) |
| C5 | as C4 with top 5, 8 samples x 5, margin 5, A only | 48.7% [95% CI 42.3-55.1%] | not run | about 117 (1,175 s wall for 230 games) |
| acceptance | C4, seed 20260930, n=1000 per side | 54.9% [95% CI 51.8-58.0%] | 63.9% [95% CI 60.9-66.8%] | 64.4 (A), 57.4 (B) |

What each diagnosis found:

1. Rollout policy too weak (fixed). The fast rollout policy (land, most expensive spell, random otherwise) does not play like either real opponent, and 200 of its rollouts per decision spread over every legal move gave each move about 5 noisy visits per sample. Greedy rollouts model the real opponent exactly (the opponent is greedy), so the search is rollout policy improvement over greedy. Root pruning to greedy's top 3 puts the budget where the choice is. Pruning at every tree node instead cost about 97 thread seconds per game (a greedy scoring at each expansion) for 54.3% [95% CI 40.2-67.8%, n=46] as A, so pruning stays at the root.
2. Budget (partly the limit). 2,000 games in about 2 hours on 23 workers leaves about 80 thread seconds per game, and a thread under 23 workers runs several times slower than one thread alone. C1's agent took 8.0 s per game on one thread [95% CI -3.3 to 19.3 s, n=6 games; one very long game widens it] and 36.3 thread seconds per game in a 23-worker pilot (n=92 games, one run, no interval). Longer rollouts (C3) and wider pruning (C5) doubled the cost without a clear gain as A in the screens.
3. Evaluation mapping (kept; small differences are not trusted). Paired per-sample values showed consistent tiny preferences that follow from the evaluation at the 2-turn horizon, not from play. One example is passing instead of a turn-1 Duress (0.672 against 0.666). Argmax over 6 samples acted on them and cost Rakdos 3.9 points in C1. The override rule (a 2-standard-error paired lead) and the minimum gain of 0.02 in value units (about 1.3 evaluation points near even) keep greedy's move unless the search finds a clear gain. Overrides that remained include holding a Gifted Aetherborn back against the aggro deck (0.643 against 0.543), playing a land before Fable (0.767 against 0.675) and animating Mutavault to attack.
4. Opponent modelling in the tree (not the problem at this budget). At 3 iterations per sample with 3 root moves the tree has no opponent nodes: the opponent is modelled by the greedy rollout, which is the real opponent's policy. Two things differ from the real opponent. Inside a sample it sees the searcher's hand, but greedy's scoring reads the opponent's hand only as a count. And it breaks ties from its own stream.

The screens and the acceptance run disagree as A: 47.8% [95% CI 41.5-54.3%, n=230] at seed 5001 against 54.9% [95% CI 51.8-58.0%, n=1000] at seed 20260930. That is a 7.1-point gap, z of about 1.9 for the difference, inside what two samples of these sizes can show. The Rakdos gain is less certain than the Mono-Red gain. The Mono-Red side was ahead in every screen (+6.1 to +6.9 points at n=230) and in the run (+10.4 at n=1000). The acceptance seed was fixed before the run and the run was made once; no seed was retried.

## Limits

- Strategy fusion and non-locality (PLAN.md D24): the samples show the searcher the opponent's hidden cards, so it can act as if it knew them.
- The search only reorders greedy's top 3 moves on each sample. A move greedy ranks fourth or lower is never played on a searched decision.
- Win rates are against this greedy agent and depend on its weaknesses (CHANGELOG.md, Known gaps). They are not win probabilities against human play.
- Game 1 only, main decks (PLAN.md D5).

## Printed output of the run

    acceptance: MCTS (8 samples x 3 iterations per decision, greedy rollouts cut after 2 turns, greedy top-3 pruning at the root, greedy's move unsearched when it leads by 3 or more, greedy's move overridden only by a paired lead above 2 standard errors and at least 0.02) vs greedy, 1000 games per side, seed 20260930, block size 2, 23 workers (13th Gen Intel(R) Core(TM) i7-13700KF, 24 logical, Node v24.15.0, compiled)
    baselines (greedy vs greedy): A 46.5% [95% CI 43.4-49.6%, n=1000]; B 53.5% [95% CI 50.4-56.6%, n=1000]
    pilot: 50 games (25 with MCTS as A, 25 as B, seeds 20360930 and 20460930) in 4.7 min wall; 46.7 thread seconds per game (one run, no interval)
    pilot MCTS win rate: as A 68.0% [95% CI 48.4-82.8%, n=25]; as B 60.0% [95% CI 40.7-76.6%, n=25] (a pilot, not the acceptance result)
    plan: 2000 games x 46.7 thread seconds / 23 workers = about 1.13 h of wall time (an extrapolation from the pilot; the pilot's blocks of 1 game keep all workers busy, the run's tail may add a few minutes)
    MCTS as A (Rakdos Midrange) vs greedy: n=1000 games (97762 decisions checked legal)
      MCTS win rate:   54.9% [95% CI 51.8-58.0%, n=1000]
      greedy win rate: 45.1% [95% CI 42.0-48.2%, n=1000]
      draws:           0.0% [95% CI 0.0-0.4%, n=1000]
      baseline, greedy as A vs greedy: 46.5% [95% CI 43.4-49.6%, n=1000]
      two-proportion z-test against the baseline: diff 8.4 points, z = 3.76, two-sided p = 0.0002: PASS (MCTS ahead, p < 0.01)
      speed: median 0.02 games/sec/core [95.6% CI 0.02-0.02, n=500 blocks, one worker thread per block]
      elapsed: 54.4 min wall; 64369 thread seconds, 64.4 per game
    MCTS as B (Mono-Red Aggro) vs greedy: n=1000 games (84519 decisions checked legal)
      MCTS win rate:   63.9% [95% CI 60.9-66.8%, n=1000]
      greedy win rate: 36.1% [95% CI 33.2-39.1%, n=1000]
      draws:           0.0% [95% CI 0.0-0.4%, n=1000]
      baseline, greedy as B vs greedy: 53.5% [95% CI 50.4-56.6%, n=1000]
      two-proportion z-test against the baseline: diff 10.4 points, z = 4.72, two-sided p = 2.32e-6: PASS (MCTS ahead, p < 0.01)
      speed: median 0.02 games/sec/core [95.6% CI 0.02-0.03, n=500 blocks, one worker thread per block]
      elapsed: 46.6 min wall; 57381 thread seconds, 57.4 per game
    total elapsed (pilot and both sides): 105.7 min
    verdict: PASS: MCTS beats greedy at p < 0.01 on both sides (2 of 2 sides pass)
    Win rates reflect the heuristic agents named above, not perfect play.
