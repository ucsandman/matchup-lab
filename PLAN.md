# PLAN.md - Pioneer matchup solver: Rakdos Midrange vs Mono-Red Aggro

Phase 0 architecture plan. Written 2026-09-29. Source brief: docs/BRIEF.md. Per-card detail that feeds Phase 1 implementers: docs/CARD-ANALYSIS.json (56 entries, one per unique card in the two 75s).

Formatting note for implementers: this file deliberately contains no backtick characters, because its text is pasted into agent prompts. Code identifiers are written in single quotes.

---

## 1. Matchup

Format: Pioneer.

Both lists are live tournament data pulled 2026-09-29 from MTGGoldfish deck pages and cross-checked on MTGTop8; every card was verified Pioneer-legal through the Scryfall /cards/collection endpoint (decks/oracle.json carries 'legalities.pioneer' per card). Nothing came from memory. See section 9 for the choices made.

### Deck A - Rakdos Midrange (the friend's deck)

Source: https://www.mtggoldfish.com/deck/7935298 - olbeda, MTGO Pioneer Challenge 32, 2026-08-31, 17th place (4-2). The identical 75 went 5-0 in the MTGO Pioneer League on 2026-09-21 (NAKISHIMA, https://www.mtggoldfish.com/deck/7966222).

Main (60):

    4 Blackcleave Cliffs
    2 Blazemire Verge
    4 Blightstep Pathway // Searstep Pathway
    4 Blood Crypt
    1 Castle Locthwain
    2 Hive of the Eye Tyrant
    4 Mutavault
    2 Swamp
    1 Takenuma, Abandoned Mire
    1 Urborg, Tomb of Yawgmoth
    4 Bloodtithe Harvester
    1 Bonecrusher Giant // Stomp
    1 Fear of Missing Out
    2 Gifted Aetherborn
    2 Graveyard Trespasser // Graveyard Glutton
    3 Sheoldred, the Apocalypse
    4 Fable of the Mirror-Breaker // Reflection of Kiki-Jiki
    4 Unholy Annex // Ritual Chamber
    1 Liliana of the Veil
    1 Abrade
    1 Bitter Triumph
    2 Duress
    4 Fatal Push
    1 Go for the Throat
    4 Thoughtseize

Sideboard (15):

    1 Duress
    1 Extinction Event
    2 Go Blank
    1 Hidetsugu Consumes All // Vessel of the All-Consuming
    2 Invoke Despair
    1 Kalitas, Traitor of Ghet
    2 Petrified Hamlet
    1 Ray of Enfeeblement
    1 Reckoner Bankbuster
    1 Torch the Tower
    2 Unlicensed Hearse

Lands 25 (2 basic, 23 nonbasic). Creatures 12 plus 4 Fable, 1 Liliana, 4 Annex, 14 interaction/discard.

### Deck B - Mono-Red Aggro (the opponent)

Source: https://www.mtggoldfish.com/deck/7973625 - _ZNT_, MTGO Pioneer Challenge 32, 2026-09-26, 8th place (4-3). MTGTop8 files the same 75 under Red Deck Wins (https://mtgtop8.com/event?e=91333&d=893649&f=PI, sandydogmtg #14). MTGGoldfish labels it Mono-Red Prowess; see section 9.

Main (60):

    14 Mountain
    1 Den of the Bugbear
    4 Mutavault
    2 Ramunap Ruins
    1 Rockface Village
    1 Sokenzan, Crucible of Defiance
    4 Emberheart Challenger
    4 Monastery Swiftspear
    4 Screaming Nemesis
    4 Soul-Scar Mage
    4 Sunspine Lynx
    4 Kumano Faces Kakkazan // Etching of Kumano
    1 The Legend of Roku // Avatar Roku
    4 Burst Lightning
    4 Monstrous Rage
    4 Reckless Rage

Sideboard (15):

    2 Flowstone Infusion
    4 Magebane Lizard
    2 Pyroclasm
    2 Redcap Melee
    3 Scorching Shot
    2 Weathered Runestone

Lands 23 (14 basic, 9 nonbasic). 20 creatures, 5 sagas, 12 instants.

### The friend's three questions

1. Which opening 7s to keep on the play and on the draw (and what to bottom after a London mulligan).
2. How to sequence turns 1 to 3 (land order, Blood Crypt life payments, Thoughtseize vs Harvester vs holding Push).
3. When to hold up interaction (Fatal Push, Go for the Throat, Bitter Triumph, Abrade, Stomp) versus tapping out (Fable, Sheoldred, Annex, Liliana).

Every tool answers these for game 1 first (main decks only). Post-board configurations are a Phase 3+ option gated by an explicit sideboard plan file; see section 5 and section 10.

---

## 2. Non-goals

- This is not a GTO or equilibrium solver. It is a simulation-and-search decision aid: heuristic playout policies plus information-set Monte Carlo tree search over determinized samples. Nothing in code, CLI output, UI or docs may say optimal, solved, Nash, equilibrium or unexploitable. Every reported number carries its sample size and a 95 percent confidence interval, and the mulligan and spot tools print the sentence: win rates reflect heuristic play, not perfect play.
- Not a general Magic engine. Only the 56 cards in these two 75s are implemented, and only the rules those cards touch (section 4). Adding a card outside the pool is out of scope for every phase.
- Not a wrapper around Forge, XMage or any rules engine. Not a networked or multiplayer client.
- No training pipeline. Phase 6 only logs JSONL.
- No Bash anywhere in project scripts: every script in scripts/ and every npm script is PowerShell 5 compatible.

---

## 3. Card table

Every unique card in both 75s (56). Counts are main/side. Cx = complexity: trivial, simple, moderate, expensive. CR numbers marked with ? are cited from memory and must be verified against the live comprehensive rules text before they appear in a code comment (Phase 1 task T1.0 adds docs/CR.txt and a lint). Full mechanism lists, hidden-information notes and three scenario tests per card are in docs/CARD-ANALYSIS.json.

| Card | A m/s | B m/s | Mechanisms needed | CR refs (non-obvious) | Cx | Implementation proposal |
|---|---|---|---|---|---|---|
| Abrade | 1/0 | - | modal instant; 3 damage to creature or destroy artifact; targeting; fizzle | 700.2, 601.2b, 608.2b, 704.5g | simple | generic modal spell: list of modes each with target spec and resolve fn; generator emits one move per (mode, legal target); damage via dealDamage() |
| Bitter Triumph | 1/0 | - | additional cost choice (discard a card or pay 3 life); destroy creature or planeswalker | 601.2b, 118.8, 119.4, 608.2b, 704.5a | simple | two cast variants (life mode legal only at life >= 3; discard variants collapsed by card name); costs stay paid on fizzle |
| Blackcleave Cliffs | 4/0 | - | fast-land enters-tapped replacement (count other lands); B or R mana | 614.1c, 614.12, 305.2 | trivial | entersTapped predicate evaluated in the zone-move before the object hits the battlefield; dual source in payment solver |
| Blazemire Verge | 2/0 | - | two mana abilities: {B} unconditional, {R} only if you control a Swamp or a Mountain; Urborg interaction | 605.1a, 305.6, 613.1d | trivial | per-player land-subtype bitmask (Swamp, Mountain) recomputed on land zone changes and Urborg presence |
| Blightstep Pathway // Searstep Pathway | 4/0 | - | modal DFC land: face chosen on play, fixed while on battlefield; nonbasic | 712.8a, 712.12, 305.1 | simple | one card id, two play-land variants {face:B} and {face:R}; permanent stores face; never collapse the two variants |
| Blood Crypt | 4/0 | - | Swamp Mountain types (intrinsic B/R); as-enters choice: pay 2 life or enter tapped | 614.1c, 119.4, 305.6 | trivial | two play variants {pay:true} (legal at life >= 2) and {pay:false}; counts as Swamp for Castle and Verge; nonbasic for Lynx |
| Bloodtithe Harvester | 4/0 | - | ETB Blood token; {T}, sacrifice self: -X/-X, X = 2 x Blood tokens, sorcery speed; Blood token activation (pay 1, tap, discard, sac: draw) | 603.2, 602.5d, 302.6, 608.2h, 704.5f, 111.10 (Blood) | moderate | shared artifact-token def for Blood/Treasure; sacrifice paid on activation, X read at resolution; Blood discard choices collapsed by name |
| Bonecrusher Giant // Stomp | 1/0 | - | adventure (cast Stomp, exile on resolution, cast creature from exile later); becomes-the-target-of-a-spell trigger; any-target damage; damage-cannot-be-prevented flag (no-op in pool) | 715.3, 715.4, 603.2, 608.2b, 202.3 | moderate | card carries two faces plus onAdventure exile flag; trigger fires in the cast pipeline at target selection for spells only, resolves above the spell |
| Burst Lightning | - | 4/0 | kicker (optional additional cost); any-target damage 2 or 4 | 702.33, 601.2b, 115.4, 120.3, 704.5a/g/i | simple | spell object stores {kicked}; kicked variant generated only when 5 mana is available; player targets collapsed to opponent face |
| Castle Locthwain | 1/0 | - | enters tapped unless you control a Swamp; {1}{B}{B},{T}: draw then lose life = hand size | 614.1c, 119.3, 704.5a | simple | Swamp bitmask check at land play; ability on the stack; SBA check before any Sheoldred gain trigger resolves |
| Den of the Bugbear | - | 1/0 | enters tapped if 2+ other lands; {3}{R}: 3/2 Goblin land creature until EOT; attack trigger creates 1/1 Goblin tapped and attacking | 614.1c, 302.6, 613.1d, 613.4b, 508.3a, 508.4, 514.2 | moderate | shared manland overlay record {types, pt, grantedAbilities, expires:cleanup}; token enters attacking the same defender and never triggers attack triggers; animation offered only in main phase, beginning of combat, or in response |
| Duress | 2/1 | - | target opponent reveals hand; caster chooses noncreature nonland card; discard | 400.2, 701.20, 701.9, 608.2c | simple | same reveal/knownTo implementation as Thoughtseize, filter = noncreature and nonland; no life loss |
| Emberheart Challenger | - | 4/0 | haste; prowess; valiant (first time each turn it becomes target of own spell or ability): exile top card, may play until EOT | 702.10, 702.108, 207.2c, 603.2, 305.2, 400.7 | moderate | exile-permission list {cardId, controller, expiresAtCleanup}; valiant flag per permanent set when the trigger fires, reset at cleanup |
| Extinction Event | 0/1 | - | odd/even chosen on resolution; exile each creature of that parity (tokens 0, animated lands 0, transformed back faces use front MV) | 202.3, 712.8e, 700.4, 608.2 | simple | one manaValue(permanent) function; two resolution choices exposed to the generator; exile bypasses die replacements |
| Fable of the Mirror-Breaker // Reflection of Kiki-Jiki | 4/0 | - | saga (lore on ETB and precombat main, chapter triggers, sacrifice SBA); Goblin Shaman token with attack trigger making Treasure; rummage up to two; exile-and-return transformed (new object); {1},{T} copy token with haste and delayed end-step sacrifice | 714.2, 714.3a-b, 714.4, 704.5s, 712, 400.7, 302.6, 707.2, 707.9b, 111.10a, 603.7 | expensive | shared saga engine; rummage choices by distinct names capped at 20; copy = token referencing the target's def id plus {haste, sacAtNextEnd}; no counters or animation copied |
| Fatal Push | 4/0 | - | destroy creature with MV <= 2, or <= 4 with revolt; condition checked on resolution | 207.2c, 202.3, 608.2b, 701.8 | simple | per-player flag permanentLeftBattlefieldThisTurn set by any battlefield-to-elsewhere move of a permanent that player controlled; reset at turn start |
| Fear of Missing Out | 1/0 | - | ETB discard then draw; delirium (4+ card types in graveyard) intervening-if; first-attack-each-turn trigger; untap target creature; additional combat phase | 603.4, 207.2c, 205.2a, 500.8, 506-511, 701.9 | moderate | turn structure as a phase queue; trigger pushes an extra combat phase right after the current one; attackedThisTurn counter per object |
| Flowstone Infusion | - | 0/2 | +2/-2 until EOT; toughness 0 SBA; prowess/valiant on cast | 613.4c, 704.5f, 702.108 | trivial | generic until-EOT P/T delta effect; generator offers own and opposing targets, heuristic prunes suicidal own targets |
| Gifted Aetherborn | 2/0 | - | deathtouch; lifelink; trample-vs-deathtouch lethal accounting | 702.2, 702.15, 704.5h, 510.1, 702.19c, 119.7 | simple | keyword bit flags; dealDamage marks deathtouch and applies lifelink through gainLife() |
| Go Blank | 0/2 | - | target player discards two of their choice; then exile that graveyard | 701.9, 608.2c, 406 | simple | choice node over unordered pairs collapsed by name; hand of 2 or fewer discards without a choice |
| Go for the Throat | 1/0 | - | destroy nonartifact creature | 115.1, 608.2b, 700.4, 616.1 | trivial | filter at cast and resolution; destruction routed through the die choke point |
| Graveyard Trespasser // Graveyard Glutton | 2/0 | - | daybound/nightbound transform; ward (discard a card); ETB and attack trigger targeting up to one (two) graveyard cards; drain 1 per creature card | 702.21, 702.145, 731 (day/night), 712, 603.6a, 601.2c | moderate | state.dayNight plus spellsCastThisTurn per player, transition at turn start; ward as a trigger the targeting player pays or the spell/ability is countered |
| Hidetsugu Consumes All // Vessel of the All-Consuming | 0/1 | - | saga; destroy each nonland permanent MV <= 1; exile all graveyards; transform; trample; whenever-deals-damage counter trigger; 10-damage-to-a-player-this-turn lose trigger | 714, 712.8e, 400.7, 702.19, 510.1c-d, 603.4, 104.3e | expensive | reuse saga + transform path; per-source per-player damage tally recorded only for objects flagged tracksDamageDealt; sideboard-gated |
| Hive of the Eye Tyrant | 2/0 | - | enters tapped if 2+ other lands; {3}{B}: 3/3 Beholder with menace and attack trigger (exile target card from defending player's graveyard) | 614.1c, 702.111 (menace), 603.3d (trigger with no legal target is removed), 613.1d, 613.4b | moderate | shared manland overlay; menace enforced in declare-blockers validation (one blocker on a menace attacker is illegal); trigger target collapsed to count-only for B's graveyard |
| Invoke Despair | 0/2 | - | target opponent; sequential edicts creature, enchantment, planeswalker; each missing type: lose 2, caster draws | 115.1, 608.2c, 701.21, 119.3, 121.1, 714 (sagas are enchantments), Role tokens are enchantments | moderate | three sub-steps with opponent choice nodes collapsed by identical permanents; post-board only |
| Kalitas, Traitor of Ghet | 0/1 | - | would-die replacement for opponent's nontoken creatures (exile + 2/2 Zombie); lifelink; {2}{B}, sac another Vampire or Zombie: two +1/+1 counters; legendary | 614.1a, 616.1, 700.4, 702.15, 704.5j, 704.5f/g | moderate | single moveToGraveyardFromBattlefield choke point consulting an ordered replacement list; affected controller orders Kalitas vs Etching vs Torch |
| Kumano Faces Kakkazan // Etching of Kumano | - | 4/0 | saga; 1 damage to each opponent and their planeswalkers; next creature spell this turn enters with +1/+1 counter; transform; haste; would-die exile replacement keyed on per-turn damage by controller | 714, 120.3a/c, 603.7, 614.1c, 704.5q, 702.10, 400.7, 700.4, 616.1 | moderate | chapter II as a player flag consumed at cast (documented approximation); each permanent stores damagedThisTurnBy: Set of playerId cleared at turn change |
| Liliana of the Veil | 1/0 | - | planeswalker loyalty; sorcery-speed once-per-turn loyalty abilities; +1 symmetric discard (APNAP hidden choices); -2 edict; -6 pile split; attackable; damage removes loyalty; 0 loyalty SBA | 306, 606.3, 120.3c, 508.1b, 704.5i, 704.5j, 101.4 | moderate | standard planeswalker object; -6 bounded to 3 heuristic splits (lands vs nonlands, best threat alone, value-balanced) |
| Magebane Lizard | - | 0/4 | trigger when any player casts a noncreature spell; damage = that player's noncreature spells cast this turn | 601.2i, 603.2, 715.3, 709 (rooms/split), 120.3 | simple | noncreatureSpellsCastThisTurn[player] incremented on cast, not on unlock or copy; damage computed at resolution |
| Monastery Swiftspear | - | 4/0 | haste; prowess | 702.10, 702.108 | trivial | keyword flags; prowess listener on the cast event (Kumano and Monstrous Rage both count) |
| Monstrous Rage | - | 4/0 | +2/+0 until EOT; Monster Role Aura token attached (+1/+1, trample); Role uniqueness per controller; Aura falls off a non-creature | 303.4, 704.5m, 303.7a (Role uniqueness SBA), 702.19, 613.4c, 608.2b | moderate | Role = attached token object {attachedTo, roleType}; continuous-effect pass folds +1/+1 and trample into computed stats; SBA keeps newest Role per controller per host |
| Mountain | - | 14/0 | basic land; R | 305.2, 305.6, 605.1a, 106.4 | trivial | untapped Mountains fungible: one play move, payment picks any |
| Mutavault | 4/0 | 4/0 | {1}: 2/2 creature with all creature types until EOT; summoning sickness applies; dies as a land card | 302.6, 605.1a, 613.1d, 613.4b, 611.2, 514.2, 205.3m | moderate | shared manland overlay; generator prunes tapping Mutavault for its own cost when it then cannot attack or block; animation offered only when it can matter |
| Petrified Hamlet | 0/2 | - | ETB choose a land card name; non-mana activated abilities of sources with that name cannot be activated (all zones, blocks channel); lands with that name gain {T}: Add {C}; taps for C | 603.6a, 602.5, 613.1f, 201.4, 605.1a | simple | name list derived from the two 75s (Mutavault, Den, Ramunap Ruins, Sokenzan, Rockface, Castle, Hive, Takenuma); activation legality filters by source name; post-board only |
| Pyroclasm | - | 0/2 | 2 damage to each creature simultaneously; Soul-Scar replacement on A's creatures; Nemesis trigger | 307.1, 120.3, 614.1a, 704.5f/g | trivial | one damage event over all creatures through the pipeline, then one SBA pass |
| Ramunap Ruins | - | 2/0 | Desert; {T}: C; {T}, pay 1 life: R (mana ability with life cost); {2}{R}{R},{T}, sacrifice a Desert: 2 damage to each opponent (LKI source) | 605.1a, 119.4, 602.2, 113.7a, 608.2h | simple | payment solver prefers Mountains and charges the life cost as a real cost; burn activation needs 4 other mana plus itself and may sacrifice itself; damage source is a land so Soul-Scar and Magebane never apply |
| Ray of Enfeeblement | 0/1 | - | -4/-1 until EOT (-4/-4 if white); 0-power creatures deal no combat damage | 613.4c, 510.1a, 704.5f | simple | generic until-EOT delta; white branch kept correct though unreachable in this pool |
| Reckless Rage | - | 4/0 | two required targets with different restrictions (opponent creature, own creature); partial fizzle; own-creature damage triggers valiant/Nemesis | 601.2c, 608.2b, 120.3, 704.5g, 702.108, 614.1 | moderate | cross product with pruning to own targets that survive or gain value plus one sacrificial choice; uncastable with no own creature |
| Reckoner Bankbuster | 0/1 | - | Vehicle, crew 3; enters with three charge counters; {2},{T}, remove counter: draw, and on last counter Treasure + 1/1 Pilot token (crews as power +2) | 301.7, 702.122, 302.6, 122.1, 614.1c, 111.10a | moderate | vehicle = artifact with crewedUntilEOT; crew subsets minimal-sufficient and capped at 4; post-board only |
| Redcap Melee | - | 0/2 | 4 damage to creature or planeswalker; if a nonred permanent was dealt damage this way, caster sacrifices a land | 105.2, 120.3, 120.3c, 614, 608.2b | simple | pipeline returns actual damage after replacements; nonred check uses the permanent's colors (Harvester is red; Sheoldred, Trespasser, Liliana, Mutavault are not) |
| Rockface Village | - | 1/0 | {T}: C; {T}: R spendable only on creature spells; {R},{T}: target Lizard, Mouse, Otter or Raccoon +1/+0 and haste, sorcery speed | 106.6, 605.1a, 602.5d, 205.3m, 702.10 | moderate | mana pool entries tagged {color, restriction}; payment solver honours restriction; pump targets Emberheart (Mouse), Magebane (Lizard), animated Mutavault (all types) and fires valiant |
| Scorching Shot | - | 0/3 | sorcery; 5 damage to target creature | 307.1, 120.3, 614.1a, 702.21 | trivial | damage via pipeline; kills Sheoldred outright; with Soul-Scar becomes five -1/-1 counters |
| Screaming Nemesis | - | 4/0 | haste; whenever dealt damage, deals that much to any other target (one trigger per simultaneous event, LKI); player dealt damage this way cannot gain life for the rest of the game | 702.10, 603.2, 115.4, 113.7a, 119.7, 510.2, Scryfall ruling: simultaneous damage triggers once | moderate | post-damage-event hook sums damage per Nemesis and queues one trigger; Player.cantGainLife checked by gainLife() |
| Sheoldred, the Apocalypse | 3/0 | - | trigger per card drawn by you (gain 2) and by opponent (lose 2); deathtouch; legendary | 121.1-2, 603.2, 603.3b, 113.7a, 702.2, 704.5j, 103.8a | moderate | drawCard() emits one event per card; triggers are real stack objects so killing Sheoldred in response is modelled honestly |
| Sokenzan, Crucible of Defiance | - | 1/0 | legendary land; channel {3}{R} from hand at instant speed, discard as cost, cost reduced per legendary creature; two 1/1 Spirit tokens with haste until EOT | 207.2c, 602.2, 601.2f, 704.5j, 702.10, 111.1 | simple | handAbility on the card def; offered in B's precombat main, A's end step and A's declare-attackers step only |
| Soul-Scar Mage | - | 4/0 | prowess; replacement: noncombat damage from B's sources to A's creatures becomes -1/-1 counters | 702.108, 614.1a, 120.3, 122, 704.5f, 704.5q, 510.2 | moderate | dealDamage(source, target, n, isCombat) applies the replacement and returns 0 actual damage; counters persist |
| Sunspine Lynx | - | 4/0 | static: players cannot gain life; static: damage cannot be prevented (no-op); ETB: each player takes damage = their nonbasic lands; simultaneous double loss is a draw | 119.7, 615.12, 603.6a, 704.5a, 104.4a | simple | canGainLife(player) hook; basic/nonbasic flag on every land def; one damage event to both players then SBA |
| Swamp | 2/0 | - | basic land; B | 305.6 | trivial | fungible; satisfies Castle and Verge Swamp checks; not counted by Lynx |
| Takenuma, Abandoned Mire | 1/0 | - | legendary land; channel {3}{B} from hand, cost reduced per legendary creature; mill 3; return a creature or planeswalker card from graveyard to hand | 704.5j, 207.2c, 602.2, 601.2f, 701.17, 400.7 | moderate | hand-zone activated ability; milled cards public; returned card recorded in knownHandCards for the opponent's view |
| The Legend of Roku // Avatar Roku | - | 1/0 | saga; exile top 3 playable until end of your next turn; chapter II adds one mana; transform to legendary 4/4; firebending 4 (attack: add RRRR until end of combat); {8}: 4/4 flying Dragon token with firebending | 714, 305.2, 106.4, 712, 400.7, 302.6, 702.9, 704.5j, firebending 702.189 | expensive | exile permission with expiry after B's next turn; combat-scoped mana pool bucket; {8} listed whenever 8 mana is actually available, in combat after firebending or out of combat from 8 sources; chapter II any-color mana collapsed to R (D9) |
| Thoughtseize | 4/0 | - | target player reveals hand; caster chooses nonland card; discard; caster loses 2 | 400.2, 119.3, 608.2c, 701.20, 701.9 | moderate | knownTo per card instance drives the per-player view and the determinizer; choices collapsed by name |
| Torch the Tower | 0/1 | - | bargain (sacrifice artifact, enchantment or token as additional cost); 2 (3 bargained) damage to creature or planeswalker; scry 1; damaged permanent is exiled if it would die this turn | 702.166, 601.2b, 701.22, 614, 700.4, 608.2b | simple | cast variants per sacrificeable class; sacrifice sets revolt; exileIfDiesThisTurn tag read by the die choke point; post-board only |
| Unholy Annex // Ritual Chamber | 4/0 | - | Room: cast either half; unlocking a locked door is a sorcery-speed special action paying its cost; when-unlocked trigger (6/6 flying Demon); end-step draw plus drain 2 or lose 2 | 709.5 (Rooms), 116.2m, 513.1a, 702.9, 111.1, 119.3 | moderate | permanent stores unlocked {left,right}; two cast variants; unlock special action offered in main phase with empty stack, not a cast |
| Unlicensed Hearse | 0/2 | - | Vehicle, crew 2; {T}: exile up to two target cards from a single graveyard; P/T = cards exiled with it (CDA); {T} ability usable uncrewed the turn it enters, not while crewed that turn | 702.122, 604.3, 613.4a, 302.6, 400.7 | simple | exiledCount per object; targets: full enumeration for A's own graveyard, count-only collapse for B's; post-board only |
| Urborg, Tomb of Yawgmoth | 1/0 | - | every land is a Swamp in addition (both players); legendary | 305.7, 613.1d, 305.6, 704.5j | simple | urborgActive boolean consulted by hasLandType() and landManaOptions(); no general layer system |
| Weathered Runestone | - | 0/2 | static: nonland permanent cards in graveyards and libraries cannot enter the battlefield; players cannot cast from graveyards or libraries (inert in this pool); artifact target for Abrade | 604.2, 101.2 | trivial | vanilla artifact plus a guard in castSpell/putOntoBattlefield with a unit test |

### Mechanism families (which cards force shared machinery)

- Targeted removal, non-damage: Fatal Push, Go for the Throat, Bitter Triumph, Ray of Enfeeblement, Bloodtithe Harvester (-X/-X), Liliana -2, Invoke Despair, Extinction Event, Hidetsugu chapter I. Shared: the die choke point with replacement list; edict choice nodes; manaValue().
- Burn and damage spells: Abrade, Stomp, Burst Lightning, Reckless Rage, Redcap Melee, Scorching Shot, Torch the Tower, Pyroclasm, Kumano chapter I, Ramunap Ruins, Sunspine Lynx ETB, Magebane Lizard, Screaming Nemesis trigger, Bonecrusher trigger. Shared: dealDamage() with isCombat flag, replacement hooks (Soul-Scar), post-event triggers (Nemesis, Vessel), return of actual damage (Redcap, Torch tag).
- Pump and P/T modification: Monstrous Rage, Flowstone Infusion, Ray of Enfeeblement, Rockface Village pump, prowess, Kumano chapter II counters, Soul-Scar counters, Kalitas counters, Vessel counters, Hearse CDA. Shared: computed-characteristics pass (base or overlay P/T, then CDA, then counters, then until-EOT deltas, then Role).
- Creatures with keywords: haste (Swiftspear, Emberheart, Nemesis, Etching, Sokenzan tokens, Reflection copies, Rockface grant), prowess (Swiftspear, Soul-Scar, Emberheart), deathtouch (Aetherborn, Sheoldred), lifelink (Aetherborn, Kalitas), trample (Monster Role, Vessel), menace (Hive), flying (Demon token, Dragon token), ward (Trespasser), valiant (Emberheart).
- Sagas and transforming DFCs: Fable, Kumano, Hidetsugu, The Legend of Roku (sagas); Graveyard Trespasser (daybound); Blightstep Pathway (MDFC land). Shared: saga engine (lore counter on ETB and at precombat main, chapter triggers, final-chapter sacrifice SBA), exile-and-return-transformed path, face-index characteristics.
- Tokens: Blood, Treasure, Goblin Shaman, Zombie, Spirit, Goblin (Den), Pilot, Demon, Dragon, Monster Role, Reflection copies. Shared: token defs table; tokens cease to exist off the battlefield (704.5d); MV 0 except copies.
- Hand disclosure and hidden information: Thoughtseize, Duress, Liliana +1, Go Blank, Fable chapter II discards, Blood discards, ward discards, FOMO discard, Takenuma mill and return, Roku chapter I, Emberheart valiant, Torch scry, Castle and Bankbuster and Annex draws. Shared: knownTo set per card instance, per-player view, determinizer conditioning.
- Planeswalkers: Liliana of the Veil only. Forces loyalty, attacking planeswalkers, damage-to-loyalty, 704.5i, Kumano chapter I planeswalker damage.
- Vehicles: Reckoner Bankbuster (crew 3), Unlicensed Hearse (crew 2). Post-board only.
- Lands: basics (Swamp, Mountain), shock (Blood Crypt), fast (Blackcleave Cliffs), verge (Blazemire Verge), pathway (Blightstep), castle (Castle Locthwain), manlands (Mutavault x2 decks, Hive, Den), channel lands (Takenuma, Sokenzan), Urborg, Ramunap Ruins, Rockface Village, Petrified Hamlet. Shared: land-subtype bitmask, enters-tapped predicates, manland overlay, mana abilities with side costs and restrictions.
- Rooms and adventures: Unholy Annex // Ritual Chamber (room), Bonecrusher Giant // Stomp (adventure). Both are split-style cards with a chosen half and a later second use.
- Turn-structure modifiers: Fear of Missing Out (extra combat) is the only one; it forces the phase queue.
- Statics that switch off other cards: Sunspine Lynx and Screaming Nemesis (life gain), Weathered Runestone (inert), Petrified Hamlet (named activations), Urborg (land types), Soul-Scar Mage (replacement), Etching of Kumano and Kalitas (die replacements).

---

## 4. Rules scope

### Required (with the cards that force each area)

- Turn structure with a phase queue: untap, upkeep, draw, precombat main, combat (beginning, declare attackers, declare blockers, combat damage, end), postcombat main, end step, cleanup. Forced by every card; the queue form is forced by Fear of Missing Out (extra combat, 500.8) and by cleanup-step repeat when triggers fire during cleanup (514.3a: Emberheart permissions expiring, Role falling off manlands).
- Priority passing and the stack: both players pass in succession to resolve; active player receives priority after resolution. Forced by every instant and trigger; the hold-up-interaction question is answered only if responses to sorcery-speed activations (Bloodtithe Harvester) and triggers (Sheoldred, prowess) are real.
- State-based actions, in one loop until stable: 0 life (704.5a), draw from empty library (704.5b), lethal damage and toughness 0 (704.5f/g), deathtouch (704.5h), 0 loyalty (704.5i), legend rule (704.5j: Sheoldred, Kalitas, Liliana, Avatar Roku, Takenuma, Sokenzan, Urborg), Aura attached illegally (704.5m: Monster Role on a land that stopped being a creature), tokens outside the battlefield (704.5d), +1/+1 and -1/-1 annihilation (704.5q: Kumano II vs Soul-Scar), saga final chapter (704.5s), Role uniqueness, simultaneous double loss is a draw (104.4a: Sunspine Lynx ETB).
- Combat: declare attackers (players and Liliana as defenders), declare blockers with menace validation (Hive), single combat damage step (no first strike in the pool), damage assignment order for trample (Monster Role, Vessel) including deathtouch lethal accounting (Aetherborn, Sheoldred), lifelink simultaneous with damage, attack triggers (Goblin Shaman, Den, Hive, Trespasser, FOMO, firebending), creatures entering tapped and attacking (Den token), extra combat phase (FOMO), summoning sickness (302.6) for animated lands and transformed sagas.
- Triggered abilities with APNAP ordering (603.3b) and controller-chosen order among own simultaneous triggers (e.g. prowess plus valiant, Sheoldred plus Annex end step): forced by Swiftspear, Soul-Scar, Emberheart, Sheoldred, Nemesis, Annex, sagas. Intervening-if (603.4): FOMO delirium, Vessel lose trigger. Delayed triggers (603.7): Reflection copy sacrifice, Kumano chapter II. Triggers with no legal target are removed (603.3d): Hive.
- Replacement effects present in the pool: enters-tapped and enters-with-counters (Blackcleave, Blood Crypt, Castle, Hive, Den, Bankbuster, Kumano II), would-die-to-exile (Kalitas, Etching of Kumano, Torch the Tower) with affected-controller ordering (616.1), noncombat damage to -1/-1 counters (Soul-Scar Mage), cannot gain life (Nemesis flag, Sunspine Lynx static; implemented as a hook in gainLife rather than a general replacement).
- Costs: mana with colored requirements, additional costs (Bitter Triumph choice, kicker, bargain), tap and sacrifice costs (Harvester, Blood, Treasure, Ramunap, Kalitas, Hearse), life costs (Blood Crypt, Ramunap, Bitter Triumph), discard-as-cost (channel, Blood), cost reductions (channel), remove-a-counter (Bankbuster), crew (Bankbuster, Hearse), restricted mana (Rockface), mana that lasts until end of combat (firebending).
- Targeting: creature, player, planeswalker, any target, artifact, card in graveyard, up-to-N targets, two required targets with distinct restrictions (Reckless Rage), becomes-the-target events (Bonecrusher, Emberheart valiant, ward), legality recheck on resolution with partial fizzle (608.2b).
- Mana abilities that do not use the stack (605), including ones with life costs (Ramunap) and conditions (Verge, Castle untapped check is not a mana ability but reads the same bitmask), a payment solver that collapses identical sources and prefers unrestricted, costless sources.
- Modal spells (Abrade), kicker (Burst Lightning), adventure (Bonecrusher), rooms and door unlocking (Annex), channel from hand (Takenuma, Sokenzan), MDFC face choice (Pathway), sagas and transform (four sagas, Trespasser daybound), day/night (Trespasser), planeswalker loyalty (Liliana), vehicles and crew (Bankbuster, Hearse; post-board), copy tokens with exceptions (Reflection), Role Aura tokens (Monstrous Rage), exile-and-play permissions with expiry (Emberheart, Roku), card-type counting (FOMO delirium), mana value of tokens, animated lands, transformed back faces and Rooms (Fatal Push, Extinction Event, Hidetsugu I).
- London mulligan (103.5, verified in T1.0): draw 7, bottom N; the mulligan tool needs the bottom choice exposed as a decision, and the bottomed cards stay known to their owner as the bottom of the library (section 6, Per-player view).
- Hidden zones and per-player view (400.2): hand and library hidden; graveyard, exile (all exile in this pool is face up), battlefield, stack, life, counters, day/night, cantGainLife flags public; knownTo tracking for revealed cards; per-owner library-position knowledge (London mulligan bottoms, Torch the Tower scry 1); the determinizer conditions on the view only.
- Life gain and life loss as distinct from damage (119): Thoughtseize, Castle, Annex, Sheoldred, Trespasser drain, Invoke Despair.
- Draw events one card at a time (121.2): Sheoldred.
- Continuous effects, simplified: a fixed evaluation order covering only what the pool needs: (1) copy values at token creation (Reflection), (2) type and subtype additions (Urborg, manland overlays, Mutavault all creature types), (3) ability additions and removals (manland granted abilities, Rockface haste, Petrified Hamlet grant and restriction), (4) P/T: overlay base, then CDA (Hearse), then counters, then until-EOT deltas, then Role. Timestamps are only needed within category 4 for nothing in this pool (all deltas are additive), so no timestamp system.

### Skipped (no card in the pool touches them)

- First strike and double strike (no such creature; one combat damage step). Vigilance, reach, flash, defender, hexproof, shroud, protection, indestructible, regeneration, fear/intimidate, skulk, flying beyond flying-vs-nonflying blocking (no reach exists).
- Damage prevention (no prevention effect exists; Stomp and Sunspine Lynx cannot-be-prevented clauses are implemented as a flag nothing reads, with a test that greps oracle.json for prevention text).
- Counterspells and countering spells generally (only ward can counter, and only the targeting spell or ability).
- Copying spells (707 for spells), split second, morph, cascade, storm, suspend, phasing, banding, mutate, companion, partner, dungeons, initiative, monarch, battles, emblems (Liliana -6 makes none), energy, poison, snow, hybrid and Phyrexian mana, X in mana costs (Bloodtithe's X is not a cost), mana burn.
- Control-changing effects (layer 2), text-changing effects (layer 3), copy effects on permanents already on the battlefield, timestamps and dependency (613.7-613.8) beyond the fixed order above.
- Library manipulation beyond mill 3 (Takenuma), scry 1 (Torch), exile top N (Roku, Emberheart): no shuffle after game start and mulligan, no tutors, no reordering, no library-from-top casting (Weathered Runestone is inert).
- Extra turns, skipping steps other than the first draw on the play (103.8a), upkeep costs, cumulative upkeep.
- Auras cast from hand, equipment, attachment rules beyond Role tokens (only 704.5m and Role uniqueness).
- Multiplayer, sideboarding rules beyond loading a configured 60 (no in-engine sideboarding UI).
- Face-down objects, commander, casting from graveyard, alternate costs (none: kicker and bargain are additional costs).

---

## 5. Expensive cards

| Card | Why it is costly | Bounding strategy | What is lost |
|---|---|---|---|
| Fable of the Mirror-Breaker // Reflection of Kiki-Jiki | saga engine, token with granted attack trigger, Treasure, rummage branching (subsets of hand), transform, copy token with haste plus delayed sacrifice | rummage options enumerated by distinct card names and capped at 20 ranked by heuristic (excess lands first, then dead cards); copy = token referencing the target's def id with {haste, sacAtNextEnd}; legal copy targets are the finite known set; animated Mutavault target pruned | rare lines where the capped rummage set omits the best discard; documented cap in README |
| The Legend of Roku // Avatar Roku | impulse exile with two-turn expiry, chapter mana, transform to legendary, firebending combat mana, {8} token ability | exile permissions with expiresAfterTurn; chapter II mana added as R (B has only red costs; documented collapse); {8} offered whenever 8 mana is actually available: in combat after firebending resolves, or out of combat from 8 untapped sources | chapter II any-color mana collapsed to R, which changes no game because every cost in B's 75 is red or generic (still listed in D9, since it would matter for another list); nothing else; one-of so correctness over speed |
| Hidetsugu Consumes All // Vessel of the All-Consuming | saga plus mass destroy by MV, exile graveyards, transform, per-source per-player damage tally, lose-the-game trigger | tally recorded only for objects flagged tracksDamageDealt; sideboard-gated so game-1 sims never load it | nothing; if Phase 1 schedule slips it is excluded from post-board configs and README says post-board results omit it |
| Liliana of the Veil (-6) | pile split is exponential | three heuristic splits only (lands vs nonlands, best threat alone vs rest, greedy value-balanced) | A may miss the best split; reaching 6 loyalty vs mono-red is rare, so win rates barely move; documented |
| Reckless Rage | branching = opposing creatures x own creatures | prune own targets to those that survive or gain value (prowess-boosted, Nemesis, valiant Emberheart) plus one sacrificial choice; collapse identical tokens | odd self-kill lines nobody plays |
| Fear of Missing Out | extra combat phase forces a phase queue instead of a fixed enum | phase queue is built once in Phase 1 and used by everything; trigger pushes one combat phase | nothing |
| Graveyard Trespasser // Graveyard Glutton | day/night global state, ward with discard, up-to-N graveyard targets | ETB/attack targets collapsed to creature cards plus none (noncreature exile changes nothing in this pool); day/night as a single state field transitioned at turn start | exiling a noncreature card is never offered |
| Unholy Annex // Ritual Chamber | room state, unlock special action, end-step conditional trigger | unlocked {left,right} on the permanent; unlock offered only with empty stack in a main phase | nothing material |
| Reckoner Bankbuster and Unlicensed Hearse | crew subset enumeration, Pilot crew bonus, Hearse CDA | minimal-sufficient crew subsets capped at 4; Hearse graveyard targets count-only for B's graveyard; both post-board only, stubbed out of game-1 | none for game 1; post-board crew choices slightly narrowed |
| Kumano chapter II | delayed trigger on next creature spell | applied as a player flag consumed at cast time instead of a trigger on the stack | the response window to that trigger, which no card in either 75 can use |
| Bonecrusher Giant // Stomp | adventure zone flag and spells-only targeting trigger | onAdventure flag on the exiled card; trigger fires from the cast pipeline only | nothing |
| Petrified Hamlet | choose-a-name is open-ended in real Magic | name list restricted to lands with non-mana activated abilities in the two 75s | a small information overstatement (A is assumed to know B's list, which the whole project assumes anyway) |

Also flagged for the payment solver: Treasure and Blood mana sources and Ramunap's life-costed R are used only when lands cannot pay, to avoid spurious branching; Rockface restricted R is used first for creature spells.

---

## 6. Architecture

Stack: TypeScript 7 strict (tsconfig already has strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes), Node 22+, ESM, vitest 5, tsx for scripts, worker_threads for parallel simulation. No runtime dependencies. All project scripts are PowerShell (scripts/*.ps1) or npm scripts that invoke node directly.

### GameState: plain data

'GameState' is a JSON-serializable object. No class instances, no functions, no Maps or Sets in state (arrays and plain objects only) so that structuredClone, JSON round trips and worker postMessage are all exact.

    interface GameState {
      seed: RngState;                 // xoshiro128** state, 4 x uint32; game-private, never in a view
      nextId: number;                 // next fresh ObjId (see Determinism); never in a view
      journal?: Inverse[];            // journal-mode inverse log (see below); absent in copy mode; never in a view
      turn: number; activePlayer: 0|1; priority: 0|1;
      phaseQueue: Phase[];            // remaining phases/steps of this turn; FOMO inserts here
      step: Step;                     // current step
      players: [PlayerState, PlayerState];
      objects: Record<ObjId, GameObject>;   // every card instance and token, keyed by numeric id
      zones: { library: [ObjId[], ObjId[]], hand: ..., graveyard: ..., exile: ..., battlefield: ObjId[], stack: StackItem[] };
      dayNight: 'none'|'day'|'night';
      turnFlags: { landsPlayed:[n,n], spellsCast:[n,n], noncreatureSpellsCast:[n,n], permanentLeft:[bool,bool], nextCreatureBonus:[bool,bool], damageTally: Record<ObjId, [n,n]> };
      effects: ContinuousEffect[];    // until-EOT deltas, manland overlays, Role links, exile permissions, exileIfDies tags
      pendingChoice: Choice | null;   // when the engine needs a decision, it stops here
      result: null | { winner: 0|1|'draw', reason: string };
      log?: LogEntry[];               // optional transcript, off in playouts; never in a view
    }

    interface GameObject {
      id: ObjId; defId: DefId; face: 0|1; owner: 0|1; controller: 0|1; zone: Zone;
      tapped: boolean; damage: number; counters: Record<CounterType, number>;
      sick: boolean;  // controlled continuously since turn start = false
      knownTo: [boolean, boolean];    // identity visible to player 0 / player 1
      token?: TokenDefId; copyOf?: DefId; attachedTo?: ObjId; unlocked?: [boolean, boolean]; onAdventure?: boolean;
      lore?: number; loyalty?: number; exiledWith?: number; damagedThisTurnBy: [boolean, boolean]; valiantUsed?: boolean; attacksThisTurn?: number;
      attacking?: Defender; blocking?: ObjId[]; animated?: Overlay; crewed?: boolean; chosenName?: string;
    }

PlayerState: life, cantGainLife, manaPool (entries {color, restriction?, expires?}), mulligans, libraryKnown {top: ObjId[], bottom: ObjId[]} (positions of the player's own library that the player knows: London mulligan bottoms in the chosen order, a scry-1 card kept on top or sent to the bottom; draws, mill and exile-from-top pop the known top, a shuffle clears both), knownHandCards is derived from knownTo rather than stored twice.

### Pure step functions with apply and undo

The engine exposes two entry points:

- 'legalMoves(state, player): Move[]' - the move generator (section below).
- 'applyMove(state, move): GameState' - runs the move, then advances the game (triggers, SBAs, priority passes, turn-based actions) until a player has a real decision (a Choice), and returns the resulting state.

Two execution modes, chosen by the caller:

1. Copy mode: applyMove returns a new state produced by copying the input first (structuredClone or a hand-written shallow-plus-dirty-set clone, whichever benchmarks faster in Phase 1). Used by the tree search at node expansion, so a node holds its own state and branches are free of aliasing bugs.
2. Journal mode: all state mutation goes through a small set of primitive mutators in engine/mutate.ts (setField, pushZone, removeZone, addCounter, addEffect, removeEffect, setPool). Each primitive appends its inverse to 'state.journal' when journaling is on; 'undoTo(state, mark)' pops inverses back to the mark. Used by ISMCTS descents and by playouts so a determinized sample can be searched and rewound without cloning per move.

Both modes run the same code. A Phase 1 test applies 10,000 random moves in journal mode with undo after each and asserts the state equals a structuredClone taken before, to prove the journal is complete (L1: the test must be seen failing first by deliberately dropping one inverse).

Determinism: the engine never reads Math.random, Date or object iteration order that depends on insertion of non-numeric keys. Object ids are sequential integers assigned from 'state.nextId', and they carry no card identity: the opening library is shuffled before any id is assigned (ids follow shuffled order, never decklist order), every mulligan reshuffle re-ids the library, and every zone change gives the object a fresh id because it is a new object (400.7). The per-player view adds a second layer (opaque view ids, below).

### Seeded RNG

xoshiro128** (Blackman and Vigna) on four uint32 words, seeded from a 64-bit integer through splitmix32. Provides 'nextU32()', 'nextFloat()', 'nextInt(n)' and 'jump()' for 2^64 independent streams, one per worker. RNG state lives in GameState so a serialized state replays identically. It is game-private: the per-player view drops it, because xoshiro128** is invertible and a view carrying it would reveal the library order. Agents and the determinizer never draw from 'state.seed': each agent owns its own xoshiro128** stream, seeded by the runner and jump()-separated from the game stream, and a determinized sample gets a fresh game seed from the searcher's stream. A replay records the game seed plus each agent seed. Shuffles use Fisher-Yates with nextInt. The only random events in the game stream are the opening shuffle, mulligan shuffles and the die roll for play/draw; agent choices (random agent, MCTS rollouts) use the agents' own streams; every card effect is deterministic given the library order.

### Card definitions

One file per card in src/cards/defs/, kebab-case named after the front face (bloodtithe-harvester.ts, blightstep-pathway.ts). A def is data plus named effect functions registered in a registry keyed by 'defId:faceIndex:abilityIndex', so state references abilities by key and stays serializable.

    export const BloodtitheHarvester: CardDef = {
      name: 'Bloodtithe Harvester',
      faces: [{
        types: ['Creature'], subtypes: ['Vampire'], cost: '{B}{R}', colors: ['B','R'], pt: [3,2],
        keywords: [],
        abilities: [
          trig('etb', (ctx) => ctx.createToken('Blood', ctx.controller)),
          act({ cost: { tap: true, sacrificeSelf: true }, timing: 'sorcery', target: t.creature(),
                resolve: (ctx, tgt) => ctx.addEotDelta(tgt, -2 * ctx.count('Blood', ctx.controller), same) }),
        ],
      }],
    };

Helper constructors: 'trig(event, filter?, effect)' for triggered abilities, 'act(spec)' for activated, 'stat(spec)' for statics and replacements, 'spell(spec)' for instants and sorceries with modes and targets, 'land(spec)' with entersTapped predicate and mana options, 'saga([ch1, ch2, ch3])', 'room(left, right)', 'adventure(creatureFace, adventureFace)'. Triggers register by event name; at battlefield changes the engine rebuilds a per-event index of (objectId, abilityKey) so trigger checks are O(listeners) not O(permanents). Static effects register by category (typeAdd, abilityAdd, ptDelta, activationRestriction, cantGainLife, damageReplacement, dieReplacement) and are re-evaluated on read through the characteristics function with a per-state memo invalidated on any battlefield or effects change.

Token defs live in src/cards/tokens.ts (Blood, Treasure, GoblinShaman, Zombie, Spirit, Goblin, Pilot, Demon, Dragon, MonsterRole, Copy).

A generator script scripts/check-cards.ps1 asserts that every name in decks/*.json has a def and that every def's cost, types and P/T match decks/oracle.json (so a typo in a def fails CI, and the oracle file stays the source of truth for characteristics).

### Move generator with choice collapsing

'legalMoves' returns Move objects: playLand {objId, face?, pay?}, cast {objId, half?, mode?, kicked?, bargain?, costChoice?, targets[]}, activate {objId, abilityKey, targets[], crewWith?}, unlockDoor, declareAttackers {assignments}, declareBlockers {assignments}, chooseTargets for triggers, respond-to-choice (discard which, sacrifice which, order triggers, odd/even, pile choice, mulligan bottom), pass.

Collapsing rules (each is a unit test):
- Identical untapped lands and identical tokens are one move (by defId, face, tapped, counters, attachments, animation).
- Hand cards collapse by name for discard, reveal-choice and rummage choices.
- Mana payment is a solver, not a move: given a cost and the pool plus untapped sources, it picks a canonical payment (basics before duals, unrestricted before restricted, costless before life-costed, lands before Treasure and Blood) and exposes an alternative only when it changes the future (e.g. leaving B vs R open); each alternative is a distinct move only if the residual untapped-source multiset differs.
- Player targets collapse to the opponent unless targeting self is the only legal choice.
- Attack declarations enumerate subsets of eligible attackers collapsed by identical creatures; blocks enumerate assignments with menace and trample constraints applied; a per-phase cap (default 64 attack subsets, 64 block assignments, heuristic-ranked) protects the fuzzer and the search.
- Activations that can only matter in certain windows (manland animation, Sokenzan channel, Bankbuster draw) are offered only in those windows (documented per card in section 3).

### Per-player view

'view(state, player): PlayerView' returns a copy built by these rules. (1) Game-private fields are dropped: seed, nextId, journal and log. (2) Every object whose zone is hidden and whose knownTo[player] is false is replaced by {vid, zone, owner, hidden:true}, where vid is an opaque id local to this view (assigned per call in zone order: h0, h1, ...), never the real ObjId; a real id appears only for public or known objects, and 400.7 re-id on zone change cuts any link to the object's hidden past. (3) A library appears as its size plus, for the viewer's own library only, the known positions from libraryKnown (known top cards, known bottom cards in order); all other library order is absent. (4) The opponent's hand is a list of known cards plus an unknown count. (5) Everything public (battlefield, stack, graveyards, exile, life, counters, flags, day/night, revealed cards) is included verbatim. The determinizer takes a PlayerView plus both decklists, pins the known library positions, and samples only the unknown slots from the remaining 75 minus every public and known card. Phase 1 leak tests: (a) serialize view(state, A) and check that no defId of a card hidden from A, no real ObjId of an object hidden from A, and no seed, nextId, journal or log key appears anywhere in it; (b) indistinguishability: build S' from S by permuting the defIds and the real ids among the objects hidden from A, reordering the unknown part of both libraries and replacing the seed, then assert view(S', A) is byte-identical to view(S, A); (c) own knowledge kept: after a London mulligan to 6, and after a Torch the Tower scry to top, view(state, A) shows the bottomed card at the bottom and the scried card on top.

### Parallel simulation

src/sim/runner.ts spawns N worker_threads (N = os.availableParallelism() - 1 by default). Each worker receives {deckA, deckB, agentA, agentB, seedStream, games} and returns {wins, losses, draws, turns[], killTurns[], keyCardOnlineByTurn}. RNG streams are jump()-separated per worker. Every number carries n and a 95 percent interval (brief rule 1): proportions (win rate, key card online by turn N) use Wilson score intervals; means (average kill turn, game length in turns) use a Student t interval (mean plus or minus t x s / root n), with average kill turn computed over the games that ended in a kill and its own n printed; medians and percentiles (p50 and p95 game length) use a distribution-free order-statistic interval. The CLI prints n, the estimate, its CI, and games per second per core (total games / (wall seconds x workers)).

### Directory layout

    src/
      engine/
        types.ts        GameState, GameObject, Move, Choice, Effect types
        rng.ts          xoshiro128**, splitmix32 seeding, jump
        mutate.ts       primitive mutators plus journal and undo
        zones.ts        moveObject, createToken, die choke point with replacement list
        mana.ts         pool, mana abilities, payment solver
        cost.ts         additional costs, cost reductions, life and sacrifice costs
        stack.ts        casting, activation, resolution, fizzle
        targets.ts      target specs and legality
        triggers.ts     event bus, per-event index, APNAP ordering
        statics.ts      characteristics function and continuous effects
        damage.ts       dealDamage pipeline, replacements, post-event triggers
        life.ts         gainLife, loseLife, cantGainLife hook
        combat.ts       attackers, blockers, menace, trample, deathtouch, lifelink
        sba.ts          state-based action loop
        turn.ts         phase queue, turn-based actions, day/night transition, cleanup
        saga.ts         lore counters and chapters
        moves.ts        legal move generator with collapsing
        apply.ts        applyMove in copy and journal modes
        view.ts         per-player view
        mulligan.ts     London mulligan
        setup.ts        newGame(deckA, deckB, seed, onThePlay)
      cards/
        index.ts        registry
        dsl.ts          trig, act, stat, spell, land, saga, room, adventure helpers
        tokens.ts
        defs/           one file per card (56)
      agents/
        types.ts random.ts greedy.ts ismcts.ts determinize.ts
      sim/
        runner.ts worker.ts stats.ts (Wilson CI for proportions, t interval for means, order-statistic interval for medians, two-proportion z-test, sequential stopping with a too-close-to-call verdict)
      tools/
        fuzz.ts bench.ts goldfish.ts
      cli/
        index.ts hand.ts spot.ts match.ts
      test/
        helpers.ts      state builders (given battlefield, hand, etc.)
        cards/          one scenario file per card (from docs/CARD-ANALYSIS.json)
        rules/          turn, priority, stack, sba, combat, triggers, replacements, mulligan, view, collapse
        fuzz.test.ts    100k-game invariant run (tagged slow; 10k in the default suite)
    decks/  deckA.json deckB.json oracle.json sideboard-plans.json (Phase 3+)
    docs/   BRIEF.md CARD-ANALYSIS.json CR.txt (Phase 1) RULES-NOTES.md
    scripts/ check-cards.ps1 fuzz.ps1 bench.ps1 (PowerShell wrappers around npm scripts)
    web/    Phase 5 local UI (static HTML plus a small Node server)

---

## 7. Test plan

Vitest, all tests under src/. Every ambiguous interaction gets a CR citation in a code comment and a test (brief rule 2). Every check that can pass on zero work prints its count (L2).

### Phase 1 (engine)

- Card scenario tests: at least one per card, taken from docs/CARD-ANALYSIS.json (three are listed per card; the first is mandatory, the others are implemented as time allows and tracked in a coverage table generated by scripts/check-cards.ps1 which fails if any card has zero scenario tests).
- Rules tests: turn structure and phase queue, priority passing, stack resolution order, SBA loop (each 704.5 case listed in section 4), combat (menace, trample plus deathtouch, lifelink timing, Den token entering attacking, extra combat, summoning sickness of animated lands), APNAP trigger ordering, intervening-if, delayed triggers, replacement ordering (616.1 with Kalitas vs Etching vs Torch), day/night transitions, London mulligan, per-player view leak test, determinism (same seed and same move list produce byte-identical state), journal completeness (10,000 random apply/undo pairs), move collapsing (identical lands, identical tokens, name-collapsed discards, payment alternatives).
- Cross-card interaction tests: every bullet in the CROSS-CARD INTERACTIONS list that names two cards from the same game-1 pool gets a test in src/test/rules/interactions.test.ts (Nemesis vs non-damage removal, Soul-Scar vs Etching, prowess plus valiant ordering, Sheoldred trigger surviving her death, Lynx double-loss draw, Urborg plus Castle and Verge, Blackcleave sequencing).
- Pool assertions: no card has first strike, flash, hexproof, protection, reach, vigilance or damage prevention (grep over oracle.json, so a future list change re-opens the scope decision).
- Fuzz: 100,000 random-vs-random games (npm run fuzz; 10,000 in the default vitest suite) with invariants checked after every applyMove:
  1. Card conservation: for each player, nontoken objects across library + hand + graveyard + exile + battlefield + stack + on-adventure exile = 60 (or the configured 75 post-board); tokens only ever on the battlefield.
  2. Zone consistency: each object appears in exactly one zone array and object.zone matches it.
  3. No tapped, damaged, attacking, animated or attached object outside the battlefield; no counters on cards in hand or library; no lore counters off the battlefield.
  4. Life, loyalty, counters and pool amounts are finite integers; hand and library sizes are non-negative.
  5. Stack empty at the start of every step and phase transition; priority holder is a valid player; pendingChoice is null when the game has a result.
  6. Every game terminates, with zero cap hits allowed. Caps: 1,000 applyMove calls within one turn (catches the realistic hang, a priority or response loop or repeated activations inside one turn), 20,000 applyMove calls per game, and 200 turns as a backstop (decking already bounds a game near 60 turns); applyMove also caps its internal advance loop (triggers, SBAs, passes) at 10,000 iterations per call. A cap trip is an invariant failure, never a draw: the run fails and writes the seed, agent seeds and move list for replay.
  7. Determinism: the first 1,000 fuzz games are replayed from seed and compared move by move.
  8. View leak: every 100th state, view(state, p) contains no hidden identity for either p.
  The fuzz report prints games, moves, cap hits (must be 0), mean and max turn count, max moves in one turn, and time.
- Performance: 'npm run bench' plays 10,000 random-vs-random games on one worker, five runs, and prints the median games per second per core with the five-run min to max as its interval (n = 5 runs; a 94 percent order-statistic interval for the median) plus p50 and p95 game length in moves with their order-statistic intervals. Target: at least 1,000 games/sec/core after Phase 1 profiling (stretch 3,000). The number is written into CHANGELOG with the machine it was measured on. Hot paths expected: characteristics memo, legal move generation for attacks and blocks, payment solver, structuredClone in copy mode. Profile with node --cpu-prof before optimizing.

### Phase 2 (agents)

- Random agent picks uniformly; greedy agent is deterministic given state and seed. Tests: greedy never picks an illegal move (1,000 games), greedy beats random at least 80 percent over 2,000 games per side (a floor, printed with CI), greedy vs greedy game length distribution is sane (median under 12 turns for this matchup).

### Phase 3 (mulligan and goldfish)

- London mulligan correctness (7 draws, bottom N, hand size), CI math (Wilson and t interval unit tests against known values), sequential stopping (stops when the keep and mull intervals separate, or at max n with a 'too close to call' verdict that prints both intervals; a test covers each exit), goldfish metrics computed on a known scripted game, output contains the heuristic-play sentence, sample sizes and CIs on every number.

### Phase 4 (ISMCTS)

- Determinizer samples are consistent with the view (never contradicts a known card, sums to the right library size, pins known library positions: London mulligan bottoms stay at the bottom and a scried-to-top card is the next draw in every sample, so no sampled future draws a bottomed card before the unknown slots run out; each sample is seeded from the searcher's own stream, since the view carries no seed), UCT math, node reuse across samples, top lines with visits and CI. Acceptance run: ISMCTS beats greedy over at least 1,000 games per side with a two-proportion z-test p < 0.01 (both sides reported).

### Phase 5 and 6

- CLI: each command produces expected JSON and text for fixture inputs. Web UI (only if built): a Playwright headless script sets up a board by clicking, runs an analysis, and reads the result panel. JSONL logging: schema test and round trip.

---

## 8. Phase plan and acceptance gates

- Phase 0 (this document). Gate: PLAN.md, CHANGELOG.md, docs/CARD-ANALYSIS.json exist; every deck card name appears in the card table (verified by a node one-liner, count printed).
- Phase 1 rules engine. T1.0: download the comprehensive rules text to docs/CR.txt and add a lint that every CR number cited in a code comment resolves to a rule in docs/CR.txt and that the citation's topic words (format: CR 103.5 (mulligan)) appear in that rule's text, so a wrong number that happens to exist also fails; resolve the ? marks in sections 3 and 4. T1.1 types, rng, mutate, zones, mana, stack, triggers, statics, damage, life, combat, sba, turn, saga, moves, view, mulligan, setup. T1.2 the 40 unique main-deck (game-1) cards, then the 16 sideboard-only cards behind a sideboard config (56 total). T1.3 scenario tests, rules tests, interaction tests. T1.4 fuzz 100k and bench. Gate: all tests green, fuzz 100k with zero invariant failures and zero cap hits, bench number recorded, games/sec/core at or above target or a written profiling report showing what was tried.
- Phase 2 baseline agents. Random and greedy per deck (greedy uses a hand-written evaluation: life race, board power, cards in hand, mana efficiency, plus card-specific heuristics from section 3). Gate: greedy beats random with CI as in section 7; both agents run under the worker runner; agent-vs-agent CLI prints n, win rate, CI, games/sec/core.
- Phase 3 mulligan and goldfish tool. Input: opening 7, play or draw, mulligan count; London mulligan bottoming as a decision the greedy agent makes; simulate against the greedy Mono-Red agent until the keep and mull intervals separate or n hits the cap, in which case the verdict is 'too close to call' with both intervals shown; report win rate, CI, n, average kill turn with its t interval and n, key-card-online-by-turn-N (Fable by 3, Sheoldred by 4, removal by 2), and the heuristic-play sentence. Gate: tool answers the friend's question 1 for any 7 in under 60 seconds on 8 cores with a stated CI; tests in section 7.
- Phase 4 spot analyzer. ISMCTS with determinization from a PlayerView JSON; output top lines with win rate, visits, CI; README documents the determinization weakness (strategy fusion and non-locality: it may play as if it knew the hidden cards). Gate: beats greedy over at least 1,000 games per side, significant at p < 0.01, result printed with both CIs and recorded in CHANGELOG.
- Phase 5 interface. CLI: hand (Phase 3), spot (Phase 4), match (agent vs agent N games). Then a local web UI (static page served by a tiny Node server, no framework) where the friend builds a board state by clicking card images from the two lists, sets life, turn, play/draw, and runs the analyzer. Gate: the three CLI commands run from README copy-paste in PowerShell on a clean clone. The web UI is optional ('if time allows' in the brief): if built, it renders real analyzer output and passes the Playwright smoke; if not built, README says so.
- Phase 6 stretch. Self-play logging to JSONL: state (PlayerView), legal moves, chosen move, search stats, final outcome. Gate: schema documented, 10,000-game log produced, no training code.
- Final README (brief rule 4), after Phase 5 whether or not Phase 6 runs. Gate: README.md written for a Magic player who does not code, with one section per tool (hand, spot, match, and the web UI if built) giving a PowerShell copy-paste command, a sample output with how to read n and the CI, and the tool's limits (win rates reflect heuristic play, not perfect play; the determinization weakness; the D9 approximations; game 1 only unless a sideboard plan is loaded); every command in it is run on a clean clone and its output checked.

Status at release 0.1.0 (2026-09-30; evidence lines are in CHANGELOG.md under 0.1.0):
- Phase 0: done. Gate evidence: CHANGELOG Added, the Phase 0 lines and the Phase 0 gate recheck in the Final gate line (56 of 56 decklist names in the card table).
- Phase 1: done through the profiling-report branch of the gate. Gate evidence: CHANGELOG Added, T1.4 fuzz (100,000 games, 0 invariant failures, 0 cap hits) and the T1.4 and T1.5 bench lines; the 1,000 games/sec/core target is not met, the written profiling report is docs/PERF.md (D23).
- Phase 2: done. Gate evidence: CHANGELOG Added, Phase 2 gate results and Phase 2 gate check.
- Phase 3: done. Gate evidence: CHANGELOG Added, Phase 3 gate check; the 60-second answer on 8 workers is met with the 400-game cap of D27 (d) and depends on machine load (CHANGELOG Known gaps, Phase 3 worst-case time).
- Phase 4: done, PASS on both sides. Gate evidence: docs/ACCEPTANCE.md; CHANGELOG Added, Phase 4 acceptance and Phase 4 gate check.
- Phase 5: done, CLI and web UI; 0.2.0 (2026-09-30) adds the one-click launcher (launch.py, Launch.bat, launch.command) and the guided web UI with the match endpoint. Gate evidence: CHANGELOG Added (0.1.0 and 0.2.0), Phase 5 CLI tests, Phase 5 web UI tests (npm run smoke:web, 49 checks since 0.2.0) and the Final gate line; docs/WEB-UI.md; D27.
- Phase 6: done, no training code. Gate evidence: docs/JSONL-SCHEMA.md; CHANGELOG Added, Phase 6 gate (10,000 games, --validate 0 errors). The log is under out/, which is gitignored, so it is regenerated with node dist/tools/selfplay-log.js rather than kept in the repo.
- Final README: done. Gate evidence: README.md; CHANGELOG Added, Final gate (clean copy, verify:all 4 of 4 steps, 547 of 547 tests), and Fixed, Final README.

Do not start a phase until the previous phase's tests pass (brief). CHANGELOG.md gets an entry per phase gate and per decision change; PLAN.md sections 5, 9 and 10 are updated whenever a decision changes.

---

## 9. Decisions log (2026-09-29)

- D1 Matchup choice delegated by the operator: Deck A Rakdos Midrange, Deck B Mono-Red Aggro, both the most recent public tournament lists on 2026-09-29 (agent's choice).
- D2 Deck A source: olbeda, MTGO Pioneer Challenge 32, 2026-08-31 (MTGGoldfish deck 7935298). A newer 5-0 MTGO League run (2026-09-21, NAKISHIMA, deck 7966222) has the identical 75; the Challenge list is used because a League is not a tournament. No card changes either way.
- D3 Deck B source: _ZNT_, MTGO Pioneer Challenge 32, 2026-09-26 (MTGGoldfish deck 7973625). MTGGoldfish labels the list Mono-Red Prowess and MTGTop8 files the identical 75 as Red Deck Wins; MTGGoldfish's own Mono-Red Aggro archetype (Burning-Tree Emissary, Reckless Bushwhacker) last appeared 2026-05-14 with a 1-4 finish and has left the meta, so the current mono-red aggro shell is used under the archetype label Mono-Red Aggro. Swap in deck 7781837 and rerun the build script if the literal MTGGoldfish archetype is wanted.
- D4 Card naming: double-faced and split cards use exact Scryfall names with ' // ' (MTGGoldfish exports front names or a single slash); deck names equal oracle.json keys.
- D5 Game 1 first: all tools default to main decks; sideboard cards are implemented but loaded only through a sideboard plan file (Phase 3+). The determinizer for post-board games samples the opponent's configuration from that file rather than reading the actual list.
- D6 Engine execution: plain-data state, copy mode for tree expansion and journal mode (primitive mutators with inverse log) for descents and playouts; both run the same code path.
- D7 RNG: xoshiro128** seeded via splitmix32, jump() per worker.
- D8 No general layer system: fixed evaluation order (types, abilities, P/T base/CDA/counters/deltas/Role) covering exactly the pool; Urborg is a global boolean; manlands are overlay records.
- D9 Approximations (each documented in README and tested): Fable rummage choices capped at 20 by distinct names; Liliana -6 limited to three heuristic splits; Kumano chapter II applied as a cast-time flag; Trespasser graveyard targets limited to creature cards or none; Roku chapter II mana added as R (changes no game: every cost in B's 75 is red or generic); Petrified Hamlet names limited to lands in the two 75s; Reckless Rage own-target pruning; manland animation and Sokenzan channel offered only in windows where they can matter; attack and block enumeration capped at 64 each with heuristic ranking; player targets collapse to the opponent; Hearse targets count-only for B's graveyard; Bankbuster crew subsets capped at 4.
- D10 Damage cannot be prevented (Stomp, Sunspine Lynx) is a flag nothing reads, with a pool assertion test; there is no prevention effect in either 75.
- D11 First strike, flash, hexproof, protection, reach, vigilance, counterspells and shuffle effects are skipped because the pool has none (section 4); the pool assertion test re-opens the decision if a list changes.
- D12 Screaming Nemesis: multiple sources dealing damage simultaneously produce one trigger for the total (Scryfall ruling); the trigger uses last known information after Nemesis dies.
- D13 Perf target 1,000 random games/sec/core (stretch 3,000), measured as median of five 10,000-game runs on one worker; re-baselined after Phase 1 profiling and recorded in CHANGELOG.
- D14 CR citations: numbers marked ? in this plan are unverified; Phase 1 T1.0 downloads the CR text and lints every cited number before it reaches a code comment.
- D15 PLAN.md contains no backtick characters so it can be pasted into agent prompts safely.
- D16 Hidden information (critique, 2026-09-29): ids carry no identity (assigned after the shuffle, re-id on mulligan and on every zone change per 400.7); the view uses opaque view-local ids for hidden objects and drops seed, nextId, journal and log; agents and the determinizer use their own RNG streams; the view keeps the owner's known library positions (mulligan bottoms, scry) and the determinizer pins them.
- D17 Termination (critique, 2026-09-29): zero cap hits allowed; per-turn (1,000) and per-game (20,000) move caps plus a 200-turn backstop and an internal applyMove loop cap; a cap trip fails the fuzz run instead of counting as a draw.
- D18 Statistics (critique, 2026-09-29): Wilson for proportions, t interval for means, order-statistic interval for medians and the bench; Phase 3 reports 'too close to call' when the keep and mull intervals have not separated at max n.
- D19 Scope (critique, 2026-09-29): the web UI and its Playwright smoke are gated only if built (brief: 'if time allows'); the final README has its own gate.
- D20 Phase 1 approximations beyond D9 (2026-09-29, integration; details in docs/ENGINE-NOTES.md section 14 and the family sections): (a) combat damage among several blockers is assigned by a fixed rule (ascending lethal need, lethal damage to each in turn, the rest to the player with trample or to the last blocker) instead of the attacking player's choice (CR 510.1c); a few games where a split other than lethal-in-order is better are misplayed. (b) Triggers are collected after each whole engine operation, not at each event; no card in the pool can tell. (c) Fatal Push targets are not pruned to creatures it can kill (every creature stays a legal and offered target, which becomes-target triggers need). (d) Unlicensed Hearse count-only collapse is built as 'the opponent of the Hearse's controller' (TargetSpec.countOnlyOpponent), which is B's graveyard in every configuration because only A's sideboard has the Hearse. (e) The trigger-order question is skipped when all of one player's simultaneous triggers are the same ability, and the legend rule keeps the newest copy without asking when all copies are identical (both are pure collapses, no information lost).
- D21 Phase 2 agents (2026-09-29): (a) the greedy agent scores moves on Decision.sample, a determinized copy of the real state in which the cards hidden from the deciding player are permuted among the hidden slots with the agent's own RNG stream and the game seed is replaced (src/agents/sample.ts). The permuted multiset is the owner's deck minus every card the player can see, which the decklist gives, so it carries no more than the view; the view-based determinizer of Phase 4 remains the plan for ISMCTS. (b) Greedy settles the stack after a move by passing priority for both players, plays combat through the damage step and picks the opponent's block by a static trade estimate; the opponent's responses and combat tricks are not modeled. (c) Section 7's greedy-vs-greedy bound 'median under 12 turns' is tested as turns per player; the measured median is 13 counted as both players' turns (CHANGELOG, Phase 2 known gaps). (d) Key cards 'online by turn N' count the player's own turns and include the opponent's turn that follows (removal cast at instant speed then counts for N).
- D22 Phase 3 hand tool (2026-09-29): (a) the default cap is 400 games per branch in batches of 100 (1,000 until D27), not the 20,000 of the Phase 3 brief, so that a seven whose intervals never separate is still answered inside the 60-second gate on 8 workers (D27 and question 5 in section 10 have the timings); --max-games raises it, and the cap and the batch, not the worker count, fix where a run stops, so a seed gives the same report on any machine. (b) A hand given as 7 minus N cards after N mulligans models the unknown bottomed cards as random cards from the rest of the deck. (c) The mulligan branch takes one more mulligan (a fresh random seven, greedy bottoms N + 1, then greedy's keep rule), so KEEP or MULLIGAN compares the hand with greedy's own mulligan play, not with the best possible smaller hand. (d) The goldfish kill turn is measured against src/agents/passive.ts, which keeps its seven and never plays a land, casts, activates, attacks or blocks. (e) Key cards are read from decks/key-cards.json and count the player's own turns (D21 d); 'lands' and 'battlefield' key cards are also checked at every end of turn through a read-only engine observer (setTurnEndObserver in src/engine/turn.ts), which is not part of GameState and is set only around the real game's moves, never during an agent's search; the Phase 2 and Phase 3 rates of those kinds recorded before that fix may read slightly low. (f) Win rates are greedy against greedy, and every report prints 'Win rates reflect heuristic play, not perfect play.'
- D23 Performance target status (2026-09-29; D13): not met after Phase 1 profiling. On the game-1 decks T1.4 reached 112.8 games/sec/core (100.4 to 142.0, n = 5 runs, unpinned) and T1.5 275.1 (274.5 to 280.3, n = 5 runs, pinned to the 16 logical processors of the performance cores); the test pool reached 855.3 (848.6 to 862.7, n = 5 runs); each range is the five-run min to max, the 94 percent order-statistic interval of section 7. T1.5 also missed its own 3 x goal (1.81 x on the decks, 1.92 x on the test pool). The Phase 1 gate is taken through its other branch, the written profiling report (docs/PERF.md); the 1,000 target is kept, not lowered, and question 3 in section 10 carries the choice.
- D24 Phase 4 search (2026-09-29; src/agents/ismcts.ts, rollout.ts, mcts-agent.ts): (a) determinized UCT with one tree per sample and root aggregation, as the Phase 4 brief specifies; nodes are not shared across samples (the 'node reuse across samples' of section 7 is not built: a stored node state holds that sample's hidden cards), so root moves and principal variations are merged across samples by a key that names an object by id when the view shows it and by card when it was sampled. (b) Win-rate estimate: a truncated rollout's evaluation v (greedy evaluation through a logistic, scale 16 fitted by maximum likelihood on 150 greedy-vs-greedy games) counts as a win with probability v, drawn from the searcher's stream, so the Wilson interval is over whole win counts whose expectation is the mean value; the mean value is reported beside it with a Student t interval. Rollouts are not independent draws of one policy (the tree policy changes as it learns), so both intervals describe the rollouts, not the true win probability under any fixed play. (c) Mid-operation choices (discard picks, trigger targets and order, would-die replacements) cannot be determinized from a view (DeterminizeError); the MCTS agent answers them with the greedy agent on Decision.sample (D21 a), and mulligan and bottom decisions with greedy's rules on the view. Every other decision is searched from the view alone (runtime test with the real state sealed). (d) The rollout policy scores at most 3 attack options per declaration with the greedy combat scorer (ATTACK_LOOK; 6 made one game with a 20-permanent board 12 times slower, docs/PERF.md). (e) Execution: node states copied at expansion up to 4,096 per sample, journal replay and undo below them (D6); a test shows the result is identical with 1 stored state (pure journal replay). (f) The match CLI accepts --a mcts and --b mcts for the acceptance run (default then 4 samples x 50 iterations, rollouts cut after 2 turns; since D27 that search is --mode uct and the default is the D25 agent).
- D25 Phase 4 acceptance agent (2026-09-29; docs/ACCEPTANCE.md): the default search (4 samples x 50 iterations, fast rollouts over every legal move) did not beat greedy (41.3% [95% CI 28.3-55.7%, n=46] as A), so the acceptance agent searches differently, each part an option of the same ISMCTS code (src/agents/ismcts.ts, mcts-agent.ts) and a match flag: (a) greedy rollouts (--policy greedy: the greedy agent plays both sides of every rollout on the sample, which is a full state), cut after 2 turns and scored by leafValue as before; (b) root pruning to greedy's top 3 moves on each sample (--prune 3; deeper nodes are not pruned, and at 3 iterations per sample the tree is the root and one rollout per candidate, so every candidate is rolled out on the same determinized sample, a paired comparison); (c) a skip margin (--margin 3): greedy scores the legal moves on one sample of the agent's own and a move leading the second by 3 evaluation points or more is played unsearched; (d) a conservative override (--override 2 --min-gain 0.02): the agent plays greedy's move unless another root move beats it on the paired per-sample values by a mean gain d of at least 0.02 with d - 2 x se > 0. Argmax over 6 samples without (d) cost Rakdos 3.9 points (42.6% [95% CI 36.4-49.1%, n=230]); with it, 47.8% [95% CI 41.5-54.3%, n=230]. The search is rollout policy improvement on top of greedy, within the ISMCTS frame: it still decides from the view alone and still samples hidden cards (strategy fusion). The spot command kept its defaults (fast rollouts, no pruning) until D27.
- D26 Phase 4 determinizer approximations (2026-09-29; src/agents/determinize.ts, docs/SPOT-FORMAT.md): (a) every unknown slot (the opponent's unseen hand cards, the unknown part of both libraries) is dealt uniformly from the owner's list minus every card of that owner the view shows; nothing is inferred from what the opponent kept, bottomed, played or held back (non-locality, documented in README.md). (b) The opponent's library order known only to the opponent (their own mulligan bottoms) is not in the view, so every sample gives the opponent an empty libraryKnown; the view has no field for an opponent library card the viewer knows, and no card in either 75 reveals one. (c) A view waiting on a mid-operation choice is refused with DeterminizeError (D24 c).
- D27 Phase 5 CLI (2026-09-29; src/cli, scripts): (a) the validated search is the default everywhere: MCTS_VALIDATED in src/agents/mcts-agent.ts (8 samples x 3 iterations, greedy rollouts cut after 2 turns, greedy top-3 pruning at the root, margin 3, override 2 with min gain 0.02, the D25 agent) is the MCTS agent's default, --a mcts means it, and the spot command runs that search and prints the move that agent plays (greedy's first choice on one sample, unsearched when it leads by the margin, else kept unless the paired override finds a clear gain, with each move's paired gain and its t interval over the samples). The plain UCT search is --mode uct in both commands (spot: 8 samples x 400 iterations, fast rollouts, no pruning; match: 4 x 50); it was not validated, and both commands print a note (stderr, or the validation field with --json) that only the default mode with its default settings was tested against greedy, with the acceptance numbers and their n and intervals, or which settings a run changed. The refactor that shares the margin and override steps (greedyFirstChoice, pairedOverride) replays the same games: 8 fixed-seed games, 264 decisions in the validated configuration, identical before and after. (b) hand, spot and match share --seed (any integer, default 1), --workers (default logical processors minus 1, 0 runs in one thread), --json and --help (src/cli/args.ts); unknown flags, repeated flags and stray words are rejected by name; exit code 0 done, 2 bad input with a message naming the problem (including an unknown or illegal card, a missing or invalid spot file, a spot that cannot be searched), 1 a failure of the tool. The illegal-hand exit code of D22 moves from 1 to 2. (c) scripts/hand.ps1, spot.ps1 and match.ps1 run the compiled CLI (node dist/cli/index.js) and build dist first when it is missing or older than src; the hand must be quoted (single or double quotes) and the quoting forms are tested through powershell.exe 5.1 (docs/HAND-TOOL.md). scripts/setup.ps1 installs, builds, runs check:cards and prints the versions; npm run verify:all runs typecheck, tests, lint:cr and check:cards and fails a step that processed nothing. (d) Hand tool cap: on 8 workers the 2,200-game cap case (1,000 per branch) took 80.1 s and 79.6 s, over the 60-second gate, so the default cap is 400 per branch: the most a run can play is 1,000 games (400 per branch plus 200 goldfish). On 8 workers the slowest documented hand (the former worst-case seven, held to the cap with --batch 400) took 30.2 s, and a hand that runs all 4 looks of 100 took 26.5 s, 33.1 s and 34.2 s in three runs with the machine otherwise lightly loaded (93 to 127 s while another job held the CPU at 100 percent). Decisive hands are unchanged: the two documented examples stop after the first look with the same verdicts and rates, and the former worst-case seven is KEEP at the cap (58.0% [95% CI 53.1-62.7%, n=400] against 39.0% [95% CI 34.3-43.9%, n=400]).

---

## 10. Open questions for the operator

1. Deck B label: keep the current mono-red list (labelled Mono-Red Aggro, called Mono-Red Prowess by MTGGoldfish), or swap to the literal MTGGoldfish Mono-Red Aggro archetype (May 2026, 1-4 finish)? Default: keep the current list.
2. Post-board games: is a sideboard plan for the friend (what comes in and out against Mono-Red) available? Without one, all three questions are answered for game 1 only and the sideboard cards stay behind a config flag. Default: game 1 only until a plan is supplied.
3. Perf target: 1,000 games/sec/core is the proposed floor; say so if a different number is required before Phase 1 profiling starts. Status 2026-09-29: not met, 275.1 games/sec/core on the game-1 decks after T1.5 (D23); the next steps are in docs/PERF.md. Default: keep 1,000 as the target and continue on the profiling report.
4. Phase 2 game length (D21 c): does section 7's 'median under 12 turns' for greedy vs greedy count turns per player (measured 7 [95.4% CI 7-7, n=1000], passes) or the turns of both players (13 [95.4% CI 13-13, n=1000], fails, and agent fixes cannot reach it: greedy Rakdos against a do-nothing opponent has a median of 12 total turns [96.0% CI 12-12, n=200])? Default: the per-player reading, which the gate test asserts; the alternative is to restate the bound for total turns (for example under 14).
5. Phase 3 gate hardware (D22 a): the 60-second answer was measured with 23 workers, not on 8 cores, and an estimate from the measured speed puts the 2,200-game cap case near 89 s on 8 workers (CHANGELOG, Known gaps). Re-measure with --workers 8 and lower the default cap if it exceeds 60 s, or accept the development machine as the gate's machine? Default: re-measure before the Phase 5 README. Status 2026-09-29 after the greedy Fable fix: the cap case took 57.6 s and 61.4 s in two runs with 23 workers and other jobs on the machine (42.6 s before the fix in the same conditions), so it is at or just over 60 s on the development machine as well; the options are to accept it, lower the default cap, or trim greedy's settle (CHANGELOG, Known gaps). Resolved 2026-09-29 (D27 d): re-measured with --workers 8 at 80.1 s and 79.6 s, so the default cap was lowered to 400 per branch; the largest run (1,000 games) took 30.2 s for the slowest documented hand and 26.5 to 34.2 s for a hand that runs all four looks, on 8 workers. Machine load changes the time: with another job holding the CPU the same run took 93 to 127 s.

What remains open at release 0.1.0 (2026-09-30):
- Questions 1 to 4 have no operator answer yet; each runs on its stated default (current Deck B list, game 1 only, 1,000 games/sec/core kept as the target, the per-player reading of game length). Question 5 is resolved (D27 d).
- Post-board play: no sideboard plan exists, so every tool answers game 1 only; the 16 sideboard-only cards are implemented and tested but reach play only through the fuzz and bench sideboard pool and a spot file's own deck lists (docs/SPOT-FORMAT.md), not through a sideboard plan.
- Performance: the D13 target is not met (D23); the next steps are listed in docs/PERF.md.
- Search: node reuse across samples is not built (D24 a); only the validated mode with its default settings was tested against greedy (D25, D27), and --mode uct and changed settings are unvalidated and print a note saying so. The determinization weakness (strategy fusion, non-locality; D26) is a limit of the method, documented in README.md, not a scheduled fix.
- Greedy stays one ply with hand-tuned weights (CHANGELOG Known gaps); every win rate the tools print is for heuristic play against heuristic play.
- The hand tool's time on 8 workers depends on machine load (question 5); no timing was made on a separate 8-core machine.
