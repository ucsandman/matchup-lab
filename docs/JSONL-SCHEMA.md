# Self-play log (JSONL) schema

The self-play log records every decision the agents make in a match, in a form a value or policy network could later be trained on. This project does not train anything; the log is the input for someone who will.

The file is JSON Lines: one JSON object per line, UTF-8, each line ending in a newline. A file ending in .gz is the same content gzip-compressed. There are two kinds of line:

- a decision line (type "decision"), one per agent decision, written when the decision is made;
- a game-end line (type "end"), one per game, written after the game's last decision line.

Schema version: every line has "v": 1. The version changes when a field changes meaning or disappears (src/sim/decision-log.ts, LOG_VERSION).

## Making a log

PowerShell, from the project folder, after npm run build:

    node dist/tools/selfplay-log.js --games 10000 --a greedy --b greedy --seed 1 --workers 8 --out out/selfplay-10k.jsonl
    node dist/tools/selfplay-log.js --validate out/selfplay-10k.jsonl
    node dist/cli/index.js match --a mcts --b greedy --games 20 --samples 8 --iterations 24 --log out/mcts-20.jsonl

In selfplay-log, --a and --b take greedy or mcts (mcts with its default budget); the match command with --log takes every agent and search flag. Play alternates (A is on the play in even games). A seed gives the same file for any worker count: the runner's blocks are seeded independently, each block writes its own part file, and the parts are joined in block order. --validate reads every line, checks it against this schema and checks the join described below; it prints the number of lines it checked and exits 1 on any error or on an empty file.

Size, one measured run (CHANGELOG, Phase 6): 10,000 greedy-vs-greedy games gave 960,957 lines (950,957 decision lines, 10,000 end lines) and 5.53 GiB. The PlayerView repeats on every line, so the log compresses well: a 6-game test log was 76,303 bytes gzipped against 3,389,249 plain (one measurement, n = 6 games). Use a .gz path for long runs.

## Decision line

| Field | Type | Meaning |
|---|---|---|
| type | "decision" | line kind |
| v | integer | schema version (1) |
| game | integer >= 0 | game index within the run, 0 to games - 1; the join key |
| seed | integer | the engine seed of this game. A replay key only: with the engine it reproduces the shuffle, so it determines the hidden cards. Never use it as a model input. |
| d | integer >= 0 | decision index within the game, 0, 1, 2, ... in file order |
| player | 0 or 1 | the deciding player; 0 is deck A (Rakdos Midrange), 1 is deck B (Mono-Red Aggro) |
| side | "A" or "B" | the same as player, as a deck letter |
| agent | "greedy", "mcts", "random" or "passive" | the agent that decided |
| turn | integer | engine turn number, both players' turns counted (turn 0 is the pregame: mulligans and bottoms) |
| step | string | the step of the turn (mulligan, upkeep, draw, main1, beginCombat, declareAttackers, declareBlockers, combatDamage, endCombat, main2, end, cleanup, and the others of the Step type in src/engine/types.ts) |
| view | object | the deciding player's PlayerView (src/engine/view.ts): everything that player may know, nothing else |
| legal | array, length >= 1 | every legal move, in engine order, as {text, move} |
| legal[i].text | string | the move in words, described from the view's objects ("B: play Mutavault") |
| legal[i].move | object | the move as the engine takes it (the Move type in src/engine/types.ts) |
| chosen | integer | index into legal of the move played |
| move | object | the move played, equal to legal[chosen].move |
| search | object or null | ISMCTS statistics when agent is "mcts", null for every other agent |

### The view

The view is the engine's per-player view, the same object the spot analyzer searches from (docs/SPOT-FORMAT.md describes the same game state as a hand-written file). The parts a model needs:

- viewer, turn, activePlayer, priority, startingPlayer, step, phaseQueue (the steps still to come this turn);
- players[0] and players[1]: life, mulligans, manaPool (floating mana), kept, cantGainLife, drewFromEmpty;
- objects: every card the viewer can see, keyed by its object id, with defId (the card), face, owner, controller, zone, tapped, damage, counters (for example lore on a Saga), sick (summoning sickness) and the other engine fields;
- zones.battlefield, zones.graveyard[p], zones.exile[p]: object ids;
- zones.hand[p].known: ids of the hand cards the viewer knows (all of the viewer's own, the opponent's revealed ones); zones.hand[p].hidden: one placeholder per unknown card, {vid, zone, owner, hidden: true}, whose vid (h0, h1, ...) is local to this view, is not an object id and carries no identity;
- zones.library[p].size, and for the viewer's own library knownTop and knownBottom (positions the viewer learned, for example the cards bottomed after a mulligan);
- zones.stack: spells and abilities waiting to resolve, top last;
- pendingChoice: the question being answered when the decision is not a priority decision (mulligan, bottom, targets, attackers, blockers, discard picks); the viewer's own choice is shown in full, the opponent's only as {kind, player, hidden: true};
- effects, delayed, turnFlags, passes, stepPriority, pregame, dayNight, result: public engine bookkeeping.

Object ids are the engine's ids. A card that changes zones gets a new id (CR 400.7), so an id is not a card identity across a game; use defId for the card.

### search (mcts only)

| Field | Type | Meaning |
|---|---|---|
| mode | "searched", "forced", "pregame", "fallback" or "skipped" | how the agent answered: a search; a single legal move; a mulligan or bottom decision by greedy's rules; a mid-operation choice answered by greedy (src/agents/mcts-agent.ts); greedy's clear first choice played without a search (--margin) |
| samples, iterations, rollouts | integer | search size (mode "searched" only) |
| seconds | number | wall time of the search on the machine that ran it |
| root | array | every root move, most visited first (mode "searched" only) |
| root[i].text | string | the move in words, from one determinized sample |
| root[i].legal | integer or null | index into legal of the same move (null if it matches none) |
| root[i].visits | integer | rollouts through the move, summed over samples (the root visits sum to rollouts) |
| root[i].samples | integer | samples whose tree has the move |
| root[i].mean, meanLo, meanHi | number or null | mean rollout value for the decider in [0, 1] with its 95 percent Student t interval; null below 2 rollouts |
| root[i].win | {k, n, est, lo, hi} | win-rate estimate over the rollouts: k wins of n = visits, est = k / n, [lo, hi] the Wilson 95 percent interval |

The search statistics describe rollouts under a heuristic rollout policy and a changing tree policy, on determinized samples in which the hidden cards are dealt at random (the determinization weakness, README.md). They are search targets, not the win probability of any fixed play, and nothing in this log is perfect play. Numbers that are NaN in the engine (an interval below 2 rollouts) are written as null.

An example search field (mcts, 8 samples x 24 iterations; the legal moves were play Mutavault, play Blood Crypt paying 2 life, play Blood Crypt tapped, pass). With 8 rollouts per move every interval is wide: the three moves are not separated.

    "search": {"mode": "searched", "samples": 8, "iterations": 24, "rollouts": 24, "seconds": 0.157,
      "root": [
        {"text": "A: play Mutavault", "legal": 0, "visits": 8, "samples": 8, "mean": 0.6886, "meanLo": 0.6734, "meanHi": 0.7037,
         "win": {"k": 6, "n": 8, "est": 0.75, "lo": 0.4093, "hi": 0.9285}},
        {"text": "A: play Blood Crypt", "legal": 2, "visits": 8, "samples": 8, "mean": 0.6875, "meanLo": 0.6540, "meanHi": 0.7210,
         "win": {"k": 6, "n": 8, "est": 0.75, "lo": 0.4093, "hi": 0.9285}},
        {"text": "A: play Blood Crypt (pay 2 life, untapped)", "legal": 1, "visits": 8, "samples": 8, "mean": 0.6542, "meanLo": 0.6382, "meanHi": 0.6701,
         "win": {"k": 3, "n": 8, "est": 0.375, "lo": 0.1368, "hi": 0.6943}}
      ]}

(The numbers are rounded here; the log has full precision.)

## Game-end line

| Field | Type | Meaning |
|---|---|---|
| type | "end" | line kind |
| v | integer | schema version (1) |
| game | integer | the join key, the same as the game's decision lines |
| seed | integer | the game's engine seed (a replay key, as above) |
| winner | "A", "B" or "draw" | the result |
| winnerPlayer | 0, 1 or null | the winner as a player id (null for a draw) |
| reason | string | how the game ended (for example life: a player at 0 life) |
| turns | integer | turns played, both players' turns counted |
| decisions | integer | decision lines of this game (d runs 0 to decisions - 1) |
| aOnPlay | boolean | deck A took the first turn |
| agents | {A, B} | the agent kind on each side |

Example (game 0 of the 10,000-game log):

    {"type":"end","v":1,"game":0,"seed":1745219083270910,"winner":"B","winnerPlayer":1,"reason":"life","turns":14,"decisions":86,"aOnPlay":true,"agents":{"A":"greedy","B":"greedy"}}

## What a consumer must join

The outcome is not on the decision lines: a decision is written before its game ends. To label a decision with the game's result, join it to the end line with the same game value. There is one end line per game, after all of that game's decision lines, and games appear in game order. The usual labels:

- value target for the decider: 1 when end.winnerPlayer equals decision.player, 0 when it is the other player, and a choice of yours (0.5, or drop the game) for a draw;
- policy target: chosen, an index into legal; with mcts, root[i].visits over the legal moves gives a visit distribution (root[i].legal maps each root move to its legal index);
- game length: end.turns, end.decisions.

A single pass works: read the lines in order, hold a game's decision lines until its end line arrives, then emit them labelled. --validate checks what this relies on: every decision line has an end line for its game, d counts 0, 1, 2, ... within each game, and end.decisions equals the game's decision lines.

## A full decision line

Game 3 of the 10,000-game log (seed 1, greedy vs greedy), decision 5: Mono-Red (player 1) is on the play in its own second turn (turn 3), precombat main, choosing among play Mutavault, play Mountain and pass. Rakdos's seven hand cards appear only as hidden placeholders. The line as written, one line in the file:

    {"type":"decision","v":1,"game":3,"seed":4696517356885934,"d":5,"player":1,"side":"B","agent":"greedy","turn":3,"step":"main1","view":{"viewer":1,"turn":3,"activePlayer":1,"priority":1,"startingPlayer":1,"phaseQueue":["beginCombat","declareAttackers","declareBlockers","combatDamage","endCombat","main2","end","cleanup"],"step":"main1","dayNight":"none","turnFlags":{"landsPlayed":[0,0],"spellsCast":[0,0],"noncreatureSpellsCast":[0,0],"permanentLeft":[false,false],"nextCreatureBonus":[false,true],"damageTally":{},"loyaltyUsed":[]},"effects":[],"pendingChoice":null,"passes":0,"stepPriority":true,"delayed":[],"pregame":null,"result":null,"players":[{"life":19,"cantGainLife":false,"manaPool":[],"mulligans":0,"kept":true,"drewFromEmpty":false},{"life":20,"cantGainLife":false,"manaPool":[],"mulligans":0,"kept":true,"drewFromEmpty":false}],"objects":{"121":{"id":121,"defId":"sunspine-lynx","face":0,"owner":1,"controller":1,"zone":"hand","tapped":false,"damage":0,"counters":{},"sick":false,"knownTo":[false,true],"damagedThisTurnBy":[false,false]},"124":{"id":124,"defId":"mutavault","face":0,"owner":1,"controller":1,"zone":"hand","tapped":false,"damage":0,"counters":{},"sick":false,"knownTo":[false,true],"damagedThisTurnBy":[false,false]},"125":{"id":125,"defId":"emberheart-challenger","face":0,"owner":1,"controller":1,"zone":"hand","tapped":false,"damage":0,"counters":{},"sick":false,"knownTo":[false,true],"damagedThisTurnBy":[false,false]},"126":{"id":126,"defId":"mountain","face":0,"owner":1,"controller":1,"zone":"hand","tapped":false,"damage":0,"counters":{},"sick":false,"knownTo":[false,true],"damagedThisTurnBy":[false,false]},"127":{"id":127,"defId":"monstrous-rage","face":0,"owner":1,"controller":1,"zone":"hand","tapped":false,"damage":0,"counters":{},"sick":false,"knownTo":[false,true],"damagedThisTurnBy":[false,false]},"135":{"id":135,"defId":"sokenzan-crucible-of-defiance","face":0,"owner":1,"controller":1,"zone":"battlefield","tapped":false,"damage":0,"counters":{},"sick":false,"knownTo":[true,true],"damagedThisTurnBy":[false,false]},"137":{"id":137,"defId":"kumano-faces-kakkazan","face":0,"owner":1,"controller":1,"zone":"battlefield","tapped":false,"damage":0,"counters":{"lore":2},"sick":false,"knownTo":[true,true],"damagedThisTurnBy":[false,false]},"140":{"id":140,"defId":"blackcleave-cliffs","face":0,"owner":0,"controller":0,"zone":"battlefield","tapped":false,"damage":0,"counters":{},"sick":true,"knownTo":[true,true],"damagedThisTurnBy":[false,false]},"141":{"id":141,"defId":"mountain","face":0,"owner":1,"controller":1,"zone":"hand","tapped":false,"damage":0,"counters":{},"sick":false,"knownTo":[false,true],"damagedThisTurnBy":[false,false]}},"zones":{"library":[{"size":52},{"size":52,"knownTop":[],"knownBottom":[]}],"hand":[{"known":[],"hidden":[{"vid":"h0","zone":"hand","owner":0,"hidden":true},{"vid":"h1","zone":"hand","owner":0,"hidden":true},{"vid":"h2","zone":"hand","owner":0,"hidden":true},{"vid":"h3","zone":"hand","owner":0,"hidden":true},{"vid":"h4","zone":"hand","owner":0,"hidden":true},{"vid":"h5","zone":"hand","owner":0,"hidden":true},{"vid":"h6","zone":"hand","owner":0,"hidden":true}]},{"known":[121,124,125,126,127,141],"hidden":[]}],"graveyard":[[],[]],"exile":[[],[]],"battlefield":[135,137,140],"stack":[]}},"legal":[{"text":"B: play Mutavault","move":{"type":"playLand","objId":124}},{"text":"B: play Mountain","move":{"type":"playLand","objId":126}},{"text":"B: pass priority","move":{"type":"pass"}}],"chosen":0,"move":{"type":"playLand","objId":124},"search":null}

## What is never in a line

A line carries only what the deciding player may know. The test src/test/tools/selfplay-log.test.ts runs 20 games and checks every decision line: the fuzz view-leak checker (checkViewLeak in src/tools/play.ts) on the view, and the same rules on legal, move and search (no id of a card hidden from the decider under an id field, no defId of such a card that no visible card shares, no name of such a card in any move text); the same check runs on the searched lines of an mcts game. The seed field is the only way back to the hidden cards, through a replay with the engine, which is why it is a replay key and not a feature.
