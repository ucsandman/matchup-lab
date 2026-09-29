import { act, card, crew, face, stat, t } from '../dsl.js';
import type { ObjId } from '../../engine/types.js';
import { vehicleCrewWindow } from './reckoner-bankbuster.js';

/**
 * Unlicensed Hearse. {2} Artifact - Vehicle, P/T star/star, Crew 2.
 * {T}: exile up to two target cards from a single graveyard. Both targets share one owner
 * (TargetSpec.sameOwner). Each card actually exiled adds 1 to object.exiledWith.
 * Move generation (PLAN.md D9): targets in the opponent's graveyard are count-only (one move per
 * number of cards, TargetSpec.countOnlyOpponent); nothing in either 75 cares which of the
 * opponent's cards is exiled, only how many (the Hearse's P/T). Own-graveyard choices are full.
 * P/T: a characteristic-defining ability equal to the cards exiled with it, applied in every zone
 * (CR 604.3 (characteristic-defining abilities)) and first in layer 7 (CR 613.4a (layer 7a)).
 * A Hearse that changes zones is a new object with nothing exiled with it (CR 400.7 (new object)).
 * The {T} ability can be used the turn it enters while it is not a creature; once crewed that turn
 * it is a creature and summoning sickness stops it (CR 302.6 (summoning sickness)).
 * Tap window (PLAN.md D9): your main phases with an empty stack, and the opponent's end step.
 */
export const UnlicensedHearse = card('Unlicensed Hearse', [face({
  name: 'Unlicensed Hearse', types: ['Artifact'], subtypes: ['Vehicle'], cost: '{2}',
  abilities: [
    act({
      cost: { tap: true },
      targets: [t.cardInGraveyard({ min: 0, max: 2, sameOwner: true, countOnlyOpponent: true })],
      window: (ctx) => {
        const s = ctx.state;
        if (s.activePlayer === ctx.controller) return (s.step === 'main1' || s.step === 'main2') && s.zones.stack.length === 0;
        return s.step === 'end';
      },
      resolve: (ctx, targets) => {
        let n = 0;
        for (const tg of targets) {
          if (tg.kind !== 'obj' || !ctx.isLegalTarget(tg)) continue;
          if (ctx.exile(tg.id) !== null) n++;
        }
        ctx.addExiledWith(ctx.source, n);
      },
    }),
    stat({ category: 'ptCda', cda: (state, id: ObjId) => { const n = state.objects[id]?.exiledWith ?? 0; return [n, n]; } }),
    { ...crew(2), window: vehicleCrewWindow },
  ],
})]);
