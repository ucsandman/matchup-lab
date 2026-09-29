import { card, face, spell, t } from '../dsl.js';

/**
 * Go for the Throat {1}{B} Instant. Destroy target nonartifact creature.
 * The nonartifact restriction is part of the target spec, so it is rechecked on resolution
 * (CR 608.2b (illegal targets)).
 */
export const GoForTheThroat = card('Go for the Throat', [face({
  name: 'Go for the Throat', types: ['Instant'], cost: '{1}{B}',
  abilities: [spell({
    target: t.creature({ filter: (ctx, tg) => tg.kind === 'obj' && !ctx.isType(tg.id, 'Artifact') }),
    resolve: (ctx, [tg]) => { if (tg && tg.kind === 'obj') ctx.destroy(tg.id); },
  })],
})]);
