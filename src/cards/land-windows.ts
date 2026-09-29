// Move-generator windows (PLAN.md D9) and small helpers shared by the lands family: when a manland
// animation, a channel ability or a land's burn activation is offered. Legality never reads windows.
import type { EffectCtx } from '../engine/types.js';

const stackBusy = (ctx: EffectCtx): boolean => ctx.state.zones.stack.length > 0;
const mine = (ctx: EffectCtx): boolean => ctx.state.activePlayer === ctx.controller;

/**
 * Manland animation (Mutavault, Den, Hive): on your turn in the precombat main phase or beginning of
 * combat (to attack); on the opponent's turn at beginning of combat or after attackers are declared
 * (to block); or in response to anything on the stack.
 */
export function manlandWindow(ctx: EffectCtx): boolean {
  if (stackBusy(ctx)) return true;
  const s = ctx.state.step;
  return mine(ctx) ? s === 'main1' || s === 'beginCombat' : s === 'beginCombat' || s === 'declareAttackers';
}

/** Sokenzan channel: your precombat main (hasty attackers), the opponent's declare-attackers step (blockers) or end step. */
export function sokenzanWindow(ctx: EffectCtx): boolean {
  const s = ctx.state.step;
  return mine(ctx) ? s === 'main1' : s === 'declareAttackers' || s === 'end';
}

/** Takenuma channel and Ramunap Ruins burn: your main phases, the opponent's end step, or in response. */
export function mainOrEndStepWindow(ctx: EffectCtx): boolean {
  if (stackBusy(ctx)) return true;
  const s = ctx.state.step;
  return mine(ctx) ? s === 'main1' || s === 'main2' : s === 'end';
}

/** Generic reduction for channel lands: {1} less for each legendary creature you control. */
export function legendaryCreatureCount(ctx: EffectCtx): number {
  return ctx.permanents(ctx.controller, (id) => ctx.isType(id, 'Creature') && ctx.chars(id).legendary).length;
}

/** Lands the player controls. In an enters-tapped predicate the entering card is not on the battlefield yet. */
export function landCount(ctx: EffectCtx): number {
  return ctx.permanents(ctx.controller, (id) => ctx.isType(id, 'Land')).length;
}
