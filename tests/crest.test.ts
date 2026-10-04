import { describe, expect, it } from 'vitest';
import {
  CREST_EMBLEMS, CREST_H, CREST_PATTERNS, CREST_SHAPES, CREST_W, ROLE, crestFor, crestInitials, crestPixels, crestRoles, defaultCrest, emblemColorFor,
  myCrestForKit, normalizeCrest, randomCrest, sameCrest, setMyCrest, type CrestDesign,
} from '../src/core/crest';
import { Rng } from '../src/core/rng';
import { clubTeam, createClub, migrateCareer } from '../src/meta/career';
import { KIT_COLORS, PRESET_CLUBS } from '../src/meta/data';
import { decorOf } from '../src/meta/style';
import { defaultSave } from '../src/core/save';
import { equipItem, grantItem } from '../src/meta/shop';
import { designKit, kitDesign } from '../src/render/kitDesigns';
import { crestLawnTone } from '../src/render/stadiumStyle';
import { crestDesignSvg, crestSvg } from '../src/ui/crest';
import type { Kit } from '../src/sim/types';

/**
 * THE CLUB LOGO DESIGNER (the owner: "have it so ur able to design ur club logo too with some templates already
 * given"): a crest is a shape, a field pattern, an emblem, three colours and an optional banner; it is saved with the
 * club (old clubs get one from their colours) and drawn the same everywhere.
 */

const KIT: Kit = { shirt: KIT_COLORS.blue, shirt2: KIT_COLORS.white, pattern: 'stripes', shorts: KIT_COLORS.white, socks: KIT_COLORS.blue, gk: KIT_COLORS.lime };
const BASE: CrestDesign = { shape: 'shield', pattern: 'halves', emblem: 'lion', c1: KIT_COLORS.blue, c2: KIT_COLORS.white, c3: 0xffc23a, banner: true };
const count = (roles: Uint8Array, r: number): number => roles.reduce((n, v) => n + (v === r ? 1 : 0), 0);

describe('crest templates', () => {
  it('at least twelve shapes (shields, a roundel, a diamond, a pennant) and the twelve emblems', () => {
    expect(CREST_SHAPES.length).toBeGreaterThanOrEqual(12);
    for (const s of ['shield', 'classic', 'kite', 'roundel', 'diamond', 'pennant'] as const) expect(CREST_SHAPES).toContain(s);
    for (const e of ['ball', 'star', 'lion', 'eagle', 'crown', 'bolt', 'tree', 'castle', 'anchor', 'flame', 'wolf', 'initials'] as const) expect(CREST_EMBLEMS).toContain(e);
    expect(CREST_PATTERNS.length).toBeGreaterThanOrEqual(6);
  });

  it('every shape, pattern and emblem draws: an outline all round, a field, the emblem inside it', () => {
    for (const shape of CREST_SHAPES) {
      for (const emblem of CREST_EMBLEMS) {
        const roles = crestRoles({ ...BASE, shape, emblem, banner: false }, 'PIX', 'Pixel Park');
        expect(roles).toHaveLength(CREST_W * CREST_H);
        expect(count(roles, ROLE.ink), `${shape} ${emblem}`).toBeGreaterThan(40);
        expect(count(roles, ROLE.c1) + count(roles, ROLE.c2), `${shape} ${emblem}`).toBeGreaterThan(80);
        if (emblem !== 'none') expect(count(roles, ROLE.emblem), `${shape} ${emblem}`).toBeGreaterThan(20);
        else expect(count(roles, ROLE.emblem)).toBe(0);
      }
      for (const pattern of CREST_PATTERNS) {
        const roles = crestRoles({ ...BASE, shape, pattern, emblem: 'none', banner: false });
        if (pattern !== 'plain') expect(count(roles, ROLE.c2), `${shape} ${pattern}`).toBeGreaterThan(10);
        else expect(count(roles, ROLE.c2)).toBe(0);
      }
    }
  });

  it('the banner carries the short name; the initials come from the name', () => {
    const off = crestRoles({ ...BASE, banner: false }, 'PIX', 'Pixel Park');
    const on = crestRoles({ ...BASE, banner: true }, 'PIX', 'Pixel Park');
    expect(count(off, ROLE.ribbon)).toBe(0);
    expect(count(on, ROLE.ribbon)).toBeGreaterThan(60);
    // P, I and X in the 3 x 5 font are 8 + 9 + 9 pixels.
    expect(count(on, ROLE.text)).toBe(26);
    // (No short name yet: no banner to write on.)
    expect(count(crestRoles({ ...BASE, banner: true }, '', 'Pixel Park'), ROLE.ribbon)).toBe(0);
    expect(crestInitials('Pixel Park FC', 'PIX')).toBe('PP');
    expect(crestInitials('Rovers', 'ROV')).toBe('R');
    expect(crestInitials('', 'ROV')).toBe('R');
    expect(crestInitials('', '')).toBe('B');
    const one = crestRoles({ ...BASE, emblem: 'initials', banner: false }, 'ROV', 'Rovers');
    const two = crestRoles({ ...BASE, emblem: 'initials', banner: false }, 'PIX', 'Pixel Park');
    expect(count(one, ROLE.emblem)).toBeGreaterThan(30);
    expect(count(two, ROLE.emblem)).toBeGreaterThan(30);
  });

  it('the colours are the design\'s own, and the emblem always stands off the field', () => {
    const p = crestPixels(BASE, 'PIX', 'Pixel Park');
    const used = new Set([...p]);
    expect(used.has(-1)).toBe(true);
    expect(used.has(BASE.c1)).toBe(true);
    expect(used.has(BASE.c2)).toBe(true);
    expect(used.has(BASE.c3)).toBe(true);
    const cols = Object.values(KIT_COLORS) as number[];
    const dist = (a: number, b: number) => Math.hypot(((a >> 16) & 255) - ((b >> 16) & 255), ((a >> 8) & 255) - ((b >> 8) & 255), (a & 255) - (b & 255));
    for (const a of cols) for (const b of cols) {
      const e = emblemColorFor(a, b);
      expect(Math.min(dist(e, a), dist(e, b)), `${a.toString(16)} ${b.toString(16)}`).toBeGreaterThan(70);
    }
  });

  it('a random crest is always a whole design in readable colours', () => {
    const rng = new Rng(5);
    const cols = Object.values(KIT_COLORS) as number[];
    for (let i = 0; i < 200; i++) {
      const d = randomCrest(() => rng.next(), cols);
      expect(CREST_SHAPES).toContain(d.shape);
      expect(CREST_PATTERNS).toContain(d.pattern);
      expect(CREST_EMBLEMS).toContain(d.emblem);
      expect(d.emblem).not.toBe('none');
      expect(d.c1).not.toBe(d.c2);
      expect(sameCrest(normalizeCrest(d, BASE), d)).toBe(true);
    }
    const kept = randomCrest(() => rng.next(), cols, { c1: KIT_COLORS.red, c2: KIT_COLORS.white });
    expect([kept.c1, kept.c2]).toEqual([KIT_COLORS.red, KIT_COLORS.white]);
  });
});

describe('crest in the save', () => {
  it('normalise: unknown picks and bad colours fall back, a whole design is kept', () => {
    expect(normalizeCrest(undefined, BASE)).toEqual(BASE);
    expect(normalizeCrest('nope', BASE)).toEqual(BASE);
    expect(normalizeCrest([], BASE)).toEqual(BASE);
    const junk = normalizeCrest({ shape: 'blob', pattern: 7, emblem: 'skull', c1: -1, c2: 'red', c3: 0x1000000, banner: 'yes' }, BASE);
    expect(junk).toEqual(BASE);
    const good: CrestDesign = { shape: 'roundel', pattern: 'rays', emblem: 'wolf', c1: 0x112233, c2: 0x445566, c3: 0x778899, banner: false };
    expect(normalizeCrest(JSON.parse(JSON.stringify(good)), BASE)).toEqual(good);
    // (Never the fallback object itself: the save's copy is its own.)
    expect(normalizeCrest(undefined, BASE)).not.toBe(BASE);
  });

  it('a new club keeps the crest designed for it; a club from before the designer gets one from its colours', () => {
    const designed: CrestDesign = { shape: 'diamond', pattern: 'chevron', emblem: 'eagle', c1: KIT_COLORS.red, c2: KIT_COLORS.gold, c3: KIT_COLORS.white, banner: true };
    const club = createClub({ name: 'Pixel Park FC', short: 'PIX', kit: KIT, formation: '4-4-2', crest: designed }, 7);
    expect(club.crest).toEqual(designed);
    expect(createClub({ name: 'Pixel Park FC', short: 'PIX', kit: KIT, formation: '4-4-2' }, 7).crest).toEqual(defaultCrest('Pixel Park FC', 'PIX', KIT));

    const st = migrateCareer(null, 7);
    st.club = club;
    // Round trip: the design survives.
    expect(migrateCareer(JSON.parse(JSON.stringify(st)), 7).club!.crest).toEqual(designed);
    // An old save: no crest at all.
    const old = JSON.parse(JSON.stringify(st)) as { club: { crest?: unknown } };
    delete old.club.crest;
    const migrated = migrateCareer(old, 7).club!;
    expect(migrated.crest).toEqual(defaultCrest('Pixel Park FC', 'PIX', KIT));
    expect(migrated.crest!.c1).toBe(KIT.shirt);
    expect(migrated.crest!.c2).toBe(KIT.shirt2);
    // A tampered one: made whole.
    const bad = JSON.parse(JSON.stringify(st)) as { club: { crest?: unknown } };
    bad.club.crest = { shape: 'nope', emblem: 'star', c1: 'x' };
    const fixed = migrateCareer(bad, 7).club!.crest!;
    expect(CREST_SHAPES).toContain(fixed.shape);
    expect(fixed.emblem).toBe('star');
    expect(fixed.c1).toBe(KIT.shirt);
  });

  it('the default is the same whatever the case of the name, and differs between clubs', () => {
    expect(defaultCrest('Pixel Park FC', 'PIX', KIT)).toEqual(defaultCrest('PIXEL PARK FC', 'PIX', KIT));
    const kinds = new Set(PRESET_CLUBS.map((c) => { const d = defaultCrest(c.name, c.short, c.kit); return `${d.shape}|${d.pattern}|${d.emblem}`; }));
    expect(kinds.size).toBeGreaterThanOrEqual(8);
    // A one-colour kit still gets a second colour to draw with.
    const mono = defaultCrest('Mono', 'MON', { shirt: KIT_COLORS.red, shirt2: KIT_COLORS.red });
    expect(mono.c2).not.toBe(mono.c1);
  });
});

describe('the crest everywhere', () => {
  const designed: CrestDesign = { shape: 'roundel', pattern: 'border', emblem: 'crown', c1: KIT_COLORS.navy, c2: KIT_COLORS.gold, c3: KIT_COLORS.white, banner: true };

  it('your club\'s design is handed out wherever its crest is drawn; other clubs keep their own', () => {
    setMyCrest(null);
    expect(crestFor('Pixel Park FC', 'PIX', KIT)).toEqual(defaultCrest('Pixel Park FC', 'PIX', KIT));
    const club = createClub({ name: 'Pixel Park FC', short: 'PIX', kit: KIT, formation: '4-4-2', crest: designed }, 7);
    // (Building the match team registers it: the hub and every match draw it from there.)
    clubTeam(club);
    expect(crestFor('Pixel Park FC', 'PIX', KIT)).toEqual(designed);
    expect(crestFor('PIXEL PARK FC', 'PIX', KIT)).toEqual(designed);
    expect(crestFor('', 'PIX', KIT)).toEqual(designed);
    expect(crestFor('Lakemoor Sporting', 'LAK', PRESET_CLUBS[0].kit)).toEqual(defaultCrest('Lakemoor Sporting', 'LAK', PRESET_CLUBS[0].kit));
    expect(myCrestForKit(KIT)?.design).toEqual(designed);
    expect(myCrestForKit({ shirt: 1, shirt2: 2 })).toBeNull();
    setMyCrest(null);
    expect(crestFor('Pixel Park FC', 'PIX', KIT)).toEqual(defaultCrest('Pixel Park FC', 'PIX', KIT));
  });

  it('the score bug and hub SVG: the old 13 x 15 box, crisp pixels, merged runs, no emoji', () => {
    const svg = crestDesignSvg(designed, 'PIX', 'Pixel Park FC', 4);
    expect(svg).toContain('class="crest-svg"');
    expect(svg).toContain(`viewBox="0 0 ${CREST_W} ${CREST_H}"`);
    expect(svg).toContain('width="52"');
    expect(svg).toContain('height="60"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    const rects = svg.match(/<rect /g)!.length;
    expect(rects).toBeGreaterThan(40);
    expect(rects).toBeLessThan(CREST_W * CREST_H / 2);
    expect(svg).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(crestSvg('Lakemoor Sporting', 'LAK', PRESET_CLUBS[0].kit, 2)).toContain('width="26"');
  });

  it('stadium style carries the crest (the centre circle, the tifo, the flag, the big screen)', () => {
    const s = defaultSave();
    grantItem(s, 'decor', 'mowcrest');
    equipItem(s, 'decor', 'mowcrest');
    const club = createClub({ name: 'Pixel Park FC', short: 'PIX', kit: KIT, formation: '4-4-2', crest: designed }, 7);
    clubTeam(club);
    expect(decorOf(s, KIT, 'PIX', 'Pixel Park FC')!.crest).toEqual(designed);
    expect(decorOf(s, KIT, 'PIX', 'Pixel Park FC')!.name).toBe('Pixel Park FC');
    // (A caller from before the designer passes no name: the crest still comes, from the short name and kit.)
    expect(decorOf(s, KIT, 'PIX')!.crest).toEqual(designed);
    setMyCrest(null);
    expect(decorOf(s, PRESET_CLUBS[1].kit, 'PEB', 'Pebbleport Town')!.crest).toEqual(defaultCrest('Pebbleport Town', 'PEB', PRESET_CLUBS[1].kit));
  });

  it('the centre circle decal is grass tones only, the emblem the palest and the outline the deepest', () => {
    const lum = (c: number) => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;
    for (const d of [designed, BASE, { ...BASE, c1: KIT_COLORS.white, c2: KIT_COLORS.black }, { ...BASE, c2: BASE.c1 }]) {
      const tone = crestLawnTone(d);
      for (const role of [ROLE.ink, ROLE.c1, ROLE.c2, ROLE.emblem, ROLE.light, ROLE.ribbon, ROLE.text, ROLE.detail]) {
        const c = tone(role);
        const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
        expect(g, `role ${role}`).toBeGreaterThan(r);
        expect(g, `role ${role}`).toBeGreaterThan(b);
      }
      expect(lum(tone(ROLE.emblem))).toBeGreaterThan(lum(tone(ROLE.c1)));
      expect(lum(tone(ROLE.emblem))).toBeGreaterThan(lum(tone(ROLE.c2)));
      expect(lum(tone(ROLE.ink))).toBeLessThan(lum(tone(ROLE.c1)));
      expect(lum(tone(ROLE.ink))).toBeLessThan(lum(tone(ROLE.c2)));
      // The darker club colour is the darker green.
      if (d.c1 !== d.c2) expect(lum(tone(ROLE.c1)) < lum(tone(ROLE.c2))).toBe(lum(d.c1) < lum(d.c2));
    }
  });

  it('the BIG CREST kit wears your crest\'s field and mark, and still reads as your shirt', () => {
    setMyCrest(null);
    const plain = kitDesign('crest', KIT)!;
    const club = createClub({ name: 'Pixel Park FC', short: 'PIX', kit: KIT, formation: '4-4-2', crest: { ...designed, c1: KIT_COLORS.red } }, 7);
    clubTeam(club);
    const mine = kitDesign('crest', club.kit)!;
    expect(mine.shirt).toBe(plain.shirt);
    expect(designKit('crest', club.kit).shirt).toBe(KIT.shirt);
    // The chest (torso front, x 4) has the crest's field colour on it now.
    const cells = new Set<number>();
    for (let v = 0; v < 5; v++) for (let z = 0; z < 8; z++) {
      const c = mine.body(4, v, z);
      cells.add(typeof c === 'number' ? c : c[0]);
    }
    expect(cells.has(KIT_COLORS.red)).toBe(true);
    setMyCrest(null);
  });
});
