import { card, face } from '../dsl.js';

/**
 * Monastery Swiftspear. {R} 1/2 Human Monk with haste and prowess. Prowess is the engine's
 * built-in keyword trigger (CR 702.108a (prowess)): one trigger per noncreature spell its
 * controller casts, put on the stack above the spell (CR 603.2 (triggers on cast)).
 */
export const MonasterySwiftspear = card('Monastery Swiftspear', [face({
  name: 'Monastery Swiftspear', types: ['Creature'], subtypes: ['Human', 'Monk'], cost: '{R}', pt: [1, 2],
  keywords: ['haste', 'prowess'],
})]);
