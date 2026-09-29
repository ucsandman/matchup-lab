# Web UI: set up a board by clicking

The web UI is a page on your own computer where you build a game position or an opening hand by clicking cards, and then run the same analyzers as the spot and hand commands. You never write JSON by hand. It runs on 127.0.0.1 only, so nobody else on your network can open it.

Win rates reflect heuristic play, not perfect play. The spot search also samples the cards you cannot see, so it can act as if it knew them (README.md, section 'Spot analyzer: what it gets wrong').

## Start it

From the project folder in PowerShell:

    scripts/web.ps1

The first start builds the project (about half a minute), then prints:

    MTG matchup web UI: open http://127.0.0.1:3456/ in your browser (Ctrl+C stops the server)

Open http://127.0.0.1:3456/ in your browser. To use another port, run scripts/web.ps1 --port 4000. Press Ctrl+C in the PowerShell window to stop the server.

If PowerShell refuses to run the script ('running scripts is disabled on this system'), run this once and start again:

    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

Card images come from Scryfall. The server downloads each image once, about ten a second so Scryfall does not refuse them, and keeps it in out/card-images, so the first start takes about 10 seconds before every picture shows. After that, pictures load at once, even offline. Without an internet connection on the first start, each card still shows its name.

## The page

At the top: the title, one sentence saying what the page does, and two tabs, Board position and Opening hand: keep or mulligan?

### Board position tab

On the left are the two decklists as card tiles: Rakdos Midrange (player A) and Mono-Red Aggro (player B). Hover a tile to read the card's Oracle text. The small number in a tile's corner is how many copies are not placed yet, for example 2/4. When every copy is placed, the tile greys out.

Above the tiles, 'Clicking a card adds a copy to' picks the zone: Battlefield, Hand, Graveyard or Exile. A Rakdos tile goes to player A's zone and a Mono-Red tile goes to player B's zone. Under each list is a row of token buttons (Blood, Treasure, Goblin Shaman, ...). Tokens only go on the battlefield.

On the right:

1. Game state. 'You are' is whose eyes the position is seen through: your whole hand is known and the opponent's hand is not. 'On the play' is who took turn 1. 'Turn number' counts both players' turns: on the play your turns are 1, 3, 5 and so on, and on the draw they are 2, 4, 6. Changing the turn or who is on the play sets 'Whose turn' for you. You can still change it, and a yellow note appears when it does not match the turn number. 'Step' is the phase of the turn. 'Who has priority' is who may act now, usually the player whose turn it is. Tick the box when that player has already played a land this turn. The note is saved with the board.
2. One panel per player: life, mulligans taken and the library size. Leave the library size empty to have it counted for you: 60 minus every card of that player on the page, minus the opponent's unknown hand cards. For the opponent there is also 'Unknown cards in hand': the cards you have not seen. Cards you place in the opponent's hand are the ones you know they hold, for example ones you saw with Thoughtseize or Duress.
3. Each permanent on the battlefield has its own controls. Every permanent has 'tapped'. Creatures also have 'summoning sick' (came in this turn, or for the opponent since their last turn began), damage, and +1/+1 and -1/-1 counters. Sagas have lore (the chapter reached), planeswalkers have loyalty, and double-faced cards have a face choice (a transformed Fable, or a Pathway played as its red side). The x on a card in a hand, graveyard or exile removes it. 'Remove' takes a permanent off the battlefield.
4. Analyze this position. 'Search size' is Quick (4 samples x 100 searches each, about a second on the development machine), Standard (8 x 400, the same search as the spot command with --mode uct, a few seconds) or Deep (16 x 2000, longer). 'Show win rates for' is you by default.

Buttons:

- Analyze position: runs the search and fills the Results panel.
- Export JSON: saves the board as spot.json in your Downloads folder. The file is in the spot format of docs/SPOT-FORMAT.md, so the spot command reads it too: scripts/spot.ps1 --file $HOME\Downloads\spot.json
- Import JSON: loads a spot file. Fields the page has no control for (known library cards, the stack, effects) are kept and written back out by Export.
- Load the example board: loads spots/example.json, your fourth turn with Sheoldred in hand.
- Clear the board: starts again from an empty turn 1.

### Reading the results

The Results panel shows:

- whose win rates they are, who is deciding now, the search size, the total number of simulated games (rollouts) and the elapsed time;
- 'All moves together': the win rate over every rollout;
- the top moves, most searched first. Each has the same two lines the spot command prints: 'win 75.5% [95% CI 69.3%-80.8%, n=212 rollouts]' means 75.5 percent of the 212 simulated games through this move were wins, and the true rate for this search is likely between 69.3 and 80.8 percent. The mean value is the average score of those games with its own interval. 'visits 212 of 400, in 4 of 4 samples' says how often the search tried the move;
- 'Most searched line after it': the moves the search expected next, each with its own win rate and n;
- the two warning sentences;
- 'Full report, as the spot command prints it': the complete text.

Small n means a wide interval. When two moves' intervals overlap, the search has not told them apart: run Deep for narrower intervals.

If the analysis cannot run (a card the list does not have, too many copies, a position the analyzer cannot continue), the panel shows the reason in red, and the same message the spot command gives for a bad file.

### Opening hand tab

1. Click seven Rakdos Midrange cards. The hand tool analyzes deck A only. Click the x on a card to take it back out.
2. Choose On the play or On the draw.
3. Choose 'Mulligans already taken'. After a mulligan, tick 'bottom' on the cards you put on the bottom, or tick none and the computer picks them with its bottoming rule.
4. Choose 'Games per choice': 1000 (the default, up to about a minute) or 200 (faster, wider intervals).
5. Press Analyze hand.

The result shows KEEP, MULLIGAN or TOO CLOSE TO CALL, the win rate of keeping and of mulliganing, each with its 95 percent interval and n, the elapsed time, the warning sentence and the full report the hand command prints (docs/HAND-TOOL.md explains every line).

## For developers

- Server: src/web/server.ts (node:http, no framework, no runtime dependency). The routes are GET / (web/index.html, web/app.js, web/style.css), GET /api/decks, GET /api/example, GET /img/<set>/<number> (the image proxy), POST /api/spot and POST /api/hand. Bad input gets a 400 with {"error": message}, and a second analysis while one is running gets a 409.
- POST /api/spot takes a spot object (docs/SPOT-FORMAT.md) plus optional "player" ("A" or "B"), "budget" ("quick", "standard", "deep" or {"samples": D, "iterations": I}), "seed", "top" and "workers". It runs loadSpot, searchViewParallel and formatSpotReport, the same code as the spot command, and returns the report text, the top lines (each with the command's formatted numbers and the raw Wilson interval), the totals, the elapsed time and the two sentences.
- POST /api/hand takes {"hand": [...], "play": true or false, "mulligans": N, "bottom": [...], "maxGames": N}. It checks the hand with resolveHand, runs analyzeHand, and returns the report text and the full result.
- web/app.js is a plain script. Its first half (window.MTGBoard) is pure state: addCard, removeCard, toSpot and fromSpot. It loads in node without a DOM, which src/test/web/server.test.ts uses.
- Tests: src/test/web/server.test.ts (11 tests) covers the static files, the decks, a spot fixture on worker threads and a hand fixture (every number with n and an interval, the sentences), bad input (400 with the loader's or hand tool's message), the image proxy's allow-list, the import and export round trip of spots/example.json through the loader, and a board built by clicks.
- Browser smoke: npm run smoke:web (scripts/web-smoke.mjs, Playwright headless Chromium, a dev dependency). It builds a board by clicking, sets toggles, exports and checks the file, runs an analysis and reads the results panel, imports spots/example.json, and analyzes a hand on the Hand tab. It prints each check and the count, and saves screenshots to out/.
