// Headless browser smoke of the web UI (PLAN.md section 8, Phase 5 gate; docs/WEB-UI.md).
// Starts the server on a free port, opens the page in headless Chromium (Playwright, a dev
// dependency), builds a board by clicking card tiles, runs an analysis, reads the results panel,
// exports and re-imports JSON, then analyzes an opening hand on the Hand tab. Prints each check and
// the count; exits 1 on the first failure or on any page error. Screenshots go to out/.
//
//   node --import tsx scripts/web-smoke.mjs        (npm run smoke:web)
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startWebServer } from '../src/web/server.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });

let checks = 0;
function check(ok, what) {
  if (!ok) throw new Error(`FAILED: ${what}`);
  checks++;
  console.log(`ok ${checks}: ${what}`);
}

const HEURISTIC = 'Win rates reflect heuristic play, not perfect play.';
const DETERMINIZATION = 'The search samples hidden cards; it can act as if it knew cards the player has not seen.';

const { server, url } = await startWebServer(0);
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/scryfall|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 20_000 });

  check((await page.textContent('h1')) === 'Rakdos vs Mono-Red: position and opening-hand analyzer', 'the one-line title is shown');
  check((await page.textContent('.lede')).startsWith('Click cards to rebuild a game position'), 'the one-sentence explanation is shown');
  check(await page.locator('#deck-0 .tile').count() === 25 && await page.locator('#deck-1 .tile').count() === 16, 'both decklists render as clickable tiles (25 and 16 distinct cards)');
  // Card images come through the server's Scryfall proxy (first start: about 10 s; cached in out/card-images after).
  await page.waitForFunction(() => [...document.querySelectorAll('.deck-cols img')].every((i) => i.complete), null, { timeout: 90_000 });
  const images = await page.$$eval('.deck-cols img', (imgs) => [imgs.length, imgs.filter((i) => i.naturalWidth > 0).length]);
  check(images[1] === images[0], `card images loaded: ${images[1]} of ${images[0]} tiles (offline, a tile shows its name instead)`);

  // Build a board by clicking.
  const tile = (p, name) => page.locator(`#deck-${p} .tile[data-card="${name}"]`);
  const zone = (z) => page.check(`input[name="zone"][value="${z}"]`);
  const setNumber = async (loc, v) => { await loc.fill(v); await loc.press('Tab'); };
  await zone('battlefield');
  await tile(0, 'Blood Crypt').click();
  await tile(0, 'Blood Crypt').click();
  await tile(0, 'Swamp').click();
  await tile(0, 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki').click();
  await tile(1, 'Mountain').click();
  await tile(1, 'Monastery Swiftspear').click();
  await zone('hand');
  await tile(0, 'Sheoldred, the Apocalypse').click();
  await tile(0, 'Fatal Push').click();
  await tile(1, 'Screaming Nemesis').click();
  await zone('graveyard');
  await tile(0, 'Thoughtseize').click();
  await tile(1, 'Burst Lightning').click();
  check((await page.textContent('#player-0 .zone h3 >> nth=1')) === 'Battlefield (4)', 'player A battlefield shows the 4 clicked permanents');
  check((await page.textContent('#player-1')).includes('Known cards in hand (1 known, 7 unknown)'), 'player B hand shows 1 known and 7 unknown cards');
  check((await tile(0, 'Blood Crypt').locator('.ct').textContent()) === '2/4', 'the Blood Crypt tile counts 2 of 4 copies placed');

  // Per-permanent toggles and game state.
  await page.locator('#player-0 .perm[data-perm="Blood Crypt"] >> nth=0').getByLabel('tapped').check();
  await page.locator('#player-1 .perm[data-perm="Monastery Swiftspear"]').getByLabel('summoning sick').check();
  await setNumber(page.locator('#player-0 .perm[data-perm="Fable of the Mirror-Breaker // Reflection of Kiki-Jiki"]').getByLabel('lore'), '2');
  await setNumber(page.locator('#turn'), '5');
  await setNumber(page.locator('#life-1'), '14');
  await setNumber(page.locator('#hidden-1'), '4');
  check((await page.textContent('#handh-1')) === 'Known cards in hand (1 known, 4 unknown)' && (await page.textContent('#libtxt-1')) === 'Library size (empty = auto: 52)',
    'typing 4 unknown cards updates the hand count and the automatic library size (60 - 4 placed - 4 unknown = 52)');
  check(await page.inputValue('#active') === '0', 'turn 5 with A on the play makes A the active player');
  await page.screenshot({ path: join(OUT, 'web-smoke-board.png'), fullPage: true });

  // Export: the downloaded file is the spot format and holds the clicks.
  // Leave the last number field first. Headless Chromium scrolls back to a keyboard-focused field
  // when it loses focus, and the Export click then lands elsewhere (seen 2026-09-29).
  await page.click('h1');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
  check(exported.spot === 1 && exported.turn === 5 && exported.players[1].life === 14 && exported.players[1].handHidden === 4, 'Export JSON writes a spot file with turn 5, B at 14 life, 4 unknown cards');
  check(exported.battlefield.some((e) => e.name === 'Blood Crypt' && e.tapped === true), 'the export has a tapped Blood Crypt');
  check(exported.battlefield.some((e) => e.name.startsWith('Fable') && e.counters?.lore === 2), 'the export has the Fable on lore 2');
  check(exported.battlefield.some((e) => e.name === 'Monastery Swiftspear' && e.sick === true), 'the export has a summoning-sick Swiftspear');

  // Analyze: the results panel shows the top lines with win rate, CI, n and visits, the sentences and elapsed time.
  await page.selectOption('#budget', 'quick');
  await page.click('#analyze');
  await page.waitForSelector('#spot-lines li', { timeout: 120_000 });
  const results = await page.textContent('#spot-results');
  const lines = await page.locator('#spot-lines > li').count();
  check(lines >= 2 && lines <= 5, `the results panel lists ${lines} top lines (a choice between moves)`);
  const stats = await page.locator('#spot-lines > li > .stat').allTextContents();
  check(stats.filter((s) => s.startsWith('win ')).every((s) => /win [\d.]+% \[95% CI [\d.]+%-[\d.]+%, n=\d+ rollouts\]/.test(s)) && stats.filter((s) => s.startsWith('win ')).length === lines,
    'every top line shows win rate with a 95% CI and n rollouts');
  check(stats.filter((s) => s.startsWith('visits ')).length === lines, 'every top line shows its visits');
  check(results.includes(HEURISTIC) && results.includes(DETERMINIZATION), 'both warning sentences are shown');
  check(/elapsed \d+\.\d s/.test(results), 'the elapsed time is shown');
  const report = await page.textContent('#spot-report');
  check(report.startsWith('spot: (board from the web page)'), 'the full CLI report is available');
  await page.screenshot({ path: join(OUT, 'web-smoke-results.png'), fullPage: true });

  // Import: the example spot replaces the board.
  await page.setInputFiles('#import-file', join(ROOT, 'spots', 'example.json'));
  await page.waitForFunction(() => document.querySelector('#life-0')?.value === '14');
  check(await page.inputValue('#turn') === '7' && await page.inputValue('#life-1') === '13', 'Import JSON loads spots/example.json (turn 7, lives 14 and 13)');
  check((await page.textContent('#player-0')).includes('Known library cards (from the imported file): bottom: Duress'), 'fields without a control (known bottom) are kept and shown');

  // Bad input shows the server's message.
  await page.click('#clear');
  await page.fill('#life-0', '20');
  await tile(0, 'Swamp').click();
  await setNumber(page.locator('#turn'), '0');
  await page.selectOption('#step', 'combatDamage');
  await page.click('#analyze');
  await page.waitForSelector('#spot-results .error, #spot-lines li', { timeout: 60_000 });
  const errPanel = await page.locator('#spot-results .error').count();
  console.log(`   (turn 0 in combat damage: ${errPanel ? 'refused with: ' + (await page.textContent('#spot-results .error pre')).split('\n')[0] : 'analyzed'})`);

  // Hand tab.
  await page.click('#tab-hand');
  const hand = ['Blood Crypt', 'Blackcleave Cliffs', 'Swamp', 'Fatal Push', 'Fatal Push', 'Bloodtithe Harvester', 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki'];
  for (const name of hand) await page.locator(`#hand-deck .tile[data-card="${name}"]`).click();
  check((await page.textContent('#hand-list h3')) === 'Hand: 7 of 7 cards', 'the Hand tab takes an opening 7 by clicking');
  check(await page.locator('#hand-deck .tile[data-card="Swamp"]').isDisabled(), 'tiles are disabled once 7 cards are chosen');
  await page.selectOption('#hand-play', 'draw');
  await page.selectOption('#hand-games', '200');
  await page.click('#hand-analyze');
  await page.waitForSelector('#hand-verdict', { timeout: 180_000 });
  const verdict = await page.textContent('#hand-verdict');
  check(['KEEP', 'MULLIGAN', 'TOO CLOSE TO CALL'].includes(verdict), `the hand verdict is shown (${verdict})`);
  const handText = await page.textContent('#hand-results');
  check(/keep this hand: A wins [\d.]+% \[95% CI [\d.]+-[\d.]+%, n=\d+\]/.test(handText) && /mulligan to 6: A wins [\d.]+% \[95% CI [\d.]+-[\d.]+%, n=\d+\]/.test(handText), 'keep and mulligan win rates show a 95% CI and n');
  check(handText.includes(HEURISTIC), 'the hand result shows the heuristic-play sentence');
  await page.screenshot({ path: join(OUT, 'web-smoke-hand.png'), fullPage: true });

  check(errors.length === 0, `no page errors (${errors.length}: ${errors.join(' | ')})`);
  console.log(`web smoke: ${checks} checks passed; screenshots in out/`);
} finally {
  await browser.close();
  server.close();
}
