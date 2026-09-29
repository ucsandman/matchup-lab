// Lands family: every def matches decks/oracle.json (name, faces, mana cost, type line, colors, P/T).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getDef, defIdByName } from '../../cards/index.js';
import type { FaceDef } from '../../engine/types.js';

const LANDS = [
  'Blackcleave Cliffs', 'Blazemire Verge', 'Blightstep Pathway // Searstep Pathway', 'Blood Crypt', 'Castle Locthwain',
  'Den of the Bugbear', 'Hive of the Eye Tyrant', 'Mutavault', 'Petrified Hamlet', 'Ramunap Ruins', 'Rockface Village',
  'Sokenzan, Crucible of Defiance', 'Takenuma, Abandoned Mire', 'Urborg, Tomb of Yawgmoth',
];

interface OracleFace { name: string; mana_cost: string; type_line: string; power: string | null; toughness: string | null }
interface OracleCard extends OracleFace { colors: string[]; layout: string; card_faces: OracleFace[] }

const oracle = JSON.parse(readFileSync(new URL('../../../decks/oracle.json', import.meta.url), 'utf8')) as Record<string, OracleCard>;

export function typeLine(f: FaceDef): string {
  const head = [...f.supertypes, ...f.types].join(' ');
  return f.subtypes.length ? `${head} — ${f.subtypes.join(' ')}` : head;
}

describe('lands family oracle check', () => {
  it('each def matches its oracle entry', () => {
    let checked = 0;
    for (const name of LANDS) {
      const o = oracle[name];
      expect(o, name).toBeDefined();
      const id = defIdByName(name);
      expect(id, name).toBeDefined();
      const def = getDef(id!);
      const faces: OracleFace[] = o!.card_faces.length ? o!.card_faces : [o!];
      expect(def.faces.length, name).toBe(faces.length);
      expect(def.layout, name).toBe(o!.layout === 'modal_dfc' ? 'mdfc' : 'normal');
      faces.forEach((of, i) => {
        const f = def.faces[i]!;
        expect(f.name, name).toBe(of.name);
        expect(f.cost ?? '', name).toBe(of.mana_cost);
        expect(typeLine(f), name).toBe(of.type_line);
        expect(f.colors, name).toEqual(o!.colors);
        expect(f.pt ?? null, name).toEqual(of.power === null ? null : [Number(of.power), Number(of.toughness)]);
      });
      checked++;
    }
    console.log(`lands oracle check: ${checked} of ${LANDS.length} defs checked`);
    expect(checked).toBe(14);
  });
});
