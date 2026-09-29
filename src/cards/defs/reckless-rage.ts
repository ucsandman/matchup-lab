import { card, face, spell, t } from '../dsl.js';
import { getAbility } from '../registry.js';
import type { EffectCtx, ObjId, Target } from '../../engine/types.js';

import { KW } from '../../engine/bits.js';

/** Prowess in Characteristics.kw (engine/bits.ts, a leaf module defs may import; a test pins the value). */
export const PROWESS_BIT = KW.prowess;

/** Does this permanent have a triggered ability that fires when it is dealt damage (Nemesis)? */
function wantsDamage(ctx: EffectCtx, id: ObjId): boolean {
  return ctx.chars(id).abilities.some((k) => {
    if (k.startsWith('basic:')) return false;
    const ab = getAbility(k).ability;
    return ab.kind === 'triggered' && ab.event === 'dealtDamage';
  });
}

/** Survives the 2 damage, counting one prowess trigger from this cast (it resolves first). */
function survivesTwo(ctx: EffectCtx, id: ObjId): boolean {
  const c = ctx.chars(id);
  const prowess = (c.kw & PROWESS_BIT) !== 0 ? 1 : 0;
  return c.toughness + prowess - (ctx.obj(id)?.damage ?? 0) > 2;
}

/**
 * Move-generator prune (PLAN.md section 6, D9): an own target is offered when it survives the 2
 * damage (prowess counted) or wants the damage (a dealt-damage trigger), plus one sacrificial
 * choice (the own creature with the lowest power plus toughness). Legality is unchanged.
 */
function prune(ctx: EffectCtx, targets: Target[]): boolean {
  const own = targets[1];
  if (!own || own.kind !== 'obj') return true;
  if (survivesTwo(ctx, own.id) || wantsDamage(ctx, own.id)) return true;
  const score = (id: ObjId): number => { const c = ctx.chars(id); return c.power + c.toughness; };
  const dying = ctx.permanents(ctx.controller, (id) => ctx.isType(id, 'Creature') && !survivesTwo(ctx, id) && !wantsDamage(ctx, id));
  const cheapest = [...dying].sort((a, b) => score(a) - score(b) || a - b)[0];
  return cheapest === undefined || own.id === cheapest;
}

/**
 * Reckless Rage. {R} instant: 4 damage to target creature you don't control and 2 damage to target
 * creature you control. Both targets are required, so it can't be cast without a creature on each
 * side (CR 601.2c (choose targets)). If one target is illegal on resolution, the other still takes
 * its damage (CR 608.2b (illegal targets)); ctx.dealDamage skips the illegal one.
 */
export const RecklessRage = card('Reckless Rage', [face({
  name: 'Reckless Rage', types: ['Instant'], cost: '{R}',
  abilities: [spell({
    targets: [t.creature({ controller: 'opponent' }), t.creature({ controller: 'you' })],
    resolve: (ctx, [theirs, mine]) => {
      if (theirs) ctx.dealDamage(theirs, 4);
      if (mine) ctx.dealDamage(mine, 2);
    },
    prune,
  })],
})]);
