// Card-definition helpers. They return plain CardDef/FaceDef/AbilityDef records; the registry
// (cards/index.ts) assigns every ability the key 'defId:face:index' so state can refer to it.
import type {
  AbilityDef, ActivatedDef, CardDef, CardType, Color, CostSpec, EffectCtx, EffectFn, FaceDef, Keyword, Layout,
  ManaAbilityDef, ManaColor, ModeDef, SpellDef, StaticCategory, StaticDef, Supertype, Target, TargetSpec,
  TriggerEventName, TriggerInfo, TriggeredDef,
} from '../engine/types.js';

/** Kebab-case id from a card name; double-faced and split cards use the front face. */
export function slug(name: string): string {
  const front = name.split(' // ')[0] ?? name;
  return front.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function colorsOfCost(cost: string | null): Color[] {
  if (!cost) return [];
  const out: Color[] = [];
  for (const c of ['W', 'U', 'B', 'R', 'G'] as const) if (cost.includes(`{${c}}`)) out.push(c);
  return out;
}

export interface FaceSpec {
  name: string;
  types: CardType[];
  subtypes?: string[];
  supertypes?: Supertype[];
  cost?: string | null;
  colors?: Color[];
  pt?: [number, number];
  loyalty?: number;
  keywords?: Keyword[];
  abilities?: AbilityDef[];
  entersWithCounters?: FaceDef['entersWithCounters'];
}

/** A face with defaults filled in; colors default to the colors of the mana cost. */
export function face(spec: FaceSpec): FaceDef {
  const cost = spec.cost ?? null;
  const f: FaceDef = {
    name: spec.name,
    types: spec.types,
    subtypes: spec.subtypes ?? [],
    supertypes: spec.supertypes ?? [],
    cost,
    colors: spec.colors ?? colorsOfCost(cost),
    keywords: spec.keywords ?? [],
    abilities: spec.abilities ?? [],
  };
  if (spec.pt) f.pt = spec.pt;
  if (spec.loyalty !== undefined) f.loyalty = spec.loyalty;
  if (spec.entersWithCounters) f.entersWithCounters = spec.entersWithCounters;
  return f;
}

/** A full card. 'name' is the exact deck/oracle name (with ' // ' for two-part cards). */
export function card(name: string, faces: FaceDef[], layout: Layout = 'normal'): CardDef {
  return { id: slug(name), name, layout, faces };
}

// ---- abilities -------------------------------------------------------------------------------

type TrigSpec = Omit<TriggeredDef, 'kind' | 'event' | 'effect'>;
type TrigEffect = (ctx: EffectCtx, targets: Target[], info: TriggerInfo) => void;

/** trig(event, effect) or trig(event, spec, effect). Scope defaults to 'self'. */
export function trig(event: TriggerEventName, a: TrigSpec | TrigEffect, b?: TrigEffect): TriggeredDef {
  const spec: TrigSpec = typeof a === 'function' ? {} : a;
  const effect = typeof a === 'function' ? a : b;
  if (!effect) throw new Error(`trig(${event}): missing effect`);
  return { kind: 'triggered', event, scope: 'self', ...spec, effect };
}

export interface ActSpec {
  cost: CostSpec;
  timing?: 'instant' | 'sorcery';
  zone?: 'battlefield' | 'hand';
  targets?: TargetSpec[];
  target?: TargetSpec;
  costReduction?: (ctx: EffectCtx) => number;
  /** Move-generator window (PLAN.md D9): offer the activation only when this returns true. */
  window?: (ctx: EffectCtx) => boolean;
  resolve: EffectFn;
}
export function act(spec: ActSpec): ActivatedDef {
  const targets = spec.targets ?? (spec.target ? [spec.target] : undefined);
  const d: ActivatedDef = {
    kind: 'activated', cost: spec.cost, timing: spec.timing ?? 'instant', zone: spec.zone ?? 'battlefield', resolve: spec.resolve,
  };
  if (targets) d.targets = targets;
  if (spec.costReduction) d.costReduction = spec.costReduction;
  if (spec.window) d.window = spec.window;
  return d;
}

export interface ManaSpec {
  produce: ManaColor[] | 'any';
  cost?: CostSpec;
  restriction?: 'creatureSpell';
  expires?: 'endOfCombat';
  condition?: (ctx: EffectCtx) => boolean;
}
/** A mana ability; cost defaults to {T}. */
export function mana(spec: ManaSpec): ManaAbilityDef {
  const d: ManaAbilityDef = { kind: 'mana', produce: spec.produce, cost: spec.cost ?? { tap: true } };
  if (spec.restriction) d.restriction = spec.restriction;
  if (spec.expires) d.expires = spec.expires;
  if (spec.condition) d.condition = spec.condition;
  return d;
}

export function stat(spec: Omit<StaticDef, 'kind'> & { category: StaticCategory }): StaticDef {
  return { kind: 'static', ...spec };
}

export interface SpellSpec {
  modes?: ModeDef[];
  targets?: TargetSpec[];
  target?: TargetSpec;
  resolve?: EffectFn;
  /** Move-generator target-tuple prune for a single-mode spell (ModeDef.prune). */
  prune?: (ctx: EffectCtx, targets: Target[]) => boolean;
  additionalChoice?: CostSpec[];
  kicker?: string;
  bargain?: boolean;
}
/** Instant or sorcery text. A single-mode spell may give targets/resolve directly. */
export function spell(spec: SpellSpec): SpellDef {
  let modes = spec.modes;
  if (!modes) {
    if (!spec.resolve) throw new Error('spell: give modes or resolve');
    const m: ModeDef = { targets: spec.targets ?? (spec.target ? [spec.target] : []), resolve: spec.resolve };
    if (spec.prune) m.prune = spec.prune;
    modes = [m];
  }
  const d: SpellDef = { kind: 'spell', modes };
  if (spec.additionalChoice) d.additionalChoice = spec.additionalChoice;
  if (spec.kicker) d.kicker = spec.kicker;
  if (spec.bargain) d.bargain = true;
  return d;
}

export interface LandSpec {
  name: string;
  subtypes?: string[];
  supertypes?: Supertype[];
  mana?: ManaAbilityDef[];
  /** Enters-tapped predicate (fast lands, Castle Locthwain), evaluated before it enters. */
  entersTapped?: (ctx: EffectCtx) => boolean;
  /** Shock lands: pay this much life as it enters or it enters tapped. */
  payLifeToUntap?: number;
  abilities?: AbilityDef[];
}
/**
 * A land face. Basic land types grant their mana ability intrinsically, so a Swamp needs no
 * explicit mana ability (CR 305.6 (basic land types intrinsic ability)).
 */
export function land(spec: LandSpec): FaceDef {
  const abilities: AbilityDef[] = [...(spec.mana ?? [])];
  if (spec.entersTapped) abilities.push(stat({ category: 'entersTapped', entersTapped: spec.entersTapped }));
  if (spec.payLifeToUntap) abilities.push(stat({ category: 'entersTapped', payLifeToUntap: spec.payLifeToUntap }));
  abilities.push(...(spec.abilities ?? []));
  return face({
    name: spec.name, types: ['Land'], subtypes: spec.subtypes ?? [], supertypes: spec.supertypes ?? [], cost: null, abilities,
  });
}

/**
 * Crew N (Vehicles). The engine taps the creatures named in the move's crewWith as the cost, and on
 * resolution marks the Vehicle crewed; this effect makes it an artifact creature until end of turn.
 */
export function crew(n: number): ActivatedDef {
  return act({ cost: { crew: n }, resolve: (ctx) => { ctx.animate(ctx.source, { types: ['Creature'] }); } });
}

/** Saga chapter abilities: chapter i+1 triggers when the lore count reaches it. */
export function saga(chapters: Array<TrigEffect | { spec: TrigSpec; effect: TrigEffect }>): TriggeredDef[] {
  return chapters.map((c, i) =>
    typeof c === 'function'
      ? { kind: 'triggered', event: 'chapter', chapter: i + 1, scope: 'self', effect: c }
      : { kind: 'triggered', event: 'chapter', chapter: i + 1, scope: 'self', ...c.spec, effect: c.effect },
  );
}

/** A Room: two door faces sharing one type line; each half is cast and unlocked separately. */
export function room(name: string, left: FaceDef, right: FaceDef): CardDef {
  return card(name, [left, right], 'room');
}

/** An adventurer card: face 0 is the permanent, face 1 the Adventure (instant or sorcery). */
export function adventure(name: string, creatureFace: FaceDef, adventureFace: FaceDef): CardDef {
  return card(name, [creatureFace, adventureFace], 'adventure');
}

/**
 * Abilities an effect grants (a manland's quoted 'Whenever this creature attacks' text). Keys only
 * exist for registered defs, so they live in a hidden token-layout def '<slug>-granted' that no deck
 * loads; an animation overlay lists grantedKey(def, i). Register it in cards/index.ts next to the card.
 */
export function granted(ownerName: string, abilities: AbilityDef[]): CardDef {
  return { id: `${slug(ownerName)}-granted`, name: `${ownerName} (granted)`, layout: 'token', faces: [face({ name: ownerName, types: [], abilities })] };
}
export function grantedKey(def: CardDef, index: number): string {
  return `${def.id}:0:${index}`;
}

// ---- target specs ----------------------------------------------------------------------------

export const t = {
  creature: (o: Partial<TargetSpec> = {}): TargetSpec => ({ kind: 'creature', ...o }),
  player: (o: Partial<TargetSpec> = {}): TargetSpec => ({ kind: 'player', ...o }),
  opponent: (o: Partial<TargetSpec> = {}): TargetSpec => ({ kind: 'opponent', ...o }),
  any: (o: Partial<TargetSpec> = {}): TargetSpec => ({ kind: 'any', ...o }),
  creatureOrPlaneswalker: (o: Partial<TargetSpec> = {}): TargetSpec => ({ kind: 'creatureOrPlaneswalker', ...o }),
  planeswalker: (o: Partial<TargetSpec> = {}): TargetSpec => ({ kind: 'planeswalker', ...o }),
  artifact: (o: Partial<TargetSpec> = {}): TargetSpec => ({ kind: 'artifact', ...o }),
  permanent: (o: Partial<TargetSpec> = {}): TargetSpec => ({ kind: 'permanent', ...o }),
  cardInGraveyard: (o: Partial<TargetSpec> = {}): TargetSpec => ({ kind: 'cardInGraveyard', ...o }),
};
