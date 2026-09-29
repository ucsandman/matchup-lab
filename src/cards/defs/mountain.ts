import { card, land } from '../dsl.js';

/** Basic Land - Mountain. The {T}: Add {R} ability is intrinsic to the Mountain type. */
export const Mountain = card('Mountain', [land({ name: 'Mountain', supertypes: ['Basic'], subtypes: ['Mountain'] })]);
