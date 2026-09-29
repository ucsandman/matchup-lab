# Build brief (verbatim from the operator, placeholders filled 2026-09-29)

You are building a Magic: The Gathering matchup solver for one specific matchup. Read this whole brief, write PLAN.md, then build it phase by phase. Do not start a phase until the previous phase's tests pass.

## CONTEXT
Full Magic is not solvable: the card pool is huge, the rules are Turing complete, and hidden information is enormous. This project makes the game tractable by fixing both decklists and implementing only the cards in them. The output is a strong decision aid built on simulation and search. It is not a GTO solver, and nothing in the code, UI, or docs should claim optimal or equilibrium play.

## THE MATCHUP
Format: Pioneer
Deck A (the deck my friend plays, main + sideboard): Rakdos Midrange (most recent public tournament list; see decks/deckA.json, source + date recorded there)
Deck B (the opponent): Mono-Red Aggro (most recent public tournament list; see decks/deckB.json)
Questions my friend wants answered: which 7s to keep on the play vs the draw, how to sequence turns 1 to 3, when to hold up interaction (removal) versus tapping out.

## STACK AND ENVIRONMENT
TypeScript on Node in strict mode, vitest for tests, worker_threads for parallel simulation. Windows 11 with PowerShell 5: every script and command must be PowerShell, never bash. Do not wrap Forge or XMage. Write a small, fast engine that only supports the rules these specific cards touch.

## PHASE 0: PLAN
List every unique card in both 75s and the rules each one needs (stack and priority, triggers, combat, replacement effects, costs, targeting, etc.). Identify which parts of the comprehensive rules are required and which can be skipped. Flag any card that would be expensive to implement and propose how to handle it. Write all of this to PLAN.md.

## PHASE 1: RULES ENGINE
1. Game state is plain serializable data. State changes are pure functions or support clean undo so search can branch cheaply.
2. A legal move generator returns every meaningful choice for the player with priority. Collapse choices that cannot change the outcome, such as which of two identical untapped lands to tap.
3. All randomness goes through a seeded RNG so any game can be replayed exactly.
4. Each player has a view function that returns only what that player can legally see.
5. Tests: at least one scenario test per card, plus a fuzz test that plays 100,000 random games and checks invariants at every step (total card count conserved across zones, no illegal zone states, every game terminates).
6. Report games per second per core. Profile and optimize the hot paths before moving on.

## PHASE 2: BASELINE AGENTS
Build a random agent and a greedy heuristic agent for each deck. These serve as playout policies and as the benchmark every later agent must beat.

## PHASE 3: MULLIGAN AND GOLDFISH TOOL
Given an opening hand, play or draw, and mulligan count, simulate many games and recommend keep or mulligan. Implement the London mulligan, including choosing which cards to bottom. Report win rate against Deck B using the heuristic opponent, goldfish metrics (average kill turn, how often key cards are online by turn N), sample size, and a 95% confidence interval. Keep simulating until the interval separates keep from mull, or report that it is too close to call. State in the output that win rates reflect heuristic play, not perfect play.

## PHASE 4: SPOT ANALYZER
Input: a game state in JSON from one player's point of view. Use information set Monte Carlo tree search with determinization: sample opponent hands and library orders consistent with everything that player has seen (known decklist, revealed cards, public zones), search each sample, and aggregate results across samples. Output the top candidate lines with estimated win rate, visit counts, and uncertainty. Document the known weakness of determinization in the README (it can act as if it knows hidden information the player does not have).
Acceptance: the MCTS agent must beat the greedy agent over at least 1,000 games per side by a statistically significant margin. Report the result.

## PHASE 5: INTERFACE
Start with a CLI: analyze a hand, analyze a spot from a JSON file, and run agent A vs agent B for N games. Then, if time allows, build a simple local web UI where my friend can set up a board state by clicking cards instead of writing JSON.

## PHASE 6 (STRETCH): LEARNING HOOKS
Log states, chosen moves, and final outcomes from self play to JSONL so a value or policy network can be trained later. Do not build the training pipeline now.

## RULES FOR THE WHOLE BUILD
1. Every number shown to the user includes its sample size and confidence interval.
2. When a card interaction is ambiguous, cite the comprehensive rule number in a code comment and add a test for it.
3. Keep CHANGELOG.md current and update PLAN.md whenever a decision changes.
4. Finish with a README that explains to a Magic player who doesn't code how to use each tool and what its limits are.
