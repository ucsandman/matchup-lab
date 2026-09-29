import { card, face } from '../dsl.js';

/** Gifted Aetherborn {B}{B} 2/3 Aetherborn Vampire with deathtouch and lifelink. */
export const GiftedAetherborn = card('Gifted Aetherborn', [face({
  name: 'Gifted Aetherborn', types: ['Creature'], subtypes: ['Aetherborn', 'Vampire'], cost: '{B}{B}', pt: [2, 3],
  keywords: ['deathtouch', 'lifelink'],
})]);
