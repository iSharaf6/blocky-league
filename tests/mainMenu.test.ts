import { describe, expect, it } from 'vitest';
import { defaultSave } from '../src/core/save';
import { BOTTOM_DIVISION, DIVISION_NAMES, createClub, migrateCareer, newSeason, type CareerState, type SeasonSummary } from '../src/meta/career';
import { KIT_COLORS, PRESET_CLUBS } from '../src/meta/data';
import { SEASON_TIERS, defaultSeason, tierXp } from '../src/meta/season';
import { captainCard, careerOf, roadCard, seasonCard, starOf, transfersNews } from '../src/ui/hubInfo';
import type { Kit } from '../src/sim/types';

// This game typechecks against browser types; these checks read the source with Node 22+.
declare const process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, enc: 'utf8'): string } };
const { readFileSync } = process.getBuiltinModule('node:fs');

const KIT: Kit = { shirt: KIT_COLORS.blue, shirt2: KIT_COLORS.white, pattern: 'stripes', shorts: KIT_COLORS.white, socks: KIT_COLORS.blue, gk: 0 };

function career(withSeason = true): CareerState {
  const st = migrateCareer(null, 7);
  st.club = createClub({ name: 'Pixel Park FC', short: 'PIX', kit: KIT, formation: '4-4-2' }, 7);
  if (withSeason) newSeason(st, BOTTOM_DIVISION, 1);
  return st;
}

/** The markup of the hub (ui/menus.ts main()), from its doc comment to the next method. */
function hubSource(): string {
  const src = readFileSync('src/ui/menus.ts', 'utf8');
  const start = src.indexOf('  main(\n');
  const end = src.indexOf('  private wireLocked(', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

const order = (html: string, from: string, to: string): string[] => {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  return [...html.slice(a, b).matchAll(/'(\w+)', 't-/g)].map((m) => m[1]);
};

describe('main menu: a hub with your club first', () => {
  it('leads with ROAD TO GLORY (PLAY NOW until the first goal), then MY CLUB, TRANSFERS, SHOP, SEASON, then QUICK MATCH and EVENTS', () => {
    const src = hubSource();
    // The hero: ROAD TO GLORY, or PLAY NOW while ROAD TO GLORY waits for the first goal (locked under it).
    expect(src).toContain('class="hub-hero road');
    expect(src).toContain('class="hub-hero now" data-a="playnow"');
    expect(src).toContain('data-locked="career"');
    expect(src).toContain("locked.has('career')");
    expect(src).toContain('CREATE YOUR CLUB');
    // The second tier, in that order.
    expect(order(src, 'class="hub-t2"', '</div>`')).toEqual(['club', 'transfers', 'shoptile']);
    expect(src.indexOf("data-a=\"season\"")).toBeGreaterThan(0);
    // The third tier: QUICK MATCH and EVENTS, smaller; SETTINGS is a gear in the top bar.
    const foot = src.slice(src.indexOf('class="hub-foot"'));
    expect(foot.indexOf('data-a="quick"')).toBeLessThan(foot.indexOf('data-a="events"'));
    expect(src).toMatch(/hub-ico" data-a="settings"[^`]*gear/);
  });

  it('BLOCKY CUP has left the main menu (it lives inside ROAD TO GLORY now)', () => {
    expect(hubSource()).not.toContain('data-a="cup"');
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).not.toContain('openCup(');
  });

  it('TRANSFERS opens the market itself, SEASON the season screen, the coins the shop\'s coins', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).toContain('transfers: () => openMarket(app)');
    expect(main).toContain("season: () => openBadges(app, mainMenu, 'season')");
    expect(main).toContain("openShop(app, { tab: 'coins' })");
  });

  it('keeps the gift, the coins, REMOVE ADS, the level (to the unlock ladder), HOW TO PLAY and today\'s challenges', () => {
    const src = hubSource();
    for (const part of ['data-a="gift"', 'data-a="coins"', 'data-a="noads"', 'data-a="unlocks"', 'data-a="howto"', 'data-a="daily"', 'class="hub-dl"', 'hl-bar']) {
      expect(src, part).toContain(part);
    }
  });

  it('has a layout for the hub in the stylesheet, and its type follows the text size', () => {
    const css = readFileSync('src/style.css', 'utf8');
    const from = css.indexOf('round 15: the hub');
    expect(from).toBeGreaterThan(0);
    const hub = css.slice(from);
    expect(hub).toContain('grid-template-areas: "top top" "cap body" "cap foot"');
    expect(hub).toContain(':root.ts-large { --ts: 1.18; }');
    expect(hub).toMatch(/\.hh-title \{[^}]*var\(--ts\)/);
  });
});

describe('hub info (ui/hubInfo.ts)', () => {
  it('no club yet: the hero says CREATE YOUR CLUB, the captain is the Quick Match club and says so', () => {
    const save = defaultSave();
    expect(careerOf(save)).toBeNull();
    expect(roadCard(null)).toEqual({ kind: 'create' });
    const cap = captainCard(save, null)!;
    expect(cap.own).toBe(false);
    expect(cap.club).toBe(PRESET_CLUBS[save.clubIdx].name.toUpperCase());
    expect(cap.kit).toEqual(PRESET_CLUBS[save.clubIdx].kit);
    expect(transfersNews(null)).toBe(0);
  });

  it('with a club: the captain is its best outfield starter in ITS kit, with its division', () => {
    const st = career();
    const save = { ...defaultSave(), career: st };
    const cap = captainCard(save, careerOf(save))!;
    expect(cap.own).toBe(true);
    expect(cap.club).toBe('PIXEL PARK FC');
    expect(cap.kit).toEqual(st.club!.kit);
    expect(cap.kit.shirt).toBe(KIT.shirt);
    expect(cap.division).toBe(DIVISION_NAMES[BOTTOM_DIVISION]);
    expect(cap.def.role).not.toBe('GK');
    expect(cap.def.id).toBe(starOf(st.club!)!.id);
  });

  it('with a season: the hero shows your club against the next opponent', () => {
    const r = roadCard(career());
    expect(r.kind).toBe('next');
    if (r.kind !== 'next') return;
    expect(r.club.short).toBe('PIX');
    expect(r.rival.short.length).toBeGreaterThan(0);
    expect(r.season).toBe(1);
    expect(r.md).toBeGreaterThanOrEqual(1);
  });

  it('a club with no season yet kicks off; a finished season sends you to its results', () => {
    expect(roadCard(career(false)).kind).toBe('start');
    const st = career();
    const sum: SeasonSummary = { season: 1, division: BOTTOM_DIVISION, position: 1, outcome: 'promoted', champion: true, nextDivision: BOTTOM_DIVISION - 1, lines: [], prize: 0 };
    st.summary = sum;
    expect(roadCard(st).kind).toBe('over');
  });

  it('a damaged career blob reads as no club, never a crash', () => {
    const save = { ...defaultSave(), career: { club: 'nonsense' } as unknown as CareerState };
    expect(() => roadCard(careerOf(save))).not.toThrow();
    expect(captainCard(save)?.own ?? false).toBe(false);
  });

  it('the SEASON tile: tier of 30, the way into the next, what is waiting, and the Club Pass only where it is sold', () => {
    const now = new Date(2026, 9, 3);
    const save = defaultSave();
    save.season = defaultSeason(now);
    save.season.xp = tierXp(3) + 1;
    const sold = seasonCard(save, true, now);
    expect(sold.tiers).toBe(SEASON_TIERS);
    expect(sold.tier).toBe(3);
    expect(sold.frac).toBeGreaterThanOrEqual(0);
    expect(sold.frac).toBeLessThanOrEqual(1);
    expect(sold.pending).toBe(3);
    expect(sold.pass).toBe(false);
    expect(sold.offer).toBe(true);
    // The web and the portals sell no pass: no offer on the tile.
    expect(seasonCard(save, false, now).offer).toBe(false);
    // With the pass on, no offer either.
    save.season.pass = true;
    const on = seasonCard(save, true, now);
    expect(on.pass).toBe(true);
    expect(on.offer).toBe(false);
  });
});
