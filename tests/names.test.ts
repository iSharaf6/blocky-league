import { describe, expect, it } from 'vitest';
import { NAME_MAX, cleanName, fallbackShort, isNameAllowed, nameProblem, safeName, safeShort } from '../src/core/names';
import { sanitizeName, sanitizeShort } from '../src/meta/career';

// A handful of blocked words, enough to exercise every disguise; the list itself lives in src/core/names.ts.
const BAD_ANYWHERE = ['fuck', 'shit', 'cunt', 'bitch', 'nigger', 'faggot', 'retard', 'porn'];
const BAD_WHOLE = ['ass', 'sex', 'cock', 'dick', 'cum', 'paki'];

const leet = (w: string) => w.replace(/o/g, '0').replace(/i/g, '1').replace(/e/g, '3').replace(/a/g, '4').replace(/s/g, '5').replace(/t/g, '7');
const spaced = (w: string) => [...w].join(' ');
const dotted = (w: string) => [...w].join('.');
const mixed = (w: string) => [...w].map((c, i) => (i % 2 ? c.toUpperCase() : c)).join('');

describe('name filter: blocked words', () => {
  it('rejects the worst words plain, inside other letters, in leetspeak, spaced, dotted and in mixed case', () => {
    for (const w of BAD_ANYWHERE) {
      expect(isNameAllowed(w), w).toBe(false);
      expect(isNameAllowed(`Blocky ${w} FC`), w).toBe(false);
      expect(isNameAllowed(`x${w}x`), `inside: ${w}`).toBe(false);
      expect(isNameAllowed(leet(w)), `leet: ${leet(w)}`).toBe(false);
      expect(isNameAllowed(spaced(w)), `spaced: ${spaced(w)}`).toBe(false);
      expect(isNameAllowed(dotted(w)), `dotted: ${dotted(w)}`).toBe(false);
      expect(isNameAllowed([...w].join('-')), `hyphens: ${w}`).toBe(false);
      expect(isNameAllowed(mixed(w)), `mixed: ${mixed(w)}`).toBe(false);
      expect(isNameAllowed(w.toUpperCase()), `upper: ${w}`).toBe(false);
    }
  });

  it('rejects milder words as whole words, spaced out or with symbols between the letters', () => {
    for (const w of BAD_WHOLE) {
      expect(isNameAllowed(w), w).toBe(false);
      expect(isNameAllowed(`${w} united`), w).toBe(false);
      expect(isNameAllowed(`Blocky ${w.toUpperCase()}`), w).toBe(false);
      expect(isNameAllowed(spaced(w)), `spaced: ${w}`).toBe(false);
      expect(isNameAllowed(dotted(w)), `dotted: ${w}`).toBe(false);
    }
  });

  it('catches symbol and accent disguises', () => {
    expect(isNameAllowed('a$$ FC')).toBe(false);
    expect(isNameAllowed('$hit Town')).toBe(false);
    expect(isNameAllowed('f*u*c*k')).toBe(false);
    expect(isNameAllowed('fück')).toBe(false);
    expect(isNameAllowed('s1ut')).toBe(false);
    expect(isNameAllowed('fuuuuck')).toBe(false);
    expect(isNameAllowed('Sh!t')).toBe(false);
    expect(isNameAllowed('F U C K')).toBe(false);
    expect(isNameAllowed('c.u.n.t')).toBe(false);
  });

  it('the short code is filtered too', () => {
    expect(safeShort('ass')).toBe('');
    expect(safeShort('SEX')).toBe('');
    expect(safeShort('FUK')).toBe('');
    expect(safeShort('KKK')).toBe('');
    expect(safeShort('rov')).toBe('ROV');
    expect(safeShort('ab-c1')).toBe('ABC');
  });
});

describe('name filter: allowed names', () => {
  it('lets ordinary club names through', () => {
    for (const n of [
      'Redcliff Rangers', 'Pebbleport Town', 'Blocky FC', "St. Mary's Athletic", 'Real Voxel', 'Harbourne-on-Sea', 'AC Milano 1899',
      'Sporting Lisboa', 'São Paulo', 'Bayern München', 'Košice', 'Zürich Utd', 'Team 7', 'Mass Effect', 'The Class Act',
    ]) expect(isNameAllowed(n), n).toBe(true);
  });

  it('the allowlist saves innocent words that contain a blocked one', () => {
    for (const n of [
      'Scunthorpe United', 'Sussex Sharks', 'Essex Eagles', 'Middlesex', 'Penistone Church', 'Assist Kings', 'Class of 92', 'Arsenal',
      'Cockerel FC', 'Peacock Park', 'Hancock Rovers', 'Cumbria County', 'Cumberland', 'Montenegro', 'Grass Roots', 'Bass Rock', 'Passion Utd',
      'Canal Side', 'Shell Bay', 'Hello Town', 'Titans', 'Japan Stars', 'Raccoon City', 'Analysis FC', 'Fukuoka', 'Therapists',
    ]) expect(isNameAllowed(n), n).toBe(true);
  });
});

describe('name filter: characters and length', () => {
  it('keeps letters with accents, digits, spaces, apostrophes, hyphens and dots; drops the rest', () => {
    expect(cleanName("  St. Mary's   Athletic-99 ", { max: 30 })).toBe("St. Mary's Athletic-99");
    expect(cleanName('<b>Rovers</b> of Town')).toBe('bRoversb of Town');
    expect(cleanName('Zürich & Co!!')).toBe('Zürich Co');
    expect(cleanName('Café ’Ole')).toBe("Café 'Ole");
    expect(cleanName('a\tb\n\nc')).toBe('a b c');
  });

  it('cuts to the maximum length (18 by default) and trims what is left', () => {
    expect(cleanName('A'.repeat(40))).toHaveLength(NAME_MAX);
    expect(cleanName('Blocky League Champions 2026', { max: 12 })).toBe('Blocky Leagu');
    expect(cleanName('Blocky League Champions', { max: 7 })).toBe('Blocky');
    expect(cleanName('Cup', { max: 3 })).toBe('Cup');
  });

  it('safeName is the clean name, or empty when blocked; nameProblem says why', () => {
    expect(safeName('  Blocky   FC ')).toBe('Blocky FC');
    expect(safeName('Sh1t FC')).toBe('');
    expect(nameProblem('Blocky FC')).toBe('');
    expect(nameProblem('B')).toBe('short');
    expect(nameProblem('')).toBe('short');
    expect(nameProblem('a$$ FC')).toBe('blocked');
    expect(nameProblem('F U C K')).toBe('blocked');
  });

  it('the career sanitizers use the filter', () => {
    expect(sanitizeName('  Rovers   of   Town  ')).toBe('Rovers of Town');
    expect(sanitizeName('Sh1t Town')).toBe('');
    expect(sanitizeName('A'.repeat(40))).toHaveLength(18);
    expect(sanitizeShort('ab-c1')).toBe('ABC');
    expect(sanitizeShort('ass')).toBe('');
  });

  it('a blocked short code falls back to the first letters of the name that pass', () => {
    expect(fallbackShort('Pixel Park FC')).toBe('PIX');
    expect(fallbackShort('Assington Town')).not.toBe('ASS');
    expect(isNameAllowed(fallbackShort('Assington Town'))).toBe(true);
    expect(fallbackShort('Assington Town')).toHaveLength(3);
    expect(fallbackShort('Sexton Rovers')).not.toBe('SEX');
    expect(fallbackShort('Cum Laude')).not.toBe('CUM');
    expect(fallbackShort('Ab')).toBe('ABX');
    expect(fallbackShort('')).toBe('XXX');
  });
});
