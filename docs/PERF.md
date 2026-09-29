# Performance (T1.4)

Measured 2026-09-29. The PLAN.md section 7 target of 1,000 random games/sec/core is NOT met. The engine is now about 2 times faster on the test pool and about 2.3 times faster on the real game-1 decks, and the CPU profile is flat: no function has more than 6.4 percent self time, which is the stop condition set for this task.

## Machine

- CPU: 13th Gen Intel(R) Core(TM) i7-13700KF (16 cores: 8 performance and 8 efficiency; 24 logical processors), as reported by Windows (Win32_Processor) and by os.cpus().
- RAM: 32 GB.
- OS: Microsoft Windows 11 Pro 10.0.26200.
- Node v24.15.0, code run through tsx 4 (npm run bench), one worker, no invariant checks.

## Results

Command: node --import tsx src/tools/bench.ts --games 10000 --runs 5 --pool POOL. Each row is n = 5 runs of 10,000 random-vs-random games; the number is the median games/sec/core, with the min to max of the five runs. "Before" is a copy of src taken at the start of T1.4, run from the same checkout; the before and after runs of one pool ran back to back with no other job of this task running (other agents share the machine: the after-decks runs spread from 100.4 to 142.0, so read the medians, not the extremes).

| Pool | Before: median (min to max) | After: median (min to max) | Speed-up |
|---|---|---|---|
| decks (real game-1 60s) | 49.5 (48.0 to 53.6) | 112.8 (100.4 to 142.0) | 2.28 x |
| test (default pool of npm run bench) | 193.8 (173.5 to 195.7) | 397.8 (391.5 to 408.0) | 2.05 x |

Game length did not change, which is a behavior check across 50,000 games per pool: the same seeds give the same moves per game before and after (decks p50 90 [90, 91], p95 192 [191, 193]; test p50 57 [56, 57], p95 81 [81, 82]; order-statistic 95 percent intervals, n = 50,000 games).

The 100,000-game fuzz on the decks pool (node --import tsx src/tools/fuzz.ts --games 100000 --pool decks, invariants 1-8 on) printed the same report before and after apart from the time: 10,031,900 moves, 0 cap hits, 0 failures, mean 19.48 turns, max 62 turns, max 44 moves in one turn, 10,131,900 invariant checks, 200,638 view checks, 1,000 games replayed, results p0 31,914 / p1 67,843 / draw 243, every decklist card used. Time 3,331.0 s before (30 games/s with checks), 1,329.9 s after (75 games/s with checks).

## Profile

Command: node --cpu-prof --import tsx src/tools/bench.ts --games 1000 --runs 1 --pool decks, then self time per function summed over the .cpuprofile samples.

Top 10 by self time, before:

| Self | Function |
|---|---|
| 16.0% | native frame labelled "set TextDecoder" (the Object.defineProperty calls made by __name) |
| 14.4% | __name (tsx helper) called from makeCtx in engine/ctx.ts |
| 6.6% | computeChars (engine/statics.ts) |
| 4.4% | anonymous closures in engine/mana.ts (solver DFS) |
| 3.2% | getAbility (cards/registry.ts) |
| 2.8% | characteristics (engine/statics.ts) |
| 2.6% | checkSBA (engine/sba.ts) |
| 2.1% | makeCtx (engine/ctx.ts) |
| 2.1% | structuredClone (LKI snapshots in engine/zones.ts) |
| 2.0% | activateMoves (engine/moves.ts) |

Top 10 by self time, after:

| Self | Function |
|---|---|
| 6.4% | computeChars (engine/statics.ts) |
| 4.9% | checkSBA (engine/sba.ts) |
| 4.0% | activateMoves (engine/moves.ts) |
| 3.9% | dominates (engine/mana.ts) |
| 3.8% | buildClasses (engine/mana.ts) |
| 3.4% | characteristics (engine/statics.ts) |
| 3.1% | readFileUtf8 (module loading at start-up) |
| 2.9% | reps (engine/moves.ts) |
| 2.8% | execOp (engine/apply.ts) |
| 2.7% | getAbility (cards/registry.ts) |

Where the time goes now (call counts per game on the decks pool, 300 games, taken with temporary counters that were removed): 106 moves, 581 advance-loop iterations, 504 hasAction calls (the auto-pass check at every priority stop), 560 state-based-action checks and 560 trigger collections, 895 replayable operations (runWithChoices), 836 characteristics computations, 341 classKey computations, 606 makeCtx calls, 394 manaSources scans and 215 payment solves. At 1,000 games/sec that would leave about 1 microsecond per advance iteration, including the auto-pass move generation, which this design under tsx does not reach.

## What changed (behavior unchanged; the whole suite and the determinism and journal tests stay green)

1. tsx keepNames overhead (the largest item, about 30 percent). tsx compiles with esbuild keepNames on and cannot turn it off; every named arrow function (const f = () => ...) becomes __name(f, "f"), an Object.defineProperty call each time the enclosing function runs. makeCtx built about 40 named arrows per call. The EffectCtx functions and the hot local helpers (makeCtx, runWithChoices, solvePayment, dominates, the move generator, checkSBA, collectTriggers, targetTuples) are now method shorthand, which keepNames leaves alone. Card code is unchanged: the functions still close over the same variables and never use this.
2. Characteristics memo kept across non-characteristic changes (mutate.ts invalidateFor). Before, any change to any object dropped the memo. Now tapped, damage, sick, knownTo and the combat flags, non-P/T counters, the stack array and changes to objects that are not on the battlefield keep it (dropping only that object's entries); classKey, which does read tapped, sick and damage, moved to its own finer memo. src/test/rules/memo.test.ts compares the memoized characteristics, classKey, static lists and trigger listener index with a fresh computation after every move of 100 random games (10,760 states, 1,295,252 object comparisons); it was seen failing when animated was wrongly marked non-characteristic.
3. The state object stays in V8 fast mode. endJournal deleted state.journal after every replayable operation, which put the whole GameState into dictionary mode, so every state.x read became a hash lookup. It now sets the key to undefined (GameState.journal is typed Inverse[] | undefined; JSON, hashes and views are unchanged because they drop undefined).
4. Payment solver. hasAction only needs to know a payment exists, so solvePayment takes firstOnly and stops at the first payable assignment (canPay uses it too); the move generator passes its manaSources scan to the solver instead of rescanning per cost.
5. cloneData (mutate.ts), a plain-data deep copy, replaces structuredClone for LKI snapshots, overlays, pending operations and copy-mode cloneState: about 8 times faster on one object (0.25 vs 1.96 microseconds) and 5 times faster on a mid-game state (38 vs 187 microseconds), with byte-identical JSON.
6. Small ones: parseMana caches by string (returns a fresh copy), getAbility returns one shared entry per basic land key instead of allocating one per call, activatableKeys looks each ability up once, NeedChoice (control flow caught by runWithChoices) skips the stack capture.

## Tried and rejected

- Pinning the benchmark to one logical processor (start /affinity) for steadier numbers: about half the speed, because V8's GC and compiler threads then share that processor. Rejected; runs were made back to back on an idle machine instead.
- Journal mode for playouts: not needed. The bench already runs in place (no cloning), and copy mode's clone is now cloneData. Cloning is not in the top 10.
- A prototype-based EffectCtx (one shared method table, no closures per call): after change 1, makeCtx is about 1 percent self, and a prototype would break any card code that detaches a ctx method. Not done.
- Caching hasAction between priority stops: the answer depends on step, stack, pool, untapped permanents and hand, so any cache key is most of the state. Not done.
- Attack and block enumeration: not in the profile (declareAttackers and declareBlockers choices are about 2 moves per turn); left as is.

## Next steps if 1,000 games/sec/core is still wanted

- Run compiled JavaScript (tsc output) for simulation instead of tsx, which removes the remaining keepNames cost and the start-up read; the worker runner of Phase 2 is the natural place.
- Make the auto-pass check incremental: most of the 504 hasAction calls per game answer the same question for a state that changed only in step or priority.
- Cache per-face data (type, color and keyword masks, ability keys) in computeChars.


# T1.5 structural pass (2026-09-29)

Engine internals only (src/engine, no card def and no public API changed: legalMoves, applyMove, applyMoveInPlace, newGame, view, the mulligan functions and the agent interface keep their shapes). Target was 3 times the T1.4 speed; reached about 1.8 times on the real decks and 1.9 times on the test pool. The 3 times target is NOT met.

## Results

Same machine as T1.4 (i7-13700KF, 32 GB, Windows 11 Pro 10.0.26200, Node v24.15.0 under tsx, one worker, no invariant checks). Command, both rows: cmd /c start /b /wait /affinity 0xFFFF node --import tsx src/tools/bench.ts --games 10000 --runs 5 --pool POOL. The affinity mask keeps the process on the 16 logical processors of the 8 performance cores; unpinned runs landed on efficiency cores at random (T1.4's decks runs spread from 100.4 to 142.0), pinned runs stay within 3 percent. This is not the one-processor pinning T1.4 rejected: V8's helper threads still have 15 other processors. "Before" is a copy of src taken at the start of T1.5 (the T1.4 result), run from the same checkout, back to back with "after" on an idle machine. Each cell: median games/sec/core of n = 5 runs of 10,000 random-vs-random games, then the min to max of the five runs (a 94 percent order-statistic interval for the median, PLAN.md section 7).

| Pool | Before: median (min to max) | After: median (min to max) | Speed-up: ratio of medians (worst to best pairing of the runs) |
|---|---|---|---|
| decks (real game-1 60s) | 151.7 (148.7 to 153.1) | 275.1 (274.5 to 280.3) | 1.81 x (1.79 to 1.89) |
| test (default pool of npm run bench) | 444.9 (433.7 to 446.8) | 855.3 (848.6 to 862.7) | 1.92 x (1.90 to 1.99) |

The before row of the decks pool (151.7) is higher than T1.4's 112.8 for the same code because of the pinning and a quieter machine, not a code change.

Behavior did not change:
- Moves per game, before and after: decks p50 90 [90, 91], p95 192 [191, 193]; test p50 57 [56, 57], p95 81 [81, 82] (order-statistic 95 percent intervals, n = 50,000 games per pool per side).
- Move-by-move digests (every move of every game plus the result) are identical before and after on 12,000 games: 4,000 decks, 2,000 sideboard, 4,000 test and 2,000 extended. Digests that also hash the full state after every move are identical on 300 decks and 300 sideboard games.
- The 5,000-game decks fuzz printed the same report after every step (499,930 moves, 0 cap hits, 0 failures, p0 1,599 / p1 3,388 / draw 13).
- 100,000-game decks fuzz after the pass: node --import tsx src/tools/fuzz.ts --games 100000 --pool decks, invariants 1-8 on: 10,031,900 moves, 0 cap hits, 0 failures, mean 19.48 turns, max 62 turns, max 44 moves in one turn, 10,131,900 invariant checks, 200,638 view checks, 1,000 games replayed, results p0 31,914 / p1 67,843 / draw 243, every decklist card used. The same report as T1.4's, apart from the time: 697.8 s (143 games/s with checks) against 1,329.9 s.

## What changed, in the order tried

1. Incremental auto-pass check (moves.ts hasAction). A process-wide content tick (mutate.ts) moves on every write except the priority bookkeeping (priority, passes, step, phaseQueue, stepPriority) and the event buffer. Per state and player and tick, hasAction caches whether a land could be played, whether a spell could be cast (per sorcery flag) and which activation candidates have a move; the timing checks (canPlayLandNow, sorcery timing, canActivateNow, the D9 window hooks) run fresh on every call. Same answers as the full generator: src/test/rules/autopass.test.ts walks every decision of 55 random games through 10 steps and both priority holders by writing only the timing fields and compares the cached answer with a fresh one and with the full move list (100,120 comparisons); it was seen failing with the sorcery flag ignored, and its tick test was seen failing with object writes not moving the tick. Measured before the change (500 games): 493 hasAction calls per game, of which 410 answered no.
2. Cheaper passing when nobody can act (apply.ts). A state-based action check that found nothing and wrote nothing is skipped until the tick moves (65 percent of checks, 355 of 549 per game over 500 games, were repeats of an unchanged state), and the turn-based actions of steps other than cleanup run without the replay wrapper and its journal (only the cleanup discard asks a Choice).
3. Allocation and repeated work:
   - the payment cache (mana.ts paymentPlans): mana sources, solver classes and plans per state, player and tick, shared by hasAction, legalMoves and the castSpell, activateAbility or unlockDoor that follows (the move re-solved the payment the generator had just solved); classes for a payment that excludes a tapped source are derived from the unexcluded classes instead of rebuilt;
   - the solver: a covers table per solve, a Hall-condition rejection before each dominance matching, the flexibility score per class computed once, candidates keyed by a mixed-radix number of the used vector, with the residual, its key string and the copies built only for a kept candidate;
   - partial memo drops: an object entering or leaving the battlefield, or an animated overlay set or cleared, drops only its own memo entries, its host's and the battlefield aggregates (static lists, land masks, trigger listener index); Urborg's static still drops everything. About 70 full drops per game (500 games: 33.5 animated, 32.4 battlefield entries and exits) had each forced every battlefield object's characteristics and the listener index to be recomputed. src/test/rules/memo-partial.test.ts covers a Role entering and leaving (host P/T), an overlay set and cleared, Urborg entering and leaving, and exits; it was seen failing with the host drop removed and with the Urborg full drop removed; memo.test.ts was seen failing with the static-list reset removed;
   - per-face data in computeChars (printed ability keys, type, color and keyword masks, mana value, supertypes, P/T CDAs), cached mana values by cost string, battlefield activated-ability keys memoized beside the characteristics, hand-zone keys per def, the characteristics memo lookup skipping the WeakMap for the state last used, one characteristics read per object in checkSBA, the day/night keyword scan without an array, reps without key concatenation for battlefield objects, deck files parsed once per process (reading and parsing both deck files for every game had been about 4 percent).
4. Journal mode instead of structuredClone: the random-play path clones nothing (T1.4). The only other engine clone was view.ts, which now uses cloneData (equal on plain data, several times faster). Copy mode stays where the API promises a new state (applyMove, the fuzz replay of invariant 7).
5. Compiled JavaScript instead of tsx: measured and rejected (below).

## Tried and rejected

- Compiled JavaScript (npm run build, then node on dist) instead of tsx: about 4 percent faster on the current code (decks pool, 1,500 games per run, n = 2 runs each: tsx 237.6 and 245.5 games/s, dist 251.5 and 254.2), because T1.4 already removed the keepNames cost. bench and fuzz stay on tsx: a dist default would run stale code after any edit unless every run rebuilt first, which is not worth 4 percent.
- A cross-state memo of payment solves keyed by the class signature, cost and life: 59 percent hit rate (151,128 solves over 1,000 games) but no net gain (about 207 vs 212 games/s, n = 2 runs each, compiled): building the 146-character key and materializing the plans cost as much as the search it saved. Removed.
- A payment cache keyed by a per-player mana epoch (bumped only by battlefield, pool and life changes): only about 10 percent of payment queries (9,429 of 89,715 over 500 games) found an earlier solve under an unchanged epoch, because random play taps something between almost every pair of checks.
- Caching whole hasAction answers by tick alone: at most 38 percent of calls (189 of 493 per game over 500 games) see an unchanged state for the same player, since most moves change content. Hence the split into a cached timing-free part and fresh timing checks.
- A prototype-based EffectCtx (still rejected as in T1.4; makeCtx is 2.0 percent self, mostly the D9 window hooks).

## Profile after

Command: node --cpu-prof --import tsx src/tools/bench.ts --games 1000 --runs 1 --pool decks; self time per function, share of the profile's samples (one profile of 1,000 games). Top 10: buildClasses 3.5, checkSBA 3.4, dominates 3.0, garbage collector 2.7, computeChars 2.5, solvePayment 2.4, setIn 2.3, makeCtx 2.0, characteristics 1.9, reps 1.8 percent. Inclusive (compiled, 2,000 games): hasAction 28 percent, payment solving 18 percent (88 full and 58 existence solves per game over 1,000 games, about 5.6 and 4.2 microseconds each), the move, resolve and state-based action operations 24 percent, legalMoves 14 percent, trigger collection 8 percent.

## Where 3 times would have to come from

The profile is flat again and what is left is real work per decision: about 150 payment solves per game, the move generator for about 100 decisions, and the moves and resolutions themselves. Further steps, each with its own risk:
- An existence check for payments that avoids the solver's search and class building (a greedy payable test, exact only when no option costs life).
- Journal only the operations that can ask a Choice (runWithChoices journals every operation for the rare replay).
- Finer invalidation for the remaining full memo drops (effects, counters that change P/T, control changes).
- Worker threads (Phase 2 runner) multiply throughput by cores; the per-core figure is what this file tracks.

## Phase 4: ISMCTS agent speed

Measured 2026-09-29 on the compiled build (npm run build, then node dist/tools/mcts-bench.js --games 40; i7-13700KF, Windows 11 Pro, Node v24.15.0, one thread, unpinned, no other job of this task running). The MCTS agent at D = 4 samples x I = 50 iterations per decision (200 rollouts, each cut after 2 turns and scored by the greedy evaluation) plays greedy, sides alternating. One sample per game: its searched decisions divided by the seconds spent searching them.

| Measure | Value |
|---|---|
| Searched decisions per second, median over games | 6.74 [96.2% CI 6.12-7.68, n = 40 games] |
| Pooled (all searched decisions / all search seconds) | 5.58 (1,119 decisions in 200.6 s; no interval, one run) |
| Wall seconds per game, both agents | mean 5.1 [95% CI 3.6-6.6, n = 40 games] |
| Mid-operation decisions answered by the greedy fallback | 54 (4.6 percent of the 1,173 non-trivial MCTS decisions) |
| MCTS win rate against greedy in the same 40 games | 47.5% [95% CI 32.9-62.5%, n = 40 games]; a speed run, not the acceptance run |

Acceptance run arithmetic (PLAN.md section 8, 1,000 games per side): 2,000 games x 5.1 s is about 10,200 thread-seconds, about 7.4 minutes of wall time on 23 worker threads if the runner scales as it does for greedy; the upper end of the interval (6.6 s per game) gives about 9.6 minutes. Estimate from the measured speed only, not a measured run, and for this default agent only. Superseded: the default agent did not beat greedy, and the acceptance run used the D25 agent (greedy rollouts, 8 samples, root pruning to 3, margin and override). Measured (docs/ACCEPTANCE.md, one run, no interval): 105.7 min wall for the 50-game pilot and 2,000 games on 23 workers, 64.4 thread seconds per game with MCTS as A (64,369 s over 1,000 games) and 57.4 as B (57,381 s), against a pilot extrapolation of 46.7 thread seconds per game and 1.13 h.

What made the difference: the rollout policy first scored up to 6 attack options per declaration with the greedy combat scorer (a copy of the state, the declaration, the defender's full block enumeration and a static block for each). On large boards this dominated: one game (seed 2, 19 to 23 permanents from turn 12) took 271 s of search for 96 decisions, and a CPU profile of it put 44.5 percent of the time in attackScore (blockOptions 16.4 percent self, cloneData 14.1 percent self). Scoring 3 options (ATTACK_LOOK in src/agents/rollout.ts) brought that game to 21.9 s and the pooled rate from 1.51 decisions per second (20 games with 6 options, median 6.07 [95.9% CI 5.47-7.92, n = 20 games]) to 5.54 (a first 40-game run with 3 options, median 6.61 [96.2% CI 6.34-7.39, n = 40 games]) and 5.58 (the run in the table); 2 options saved little more on the slow games (21.1 s against 21.9 s, 6.0 s against 13.2 s, 6.4 s against 7.7 s, one run each) and was not taken.

Evaluation scale: leafValue maps the greedy evaluation e to 1 / (1 + exp(-e / 16)). The 16 is the maximum-likelihood scale over 3,992 (evaluation at the start of a turn, final winner) pairs from 150 greedy-vs-greedy games (seeds 5000 to 5149); the likelihood is flat from 12 to 20 (mean log-likelihood -0.622 at 12, -0.615 at 16, -0.618 at 20). The pairs within a game are not independent, so the fit carries no interval; it sets a scale, not a probability model.
