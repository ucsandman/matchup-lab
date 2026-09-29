import { describe, expect, it } from 'vitest';
import { TestBear, TestBolt } from '../helpers.js';
import { CARDS, allDefs, defIdByName, getAbility, getDef, hasNonManaActivated } from '../../cards/index.js';
import { TOKENS } from '../../cards/tokens.js';
import { act, adventure, card, face, land, room, saga, slug, spell, t, trig } from '../../cards/dsl.js';
import { registerCard } from '../../cards/registry.js';

describe('card DSL and registry', () => {
  it('slugs use the front face', () => {
    expect(slug('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki')).toBe('fable-of-the-mirror-breaker');
    expect(slug('Takenuma, Abandoned Mire')).toBe('takenuma-abandoned-mire');
  });

  it('registers the real defs and every token; test defs stay out of CARDS', () => {
    expect(CARDS.map((c) => c.id)).toEqual(expect.arrayContaining(['mountain', 'swamp']));
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    expect(defIdByName('Swamp')).toBe('swamp');
    expect(TOKENS.length).toBe(11);
    for (const tk of TOKENS) expect(getDef(tk.id).layout).toBe('token');
    expect(CARDS.some((c) => c.testOnly)).toBe(false);
    expect(getDef(TestBear.id).testOnly).toBe(true);
    console.log(`registry: ${allDefs().length} defs (${CARDS.length} cards, ${TOKENS.length} tokens, rest test-only)`);
  });

  it('keys abilities defId:face:index', () => {
    const e = getAbility(`${TestBolt.id}:0:0`);
    expect(e.ability.kind).toBe('spell');
    expect(getAbility('token-blood:0:0').ability.kind).toBe('activated');
    expect(getAbility('basic:B').ability).toMatchObject({ kind: 'mana', produce: ['B'] });
    expect(() => getAbility('nope:0:0')).toThrow();
  });

  it('builders produce the expected records', () => {
    const tr = trig('etb', (ctx) => { ctx.createToken('Blood', ctx.controller); });
    expect(tr).toMatchObject({ kind: 'triggered', event: 'etb', scope: 'self' });
    const ch = saga([() => {}, () => {}, () => {}]);
    expect(ch.map((c) => c.chapter)).toEqual([1, 2, 3]);
    const sp = spell({ target: t.creature(), resolve: () => {} });
    expect(sp.modes[0]!.targets).toEqual([{ kind: 'creature' }]);
    const a = act({ cost: { tap: true }, timing: 'sorcery', target: t.creature(), resolve: () => {} });
    expect(a).toMatchObject({ kind: 'activated', timing: 'sorcery', zone: 'battlefield' });
    const l = land({ name: 'X', subtypes: ['Swamp'], entersTapped: () => true });
    expect(l.abilities.map((ab) => ab.kind)).toEqual(['static']);
    const r = room('L // R', face({ name: 'L', types: ['Enchantment'], cost: '{B}' }), face({ name: 'R', types: ['Enchantment'], cost: '{B}' }));
    expect(r.layout).toBe('room');
    const ad = adventure('G // S', face({ name: 'G', types: ['Creature'], cost: '{2}{R}', pt: [4, 3] }), face({ name: 'S', types: ['Instant'], cost: '{1}{R}' }));
    expect(ad.faces[0]!.colors).toEqual(['R']);
  });

  it('two-part names resolve from the full name and the back face; non-mana activated abilities are detected', () => {
    const d = card('Test Two // Test Other', [face({ name: 'Test Two', types: ['Land'] }), face({ name: 'Test Other', types: ['Land'] })], 'mdfc');
    registerCard(d);
    expect(defIdByName('Test Two // Test Other')).toBe('test-two');
    expect(defIdByName('Test Other')).toBe('test-two');
    expect(hasNonManaActivated('token-blood', 0)).toBe(true);
    expect(hasNonManaActivated('swamp', 0)).toBe(false);
    expect(() => registerCard({ ...d })).toThrow();
  });
});
