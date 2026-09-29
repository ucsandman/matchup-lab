import { act, card, land, mana } from '../dsl.js';
import { legendaryCreatureCount, mainOrEndStepWindow } from '../land-windows.js';
import type { ObjId } from '../../engine/types.js';

/**
 * Takenuma, Abandoned Mire. Legendary land. {T}: Add {B}. Channel {3}{B}, discard this card: mill
 * three cards, then return a creature or planeswalker card from your graveyard to your hand; {1} less
 * for each legendary creature you control. The return is not targeted and is mandatory when a card
 * qualifies; choices collapse to one representative per card. The returned card stays known to both
 * players because it left a public zone (CR 400.7 (new object)).
 */
export const TakenumaAbandonedMire = card('Takenuma, Abandoned Mire', [land({
  name: 'Takenuma, Abandoned Mire', supertypes: ['Legendary'],
  mana: [mana({ produce: ['B'] })],
  abilities: [act({
    cost: { mana: '{3}{B}', discardSelf: true },
    zone: 'hand',
    costReduction: legendaryCreatureCount,
    window: mainOrEndStepWindow,
    resolve: (ctx) => {
      ctx.mill(ctx.controller, 3);
      const seen: string[] = [];
      const from: ObjId[] = [];
      for (const id of ctx.state.zones.graveyard[ctx.controller]) {
        if (!ctx.isType(id, 'Creature') && !ctx.isType(id, 'Planeswalker')) continue;
        const d = ctx.obj(id)?.defId ?? '';
        if (seen.includes(d)) continue;
        seen.push(d);
        from.push(id);
      }
      if (from.length === 0) return;
      const pick = from.length === 1
        ? from[0]
        : ctx.choose({ kind: 'pickObjects', player: ctx.controller, reason: 'takenumaReturn', from, min: 1, max: 1 }).ids?.[0];
      if (pick !== undefined) ctx.moveTo(pick, 'hand');
    },
  })],
})]);
