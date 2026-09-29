# Hand tool: keep or mulligan

The hand tool answers the friend's question 1 for deck A (Rakdos Midrange): keep this opening hand, or mulligan it? It plays the hand many times against the greedy Mono-Red agent and compares it with taking one more mulligan. Win rates reflect heuristic play, not perfect play.

## How to run it

From the project folder in PowerShell:

    scripts/hand.ps1 --hand 'Blood Crypt,Swamp,Blackcleave Cliffs,Thoughtseize,Bloodtithe Harvester,Fable of the Mirror-Breaker,Sheoldred, the Apocalypse' --play

The wrapper builds the compiled CLI first when dist is missing or older than the source, then runs it. The same command without the wrapper:

    node dist/cli/index.js hand --hand '...' --play

If PowerShell refuses to run scripts on this machine (the default policy on a fresh Windows), run the wrapper through the policy switch instead; the rest of the line is the same:

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\hand.ps1 --hand 'Blood Crypt,Swamp,Blackcleave Cliffs,Thoughtseize,Bloodtithe Harvester,Fable of the Mirror-Breaker,Sheoldred, the Apocalypse' --play

Help: scripts\hand.ps1 --help. Exit code 0 means the report was printed, 2 means bad input (the message names the problem: an unknown or illegal card, a missing --play or --draw, an unknown flag), 1 means the tool itself failed.

### Quoting the hand in PowerShell

Tested in Windows PowerShell 5.1 by src/test/cli/cli.test.ts (it runs these lines through powershell.exe and checks that all seven names arrive intact):

- Works: the whole list in single quotes, with commas, spaces, a name with a comma and a // name inside it:

      .\scripts\hand.ps1 --hand 'Blood Crypt,Swamp,Blackcleave Cliffs,Thoughtseize,Bloodtithe Harvester,Fable of the Mirror-Breaker // Reflection of Kiki-Jiki,Sheoldred, the Apocalypse' --play

- Works: the same list in double quotes ("Blood Crypt,Swamp,...").
- Works: the single-quoted list after powershell -NoProfile -ExecutionPolicy Bypass -File scripts\hand.ps1 (as above).
- Fails: no quotes. PowerShell splits Blood Crypt,Swamp at the space and turns the commas into a list of separate words, so the tool receives Blood as the hand and stops with exit code 2 and "unexpected argument". Put the quotes back.
- A card name with an apostrophe needs double quotes around the list, or the apostrophe doubled inside single quotes. No card in deck A has one.

Inputs:

- --hand: deck A card names separated by commas. Names that contain a comma (Sheoldred, the Apocalypse) are recognised; a semicolon also works as the separator, and '2 Swamp' repeats a card. Front-face names work (Fable of the Mirror-Breaker), and so do full double-faced names as the tool prints them (Fable of the Mirror-Breaker // Reflection of Kiki-Jiki), with commas or semicolons around them.
- --hand-file hand.json: the same list as a JSON array, or an object with hand and optionally bottom.
- --play or --draw: one of the two is required.
- --mulligans N: mulligans already taken (0 to 5). Give the 7 cards drawn and the tool bottoms N of them with the greedy bottoming heuristic and prints which; --bottom 'Card,...' pins them instead. A hand of 7 minus N cards counts as already bottomed; the bottomed cards are then unknown and are modeled as random cards from the rest of the deck (the output warns).
- --seed S (default 1), --workers W (default: logical cores minus one; 0 runs in one thread), --max-games N per branch (default 400), --batch N games per branch per look (default 100), --goldfish-games N (default 200), --key-cards file.json (default decks/key-cards.json), --json. --seed, --workers, --json and --help are spelled and read the same way in the spot and match commands.

A hand that is not a legal draw from decks/deckA.json (for example five Thoughtseize, or a card the list does not run) is rejected: the tool prints 'illegal hand: ...' naming each card and how many copies the list has, and exits with code 2 without simulating. Unknown card names, a misspelled flag and a word outside the quotes are errors too (exit code 2).

## What it does

1. Keep branch: greedy Rakdos keeps this hand (after bottoming, when mulligans were taken) and plays greedy Mono-Red, which gets a normal random seven and mulligans with its own rule.
2. Mulligan branch: greedy Rakdos takes one more mulligan, a fresh random seven from the whole deck, bottoms N + 1 with its heuristic, and then applies its usual keep rule (so from 7 it may go to 5).
3. Both branches run in interleaved batches on a worker pool. After each batch the tool compares the two Wilson 95 percent intervals of Rakdos's win rate. It stops with KEEP or MULLIGAN when they no longer overlap, and with TOO CLOSE TO CALL when both branches reach --max-games. Because it looks after every batch, this is a stopping rule, not a significance test.
4. Goldfish metrics for the kept hand: the average kill turn against a passive opponent (keeps seven, never plays a land, casts, attacks or blocks), the turn Rakdos won on in the real games, and how often the key cards in decks/key-cards.json were online by own turn N. Edit that file to change the key cards; no code change is needed.

Every number carries its sample size and a 95 percent interval. The speed line gives the median games/sec/core over the blocks played (one worker thread per block) with its interval, and the elapsed wall time.

Speed and the cap: a hand whose branches never separate stops at the cap, 400 games per branch by default, so the most a run plays is 1,000 games (400 keep, 400 mulligan, 200 goldfish). On the development machine (i7-13700KF) with --workers 8 that worst case took 30.2 s for the slowest documented hand (Blood Crypt, Swamp, Blackcleave Cliffs, Thoughtseize, Bloodtithe Harvester, Fable, Sheoldred on the play, held to the cap with --batch 400; it still says KEEP, 58.0% [95% CI 53.1-62.7%, n=400] against 39.0% [95% CI 34.3-43.9%, n=400]) and 26.5 s, 33.1 s and 34.2 s for a hand that runs all four looks, with the machine otherwise lightly loaded. Other work on the machine slows it: the same run took 93 to 127 s while another job held the CPU at 100 percent. The cap was 1,000 per branch until 2026-09-29, and that worst case (2,200 games) took 80.1 s and 79.6 s on 8 workers, over the one-minute target, so the cap was lowered (PLAN.md D27). A clear decision stops after one or two looks, in 10 to 20 seconds on 23 workers, whatever the cap. Raise --max-games for tighter intervals when a minute is not a limit; the intervals at 400 games are about 5 points either side.

## Example 1: a clear mulligan

A seven with no land, on the play (seed 1, rerun on 2026-09-29 after the greedy Fable fix, see CHANGELOG.md, and again with the cap of 400: same games and numbers, only the input and speed lines changed):

    scripts/hand.ps1 --hand 'Thoughtseize,Fatal Push,Bloodtithe Harvester,Fable of the Mirror-Breaker,Sheoldred, the Apocalypse,Sheoldred, the Apocalypse,Go for the Throat' --play --seed 1

    look 1: keep 8.0% [95% CI 4.1-15.0%, n=100], mulligan 34.0% [95% CI 25.5-43.7%, n=100]
    input: Rakdos Midrange (deck A) on the play, 0 mulligan(s) taken, seed 1, max 400 games per branch, batch 100
    input: hand (7 cards): Thoughtseize, Fatal Push, Bloodtithe Harvester, Fable of the Mirror-Breaker // Reflection of Kiki-Jiki, Sheoldred, the Apocalypse, Sheoldred, the Apocalypse, Go for the Throat
    input: bottom: none (no mulligan taken)
    verdict: MULLIGAN
      keep this hand: A wins 8.0% [95% CI 4.1-15.0%, n=100] vs greedy Mono-Red
      mulligan to 6: A wins 34.0% [95% CI 25.5-43.7%, n=100] vs greedy Mono-Red
    note: stopped because the intervals separated after 1 look(s) of up to 100 games per branch; the rule looks repeatedly, so it is a stopping rule, not a significance test.
    keep branch:
      kill turn vs a passive opponent (own turns): 10.46 [95% CI 10.07-10.84, n=200]
      turn A won on vs greedy Mono-Red (own turns, over A's wins): 10.25 [95% CI 8.85-11.65, n=8]
      land drop on curve: 1 land by own turn 1: 0.0% [95% CI 0.0-3.7%, n=100]
      land drop on curve: 2 lands by own turn 2: 0.0% [95% CI 0.0-3.7%, n=100]
      land drop on curve: 3 lands by own turn 3: 0.0% [95% CI 0.0-3.7%, n=100]
      land drop on curve: 4 lands by own turn 4: 0.0% [95% CI 0.0-3.7%, n=100]
      Fable of the Mirror-Breaker cast by own turn 3: 0.0% [95% CI 0.0-3.7%, n=100]
      Sheoldred, the Apocalypse cast by own turn 4: 0.0% [95% CI 0.0-3.7%, n=100]
      any removal cast by own turn 2: 33.0% [95% CI 24.6-42.7%, n=100]
      draws: 0.0% [95% CI 0.0-3.7%, n=100]
    sample: n=400 games in total (keep n=100, mulligan n=100, goldfish n=200)
    speed: median 1.33 games/sec/core [96.7% CI 1.10-1.44, n=80 blocks, one worker thread per block]; elapsed 16.8 s wall for 400 games on 23 workers
    Win rates reflect heuristic play, not perfect play.

Reading it: keeping wins 8.0 percent of games (95 percent interval 4.1 to 15.0, 100 games), going to six wins 34.0 percent (25.5 to 43.7, 100 games). The intervals do not overlap after the first batch, so the answer is MULLIGAN. Removal by turn 2 happens only when a land is drawn in time.

## Example 2: a clear keep after a mulligan

On the draw after one mulligan, the seven drawn with Swamp pinned to the bottom (seed 1, rerun on 2026-09-29 after the greedy Fable fix and with the cap of 400):

    scripts/hand.ps1 --hand 'Blood Crypt,Blackcleave Cliffs,Swamp,Fatal Push,Fatal Push,Bloodtithe Harvester,Fable of the Mirror-Breaker' --draw --mulligans 1 --bottom 'Swamp' --seed 1

    input: Rakdos Midrange (deck A) on the draw, 1 mulligan(s) taken, seed 1, max 400 games per branch, batch 100
    input: hand (7 cards): Blood Crypt, Blackcleave Cliffs, Swamp, Fatal Push, Fatal Push, Bloodtithe Harvester, Fable of the Mirror-Breaker // Reflection of Kiki-Jiki
    input: bottom: Swamp (pinned with --bottom)
    verdict: KEEP
      keep this hand: A wins 50.0% [95% CI 40.4-59.6%, n=100] vs greedy Mono-Red
      mulligan to 5: A wins 20.0% [95% CI 13.3-28.9%, n=100] vs greedy Mono-Red
    note: stopped because the intervals separated after 1 look(s) of up to 100 games per branch; the rule looks repeatedly, so it is a stopping rule, not a significance test.
    keep branch:
      kill turn vs a passive opponent (own turns): 6.03 [95% CI 5.98-6.07, n=200]
      turn A won on vs greedy Mono-Red (own turns, over A's wins): 8.02 [95% CI 7.70-8.34, n=50]
      land drop on curve: 1 land by own turn 1: 100.0% [95% CI 96.3-100.0%, n=100]
      land drop on curve: 2 lands by own turn 2: 100.0% [95% CI 96.3-100.0%, n=100]
      land drop on curve: 3 lands by own turn 3: 81.0% [95% CI 72.2-87.5%, n=100]
      land drop on curve: 4 lands by own turn 4: 44.0% [95% CI 34.7-53.8%, n=100]
      Fable of the Mirror-Breaker cast by own turn 3: 63.0% [95% CI 53.2-71.8%, n=100]
      Sheoldred, the Apocalypse cast by own turn 4: 2.0% [95% CI 0.6-7.0%, n=100]
      any removal cast by own turn 2: 87.0% [95% CI 79.0-92.2%, n=100]
      draws: 0.0% [95% CI 0.0-3.7%, n=100]
    sample: n=400 games in total (keep n=100, mulligan n=100, goldfish n=200)
    speed: median 1.25 games/sec/core [96.7% CI 1.04-1.47, n=80 blocks, one worker thread per block]; elapsed 19.4 s wall for 400 games on 23 workers
    Win rates reflect heuristic play, not perfect play.

Reading it: the six-card hand (two lands, two Fatal Push, Harvester, Fable) wins 50.0 percent (40.4 to 59.6, 100 games) against 20.0 percent (13.3 to 28.9, 100 games) for going to five, so KEEP after one look. The progress line (look 1) goes to stderr and is left out above.

## Limits

- Both players are the one-ply greedy agents of Phase 2. The numbers say how this hand does in their hands, not with perfect play or with the friend's play. Until the fix of 2026-09-29 greedy Rakdos cracked Blood tokens in its upkeep and fell a mana short of Fable on turn 3 (Fable by own turn 3 in 8.4 percent of keep-branch games with Fable and three lands in hand; 94.1 percent after the fix, both n=1000; see CHANGELOG.md, Fixed).
- The mulligan branch uses greedy's keep rule for later mulligans (keep 2 to 5 lands with a spell castable by turn 3; always keep after two mulligans).
- Game 1 only: main decks, no sideboard.
