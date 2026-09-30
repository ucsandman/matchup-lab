# Matchup Lab: developer and reference guide

This is the full reference: PowerShell commands, every tool's flags and sample output, the limits in detail, the determinization weakness, speed numbers and how to add a card. The short guide for players is the README at the repository root.

Every command and every sample output below was run on 2026-09-29 from a fresh copy of this folder (no installed packages, nothing built), after the setup step, on the development machine (Windows 11, 24 logical processors, Node 24). Your numbers will match when you use the same seed; your times will differ.

---

## 1. Setup with PowerShell (for developers)

You do not need this section if you used [Start here](#start-here-no-command-line): Launch.bat and launch.py do all of it. This is the command-line setup, once, on Windows; the hand, spot and match tools in 3b to 3d need it.

1. Install Node.js. Open https://nodejs.org in your browser, click the big download button (the LTS version; you need 22 or newer), run the installer and click Next through it with the default choices.
2. Open the project folder in File Explorer (the folder that contains README.md).
3. Click once in the address bar at the top of the File Explorer window, type powershell and press Enter. A blue or black PowerShell window opens, already in the project folder.
4. Copy this line, paste it into the PowerShell window (right-click pastes) and press Enter:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup.ps1
```

It installs the development packages (about a minute the first time, it downloads them), builds the tools and checks every card against the decklists. Success looks like this (the 56-row card table is left out here):

```text
== 1 of 4: npm install

added 44 packages, and audited 45 packages in 2s
found 0 vulnerabilities
== 2 of 4: npm run build (TypeScript to dist)
built 221 JavaScript files into dist
== 3 of 4: comprehensive rules text (docs/CR.txt, downloaded from wizards.com)
fetch-cr wrote docs/CR.txt (956362 chars, 3459 rule lines)
== 4 of 4: npm run check:cards (card definitions against the decklists)
check:cards 56 card name(s) from deckA and deckB (main + side); 56 with a def; 64 face(s) checked against oracle.json; 56 of 56 with scenario tests (275 tests); 0 gap(s)

versions:
  node       v24.15.0
  npm        10.9.0
  typescript Version 7.0.2
  vitest     5.0.2
  tsx        4.23.15
  project    0.0.1
  PowerShell 5.1.26100.9444

setup done. Try: .\scripts\hand.ps1 --help   (or: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\hand.ps1 --help)
```

The last line must say setup done. If it says node was not found, close PowerShell, open a new window (step 3) so it sees the new Node, and run the line again.

Why every command starts with powershell -NoProfile -ExecutionPolicy Bypass -File: a fresh Windows refuses to run script files by default, and files downloaded as a zip are blocked too. This form runs the one script you name without changing any Windows setting. If you have allowed scripts on your machine, the short form (.\scripts\hand.ps1 and so on) does the same.

---

## 2. How to read the numbers

Every result looks like this:

```text
keep this hand: A wins 60.0% [95% CI 50.2-69.1%, n=100] vs greedy Mono-Red
```

- **60.0%** is the share of simulated games won.
- **n=100** is how many games that number rests on. Small n means a rough number.
- **[95% CI 50.2-69.1%]** is the 95 percent confidence interval: the range the win rate would most likely land in if you played many more games with these same computer players. At n=100 the range is about 10 points either side; at n=1000 about 3.
- **Two options whose intervals overlap have not been told apart.** Treat them as a tie, not as "the higher one is better".
- The interval only covers luck of the draw in the simulation. It does not cover the ways the computer players play worse than you (section 4), which can be much larger.

Every tool ends with the line: Win rates reflect heuristic play, not perfect play.

---

## 3a. The web page: build a board by clicking

The easy way to start it is double-clicking Launch.bat (see the README); it opens the page for you. From PowerShell instead (copy, paste, Enter, in the PowerShell window of step 3 of setup):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\web.ps1
```

It prints:

```text
MTG matchup web UI: open http://127.0.0.1:3456/ in your browser (Ctrl+C stops the server)
```

1. Open http://127.0.0.1:3456/ in your browser. The page runs on your computer only; nobody else on your network can open it.
2. Leave the PowerShell window open while you use the page. To stop, click in that window and press Ctrl+C.
3. The first time, the card pictures take about 10 seconds to appear (they come from Scryfall and are then kept on your computer). Until then each tile shows the card name, which works just as well.

**What you see.** The name Matchup Lab, one line saying what it does (Rakdos Midrange vs Mono-Red Aggro, win rates from simulated games) and three large question cards. Click one to start; the links at the top right switch between them at any time. Every answer gives each number with how many games it is based on (n) and a likely range (the 95 percent interval of section 2), and the sentence Win rates reflect heuristic play, not perfect play stays under every result. A small ? next to a word explains it when you point at it (or tab to it).

**Should I keep this hand?** (the first card)

1. Pick your seven cards: click them in the Rakdos Midrange list, grouped by type. They appear as a hand with a counter (7 of 7). Click a card in the hand to put it back; Clear empties it.
2. Play or draw: click On the play or On the draw.
3. Mulligans already taken: 0, 1 or 2. After one mulligan, step 1 asks for the six cards you kept (6 of 6). Under More options you can instead enter all seven cards you drew and let the computer choose the bottom card, and pick up to 1000 games per choice instead of 400.
4. Press **Should I keep it?** A progress line counts the games played. The answer is a big KEEP, MULLIGAN or TOO CLOSE TO CALL and one sentence, for example: Keeping wins 58 percent of 100 simulated games (likely between 48 and 67 percent). Taking a mulligan to 6 wins 18 percent of 100 (likely between 12 and 27 percent). **Details** opens a table of the goldfish numbers (how fast the hand wins against an opponent who does nothing, land drops, key cards on time), each with its range and n, and the full hand report of 3b.

**What is the best play on this board?** (the second card)

1. Your side and 2. Their side: press **Add a card** on a side and click cards; the row at the top of the list says where a click puts the card (Battlefield, the default, Hand, Graveyard or Exile). Tokens are buttons under the list. Cards on the battlefield show as pictures: click one to tap or untap it (it turns sideways). Sagas get a chapter, Liliana her loyalty, double-faced cards a side, creatures a Summoning sick box and, under Counters, damage, +1/+1 and -1/-1 counters. Point at a card and press the x to remove it. Cards you put in their hand are ones you know they hold (from Thoughtseize or Duress).
2. The game right now: whose turn it is, what part of the turn (before combat, combat, after combat, end of turn), the turn number (both players' turns count: on the play yours are 1, 3, 5; on the draw 2, 4, 6), both life totals, how many of their cards you have not seen, and whether a land was played this turn. **Advanced** holds the rest: which deck is yours, who went first, the exact step, who can act right now, day or night, library sizes (empty means counted for you), mulligans, cards you know on top or bottom of your library, a note, and whose win rates to show.
3. How long should it think: Quick (about 1 second), Normal (about 2 seconds) or Deep (about 10 seconds, narrowest ranges), measured on the example board on the development machine. These are the page's three search sizes (4 x 100, 8 x 400 and 16 x 2000); Normal is the spot tool with --mode uct.
4. Press **What should I do?** The answer names the best play the search found and its numbers, for example: Rakdos wins 75 percent of 212 simulated games after this play (likely between 69 and 81 percent). Below it, every play it compared is a row with a bar (the win rate) and a line across the bar (the likely range), then a collapsed **Full report** with the spot tool's text. A simulated game here is played forward two turns and then scored (a rollout). When the ranges of the top plays overlap, the page says so: the search has not told them apart; try Deep. "Best play found" means the play the search tried most; it is not a proven best play, and the page runs the plain search, not the validated computer player of the spot tool (3c). Under the result: The search samples hidden cards; it can act as if it knew cards you have not seen.

The buttons at the top: **Load an example board** (a Rakdos turn-4 decision with Sheoldred in hand), **Save board** (spot.json in your Downloads folder; the spot tool in 3c reads it), **Load a saved board** and **Clear the board**.

**How does the matchup go?** (the third card) Pick the Rakdos player (Computer, or Search-assisted computer: the validated search agent of 3d, about 60 thread seconds per game) against the Mono-Red computer, then 100, 500 or 1000 games; each shows a rough time guess for this computer. Press **Run the games**. The result card says Rakdos wins X percent of N games (likely between ...), then Rakdos on the play and on the draw, the average game length in turns and the time taken, each with n and a range, and the match tool's full report. While a question runs, the others wait.

If something cannot be worked out (for example a card the list does not have), the answer box says so in words and repeats the analyzer's reason.

More detail: docs/WEB-UI.md.

---

## 3b. Hand tool: keep or mulligan

It plays your opening hand (deck A, Rakdos) many times against the computer Mono-Red player, and compares that with taking a mulligan.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\hand.ps1 --hand 'Blood Crypt,Swamp,Blackcleave Cliffs,Thoughtseize,Bloodtithe Harvester,Fable of the Mirror-Breaker,Sheoldred, the Apocalypse' --play
```

**Quoting, the one thing to get right:** put the whole card list inside single quotes, as above. Cards are separated by commas; a name that contains a comma (Sheoldred, the Apocalypse) is recognised. Without the quotes PowerShell splits the list at the first space and the tool stops:

```text
hand: unexpected argument 'Crypt,Swamp' (a value with spaces or commas needs quotes, see the command's help)
```

Use --play or --draw (one is required). After a mulligan add --mulligans 1 and give the seven cards you drew; the tool bottoms one with its own rule, or add --bottom 'Swamp' to say which. docs/HAND-TOOL.md lists every option. To see them all:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\hand.ps1 --help
```

**Sample output** of the command above (the whole report, 18.7 s):

```text
look 1: keep 60.0% [95% CI 50.2-69.1%, n=100], mulligan 34.0% [95% CI 25.5-43.7%, n=100]
input: Rakdos Midrange (deck A) on the play, 0 mulligan(s) taken, seed 1, max 400 games per branch, batch 100
input: hand (7 cards): Blood Crypt, Swamp, Blackcleave Cliffs, Thoughtseize, Bloodtithe Harvester, Fable of the Mirror-Breaker // Reflection of Kiki-Jiki, Sheoldred, the Apocalypse
input: bottom: none (no mulligan taken)
verdict: KEEP
  keep this hand: A wins 60.0% [95% CI 50.2-69.1%, n=100] vs greedy Mono-Red
  mulligan to 6: A wins 34.0% [95% CI 25.5-43.7%, n=100] vs greedy Mono-Red
note: stopped because the intervals separated after 1 look(s) of up to 100 games per branch; the rule looks repeatedly, so it is a stopping rule, not a significance test.
keep branch:
  kill turn vs a passive opponent (own turns): 5.84 [95% CI 5.79-5.90, n=200]
  turn A won on vs greedy Mono-Red (own turns, over A's wins): 7.58 [95% CI 7.33-7.84, n=60]
  land drop on curve: 1 land by own turn 1: 100.0% [95% CI 96.3-100.0%, n=100]
  land drop on curve: 2 lands by own turn 2: 100.0% [95% CI 96.3-100.0%, n=100]
  land drop on curve: 3 lands by own turn 3: 98.0% [95% CI 93.0-99.4%, n=100]
  land drop on curve: 4 lands by own turn 4: 56.0% [95% CI 46.2-65.3%, n=100]
  Fable of the Mirror-Breaker cast by own turn 3: 92.0% [95% CI 85.0-95.9%, n=100]
  Sheoldred, the Apocalypse cast by own turn 4: 4.0% [95% CI 1.6-9.8%, n=100]
  any removal cast by own turn 2: 0.0% [95% CI 0.0-3.7%, n=100]
  draws: 0.0% [95% CI 0.0-3.7%, n=100]
sample: n=400 games in total (keep n=100, mulligan n=100, goldfish n=200)
speed: median 1.61 games/sec/core [96.7% CI 1.37-1.83, n=80 blocks, one worker thread per block]; elapsed 17.7 s wall for 400 games on 23 workers
Win rates reflect heuristic play, not perfect play.
```

**How to read it.**

- The tool plays the hand in rounds of 100 games per choice (the look lines). After each round it compares the two intervals. Here keeping won 60.0 percent (50.2 to 69.1, 100 games) and going to six won 34.0 percent (25.5 to 43.7, 100 games). The ranges do not overlap, so it stopped after one round.
- **KEEP**: keeping won clearly more often than mulliganing.
- **MULLIGAN**: mulliganing won clearly more often. The same command with a seven of no lands ('Thoughtseize,Fatal Push,Bloodtithe Harvester,Fable of the Mirror-Breaker,Sheoldred, the Apocalypse,Sheoldred, the Apocalypse,Go for the Throat') printed: keep 8.0% [95% CI 4.1-15.0%, n=100], mulligan to 6 34.0% [95% CI 25.5-43.7%, n=100], verdict MULLIGAN.
- **TOO CLOSE TO CALL**: after 400 games per choice the two ranges still overlap. The hand is close enough that these computer players cannot separate it; your judgment decides. Both win rates are still printed.
- A close hand takes more rounds. Six lands and a Bloodtithe Harvester on the play ('Blood Crypt,Swamp,Mutavault,Blackcleave Cliffs,Blightstep Pathway,Hive of the Eye Tyrant,Bloodtithe Harvester') needed all four rounds, 40.9 s: keep 28.7% [95% CI 24.5-33.4%, n=400], mulligan to 6 39.0% [95% CI 34.3-43.9%, n=400], verdict MULLIGAN.
- **keep branch** lines describe the kept hand: how fast it kills an opponent who does nothing (5.84 of its own turns [95% CI 5.79-5.90, n=200]), the turn it won on in real games, and how often it hit its land drops and cast Fable by turn 3, Sheoldred by turn 4 and removal by turn 2 (the list of key cards is decks/key-cards.json).
- **Mulligan to 6** means: shuffle, draw a fresh seven, bottom one with the computer's rule, then keep or mulligan again with its usual rule. So MULLIGAN says "a random six is better than this seven in these players' hands", not "better than the best possible six".
- The answer comes with a seed (default 1): the same command gives the same numbers. Add --seed 2 for a fresh set of games.

---

## 3c. Spot tool: what do I do in this position?

It reads a position (a spot file), guesses the cards you cannot see several times, and searches your options.

**Get a spot file** one of two ways:

1. Build the board on the web page (3a), press Export JSON, then move the file from Downloads into the project's spots folder with this line:

```powershell
Move-Item $HOME\Downloads\spot.json spots\my-spot.json
```

2. Or copy spots\example.json and edit it in Notepad. docs/SPOT-FORMAT.md explains every field with a full example.

**Run it:**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\spot.ps1 --file spots\example.json
```

(For your own board, write spots\my-spot.json instead.) The example is Rakdos on the play, its fourth turn, before the land drop, with Sheoldred and a Swamp in hand. Sample output (0.9 s; a note about what was tested goes first and is left out here):

```text
spot: spots\example.json (Rakdos on the play, its fourth turn (turn 7), precombat main, before the land drop. Sheoldred now, or hold up removal?)
mode: validated (the Phase 4 acceptance agent's search; see the note on stderr)
seen by A; deciding: A; win rates are for A
search: 8 samples, 3 iterations per sample, greedy rollouts truncated after 2 turns, greedy top-3 pruning at the root, seed 1, 8 workers
greedy's first choice on the validated agent's own sample: A: play Swamp (at least the margin of 3 evaluation points ahead of greedy's second choice on that sample; the agent's margin step, a yes or no)
  over n=8 samples (the first is the agent's own): greedy picks it in 100.0% [95% CI 67.6-100.0%, n=8]; its lead over greedy's best other move, in evaluation points: mean 5.87 [95% CI 5.22 to 6.52, t interval, n=8 samples]
recommendation: A: play Swamp: greedy's move, which leads by 3 or more evaluation points, so the validated agent plays it without a search (the lines below are shown for reference)
paired gain of each searched move over greedy's move (mean per-sample difference in rollout value; the override needs gain - 2 x SE > 0 and gain >= 0.02):
  A: pass priority: gain -0.071 [95% CI -0.157 to +0.015, t interval, SE 0.036, n=8 samples]
  A: activate Blood (A) ability 1 (discarding Swamp (A)): gain -0.144 [95% CI -0.221 to -0.066, t interval, SE 0.033, n=8 samples]
total: 24 rollouts over 8 samples; win 75.0% [95% CI 55.1%-88.0%, n=24 rollouts]; mean value 0.735 [95% CI 0.690-0.779, t interval, SE 0.021, n=24]; elapsed 0.4 s (one run)
top 3 of 3 root moves (most visited first; n = rollouts through the move, summed over the samples):
1. A: play Swamp
   win 75.0% [95% CI 40.9%-92.9%, n=8 rollouts]; mean value 0.806 [95% CI 0.773-0.840, t interval, SE 0.014, n=8]; visits 8 of 24, in 8 of 8 samples
2. A: pass priority
   win 75.0% [95% CI 40.9%-92.9%, n=8 rollouts]; mean value 0.736 [95% CI 0.644-0.827, t interval, SE 0.039, n=8]; visits 8 of 24, in 8 of 8 samples
3. A: activate Blood (A) ability 1 (discarding Swamp (A))
   win 75.0% [95% CI 40.9%-92.9%, n=8 rollouts]; mean value 0.663 [95% CI 0.575-0.750, t interval, SE 0.037, n=8]; visits 8 of 24, in 8 of 8 samples
Win rates reflect heuristic play, not perfect play.
The search samples hidden cards; it can act as if it knew cards the player has not seen.
```

**How to read it.**

- **recommendation** is the move the tested computer player (the one that beat greedy in section 3d) makes here, and why. It starts from greedy's first choice. If greedy likes that move by 3 points or more on its scale, it plays it without searching (as here). The line under greedy's first choice checks that choice on all 8 guessed hands: greedy picked Swamp on 8 of 8, and led its next-best move by 5.87 points on average (range 5.22 to 6.52, n=8). Otherwise it searches greedy's top 3 moves and switches only if another move wins by a clear margin on the same guessed hands.
- **paired gain** compares each other move with greedy's move on the same 8 guesses of the hidden cards. Below zero means worse. Pass priority here: -0.071, with a range of -0.157 to +0.015 over n=8 samples.
- **Numbered lines**: each move, with its win rate over the rollouts that started with it, the 95 percent interval and n. Visits is how often the search tried it. All three moves won 75.0 percent of 8 rollouts (40.9 to 92.9): at 8 rollouts each, the win rates alone cannot tell the moves apart. The recommendation and the paired gains carry the decision here.
- The search size is small on purpose: it is the exact setting that was tested against the greedy player over 1,000 games per side.

**Deeper search.** Add --mode uct for the plain search: 8 samples x 400 searches, every legal move, most searched first, no recommendation line. It was not tested against greedy, and it says so. Here are its first two moves on the same file (1.7 s):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\spot.ps1 --file spots\example.json --mode uct
```

```text
total: 3200 rollouts over 8 samples; win 65.0% [95% CI 63.3%-66.6%, n=3200 rollouts]; mean value 0.655 [95% CI 0.651-0.659, t interval, SE 0.002, n=3200]; elapsed 1.2 s (one run)
top 5 of 7 root moves (most visited first; n = rollouts through the move, summed over the samples):
1. A: play Swamp
   win 70.1% [95% CI 67.0%-73.0%, n=916 rollouts]; mean value 0.704 [95% CI 0.695-0.713, t interval, SE 0.005, n=916]; visits 916 of 3200, in 8 of 8 samples
   most visited line after it:
     A: cast Sheoldred, the Apocalypse: win 80.7% [95% CI 76.6%-84.2%, n=414 rollouts]; mean value 0.815 [95% CI 0.808-0.822, t interval, SE 0.004, n=414]
     B: pass priority: win 80.0% [95% CI 70.0%-87.3%, n=80 rollouts]; mean value 0.801 [95% CI 0.779-0.822, t interval, SE 0.011, n=80]
2. A: pass priority
   win 64.5% [95% CI 60.1%-68.7%, n=471 rollouts]; mean value 0.667 [95% CI 0.657-0.677, t interval, SE 0.005, n=471]; visits 471 of 3200, in 8 of 8 samples
...
```

Swamp was tried 916 times out of 3,200 and won 70.1 percent (67.0 to 73.0). Passing won 64.5 percent (60.1 to 68.7). The two ranges overlap slightly, so the search leans to the Swamp but has not proven it better. The line under a move is what the search expected to happen next (here: Swamp, then Sheoldred), each step with its own n. Read section 5 before trusting either mode.

For the board exported from the web page in 3a (Rakdos on the draw, turn 6), the recommendation was cast Fable of the Mirror-Breaker (greedy's move; no other move beat it by a clear paired gain), from 24 rollouts, 0.6 s.

---

## 3d. Match tool: computer player against computer player

It plays many full games between two computer players and prints each side's win rate. Deck A (Rakdos) is always side A, deck B (Mono-Red) side B. The players are:

- **random**: picks any legal move. Only useful as a floor.
- **greedy**: tries every legal move one step ahead and picks the one its scoring likes best. It is the opponent in the hand tool.
- **mcts**: greedy plus a short search (the same one as the spot tool's default).

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\match.ps1 --a greedy --b greedy --games 1000 --seed 20260929
```

Sample output (37.6 s):

```text
match: A = Rakdos Midrange (greedy) vs B = Mono-Red Aggro (greedy), seed 20260929, play alternate
games: n=1000 (96386 agent decisions checked legal)
A win rate: 46.5% [95% CI 43.4-49.6%, n=1000]
  on the play: 52.8% [95% CI 48.4-57.1%, n=500]   on the draw: 40.2% [95% CI 36.0-44.6%, n=500]
B win rate: 53.5% [95% CI 50.4-56.6%, n=1000]
draws: 0.0% [95% CI 0.0-0.4%, n=1000]
game length, turns (both players): mean 13.37 [95% CI 13.19-13.55, n=1000]; median 13 [95.4% CI 13-14, n=1000]; p95 18 [95.8% CI 18-19, n=1000]
kill turn (winner's own turns): A 7.67 [95% CI 7.56-7.78, n=465]; B 6.29 [95% CI 6.17-6.40, n=535]
A: Fable of the Mirror-Breaker on the battlefield by own turn 3: 31.7% [95% CI 28.9-34.6%, n=1000]
A: Sheoldred on the battlefield by own turn 4: 13.9% [95% CI 11.9-16.2%, n=1000]
A: removal cast by own turn 2: 39.2% [95% CI 36.2-42.3%, n=1000]
B: Kumano Faces Kakkazan cast on own turn 1: 36.7% [95% CI 33.8-39.7%, n=1000]
speed: median 1.44 games/sec/core [96.2% CI 1.31-1.73, n=40 blocks, one worker thread per block] (1000 games in 36.3 s wall on 23 workers)
Win rates reflect the heuristic agents named above, not perfect play.
```

How to read it: between two greedy players Rakdos won 46.5 percent of 1,000 games (43.4 to 49.6), 52.8 percent on the play and 40.2 percent on the draw (500 games each). Sides alternate who plays first (--play alternate). Kill turn counts the winner's own turns. The key-card lines say how often each deck's plan came together; greedy Rakdos is slow to deploy Sheoldred.

**The searching player.** It is much slower, about a minute of computer time per game, so play fewer games and add --block-size 2, which spreads a small match over all processors (without it, 46 games ran on 2 processors and took 505 s instead of 163 s):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\match.ps1 --a mcts --b greedy --games 46 --seed 1 --block-size 2
```

Sample output (162.8 s; the note on what was tested is left out):

```text
match: A = Rakdos Midrange (mcts) vs B = Mono-Red Aggro (greedy), seed 1, play alternate
mcts budget: 8 samples x 3 iterations per decision, greedy rollouts cut after 2 turns, greedy top-3 pruning at the root, greedy's move unsearched when it leads by 3 or more, greedy's move overridden only by a paired lead above 2 standard errors and at least 0.02
games: n=46 (4075 agent decisions checked legal)
A win rate: 45.7% [95% CI 32.2-59.8%, n=46]
  on the play: 47.8% [95% CI 29.2-67.0%, n=23]   on the draw: 43.5% [95% CI 25.6-63.2%, n=23]
B win rate: 54.3% [95% CI 40.2-67.8%, n=46]
...
speed: median 0.03 games/sec/core [96.5% CI 0.02-0.03, n=23 blocks, one worker thread per block] (46 games in 162.1 s wall on 23 workers)
Win rates reflect the heuristic agents named above, not perfect play.
```

46 games are far too few to compare players: the range runs from 32.2 to 59.8 percent. Over 1,000 games per side (docs/ACCEPTANCE.md, about 50 minutes each) the searching player beat greedy on both sides: as Rakdos 54.9% [95% CI 51.8-58.0%, n=1000] against greedy's own 46.5% [95% CI 43.4-49.6%, n=1000] from that seat, and as Mono-Red 63.9% [95% CI 60.9-66.8%, n=1000] against 53.5% [95% CI 50.4-56.6%, n=1000]. That shows it beats this greedy player. It says nothing about how it does against people.

Other options: --play A, B, alternate or random; --json for machine-readable output; --help for the full list.

---

## 4. Limits: what the numbers do not tell you

1. **Win rates reflect heuristic play, not perfect play.** Every game is played by rule-of-thumb computer players. A number says how a hand or a move does in their hands, not in yours and not with perfect play. The confidence interval covers simulation luck only, not this.
2. **The search can act as if it knew your opponent's hand.** It guesses the hidden cards, then plans each guess with every card face up. Section 5 explains what that gets wrong.
3. **Game 1 only.** All tools use the two main decks. The sideboard cards are implemented and tested, but no sideboard plan (what comes in and out for this matchup) has been supplied, so nothing post-board is simulated. Until one is loaded, treat every number as a game-1 number (PLAN.md section 10, question 2).
4. **The greedy player's blind spots.** It is the opponent in the hand tool and the base of the searching player:
   - It looks one move ahead. It does not plan mana across two spells in a turn.
   - It does not expect the opponent's responses or combat tricks (a Monstrous Rage in response, a Fatal Push after blocks).
   - It knows how many cards the opponent holds, not which.
   - Its scoring weights were set by hand on small samples, not fitted.
   - Its mulligan rule is simple: keep 2 to 5 lands with a spell castable by turn 3; always keep after two mulligans.
   - The searching player only reorders greedy's top 3 moves, so a move greedy ranks fourth or lower is never played on a searched decision.
5. **Rules shortcuts (PLAN.md D9 and D20).** To keep games fast, a few card choices are narrowed. Each is tested; most almost never matter:
   - Fable's rummage (the Goblin Shaman's discard-then-draw): at most 20 discard choices are offered, counting identical cards once, lands and dead cards first.
   - Liliana of the Veil's -6: only three ways to split the piles are tried (lands against nonlands, the best threat alone, a value-balanced split).
   - Kumano Faces Kakkazan chapter II: the +1/+1 counter bonus is applied when the next creature is cast, not as a trigger you could respond to (no card in either deck could respond anyway).
   - Graveyard Trespasser: it exiles only creature cards (or nothing) from graveyards; exiling a noncreature card changes nothing in these decks.
   - The Legend of Roku chapter II: its mana of any color is always red (every cost in the red deck can be paid with red mana, so no game changes).
   - Petrified Hamlet (sideboard): it can only name lands in these two 75s.
   - Reckless Rage: your own creature targets are limited to ones that survive or gain something, plus one sacrifice option.
   - Animating Mutavault and the other creature lands, and Sokenzan's channel ability: offered only at moments when they can matter, not at every chance to activate them.
   - Attacks and blocks: at most 64 attack plans and 64 block plans are considered per combat, the likeliest first.
   - Spells that can target a player always target the opponent.
   - Unlicensed Hearse and Reckoner Bankbuster (sideboard only): simplified targets and at most 4 crew choices.
   - Combat damage among several blockers is always assigned the same way (lethal to each blocker in order, the rest to the player with trample), not chosen by the attacker. A few odd games where another split is better are misplayed.
6. **The hidden-card guesses are uniform.** The analyzer does not read what the opponent's play has told you (section 5).
7. **Speed.** These tools are slower than a human's hunch: a hand takes 20 to 40 seconds and a searched match game about a minute of computer time (section 6).

---

## Spot analyzer: what it gets wrong (the determinization weakness)

The spot analyzer reads a position as one player sees it (docs/SPOT-FORMAT.md) and ranks that player's options. Before trusting its ranking, know how it fills in what you cannot see, because that is where it goes wrong.

### How it fills in the hidden cards

You cannot see the opponent's hand or the order of either library. The analyzer deals them at random from what is left of each decklist after removing every card the position shows. It does this several times (the samples, --samples). Each sample is a complete game with every card face up, and the analyzer searches each one by playing it forward many times with simple heuristic players (the rollouts). Then it adds up, move by move, how each of your options did across the samples. This is called determinization: turning a game with hidden cards into several games with none.

### Strategy fusion: it plays as if it knew the hidden cards

Inside one sample the search knows exactly what the opponent holds, and it plans the rest of the game around it. In a sample where the opponent holds Emberheart Challenger, the search keeps Fatal Push up; in a sample where they hold two lands, it taps out. A real player has to pick one plan without knowing which game they are in. The analyzer never has to, so it overrates moves whose payoff depends on guessing right later, and it rates each move as if every later decision would be made with perfect knowledge of the hidden cards.

What this means at the table:

- Moves that gain information look worthless to it. Thoughtseize and Duress show you the opponent's hand, but the search already knows the hand in every sample, so it values them only for the card they take.
- Plays that hedge against several possible hands (holding up removal, sandbagging a creature, keeping a blocker back) can look worse than they are, because in each sample the search knows which threat is really there.
- The modeled opponent has the same advantage: in each sample it can play as if it could see your hand.

The printed intervals do not include this error. They describe the random spread of the rollouts. More samples and iterations narrow the interval, but they do not remove the bias.

### Non-locality: it ignores what the opponent's play has told you

The deal is uniform over the cards left. It does not update on how the opponent has played so far: a creature not blocked, mana held open all turn, a mulligan, a card they kept after your Thoughtseize, the cards they put on the bottom. A human reads those signals; the analyzer treats every remaining card as equally likely to be in the hand. When the opponent's past play says a lot about their hand, the samples are the wrong games.

### How to read its answer

1. Treat moves whose win-rate intervals overlap as a tie. The top line is the most searched move, not a proven best move.
2. Trust it more when the best move does not depend on what the opponent holds (lethal on board, a land drop, a clear trade), and less when it does (playing around a trick, discard, holding up an instant).
3. Read the win rates as rollouts of heuristic play from this position, not as the chance you win the real game.

The analyzer says this in its last two lines on every run: Win rates reflect heuristic play, not perfect play. The search samples hidden cards; it can act as if it knew cards the player has not seen.

The match tool's searching player (--a mcts or --b mcts) decides with the same sampling, so strategy fusion and non-locality apply to it too (docs/ACCEPTANCE.md, PLAN.md D24 and D25).

---

## 6. Speed on the development machine

Intel i7-13700KF (24 logical processors), Windows 11, Node 24, 23 worker threads (the default), measured 2026-09-29 while writing this guide. Each time is one run (n=1), so it has no interval; other programs running on the machine slow every tool down.

| What | Time |
|---|---|
| Setup, packages already cached | 4 s (about a minute with downloads) |
| Hand tool, a clear hand (400 games) | 18.7 s, 22.0 s and 20.2 s for three hands |
| Hand tool, a close hand (1,000 games, the most a default run plays) | 40.9 s |
| Hand tool, same worst case on 8 workers (docs/HAND-TOOL.md) | 30.2 s for the slowest documented hand; 26.5, 33.1 and 34.2 s for a four-round hand; 93 to 127 s while another job held the processor |
| Spot tool, default mode | 0.6 to 0.9 s |
| Spot tool, --mode uct | 1.7 s |
| Web page, Quick search, click to results | 10.1 s (0.4 s of search, the rest starting the worker threads) |
| Match, greedy vs greedy, 1,000 games | 37.6 s |
| Match, searching player vs greedy, 46 games, --block-size 2 | 162.8 s |

The engine's raw speed is below its target of 1,000 random games per second per core: 205.3 games/sec/core [97.3% CI 200.0-210.4, n=60 blocks of 100 random games] in the benchmark run in section 7 (the median of the per-block speeds over 3 runs of 2,000 games). docs/PERF.md has the profile and what was tried.

---

## 7. For developers

TypeScript, no runtime dependencies. Every npm script calls node directly and every script under scripts/ is PowerShell 5. Run these from the project folder; each was run on the fresh copy with the result shown.

| Command | What it does | Result on the fresh copy |
|---|---|---|
| npm run verify:all | typecheck, all tests, CR citation lint and card check in turn; a step that processed nothing fails | exit 0; 221 source files typechecked, 547 tests passed (199.1 s), 612 CR citations, 56 card names; 4 of 4 steps passed |
| powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fuzz.ps1 --games 1000 --pool decks | random-vs-random games on the real decks with invariant checks | exit 0; 1000 games, 102070 moves, 0 cap hits, 0 failures, 103070 invariant checks, every card used, mean turns 19.72 [95% CI 19.37-20.07, n=1000]; time per game median 46.2 ms [95.4% CI 44.1-48.4, n=1000 games] |
| powershell -NoProfile -ExecutionPolicy Bypass -File scripts\bench.ps1 --games 2000 --runs 3 --pool decks | games/sec/core, one worker | exit 0; games/sec/core median 205.3 [97.3% CI 200.0-210.4, n=60 blocks]; moves per game p50 90 [95.2% CI 89-92, n=6000 games] |
| npm run lint:cr | every "CR 123.4 (topic)" citation in a code comment resolves to a rule in docs/CR.txt that mentions the topic | exit 0; 612 citations in 221 files against 3312 rules, 0 failures |
| npm run check:cards | every decklist card has a definition matching Scryfall's data and a scenario test file | exit 0; 56 of 56 cards, 64 faces, 275 scenario tests, 0 gaps |
| node dist/tools/selfplay-log.js --games 100 --a greedy --b greedy --seed 1 --out out/selfplay-100.jsonl.gz | self-play decision log, one JSON line per decision (docs/JSONL-SCHEMA.md) | exit 0; 10066 lines (9966 decision, 100 game-end), 1.3 MiB gzipped (7.4 s) |
| node dist/tools/selfplay-log.js --validate out/selfplay-100.jsonl.gz | checks a log against the schema; fails on zero lines | exit 0; 10066 lines checked, 100 games joined, 0 errors |
| npm run smoke:web | headless-browser test of the web page | exit 0; 27 checks passed (28.1 s) |
| npx playwright install chromium | the browser smoke:web needs, once per machine | exit 0 |

If PowerShell refuses npm or npx with "running scripts is disabled on this system", type npm.cmd or npx.cmd instead.

Where to read:

- PLAN.md: the plan, the card table, architecture, test plan, phase gates (section 8), every decision (section 9, D1 to D27) and the open questions for the operator (section 10).
- CHANGELOG.md: what was built per phase, measured results, fixes and known gaps.
- docs/ACCEPTANCE.md: the 1,000-games-per-side test of the searching player. docs/HAND-TOOL.md, docs/SPOT-FORMAT.md, docs/WEB-UI.md: the tools in detail. docs/JSONL-SCHEMA.md: the self-play log. docs/PERF.md: performance. docs/ENGINE-NOTES.md: the engine internals. docs/RULES-NOTES.md: rules questions settled. docs/CR.txt: the comprehensive rules text the citations are checked against (downloaded by setup, not committed).

---

## 8. Contributing: adding a card

Only the 56 cards in these two 75s are in scope (PLAN.md section 2); a card outside them needs a decklist change first. To add or change a card definition:

1. Read docs/ENGINE-NOTES.md, section 4 (Adding a card def), and the section for the card's family further down.
2. Write one file in src/cards/defs, named after the front face, built with the card DSL; import it in src/cards/index.ts and add it to CARDS.
3. Add src/test/cards/<card id>.test.ts with scenario tests (docs/ENGINE-NOTES.md section 12), citing each rule as CR number (topic).
4. Run npm run check:cards (it compares the definition with decks/oracle.json and requires the test file) and npm run verify:all.

---

Matchup Lab is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not approved or endorsed by Wizards. Card names, rules text and the comprehensive rules are the property of Wizards of the Coast; card images are served from Scryfall. The code is MIT licensed (see LICENSE).
