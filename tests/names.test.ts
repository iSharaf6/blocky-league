import { describe, expect, it } from 'vitest';
import {
  NAME_MAX, cleanName, fallbackShort, isNameAllowed, isNameReserved, isPairAllowed, nameIssue, nameProblem, nameWhy, safeName, safeShort, suggestName,
} from '../src/core/names';
import { PRESET_CLUBS, randomClubSeed } from '../src/meta/data';
import { Rng } from '../src/core/rng';
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

// Round-9 critic leaks (measured with generated variants of the list, counts only): look-alike letters from
// other scripts, every letter doubled, a stray letter inside a longer word, and a word split across the club
// name and its short code.
const CYR: Record<string, string> = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', y: 'у', x: 'х', k: 'к', m: 'м', t: 'т', i: 'і', s: 'ѕ' };
const homoglyph = (w: string) => [...w].map((c) => CYR[c] ?? c).join('');
const greek = (w: string) => [...w].map((c) => ({ a: 'α', e: 'ε', o: 'ο', i: 'ι', k: 'κ', t: 'τ', u: 'υ', n: 'η', v: 'ν' } as Record<string, string>)[c] ?? c).join('');
const doubled = (w: string) => [...w].map((c) => c + c).join('');
const stray = (w: string) => w.slice(0, 2) + 'x' + w.slice(2);

describe('look-alike letters, doubled letters, stray letters, split codes', () => {
  it('a blocked word spelt with Cyrillic or Greek look-alikes is still blocked', () => {
    for (const w of BAD_ANYWHERE) {
      expect(isNameAllowed(homoglyph(w))).toBe(false);
      expect(isNameAllowed(greek(w))).toBe(false);
      expect(isNameAllowed(`${homoglyph(w).toUpperCase()} Town`)).toBe(false);
    }
  });
  it('every letter doubled is still blocked', () => {
    for (const w of [...BAD_ANYWHERE, ...BAD_WHOLE]) expect(isNameAllowed(doubled(w))).toBe(false);
  });
  it('one stray letter inside a longer blocked word is still blocked', () => {
    for (const w of BAD_ANYWHERE) if (w.length >= 5) expect(isNameAllowed(stray(w))).toBe(false);
  });
  it('a word split across the club name and the short code is blocked as a pair, either way round', () => {
    for (const w of BAD_ANYWHERE) {
      if (w.length < 5) continue;
      const name = w.slice(0, -3);
      const short = w.slice(-3).toUpperCase();
      expect(isPairAllowed(name, short)).toBe(false);
      expect(isPairAllowed(w.slice(3), w.slice(0, 3).toUpperCase())).toBe(false);
    }
    expect(isPairAllowed('Rovers', 'ROV')).toBe(true);
    expect(isPairAllowed('Scunthorpe United', 'SCU')).toBe(true);
    expect(isPairAllowed('Count Athletic', 'CNT')).toBe(true);
  });
  it('ordinary names in other scripts and everyday doubled letters still pass', () => {
    for (const n of ['Спартак', 'Ολυμπιακός', 'Assist FC', 'Class Rovers', 'Sussex Town', 'Cummins XI', 'Hoopers', 'Boston Wanderers', 'Cockerel Bay']) {
      expect(isNameAllowed(n)).toBe(true);
    }
  });
});

// ------------------------------------------------------------------ October 2026: the wider filter
// (The words under test are kept in rot13 here, so nothing rude is printed by a failing run or a test name.)
const rot13 = (w: string) => w.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const WORST = ['shpx', 'fuvg', 'phag', 'ovgpu', 'avttre', 'snttbg', 'ergneq', 'cbea'].map(rot13);
const WIDER_ANYWHERE = ['znfgheong', 'ubybpnhfg', 'pbpnvar', 'fhvpvqr', 'chgnva', 'xhejn', 'pnmmb', 'fpurvff', 'zvreqn', 'erqfxva'].map(rot13);
const WIDER_WHOLE = ['urebva', 'chgn', 'zrgu', 'fynt', 'ohgg', 'ervpu'].map(rot13);

describe('name filter: more disguises', () => {
  it('sound-alike spellings of the worst words are blocked (v for u, y for i, z for s)', () => {
    for (const w of WORST) {
      for (const [from, to] of [['u', 'v'], ['i', 'y'], ['s', 'z']] as const) {
        const v = w.split(from).join(to);
        if (v !== w) expect(isNameAllowed(v), `${rot13(w)} ${from}>${to}`).toBe(false);
      }
    }
  });

  it('invisible characters, full-width, circled and maths letters, underscores and a 6 for a g do not get a word through', () => {
    const circled = (w: string) => [...w].map((c) => String.fromCodePoint(0x24d0 + c.charCodeAt(0) - 97)).join('');
    const fullwidth = (w: string) => [...w].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join('');
    const mathBold = (w: string) => [...w].map((c) => String.fromCodePoint(0x1d41a + c.charCodeAt(0) - 97)).join('');
    for (const w of WORST) {
      expect(isNameAllowed([...w].join('\u200b')), rot13(w)).toBe(false);
      expect(isNameAllowed([...w].join('_')), rot13(w)).toBe(false);
      expect(isNameAllowed(circled(w)), rot13(w)).toBe(false);
      expect(isNameAllowed(fullwidth(w)), rot13(w)).toBe(false);
      expect(isNameAllowed(mathBold(w)), rot13(w)).toBe(false);
      expect(isNameAllowed(w.replace(/g/g, '6')), rot13(w)).toBe(false);
      expect(isNameAllowed(`Real${w[0].toUpperCase()}${w.slice(1)}FC`), rot13(w)).toBe(false);
    }
  });

  it('the wider lists: sex, hate, drugs, self-harm and other languages', () => {
    for (const w of WIDER_ANYWHERE) {
      expect(isNameAllowed(w), rot13(w)).toBe(false);
      expect(isNameAllowed(`${w} United`), rot13(w)).toBe(false);
      expect(isNameAllowed(`x${w}x`), rot13(w)).toBe(false);
    }
    for (const w of WIDER_WHOLE) {
      expect(isNameAllowed(w), rot13(w)).toBe(false);
      expect(isNameAllowed(`${w.toUpperCase()} FC`), rot13(w)).toBe(false);
    }
  });

  it('a sex, drug or hate number standing on its own is blocked; years and other numbers are fine', () => {
    for (const n of ['Team 69', '69ers', 'FC 420', '1488 FC', 'A69']) expect(isNameAllowed(n), n).toBe(false);
    for (const n of ['Est 1969', 'Class of 1988', 'Unit 4200', 'Route 66', 'Area 51', 'Apollo 11', 'FC 2026', 'Level 42']) expect(isNameAllowed(n), n).toBe(true);
  });
});

describe('name filter: ordinary names still pass', () => {
  it('the game\'s own clubs, every generated club and every suggestion pass both layers', () => {
    for (const c of PRESET_CLUBS) {
      expect(nameIssue(c.name), c.name).toBe('');
      expect(isNameAllowed(c.short), c.short).toBe(true);
    }
    const rng = new Rng(11);
    for (let i = 0; i < 400; i++) {
      const c = randomClubSeed(rng, 50);
      expect(isNameAllowed(c.name), c.name).toBe(true);
      expect(isNameAllowed(c.short), c.short).toBe(true);
    }
    for (let i = 0; i < 300; i++) {
      const s = suggestName('', i);
      expect(nameIssue(s), s).toBe('');
      expect(s.length).toBeLessThanOrEqual(NAME_MAX);
    }
  }, 30_000);

  it('places and words the wider lists would trip over are let through', () => {
    for (const n of [
      'Winchester City', 'Middlesbrough', 'Penny Stars', 'Roxy Kent FC', 'Foxy Kestrels', 'Twin Crest FC', 'Nightwatch FC', 'Sweetwater United',
      'Saltwater Rovers', 'Peninsula FC', 'Whistler Wolves', 'Perfection FC', 'Town Symphony', 'Aryan United', 'Heroes FC', 'Heroine City',
      'Motherwell', 'Cumnock Juniors', 'Hellas Verona', 'Dynamo Kyiv', 'Fortuna Sittard', 'Grasshopper Zurich', 'Young Boys', 'Rapid Wien',
      'Partick Thistle', 'Plymouth Argyle', 'Sheffield Wednesday', 'Crystal Palace', 'Nazionale', 'Unique FC', 'Computer Club', 'Butterfly FC',
      'Golden Eagles', 'Thunder Cats', 'Killer Bees', 'Pass Masters', 'Top Bins', 'Tiki Taka',
    ]) expect(isNameAllowed(n), n).toBe(true);
  });
});

describe('reserved names (typed names only)', () => {
  it('a real club\'s name is taken as the whole name, whatever the club words, case, accents or year', () => {
    for (const n of ['Arsenal', 'Arsenal FC', 'The Arsenal Club', 'Arsenal 1886', 'Real Madrid', 'Real Madrid CF', 'REAL  MADRID', 'Réal Madríd', 'Man Utd', 'ManUtd', 'Liverpool', 'Juventus']) {
      expect(isNameReserved(n), n).toBe(true);
      expect(nameProblem(n), n).toBe('blocked');
      expect(nameIssue(n), n).toBe('reserved');
    }
    for (const n of ['Arsenal Road', 'Liverpool Blocks', 'Real Voxel', 'Redcliff Rangers', 'Romans', 'Santosh FC', 'Inter Yer Nan', 'Sporting Lisboa', 'Bayern Bru']) {
      expect(isNameReserved(n), n).toBe(false);
      expect(nameProblem(n), n).toBe('');
    }
  });

  it('competitions, brands, other games and names that pose as staff are taken anywhere in the name', () => {
    for (const n of ['FIFA Stars', 'Nike Town', 'Lego City', 'Pepsi Max', 'Champions League', 'Blocky League', 'Admin', 'Admin FC', 'Official Rovers', 'Calynx United']) {
      expect(isNameReserved(n), n).toBe(true);
    }
    for (const n of ['Badminton', 'Staffordshire', 'Supporters Club', 'Blocky Town', 'Blocky FC']) expect(isNameReserved(n), n).toBe(false);
  });

  it('the hard filter and the save never rename a club for a reserved name', () => {
    // (Reserved names are refused when typed; a save from before the rule, and the game's own clubs, keep theirs.)
    expect(isNameAllowed('Arsenal')).toBe(true);
    expect(safeName('Arsenal')).toBe('Arsenal');
    expect(sanitizeName('Real Madrid')).toBe('Real Madrid');
  });

  it('every refusal comes with a friendly line and a name to use instead', () => {
    expect(nameWhy('rude')).toMatch(/friendly/i);
    expect(nameWhy('rude', 'code')).toMatch(/code/i);
    expect(nameWhy('reserved')).toMatch(/real club|brand/i);
    // One line under a phone's name field.
    for (const line of [nameWhy('rude'), nameWhy('rude', 'code'), nameWhy('reserved')]) expect(line.length).toBeLessThanOrEqual(30);
    expect(nameWhy('')).toBe('');
    expect(nameWhy('short')).toBe('');
    // A reserved name keeps what the player was going for.
    expect(suggestName('Arsenal')).toBe('Arsenal Blocks');
    expect(suggestName('Liverpool FC')).toBe('Liverpool Blocks');
    // A rude one gets a made-up club: never the rude word back, always a name that passes.
    for (const w of WORST) {
      const s = suggestName(`${w} town`, 3);
      expect(s.toLowerCase()).not.toContain(w);
      expect(nameIssue(s)).toBe('');
    }
    // No dots, dashes or emoji in the lines (the owner's taste).
    for (const line of [nameWhy('rude'), nameWhy('rude', 'code'), nameWhy('reserved')]) expect(line).not.toMatch(/[·●—–]/);
  });
});
