// Web UI for the matchup analyzer (docs/WEB-UI.md). Plain script, no framework, no build step.
// The first half (MTGBoard) is pure state: a board, the click that adds a card, and the conversion
// to and from the spot format of docs/SPOT-FORMAT.md. It runs in node without a DOM, which the
// server test uses. The second half wires it to the page.
(function (root) {
  'use strict';

  var STEPS = [
    ['mulligan', 'Mulligan (before the game)'], ['untap', 'Untap step'], ['upkeep', 'Upkeep'], ['draw', 'Draw step'],
    ['main1', 'Main phase 1 (before combat)'], ['beginCombat', 'Beginning of combat'], ['declareAttackers', 'Declare attackers'],
    ['declareBlockers', 'Declare blockers'], ['combatDamage', 'Combat damage'], ['endCombat', 'End of combat'],
    ['main2', 'Main phase 2 (after combat)'], ['end', 'End step'], ['cleanup', 'Cleanup'],
  ];
  var ZONES = ['battlefield', 'hand', 'graveyard', 'exile'];
  var PLAYER_KEYS = ['note', 'life', 'mulligans', 'hand', 'handHidden', 'graveyard', 'exile', 'library'];
  var TOP_KEYS = ['spot', 'note', 'viewer', 'turn', 'step', 'activePlayer', 'priority', 'startingPlayer', 'players', 'battlefield', 'flags'];
  var PERM_KEYS = ['name', 'controller', 'owner', 'tapped', 'sick', 'damage', 'counters', 'lore', 'loyalty', 'face'];
  var uidSeq = 1;

  function other(p) { return p === 0 ? 1 : 0; }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function omit(obj, keys) {
    var out = {};
    Object.keys(obj || {}).forEach(function (k) { if (keys.indexOf(k) < 0) out[k] = clone(obj[k]); });
    return out;
  }

  function newPlayer(p) {
    return { life: 20, mulligans: 0, hand: [], handHidden: 7, graveyard: [], exile: [], librarySize: null, library: {}, extra: {} };
  }

  function newBoard() {
    return {
      note: '', viewer: 0, turn: 1, step: 'main1', activePlayer: 0, priority: 0, startingPlayer: 0,
      landPlayed: false, players: [newPlayer(0), newPlayer(1)], battlefield: [], flags: {}, extra: {},
    };
  }

  /** Default active player for a turn number: turn 1, 3, 5... belong to the player on the play. */
  function activeFor(turn, starting) { return turn === 0 || turn % 2 === 1 ? starting : other(starting); }

  /** The decklist card (from /api/decks) a name refers to, and the face it names. */
  function findCard(decks, name) {
    for (var d = 0; d < decks.length; d++) {
      var cards = decks[d].cards;
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        if (c.name === name) return { card: c, face: 0, deck: d };
        for (var f = 0; f < c.faces.length; f++) if (c.faces[f].name === name) return { card: c, face: c.dfc ? f : 0, deck: d };
      }
    }
    return null;
  }

  function newPermanent(info, player) {
    var c = info.card || {};
    var perm = {
      uid: uidSeq++, name: info.name, controller: player, owner: player, tapped: false, sick: false, damage: 0,
      p1p1: 0, m1m1: 0, lore: null, loyalty: null, face: 0, token: !!info.token, extra: {},
    };
    if (c.saga) perm.lore = 1;
    if (c.planeswalker && c.faces && c.faces[0].loyalty !== null) perm.loyalty = c.faces[0].loyalty;
    return perm;
  }

  /** Copies of a decklist card player p has placed in the board (every zone, known library cards too). */
  function copiesUsed(board, p, name) {
    var n = 0;
    var pl = board.players[p];
    ['hand', 'graveyard', 'exile'].forEach(function (z) { pl[z].forEach(function (e) { if (e.name === name) n++; }); });
    ['knownTop', 'knownBottom'].forEach(function (k) {
      (pl.library[k] || []).forEach(function (e) { if ((typeof e === 'string' ? e : e.name) === name) n++; });
    });
    board.battlefield.forEach(function (e) { if (!e.token && e.owner === p && e.name === name) n++; });
    return n;
  }

  /** Cards of player p outside the library (tokens excluded), the opponent's unseen hand cards included. */
  function placedOutsideLibrary(board, p) {
    var pl = board.players[p];
    var n = pl.hand.length + pl.graveyard.length + pl.exile.length;
    board.battlefield.forEach(function (e) { if (!e.token && e.owner === p) n++; });
    if (p !== board.viewer) n += pl.handHidden;
    return n;
  }

  function librarySize(board, p, deckSize) {
    var pl = board.players[p];
    return pl.librarySize === null ? deckSize - placedOutsideLibrary(board, p) : pl.librarySize;
  }

  /**
   * The click: adds a copy of a decklist card (or a token) to a zone of player p. Returns null on
   * success, or a sentence saying why the card cannot be added.
   */
  function addCard(board, info, p, zone) {
    if (ZONES.indexOf(zone) < 0) return 'unknown zone ' + zone;
    if (info.token) {
      if (zone !== 'battlefield') return 'Tokens exist only on the battlefield.';
      board.battlefield.push(newPermanent(info, p));
      return null;
    }
    var used = copiesUsed(board, p, info.name);
    if (used >= info.card.count) return 'All ' + info.card.count + ' copies of ' + info.name + ' are already placed.';
    if (zone === 'battlefield') board.battlefield.push(newPermanent(info, p));
    else board.players[p][zone].push({ uid: uidSeq++, name: info.name, extra: {} });
    return null;
  }

  function removeCard(board, uid) {
    board.battlefield = board.battlefield.filter(function (e) { return e.uid !== uid; });
    board.players.forEach(function (pl) {
      ['hand', 'graveyard', 'exile'].forEach(function (z) { pl[z] = pl[z].filter(function (e) { return e.uid !== uid; }); });
    });
  }

  function zoneEntry(e) {
    var out = Object.keys(e.extra).length ? Object.assign({ name: e.name }, clone(e.extra)) : e.name;
    return out;
  }

  function permEntry(e) {
    var out = { name: e.name, controller: e.controller };
    if (e.owner !== e.controller) out.owner = e.owner;
    if (e.tapped) out.tapped = true;
    if (e.sick) out.sick = true;
    if (e.damage > 0) out.damage = e.damage;
    if (e.face) out.face = e.face;
    var counters = clone(e.extra.counters) || {};
    if (e.p1p1 > 0) counters.p1p1 = e.p1p1;
    if (e.m1m1 > 0) counters.m1m1 = e.m1m1;
    if (e.lore !== null) counters.lore = e.lore;
    if (e.loyalty !== null) counters.loyalty = e.loyalty;
    if (Object.keys(counters).length) out.counters = counters;
    var rest = omit(e.extra, ['counters']);
    Object.keys(rest).forEach(function (k) { out[k] = rest[k]; });
    return out;
  }

  /** The board as a spot file (docs/SPOT-FORMAT.md). */
  function toSpot(board) {
    var spot = { spot: 1 };
    if (board.note) spot.note = board.note;
    spot.viewer = board.viewer;
    spot.turn = board.turn;
    spot.step = board.step;
    spot.activePlayer = board.activePlayer;
    if (board.priority !== board.activePlayer) spot.priority = board.priority;
    spot.startingPlayer = board.startingPlayer;
    spot.players = board.players.map(function (pl, p) {
      var o = {};
      Object.keys(pl.extra).forEach(function (k) { if (k === 'note') o.note = clone(pl.extra.note); });
      o.life = pl.life;
      o.mulligans = pl.mulligans;
      o.hand = pl.hand.map(zoneEntry);
      if (p !== board.viewer) o.handHidden = pl.handHidden;
      o.graveyard = pl.graveyard.map(zoneEntry);
      o.exile = pl.exile.map(zoneEntry);
      var lib = clone(pl.library) || {};
      if (p !== board.viewer) { delete lib.knownTop; delete lib.knownBottom; }
      if (pl.librarySize !== null) lib.size = pl.librarySize;
      if (Object.keys(lib).length) o.library = lib;
      Object.keys(pl.extra).forEach(function (k) { if (k !== 'note') o[k] = clone(pl.extra[k]); });
      return o;
    });
    spot.battlefield = board.battlefield.map(permEntry);
    var flags = clone(board.flags) || {};
    if (board.landPlayed) {
      var lp = [0, 0];
      lp[board.activePlayer] = 1;
      flags.landsPlayed = lp;
    } else delete flags.landsPlayed;
    if (Object.keys(flags).length) spot.flags = flags;
    Object.keys(board.extra).forEach(function (k) { spot[k] = clone(board.extra[k]); });
    return spot;
  }

  function asEntry(x) { return typeof x === 'string' ? { name: x } : x; }

  function canonical(decks, name) {
    var hit = findCard(decks, name);
    return hit ? { name: hit.card.name, face: hit.face, card: hit.card } : { name: name, face: 0, card: null };
  }

  /** A spot file (parsed JSON) as a board. Fields the page has no control for are kept and written back on export. */
  function fromSpot(json, decks) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('the file is not a spot object');
    if (json.spot !== 1) throw new Error('"spot": 1 is missing (is this a spot file? see docs/SPOT-FORMAT.md)');
    if (!Array.isArray(json.players) || json.players.length !== 2) throw new Error('"players" must list two players');
    var b = newBoard();
    b.note = typeof json.note === 'string' ? json.note : '';
    b.viewer = json.viewer === 1 ? 1 : 0;
    b.turn = Number.isInteger(json.turn) ? json.turn : 1;
    b.step = typeof json.step === 'string' ? json.step : 'main1';
    b.activePlayer = json.activePlayer === 1 ? 1 : 0;
    b.priority = json.priority === 0 || json.priority === 1 ? json.priority : b.activePlayer;
    b.startingPlayer = json.startingPlayer === 0 || json.startingPlayer === 1 ? json.startingPlayer : (b.turn === 0 || b.turn % 2 === 1 ? b.activePlayer : other(b.activePlayer));
    b.players = json.players.map(function (src, p) {
      var pl = newPlayer(p);
      pl.life = Number.isInteger(src.life) ? src.life : 20;
      pl.mulligans = Number.isInteger(src.mulligans) ? src.mulligans : 0;
      pl.handHidden = Number.isInteger(src.handHidden) ? src.handHidden : 0;
      ['hand', 'graveyard', 'exile'].forEach(function (z) {
        pl[z] = (src[z] || []).map(function (x) {
          var e = asEntry(x);
          return { uid: uidSeq++, name: canonical(decks, e.name).name, extra: omit(e, ['name']) };
        });
      });
      var lib = clone(src.library) || {};
      pl.librarySize = Number.isInteger(lib.size) ? lib.size : null;
      delete lib.size;
      pl.library = lib;
      pl.extra = omit(src, PLAYER_KEYS);
      if (typeof src.note === 'string') pl.extra.note = src.note;
      return pl;
    });
    b.battlefield = (json.battlefield || []).map(function (x) {
      var e = asEntry(x);
      var c = canonical(decks, e.name);
      var counters = clone(e.counters) || {};
      var perm = {
        uid: uidSeq++, name: c.name, controller: e.controller === 1 ? 1 : 0, owner: 0, tapped: !!e.tapped, sick: !!e.sick,
        damage: Number.isInteger(e.damage) ? e.damage : 0, p1p1: counters.p1p1 || 0, m1m1: counters.m1m1 || 0,
        lore: Number.isInteger(e.lore) ? e.lore : Number.isInteger(counters.lore) ? counters.lore : null,
        loyalty: Number.isInteger(e.loyalty) ? e.loyalty : Number.isInteger(counters.loyalty) ? counters.loyalty : null,
        face: Number.isInteger(e.face) ? e.face : c.face, token: !c.card, extra: omit(e, PERM_KEYS),
      };
      perm.owner = e.owner === 0 || e.owner === 1 ? e.owner : perm.controller;
      var rest = omit(counters, ['p1p1', 'm1m1', 'lore', 'loyalty']);
      if (Object.keys(rest).length) perm.extra.counters = rest;
      return perm;
    });
    var flags = clone(json.flags) || {};
    if (Array.isArray(flags.landsPlayed)) b.landPlayed = (flags.landsPlayed[b.activePlayer] || 0) > 0;
    delete flags.landsPlayed;
    b.flags = flags;
    b.extra = omit(json, TOP_KEYS);
    return b;
  }

  var Core = {
    STEPS: STEPS, ZONES: ZONES, newBoard: newBoard, activeFor: activeFor, findCard: findCard, addCard: addCard,
    removeCard: removeCard, copiesUsed: copiesUsed, librarySize: librarySize, toSpot: toSpot, fromSpot: fromSpot,
  };
  root.MTGBoard = Core;
  if (typeof document === 'undefined') return;

  // ---- page ------------------------------------------------------------------------------------
  // Four views on one page, switched by the address hash: #/ (home: three questions), #/hand,
  // #/board and #/match. Every result shows its numbers with n and the 95 percent interval.

  var decks = null;
  var tokens = [];
  var budgets = {};
  var board = newBoard();
  var hand = { cards: [], play: true, mull: 0 };
  var pickerOpen = [false, false];
  var pickZone = ['battlefield', 'battlefield'];
  var budgetChoice = 'quick';
  var perspective = '';
  var matchChoice = { a: 'greedy', games: 100 };
  var busy = false;
  var VIEWS = ['home', 'hand', 'board', 'match'];
  var WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
  var GROUPS = ['Creatures', 'Instants and sorceries', 'Enchantments', 'Planeswalkers', 'Lands'];
  var ZONE_LABEL = { battlefield: 'Battlefield', hand: 'Hand', graveyard: 'Graveyard', exile: 'Exile' };
  var PHASES = [['main1', 'Before combat'], ['declareAttackers', 'Combat'], ['main2', 'After combat'], ['end', 'End of turn']];
  var BUDGET_TEXT = {
    quick: ['Quick', 'About 1 second'],
    standard: ['Normal', 'About 2 seconds'],
    deep: ['Deep', 'About 10 seconds, narrowest ranges'],
  };
  var TIPS = {
    n: 'n is the number of simulated games a number is based on. Bigger n, more trustworthy number.',
    ci: 'The likely range is the 95 percent confidence interval: with this many games, the true rate is very probably inside it. When two ranges overlap, the difference between them may be luck.',
    rollout: 'Each simulated game starts from your board, is played forward by the computer players for two turns and is then scored as a win or a loss.',
    best: 'The play the search settled on: the one it tried most often. It is the best of the plays it compared for these heuristic players, not a proven best play.',
    goldfish: 'Goldfish: the hand is played against an opponent who does nothing, to see how fast it can win on its own.',
  };

  function $(id) { return document.getElementById(id); }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    });
    function add(x) {
      if (x === null || x === undefined || x === false) return;
      if (Array.isArray(x)) x.forEach(add);
      else el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x);
    }
    for (var i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  }
  function tip(label, text) { return h('button', { type: 'button', class: 'tip', 'aria-label': label, 'data-tip': text }, '?'); }
  function pc(x) { return String(Math.round(x * 100)); }
  function pct1(x) { return (x * 100).toFixed(1) + '%'; }
  function say(id, text, bad) {
    var el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'inline-msg' + (bad ? ' bad' : '');
  }
  function noImg() { this.parentNode.classList.add('no-img'); }
  function cardTip(c) {
    return c.faces.map(function (f) {
      return f.name + (f.manaCost ? '  ' + f.manaCost : '') + '\n' + f.typeLine + (f.pt ? '  ' + f.pt : '') + (f.loyalty !== null ? '  loyalty ' + f.loyalty : '') + (f.oracleText ? '\n' + f.oracleText : '');
    }).join('\n----\n');
  }
  function groupOf(c) {
    if (c.land) return 'Lands';
    if (c.creature) return 'Creatures';
    if (c.planeswalker) return 'Planeswalkers';
    if (/Instant|Sorcery/.test(c.faces[0].typeLine)) return 'Instants and sorceries';
    return 'Enchantments';
  }
  function grouped(cards, makeTile) {
    return GROUPS.map(function (g) {
      var cs = cards.filter(function (c) { return groupOf(c) === g; });
      if (!cs.length) return null;
      return h('div', { class: 'group' }, h('p', { class: 'group-title', text: g }), h('div', { class: 'tiles' }, cs.map(makeTile)));
    });
  }
  function tile(c, left, onClick, label) {
    return h('button', {
      type: 'button', class: 'tile', title: cardTip(c), 'data-card': c.name, disabled: left <= 0, onclick: onClick,
      'aria-label': (label || 'Add') + ' ' + c.frontName + ' (' + left + ' of ' + c.count + ' copies left)',
    },
    h('img', { src: c.image, alt: '', onerror: noImg }),
    h('span', { class: 'card-name', text: c.frontName }),
    h('span', { class: 'ct', text: left + '/' + c.count, title: left + ' of the ' + c.count + ' copies in the list are not used yet' }));
  }
  function seg(options, current, onPick, attrs) {
    return h('div', Object.assign({ class: 'seg', role: 'radiogroup' }, attrs || {}), options.map(function (o) {
      return h('button', { type: 'button', role: 'radio', 'aria-checked': String(o[0] === current), 'data-value': o[0], onclick: function () { onPick(o[0]); } }, o[1]);
    }));
  }
  function setRadio(container, attr, value) {
    container.querySelectorAll('[role="radio"]').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute(attr) === String(value))); });
  }

  // ---- routing ---------------------------------------------------------------------------------

  function route() {
    var r = location.hash.replace(/^#\/?/, '') || 'home';
    if (VIEWS.indexOf(r) < 0) r = 'home';
    VIEWS.forEach(function (v) { $('view-' + v).hidden = v !== r; });
    document.querySelectorAll('.topnav a').forEach(function (a) {
      if (a.getAttribute('data-route') === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.body.setAttribute('data-view', r);
    window.scrollTo(0, 0);
  }

  // ---- running a question ----------------------------------------------------------------------

  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) { var e = new Error(j.error || ('HTTP ' + res.status)); e.status = res.status; throw e; }
        return j;
      });
    }, function () { var e = new Error('offline'); e.offline = true; throw e; });
  }

  function plainProblem(msg) {
    return String(msg)
      .replace(/^spot file rejected \(\d+ problems?\):\s*/, '')
      .replace(/\bspot\.step\b/g, 'part of the turn').replace(/\bspot\.pregame\b/g, 'the pregame settings')
      .replace(/\bspot\.(\w+)\b/g, '$1').replace(/(^|\n)\s*-\s+/g, '$1').replace(/\n+/g, '. ').replace(/\s+/g, ' ').trim();
  }

  function showError(panel, e) {
    panel.textContent = '';
    var head;
    var detail;
    if (e.offline) { head = 'The page cannot reach Matchup Lab.'; detail = 'The program that does the work has stopped. Start Matchup Lab again, then reload this page.'; }
    else if (e.status === 409) { head = 'Another question is still being worked out.'; detail = 'Wait until it finishes, then press the button again.'; }
    else if (e.status === 400) { head = 'This board could not be analyzed.'; detail = 'Check: ' + plainProblem(e.message); }
    else { head = 'Something went wrong.'; detail = e.message; }
    panel.appendChild(h('div', { class: 'error', role: 'alert' }, h('strong', { text: head }), h('p', { class: 'error-detail', text: detail })));
  }

  function setBusy(on) {
    busy = on;
    ['hand-go', 'analyze', 'match-go'].forEach(function (id) { $(id).disabled = on; });
  }

  function runJob(kind, path, body, panel, show) {
    if (busy) { showError(panel, { status: 409 }); return; }
    setBusy(true);
    panel.textContent = '';
    var start = kind === 'spot' ? 'Searching' : 'Playing games';
    var line = h('p', { class: 'progress', id: kind + '-progress', text: start + '... 0 s' });
    var bar = h('div', { class: 'progress-bar' });
    panel.appendChild(line);
    panel.appendChild(h('div', { class: 'progress-track' }, bar));
    if (panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest' });
    var t0 = Date.now();
    var timer = setInterval(function () {
      var secs = Math.round((Date.now() - t0) / 1000);
      fetch('/api/progress').then(function (r) { return r.json(); }).then(function (p) {
        if (!p.running || !p.total) { line.textContent = start + '... ' + secs + ' s'; return; }
        line.textContent = 'Games played so far: ' + p.games + ' of up to ' + p.total + ' (' + secs + ' s)';
        bar.style.width = Math.min(100, Math.round(100 * p.games / p.total)) + '%';
      }).catch(function () { line.textContent = start + '... ' + secs + ' s'; });
    }, 700);
    post(path, body).then(show, function (e) { showError(panel, e); })
      .then(function () { clearInterval(timer); setBusy(false); });
  }

  function notesBox(list) {
    if (!list || !list.length) return null;
    return h('div', { class: 'notes' }, list.map(function (s) { return h('p', { text: s }); }));
  }

  // ---- hand flow -------------------------------------------------------------------------------

  function handNeeded() { return hand.mull > 0 && $('hand-all7').checked ? 7 : 7 - hand.mull; }
  function handCard(name) { return decks[0].cards.filter(function (c) { return c.name === name; })[0]; }

  function renderHandFlow() {
    var need = handNeeded();
    var n = hand.cards.length;
    $('hand-step1-title').textContent = need === 7 ? 'Pick your seven cards' : 'Pick the ' + WORD[need] + ' cards you kept';
    $('hand-step1-hint').textContent = hand.mull > 0 && need === 7
      ? 'Enter all seven cards you drew after the mulligan. The computer picks which ' + (hand.mull === 1 ? 'one' : WORD[hand.mull]) + ' to put on the bottom.'
      : 'Click the cards in your hand from the Rakdos Midrange list. Click a card in your hand to put it back.';
    var hc = $('hand-cards');
    hc.textContent = '';
    if (!n) hc.appendChild(h('p', { class: 'empty', text: 'No cards yet. Click cards in the list below to add them to your hand.' }));
    hand.cards.forEach(function (name, i) {
      var c = handCard(name);
      hc.appendChild(h('button', { type: 'button', class: 'tile', title: c.frontName + ' (click to put it back)', 'data-hand-card': c.name, 'aria-label': 'Put back ' + c.frontName, onclick: function () { hand.cards.splice(i, 1); say('hand-msg', ''); renderHandFlow(); } },
        h('img', { src: c.image, alt: '', onerror: noImg }), h('span', { class: 'card-name', text: c.frontName })));
    });
    var counter = $('hand-counter');
    counter.textContent = n + ' of ' + need;
    counter.className = 'counter' + (n === need ? ' full' : '');
    var picker = $('hand-picker');
    picker.textContent = '';
    grouped(decks[0].cards, function (c) {
      var used = hand.cards.filter(function (x) { return x === c.name; }).length;
      var t = tile(c, c.count - used, function () {
        if (hand.cards.length >= handNeeded()) return;
        hand.cards.push(c.name);
        say('hand-msg', '');
        renderHandFlow();
      });
      if (n >= need) t.disabled = true;
      return t;
    }).forEach(function (g) { if (g) picker.appendChild(g); });
    if (n > need) say('hand-msg', 'That is ' + (n - need) + ' card' + (n - need === 1 ? '' : 's') + ' too many for ' + hand.mull + ' mulligan' + (hand.mull === 1 ? '' : 's') + ': click a card in your hand to put it back.', true);
  }

  function goHand() {
    var need = handNeeded();
    var n = hand.cards.length;
    if (n !== need) {
      say('hand-msg', n < need ? 'Pick ' + (need - n) + ' more card' + (need - n === 1 ? '' : 's') + ' first.' : 'That is ' + (n - need) + ' card' + (n - need === 1 ? '' : 's') + ' too many: click a card in your hand to put it back.', true);
      return;
    }
    say('hand-msg', '');
    var games = document.querySelector('input[name="hand-games"]:checked');
    runJob('hand', '/api/hand', { hand: hand.cards.slice(), play: hand.play, mulligans: hand.mull, maxGames: games ? parseInt(games.value, 10) : 400 }, $('hand-result'), showHand);
  }

  function rangeCell(lo, hi, digits) {
    return digits === 'pct' ? pct1(lo) + ' to ' + pct1(hi) : lo.toFixed(1) + ' to ' + hi.toFixed(1);
  }
  function meanRow(label, m, unit) {
    if (m.n < 2) return h('tr', null, h('td', { text: label }), h('td', { class: 'cell-num', text: m.n === 1 ? m.mean.toFixed(1) + ' ' + unit : 'none' }), h('td', { class: 'cell-num', text: 'not enough games for a range' }), h('td', { class: 'cell-num', text: String(m.n) }));
    return h('tr', null, h('td', { text: label }), h('td', { class: 'cell-num', text: m.mean.toFixed(1) + ' ' + unit }), h('td', { class: 'cell-num', text: rangeCell(m.lo, m.hi) }), h('td', { class: 'cell-num', text: String(m.n) }));
  }
  function propRow(label, p) {
    return h('tr', null, h('td', { text: label }), h('td', { class: 'cell-num', text: pct1(p.est) }), h('td', { class: 'cell-num', text: rangeCell(p.lo, p.hi, 'pct') }), h('td', { class: 'cell-num', text: String(p.n) }));
  }

  function showHand(r) {
    var res = r.result;
    var panel = $('hand-result');
    panel.textContent = '';
    var k = res.keep.win;
    var m = res.mulligan.win;
    var next = 7 - res.input.mulligans - 1;
    var cls = res.verdict === 'KEEP' ? 'keep' : res.verdict === 'MULLIGAN' ? 'mull' : 'close';
    panel.appendChild(h('p', { class: 'verdict ' + cls, id: 'hand-verdict', text: res.verdict }));
    panel.appendChild(h('p', { class: 'big-sentence', id: 'hand-sentence' },
      'Keeping wins ' + pc(k.est) + ' percent of ' + k.n + ' simulated games (likely between ' + pc(k.lo) + ' and ' + pc(k.hi) + ' percent). ',
      'Taking a mulligan to ' + next + ' wins ' + pc(m.est) + ' percent of ' + m.n + ' (likely between ' + pc(m.lo) + ' and ' + pc(m.hi) + ' percent).',
      tip('What is the likely range?', TIPS.ci)));
    var why = res.verdict === 'TOO CLOSE TO CALL'
      ? 'The two likely ranges still overlap after ' + Math.min(k.n, m.n) + ' games each, so the difference is too small to call. Either choice is reasonable.'
      : 'The two likely ranges do not overlap, so ' + (res.verdict === 'KEEP' ? 'keeping' : 'a mulligan') + ' does clearly better against the computer Mono-Red player.';
    panel.appendChild(h('p', { class: 'subtle', text: why + ' ' + (res.input.onThePlay ? 'On the play' : 'On the draw') + ', ' + res.input.mulligans + ' mulligan' + (res.input.mulligans === 1 ? '' : 's') + ' taken' + (res.input.bottomSource === 'greedy' ? '; the computer put ' + res.input.bottom.join(', ') + ' on the bottom' : '') + '.' }));
    res.warnings.forEach(function (w) { panel.appendChild(h('p', { class: 'warn', text: w })); });
    var rows = [
      propRow('Keep: win rate against Mono-Red', k),
      propRow('Mulligan to ' + next + ': win rate', m),
      propRow('Keep: games drawn', res.keep.draws),
      meanRow('Turn the hand wins by against an opponent who does nothing (goldfish)', res.goldfishKillTurn, 'turns'),
      propRow('Goldfish: games won', res.goldfishWin),
      meanRow('Turn you won on against Mono-Red, when you won', res.keepWinTurn, 'turns'),
    ].concat(res.keyCards.map(function (kc) { return propRow('Keep: ' + kc.label, kc.p); }));
    panel.appendChild(h('details', { id: 'hand-details' }, h('summary', { text: 'Details' }),
      h('p', { class: 'subtle' }, 'Turns count your own turns; in the two turn rows, n is the number of games won. Goldfish', tip('What is goldfish?', TIPS.goldfish)),
      h('table', { class: 'metrics', id: 'hand-metrics' },
        h('thead', null, h('tr', null, h('th', { text: 'What' }), h('th', { text: 'Result' }), h('th', null, 'Likely range (95%)'), h('th', null, 'n (games)'))),
        h('tbody', null, rows)),
      h('p', { class: 'subtle', text: res.games + ' simulated games in total, ' + res.seconds.toFixed(1) + ' s (one run).' }),
      h('details', null, h('summary', { text: 'Full report (as the hand command prints it)' }), h('pre', { id: 'hand-report', text: r.report }))));
  }

  // ---- board flow ------------------------------------------------------------------------------

  function you() { return board.viewer; }
  function them() { return other(board.viewer); }
  function whoName(p) { return p === board.viewer ? 'You' : 'Them'; }

  function miniView(e, p) {
    var hit = findCard(decks, e.name);
    var c = hit ? hit.card : null;
    return h('div', { class: 'mini', title: c ? cardTip(c) : e.name, 'data-zone-card': e.name },
      h('img', { class: 'card-img', src: c ? c.image : '', alt: e.name, onerror: noImg }),
      h('span', { class: 'card-name', text: c ? c.frontName : e.name }),
      h('button', { type: 'button', class: 'x', 'aria-label': 'Remove ' + e.name, title: 'Remove', onclick: function () { removeCard(board, e.uid); renderBoard(); } }, '×'));
  }

  function numField(label, value, min, max, onChange, attrs) {
    return h('label', null, label, h('input', Object.assign({ type: 'number', min: min, max: max, step: 1, value: value, onchange: function () {
      var n = parseInt(this.value, 10);
      if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
    } }, attrs || {})));
  }

  function permView(e) {
    var hit = findCard(decks, e.name);
    var c = hit ? hit.card : null;
    var tok = c ? null : tokens.filter(function (t) { return t.name === e.name; })[0];
    var face = c && c.faces[e.face] ? c.faces[e.face] : null;
    var creature = face ? /Creature/.test(face.typeLine) : tok ? tok.creature : false;
    var name = face ? face.name : e.name;
    var art = c
      ? [h('img', { src: e.face === 1 && c.backImage ? c.backImage : c.image, alt: '', onerror: noImg }), h('span', { class: 'card-name', text: name })]
      : h('span', { class: 'token-face' }, h('span', { class: 'card-name', text: name + (tok && tok.pt ? ' ' + tok.pt : '') + ' token' }));
    var faceBtn = h('button', {
      type: 'button', class: 'face', 'aria-pressed': String(e.tapped),
      'aria-label': name + (e.tapped ? ', tapped. Click to untap.' : '. Click to tap.'),
      title: (c ? cardTip(c) : name + ' token') + '\n\nClick to ' + (e.tapped ? 'untap' : 'tap'),
      onclick: function () { e.tapped = !e.tapped; renderSides(); },
    }, art);
    var opts = [];
    if (e.tapped) opts.push(h('span', { class: 'tapped-label', text: 'Tapped' }));
    if (c && c.saga && e.face === 0) {
      opts.push(h('label', { title: 'Lore counters: the chapter the saga has reached' }, 'Chapter',
        h('select', { onchange: function () { e.lore = parseInt(this.value, 10); } },
          [1, 2, 3].map(function (i) { return h('option', { value: i, selected: (e.lore === null ? 1 : e.lore) === i }, ['I', 'II', 'III'][i - 1]); }))));
    }
    if (c && c.planeswalker) opts.push(numField('Loyalty', e.loyalty === null ? 0 : e.loyalty, 0, 99, function (n) { e.loyalty = n; }));
    if (c && c.dfc) {
      opts.push(h('label', { title: 'Which side is up: a transformed card, or the side a Pathway was played as. Front: ' + c.faces[0].name + '. Back: ' + (c.faces[1] ? c.faces[1].name : '') },
        'Side',
        h('select', { 'aria-label': 'Which side is up', onchange: function () {
          e.face = parseInt(this.value, 10);
          if (e.face !== 0) e.lore = null; else if (c.saga && e.lore === null) e.lore = 1;
          renderSides();
        } }, c.faces.map(function (f, i) { return h('option', { value: i, selected: i === e.face, title: f.name }, (i === 0 ? 'Front' : 'Back') + ': ' + f.name); }))));
    }
    if (creature) {
      opts.push(h('label', { title: 'Summoning sick: it came in this turn (for the opponent: since their last turn began), so it cannot attack or tap yet' },
        h('input', { type: 'checkbox', checked: e.sick, onchange: function () { e.sick = this.checked; } }), 'Summoning sick'));
      opts.push(h('details', { open: e.damage > 0 || e.p1p1 > 0 || e.m1m1 > 0 }, h('summary', { text: 'Counters, damage' }),
        numField('+1/+1', e.p1p1, 0, 99, function (n) { e.p1p1 = n; }),
        numField('-1/-1', e.m1m1, 0, 99, function (n) { e.m1m1 = n; }),
        numField('Damage', e.damage, 0, 99, function (n) { e.damage = n; })));
    }
    return h('div', { class: 'perm' + (e.tapped ? ' tapped' : ''), 'data-perm': e.name },
      h('button', { type: 'button', class: 'x', 'aria-label': 'Remove ' + name, title: 'Remove from the battlefield', onclick: function () { removeCard(board, e.uid); renderBoard(); } }, '×'),
      faceBtn, opts.length ? h('div', { class: 'perm-opts' }, opts) : null);
  }

  function pickerView(p) {
    var d = decks[p];
    var cards = grouped(d.cards, function (c) {
      return tile(c, c.count - copiesUsed(board, p, c.name), function () {
        var err = addCard(board, { name: c.name, card: c }, p, pickZone[p]);
        renderBoard();
        say('pick-msg-' + p, err || 'Added ' + c.frontName + ' to ' + (p === you() ? 'your ' : 'their ') + pickZone[p] + '.', !!err);
      });
    });
    return h('div', { class: 'picker', id: 'picker-' + p },
      h('div', { class: 'picker-top' },
        h('span', null, 'Clicking a card puts it in: '),
        seg(['battlefield', 'hand', 'graveyard', 'exile'].map(function (z) { return [z, ZONE_LABEL[z]]; }), pickZone[p], function (z) { pickZone[p] = z; renderSides(); }, { 'aria-label': 'Where a clicked card goes', id: 'zone-' + p })),
      h('p', { class: 'inline-msg', id: 'pick-msg-' + p, role: 'status' }),
      cards,
      h('div', { class: 'group' }, h('p', { class: 'group-title', text: 'Tokens (always go on the battlefield)' }),
        h('div', { class: 'token-btns' }, tokens.map(function (t) {
          return h('button', { type: 'button', class: 'small', title: t.typeLine + (t.pt ? ' ' + t.pt : ''), 'data-token': t.name, onclick: function () {
            var err = addCard(board, { name: t.name, token: true, card: { creature: t.creature } }, p, 'battlefield');
            renderBoard();
            say('pick-msg-' + p, err || 'Added a ' + t.name + ' token.', !!err);
          } }, '+ ' + t.name);
        }))));
  }

  function zoneView(title, list, empty, extra) {
    return h('div', { class: 'zone' }, h('h4', null, title + ' (' + list.length + ')', extra || null),
      list.length ? h('div', { class: 'zone-cards' }, list) : h('p', { class: 'empty', text: empty }));
  }

  function sidePanel(p, idx) {
    var isYou = p === you();
    var pl = board.players[p];
    var perms = board.battlefield.filter(function (e) { return e.controller === p; });
    return h('section', { class: 'side', id: 'side-' + p, 'data-side': isYou ? 'you' : 'them', 'aria-label': isYou ? 'Your side' : 'Their side' },
      h('div', { class: 'side-head' },
        h('h3', null, h('span', { class: 'num', 'aria-hidden': 'true', text: String(idx + 1) }), isYou ? 'Your side' : 'Their side', h('span', { class: 'side-deck', text: decks[p].archetype })),
        h('button', { type: 'button', id: 'add-' + p, class: 'add-card', 'aria-expanded': String(pickerOpen[p]), 'aria-controls': 'picker-' + p, onclick: function () { pickerOpen[p] = !pickerOpen[p]; renderSides(); } },
          pickerOpen[p] ? 'Done adding' : 'Add a card')),
      pickerOpen[p] ? pickerView(p) : null,
      zoneView('Battlefield', perms.map(permView), isYou ? 'Nothing here yet. Press Add a card to put your lands and creatures on the table.' : 'Nothing here yet. Press Add a card to put their permanents on the table.',
        perms.length ? h('span', { class: 'zone-hint', text: 'click a card to tap or untap it' }) : null),
      zoneView(isYou ? 'Your hand' : 'Cards you know are in their hand', pl.hand.map(function (e) { return miniView(e, p); }), isYou ? 'Empty. Add the cards in your hand: the search picks from them.' : 'None known. Their unseen cards are set in step 3.',
        isYou ? null : tip('What is a known card?', 'A card you have seen in their hand, for example with Thoughtseize or Duress. Their other cards are guessed from their decklist.')),
      zoneView('Graveyard', pl.graveyard.map(function (e) { return miniView(e, p); }), 'Empty.'),
      zoneView('Exile', pl.exile.map(function (e) { return miniView(e, p); }), 'Empty.'));
  }

  function renderSides() {
    var host = $('sides');
    host.textContent = '';
    host.appendChild(sidePanel(you(), 0));
    host.appendChild(sidePanel(them(), 1));
  }

  function librarySizeText(p) { return String(librarySize(board, p, decks[p].size)); }

  function updateDerived() {
    $('land-played-text').textContent = (board.activePlayer === you() ? 'You have' : 'They have') + ' already played a land this turn';
    [0, 1].forEach(function (p) {
      var input = $('lib-' + p);
      if (input) input.placeholder = 'auto: ' + librarySizeText(p);
    });
    var w = $('turn-warning');
    var expect = activeFor(board.turn, board.startingPlayer);
    if (board.turn > 0 && expect !== board.activePlayer) {
      w.hidden = false;
      w.textContent = 'Turn ' + board.turn + ' would normally be ' + (expect === you() ? 'your' : 'their') + ' turn, given who went first. Check the turn number or Who went first under Advanced.';
    } else w.hidden = true;
  }

  /** Makes who went first agree with the turn number and whose turn it is (turns 1, 3, 5 belong to the player who went first). */
  function syncStarting() {
    if (board.turn > 0) board.startingPlayer = board.turn % 2 === 1 ? board.activePlayer : other(board.activePlayer);
  }

  function renderGame() {
    var segHost = $('active-seg');
    segHost.textContent = '';
    [[you(), 'You'], [them(), 'Them']].forEach(function (o) {
      segHost.appendChild(h('button', { type: 'button', role: 'radio', 'aria-checked': String(board.activePlayer === o[0]), 'data-value': o[1].toLowerCase(), onclick: function () {
        board.activePlayer = o[0];
        board.priority = o[0];
        syncStarting();
        renderGame();
        renderAdvanced();
      } }, o[1]));
    });
    var ph = $('phase');
    ph.textContent = '';
    PHASES.forEach(function (x) { ph.appendChild(h('option', { value: x[0], selected: board.step === x[0] }, x[1])); });
    if (!PHASES.some(function (x) { return x[0] === board.step; })) {
      var label = STEPS.filter(function (s) { return s[0] === board.step; })[0];
      ph.appendChild(h('option', { value: board.step, selected: true }, (label ? label[1] : board.step) + ' (set under Advanced)'));
    }
    $('turn').value = String(board.turn);
    $('life-you').value = String(board.players[you()].life);
    $('life-them').value = String(board.players[them()].life);
    $('hidden').value = String(board.players[them()].handHidden);
    $('land-played').checked = board.landPlayed;
    updateDerived();
  }

  function advSelect(label, id, options, value, onChange, tipNode) {
    return h('div', { class: 'field' }, h('label', { class: 'field-label', for: id }, label, tipNode || null),
      h('select', { id: id, onchange: function () { onChange(this.value); } }, options.map(function (o) { return h('option', { value: o[0], selected: String(o[0]) === String(value) }, o[1]); })));
  }

  function renderAdvanced() {
    var host = $('advanced-fields');
    host.textContent = '';
    var mine = board.players[you()];
    var lib = mine.library;
    var known = [];
    (lib.knownTop || []).forEach(function (x, i) { known.push(['knownTop', i, 'Top: ' + (typeof x === 'string' ? x : x.name)]); });
    (lib.knownBottom || []).forEach(function (x, i) { known.push(['knownBottom', i, 'Bottom: ' + (typeof x === 'string' ? x : x.name)]); });
    var addSel = h('select', { id: 'known-card', 'aria-label': 'Card you know in your library' }, decks[you()].cards.map(function (c) { return h('option', { value: c.name }, c.frontName); }));
    function addKnown(where) {
      var c = findCard(decks, addSel.value).card;
      if (copiesUsed(board, you(), c.name) >= c.count) { say('known-msg', 'All ' + c.count + ' copies of ' + c.frontName + ' are already placed.', true); return; }
      lib[where] = (lib[where] || []).concat([c.name]);
      renderAdvanced();
      renderSides();
      updateDerived();
    }
    host.appendChild(h('div', { class: 'adv-group' }, h('h4', { text: 'Players and turn' }), h('div', { class: 'fields' },
      advSelect('Which deck is yours?', 'viewer', [[0, 'Rakdos Midrange'], [1, 'Mono-Red Aggro']], board.viewer, function (v) { board.viewer = parseInt(v, 10); renderBoard(); }),
      advSelect('Who went first?', 'starting', [[you(), 'You'], [them(), 'Them']], board.startingPlayer, function (v) {
        board.startingPlayer = parseInt(v, 10);
        board.activePlayer = activeFor(board.turn, board.startingPlayer);
        board.priority = board.activePlayer;
        renderGame();
        renderAdvanced();
      }),
      advSelect('Exact step', 'step', STEPS, board.step, function (v) { board.step = v; renderGame(); }),
      advSelect('Who can act right now?', 'priority', [[you(), 'You'], [them(), 'Them']], board.priority, function (v) { board.priority = parseInt(v, 10); },
        tip('What is priority?', 'Priority: the player who may cast a spell or use an ability right now. Usually the player whose turn it is.')),
      advSelect('Day or night', 'daynight', [['none', 'Neither'], ['day', 'Day'], ['night', 'Night']], board.extra.dayNight || 'none', function (v) {
        if (v === 'none') delete board.extra.dayNight; else board.extra.dayNight = v;
      }),
      advSelect('Show win rates for', 'perspective', [['', 'You'], ['A', 'Rakdos Midrange'], ['B', 'Mono-Red Aggro']], perspective, function (v) { perspective = v; }))));
    host.appendChild(h('div', { class: 'adv-group' }, h('h4', { text: 'Libraries and mulligans' }), h('div', { class: 'fields' },
      [you(), them()].map(function (p) {
        var pl = board.players[p];
        return [
          h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'lib-' + p }, (p === you() ? 'Your' : 'Their') + ' library size'),
            h('input', { type: 'number', min: 0, max: 60, id: 'lib-' + p, value: pl.librarySize === null ? '' : pl.librarySize, placeholder: 'auto: ' + librarySizeText(p), onchange: function () {
              var n = parseInt(this.value, 10);
              pl.librarySize = isNaN(n) ? null : Math.max(0, n);
              updateDerived();
            } })),
          h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'mull-' + p }, (p === you() ? 'Your' : 'Their') + ' mulligans'),
            h('input', { type: 'number', min: 0, max: 7, id: 'mull-' + p, value: pl.mulligans, onchange: function () { var n = parseInt(this.value, 10); if (!isNaN(n)) pl.mulligans = Math.max(0, Math.min(7, n)); } })),
        ];
      }))));
    host.appendChild(h('div', { class: 'adv-group' }, h('h4', null, 'Cards you know in your library', tip('Known library cards', 'Cards you know are on top of your library (kept after a scry) or at the bottom (put there after a mulligan or a scry).')),
      known.length ? h('div', { class: 'zone-cards' }, known.map(function (k) {
        return h('span', { class: 'button small', 'data-known': k[2] }, k[2], h('button', { type: 'button', class: 'small', 'aria-label': 'Remove ' + k[2], onclick: function () { lib[k[0]].splice(k[1], 1); if (!lib[k[0]].length) delete lib[k[0]]; renderAdvanced(); renderSides(); updateDerived(); } }, '×'));
      })) : h('p', { class: 'empty', text: 'None.' }),
      h('div', { class: 'toolbar' }, addSel,
        h('button', { type: 'button', class: 'small', onclick: function () { addKnown('knownTop'); } }, 'Add to top'),
        h('button', { type: 'button', class: 'small', onclick: function () { addKnown('knownBottom'); } }, 'Add to bottom')),
      h('p', { class: 'inline-msg', id: 'known-msg', role: 'status' })));
    host.appendChild(h('div', { class: 'adv-group' }, h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'note' }, 'Note (saved with the board)'),
      h('input', { id: 'note', type: 'text', maxlength: 400, value: board.note, placeholder: 'for example: my turn 4, Sheoldred now or hold up removal?', onchange: function () { board.note = this.value; } }))));
  }

  function renderBudgets() {
    var row = $('budget-row');
    row.textContent = '';
    Object.keys(budgets).forEach(function (k) {
      var t = BUDGET_TEXT[k] || [k, ''];
      var b = budgets[k];
      row.appendChild(h('button', { type: 'button', role: 'radio', class: 'big-toggle', 'data-budget': k, 'aria-checked': String(k === budgetChoice), title: b.label, onclick: function () { budgetChoice = k; setRadio(row, 'data-budget', k); } },
        t[0], h('small', { text: t[1] }), h('small', { text: b.samples + ' guesses of hidden cards, ' + b.iterations + ' searches each' })));
    });
  }

  function renderBoard() {
    if (!boardIsEmpty()) say('analyze-msg', '');
    renderSides();
    renderGame();
    renderAdvanced();
  }

  function boardIsEmpty() {
    return !board.battlefield.length && board.players.every(function (pl) { return !pl.hand.length && !pl.graveyard.length && !pl.exile.length; });
  }

  function analyzeBoard() {
    if (boardIsEmpty()) { say('analyze-msg', 'Add some cards first (press Add a card on your side), or load the example board.', true); return; }
    say('analyze-msg', '');
    var body = toSpot(board);
    body.budget = budgetChoice;
    if (perspective) body.player = perspective;
    runJob('spot', '/api/spot', body, $('board-result'), showSpot);
  }

  function showSpot(r) {
    var panel = $('board-result');
    panel.textContent = '';
    var deck = function (L) { return L === 'A' ? 'Rakdos' : 'Mono-Red'; };
    var plain = function (t) {
      var s = t.replace(/^[AB]: /, '').replace(/\((A|B)\)/g, function (_, L) { return L === r.viewer ? '(yours)' : '(theirs)'; }).replace(/ -> /g, ' → ');
      return s.charAt(0).toUpperCase() + s.slice(1);
    };
    if (r.decider === null || !r.lines.length) {
      panel.appendChild(h('p', { class: 'big-sentence', text: 'There is nothing to decide here: the game is over in this position.' }));
      return;
    }
    var top = r.lines[0];
    var forWhom = r.decider === r.viewer ? 'you' : 'your opponent';
    panel.appendChild(h('p', { class: 'best-label' }, 'Best play found for ' + forWhom, tip('What does best play mean here?', TIPS.best)));
    panel.appendChild(h('p', { class: 'best-play', id: 'best-play', title: top.move, text: plain(top.move) }));
    panel.appendChild(h('p', { class: 'big-sentence', id: 'best-sentence' },
      deck(r.perspective) + ' wins ' + pc(top.win.est) + ' percent of ' + top.win.n + ' simulated games after this play (likely between ' + pc(top.win.lo) + ' and ' + pc(top.win.hi) + ' percent).',
      tip('What is a simulated game here?', TIPS.rollout), tip('What is the likely range?', TIPS.ci)));
    var second = r.lines[1];
    if (r.rootMoves === 1) panel.appendChild(h('p', { class: 'subtle', text: 'This is the only legal play here.' }));
    else if (second && second.win.hi >= top.win.lo) panel.appendChild(h('p', { class: 'subtle', text: 'The next play\'s likely range overlaps this one, so the search has not clearly told them apart. Deep search gives narrower ranges.' }));
    panel.appendChild(h('h3', { text: 'The plays it compared (' + r.lines.length + ' of ' + r.rootMoves + ' possible, most searched first)' }));
    panel.appendChild(h('ol', { class: 'alts', id: 'spot-lines' }, r.lines.map(function (l, i) {
      var w = l.win;
      return h('li', { class: 'alt' + (i === 0 ? ' best' : '') },
        h('span', { class: 'alt-move', title: l.move, text: plain(l.move) + (i === 0 ? ' (best found)' : '') }),
        h('span', { class: 'bar', role: 'img', 'aria-label': pc(w.est) + ' percent, likely between ' + pc(w.lo) + ' and ' + pc(w.hi) },
          h('span', { class: 'bar-fill', style: 'width:' + (w.est * 100).toFixed(1) + '%' }),
          h('span', { class: 'bar-range', style: 'left:' + (w.lo * 100).toFixed(1) + '%;width:' + ((w.hi - w.lo) * 100).toFixed(1) + '%' })),
        h('span', { class: 'alt-num', text: 'wins ' + pc(w.est) + '% of ' + w.n + ' games (likely ' + pc(w.lo) + ' to ' + pc(w.hi) + '%)' }));
    })));
    panel.appendChild(h('p', { class: 'subtle', id: 'spot-meta', text: 'Win rates are for ' + deck(r.perspective) + '. All plays together: ' + pc(r.total.win.est) + '% of ' + r.total.win.n + ' simulated games (likely ' + pc(r.total.win.lo) + ' to ' + pc(r.total.win.hi) + '%), over ' + r.samples + ' guesses of the hidden cards; ' + r.elapsed + '.' }));
    panel.appendChild(h('details', { id: 'spot-details' }, h('summary', { text: 'Full report' }),
      h('p', { class: 'subtle', text: 'Each play with its win rate, 95 percent interval and n, the mean value of its simulated games, and the line the search expected after it.' }),
      h('pre', { id: 'spot-report', text: r.report })));
  }

  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        board = fromSpot(JSON.parse(String(reader.result)), decks);
        renderBoard();
        say('board-msg', 'Loaded ' + file.name + '.');
      } catch (e) { say('board-msg', 'That file could not be loaded (' + e.message + '). Pick a file saved with Save board.', true); }
    };
    reader.readAsText(file);
  }

  function exportFile() {
    var blob = new Blob([JSON.stringify(toSpot(board), null, 2) + '\n'], { type: 'application/json' });
    var a = h('a', { href: URL.createObjectURL(blob), download: 'spot.json' });
    document.body.appendChild(a);
    a.click();
    // Revoking at once can cancel the download before the browser has read the blob.
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
    say('board-msg', 'Saved as spot.json in your Downloads folder. Load a saved board opens it again.');
  }

  // ---- match flow ------------------------------------------------------------------------------

  // Thread seconds per game on the development machine (README section 6, docs/ACCEPTANCE.md): about
  // 0.9 for two computer players, about 64 with the search-assisted player. A rough guess, shown as such.
  function estimate(agent, games) {
    var cores = Math.max(1, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 1);
    var secs = games * (agent === 'mcts' ? 64 : 0.9) / cores;
    if (secs < 60) return 'about ' + Math.max(5, Math.round(secs / 5) * 5) + ' seconds';
    if (secs < 3600) return 'about ' + Math.round(secs / 60) + ' minute' + (Math.round(secs / 60) === 1 ? '' : 's');
    var hrs = secs / 3600;
    return 'about ' + (hrs < 1.5 ? 'an hour' : Math.round(hrs) + ' hours');
  }
  function renderMatch() {
    setRadio($('agent-row'), 'data-agent', matchChoice.a);
    setRadio($('games-row'), 'data-games', matchChoice.games);
    $('games-row').querySelectorAll('[data-games]').forEach(function (b) {
      b.querySelector('.est').textContent = estimate(matchChoice.a, parseInt(b.getAttribute('data-games'), 10));
    });
  }
  function goMatch() {
    say('match-msg', matchChoice.a === 'mcts' ? 'The search-assisted computer is slow: the other questions wait until it finishes.' : '');
    runJob('match', '/api/match', { a: matchChoice.a, b: 'greedy', games: matchChoice.games }, $('match-result'), showMatch);
  }
  function statCard(k, v, r) { return h('div', { class: 'stat-card' }, h('p', { class: 'k', text: k }), h('p', { class: 'v', text: v }), h('p', { class: 'r', text: r })); }
  function propCard(k, p) { return statCard(k, pc(p.est) + '%', 'likely ' + pc(p.lo) + ' to ' + pc(p.hi) + '%, n = ' + p.n + ' games'); }
  function showMatch(r) {
    say('match-msg', '');
    var panel = $('match-result');
    panel.textContent = '';
    var who = function (k) { return k === 'mcts' ? 'search-assisted computer' : k === 'greedy' ? 'computer' : k; };
    panel.appendChild(h('p', { class: 'subtle', text: 'Rakdos Midrange (' + who(r.agents.a) + ') against Mono-Red Aggro (' + who(r.agents.b) + '), each deck on the play in half the games.' }));
    panel.appendChild(h('p', { class: 'big-sentence', id: 'match-sentence' },
      'Rakdos wins ' + pc(r.winA.est) + ' percent of ' + r.games + ' games (likely between ' + pc(r.winA.lo) + ' and ' + pc(r.winA.hi) + ' percent). ',
      'Mono-Red wins ' + pc(r.winB.est) + ' percent (likely between ' + pc(r.winB.lo) + ' and ' + pc(r.winB.hi) + ' percent).',
      tip('What is the likely range?', TIPS.ci)));
    var t = r.turns.mean;
    panel.appendChild(h('div', { class: 'stat-grid', id: 'match-stats' },
      propCard('Rakdos wins on the play', r.winAOnPlay),
      propCard('Rakdos wins on the draw', r.winAOnDraw),
      t.n >= 2 ? statCard('Average game length', t.mean.toFixed(1) + ' turns', 'likely ' + t.lo.toFixed(1) + ' to ' + t.hi.toFixed(1) + ', n = ' + t.n + ' games; both players\' turns counted')
        : statCard('Average game length', t.n ? t.mean.toFixed(1) + ' turns' : 'none', 'n = ' + t.n + ' game: too few for a range'),
      statCard('Time taken', r.seconds.toFixed(1) + ' s', r.games + ' games, one run'),
      r.draws.k > 0 ? propCard('Draws', r.draws) : null));
    panel.appendChild(h('details', { id: 'match-details' }, h('summary', { text: 'Full report' }),
      r.validation ? h('p', { class: 'subtle', text: r.validation }) : null,
      h('pre', { id: 'match-report', text: r.report })));
  }

  // ---- wiring ----------------------------------------------------------------------------------

  function init(data) {
    decks = data.decks;
    tokens = data.tokens;
    budgets = data.budgets;
    // Hand flow.
    document.querySelectorAll('[data-play]').forEach(function (b) {
      b.onclick = function () { hand.play = b.getAttribute('data-play') === 'play'; setRadio(b.parentNode, 'data-play', b.getAttribute('data-play')); };
    });
    document.querySelectorAll('[data-mull]').forEach(function (b) {
      b.onclick = function () { hand.mull = parseInt(b.getAttribute('data-mull'), 10); setRadio(b.parentNode, 'data-mull', hand.mull); say('hand-msg', ''); renderHandFlow(); };
    });
    $('hand-all7').onchange = function () { say('hand-msg', ''); renderHandFlow(); };
    $('hand-clear').onclick = function () { hand.cards = []; say('hand-msg', ''); renderHandFlow(); };
    $('hand-go').onclick = goHand;
    // Board flow.
    $('phase').onchange = function () { board.step = this.value; renderAdvanced(); };
    $('turn').onchange = function () {
      var n = parseInt(this.value, 10);
      if (!isNaN(n) && n >= 0) { board.turn = n; syncStarting(); }
      renderGame();
      renderAdvanced();
    };
    $('life-you').onchange = function () { var n = parseInt(this.value, 10); if (!isNaN(n)) board.players[you()].life = n; };
    $('life-them').onchange = function () { var n = parseInt(this.value, 10); if (!isNaN(n)) board.players[them()].life = n; };
    $('hidden').onchange = function () { var n = parseInt(this.value, 10); if (!isNaN(n)) board.players[them()].handHidden = Math.max(0, Math.min(60, n)); updateDerived(); };
    $('land-played').onchange = function () { board.landPlayed = this.checked; };
    $('analyze').onclick = analyzeBoard;
    $('export').onclick = exportFile;
    $('import-file').onchange = function () { if (this.files && this.files[0]) importFile(this.files[0]); this.value = ''; };
    $('load-example').onclick = function () {
      fetch('/api/example').then(function (r) { return r.json(); }).then(function (j) {
        board = fromSpot(j, decks);
        renderBoard();
        say('board-msg', 'Example loaded: ' + (j.note || 'a Rakdos turn with Sheoldred in hand') );
      }, function () { say('board-msg', 'The example could not be loaded. Is Matchup Lab still running?', true); });
    };
    $('clear').onclick = function () { board = newBoard(); pickerOpen = [false, false]; renderBoard(); say('board-msg', 'The board is empty again.'); };
    // Match flow.
    document.querySelectorAll('[data-agent]').forEach(function (b) { b.onclick = function () { matchChoice.a = b.getAttribute('data-agent'); renderMatch(); }; });
    document.querySelectorAll('[data-games]').forEach(function (b) { b.onclick = function () { matchChoice.games = parseInt(b.getAttribute('data-games'), 10); renderMatch(); }; });
    $('match-go').onclick = goMatch;
    renderHandFlow();
    renderBudgets();
    renderBoard();
    renderMatch();
    document.body.setAttribute('data-ready', 'true');
  }

  window.addEventListener('hashchange', route);
  route();
  fetch('/api/decks').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(init, function () {
    var el = $('load-error');
    el.hidden = false;
    el.textContent = 'The page could not load the card lists. Make sure Matchup Lab is running, then reload this page.';
  });
})(typeof window !== 'undefined' ? window : globalThis);
