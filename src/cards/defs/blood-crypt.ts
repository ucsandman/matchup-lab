import { card, land } from '../dsl.js';

/**
 * Blood Crypt. Land - Swamp Mountain; the {B} and {R} abilities are intrinsic:
 * CR 305.6 (basic land types).
 * As it enters, its controller may pay 2 life; if they don't, it enters tapped:
 * CR 614.1c (enters replacement).
 * The move generator drops the paying play at 2 life or less (moves.ts).
 */
export const BloodCrypt = card('Blood Crypt', [land({ name: 'Blood Crypt', subtypes: ['Swamp', 'Mountain'], payLifeToUntap: 2 })]);
