// Headless browser smoke of the web UI (PLAN.md section 8, Phase 5 gate; docs/WEB-UI.md).
// Starts the server on a free port and drives the page in headless Chromium (Playwright, a dev
// dependency) the way a person would: the home page and its three questions, the hand flow to a
// verdict with its numbers, the board flow (cards added by clicking, a tapped land, a lore counter,
// Save and Load) to a best play with its numbers, and the match flow to a result card. Prints each
// check and the count; exits 1 on the first failure or on any page error. Screenshots at 1280 px
// width go to out/ui/.
//
//   node --import tsx scripts/web-smoke.mjs        (npm run smoke:web)
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startWebServer } from '../src/web/server.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out', 'ui');
mkdirSync(OUT, { recursive: true });

let checks = 0;
function check(ok, what) {
  if (!ok) throw new Error(`FAILED: ${what}`);
  checks++;
  console.log(`ok ${checks}: ${what}`);
}

const HEURISTIC = 'Win rates reflect heuristic play, not perfect play.';
const DETERMINIZATION = 'The search samples hidden cards; it can act as if it knew cards you have not seen.';
const shots = [];
const shot = async (page, name) => { const p = join(OUT, name); await page.screenshot({ path: p, fullPage: true }); shots.push(p); };

const { server, url } = await startWebServer(0);
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/scryfall|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 20_000 });

  // ---- home ----
  check((await page.textContent('h1')).trim() === 'Matchup Lab', 'the title is Matchup Lab');
  check((await page.textContent('.lede')).trim() === 'Rakdos Midrange vs Mono-Red Aggro (Pioneer). Ask a question, get win rates from thousands of simulated games.', 'the one-line explanation is shown');
  check(await page.locator('.caveat', { hasText: HEURISTIC }).isVisible(), 'the heuristic-play sentence is visible in the header');
  const questions = await page.locator('#view-home .q-title').allTextContents();
  check(JSON.stringify(questions) === JSON.stringify(['Should I keep this hand?', 'What is the best play on this board?', 'How does the matchup go?']), 'home shows the three question cards');
  check(await page.locator('.tip').first().getAttribute('data-tip') !== null, 'terms carry a question-mark tooltip');
  await shot(page, 'home.png');

  // ---- hand flow ----
  await page.click('#q-hand');
  await page.waitForSelector('#view-hand', { state: 'visible' });
  check(await page.locator('#view-hand').isVisible() && !(await page.locator('#view-home').isVisible()), 'clicking Should I keep this hand? opens the hand flow');
  check(await page.getAttribute('.topnav a[data-route="hand"]', 'aria-current') === 'page', 'the top nav marks the current flow');
  check((await page.textContent('#hand-result .empty-state')).startsWith('Your answer appears here'), 'the empty result says what to do next');
  await page.click('#hand-go');
  check((await page.textContent('#hand-msg')) === 'Pick 7 more cards first.', 'pressing the button too early gives a plain message');
  await page.waitForFunction(() => [...document.querySelectorAll('#hand-picker img')].every((i) => i.complete), null, { timeout: 90_000 });
  const images = await page.$$eval('#hand-picker img', (imgs) => [imgs.length, imgs.filter((i) => i.naturalWidth > 0).length]);
  check(images[0] === 25 && images[1] === images[0], `card images loaded: ${images[1]} of ${images[0]} Rakdos cards (offline, each card shows its name instead)`);
  const hand = ['Blood Crypt', 'Blackcleave Cliffs', 'Swamp', 'Fatal Push', 'Fatal Push', 'Bloodtithe Harvester', 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki'];
  for (const name of hand) await page.locator(`#hand-picker .tile[data-card="${name}"]`).click();
  check((await page.textContent('#hand-counter')) === '7 of 7' && await page.locator('#hand-cards .tile').count() === 7, 'seven clicks give a hand of 7 card images and a 7 of 7 counter');
  check(await page.locator('#hand-picker .tile[data-card="Swamp"]').isDisabled(), 'the list is disabled once the hand is full');
  await page.click('[data-mull="1"]');
  check((await page.textContent('#hand-counter')) === '7 of 6' && (await page.textContent('#hand-step1-title')) === 'Pick the six cards you kept', 'one mulligan changes the required number to 6');
  await page.click('[data-mull="0"]');
  await page.click('[data-play="draw"]');
  check(await page.getAttribute('[data-play="draw"]', 'aria-checked') === 'true', 'On the draw is selected');
  await page.click('#hand-go');
  const first = await page.waitForFunction(() => {
    if (/Games played so far: \d+ of up to \d+/.test(document.querySelector('#hand-progress')?.textContent ?? '')) return 'progress';
    return document.querySelector('#hand-verdict') ? 'verdict' : false;
  }, null, { timeout: 30_000 });
  const sawProgress = (await first.jsonValue()) === 'progress';
  await page.waitForSelector('#hand-verdict', { timeout: 180_000 });
  check(sawProgress, 'while running, the progress line counts the games played so far');
  const verdict = await page.textContent('#hand-verdict');
  check(['KEEP', 'MULLIGAN', 'TOO CLOSE TO CALL'].includes(verdict), `the giant verdict is shown (${verdict})`);
  const sentence = await page.textContent('#hand-sentence');
  check(/^Keeping wins \d+ percent of \d+ simulated games \(likely between \d+ and \d+ percent\)\. Taking a mulligan to 6 wins \d+ percent of \d+ \(likely between \d+ and \d+ percent\)\.$/.test(sentence.replace('?', '')), `the plain sentence carries both win rates with n and the range: ${sentence.replace('?', '')}`);
  await page.click('#hand-details > summary');
  const rows = await page.$$eval('#hand-metrics tbody tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)));
  check(rows.length >= 6 && rows.every((r) => /^\d+$/.test(r[3]) && (/to/.test(r[2]) || /not enough games/.test(r[2]))), `the Details table gives ${rows.length} goldfish and game metrics, each with n and a range`);
  check(await page.locator('#view-hand .footnote', { hasText: HEURISTIC }).isVisible(), 'the heuristic-play sentence is visible under the hand result');
  await shot(page, 'hand-result.png');

  // ---- board flow ----
  await page.click('.topnav a[data-route="board"]');
  await page.waitForSelector('#view-board', { state: 'visible' });
  check(await page.locator('#view-board').isVisible(), 'the top nav switches to the board flow');
  check((await page.textContent('#side-0 .zone .empty')).startsWith('Nothing here yet. Press Add a card'), 'an empty battlefield says what to do next');
  await page.click('#analyze');
  check((await page.textContent('#analyze-msg')).startsWith('Add some cards first'), 'analyzing an empty board gives a plain message');
  const add = async (p, zone, names) => {
    if (!(await page.locator(`#picker-${p}`).count())) await page.click(`#add-${p}`);
    await page.click(`#zone-${p} [data-value="${zone}"]`);
    for (const n of names) await page.locator(`#picker-${p} .tile[data-card="${n}"]`).click();
  };
  await add(0, 'battlefield', ['Blood Crypt', 'Blood Crypt', 'Swamp', 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki']);
  await add(1, 'battlefield', ['Mountain', 'Monastery Swiftspear']);
  await add(0, 'hand', ['Sheoldred, the Apocalypse', 'Fatal Push']);
  await add(1, 'hand', ['Screaming Nemesis']);
  await add(0, 'graveyard', ['Thoughtseize']);
  await add(1, 'graveyard', ['Burst Lightning']);
  check(await page.locator('#side-0 .perm').count() === 4 && await page.locator('#side-1 .perm').count() === 2, 'clicks put 4 permanents on your side and 2 on theirs, as card images');
  check((await page.locator('#picker-0 .tile[data-card="Blood Crypt"] .ct').textContent()) === '2/4', 'the Blood Crypt card counts 2 of 4 copies used');
  check(await page.locator('#side-1 [data-zone-card="Screaming Nemesis"]').count() === 1, 'a known card sits in their hand');
  await page.click('#add-0');
  await page.click('#add-1');
  await page.locator('#side-0 .perm[data-perm="Blood Crypt"] >> nth=0').locator('.face').click();
  check(await page.locator('#side-0 .perm.tapped').count() === 1, 'clicking a land image taps it (the image turns sideways)');
  await page.locator('#side-1 .perm[data-perm="Monastery Swiftspear"]').getByLabel('Summoning sick').check();
  await page.locator('#side-0 .perm[data-perm="Fable of the Mirror-Breaker // Reflection of Kiki-Jiki"] select').first().selectOption('2');
  check(await page.locator('#side-0 .perm[data-perm="Blood Crypt"] select').count() === 0 && await page.locator('#side-0 .perm[data-perm="Swamp"] .perm-opts').count() === 0, 'lands get no counter controls; the saga gets its chapter');
  const setNumber = async (sel, v) => { await page.fill(sel, v); await page.press(sel, 'Tab'); };
  await setNumber('#turn', '5');
  await page.click('#active-seg [data-value="you"]');
  await setNumber('#life-them', '14');
  await setNumber('#hidden', '4');
  await page.click('#advanced > summary');
  check(await page.getAttribute('#lib-1', 'placeholder') === 'auto: 52', 'their automatic library size is 60 - 4 placed - 4 unseen = 52 (Advanced)');
  check(await page.inputValue('#starting') === '0', 'your turn on turn 5 means you went first');
  await page.click('#advanced > summary');
  check((await page.textContent('#analyze-msg')) === '', 'the empty-board message clears once cards are added');
  await page.click('#board-title');
  await shot(page, 'board.png');

  // Save: the downloaded file is the spot format and holds the clicks.
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
  check(exported.spot === 1 && exported.turn === 5 && exported.players[1].life === 14 && exported.players[1].handHidden === 4, 'Save board writes a spot file with turn 5, them at 14 life, 4 unseen cards');
  check(exported.battlefield.some((e) => e.name === 'Blood Crypt' && e.tapped === true) && exported.battlefield.some((e) => e.name.startsWith('Fable') && e.counters?.lore === 2)
    && exported.battlefield.some((e) => e.name === 'Monastery Swiftspear' && e.sick === true), 'the file has the tapped Blood Crypt, the Fable on chapter 2 and the summoning-sick Swiftspear');

  // What should I do?
  await page.click('[data-budget="quick"]');
  await page.click('#analyze');
  await page.waitForSelector('#best-play, #board-result .error', { timeout: 120_000 });
  check(await page.locator('#board-result .error').count() === 0, 'the board analysis ran');
  check((await page.textContent('#best-play')).length > 3, `the best play is named: ${await page.textContent('#best-play')}`);
  const best = (await page.textContent('#best-sentence')).replace(/\?/g, '');
  check(/^(Rakdos|Mono-Red) wins \d+ percent of \d+ simulated games after this play \(likely between \d+ and \d+ percent\)\.$/.test(best), `the best play carries its win rate, n and range: ${best}`);
  const alts = await page.locator('#spot-lines .alt-num').allTextContents();
  check(alts.length >= 2 && alts.length <= 5 && alts.every((t) => /^wins \d+% of \d+ games \(likely \d+ to \d+%\)$/.test(t)) && await page.locator('#spot-lines .bar').count() === alts.length,
    `${alts.length} plays are compared as rows with a bar, each with its win rate, n and range`);
  check(/elapsed \d+\.\d s/.test(await page.textContent('#spot-meta')), 'the elapsed time is shown');
  check((await page.textContent('#spot-report')).startsWith('spot: (board from the web page)'), 'the full report is in the collapsed Full report');
  check(await page.locator('#view-board .footnote', { hasText: HEURISTIC }).isVisible() && await page.locator('#view-board .footnote', { hasText: DETERMINIZATION }).isVisible(), 'both sentences are visible under the board result');
  await shot(page, 'board-result.png');

  // Load a saved board: the example spot replaces the board.
  await page.setInputFiles('#import-file', join(ROOT, 'spots', 'example.json'));
  await page.waitForFunction(() => document.querySelector('#life-you')?.value === '14');
  check(await page.inputValue('#turn') === '7' && await page.inputValue('#life-them') === '13' && await page.locator('#side-0 .perm').count() === 7, 'Load a saved board reads spots/example.json (turn 7, lives 14 and 13, 7 permanents on your side)');
  check(await page.locator('[data-known="Bottom: Duress"]').count() === 1, 'fields with no basic control (a known bottom card) are kept and shown under Advanced');

  // Bad input shows a plain message.
  await page.click('#clear');
  await add(0, 'battlefield', ['Swamp']);
  await setNumber('#turn', '0');
  await page.click('#advanced > summary');
  await page.selectOption('#step', 'combatDamage');
  await page.click('#analyze');
  await page.waitForSelector('#board-result .error, #best-play', { timeout: 60_000 });
  const errPanel = await page.locator('#board-result .error').count();
  console.log(`   (turn 0 in combat damage: ${errPanel ? 'refused with: ' + (await page.textContent('#board-result .error')) : 'analyzed'})`);

  // ---- match flow ----
  await page.click('.topnav a[data-route="match"]');
  await page.waitForSelector('#view-match', { state: 'visible' });
  check(await page.locator('#view-match').isVisible(), 'the top nav switches to the match flow');
  const ests = await page.locator('#games-row .est').allTextContents();
  check(ests.length === 3 && ests.every((t) => /^about /.test(t)), `each game count shows a time estimate (${ests.join('; ')})`);
  await page.click('[data-agent="mcts"]');
  const slow = await page.locator('#games-row [data-games="100"] .est').textContent();
  await page.click('[data-agent="greedy"]');
  console.log(`   (100 games with the search-assisted computer: ${slow} on this machine)`);
  await page.click('[data-games="100"]');
  await page.click('#match-go');
  await page.waitForSelector('#match-sentence, #match-result .error', { timeout: 180_000 });
  check(await page.locator('#match-result .error').count() === 0, 'the match ran');
  const ms = (await page.textContent('#match-sentence')).replace(/\?/g, '');
  check(/^Rakdos wins \d+ percent of 100 games \(likely between \d+ and \d+ percent\)\. Mono-Red wins \d+ percent \(likely between \d+ and \d+ percent\)\.$/.test(ms), `the result card gives the win rate with n and range: ${ms}`);
  const cards = await page.locator('#match-stats .stat-card').allTextContents();
  check(cards.some((t) => t.startsWith('Average game length') && /likely [\d.]+ to [\d.]+, n = 100 games/.test(t)) && cards.some((t) => t.startsWith('Time taken')), 'average game length (with n and range) and the elapsed time are shown');
  check(cards.filter((t) => /on the (play|draw)/.test(t)).every((t) => /likely \d+ to \d+%, n = \d+ games/.test(t)), 'on the play and on the draw carry n and a range');
  check(await page.locator('#view-match .footnote', { hasText: HEURISTIC }).isVisible(), 'the heuristic-play sentence is visible under the match result');
  await shot(page, 'match-result.png');

  check(errors.length === 0, `no page errors (${errors.length}: ${errors.join(' | ')})`);
  console.log(`web smoke: ${checks} checks passed; screenshots:\n  ${shots.join('\n  ')}`);
} finally {
  await browser.close();
  server.close();
}
