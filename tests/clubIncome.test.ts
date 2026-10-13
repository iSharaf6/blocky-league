import { describe, expect, it } from 'vitest';
import { comebackOf } from '../src/core/comebackState';
import { defaultSave, exportSave, importSave } from '../src/core/save';
import { BOTTOM_DIVISION, createClub, migrateCareer, newSeason, type CareerState } from '../src/meta/career';
import {
  ATMOSPHERE_BOOST, CLUB_SHOP, COMMERCIAL_BOOST, INCOME_CAP_HOURS, TICKET_OFFICE, accrueIncome, collectIncome, fullInText, incomeCap, incomeParts,
  incomeRate, incomeRateMax, incomeSource, incomeView,
} from '../src/meta/clubIncome';
import { KIT_COLORS } from '../src/meta/data';
import { groundFromLevel } from '../src/meta/ground';
import { standardCoinReward } from '../src/meta/matchEconomy';
import type { Kit } from '../src/sim/types';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 12, 8);
const KIT: Kit = { shirt: KIT_COLORS.blue, shirt2: KIT_COLORS.white, pattern: 'stripes', shorts: KIT_COLORS.white, socks: KIT_COLORS.blue, gk: 0 };

function career(): CareerState {
  const st = migrateCareer(null, 7);
  st.club = createClub({ name: 'Pixel Park FC', short: 'PIX', kit: KIT, formation: '4-4-2' }, 7);
  newSeason(st, BOTTOM_DIVISION, 1);
  return st;
}

describe('club income: the rate comes from what the player builds', () => {
  it('a park pitch pays a little, every ground level more, the megastore and the manager on top', () => {
    const save = defaultSave();
    expect(incomeSource(null, save)).toEqual({ level: 0, store: false, commercial: 0, atmosphere: 0 });
    expect(incomeRate(incomeSource(null, save))).toBe(TICKET_OFFICE[0]);
    const st = career();
    expect(incomeRate(incomeSource(st, save))).toBe(TICKET_OFFICE[0]);
    // (The ground's own parts lift the atmosphere a little too: set aside here, it has its own line below.)
    const plain = () => incomeRate({ ...incomeSource(st, save), atmosphere: 0 });
    const rates: number[] = [];
    const real: number[] = [];
    for (let level = 0; level <= 5; level++) {
      st.ground = groundFromLevel(level);
      rates.push(plain());
      real.push(incomeRate(incomeSource(st, save)));
    }
    expect(rates).toEqual([...TICKET_OFFICE]);
    for (let i = 1; i < real.length; i++) expect(real[i]).toBeGreaterThan(real[i - 1]);
    for (let i = 0; i < real.length; i++) expect(real[i]).toBeGreaterThanOrEqual(rates[i]);
    st.ground.built.store = 1;
    expect(plain()).toBe(TICKET_OFFICE[5] + CLUB_SHOP);
    st.staff.hired.commercial = { level: 3, name: 'Sam Seller' };
    expect(incomeSource(st, save).commercial).toBe(3);
    expect(plain()).toBe(Math.round(((TICKET_OFFICE[5] + CLUB_SHOP) * (100 + COMMERCIAL_BOOST[3])) / 100));
    // Unpaid staff stop working (meta/staff.ts): the boost waits with them.
    st.staff.unpaid = true;
    expect(plain()).toBe(TICKET_OFFICE[5] + CLUB_SHOP);
    // A full atmosphere adds its share, and nothing adds up past the stated best.
    expect(incomeRate({ level: 5, store: true, commercial: 3, atmosphere: 100 })).toBe(incomeRateMax());
    expect(incomeRate({ level: 9, store: true, commercial: 9, atmosphere: 900 })).toBe(incomeRateMax());
  });

  it('says what a rate is made of', () => {
    expect(incomeParts({ level: 0, store: false, commercial: 0, atmosphere: 0 })).toEqual(['TICKET OFFICE 16']);
    expect(incomeParts({ level: 3, store: true, commercial: 2, atmosphere: 100 })).toEqual([`TICKET OFFICE ${TICKET_OFFICE[3]}`, `CLUB SHOP +${CLUB_SHOP}`, 'MANAGER +20%', `ATMOSPHERE +${ATMOSPHERE_BOOST}%`]);
  });

  it('is small next to playing: a full office is a win or so for a new club, and well under a day of play at the top', () => {
    const win = standardCoinReward(2, 0, 1).coins;
    // A new club: a few tens of coins an hour, a full office about one Normal win.
    expect(TICKET_OFFICE[0]).toBeGreaterThanOrEqual(10);
    expect(TICKET_OFFICE[0]).toBeLessThanOrEqual(30);
    expect(incomeCap(TICKET_OFFICE[0])).toBeLessThanOrEqual(win);
    // Everything built: a full office is still fewer than four Normal wins (scripts/economy-model.ts checks it
    // against each profile's real daily income: at most about a quarter).
    expect(incomeRateMax()).toBeLessThanOrEqual(60);
    expect(incomeCap(incomeRateMax())).toBeLessThanOrEqual(4 * win);
    // (15 October 2026, economy v7) The ladder itself, pinned: it was 16 / 19 / 22 / 25 / 28 / 32 (52 an hour and a
    // 416 coin office at the most), which let a keen player's office reach 26.6% of the rest of his day. A new club's
    // 16 is unchanged; the top is 43 an hour and 344.
    expect([...TICKET_OFFICE]).toEqual([16, 18, 20, 22, 24, 26]);
    expect([incomeRateMax(), incomeCap(incomeRateMax())]).toEqual([43, 344]);
  });
});

describe('club income: the office fills while away, up to its cap', () => {
  it('opens on the first look, fills by the hour and stops at eight hours', () => {
    const save = defaultSave();
    const rate = 16;
    expect(incomeView(save, T0, rate)).toMatchObject({ coins: 0, fill: 0, full: false });
    accrueIncome(save, T0, rate);
    expect(comebackOf(save).income).toEqual({ at: T0, banked: 0 });
    expect(incomeView(save, T0 + HOUR, rate)).toMatchObject({ coins: 16, cap: 128, full: false, fullInMs: 7 * HOUR });
    expect(incomeView(save, T0 + 2.5 * HOUR, rate).coins).toBe(40);
    expect(incomeView(save, T0 + INCOME_CAP_HOURS * HOUR, rate)).toMatchObject({ coins: 128, fill: 1, full: true, fullInMs: 0 });
    // A week away is still one full office: nothing more, and nothing lost.
    expect(incomeView(save, T0 + 7 * 24 * HOUR, rate)).toMatchObject({ coins: 128, full: true });
    // Looking never changes the save.
    expect(comebackOf(save).income).toEqual({ at: T0, banked: 0 });
  });

  it('is collected with one tap, keeps the fractions and starts filling again', () => {
    const save = defaultSave();
    const coins = save.coins;
    accrueIncome(save, T0, 16);
    expect(collectIncome(save, T0 + 1000, 16)).toBe(0);
    expect(collectIncome(save, T0 + 3 * HOUR + 20 * 60_000, 16)).toBe(53);
    expect(save.coins).toBe(coins + 53);
    expect(comebackOf(save).income.banked).toBeCloseTo(1 / 3, 5);
    expect(collectIncome(save, T0 + 3 * HOUR + 20 * 60_000, 16)).toBe(0);
    expect(collectIncome(save, T0 + 40 * HOUR, 16)).toBe(128);
    expect(save.coins).toBe(coins + 53 + 128);
  });

  it('a better ground fills a bigger office from the moment it is built', () => {
    const save = defaultSave();
    accrueIncome(save, T0, 16);
    accrueIncome(save, T0 + 2 * HOUR, 16);
    // (The hub banked the two hours at the old rate; the new rate counts from here.)
    expect(incomeView(save, T0 + 3 * HOUR, 32)).toMatchObject({ coins: 32 + 32, cap: 256 });
  });

  it('reads FULL IN with hours and two digit minutes', () => {
    expect(fullInText(0)).toBe('FULL');
    expect(fullInText(3 * HOUR + 2 * 60_000)).toBe('FULL IN 3H 02M');
    expect(fullInText(8 * HOUR)).toBe('FULL IN 8H 00M');
    expect(fullInText(30_000)).toBe('FULL IN 0H 01M');
    expect(fullInText(47 * 60_000)).toBe('FULL IN 0H 47M');
  });
});

describe('club income: the clock only moves forward', () => {
  it('a clock set back banks nothing and leaves the mark alone, even after a reload', () => {
    let save = defaultSave();
    accrueIncome(save, T0, 20);
    accrueIncome(save, T0 + 4 * HOUR, 20);
    expect(comebackOf(save).income).toEqual({ at: T0 + 4 * HOUR, banked: 80 });
    for (let i = 0; i < 6; i++) {
      save = importSave(exportSave(save))!;
      accrueIncome(save, T0, 20);
      accrueIncome(save, T0 - 30 * 24 * HOUR, 20);
      expect(incomeView(save, T0, 20).coins).toBe(80);
      accrueIncome(save, T0 + 4 * HOUR, 20);
    }
    expect(comebackOf(save).income).toEqual({ at: T0 + 4 * HOUR, banked: 80 });
  });

  it('winding the clock forward and back again cannot be farmed: nothing more until real time has caught up', () => {
    const save = defaultSave();
    const coins = save.coins;
    accrueIncome(save, T0, 20);
    // Forward a day: one full office (the cap), collected.
    expect(collectIncome(save, T0 + 24 * HOUR, 20)).toBe(160);
    // Back to the real time, and round again: nothing.
    for (let i = 0; i < 20; i++) {
      expect(collectIncome(save, T0 + i * 1000, 20)).toBe(0);
      expect(collectIncome(save, T0 + 23 * HOUR, 20)).toBe(0);
      expect(collectIncome(save, T0 + 24 * HOUR, 20)).toBe(0);
    }
    expect(save.coins).toBe(coins + 160);
    // Real time passes the mark: it fills again from there.
    expect(collectIncome(save, T0 + 25 * HOUR, 20)).toBe(20);
  });

  it('ignores a damaged clock or rate', () => {
    const save = defaultSave();
    accrueIncome(save, NaN, 20);
    accrueIncome(save, -5, 20);
    expect(comebackOf(save).income.at).toBe(0);
    accrueIncome(save, T0, 20);
    expect(incomeView(save, Infinity, 20).coins).toBe(0);
    expect(collectIncome(save, T0 + HOUR, -50)).toBe(0);
    expect(incomeView(save, T0 + HOUR, 0)).toMatchObject({ coins: 0, cap: 0, fill: 0, full: false });
  });
});
