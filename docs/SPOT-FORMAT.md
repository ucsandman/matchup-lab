# Spot files

A spot file describes one moment of a game the way one player sees it: the board, both graveyards and exiles, your hand, what you know about the opponent's hand, life totals, whose turn and which step it is. The Phase 4 analyzer reads it, fills in the cards you cannot see, and searches from there. You can write one by hand in any text editor, or save one from a game the tools played.

The file is JSON. JSON has no comments, so every object accepts a "note" field for your own words; the loader ignores it.

Players are numbered everywhere: 0 is deck A (decks/deckA.json, Rakdos Midrange) and 1 is deck B (decks/deckB.json, Mono-Red Aggro). The viewer is the player whose eyes the spot is seen through.

## A full example: your fourth turn

Rakdos is on the play and it is its fourth turn. The engine counts both players' turns, so that is turn 7 (turns 1, 3, 5 and 7 are yours on the play; on the draw your fourth turn is turn 8). It is the precombat main phase, you have not played a land yet, the Fable's chapter II has already resolved, and you are deciding between Sheoldred and holding up mana.

You kept six (one mulligan) and put Duress on the bottom, so you know the bottom card of your library. On turn 1 your Thoughtseize showed you the opponent's hand; you took Monstrous Rage, and Screaming Nemesis is still in that hand. The opponent has drawn two cards since then that you have not seen.

This file is spots/example.json; copy it and edit it.

    {
      "spot": 1,
      "note": "Rakdos on the play, its fourth turn (turn 7), precombat main, before the land drop. Sheoldred now, or hold up removal?",
      "viewer": 0,
      "turn": 7,
      "step": "main1",
      "activePlayer": 0,
      "players": [
        {
          "note": "Deck A, Rakdos Midrange (you)",
          "life": 14,
          "mulligans": 1,
          "hand": ["Sheoldred, the Apocalypse", "Swamp"],
          "graveyard": ["Thoughtseize", "Fatal Push"],
          "exile": [],
          "library": { "knownBottom": ["Duress"] }
        },
        {
          "note": "Deck B, Mono-Red Aggro (the opponent)",
          "life": 13,
          "mulligans": 0,
          "hand": ["Screaming Nemesis"],
          "handHidden": 2,
          "graveyard": ["Monastery Swiftspear", "Monstrous Rage", "Burst Lightning"],
          "exile": []
        }
      ],
      "battlefield": [
        { "name": "Blood Crypt", "controller": 0 },
        { "name": "Blackcleave Cliffs", "controller": 0 },
        { "name": "Blightstep Pathway", "controller": 0 },
        { "name": "Bloodtithe Harvester", "controller": 0 },
        { "name": "Blood", "controller": 0 },
        { "name": "Fable of the Mirror-Breaker", "controller": 0, "lore": 2 },
        { "name": "Goblin Shaman", "controller": 0 },
        { "name": "Mountain", "controller": 1 },
        { "name": "Mountain", "controller": 1 },
        { "name": "Mutavault", "controller": 1 },
        { "name": "Emberheart Challenger", "controller": 1, "sick": true }
      ]
    }

What each part says:

- "spot": 1 is the format version. Required.
- "viewer": 0 means the spot is seen by deck A (you). Required.
- "turn": 7, "step": "main1", "activePlayer": 0. Required. The steps are mulligan, untap, upkeep, draw, main1, beginCombat, declareAttackers, declareBlockers, combatDamage, endCombat, main2, end and cleanup. Turn 0 with step mulligan is the pregame.
- "players": two objects, deck A first. Each has "life" (default 20), "mulligans" (default 0), "hand", "graveyard", "exile" and "library".
- Your "hand" lists every card in it. The opponent's "hand" lists only the cards you know (revealed by Thoughtseize or Duress and still there), and "handHidden" says how many more they hold. "handHidden" is required for the opponent, even when it is 0.
- "library": leave out "size" and the loader computes it as the deck size minus every other card of that player in the file. Here that is 60 minus 9 = 51 for you (the Duress on the bottom is one of the 51) and 60 minus 10 = 50 for the opponent. If you give "size", the numbers must add up to the deck size.
- "knownBottom" lists the cards you know at the bottom of your library, the very bottom card first (London mulligan bottoms, a scry to the bottom). "knownTop" lists the cards you know on top, the top card first (a scry kept on top). Only your own library has these.
- "battlefield" lists every permanent in play, both players'. Each one needs "controller".
- "lore": 2 on the Fable is shorthand for "counters": {"lore": 2}. Without either, a saga is written with one lore counter and a planeswalker with its printed loyalty.
- "sick": true on Emberheart Challenger: it came in on the opponent's last turn, so it has not been under their control since the start of one of their turns. Creatures default to not sick; mark the ones that came in this turn (or, for the opponent's, since their last turn began).
- "Blood" and "Goblin Shaman" are tokens (from Bloodtithe Harvester and the Fable's chapter I). Token names: Blood, Treasure, Goblin Shaman, Zombie, Spirit, Goblin, Pilot, Demon, Dragon, Monster, Copy.
- Everything defaults to untapped, undamaged and front face up.

## Card entries

A card is either its name as a string, or an object with "name" and any of these fields:

- "controller" (0 or 1): required on the battlefield; elsewhere it is the zone's player.
- "owner" (0 or 1): defaults to the controller on the battlefield and to the zone's player elsewhere. Only needed for a permanent someone else owns.
- "tapped", "sick", "damage", "counters" (p1p1, m1m1, lore, loyalty, charge), "lore", "loyalty".
- "face": 1 for the back face (a transformed Fable, a Pathway played as its other side). Naming the back face does the same on the battlefield: "Reflection of Kiki-Jiki" is a Fable on face 1, "Searstep Pathway" a Pathway played as its red side.
- "id": a number. Only needed when another entry refers to this card ("attachedTo" for a Role, "blocking", a stack target). Leave ids out otherwise; the loader numbers the cards.
- "knownTo": [known to player 0, known to player 1], for a card in your hand the opponent has seen, for example [true, true] after their Duress.
- "attachedTo", "attacking", "blocking", "blocked" and the other engine fields a saved spot contains. Copy them from a saved spot rather than writing them.

Names are the exact card names in decks/oracle.json, such as "Sheoldred, the Apocalypse" or "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki", or the name of one face ("Fable of the Mirror-Breaker", "Blightstep Pathway"), or a token name.

## The stack

"stack" lists spells and abilities waiting to resolve, the bottom first (the last one resolves first). A spell is

    { "name": "Fatal Push", "controller": 0, "targets": [{ "kind": "obj", "id": 31 }] }

where 31 is the "id" you gave the target card. Abilities on the stack carry engine keys (abilityKey, sourceId); save a spot from a game to get one rather than writing it.

## Other fields

All optional, with defaults that fit an ordinary position. A saved spot writes them only when they differ from the default.

- "priority": who has priority (default: the active player).
- "startingPlayer": who took turn 1 (default follows from the turn number and the active player).
- "phaseQueue": the steps left this turn (default: the normal rest of the turn).
- "dayNight": none, day or night (default none).
- "flags": this turn's counts per player [deck A, deck B]: "landsPlayed", "spellsCast", "noncreatureSpellsCast", "permanentLeft", "nextCreatureBonus", "damageTally", "loyaltyUsed" (default all zero). Write "flags": {"landsPlayed": [1, 0]} if you already played your land this turn.
- "passes": 1 when the other player just passed priority to you with something on the stack (default 0).
- "stepPriority", "effects" (until-end-of-turn effects, exile permissions), "delayed" (delayed triggers), "pendingChoice", "pregame", "result": engine state; copy them from a saved spot.
- "decks": the two deck files (default ["deckA", "deckB"]), or two lists in the decks/*.json shape for a post-sideboard game.

## What the loader checks

The loader (readSpotFile and loadSpot in src/tools/spot-schema.ts) checks the file against the JSON schema in that module (SPOT_SCHEMA), then against the card names and the two lists, and lists every problem it finds, not only the first. For example:

    spot file rejected (1 problem):
      - deck A (Rakdos Midrange): 5 copies of "Fatal Push" in the spot, the list has 4 (spot.players[0].graveyard[1] (Fatal Push), ...)

It rejects:

- a name that is not in decks/oracle.json, with the closest real name (did you mean "Sheoldred, the Apocalypse"?);
- a card in a zone of a player whose list does not have it ("not in deck B (Mono-Red Aggro), which owns this zone; it is in deck A (Rakdos Midrange)");
- more copies of a card than the list has, counted over every zone;
- zone sizes that do not add up to the deck size ("8 cards placed outside the library + 2 unseen in hand + 40 in library = 50, the list has 60");
- a field it does not know, with the closest real field (unknown field "taped"; did you mean "tapped"?);
- a battlefield card without a controller, an opponent without "handHidden", a token outside the battlefield, battlefield-only state (tapped, damage, attacking) on a card in another zone, an "attachedTo" id that is not a permanent in the file, a duplicate id;
- known positions in the opponent's library. The format has no place for them because no card in either 75 shows you the order of the opponent's library.

## Saving a spot from a game

saveSpot(view(state, player)) in src/tools/spot-schema.ts turns what a player sees in a live game into this format, and writeSpotFile writes it to disk. Loading a saved spot gives back exactly the view it was saved from; src/test/tools/spot.test.ts checks this on more than 500 positions from random games, including the pregame, spells on the stack, pending choices and finished games.

## How the analyzer fills in what you cannot see

The determinizer (src/agents/determinize.ts) turns a spot into complete games. Everything the file shows stays as written. The opponent's unseen hand cards and the unknown part of both libraries are dealt at random from what is left of each list after removing every card the file shows. Your known library cards stay where they are, so a card you scried to the top is always your next draw and your mulligan bottoms stay at the bottom. Each sample gets its own shuffle from the analyzer's random stream.

Limits:

- The deal is uniform. It infers nothing from how the opponent has played (cards held, blocks not made, a mulligan), and it does not know which cards the opponent put on the bottom after their mulligan.
- A spot in the middle of a spell's resolution (a Duress pick, a scry, a trigger's target, a would-die replacement) cannot be continued, because the file does not hold the half-finished operation; the determinizer refuses it with a message. Positions where a player has priority, declares attackers or blockers, or makes a mulligan decision all work.
- A search over sampled hidden cards can play as if it knew them (strategy fusion); docs/DEVELOPERS.md, section 'Spot analyzer: what it gets wrong (the determinization weakness)', covers this and the uniform deal above (non-locality).
