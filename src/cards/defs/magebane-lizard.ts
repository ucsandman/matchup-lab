import { card, face, trig } from '../dsl.js';

/**
 * Magebane Lizard. {1}{R} 1/4 Lizard. Whenever a player casts a noncreature spell, it deals damage
 * to that player equal to the number of noncreature spells they've cast this turn. The count is
 * turnFlags.noncreatureSpellsCast, read on resolution, so it includes the triggering spell and any
 * cast in response (CR 603.2 (triggers on cast)). Unlocking a door is a special action, not a
 * cast (CR 709.5 (unlock)), so it never triggers. A spell cast as an Adventure has only its
 * Adventure characteristics on the stack, so Stomp counts as a noncreature spell
 * (CR 715.3 (Adventure)).
 */
export const MagebaneLizard = card('Magebane Lizard', [face({
  name: 'Magebane Lizard', types: ['Creature'], subtypes: ['Lizard'], cost: '{1}{R}', pt: [1, 4],
  abilities: [trig('cast', {
    scope: 'any',
    filter: (ctx, info) => info.objId !== undefined && !!ctx.obj(info.objId) && !ctx.isType(info.objId, 'Creature'),
  }, (ctx, _targets, info) => {
    const p = info.player;
    if (p === undefined) return;
    ctx.dealDamage({ kind: 'player', p }, ctx.state.turnFlags.noncreatureSpellsCast[p]);
  })],
})]);
