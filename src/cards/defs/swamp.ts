import { card, land } from '../dsl.js';

/** Basic Land - Swamp. The {T}: Add {B} ability is intrinsic to the Swamp type. */
export const Swamp = card('Swamp', [land({ name: 'Swamp', supertypes: ['Basic'], subtypes: ['Swamp'] })]);
