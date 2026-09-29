// Bitmask constants for Characteristics (types, colors, keywords). A leaf module with no runtime
// imports, so card defs can import it without pulling engine modules (and the card registry) into
// an import cycle. statics.ts re-exports these; engine code may import from either.
import type { CardType, Color, Keyword } from './types.js';

export const TYPE: Readonly<Record<CardType, number>> = {
  Land: 1, Creature: 2, Artifact: 4, Enchantment: 8, Planeswalker: 16, Instant: 32, Sorcery: 64, Kindred: 128, Battle: 256,
};
export const COLOR: Readonly<Record<Color, number>> = { W: 1, U: 2, B: 4, R: 8, G: 16 };
export const KW: Readonly<Record<Keyword, number>> = {
  haste: 1, prowess: 2, deathtouch: 4, lifelink: 8, trample: 16, menace: 32, flying: 64, ward: 128,
  valiant: 256, daybound: 512, nightbound: 1024, firebending: 2048,
};
