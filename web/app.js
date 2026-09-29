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

  var decks = null;
  var tokens = [];
  var board = newBoard();
  var handState = { cards: [], bottom: {} };
  var PNAME = ['A: Rakdos Midrange', 'B: Mono-Red Aggro'];

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
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      (Array.isArray(c) ? c : [c]).forEach(function (x) { el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
    }
    return el;
  }

  function selectedZone() { var r = document.querySelector('input[name="zone"]:checked'); return r ? r.value : 'battlefield'; }
  function cardTip(c) {
    return c.faces.map(function (f) {
      return f.name + (f.manaCost ? '  ' + f.manaCost : '') + '\n' + f.typeLine + (f.pt ? '  ' + f.pt : '') + (f.loyalty !== null ? '  loyalty ' + f.loyalty : '') + '\n' + f.oracleText;
    }).join('\n----\n');
  }

  function tile(c, used, onClick) {
    var left = c.count - used;
    return h('button', { type: 'button', class: 'tile', title: cardTip(c), 'data-card': c.name, disabled: left <= 0, onclick: onClick, 'aria-label': 'Add ' + c.name + ' (' + left + ' of ' + c.count + ' left)' },
      h('img', { src: c.image, alt: '', onerror: function () { this.style.display = 'none'; } }),
      h('span', { class: 'nm', text: c.frontName }),
      h('span', { class: 'ct', text: left + '/' + c.count, title: left + ' of the ' + c.count + ' copies in the list are not placed yet' }));
  }

  var flashMsg = null;
  function flash(text) {
    if (!flashMsg) return;
    flashMsg.textContent = text || '';
    flashMsg.hidden = !text;
  }

  function renderDecks() {
    [0, 1].forEach(function (p) {
      var d = decks[p];
      var col = $('deck-' + p);
      col.textContent = '';
      col.appendChild(h('h2', null, d.archetype + ' ', h('span', { class: 'who', text: '(player ' + d.label + ', ' + d.size + ' cards)' })));
      col.appendChild(h('div', { class: 'tiles' }, d.cards.map(function (c) {
        return tile(c, copiesUsed(board, p, c.name), function () {
          var err = addCard(board, { name: c.name, card: c }, p, selectedZone());
          flash(err);
          render();
        });
      })));
      col.appendChild(h('div', { class: 'tokens' }, h('span', { class: 'lbl', text: 'Tokens (battlefield only) for player ' + d.label + ':' }),
        tokens.map(function (t) {
          return h('button', { type: 'button', class: 'small', title: t.typeLine + (t.pt ? ' ' + t.pt : ''), 'data-token': t.name,
            onclick: function () { flash(addCard(board, { name: t.name, token: true, card: { creature: t.creature } }, p, 'battlefield')); render(); } }, t.name);
        })));
    });
    if (!flashMsg) {
      flashMsg = h('p', { class: 'warn', id: 'flash', hidden: true });
      document.querySelector('.dest').appendChild(flashMsg);
    }
  }

  // A number field. Its change updates the board and the counts derived from it in place; it does
  // not rebuild the panels, so the field the user moves to next is not replaced under them.
  function numInput(value, min, max, onChange, attrs) {
    return h('input', Object.assign({ type: 'number', min: min, max: max, step: 1, value: value, onchange: function () {
      var n = parseInt(this.value, 10);
      if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
      updateDerived();
    } }, attrs || {}));
  }

  function handHeading(p) {
    var pl = board.players[p];
    return p === board.viewer ? 'Hand (' + pl.hand.length + ')' : 'Known cards in hand (' + pl.hand.length + ' known, ' + pl.handHidden + ' unknown)';
  }

  function updateDerived() {
    [0, 1].forEach(function (p) {
      var lib = $('libtxt-' + p);
      if (lib) lib.textContent = 'Library size (empty = auto: ' + librarySize(board, p, decks[p].size) + ')';
      var input = $('lib-' + p);
      if (input) input.placeholder = String(librarySize(board, p, decks[p].size));
      var hh = $('handh-' + p);
      if (hh) hh.textContent = handHeading(p);
    });
  }

  function chips(list, empty) {
    if (!list.length) return h('span', { class: 'empty', text: empty });
    return h('div', { class: 'chips' }, list.map(function (e) {
      return h('span', { class: 'chip' }, e.name, h('button', { type: 'button', title: 'Remove ' + e.name, 'aria-label': 'Remove ' + e.name, onclick: function () { removeCard(board, e.uid); render(); } }, '×'));
    }));
  }

  function permRow(e) {
    var hit = findCard(decks, e.name);
    var c = hit ? hit.card : null;
    var tok = tokens.filter(function (t) { return t.name === e.name; })[0];
    var face = c && c.faces[e.face] ? c.faces[e.face] : null;
    var creature = face ? /Creature/.test(face.typeLine) : tok ? tok.creature : false;
    var opts = [
      h('label', { title: 'Tapped: turned sideways, already used this turn' }, h('input', { type: 'checkbox', checked: e.tapped, onchange: function () { e.tapped = this.checked; } }), 'tapped'),
    ];
    if (creature) {
      opts.push(h('label', { title: 'Summoning sick: came under this player\'s control this turn (for the opponent: since their last turn began), so it cannot attack or tap yet' },
        h('input', { type: 'checkbox', checked: e.sick, onchange: function () { e.sick = this.checked; } }), 'summoning sick'));
      opts.push(h('label', { title: 'Damage marked on it this turn' }, 'damage', numInput(e.damage, 0, 99, function (n) { e.damage = n; })));
      opts.push(h('label', { title: '+1/+1 counters' }, '+1/+1', numInput(e.p1p1, 0, 99, function (n) { e.p1p1 = n; })));
      opts.push(h('label', { title: '-1/-1 counters' }, '-1/-1', numInput(e.m1m1, 0, 99, function (n) { e.m1m1 = n; })));
    }
    if (c && c.saga && e.face === 0) opts.push(h('label', { title: 'Lore counters: the saga chapter it has reached (1 = chapter I has triggered)' }, 'lore', numInput(e.lore === null ? 1 : e.lore, 1, 3, function (n) { e.lore = n; })));
    if (c && c.planeswalker) opts.push(h('label', { title: 'Loyalty counters on the planeswalker' }, 'loyalty', numInput(e.loyalty === null ? 0 : e.loyalty, 0, 99, function (n) { e.loyalty = n; })));
    if (c && c.dfc) {
      opts.push(h('label', { title: 'Which face is up: a transformed card, or the side a Pathway was played as' }, 'face',
        h('select', { onchange: function () { e.face = parseInt(this.value, 10); if (e.face !== 0) e.lore = null; else if (c.saga && e.lore === null) e.lore = 1; render(); } },
          c.faces.map(function (f, i) { return h('option', { value: i, selected: i === e.face }, f.name); }))));
    }
    var label = face ? face.name : e.name;
    return h('div', { class: 'perm', 'data-perm': e.name },
      h('div', { class: 'head' }, h('span', null, label + (tok ? ' (token)' : '') + (e.owner !== e.controller ? ' (owned by ' + (e.owner === 0 ? 'A' : 'B') + ')' : '')),
        h('button', { type: 'button', class: 'small', title: 'Remove ' + label + ' from the battlefield', onclick: function () { removeCard(board, e.uid); render(); } }, 'Remove')),
      h('div', { class: 'opts' }, opts));
  }

  function renderPlayers() {
    var host = $('players');
    host.textContent = '';
    [0, 1].forEach(function (p) {
      var pl = board.players[p];
      var you = p === board.viewer;
      var d = decks[p];
      var lib = librarySize(board, p, d.size);
      var known = [];
      (pl.library.knownTop || []).forEach(function (x) { known.push('top: ' + (typeof x === 'string' ? x : x.name)); });
      (pl.library.knownBottom || []).forEach(function (x) { known.push('bottom: ' + (typeof x === 'string' ? x : x.name)); });
      var perms = board.battlefield.filter(function (e) { return e.controller === p; });
      host.appendChild(h('fieldset', { class: 'player p' + p, id: 'player-' + p },
        h('legend', { text: 'Player ' + d.label + ': ' + d.archetype + (you ? ' (you)' : ' (the opponent)') }),
        h('div', { class: 'grid' },
          h('label', null, 'Life', numInput(pl.life, -99, 999, function (n) { pl.life = n; }, { id: 'life-' + p })),
          h('label', { title: 'Mulligans this player took before the game' }, 'Mulligans taken', numInput(pl.mulligans, 0, 7, function (n) { pl.mulligans = n; }, { id: 'mull-' + p })),
          you ? null : h('label', { title: 'Cards in the opponent\'s hand that you have not seen. The analyzer fills them in at random from the rest of their list.' }, 'Unknown cards in hand', numInput(pl.handHidden, 0, 60, function (n) { pl.handHidden = n; }, { id: 'hidden-' + p })),
          h('label', { title: 'Leave empty to count it automatically: the deck size minus every card of this player shown here' }, h('span', { id: 'libtxt-' + p, text: 'Library size (empty = auto: ' + lib + ')' }),
            h('input', { type: 'number', min: 0, max: 60, id: 'lib-' + p, value: pl.librarySize === null ? '' : pl.librarySize, placeholder: String(lib), onchange: function () {
              var n = parseInt(this.value, 10);
              pl.librarySize = isNaN(n) ? null : Math.max(0, n);
              updateDerived();
            } }))),
        h('div', { class: 'zone' }, h('h3', { id: 'handh-' + p, text: handHeading(p) }),
          chips(pl.hand, you ? 'empty' : 'none known')),
        h('div', { class: 'zone' }, h('h3', { text: 'Battlefield (' + perms.length + ')' }),
          perms.length ? perms.map(permRow) : h('span', { class: 'empty', text: 'nothing' })),
        h('div', { class: 'zone' }, h('h3', { text: 'Graveyard (' + pl.graveyard.length + ')' }), chips(pl.graveyard, 'empty')),
        h('div', { class: 'zone' }, h('h3', { text: 'Exile (' + pl.exile.length + ')' }), chips(pl.exile, 'empty')),
        known.length ? h('p', { class: 'hint', text: 'Known library cards (from the imported file): ' + known.join(', ') }) : null));
    });
  }

  function renderGame() {
    $('viewer').value = String(board.viewer);
    $('starting').value = String(board.startingPlayer);
    $('turn').value = String(board.turn);
    $('step').value = board.step;
    $('active').value = String(board.activePlayer);
    $('priority').value = String(board.priority);
    $('land-played').checked = board.landPlayed;
    $('note').value = board.note;
    var w = $('turn-warning');
    var expect = activeFor(board.turn, board.startingPlayer);
    if (board.turn > 0 && expect !== board.activePlayer) {
      w.hidden = false;
      w.textContent = 'Turn ' + board.turn + ' would normally be player ' + (expect === 0 ? 'A' : 'B') + '\'s turn, given who was on the play. Check the turn number.';
    } else w.hidden = true;
  }

  function render() {
    renderDecks();
    renderGame();
    renderPlayers();
  }

  // ---- results -----------------------------------------------------------------------------------

  function sentences(list) { return h('div', { class: 'sentences' }, list.map(function (s) { return h('p', { text: s }); })); }

  function showError(panel, msg) {
    panel.textContent = '';
    panel.appendChild(h('h2', { text: 'Results' }));
    panel.appendChild(h('div', { class: 'error', role: 'alert' }, h('strong', { text: 'The analysis did not run.' }), h('pre', { text: msg })));
  }

  function running(panel, what) {
    panel.textContent = '';
    panel.appendChild(h('h2', { text: 'Results' }));
    var p = h('p', { class: 'meta', id: 'running', text: what + ' running: 0 s' });
    panel.appendChild(p);
    var t0 = Date.now();
    return setInterval(function () { p.textContent = what + ' running: ' + Math.round((Date.now() - t0) / 1000) + ' s'; }, 1000);
  }

  function showSpot(r) {
    var panel = $('spot-results');
    panel.textContent = '';
    panel.appendChild(h('h2', { text: 'Results' }));
    panel.appendChild(h('p', { class: 'meta' }, 'Win rates are for player ' + r.perspective + '. Deciding now: ' + (r.decider === null ? 'nobody (the game is over)' : 'player ' + r.decider) + '. ',
      'Search: ' + r.budget.samples + ' samples x ' + r.budget.iterations + ' searches, ' + r.rollouts + ' rollouts in total; ' + r.elapsed + '.'));
    panel.appendChild(h('p', { class: 'stat', id: 'spot-total' }, 'All moves together: ' + r.total.stat));
    panel.appendChild(h('h3', { text: 'Top ' + r.lines.length + ' of ' + r.rootMoves + ' possible moves (most searched first)' }));
    panel.appendChild(h('p', { class: 'hint' },
      h('abbr', { title: 'Each number is followed by its 95 percent confidence interval (the range the true value is likely in) and n, the number of simulated games (rollouts) it is based on. Small n means a wide, unreliable interval.' }, 'How to read the numbers (?)'),
      ' win = share of simulated games won; n = simulated games behind the number; visits = how often the search tried this move.'));
    panel.appendChild(h('ol', { id: 'spot-lines' }, r.lines.map(function (l) {
      return h('li', null, h('div', { class: 'mv', text: l.move }), h('div', { class: 'stat', text: l.stat }), h('div', { class: 'stat', text: l.visits }),
        l.pv.length ? h('details', null, h('summary', { text: 'Most searched line after it' }),
          h('ul', null, l.pv.map(function (s) { return h('li', null, h('span', { text: s.move + ': ' }), h('span', { class: 'stat', text: s.stat })); }))) : null);
    })));
    panel.appendChild(sentences(r.notes));
    panel.appendChild(h('details', null, h('summary', { text: 'Full report, as the spot command prints it' }), h('pre', { id: 'spot-report', text: r.report })));
  }

  function showHand(r) {
    var panel = $('hand-results');
    panel.textContent = '';
    panel.appendChild(h('h2', { text: 'Results' }));
    panel.appendChild(h('p', { class: 'verdict', id: 'hand-verdict', text: r.result.verdict }));
    var lines = r.report.split('\n').filter(function (l) { return /^ {2}(keep this hand|mulligan to)/.test(l); });
    panel.appendChild(h('div', null, lines.map(function (l) { return h('p', { class: 'stat', text: l.trim() }); })));
    panel.appendChild(h('p', { class: 'meta', text: 'Elapsed ' + r.result.seconds.toFixed(1) + ' s for ' + r.result.games + ' simulated games.' }));
    panel.appendChild(sentences(r.notes.concat(r.result.warnings.map(function (w) { return 'Warning: ' + w; }))));
    panel.appendChild(h('pre', { id: 'hand-report', text: r.report }));
  }

  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
      return res.json().then(function (j) { if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status)); return j; });
    });
  }

  function analyzeSpot() {
    var btn = $('analyze');
    var body = toSpot(board);
    body.budget = $('budget').value;
    var persp = $('perspective').value;
    if (persp) body.player = persp;
    btn.disabled = true;
    var timer = running($('spot-results'), 'Analysis');
    post('/api/spot', body).then(showSpot, function (e) { showError($('spot-results'), e.message); })
      .then(function () { clearInterval(timer); btn.disabled = false; });
  }

  // ---- hand tab ----------------------------------------------------------------------------------

  function renderHand() {
    var d = decks[0];
    var col = $('hand-deck');
    col.textContent = '';
    col.appendChild(h('h2', null, d.archetype + ' ', h('span', { class: 'who', text: '(player A)' })));
    col.appendChild(h('div', { class: 'tiles' }, d.cards.map(function (c) {
      var used = handState.cards.filter(function (x) { return x.name === c.name; }).length;
      var t = tile(c, used, function () {
        if (handState.cards.length >= 7) return;
        handState.cards.push({ uid: uidSeq++, name: c.name });
        renderHand();
      });
      if (handState.cards.length >= 7) t.disabled = true;
      return t;
    })));
    var mull = parseInt($('hand-mulligans').value, 10);
    var list = $('hand-list');
    list.textContent = '';
    list.appendChild(h('h3', { text: 'Hand: ' + handState.cards.length + ' of 7 cards' }));
    if (!handState.cards.length) list.appendChild(h('span', { class: 'empty', text: 'Click cards on the left to add them.' }));
    else {
      list.appendChild(h('div', { class: 'chips' }, handState.cards.map(function (e) {
        var bottomed = !!handState.bottom[e.uid];
        return h('span', { class: 'chip' + (bottomed ? ' on' : '') }, e.name,
          mull > 0 ? h('label', { title: 'Put this card on the bottom (London mulligan)' }, h('input', { type: 'checkbox', checked: bottomed, onchange: function () { if (this.checked) handState.bottom[e.uid] = true; else delete handState.bottom[e.uid]; renderHand(); } }), 'bottom') : null,
          h('button', { type: 'button', 'aria-label': 'Remove ' + e.name, title: 'Remove ' + e.name, onclick: function () { handState.cards = handState.cards.filter(function (x) { return x.uid !== e.uid; }); delete handState.bottom[e.uid]; renderHand(); } }, '×'));
      })));
    }
    if (mull > 0) {
      var nb = Object.keys(handState.bottom).length;
      list.appendChild(h('p', { class: 'hint', text: nb === 0 ? 'No cards ticked for the bottom: the computer picks ' + mull + ' with its bottoming rule.' : nb + ' ticked for the bottom; after ' + mull + ' mulligan(s) tick exactly ' + mull + ' or none.' }));
    }
  }

  function analyzeHand() {
    var btn = $('hand-analyze');
    var mull = parseInt($('hand-mulligans').value, 10);
    var body = {
      hand: handState.cards.map(function (x) { return x.name; }),
      play: $('hand-play').value === 'play', mulligans: mull,
      bottom: handState.cards.filter(function (x) { return handState.bottom[x.uid]; }).map(function (x) { return x.name; }),
      maxGames: parseInt($('hand-games').value, 10),
    };
    btn.disabled = true;
    var timer = running($('hand-results'), 'Hand analysis (up to about a minute)');
    post('/api/hand', body).then(showHand, function (e) { showError($('hand-results'), e.message); })
      .then(function () { clearInterval(timer); btn.disabled = false; });
  }

  // ---- wiring -------------------------------------------------------------------------------------

  function setTab(which) {
    ['board', 'hand'].forEach(function (t) {
      $('tab-' + t).setAttribute('aria-selected', String(t === which));
      $('panel-' + t).hidden = t !== which;
    });
  }

  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        board = fromSpot(JSON.parse(String(reader.result)), decks);
        flash('');
        render();
      } catch (e) { showError($('spot-results'), 'Import failed: ' + e.message); }
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
  }

  function init(data) {
    decks = data.decks;
    tokens = data.tokens;
    STEPS.forEach(function (s) { $('step').appendChild(h('option', { value: s[0] }, s[1])); });
    Object.keys(data.budgets).forEach(function (k) { $('budget').appendChild(h('option', { value: k, selected: k === 'quick' }, data.budgets[k].label)); });
    $('tab-board').onclick = function () { setTab('board'); };
    $('tab-hand').onclick = function () { setTab('hand'); };
    $('viewer').onchange = function () { board.viewer = parseInt(this.value, 10); render(); };
    $('starting').onchange = function () { board.startingPlayer = parseInt(this.value, 10); board.activePlayer = activeFor(board.turn, board.startingPlayer); board.priority = board.activePlayer; renderGame(); };
    $('turn').onchange = function () { var n = parseInt(this.value, 10); if (!isNaN(n) && n >= 0) { board.turn = n; board.activePlayer = activeFor(n, board.startingPlayer); board.priority = board.activePlayer; } renderGame(); };
    $('step').onchange = function () { board.step = this.value; };
    $('active').onchange = function () { board.activePlayer = parseInt(this.value, 10); board.priority = board.activePlayer; renderGame(); };
    $('priority').onchange = function () { board.priority = parseInt(this.value, 10); };
    $('land-played').onchange = function () { board.landPlayed = this.checked; };
    $('note').onchange = function () { board.note = this.value; };
    $('analyze').onclick = analyzeSpot;
    $('export').onclick = exportFile;
    $('import-file').onchange = function () { if (this.files && this.files[0]) importFile(this.files[0]); this.value = ''; };
    $('load-example').onclick = function () {
      fetch('/api/example').then(function (r) { return r.json(); }).then(function (j) { board = fromSpot(j, decks); render(); });
    };
    $('clear').onclick = function () { board = newBoard(); flash(''); render(); };
    $('hand-mulligans').onchange = renderHand;
    $('hand-analyze').onclick = analyzeHand;
    $('hand-clear').onclick = function () { handState = { cards: [], bottom: {} }; renderHand(); };
    render();
    renderHand();
    document.body.setAttribute('data-ready', 'true');
  }

  fetch('/api/decks').then(function (r) { return r.json(); }).then(init, function (e) {
    document.querySelector('main').prepend(h('div', { class: 'error', role: 'alert' }, 'Could not load the decklists from the server: ' + e.message));
  });
})(typeof window !== 'undefined' ? window : globalThis);
