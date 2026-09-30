# Web UI: Matchup Lab

Matchup Lab is a page on your own computer that answers three questions about Rakdos Midrange vs Mono-Red Aggro (Pioneer) by simulating games: should I keep this hand, what is the best play on this board, and how does the matchup go. You click cards and buttons; you never write JSON or open a terminal. It runs on 127.0.0.1 only, so nobody else on your network can open it.

Win rates reflect heuristic play, not perfect play. The board search also samples the cards you cannot see, so it can act as if it knew them (docs/DEVELOPERS.md, section 'Spot analyzer: what it gets wrong').

## Start it

The easy way: double-click Launch.bat (launch.command on a Mac, or python launch.py); see README.md, 'Start here'. It sets everything up and opens the page.

From PowerShell in the project folder instead:

    scripts/web.ps1

The first start builds the project (about half a minute), then prints:

    MTG matchup web UI: open http://127.0.0.1:3456/ in your browser (Ctrl+C stops the server)

Open http://127.0.0.1:3456/. To use another port, run scripts/web.ps1 --port 4000. Ctrl+C in that window stops the server. If PowerShell refuses to run the script ('running scripts is disabled on this system'), run Set-ExecutionPolicy -Scope CurrentUser RemoteSigned once.

Card images come from Scryfall. The server downloads each image once, about ten a second so Scryfall does not refuse them, and keeps it in out/card-images, so the first start takes about 10 seconds before every picture shows. After that, pictures load at once, even offline. Without an internet connection on the first start, each card shows its name instead.

## The page

The header says Matchup Lab, one line on what it does, and the sentence Win rates reflect heuristic play, not perfect play. The home view has three question cards; Should I keep this hand? is marked Start here. The links at the top right (Keep this hand?, Best play, Matchup stats) switch between the flows at any time; the browser's Back button works too (the address ends in #/hand, #/board or #/match).

Everywhere: every number shows how many games it is based on (n) and a likely range (the 95 percent confidence interval). A small ? button next to a term (n, likely range, heuristic, determinization, rollout, priority, goldfish, mulligan) explains it on hover or keyboard focus. Card pictures show the card's name and Oracle text on hover. An empty answer box says what to do next, and a problem is explained in words (the analyzer's own reason follows). One question runs at a time; the buttons are disabled while one runs.

### Should I keep this hand?

1. Pick your seven cards. Click cards in the Rakdos Midrange list (grouped into creatures, instants and sorceries, enchantments, planeswalkers and lands; the small 3/4 on a card is how many copies are left). The hand shows as card pictures with a counter, 7 of 7. Click a card in the hand to put it back; Clear empties the hand. The hand tool analyzes deck A only.
2. Play or draw: two large buttons.
3. Mulligans already taken: 0, 1 or 2. After N mulligans step 1 asks for the 7 - N cards you kept, and the counter changes (6 of 6). More options holds two choices: enter all seven cards you drew and let the computer choose the bottom cards with its bottoming rule, and Games per choice (up to 400, the hand tool's default, or up to 1000).
4. Press Should I keep it? While it runs, a progress line counts the games played so far (updated after each batch of 100 per choice).

The result is a large KEEP, MULLIGAN or TOO CLOSE TO CALL, then one sentence with the numbers, for example: Keeping wins 58 percent of 100 simulated games (likely between 48 and 67 percent). Taking a mulligan to 6 wins 18 percent of 100 (likely between 12 and 27 percent). A second line says why (the ranges overlap or not), and any warning from the hand tool follows. Details (collapsed) is a table of the goldfish and game metrics, each with its result, 95 percent range and n: keep and mulligan win rates, draws, the kill turn against an opponent who does nothing, goldfish wins, the turn you won on against Mono-Red, and the key-card lines (land drops on curve, Fable by turn 3, Sheoldred by turn 4, removal by turn 2); then the total games and elapsed time, and the full report the hand command prints (docs/HAND-TOOL.md explains every line).

### What is the best play on this board?

The buttons at the top: Load an example board (spots/example.json, your fourth turn with Sheoldred in hand), Save board (downloads spot.json, the spot format of docs/SPOT-FORMAT.md, which the spot command also reads: scripts/spot.ps1 --file $HOME\Downloads\spot.json), Load a saved board (reads such a file; fields the page has no control for, such as the stack or effects, are kept and written back by Save), and Clear the board.

1. Your side and 2. Their side, next to each other. Each has an Add a card button that opens that deck's list as card pictures grouped by type, with a row choosing where a click puts the card: Battlefield (the default), Hand, Graveyard or Exile. Tokens (Blood, Treasure, Goblin Shaman and the others) are buttons under the list and always go on the battlefield. A card you put in their hand is one you know they hold (seen with Thoughtseize or Duress). Permanents show as small card pictures: click one to tap or untap it (the picture turns sideways). Only cards that can have them get extra controls: sagas a chapter (lore), Liliana her loyalty, double-faced cards the side that is up (a transformed Fable, a Pathway played as its red side), creatures a Summoning sick box and, under Counters, damage, +1/+1 and -1/-1 counters. Point at a card (or tab to it) to show its x, which removes it.
2. The game right now, with sensible defaults: Whose turn is it? (You or Them), What part of the turn? (Before combat = main phase 1, Combat = declare attackers, After combat = main phase 2, End of turn = end step), Turn number (both players' turns count: on the play your turns are 1, 3, 5; on the draw 2, 4, 6), Your life, Their life, Cards in their hand you have not seen, and whether a land was already played this turn. Setting whose turn it is and the turn number also sets who went first. Advanced (collapsed) holds the rest: which deck is yours (the side you see the board as), who went first, the exact step (all thirteen), who can act right now (priority), day or night, both library sizes (empty = counted for you: 60 minus every card of that player on the page, minus their unseen hand cards), both players' mulligans, cards you know on top or at the bottom of your library, a note saved with the board, and whose win rates to show.
3. How long should it think? Quick (about 1 second: 4 guesses of the hidden cards x 100 searches), Normal (about 2 seconds: 8 x 400, the same search as the spot command with --mode uct) or Deep (about 10 seconds: 16 x 2000, narrowest ranges). The times were measured on spots/example.json on the development machine (0.5 s, 1.6 s and 8.9 s, one run each); other boards and computers differ.
4. Press What should I do?

The result names the best play found (for you, or for your opponent when they are the one deciding) with a sentence such as Rakdos wins 75 percent of 212 simulated games after this play (likely between 69 and 81 percent). A simulated game here is a rollout: the game played forward two turns by the heuristic players and then scored. When the next play's range overlaps, a line says the search has not told them apart and suggests Deep. Then every play the search compared (up to five, most searched first) is a row with its name, a bar for the win rate with a line across it for the likely range, and its numbers (wins 75% of 212 games, likely 69 to 81%). A line gives all plays together with n, the number of guesses of the hidden cards and the elapsed time. Full report (collapsed) is the spot command's text, including the mean value and the most searched line after each play.

Best play found means the play the search tried most often. It is the best of the plays it compared for these heuristic players, not a proven best play. The page runs the plain search; the recommendation of the validated computer player comes from the spot command (docs/DEVELOPERS.md, 3c). Under the result: Win rates reflect heuristic play, not perfect play. The search samples hidden cards; it can act as if it knew cards you have not seen.

Small n means a wide range. When two plays' ranges overlap, the search has not told them apart.

### How does the matchup go?

1. Pick the two players: Rakdos Midrange as Computer (the greedy heuristic player) or Search-assisted computer (the validated search agent of the match command, --a mcts in its default mode); Mono-Red Aggro as Computer.
2. How many games: 100, 500 or 1000. Each shows a rough time guess for this computer, from the development machine's speed (about 0.9 thread seconds per game for two computers, about 64 with the search-assisted player; docs/ACCEPTANCE.md) divided by the number of processor threads the browser reports minus one.
3. Press Run the games. The progress line counts the games played so far.

The result card says who played, then for example Rakdos wins 50 percent of 100 games (likely between 40 and 60 percent). Mono-Red wins 50 percent (likely between 40 and 60 percent). Below: Rakdos on the play and on the draw, the average game length in turns (both players' turns counted), draws when there were any, each with its range and n, and the time taken (one run). Full report (collapsed) is the match command's text; with the search-assisted player it also shows which settings were validated and the acceptance-run numbers. Each deck is on the play in half the games (the match command's --play alternate).

## For developers

- Server: src/web/server.ts (node:http, no framework, no runtime dependency). Routes: GET / (web/index.html, web/app.js, web/style.css), GET /api/decks, GET /api/example, GET /img/<set>/<number> (the image proxy), POST /api/spot, POST /api/hand, POST /api/match and GET /api/progress. Bad input gets a 400 with {"error": message}, and a second analysis while one is running gets a 409.
- POST /api/spot takes a spot object (docs/SPOT-FORMAT.md) plus optional "player" ("A" or "B"), "budget" ("quick", "standard", "deep" or {"samples": D, "iterations": I}), "seed", "top" and "workers". It runs loadSpot, searchViewParallel and formatSpotReport, the same code as the spot command, and returns the report text, the top lines (each with the command's formatted numbers and the raw Wilson interval), the totals, the elapsed time and the two sentences.
- POST /api/hand takes {"hand": [...], "play": true or false, "mulligans": N, "bottom": [...], "maxGames": N}. It checks the hand with resolveHand, runs analyzeHand, and returns the report text and the full result.
- POST /api/match takes {"a": "greedy" | "mcts" | "random", "b": the same, "games": 1 to 2000, "seed", "workers"}. It builds the arguments with the match command's parseMatchArgs (mcts in the validated mode, --play alternate), runs runMatch (src/sim/runner.ts) and returns the aggregate (winA, winB, draws, on the play and on the draw, turns, kill turns, key cards, speed; every proportion as a Wilson interval with k and n), the match command's report text, the validation note for an mcts side, the elapsed time and the heuristic sentence.
- GET /api/progress returns the running or last analysis: {"running", "kind" ("spot", "hand" or "match"), "games" played so far, "total" (the most the run can play; null for spot), "seconds"}. The hand counts come from analyzeHand's onLook callback, the match counts from runMatch's onProgress option (called after each block of 25 games).
- web/app.js is a plain script. Its first half (window.MTGBoard) is pure state: addCard, removeCard, toSpot and fromSpot. It loads in node without a DOM, which src/test/web/server.test.ts uses. The second half renders the four views (home, hand, board, match), chosen by the address hash.
- Tests: src/test/web/server.test.ts (13 tests) covers the static files and the header, the decks, a spot fixture on worker threads, a hand fixture and a small match (every number with n and an interval, the sentences, the progress count), bad input (400 with the loader's, hand tool's or match endpoint's message), the image proxy's allow-list, the import and export round trip of spots/example.json through the loader, and a board built by clicks.
- Browser smoke: npm run smoke:web (scripts/web-smoke.mjs, Playwright headless Chromium, a dev dependency) drives the page at 1280 px: the home page and its three questions, the hand flow to a verdict (the progress line, the sentence with n and ranges, the Details table), the board flow (cards added by clicking, a tapped land, a saga chapter, a summoning-sick creature, Save and Load, a refused board) to a best play with its numbers and the compared plays, and the match flow to a result card. It prints each check and the count, and saves screenshots to out/ui/home.png, hand-result.png, board.png, board-result.png and match-result.png.
