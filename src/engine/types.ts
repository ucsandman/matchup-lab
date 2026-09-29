// Core types for the rules engine. Everything reachable from GameState is plain JSON data:
// no classes, Maps, Sets or functions (PLAN.md section 6). Card definitions (CardDef) hold
// functions but never live in state; state refers to them by DefId and AbilityKey.

export type PlayerId = 0 | 1;
export type ObjId = number;
/** Kebab-case slug of the front face name ('bloodtithe-harvester'); tokens use 'token-<name>'. */
export type DefId = string;
/** 'defId:face:index' for printed abilities, 'basic:B' style for intrinsic land mana abilities. */
export type AbilityKey = string;
export type TokenDefId = DefId;

export type Zone = 'library' | 'hand' | 'graveyard' | 'exile' | 'battlefield' | 'stack';
export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
export type ManaColor = Color | 'C';
export type CardType =
  | 'Land' | 'Creature' | 'Artifact' | 'Enchantment' | 'Planeswalker' | 'Instant' | 'Sorcery' | 'Kindred' | 'Battle';
export type Supertype = 'Legendary' | 'Basic';
export type CounterType = 'p1p1' | 'm1m1' | 'lore' | 'loyalty' | 'charge';
export type Keyword =
  | 'haste' | 'prowess' | 'deathtouch' | 'lifelink' | 'trample' | 'menace' | 'flying' | 'ward'
  | 'valiant' | 'daybound' | 'nightbound' | 'firebending';

/** Steps in turn order. 'mulligan' is the pregame pseudo-step before turn 1. */
export type Step =
  | 'mulligan' | 'untap' | 'upkeep' | 'draw' | 'main1' | 'beginCombat' | 'declareAttackers' | 'declareBlockers'
  | 'combatDamage' | 'endCombat' | 'main2' | 'end' | 'cleanup';
export type Phase = 'pregame' | 'beginning' | 'main1' | 'combat' | 'main2' | 'ending';

export const PHASE_OF: Readonly<Record<Step, Phase>> = {
  mulligan: 'pregame', untap: 'beginning', upkeep: 'beginning', draw: 'beginning', main1: 'main1',
  beginCombat: 'combat', declareAttackers: 'combat', declareBlockers: 'combat', combatDamage: 'combat',
  endCombat: 'combat', main2: 'main2', end: 'ending', cleanup: 'ending',
};
/** The normal turn, used to fill phaseQueue at turn start. */
export const TURN_STEPS: readonly Step[] = [
  'untap', 'upkeep', 'draw', 'main1', 'beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage',
  'endCombat', 'main2', 'end', 'cleanup',
];
/** One combat phase; an extra combat (Fear of Missing Out) inserts these at the front of phaseQueue. */
export const COMBAT_STEPS: readonly Step[] = ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat'];

/** xoshiro128** state: four uint32 words. */
export type RngState = [number, number, number, number];

export interface ManaPoolEntry {
  color: ManaColor;
  /** Rockface Village: spend only to cast a creature spell. */
  restriction?: 'creatureSpell';
  /** Absent: empties at the end of the step. 'endOfCombat': firebending mana. */
  expires?: 'endOfCombat';
}

export interface LibraryKnown {
  /** Known cards from the top down: top[0] is the top card. */
  top: ObjId[];
  /** Known cards from the bottom up: bottom[0] is the very bottom card. */
  bottom: ObjId[];
}

export interface PlayerState {
  life: number;
  cantGainLife: boolean;
  manaPool: ManaPoolEntry[];
  mulligans: number;
  /** True once the player kept an opening hand. */
  kept: boolean;
  libraryKnown: LibraryKnown;
  /** Set when the player tried to draw from an empty library; read by the SBA check. */
  drewFromEmpty: boolean;
}

export type Defender = { kind: 'player'; p: PlayerId } | { kind: 'planeswalker'; id: ObjId };
export type Target = { kind: 'player'; p: PlayerId } | { kind: 'obj'; id: ObjId };

/** Manland animation overlay (Mutavault, Hive, Den). Lasts until cleanup. */
export interface Overlay {
  types?: CardType[];
  subtypes?: string[];
  allCreatureTypes?: boolean;
  colors?: Color[];
  pt?: [number, number];
  keywords?: Keyword[];
  abilities?: AbilityKey[];
}

export interface GameObject {
  id: ObjId;
  defId: DefId;
  /** Face shown: MDFC face played, transformed back face, adventure/room half on the stack. */
  face: 0 | 1;
  owner: PlayerId;
  controller: PlayerId;
  zone: Zone;
  tapped: boolean;
  damage: number;
  /** Lore, loyalty and charge are counters too (a missing key means zero). */
  counters: Partial<Record<CounterType, number>>;
  /** Summoning sick: not controlled continuously since the controller's most recent turn began. */
  sick: boolean;
  /** Identity visible to player 0 / player 1. */
  knownTo: [boolean, boolean];
  token?: TokenDefId;
  copyOf?: DefId;
  /** With copyOf: the copied face (1 = back face up, CR 707.8a (copy of a double-faced permanent)); absent means 0. */
  copyFace?: 1;
  attachedTo?: ObjId;
  /** Room doors: [left unlocked, right unlocked]. */
  unlocked?: [boolean, boolean];
  onAdventure?: boolean;
  exiledWith?: number;
  damagedThisTurnBy: [boolean, boolean];
  valiantUsed?: boolean;
  attacksThisTurn?: number;
  attacking?: Defender;
  blocking?: ObjId[];
  /** CR 509.1h (blocked creature): set on an attacker when blockers are declared for it; stays until combat ends. */
  blocked?: boolean;
  /** Dealt damage by a deathtouch source since the last SBA check (CR 702.2b (deathtouch)). */
  deathtouched?: boolean;
  animated?: Overlay;
  crewed?: boolean;
  chosenName?: string;
}

/** Scalar data about the event that caused a trigger. Ids here must be public objects. */
export interface TriggerInfo {
  event: TriggerEventName;
  amount?: number;
  player?: PlayerId;
  objId?: ObjId;
  chapter?: number;
  /** becomesTarget: the spell or ability (stack item id) that targeted objId. */
  stackId?: ObjId;
  /** unlock: the door that was unlocked. */
  half?: 0 | 1;
}

/** A triggered ability that has triggered and waits to be put on the stack (CR 603.3 (triggered abilities)). */
export interface PendingTrigger {
  /** AbilityKey of the triggered ability, or 'builtin:prowess' / 'builtin:ward'. */
  key: AbilityKey;
  sourceId: ObjId;
  controller: PlayerId;
  info: TriggerInfo;
  /** Last known information when the source already left its zone (dies and leaves triggers). */
  lki?: GameObject;
}

/** A delayed triggered ability (CR 603.7 (delayed triggered ability)); fires once, then is removed. */
export interface DelayedTrigger {
  id: number;
  key: AbilityKey;
  sourceId: ObjId;
  controller: PlayerId;
  on: TriggerEventName;
  objId?: ObjId;
  createdTurn: number;
}

/** An engine operation that can stop for a player decision and is replayed with the answers (apply.ts). */
export type EngineOp =
  | { kind: 'move'; player: PlayerId; move: Move }
  | { kind: 'resolve' }
  | { kind: 'sba' }
  | { kind: 'triggers' }
  | { kind: 'stepAction'; step: Step };
export interface PendingOp { op: EngineOp; answers: ChoiceAnswer[] }

export interface StackItem {
  /** Spell: the card object's id (object.zone === 'stack'). Ability: a fresh id. */
  id: ObjId;
  kind: 'spell' | 'activated' | 'triggered';
  controller: PlayerId;
  sourceId: ObjId;
  defId: DefId;
  face: 0 | 1;
  abilityKey?: AbilityKey;
  targets: Target[];
  mode?: number;
  kicked?: boolean;
  bargained?: boolean;
  x?: number;
  trigger?: TriggerInfo;
  /** Last known information about the source, for abilities whose source left. */
  lki?: GameObject;
  /** Extra counters the permanent spell enters with (Kumano chapter II flag consumed at cast). */
  enterCounters?: Partial<Record<CounterType, number>>;
}

export type ContinuousEffect =
  | { eid: number; kind: 'ptDelta'; target: ObjId; p: number; t: number; until: 'eot' }
  | { eid: number; kind: 'keywords'; target: ObjId; keywords: Keyword[]; until: 'eot' }
  | { eid: number; kind: 'exileIfDies'; target: ObjId; until: 'eot' }
  | { eid: number; kind: 'playFromExile'; objId: ObjId; player: PlayerId; untilTurn: number }
  /**
   * Petrified Hamlet: non-mana activated abilities of sources named 'name' can't be activated; lands
   * with that name also have the ability 'grant' (lands family). Removed when sourceId leaves the battlefield.
   */
  | { eid: number; kind: 'namedBan'; player: PlayerId; name: string; sourceId: ObjId; grant?: AbilityKey };

export interface TurnFlags {
  landsPlayed: [number, number];
  spellsCast: [number, number];
  noncreatureSpellsCast: [number, number];
  permanentLeft: [boolean, boolean];
  nextCreatureBonus: [boolean, boolean];
  /** Damage dealt this turn by a source to each player: tally[sourceId] = [to p0, to p1]. */
  damageTally: Record<number, [number, number]>;
  /** Permanents whose loyalty ability was activated this turn (CR 606.3 (loyalty ability once per turn)). */
  loyaltyUsed: ObjId[];
}

/** Events buffered during an action; the trigger system drains them. Never in a view. */
export type GameEvent =
  | { e: 'zoneChange'; oldId: ObjId | null; newId: ObjId | null; from: Zone | null; to: Zone; cause: string; lki: GameObject | null }
  | { e: 'draw'; player: PlayerId; id: ObjId }
  | { e: 'discard'; player: PlayerId; id: ObjId }
  | { e: 'mill'; player: PlayerId; id: ObjId }
  | { e: 'tokenCreated'; id: ObjId; controller: PlayerId; token: TokenDefId }
  | { e: 'counterAdded'; id: ObjId; counter: CounterType; n: number }
  | { e: 'lifeGain'; player: PlayerId; amount: number }
  | { e: 'lifeLoss'; player: PlayerId; amount: number }
  | { e: 'damage'; source: ObjId; target: Target; amount: number; combat: boolean }
  | { e: 'manaAdded'; player: PlayerId; color: ManaColor; sourceId: ObjId | null }
  | { e: 'cast'; player: PlayerId; id: ObjId; creature: boolean }
  | { e: 'becomesTarget'; id: ObjId; stackId: ObjId; player: PlayerId; spell: boolean }
  | { e: 'attacks'; id: ObjId; defender: Defender }
  | { e: 'unlock'; id: ObjId; half: 0 | 1 }
  | { e: 'step'; step: Step; player: PlayerId };

/** Names a trigger can listen to (dsl trig()). Derived by the trigger system from GameEvent. */
export type TriggerEventName =
  | 'etb' | 'dies' | 'ltb' | 'draw' | 'discard' | 'cast' | 'attacks' | 'dealtDamage' | 'dealsDamage'
  | 'upkeep' | 'endStep' | 'precombatMain' | 'chapter' | 'unlock' | 'becomesTarget' | 'tokenCreated' | 'lifeGain'
  /** Never fires from an event: the effect of a delayed trigger created with ctx.addDelayed. */
  | 'delayed';

export type Choice =
  | { kind: 'mulligan'; player: PlayerId }
  | { kind: 'bottom'; player: PlayerId; count: number }
  | { kind: 'dieReplacement'; player: PlayerId; objId: ObjId; options: DieReplacementRef[] }
  | {
      kind: 'pickObjects'; player: PlayerId; reason: string; from: ObjId[]; min: number; max: number;
      /**
       * Hidden cards this choice shows to the chooser while it is pending (a hand revealed by
       * Duress or Thoughtseize, a scried card). The replay rolls back the knownTo change made
       * before the choice, so view() shows these to the chooser from here (removal-discard family).
       */
      reveal?: ObjId[];
    }
  | { kind: 'pickIndex'; player: PlayerId; reason: string; count: number }
  /** Targets for a triggered ability as it goes on the stack; answered with index into options. */
  | { kind: 'pickTargets'; player: PlayerId; reason: string; options: Target[][] }
  /** Turn-based actions answered by declareAttackers / declareBlockers moves. */
  | { kind: 'declareAttackers'; player: PlayerId }
  | { kind: 'declareBlockers'; player: PlayerId };

export interface ChoiceAnswer {
  keep?: boolean;
  ids?: ObjId[];
  index?: number;
}

/** One applicable 'would die' replacement: an effect (Torch the Tower) or a static ability. */
export interface DieReplacementRef {
  source: ObjId | null;
  /** AbilityKey of the static, or 'effect:<eid>'. */
  key: string;
}

export type Move =
  | { type: 'playLand'; objId: ObjId; face?: 0 | 1; pay?: boolean }
  | {
      type: 'cast'; objId: ObjId; face?: 0 | 1; half?: 0 | 1; mode?: number; kicked?: boolean; bargain?: ObjId;
      costChoice?: number; discard?: ObjId[]; targets: Target[]; payment?: number;
    }
  | { type: 'activate'; objId: ObjId; abilityKey: AbilityKey; targets: Target[]; crewWith?: ObjId[]; sacrifice?: ObjId[]; discard?: ObjId[]; payment?: number }
  | { type: 'unlockDoor'; objId: ObjId; half: 0 | 1; payment?: number }
  | { type: 'declareAttackers'; assignments: [ObjId, Defender][] }
  | { type: 'declareBlockers'; assignments: [ObjId, ObjId][] }
  | { type: 'choose'; answer: ChoiceAnswer }
  | { type: 'pass' };

export type PathKey = string | number;
/** Journal inverse records, plain data. */
export type Inverse =
  | { op: 'set'; path: PathKey[]; had: boolean; old?: unknown }
  | { op: 'splice'; path: PathKey[]; index: number; del: number; ins: unknown[] };

export interface Zones {
  /** Library order: index 0 is the bottom, the last element is the top. */
  library: [ObjId[], ObjId[]];
  hand: [ObjId[], ObjId[]];
  graveyard: [ObjId[], ObjId[]];
  exile: [ObjId[], ObjId[]];
  battlefield: ObjId[];
  /** Last element is the top of the stack. */
  stack: StackItem[];
}

export interface Pregame {
  /** Players still to declare keep or mulligan this round, starting player first. */
  toDeclare: PlayerId[];
  /** Players who declared a mulligan this round. */
  mulling: PlayerId[];
  /** Players who still have to choose cards to put on the bottom. */
  toBottom: PlayerId[];
}

export interface GameState {
  seed: RngState;
  nextId: number;
  /**
   * Journal-mode inverse log; undefined (or absent) when journaling is off. endJournal sets it to
   * undefined instead of deleting the key: a delete drops the state object into V8 dictionary mode
   * and slows every later state access (docs/PERF.md).
   */
  journal?: Inverse[] | undefined;
  turn: number;
  activePlayer: PlayerId;
  priority: PlayerId;
  /** The player who took (or takes) the first turn. */
  startingPlayer: PlayerId;
  /** Remaining steps of this turn after the current one (holds steps, see ENGINE-NOTES). */
  phaseQueue: Step[];
  step: Step;
  players: [PlayerState, PlayerState];
  objects: Record<number, GameObject>;
  zones: Zones;
  dayNight: 'none' | 'day' | 'night';
  turnFlags: TurnFlags;
  effects: ContinuousEffect[];
  pendingChoice: Choice | null;
  /** The operation replayed with the answers when pendingChoice is answered (null for pregame). */
  pending: PendingOp | null;
  /** Consecutive priority passes with no action in between (CR 117.4 (all players pass)). */
  passes: number;
  /** Players get priority in the current step (false in untap and normally in cleanup). */
  stepPriority: boolean;
  /** Triggered abilities waiting to be put on the stack. */
  pendingTriggers: PendingTrigger[];
  delayed: DelayedTrigger[];
  pregame: Pregame | null;
  result: null | { winner: PlayerId | 'draw'; reason: string };
  events: GameEvent[];
  log?: string[];
}

// ---------------------------------------------------------------------------------------------
// Card definitions (not state). Functions are allowed here; state stores DefId / AbilityKey only.

export interface ManaCost { generic: number; W: number; U: number; B: number; R: number; G: number; C: number }

export interface SacrificeSpec {
  count: number;
  /** Predicate over a candidate permanent id (from the payer's permanents). */
  filter: (state: GameState, id: ObjId, sourceId: ObjId) => boolean;
  /** Excludes the source itself ('Sacrifice another ...'). */
  another?: boolean;
  /**
   * Optional extra predicate with an effect context (ctx.source is the ability's source), for
   * filters that read computed characteristics such as creature types (Kalitas: another Vampire
   * or Zombie). A candidate must pass both filter and ctxFilter.
   */
  ctxFilter?: (ctx: EffectCtx, id: ObjId) => boolean;
}

export interface CostSpec {
  mana?: string;
  tap?: boolean;
  life?: number;
  sacrificeSelf?: boolean;
  sacrifice?: SacrificeSpec;
  discard?: number;
  discardSelf?: boolean;
  removeCounter?: { type: CounterType; n: number };
  /** Planeswalker loyalty cost: positive adds, negative removes. */
  loyalty?: number;
  /** Crew N: tap other untapped creatures you control with total power N or more (move.crewWith). */
  crew?: number;
}

export type TargetKind =
  | 'creature' | 'player' | 'opponent' | 'any' | 'creatureOrPlaneswalker' | 'artifact' | 'permanent'
  | 'planeswalker' | 'cardInGraveyard';

export interface TargetSpec {
  kind: TargetKind;
  controller?: 'you' | 'opponent';
  /** Up to N targets: min 0. Default min = max = 1. */
  min?: number;
  max?: number;
  filter?: (ctx: EffectCtx, target: Target) => boolean;
  /**
   * Up-to-N object targets must all share one owner ('from a single graveyard': Unlicensed Hearse).
   * Enforced in targetTuples and in recheckTargets.
   */
  sameOwner?: boolean;
  /**
   * Move-generator collapse only (PLAN.md D9, Unlicensed Hearse): with sameOwner, the choices
   * from the opponent's graveyard are count-only, one tuple per size (the lowest ids), listed
   * before the controller's own. Legality and recheckTargets ignore it.
   */
  countOnlyOpponent?: boolean;
}

export type EffectFn = (ctx: EffectCtx, targets: Target[]) => void;

export interface TriggeredDef {
  kind: 'triggered';
  event: TriggerEventName;
  /** Saga chapter number for event 'chapter'. */
  chapter?: number;
  /** 'self' (default for etb/dies/attacks): the event must be about this object. */
  scope?: 'self' | 'any' | 'you' | 'opponent';
  filter?: (ctx: EffectCtx, info: TriggerInfo) => boolean;
  /** Intervening-if clause, checked on trigger and on resolution. */
  interveningIf?: (ctx: EffectCtx, info: TriggerInfo) => boolean;
  targets?: TargetSpec[];
  optional?: boolean;
  /**
   * Valiant (CR 207.2c (ability word)): triggers only the first time each turn its event and filter
   * match. The engine records the first match on object.valiantUsed as the event happens (not on
   * resolution) and startTurn clears it. One such ability per object.
   */
  firstTimeEachTurn?: boolean;
  effect: (ctx: EffectCtx, targets: Target[], info: TriggerInfo) => void;
}

export interface ActivatedDef {
  kind: 'activated';
  cost: CostSpec;
  timing: 'instant' | 'sorcery';
  /** 'hand' for channel abilities. */
  zone: 'battlefield' | 'hand';
  targets?: TargetSpec[];
  /** Generic mana reduction (Sokenzan, Takenuma channel). */
  costReduction?: (ctx: EffectCtx) => number;
  /**
   * Move-generator pruning only (PLAN.md D9): the activation is offered only when this returns true
   * (manland animation and channel windows). Legality itself does not read it.
   */
  window?: (ctx: EffectCtx) => boolean;
  resolve: EffectFn;
}

export interface ManaAbilityDef {
  kind: 'mana';
  produce: ManaColor[] | 'any';
  cost: CostSpec;
  restriction?: 'creatureSpell';
  expires?: 'endOfCombat';
  /** Activation condition (Blazemire Verge). */
  condition?: (ctx: EffectCtx) => boolean;
}

export type StaticCategory =
  | 'allLandsAreSwamps' | 'entersTapped' | 'dieReplacement' | 'cantGainLife' | 'enchantedGets'
  | 'ptCda' | 'crewBonus' | 'damageReplacement' | 'activationRestriction' | 'marker'
  /** Weathered Runestone: nonland permanent cards in graveyards and libraries can't enter the battlefield (zones.ts moveObject). */
  | 'graveyardLibraryLock';

export interface StaticDef {
  kind: 'static';
  category: StaticCategory;
  /** entersTapped: evaluated as the permanent enters (ctx.source is the entering card). */
  entersTapped?: (ctx: EffectCtx) => boolean;
  /** Shock lands: the permanent enters untapped only if its controller pays this much life. */
  payLifeToUntap?: number;
  /** dieReplacement: does it apply to the object about to die? */
  applies?: (ctx: EffectCtx, dyingId: ObjId) => boolean;
  /** dieReplacement: runs after the dying object is exiled instead (Kalitas makes a Zombie). */
  after?: (ctx: EffectCtx, lki: GameObject) => void;
  /** enchantedGets (Roles). */
  p?: number;
  t?: number;
  keywords?: Keyword[];
  /** ptCda (Unlicensed Hearse). */
  cda?: (state: GameState, id: ObjId) => [number, number];
  amount?: number;
  /** marker: 'tracksDamageDealt' turns on the per-source damage tally; 'ward' carries wardCost. */
  marker?: string;
  /** marker 'ward': the ward cost the targeting player pays or the spell or ability is countered. */
  wardCost?: CostSpec;
  /**
   * damageReplacement (Soul-Scar Mage): true when damage from sourceId to targetId is replaced by
   * that many -1/-1 counters. ctx is the static's source. sourceController is the damage source's
   * controller, from last known information when the source has left (burn-pump).
   */
  damageToCounters?: (ctx: EffectCtx, sourceId: ObjId, targetId: ObjId, combat: boolean, sourceController: PlayerId) => boolean;
}

export interface ModeDef {
  targets: TargetSpec[];
  resolve: EffectFn;
  /**
   * Move-generator pruning only (like ActivatedDef.window): a target tuple is offered only when
   * this returns true. Legality ignores it; if it would remove every tuple, none is removed.
   * spell() in dsl.ts passes it through for single-mode spells.
   */
  prune?: (ctx: EffectCtx, targets: Target[]) => boolean;
}

export interface SpellDef {
  kind: 'spell';
  modes: ModeDef[];
  /** Additional cost with alternatives (Bitter Triumph: discard a card or pay 3 life). */
  additionalChoice?: CostSpec[];
  kicker?: string;
  bargain?: boolean;
}

export type AbilityDef = TriggeredDef | ActivatedDef | ManaAbilityDef | StaticDef | SpellDef;

export interface FaceDef {
  name: string;
  types: CardType[];
  subtypes: string[];
  supertypes: Supertype[];
  /** Mana cost string such as '{1}{B}'; null for no mana cost (lands, back faces). */
  cost: string | null;
  colors: Color[];
  pt?: [number, number];
  loyalty?: number;
  keywords: Keyword[];
  abilities: AbilityDef[];
  entersWithCounters?: Partial<Record<CounterType, number>>;
}

export type Layout = 'normal' | 'mdfc' | 'transform' | 'adventure' | 'room' | 'token';

export interface CardDef {
  id: DefId;
  name: string;
  layout: Layout;
  faces: FaceDef[];
  /** Test-only defs are never loaded by decks. */
  testOnly?: boolean;
}

/** The API an effect function sees. Implemented in engine/ctx.ts. */
export interface EffectCtx {
  readonly state: GameState;
  readonly source: ObjId;
  readonly controller: PlayerId;
  readonly opponent: PlayerId;
  readonly abilityKey: AbilityKey;
  obj(id: ObjId): GameObject | undefined;
  chars(id: ObjId): Characteristics;
  isType(id: ObjId, type: CardType): boolean;
  count(nameOrToken: string, player: PlayerId): number;
  permanents(player: PlayerId, pred?: (id: ObjId) => boolean): ObjId[];
  /** Does player control a land with any of these land types ('Swamp', 'Mountain', ...)? Urborg-aware. */
  controlsLandType(player: PlayerId, types: string[]): boolean;
  choose(choice: Choice): ChoiceAnswer;
  createToken(token: string, controller: PlayerId, opts?: TokenOpts): ObjId;
  moveTo(id: ObjId, zone: Zone, opts?: MoveOpts): ObjId | null;
  draw(player: PlayerId, n?: number): void;
  discard(id: ObjId): void;
  mill(player: PlayerId, n: number): void;
  exile(id: ObjId): ObjId | null;
  sacrifice(id: ObjId): void;
  destroy(id: ObjId): void;
  /** Sagas family (Hidetsugu I): destroys every listed permanent still on the battlefield as one event (one die() call, so every would-die replacement sees them all). */
  destroyAll(ids: readonly ObjId[]): void;
  addCounter(id: ObjId, type: CounterType, n: number): void;
  addEotDelta(id: ObjId, p: number, t: number): void;
  grantEot(id: ObjId, keywords: Keyword[]): void;
  addMana(player: PlayerId, color: ManaColor, opts?: { restriction?: 'creatureSpell'; expires?: 'endOfCombat' }): void;
  gainLife(player: PlayerId, n: number): void;
  loseLife(player: PlayerId, n: number): void;
  /** Screaming Nemesis: the player can't gain life for the rest of the game (public player flag; burn-pump). */
  setCantGainLife(player: PlayerId): void;
  /** Full damage pipeline (damage.ts); returns the damage actually dealt. */
  dealDamage(target: Target, n: number, opts?: { combat?: boolean }): number;
  /** The resolving stack item (kicked, bargained, mode, targets); null outside a resolution. */
  readonly item: StackItem | null;
  /** CR 608.2b (illegal targets): false for a target that became illegal before resolution. */
  isLegalTarget(t: Target): boolean;
  tap(id: ObjId): void;
  untap(id: ObjId): void;
  /** Manland animation overlay until end of turn. */
  animate(id: ObjId, overlay: Overlay): void;
  /** Turns a double-faced permanent to its other face (same object). */
  transform(id: ObjId): void;
  /** Exile, then return to the battlefield transformed (a new object); returns the new id. */
  exileAndReturnTransformed(id: ObjId): ObjId | null;
  /** Delayed trigger: ability index abilityIndex on this ability's face fires at the next 'on' event. */
  addDelayed(on: TriggerEventName, abilityIndex: number, objId?: ObjId): void;
  /** Fear of Missing Out: an additional combat phase after this one. */
  addExtraCombat(): void;
  /** The player may play objId from exile until the cleanup of turn untilTurn. */
  grantPlayFromExile(objId: ObjId, player: PlayerId, untilTurn: number): void;
  /** Sagas family (Kumano chapter II): the player's next creature spell this turn enters with a +1/+1 counter (turnFlags.nextCreatureBonus, consumed at cast, PLAN.md D9). */
  setNextCreatureBonus(player: PlayerId): void;
  /** Sagas family (Vessel): CR 104.3e (an effect states a player loses the game). No effect once the game has a result. */
  loseGame(player: PlayerId, reason: string): void;
  /** Petrified Hamlet (lands family): a namedBan effect from this source; lands with that name gain ability 'grant'. */
  addNamedBan(name: string, grant?: AbilityKey): void;
  /**
   * Adds n to object.exiledWith (cards exiled with this object, read by a ptCda such as Unlicensed
   * Hearse). Only while the object exists; a new object after a zone change starts at 0.
   */
  addExiledWith(id: ObjId, n: number): void;
  /** Reveal: these cards (hand or library) become known to both players (knownTo = [true, true]). */
  reveal(ids: readonly ObjId[]): void;
  /** Scry 1: the player looks at their top card and chooses top or bottom (a pickObjects Choice, reason 'scry1'). */
  scry1(player: PlayerId): void;
  /** If this permanent would die this turn, exile it instead (an exileIfDies effect read by the die choke point). */
  exileIfDiesThisTurn(id: ObjId): void;
}

export interface TokenOpts {
  tapped?: boolean;
  copyOf?: DefId;
  /** With copyOf: the face of copyOf that is copied (CR 707.8a (copy of a back-face-up double-faced permanent)); default 0. */
  copyFace?: 0 | 1;
  attachedTo?: ObjId;
  attacking?: Defender;
}

export interface MoveOpts {
  position?: 'top' | 'bottom';
  face?: 0 | 1;
  tapped?: boolean;
  controller?: PlayerId;
  cause?: string;
  onAdventure?: boolean;
  /** Room half cast as a spell; that door enters unlocked. */
  unlockHalf?: 0 | 1;
  /** Shock land: pay life so it enters untapped. */
  payLife?: boolean;
  counters?: Partial<Record<CounterType, number>>;
}

/** Computed characteristics (statics.ts). Bitmasks: see TYPE, COLOR, KW, LAND in statics.ts. */
export interface Characteristics {
  name: string;
  types: number;
  subtypes: string[];
  allCreatureTypes: boolean;
  legendary: boolean;
  basic: boolean;
  colors: number;
  power: number;
  toughness: number;
  kw: number;
  abilities: AbilityKey[];
  manaValue: number;
  landTypes: number;
  isToken: boolean;
}
