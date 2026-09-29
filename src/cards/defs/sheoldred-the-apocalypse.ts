import { card, face, trig } from '../dsl.js';

/**
 * Sheoldred, the Apocalypse {2}{B}{B} legendary 4/5 Phyrexian Praetor with deathtouch.
 * Whenever you draw a card, you gain 2 life. Whenever an opponent draws a card, they lose 2 life.
 * CR 121.2 (one at a time): each card drawn is its own event, so drawing two cards triggers
 * twice, and each trigger is a real stack object that resolves even if Sheoldred has left
 * (CR 113.7a (independently of its source)).
 */
export const SheoldredTheApocalypse = card('Sheoldred, the Apocalypse', [face({
  name: 'Sheoldred, the Apocalypse', types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Phyrexian', 'Praetor'],
  cost: '{2}{B}{B}', pt: [4, 5], keywords: ['deathtouch'],
  abilities: [
    trig('draw', { scope: 'you' }, (ctx) => { ctx.gainLife(ctx.controller, 2); }),
    trig('draw', { scope: 'opponent' }, (ctx, _t, info) => { ctx.loseLife(info.player ?? ctx.opponent, 2); }),
  ],
})]);
