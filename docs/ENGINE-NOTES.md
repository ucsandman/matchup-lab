# ENGINE-NOTES

Working notes for whoever builds the next engine stages (turn, stack, triggers, combat, damage, SBA, moves, apply) and the card defs. Written 2026-09-29 at the end of T1.1 part 1. PLAN.md section 6 is the spec; this file says what exists and how to use it.

## 1. Files

| File | What it holds |
|---|---|
| src/engine/types.ts | GameState and everything in it; CardDef, FaceDef, AbilityDef; EffectCtx interface; Move, Choice, StackItem, ContinuousEffect, GameEvent |
| src/engine/rng.ts | xoshiro128** with splitmix32 seeding: seedRng, nextU32, nextFloat, nextInt, jump, shuffle, cloneRng |
| src/engine/mutate.ts | the only code that writes state: primitive mutators, journal, undoTo, the characteristics memo hook, randomInt on the game stream |
| src/engine/zones.ts | moveObject (the one zone-change path), createToken, drawCard, discard, mill, exileObj, scry1, shuffleLibrary, the die choke point (die, destroy, sacrifice), NeedChoice, Picker |
| src/engine/bits.ts | TYPE, COLOR, KW bitmasks; a leaf module with no runtime imports, so card defs may import it (statics.ts re-exports them) |
| src/engine/statics.ts | characteristics(state, id) with the fixed evaluation order, bitmasks (LAND; TYPE, COLOR, KW re-exported from bits.ts), urborgActive, landTypeMask, controlsLandType, staticAbilities, classKey |
| src/engine/mana.ts | mana abilities (sourceOptions, manaSources, activateManaAbility), emptyPool, the payment solver (solvePayment, payMana, canPay) |
| src/engine/cost.ts | parseMana, manaValueOf, reduceGeneric, spellManaCost (kicker), checkNonMana, payNonMana, sacrificeCandidates, bargainCandidates, discardCandidates, collapseByClass |
| src/engine/life.ts | gainLife (with the cantGainLife hook), loseLife, payLife, canPayLife |
| src/engine/ctx.ts | makeCtx (the EffectCtx implementation), runWithChoices (choice replay), dealDamageBasic (provisional) |
| src/engine/setup.ts | newGame, emptyState, loadDeckFile, resolveDeck |
| src/engine/mulligan.ts | London mulligan: answerPregame, canMulligan |
| src/engine/view.ts | view(state, player): PlayerView |
| src/engine/apply.ts | applyMove (copy mode), applyMoveInPlace (journal mode), advance (the loop that runs SBAs, triggers, auto-passes and steps until a real decision), cloneState, LOOP_CAP |
| src/engine/moves.ts | legalMoves(state, player), hasAction, decider, collapsedSubsets, crewOptions |
| src/engine/turn.ts | startTurn, nextStep, stepActions (turn-based actions), priorityStep, insertExtraCombat, setDayNight |
| src/engine/stack.ts | playLand, castSpell, activateAbility, unlockDoor, resolveTop, counterItem, timing helpers (sorcerySpeed, castFaces, landFaces, playableCards, canActivateNow), crew helpers |
| src/engine/targets.ts | legalTargets, isLegalTarget, targetTuples (collapsed), recheckTargets (608.2b), targetKey |
| src/engine/triggers.ts | collectTriggers (event bus and listener index), putTriggers (APNAP, order choice, trigger targets), resolveBuiltin (prowess, ward) |
| src/engine/damage.ts | dealDamage(state, source, target, n, isCombat, opts): the damage pipeline |
| src/engine/combat.ts | canAttack, defenders, declareAttackers, canBlock, checkBlocks (menace), declareBlockers, combatDamage, removeFromCombat, attackOptions and blockOptions (collapsed, capped at 64) |
| src/engine/sba.ts | checkSBA: one simultaneous round of state-based actions |
| src/engine/saga.ts | finalChapter, addLoreForTurn, isSaga |
| src/agents/types.ts, src/agents/random.ts | Agent interface (Decision: player, moves, view(), sample(rng)), randomAgent(seed) on its own RNG stream |
| src/agents/sample.ts | hiddenFrom, sampleHidden: the determinized copy behind Decision.sample (hidden identities permuted per owner, seed replaced) |
| src/agents/determinize.ts | prepareDeterminizer(view, decks).sample(rng), determinize: a full GameState from a PlayerView and the two lists (known positions pinned, unknown slots dealt from the lists, fresh ids, fresh seed); refuses mid-operation choices (DeterminizeError) |
| src/tools/spot-schema.ts | SPOT_SCHEMA, validate, loadSpot and readSpotFile (spot file to PlayerView, checked against oracle names and the lists; SpotError lists every problem), saveSpot, spotJson and writeSpotFile (PlayerView to spot file); format in docs/SPOT-FORMAT.md |
| src/agents/ismcts.ts, ismcts-worker.ts | ISMCTS from a PlayerView (Phase 4): D determinized samples, UCT per sample over every decision (opponent and choice nodes included), node states copied at expansion and journal replay below them, root moves and principal variations merged across samples by moveKey; searchView, searchViewParallel (samples over worker threads), uctScore, selectChild, aggregate |
| src/agents/rollout.ts | rollout policy (land, most expensive spell, greedy combat scorer for attacks, static blocks, else random), rollout (truncated after K turns or full), leafValue (greedy evaluation through a logistic, EVAL_SCALE), bernoulli (win counting for the Wilson interval) |
| src/agents/mcts-agent.ts | mctsAgent(seed, {samples, iterations, ms, policy, prune, margin, override, minGain, ...}): the playable ISMCTS agent (the acceptance options, PLAN.md D25: greedy rollouts, greedy root pruning, a greedy skip margin, a paired conservative override); view only, greedy rules for mulligan and bottom, greedy on Decision.sample for mid-operation choices (DeterminizeError); kind 'mcts' in makeAgent and the match CLI |
| src/tools/describe-move.ts | describeMove: a move in card names, '(sampled)' on cards the determinizer dealt |
| src/cli/spot.ts, scripts/spot.ps1 | the spot command (top lines with n, Wilson and t intervals, the two limit sentences) |
| src/tools/mcts-bench.ts | MCTS searched decisions per second against greedy (docs/PERF.md, Phase 4) |
| src/tools/acceptance.ts | the Phase 4 acceptance run: a pilot, the extrapolated plan, MCTS as A and as B against greedy, each side's two-proportion z-test against the greedy-vs-greedy baseline (docs/ACCEPTANCE.md) |
| src/agents/greedy.ts, evaluate.ts, heuristics/rakdos.ts, heuristics/monored.ts | greedyAgent(seed, {deck}) with explain(d) for scores; settle, combatOutcome, staticBlock; London mulligan helpers keepHand, castableByTurn3, keptHandScore (Phase 3 uses them); evaluate(state, me, profile, cards) |
| src/sim/stats.ts | wilson, tInterval, tQuantile, quantileInterval, twoProportionZ, sequentialCompare, fmt helpers |
| src/sim/games.ts, runner.ts, worker.ts | runBlock (one block of games: seeds, agents, legality check, key cards, fixed opening hand), runMatch (blocks over worker_threads or in-process), aggregate into a MatchReport |
| src/cli/index.ts, scripts/match.ps1 | the match command |
| src/tools/play.ts | playGame, checkInvariants (fuzz invariants 1 to 5), checkViewLeak (invariant 8), CAPS, stateHash |
| src/tools/fuzz.ts, src/tools/bench.ts | the fuzzer and the benchmark (npm run fuzz, npm run bench) |
| src/test/scenario.ts | act, pass, answer, who, moves, castMove, hasCast, P(), O() for scenario tests |
| src/test/pool.ts | fuzz pools: TEST_POOL_DECK, EXTENDED_DECK_A and _B with test-only cards covering combat keywords, a planeswalker, a saga, a legend, Blood; SIDEBOARD_SWAP and sideboardDeck (the real 60s with each whole sideboard swapped in, fuzz pool 'sideboard') |
| src/cards/dsl.ts | card, face, land, trig, act, mana, stat, spell, saga, room, adventure, t (target specs), slug |
| src/cards/registry.ts | registerCard, getDef, findDef, defIdByName, getAbility, abilityKey, hasNonManaActivated |
| src/cards/index.ts | registers every real card and every token, re-exports the registry. Engine code imports the registry from here |
| src/cards/tokens.ts | Blood, Treasure, GoblinShaman, Zombie, Spirit, Goblin, Pilot, Demon, Dragon, MonsterRole, Copy |
| src/cards/defs/ | one file per card, all 56 (40 main-deck plus 16 sideboard-only), registered by family in src/cards/index.ts |
| scripts/check-cards.mjs, scripts/check-cards.ps1 | npm run check:cards: every decklist name has a def, every def face matches decks/oracle.json, every card has a scenario test file; prints the coverage table |
| src/test/helpers.ts | given() state builder, ids/id1 lookups, canon() sorted-key JSON, deckOf, registerTestDef, TestBear and TestBolt |

## 2. How state is laid out

GameState is plain JSON: structuredClone, JSON round trips and postMessage are exact. No classes, Maps, Sets or functions anywhere in it.

- objects: every card and token instance, keyed by numeric ObjId.
- zones: library, hand, graveyard and exile are per player ([p0, p1]); battlefield is one array; stack is an array of StackItem.
- Library order: index 0 is the bottom, the last element is the top. Draw pops the end.
- Stack order: the last element is the top.
- players[p]: life, cantGainLife, manaPool (entries with color, optional restriction 'creatureSpell', optional expires 'endOfCombat'), mulligans, kept, drewFromEmpty (read by the 704.5b SBA), libraryKnown.
- libraryKnown.top lists known cards from the top down (top[0] is the top card); libraryKnown.bottom lists known cards from the bottom up (bottom[0] is the very bottom). moveObject prunes them when a card leaves the library; a shuffle clears both.
- Counters: lore, loyalty and charge live in object.counters with p1p1 and m1m1. A missing key means zero; addCounter deletes a key that reaches zero.
- phaseQueue holds the remaining steps of the turn after the current one (Step values, not phases). TURN_STEPS and COMBAT_STEPS in types.ts are the templates; an extra combat inserts COMBAT_STEPS at the front.
- step 'mulligan' plus pregame non-null means the London mulligan is running. When pregame and pendingChoice are both null after it, turn.ts starts turn 1.
- events: buffered GameEvents from the current action. The trigger system drains them with drainEvents. Never in a view.
- effects: ContinuousEffect records (ptDelta, keywords, exileIfDies, playFromExile, namedBan), each with an eid taken from nextId.
- journal: present only in journal mode.

### Mutation rules

1. Every write goes through mutate.ts (setIn, deleteIn, spliceIn, or the named helpers setField, clearField, setPlayer, setTop, pushZone, removeZone, pushStack, removeStackItem, addCounter, addEffect, removeEffect, setPool, addPoolEntry, removePoolEntry, allocId, addObject, deleteObject, pushEvent, drainEvents, randomInt). Writing state directly skips the journal and the memo invalidation.
2. Never put one sub-object in two places in state; values passed to a mutator become owned by state.
3. Journal mode: beginJournal(state), m = mark(state), ... , undoTo(state, m). Copy mode: no journal; clone the state yourself. Same code either way.
4. Game randomness: randomInt(state, n) only (journaled). Agents never draw from state.seed.
5. Test builders that edit state by hand must call invalidateMemo(state) afterwards. It drops the characteristics memos and moves the content tick (below), so the auto-pass cache, the payment cache and the state-based action skip recompute too. Hand writes to the timing fields only (priority, passes, step, phaseQueue, stepPriority) need no call: nothing cached reads them.

### Caches keyed by the content tick (T1.5, docs/PERF.md)

mutate.ts keeps a process-wide content tick, bumped by every write except to the timing fields above and the event buffer, and by invalidateMemo. Three caches are valid while it stands:
- hasAction (moves.ts): per state and player, whether a land could be played, whether a spell could be cast (per sorcery flag) and which activations have a move; timing (canPlayLandNow, sorcery timing, canActivateNow, the D9 window hooks) is checked fresh on every call. legalMoves reuses the activation candidates and skips what hasAction already found impossible.
- Payment plans (mana.ts paymentPlans): mana sources, solver classes and plans per state and player, shared by hasAction, legalMoves and the castSpell, activateAbility or unlockDoor that follows. The returned plans and activatableKeys arrays are shared: read-only.
- The state-based action skip (apply.ts): a check that found nothing and wrote nothing is not repeated at the same tick.

Contract for new card code: target filters, cost reductions, mana ability conditions, additional-cost checks and anything else the move generator calls, except window hooks, must not read the timing fields. Window hooks may (they are rechecked every time). src/test/rules/autopass.test.ts compares the cached answer with a fresh one at every step and priority holder of random games.

Partial memo drops: an object entering or leaving the battlefield, or a change to its animated overlay, drops only its own memo entries, its host's (attachments feed the host's P/T, keywords and classKey) and the battlefield aggregates (statics.ts setPartialDrop). A permanent with the allLandsAreSwamps static still drops everything. A new static that changes other objects' characteristics needs the same treatment there (src/test/rules/memo-partial.test.ts).

## 3. Ids and views

- ObjIds are sequential integers from state.nextId and carry no card identity.
- newGame shuffles each deck as a list of def ids first, then assigns ids in shuffled order (library id order follows position, never the decklist).
- Every zone change makes a new object with a new id (CR 400.7). The old id is gone; the zoneChange event carries the old id, the new id and an LKI snapshot of the old object.
- Every shuffle re-issues fresh ids to the whole library (mulligan shuffles are the only shuffles in this pool).
- view(state, p) drops seed, nextId, journal, log, events and libraryKnown. Hidden cards the viewer does not know become {vid, zone, owner, hidden: true} with vid h0, h1, ... in hand order. The opponent's hand is {known: ids, hidden: refs}. A library is {size}, plus knownTop and knownBottom for the viewer's own library. A pendingChoice that belongs to the other player is reduced to {kind, player, hidden: true}. Stack items lose trigger.objId when it points at a hidden object; effects that point at hidden objects are dropped. The view also carries the public priority bookkeeping passes and stepPriority and the delayed triggers (a delayed trigger whose source is a hidden object is dropped, an objId naming a hidden object is removed), which the Phase 4 determinizer needs to continue the game; it never carries pending or pendingTriggers.
- Anything that can hold an id must hold only public ids, or the view must sanitize it. If you add a new field that can carry a hidden id (for example, event data on a stack item), extend view.ts and the leak tests in src/test/rules/view.test.ts.

## 4. Adding a card def

One file per card in src/cards/defs, kebab-case after the front face. Export a CardDef built with the DSL, then import it in src/cards/index.ts and add it to CARDS.

    import { act, card, face, t, trig } from '../dsl.js';

    export const BloodtitheHarvester = card('Bloodtithe Harvester', [face({
      name: 'Bloodtithe Harvester', types: ['Creature'], subtypes: ['Vampire'], cost: '{B}{R}', pt: [3, 2],
      abilities: [
        trig('etb', (ctx) => { ctx.createToken('Blood', ctx.controller); }),
        act({ cost: { tap: true, sacrificeSelf: true }, timing: 'sorcery', target: t.creature(),
          resolve: (ctx, [tg]) => { if (tg && tg.kind === 'obj') { const x = 2 * ctx.count('Blood', ctx.controller); ctx.addEotDelta(tg.id, -x, -x); } } }),
      ],
    })]);

Rules for defs:

- The name passed to card() is the exact deck and oracle name, with ' // ' for two-part cards. The def id is slug(front face name). defIdByName resolves the full name and each later face name.
- Faces: face() fills defaults and takes colors from the mana cost unless given. land() builds a land face; basic land types give their mana ability automatically (a Swamp subtype means tap for B), so write mana abilities only for non-basic production. land() options: mana (list of mana() abilities), entersTapped (predicate, evaluated before the land enters), payLifeToUntap (shock lands), abilities.
- Layouts: 'normal', 'mdfc' (face chosen on play; pass face in MoveOpts), 'transform' (face 1 is the back; mana value comes from face 0), 'adventure' (face 0 creature, face 1 Adventure), 'room' (face 0 left door, face 1 right door; use room()), 'token'.
- Abilities are keyed defId:face:index in the order they appear in face.abilities; intrinsic land mana uses basic:W, basic:U, basic:B, basic:R, basic:G. Do not reorder abilities of a published def: stored keys would point at the wrong ability.
- trig(event, effect) or trig(event, spec, effect). spec may give scope ('self' is the default, or 'any', 'you', 'opponent'), filter, interveningIf, targets, optional. saga([ch1, ch2, ch3]) returns chapter triggers (event 'chapter', chapter number set).
- act({cost, timing, zone, target or targets, costReduction, resolve}). zone 'hand' is for channel.
- mana({produce, cost, restriction, expires, condition}). produce is a color list or 'any'; cost defaults to tap.
- stat({category, ...}). Categories in use: allLandsAreSwamps (Urborg), entersTapped, dieReplacement (applies, after), cantGainLife, enchantedGets (Roles: p, t, keywords), ptCda (cda), crewBonus (amount). damageReplacement, activationRestriction and marker are reserved for later stages.
- spell({target or targets, resolve} or {modes}, additionalChoice, kicker, bargain).
- Effects receive (ctx, targets) and must be deterministic given state and choice answers (see runWithChoices). They must not keep state in closures.
- Defs never import engine modules; everything goes through ctx. The one exception is src/engine/bits.ts (TYPE, COLOR, KW), a leaf module with no runtime imports, for reading ctx.chars(id).colors, .types and .kw.
- spell({..., prune}) passes a move-generator target prune through to its single mode (ModeDef.prune).
- npm run check:cards (scripts/check-cards.mjs) compares each def face against decks/oracle.json (cost, types, supertypes, subtypes, colors, P/T, loyalty) and requires src/test/cards/<def id>.test.ts with at least one test.

Test-only defs: build them with the DSL in the test file and register with registerTestDef from src/test/helpers.ts. TestBear ({1}{G} 2/2) and TestBolt ({R} instant, 3 damage to any target) are registered by importing helpers.ts.

## 5. The ctx API (EffectCtx)

makeCtx(state, sourceId, controller, abilityKey, pick?) builds it. Fields: state, source, controller, opponent, abilityKey.

Queries:
- obj(id), chars(id) (computed characteristics), isType(id, type)
- count(nameOrTokenName, player): permanents with that name the player controls (count('Blood', p))
- permanents(player, pred?)
- controlsLandType(player, ['Swamp', 'Mountain']): Urborg-aware

Decisions:
- choose(choice): returns the next answer from the picker; with no picker it throws NeedChoice.

Actions (all journaled):
- createToken(name or token def id, controller, {tapped, copyOf, attachedTo, attacking})
- moveTo(id, zone, MoveOpts), exile(id), draw(player, n), discard(id), mill(player, n)
- sacrifice(id), destroy(id): through the die choke point
- addCounter(id, type, n) (buffers counterAdded for n > 0)
- addEotDelta(id, p, t), grantEot(id, keywords): until-end-of-turn effects; cleanup must remove effects with until 'eot'
- addMana(player, color, {restriction, expires})
- gainLife(player, n) (respects cantGainLife), loseLife(player, n)
- dealDamage(target, n, {combat}): the full pipeline in damage.ts (damageReplacement statics, then life loss, loyalty loss or marked damage, the deathtouch flag, damagedThisTurnBy, the tally for sources with the marker 'tracksDamageDealt', lifelink through gainLife, a damage event). Returns the damage actually dealt (0 when Soul-Scar turned it into counters). Uses ctx.item.lki when the source left.
- item: the resolving StackItem (item.kicked, item.bargained, item.mode, item.targets, item.trigger); null outside a resolution.
- isLegalTarget(t): false for a target that became illegal before resolution (CR 608.2b). All ctx actions (destroy, sacrifice, exile, moveTo, addCounter, addEotDelta, grantEot, dealDamage, tap, untap) silently skip illegal targets and objects that no longer exist, so partial fizzle needs no code in the effect.
- tap(id), untap(id), animate(id, overlay) (until end of turn; cleanup clears it), transform(id) (same object, double-faced only), exileAndReturnTransformed(id) (a new object, back face up; returns the new id).
- addDelayed(on, abilityIndex, objId?): a one-shot delayed trigger; when event 'on' next happens, ability abilityIndex of the same face triggers (declare it with trig('delayed', effect)); info.objId carries objId.
- addExtraCombat(): an extra combat phase after the current one (FOMO).
- grantPlayFromExile(objId, player, untilTurn): the player may play that card until the cleanup of turn untilTurn (Emberheart valiant: state.turn; Roku: state.turn + 2 for until the end of your next turn).
- addCounter(id, type, n) clamps at zero instead of throwing; counterAdded is buffered only for n > 0.

Choice replay: runWithChoices(state, answers, fn) runs fn(pick) with the answers so far. If fn asks for one more answer, the state is rolled back with the journal (turned on temporarily in copy mode) and the Choice comes back as {done: false, choice}. Set it as pendingChoice; when the player answers, run again with one more answer. This is how a resolving spell or ability asks for a decision in the middle of its effect.

## 6. Zones, dying and entering

- moveObject(state, id, to, opts) is the only zone-change path. It removes the object from its zone (or its StackItem when leaving the stack), prunes libraryKnown, sets turnFlags.permanentLeft for the controller when leaving the battlefield (revolt), deletes the old object and creates the new one. Moving to the stack does not push a StackItem: the caller does that right after.
- Knowledge: public zones show a card to both players; a card that leaves a public zone stays known to both; a card going to hand or library is known to its owner.
- Entering the battlefield: sick is set; the card's own entersTapped statics are evaluated before it enters; payLife in MoveOpts pays a shock land's life; sagas get one lore counter, planeswalkers their loyalty, faces with entersWithCounters their counters, and opts.counters adds extra (Kumano chapter II). A Room enters with the cast half unlocked (unlockHalf). counterAdded events are buffered for every initial counter, so a saga's chapter I can trigger.
- Tokens: a token that leaves the battlefield is deleted at once and moveObject returns null. The zoneChange event still fires with newId null, so dies and leaves triggers work.
- die(state, ids, cause, pick?) is the single path into the graveyard from the battlefield (destroy, sacrifice, lethal damage). It collects every applicable would-die replacement for each object first (exileIfDies effects, then dieReplacement statics in source-id order). With two or more, the dying object's controller chooses (CR 616.1): pick is asked, or NeedChoice is thrown before anything moves. A replacement exiles instead, then runs the static's after() (Kalitas makes a Zombie for its controller).
- Draws are one at a time (CR 121.2); drawing from an empty library sets drewFromEmpty and returns null.

## 7. Mana and costs

- Mana sources are computed from characteristics: explicit mana abilities plus the intrinsic ability of each basic land type. A creature (an animated land) that is summoning sick cannot use a tap mana ability.
- solvePayment(state, player, manaCost, {creatureSpell}) returns every non-dominated payment, canonical first. Each plan has pool (pool indexes to spend), taps (objId, ability key, color), life, sacrifices and residualKey. payMana executes one plan.
- Canonical order: less life first; fewer sacrifices (lands before Treasure); fewer nonland sources; restricted mana spent first when the cost allows it; then the more flexible residual (basics before duals).
- Alternatives: two plans are both offered only when neither residual (what stays untapped plus what stays in the pool) covers the other. A unit covers another when it makes the same colors or more at no higher cost, and a source with a non-mana activated ability (manlands, Castle Locthwain, Ramunap Ruins) is covered only by another copy of itself. Pool mana never covers an untapped source, so the pool is spent first.
- Blood is not a mana source; only Treasure is sacrificed for mana.
- Non-mana costs: checkNonMana returns null or a reason; payNonMana pays loyalty, counters, tap, life, discards, then sacrifices. Sacrifices go through die.
- emptyPool(state, p, 'step') keeps firebending mana; emptyPool(state, p, 'endOfCombat') clears everything. turn.ts calls these.

## 8. Event names

GameEvent (buffered in state.events): zoneChange (oldId, newId, from, to, cause, lki), draw, discard, mill, tokenCreated, counterAdded, lifeGain, lifeLoss, damage, manaAdded, cast (player, id, creature), becomesTarget (id, stackId, player, spell), attacks (id, defender), unlock (id, half), step (step, player: emitted for upkeep, main1 and end). zoneChange causes in use: move, draw, discard, mill, exile, destroy, sacrifice, token, mulligan, and destroy:replaced or sacrifice:replaced when a die replacement exiled the object. A token creation also emits a zoneChange with from null.

TriggerEventName (what trig() listens to; the trigger system derives these from GameEvents and turn steps): etb, dies, ltb, draw, discard, cast, attacks, dealtDamage, dealsDamage, upkeep, endStep, precombatMain, chapter, unlock, becomesTarget, tokenCreated, lifeGain, and delayed (never fires from an event: the effect of a delayed trigger).

How each is derived (triggers.ts collectTriggers) and what TriggerInfo carries:

| Trigger | From | info |
|---|---|---|
| etb | zoneChange to battlefield (tokens too) | objId (new), player (controller) |
| ltb, dies | zoneChange from battlefield (dies: to graveyard, tokens included) | objId (old id), player; looks back: the leaving object's own abilities and those of permanents leaving in the same batch listen |
| draw | draw | player (no objId: the drawn card is hidden) |
| discard | discard | player, objId (graveyard id) |
| cast | cast | player, objId (the spell) |
| becomesTarget | becomesTarget | objId (the target), player (controller of the spell or ability), stackId, amount 1 for a spell and 0 for an ability |
| attacks | attacks (declared attackers only; tokens put onto the battlefield attacking never fire it) | objId, player |
| chapter | counterAdded lore, one per threshold crossed | objId, chapter |
| unlock | unlock (special action, and a Room entering with the cast door unlocked, CR 709.5h) | objId, half; matches only abilities on that door's face |
| upkeep, precombatMain, endStep | step | player (active); scope 'self' means your step, 'any' means every step |
| dealtDamage | all damage events in one drain summed per damaged object | objId, amount (total) |
| dealsDamage | summed per source | objId (source), amount, player (first damaged player) |
| tokenCreated, lifeGain | as named | objId or amount, player |

Scopes: 'self' (default; the event is about the source), 'you', 'opponent' (info.player against the source's controller), 'any'. filter and interveningIf get (ctx, info); interveningIf is checked on trigger and again on resolution (CR 603.4).

Built-ins (no card code): prowess (keyword) triggers on a noncreature cast by its controller; ward (keyword plus stat({category: 'marker', marker: 'ward', wardCost})) triggers when an opponent's spell or ability targets it; the targeting player pays the ward cost or the spell or ability is countered.

## 9. Tests

Run: node node_modules/vitest/vitest.mjs run (add --silent=false to see the count lines the tests print; vitest 5 hides console output of passing tests). Typecheck: node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit. CR citations: node scripts/lint-cr.mjs.

- rng: known-answer vector, determinism, jump, shuffle.
- mutate: 10,000 random primitive and zone ops, each batch undone and compared with a clone taken before (seen failing with one inverse dropped); a mutation that skips the journal is detected.
- zones, statics, mana (one test per collapsing rule, seen failing with dominance pruning disabled), cost, dsl, setup, mulligan, ctx.
- view: leak tests (a), (b) and (c) (seen failing with rule 2 and the stack sanitizer removed).
- turn (step order, first-draw skip, day/night, becomes day, cleanup repeat, extra combat), priority (pass, resolve, LIFO, auto-pass), sba (every 704.5 case in PLAN.md section 4, Role uniqueness, 104.4a draw), combat (menace, trample plus deathtouch, lifelink timing, token entering attacking, sick animated land, flying, attack collapse), triggers (APNAP, order choice, intervening-if, delayed, 603.3d, ward, prowess, summed damage, look-back dies), stack (adventure, Room and unlock, loyalty once per turn, channel, two targets and partial fizzle, full fizzle, kicker, crew), replacement (616.1 choice through the engine, damage to counters, lifelink and cantGainLife, tally), determinism (same seed and moves give byte-identical states in copy and journal mode; every applyMove undone exactly by the journal), collapse (lands, tokens, discards, payments, targets, the applyMove loop cap, the fuzz checkers seen failing on broken states).
- fuzz.test.ts: 2,000 random games on the test pool, 500 on the extended pool, 200 on the real decks and 100 on the sideboard pool, invariants 1 to 8.
- Mutation check (2026-09-29): ten rules were broken one at a time (cleanup repeat, APNAP order, 104.4a draw, menace, full fizzle, priority after resolution, intervening-if on resolution, lifelink, deathtouch lethal in trample assignment, first-draw skip); each made its test fail.
- Fuzzer: npm run fuzz -- --games N --pool test|extended|decks|sideboard; bench: npm run bench -- --games N --runs R --pool ...


## 10. The game loop (apply.ts)

legalMoves(state, p) lists p's moves; decider(state) says whose decision it is (the pending Choice's player, else the priority holder; null when the game is over). applyMove(state, move) returns a new state (copy mode); applyMoveInPlace mutates (journal mode: beginJournal, m = mark, applyMoveInPlace, undoTo(m)). Both run the same code.

After the move, advance loops (at most LOOP_CAP = 10,000 iterations, then it throws):
1. Game over: clear pendingChoice and stop. A pendingChoice or the pregame: stop.
2. collectTriggers drains the event buffer into state.pendingTriggers.
3. checkSBA: one simultaneous round; if anything happened, loop again (an SBA or trigger during cleanup gives priority there, CR 514.3a). Skipped when the previous check of this state found nothing and the content tick has not moved.
4. Pending triggers go on the stack (APNAP; not during untap).
5. stepPriority: if the priority holder has any move besides pass (hasAction), stop: that is a real decision. Otherwise the engine passes for them (auto-pass). Two passes in a row resolve the top of the stack (the active player gets priority after) or, with an empty stack, end the step.
6. No priority in this step (untap, normal cleanup): next step.

Decisions in the middle of an operation (a legend-rule pick in an SBA round, a discard during a resolution, trigger order and targets, the cleanup discard, a would-die replacement choice) use replay: every operation (EngineOp: move, resolve, sba, triggers, stepAction) runs inside runWithChoices (except the turn-based actions of steps other than cleanup, which never ask: apply.ts beginStep runs them directly); when it asks one answer too many it is rolled back, state.pendingChoice is set and state.pending holds the op and the answers so far. The answer move (type choose) replays the op with one more answer. Effects must be deterministic given state and answers.

Turn-based choices are Choices answered by their own move types: declareAttackers and declareBlockers (the move lists the assignments). Mulligan and bottom are answered with choose; after the last keep, turn 1 starts.

New state fields in this stage: pending, passes, stepPriority, pendingTriggers, delayed; turnFlags.loyaltyUsed; objects: blocked, deathtouched; StackItem.enterCounters; TriggerInfo.stackId and half; CostSpec.crew; StaticDef.wardCost and damageToCounters; ActivatedDef.window. The view drops pending and pendingTriggers (it lists its fields explicitly); passes, stepPriority and delayed were added to it in Phase 4 (section 3).

## 11. How a card registers triggers, statics and replacements

Nothing is registered at run time. The card's abilities live in its def; characteristics() lists the ability keys an object has (printed face, copy source, overlay abilities, unlocked Room doors, basic land mana), and the engine finds them there:
- Triggered: trig(event, spec?, effect). The listener index (triggers.ts) is rebuilt from the battlefield whenever the characteristics memo is dropped. A dies or leaves trigger of the object itself is found from its last known information. spec: scope, filter, interveningIf, targets (chosen as it goes on the stack; no legal target removes it, CR 603.3d), optional (asks yes or no on resolution).
- Static: stat({category, ...}), read on demand through staticAbilities(state, category): entersTapped and payLifeToUntap (zones.ts), cantGainLife (life.ts), dieReplacement with applies and after (zones.ts die), damageReplacement with damageToCounters (damage.ts), enchantedGets (Roles, statics.ts), ptCda, crewBonus, marker ('tracksDamageDealt' for the tally, 'ward' with wardCost).
- Replacements: would-die replacements are dieReplacement statics or exileIfDies effects; when two or more apply, the dying object's controller chooses (a dieReplacement Choice). Damage replacements are damageReplacement statics. Enters-tapped and enters-with-counters are handled by moveObject.
- Activated: act({cost, timing, zone, targets, costReduction, window, resolve}). window is only a move-generator filter (PLAN.md D9); legality ignores it. Costs: mana, tap, life, sacrificeSelf, sacrifice (spec), discard, discardSelf, removeCounter, loyalty, crew.
- Spells: spell({modes, or target(s) plus resolve, additionalChoice, kicker, bargain}).

## 12. Writing a scenario test

    import { given, id1, TestBear, TestBolt } from '../helpers.js';
    import { act, castMove, O, P, pass } from '../scenario.js';

    const s = given({
      turn: 1, step: 'main1', active: 0,
      battlefield: ['Mountain', { card: TestBear.id, controller: 1 }, { card: 'Mountain', controller: 1 }],
      hands: [[TestBolt.id], [TestBolt.id]],
      libraries: [lib(5), lib(5)],          // top card first
    });
    act(s, castMove(s, 'Test Bolt', [O(id1(s, TestBear.id))]));
    pass(s);                                 // the other player passes: it resolves

- given() sets phaseQueue to the rest of the turn and stepPriority as the step normally has it.
- Auto-pass: a player whose only move is pass is never asked. If nobody has a decision, the engine plays on, possibly to the end of the game. Give the player you want to observe an instant and an untapped land (a Bolt and a Mountain) so the engine stops where you look, or assert on things that persist (graveyards, life, counters) rather than marked damage (cleanup removes it).
- pass() answers a pending declareAttackers or declareBlockers with no creatures; use act() with an explicit declaration otherwise. answer(s, {index}) or answer(s, {ids}) answers other Choices.
- Test-only cards: build them with the DSL and registerTestDef, with names unique across test files (the registry is shared inside a worker).

## 13. Recipes

Manland overlay (Mutavault, Hive, Den): an activated ability whose resolve calls ctx.animate(ctx.source, {types: ['Creature'], subtypes, allCreatureTypes, pt, keywords, abilities}). The overlay is object.animated and ends at cleanup. A land that is a creature and summoning sick can neither attack nor tap for mana (CR 302.6). Add window: (ctx) => ... so the generator offers the animation only where it can matter (main phase, beginning of combat, or with something on the stack).

Saga: face({types: ['Enchantment'], subtypes: ['Saga'], abilities: saga([ch1, ch2, ch3])}). The first lore counter is added as it enters, one more at each precombat main (saga.ts); chapters trigger from counterAdded; the final-chapter sacrifice is an SBA that waits while a chapter ability from it is pending or on the stack. Chapter III of a transforming saga calls ctx.exileAndReturnTransformed(ctx.source) (layout 'transform', face 1 is the back).

Room: room(name, leftFace, rightFace). Casting either half is a cast move with face 0 or 1; it enters with that door unlocked and that door's unlock trigger fires (CR 709.5h). The other door is an unlockDoor move (sorcery timing, pays that half's mana cost). trig('unlock', effect) on a door's face triggers only for that door.

Adventure: adventure(name, creatureFace, adventureFace). The cast move with face 1 casts the Adventure; on resolution the card is exiled with onAdventure and its owner may cast the creature face from exile (a cast move for the exiled object). A countered or fizzled Adventure goes to the graveyard.

Planeswalker: face({types: ['Planeswalker'], loyalty: N, abilities: [act({cost: {loyalty: 1}, ...}), act({cost: {loyalty: -2}, target: ..., ...})]}). Loyalty abilities are sorcery speed and once per turn per permanent (turnFlags.loyaltyUsed, CR 606.3). Damage removes loyalty; 0 loyalty is an SBA. Creatures may attack it (defenders()).

Vehicle: face({types: ['Artifact'], subtypes: ['Vehicle'], pt: [4, 4], abilities: [crew(3), ...]}). The crew move lists crewWith (minimal sufficient sets, capped at 4; summoning-sick creatures may crew); the crew is tapped as the cost; on resolution the Vehicle becomes an artifact creature until end of turn and object.crewed is set (cleanup clears both). Pilot's crewBonus adds to its crew power.

## 14. Approximations and deviations in this stage

- Damage division among several blockers is a fixed rule (ascending lethal need, lethal to each, the rest to the player with trample or to the last blocker) instead of a choice (CR 510.1c). One combat damage step (no first strike in the pool).
- Auto-pass: priority with pass as the only move is skipped, so agents never see those decisions.
- Triggers are collected after each whole operation, not at the instant of each event; intervening-if and filters see the state after the operation. No card in the pool depends on the difference.
- Order among one player's simultaneous triggers is asked only when they are not all the same ability.
- Up-to-N target specs must be the last spec of an ability (targets are flattened).
- The legend rule keeps the newest copy without asking when all copies are identical.
- Identical attackers or blockers are one option in attack and block enumeration; attack options are ranked by power at the player, block options by attacking power stopped, each capped at 64.

## 15. Not built yet

- Performance (T1.4): npm run bench on the test pool, 5 runs of 10,000 games (2026-09-29, i7-13700KF, Node 24.15, under tsx): median 133.0 games/sec/core (min 131.6, max 137.8); moves per game p50 57 [56, 57], p95 81 [81, 82]. Below the 1,000 target. The profile is dominated by move generation at priority stops (hasAction, cast enumeration, the payment solver) and the per-operation replay wrapper. Superseded by docs/PERF.md (T1.4 optimisation: test pool 397.8, game-1 decks 112.8 games/sec/core). Two rules from it for engine code: no named arrow functions in hot paths (tsx keepNames turns each into an Object.defineProperty per call; use method shorthand), and never delete a top-level GameState key (set it to undefined).

## Family creatures-b (Monastery Swiftspear, Emberheart Challenger, Sunspine Lynx, Weathered Runestone)

Engine additions (all additive):

- TriggeredDef.firstTimeEachTurn (types.ts, triggers.ts collectTriggers): a trigger with this flag fires only the first time each turn its event, scope and filter match. The engine sets object.valiantUsed as the event is read (not on resolution, so a fizzled targeting spell still used it up) and startTurn clears it. One such ability per object; it is how valiant is written: trig('becomesTarget', {filter: (ctx, info) => info.player === ctx.controller, firstTimeEachTurn: true}, effect).
- StaticCategory 'graveyardLibraryLock' (types.ts, zones.ts moveObject): while any permanent has it, moveObject refuses to put a nonland permanent card (Artifact, Creature, Enchantment, Planeswalker, Battle on the face that would enter) onto the battlefield from a graveyard or library; the card stays where it is and moveObject returns null. Lands are unaffected. Casting from a graveyard or library needs no guard: stack.ts fromOk allows only hand and exile with a permission (a comment there says so).

Card notes:

- Prowess needs no card code (built-in keyword trigger). Valiant exile uses ctx.exile on the top library card and ctx.grantPlayFromExile(newId, controller, state.turn), so the permission ends at this turn's cleanup and a land from exile uses the land drop.
- Sunspine Lynx: cantGainLife static plus a marker 'damageCantBePrevented' that nothing reads (no prevention effects in the pool; the test checks every oracle text that mentions prevention says "can't be prevented"). The ETB deals both players' damage in one resolution, so the 104.4a draw comes from the existing SBA.

## Family creatures-a (Bloodtithe Harvester, Gifted Aetherborn, Sheoldred, Graveyard Trespasser, Kalitas, Fear of Missing Out, Bonecrusher Giant)

Engine changes (all additive):

- types.ts SacrificeSpec.ctxFilter (optional): a second predicate with an EffectCtx, for sacrifice costs that read computed characteristics (Kalitas: another Vampire or Zombie, so an animated Mutavault with all creature types or a Reflection copy of a Vampire qualifies). cost.ts sacrificeCandidates requires filter and ctxFilter both to pass.
- zones.ts moveObject: CR 702.145b (daybound) a transform card whose front face has daybound enters back face up when it is night, decided before it enters, so the ETB trigger is the back face's (Graveyard Glutton exiles up to two).
- zones.ts die: fix. The after() of a would-die replacement ran with the dying creature's controller when the replacement's source died in the same event (Kalitas and an opponent's creature dealt lethal damage together gave the Zombie to the opponent). The source's controller is now captured before anything moves.

Card notes:

- Sheoldred: two trig('draw') abilities with scope 'you' and 'opponent'; one trigger per card drawn (CR 121.2), each a real stack object that resolves after she leaves.
- Trespasser: targets are cardInGraveyard, min 0, filtered to creature cards (the collapse from CARD-ANALYSIS), so the options are no target or creature cards. Ward is the keyword plus stat marker 'ward' with wardCost discard 1.
- Kalitas: dieReplacement static (nontoken, opponent-controlled creature) with after() creating the Zombie for Kalitas's controller.
- Fear of Missing Out: the first attack each turn is a trigger filter on attacksThisTurn === 1; delirium is interveningIf (deliriumCount is exported from the def for tests). The ETB discard is a pickObjects choice asked before the draw.
- Bonecrusher Giant: becomesTarget trigger filtered on info.amount === 1 (spells only, any controller). Stomp's can't-be-prevented clause is a no-op; the card test scans oracle.json (56 cards, 2 mention prevention, both can't be prevented).
- Card tests use test-only stand-ins (Test Bolt, small creatures, a pump, a graveyard exile instant) instead of other families' cards, so they do not depend on concurrent work.

## Family permanents-misc (Unholy Annex // Ritual Chamber, Liliana of the Veil, Reckoner Bankbuster, Unlicensed Hearse)

Engine hooks added (additive):
- TargetSpec.sameOwner (types.ts): every object target chosen for that spec must share one owner ('from a single graveyard'). targetTuples enumerates each owner's cards separately and merges the results (the empty choice once); recheckTargets marks a target illegal when its owner differs from the first target of that spec still present, so a mixed activation is rejected at activation time. Other up-to specs are unchanged.
- EffectCtx.addExiledWith(id, n) (types.ts, ctx.ts): adds n to object.exiledWith, only while that object exists. A ptCda reads it (Hearse). A zone change makes a new object with no exiledWith (CR 400.7).

Card notes:
- Annex: trig('endStep') on door 0 (your end step only); the Demon check runs on resolution after the draw (not an intervening-if). A Demon is a permanent with subtype Demon or with all creature types while a creature (animated Mutavault). Ritual Chamber: trig('unlock') on door 1, which fires both on unlock and when that half is cast.
- Liliana: +1 asks the active player, then the other player (pickObjects, reason 'lilianaDiscard'), then discards both; a player with an empty hand is skipped. Under choice replay the first answer only lives in state.pending, which views drop, so the second chooser cannot see it. -2 asks the target player (reason 'lilianaEdict'). -6: lilianaSplits (exported) builds up to three splits (lands vs nonlands, best threat alone vs rest, greedy balance by a worth heuristic), drops duplicate splits, the controller picks one (pickIndex 'lilianaSplit', skipped when only one), the target player picks the pile to sacrifice (pickIndex 'lilianaPile').
- Vehicles: vehicleCrewWindow (exported from reckoner-bankbuster.ts) offers crew in your main1 and beginning of combat and in the opponent's declare attackers step; legality ignores it (D9). Bankbuster draw and Hearse tap windows: your main phases with an empty stack, and the opponent's end step. Bankbuster's no-counters check uses the LKI minus the removed counter if the Vehicle left before resolution.
- Hearse targets: t.cardInGraveyard({min 0, max 2, sameOwner}). The count-only collapse (PLAN.md D9) is built in the integration: TargetSpec.countOnlyOpponent, see the Integration section.
- Card tests use test-only stand-ins (Test Bolt, Test Bear, small creatures, a cantGainLife creature for Sunspine Lynx, a nonartifact-creature target spec for Go for the Throat).

## Family burn-pump (Burst Lightning, Monstrous Rage, Reckless Rage, Flowstone Infusion, Pyroclasm, Redcap Melee, Scorching Shot, Soul-Scar Mage, Magebane Lizard, Screaming Nemesis)

Engine hooks added (all additive):
- EffectCtx.setCantGainLife(player) (types.ts, ctx.ts): sets the public player flag cantGainLife through setPlayer (journaled). Screaming Nemesis uses it; life.ts already reads the flag.
- StaticDef.damageToCounters gets a fifth argument, sourceController (types.ts, damage.ts passes src.controller). It is the damage source's controller from last known information when the source has left, so Soul-Scar Mage still converts damage from a dead Screaming Nemesis's trigger. Four-argument implementations stay valid.
- ModeDef.prune?(ctx, targets) (types.ts, moves.ts castMoves): a move-generator filter on target tuples, like ActivatedDef.window. Legality ignores it; if it would remove every tuple, nothing is removed. Reckless Rage uses it. spell() in dsl.ts passes prune through for a single-mode spell (integration, 2026-09-29; Reckless Rage uses spell() now).

Card notes:
- Monster Role: ctx.createToken('MonsterRole', controller, {attachedTo}). Uniqueness (CR 303.7a) and falling off a non-creature (CR 704.5m) are the existing SBAs; the P/T and trample come from the enchantedGets static.
- Soul-Scar Mage: damageReplacement with damageToCounters (noncombat, source controlled by Soul-Scar's controller, creature controlled by an opponent). damage.ts applies the first matching replacement only, so two Soul-Scars give the counters once (CR 616.1f).
- Screaming Nemesis: trig('dealtDamage') with an any-other-target spec (filter excludes ctx.source). The trigger system already sums one drain per object, so a double block or a Pyroclasm is one trigger for the total. The trigger is collected before the SBA check, so lethal damage still triggers it.
- Magebane Lizard: trig('cast', scope any, filter noncreature by ctx.isType on the spell object); the damage reads turnFlags.noncreatureSpellsCast on resolution. Adventure halves count (face 1 is an instant on the stack); door unlocks are not casts.
- Redcap Melee: reads the target's color before dealing damage and sacrifices only when ctx.dealDamage returned more than 0. The land is asked with pickObjects reason 'sacrificeLand' (identical lands by def, face and tapped collapse to one). RED_BIT and Reckless Rage's PROWESS_BIT are now COLOR.R and KW.prowess from src/engine/bits.ts (integration); the tests that pin them stay.
- Reckless Rage prune: own targets that survive 2 damage (prowess counted) or have a dealtDamage trigger, plus the one cheapest dying creature (lowest power plus toughness).
- Tests: src/test/cards/burn-pump-fixtures.ts holds the stand-ins ('Test BP ...'), expectOracle (def against decks/oracle.json, seen failing with a wrong cost), drain, pickTargets, until and toNextTurn.
- Deviation from docs/CARD-ANALYSIS.json: Pyroclasm scenarios 1 and 2 say the prowess creatures (Swiftspear, Soul-Scar Mage) die. Casting Pyroclasm triggers their prowess first, so each is 2/3 and survives 2 damage; the tests assert that.

## Family lands (Blackcleave Cliffs, Blazemire Verge, Blightstep Pathway, Blood Crypt, Castle Locthwain, Den of the Bugbear, Hive of the Eye Tyrant, Mutavault, Petrified Hamlet, Ramunap Ruins, Rockface Village, Sokenzan, Takenuma, Urborg)

Engine additions (all additive):
- dsl.ts granted(ownerName, abilities) and grantedKey(def, i): abilities an effect grants (a manland's quoted attack trigger) need AbilityKeys, so they live in a hidden token-layout def with id slug-granted (never in a deck, not in CARDS; index.ts registers LANDS_GRANTED). The animation overlay lists grantedKey(def, 0). Den of the Bugbear and Hive of the Eye Tyrant use it; an unanimated land has no attack ability at all.
- ContinuousEffect namedBan gained an optional grant (AbilityKey). EffectCtx.addNamedBan(name, grant?) adds one from the resolving source (only while it is on the battlefield). statics.ts adds the grant key to the abilities of every battlefield land with that name (layer 6); zones.ts moveObject removes the namedBan effects of a source that leaves the battlefield. The existing activationBanned (stack.ts) already enforces the ban in every zone for both players.
- moves.ts landMoves: the shock-land pay variant is offered only when life is above the payment (paying to exactly 0 is still legal through playLand; it just loses at the next SBA check).

Card notes:
- src/cards/land-windows.ts holds the shared move-generator windows and helpers: manlandWindow (own main1 or beginning of combat, opponent's beginning of combat or declare attackers, or anything on the stack), sokenzanWindow (own main1, opponent's declare attackers or end step), mainOrEndStepWindow (own main phases, opponent's end step, or anything on the stack: Takenuma channel and Ramunap burn), legendaryCreatureCount (channel reduction) and landCount (fast-land and manland enters-tapped predicates; the entering card is not on the battlefield yet, so it counts other lands).
- Castle Locthwain has no window: it is offered at every priority stop where it can be paid.
- Petrified Hamlet chooses with a pickIndex into HAMLET_NAMES (the eight lands with non-mana activated abilities in both 75s, PLAN.md section 5). The grant is the Hamlet's own {T}: Add {C} (key petrified-hamlet:0:0).
- Ramunap Ruins: the Desert filter reads the printed face subtypes through the registry (defs never import statics). Sacrifice choices collapse by classKey, so two untapped Ruins give one burn move; the tests activate with an explicit sacrifice.
- Takenuma: the return choice is a pickObjects over one representative per def among creature and planeswalker cards in the graveyard; no choice is asked when there is exactly one candidate or none.
- Tests: src/test/cards/lands-util.ts (passUntil, playLandNow, activations, activateNow), src/test/cards/lands-oracle.test.ts (all 14 defs against decks/oracle.json, prints the count; seen failing with Blood Crypt subtypes swapped). Mutation check (2026-09-29): fast-land threshold, Verge condition, Den token tapped flag, Rockface target filter, Hamlet removal on leaving, Hamlet grant, shock-land prune; each made its test fail.

## Family sagas (Fable of the Mirror-Breaker, Kumano Faces Kakkazan, Hidetsugu Consumes All, The Legend of Roku)

Engine additions (all additive):
- ctx.setNextCreatureBonus(player): sets turnFlags.nextCreatureBonus (Kumano chapter II, PLAN.md D9). castSpell already consumes it into StackItem.enterCounters and cleanup clears it.
- ctx.loseGame(player, reason): sets state.result (CR 104.3e); a no-op once the game has a result. Used by Vessel of the All-Consuming.
- ctx.destroyAll(ids): destroys every listed permanent still on the battlefield in one die() call, so would-die replacements from a permanent destroyed in the same event still apply (Hidetsugu chapter I with Etching of Kumano). Other mass-destroy effects can use it.
- Copy of a back face: TokenOpts.copyFace and GameObject.copyFace (1 or absent). With copyOf, characteristics (statics.ts), leaves-the-battlefield trigger lookback (triggers.ts lkiKeys) and damage-source LKI (damage.ts) read that face of the copied def; the copy's mana value is 0 (CR 712.8e). classKey includes it. Reflection passes copyFace 1 when the target shows its back face (another Reflection, Vessel, a night-side Glutton). The copy is not itself a double-faced token (CR 707.8a says it should be; nothing in the pool transforms a copy).

Card notes:
- Fable: chapter II is a pickObjects Choice (reason 'fableRummage', min 0, max 2). The card narrows 'from' to the best-ranked distinct names so the collapsed options (sizes 0 to 2) stay at or under 20 (RUMMAGE_CAP): lands first when the controller has four or more lands, then nonlands by mana value, highest first. Reflection's copy is createToken('Copy', ..., {copyOf, copyFace}) plus addDelayed('endStep', 1, tokenId); the delayed ability sacrifices it if it is still there (CR 603.7c). Animated lands and crewed Vehicles are pruned from its targets (PLAN.md section 5).
- Kumano: chapter I damages the opponent and each planeswalker they control. Etching's dieReplacement applies to a creature with damagedThisTurnBy[Etching's controller].
- Hidetsugu: chapter I filters nonland permanents by characteristics().manaValue <= 1 (tokens 0, transformed back faces use the front face). Vessel carries the 'tracksDamageDealt' marker; its lose trigger is an intervening-if on turnFlags.damageTally[vessel][player] >= 10. The counter trigger and the lose trigger go on the stack together, so its controller is asked to order them.
- Roku: chapter I grants playFromExile until turn + 2 when it resolves in the controller's turn (else turn + 1); chapter II adds R (D9); Avatar Roku has an explicit firebending attack trigger (the keyword bit alone does nothing) and act({cost: {mana: '{8}'}}), which the move generator offers only when a payment plan exists, including pool mana from firebending.
- Tests: src/test/cards/<card>.test.ts, each with local stand-ins ('Test Fable ...', 'Test Kumano ...', 'Test Hid ...', 'Test Roku ...'). Scenario tests must keep the observed player holding an instant and an untapped land, or auto-pass plays the game on past the point under test.

## Family removal-discard (Abrade, Bitter Triumph, Duress, Fatal Push, Go for the Throat, Thoughtseize, Go Blank, Extinction Event, Invoke Despair, Ray of Enfeeblement, Torch the Tower)

Engine hooks added (all additive):
- EffectCtx.reveal(ids): hand or library cards become known to both players (knownTo = [true, true]). Duress and Thoughtseize reveal the whole target hand first; cards that stay in that hand keep knownTo until they leave it (CR 400.7), new draws are unknown.
- Choice pickObjects gains an optional reveal: ObjId[]. The replay (runWithChoices) rolls back the knownTo change made before a mid-resolution choice, so without it the chooser would pick from ids it cannot see and the view leak check (inv8) would fire on the 'from' list. view.ts shows the reveal list to the chooser while the choice is pending (hand cards go into known, library cards into objects); checkViewLeak in tools/play.ts treats them as visible to the chooser only. The other player still sees only {kind, player, hidden}. src/test/cards/duress.test.ts proves the checker fires when reveal is removed.
- EffectCtx.scry1(player): a pickObjects Choice (reason 'scry1', from [top], min 0, max 1, reveal [top]); picking the card sends it to the bottom, picking none keeps it on top; zones.scry1 records libraryKnown and knownTo for the owner.
- EffectCtx.exileIfDiesThisTurn(id): adds the exileIfDies effect (until eot) that the die choke point already reads; cleanup removes it.

Card notes:
- Discard choices are plain pickObjects over the full candidate list; moves.ts collapses them by name (two copies of one card are one option; Go Blank pairs are multisets by name).
- Fatal Push: every creature is a legal target; mana value and revolt (turnFlags.permanentLeft of the caster) are read on resolution. A Treasure spent while casting turns revolt on before resolution.
- Extinction Event: pickIndex reason 'oddOrEven' (0 odd, 1 even), asked of the caster on resolution; exile, so no dies triggers and no die replacements.
- Invoke Despair: three sequential edicts; a single candidate is sacrificed without a choice. SBAs are not checked mid-resolution (CR 704.3), so a Role left on the battlefield by the creature step is the enchantment sacrificed next (tested).
- Torch the Tower: tags the permanent only when damage was actually dealt (dealDamage returned more than 0); bargain is the existing cast-move option; scry only when bargained. With Kalitas also applying, the dying creature's controller chooses (tested).
- Ray of Enfeeblement: white is COLOR.W from src/engine/bits.ts (was a hard-coded 1 before the integration).
- Approximation: the generator does not prune Fatal Push targets it cannot kill (the analysis suggested it); every creature stays a legal target, which is correct for becomes-target triggers.

## Integration (2026-09-29, after the seven card families)

Reconciled hooks (one way to do each thing):
- Bit constants: TYPE, COLOR, KW moved to src/engine/bits.ts (a leaf module); statics.ts re-exports them, so every existing engine import still works. The three defs that hard-coded bits (Redcap Melee RED_BIT, Reckless Rage PROWESS_BIT, Ray of Enfeeblement WHITE) import them from bits.ts.
- Target-tuple pruning: ModeDef.prune is the one generator filter for spell targets, and spell() now passes it through, so no def writes a SpellDef literal to get it (Reckless Rage migrated).
- Kept as two mechanisms on purpose: TriggeredDef.firstTimeEachTurn (valiant: the first time the trigger's event, scope and filter match, recorded as it triggers) and FOMO's attacksThisTurn === 1 filter (the first attack of the object, whether or not the delirium intervening-if held). They count different things: firstTimeEachTurn is checked after interveningIf, so using it for FOMO would let a later attack trigger when the first one had no delirium (CR 603.4 (intervening if)).
- Other family hooks were additive and do not overlap: setCantGainLife (a public player flag, Nemesis) vs the cantGainLife static (Sunspine Lynx) are both read by life.ts; destroyAll (Hidetsugu) is the only mass destroy (Pyroclasm deals damage, Extinction Event exiles).

New in the integration:
- TargetSpec.countOnlyOpponent (types.ts, targets.ts targetTuples): with sameOwner and move-generator collapse, the opponent's graveyard gives one tuple per size (the lowest ids), listed before the controller's own so the tuple cap never drops them. Legality and recheckTargets ignore it. Unlicensed Hearse uses it (PLAN.md D9: only the count matters for B's graveyard, which nothing in either 75 reads).
- Fuzz pool 'sideboard' (npm run fuzz -- --pool sideboard): each real 60 with its whole 15-card sideboard swapped in for the SIDEBOARD_SWAP outs in src/test/pool.ts. The fuzz report now prints how many distinct defs moves cast, played, activated or unlocked, and names every decklist card that no move used (PlayOpts.used in tools/play.ts).
- lint:cr fix: rule lines that contain U+2028 (205.4c, 509.1b) were not parsed ('.' does not match it), so citations of them failed; the parser now reads them.
- Tests: src/test/rules/interactions.test.ts (the seven PLAN.md section 7 interactions with real card defs, each with a control case, plus the oracle pool assertions), src/test/cards/swamp.test.ts and mountain.test.ts (the basics had no scenario test).

