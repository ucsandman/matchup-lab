# RULES-NOTES

Comprehensive Rules source: docs/CR.txt (not committed; scripts/fetch-cr.mjs downloads it during setup or on the first lint run), effective September 25, 2026 (downloaded 2026-09-29 from https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt, linked from https://magic.wizards.com/en/rules). 3310 numbered rules parsed.

Citation lint: npm run lint:cr (or scripts/lint-cr.ps1) checks every CR citation in src/**/*.ts. Format in code comments: CR 704.5g (lethal damage). The number must exist in docs/CR.txt and at least one topic word (or its stem) must appear in the text of that rule or its subrules. A bare CR number without a (topic) fails as malformed. Note: the plan example CR 704.5f (lethal damage) is wrong in this CR; 704.5f is toughness 0 or less and 704.5g is lethal damage, and the lint rejects the former.

## T1.0: PLAN.md sections 3 and 4, corrected numbers

| Where | Was | Now | Why | CR text excerpt |
|---|---|---|---|---|
| Duress, Thoughtseize (reveal) | 701.16? | 701.20 | 701.16 is Investigate | 701.20: Reveal / 701.20a To reveal a card, show that card to all players for a brief time. If an effect causes a card to be revealed, it remains revealed for as long as necessary to complete the parts of the effect that card is relevant t... |
| Duress, Thoughtseize, Go Blank (discard) | 701.8? | 701.9 | 701.8 is Destroy | 701.9: Discard / 701.9a To discard a card, move it from its owner’s hand to that player’s graveyard. |
| Fear of Missing Out (ETB discard) | 701.8? | 701.9 | 701.8 is Destroy | 701.9: Discard / 701.9a To discard a card, move it from its owner’s hand to that player’s graveyard. |
| Fatal Push (destroy) | 701.7? | 701.8 | 701.7 is Create | 701.8: Destroy / 701.8a To destroy a permanent, move it from the battlefield to its owner’s graveyard. |
| Takenuma, Abandoned Mire (mill 3) | 701.13? | 701.17 | 701.13 is Exile | 701.17: Mill / 701.17a For a player to mill a number of cards, that player puts that many cards from the top of their library into their graveyard. |
| Invoke Despair (sacrifice edicts) | 701.17? | 701.21 | 701.17 is Mill | 701.21: Sacrifice / 701.21a To sacrifice a permanent, its controller moves it from the battlefield directly to its owner’s graveyard. A player can’t sacrifice something that isn’t a permanent, or something that’s a permanent they don’t co... |
| Torch the Tower (scry 1) | 701.18? | 701.22 | 701.18 is Play | 701.22: Scry / 701.22a To “scry N” means to look at the top N cards of your library, then put any number of them on the bottom of your library in any order and the rest on top of your library in any order. |
| Blightstep Pathway (face chosen on play) | 712.11? | 712.12 | 712.11 is the default face for a cast DFC spell | 712.12: A player playing a modal double-faced card or a copy of a modal double-faced card as a land chooses one of its faces that’s a land before putting it onto the battlefield. It enters the battlefield with that face up. See rule 305, ... |
| Graveyard Trespasser (day/night) | 730? | 731 | 730 is Merging with Permanents; the old 726 note was dropped | 731: Day and Night / 731.1a The phrases “day becomes night” and “night becomes day” refer to the game losing the first designation and gaining the second one. |
| Unholy Annex (Rooms) | 709.x? | 709.5 | Rooms are split cards with a shared type line | 709.5: Some split cards are permanent cards with a single shared type line. A shared type line on such an object represents two static abilities that function on the battlefield. These are “As long as this permanent doesn’t have the ‘lef... |
| Unholy Annex (unlock special action) | 116.2? | 116.2m | 116.2 is the list; 116.2m is the unlock-cost special action | 116.2m: A player who controls a permanent that has one or more locked halves (see rule 709.5) may pay the mana cost of a locked half of that permanent to give that permanent the appropriate unlocked designation. This cost is referred to a... |
| Petrified Hamlet (choose a land card name) | 201.3? | 201.4 | 201.3 is interchangeable names | 201.4: If an effect instructs a player to choose a card name, the player must choose the name of a card in the Oracle card reference. (See rule 108.1.) A player may not choose the name of a token unless it’s also the name of a card. |
| Monstrous Rage (Role uniqueness) | 704.5 Role rule? | 303.7a | Role uniqueness is an SBA defined in 303.7a, not a 704.5 subrule | 303.7a: If a permanent has more than one Role controlled by the same player attached to it, each of those Roles except the one with the most recent timestamp is put into its owner’s graveyard. This is a state-based action. See rule 704. |
| The Legend of Roku (firebending) | 702.?? | 702.189 | number was a placeholder | 702.189: Firebending / 702.189a Firebending is a triggered ability. “Firebending N” means “Whenever this creature attacks, add N {R}. Until end of combat, you don’t lose this mana as steps and phases end.” |
| Hive of the Eye Tyrant (menace, unmarked but wrong) | 702.110 | 702.111 | 702.110 is Exploit | 702.111: Menace / 702.111a Menace is an evasion ability. |

The 702.110 menace entry carried no ? mark; it was fixed because it names the wrong rule.

## T1.0: numbers verified unchanged (? removed)

| Number | Used for | CR text excerpt |
|---|---|---|
| 103.5 | London mulligan | Each player draws a number of cards equal to their starting hand size, which is normally seven. (Some effects can modify a player’s starting hand size.) A player who is dissatisfied with their initial hand may take a mulligan. Fir... |
| 104.3e | Vessel of the All-Consuming loses-the-game effect | An effect may state that a player loses the game. |
| 119.7 | cannot gain life (Aetherborn, Nemesis, Lynx) | If an effect says that a player can’t gain life, that player can’t make an exchange such that the player’s life total would become higher; in that case, the exchange won’t happen. Similarly, if an effect redistributes life totals,... |
| 205.3m | Mutavault all creature types | Creatures and kindreds share their lists of subtypes; these subtypes are called creature types. One creature type is two words long: Time Lord. All other creature types are one word long: Advisor, Aetherborn, Alien, Ally, Angel, A... |
| 303.4 | Monster Role is an Aura | Some enchantments have the subtype “Aura.” An Aura enters the battlefield attached to an object or player. What an Aura can be attached to is defined by its enchant keyword ability (see rule 702.5, “Enchant”). Other effects can li... |
| 305.7 | Urborg adds Swamp in addition | If an effect sets a land’s subtype to one or more of the basic land types, the land no longer has its old land type. It loses all abilities generated from its rules text, its old land types, and any copiable effects affecting that... |
| 508.1b | attacking Liliana | If the defending player controls any planeswalkers, is the protector of any battles, or the game allows the active player to attack multiple other players, the active player announces which player, planeswalker, or battle each of ... |
| 602.5 | Petrified Hamlet activation ban | A player can’t begin to activate an ability that’s prohibited from being activated. |
| 603.3d | Hive trigger with no legal target | The remainder of the process for putting a triggered ability on the stack is identical to the process for casting a spell listed in rules 601.2c–d. If a choice is required when the triggered ability goes on the stack but no legal ... |
| 614.12 | fast-land enters tapped | Some replacement effects modify how a permanent enters the battlefield. (See rules 614.1c–d.) Such effects may come from the permanent itself if they affect only that permanent (as opposed to a general subset of permanents that in... |
| 615.12 | Lynx damage cannot be prevented | Some effects state that damage “can’t be prevented.” If unpreventable damage would be dealt, any applicable prevention effects are still applied to it. Those effects won’t prevent any damage, but any additional effects they have w... |
| 702.166 | bargain | Bargain / 702.166a Bargain is a static ability that functions while the spell with bargain is on the stack. “Bargain” means “As an additional cost to cast this spell, you may sacrifice an artifact, enchantment, or token.” Paying a... |
| 707.9b | Reflection copy exceptions | Some copy effects modify a characteristic as part of the copying process. The final set of values for that characteristic becomes part of the copiable values of the copy. |
| 712.8e | transformed back face uses front MV | While a nonmodal double-faced permanent has its back face up, it has only the characteristics of its back face. However, its mana value is calculated using the mana cost of its front face. If a permanent is copying the back face o... |

An existence check over every CR number in PLAN.md sections 3 and 4 (319 numbers) found none missing from docs/CR.txt after these edits. Existence does not prove topic fit for the unmarked numbers; the lint enforces topic fit once a number reaches a code comment.

Unmarked numbers spot-checked against the text for the topics named in T1.0: sagas 714 and 704.5s (saga sacrifice), ward 702.21, daybound and nightbound 702.145, legend rule 704.5j, Aura attached illegally 704.5m, +1/+1 and -1/-1 annihilation 704.5q, APNAP trigger order 603.3b, cleanup repeat 514.3a, first-draw skip 103.8a, simultaneous loss is a draw 104.4a. All match. Escape (702.138) is not cited anywhere in PLAN.md; no card in either 75 has it.
