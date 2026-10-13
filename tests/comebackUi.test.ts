import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../src/app';
import { comebackOf } from '../src/core/comebackState';
import { localDay } from '../src/core/day';
import { defaultSave, type SaveData } from '../src/core/save';
import { MOTD_REWARD, tryToday } from '../src/meta/comeback';
import { calendarToday, claimCalendar } from '../src/meta/loops';
import { MOMENTS } from '../src/meta/moments';
import { grantItem, owns } from '../src/meta/shop';
import { comebackUi, itemArt, itemName, type ComebackHost, type ComebackUi } from '../src/ui/comeback';
import { shopItem } from '../src/meta/shop';

// This game typechecks against browser types; the wiring checks read the source with Node 22+.
declare const process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, enc: 'utf8'): string } };
const { readFileSync } = process.getBuiltinModule('node:fs');

/** Noon on the nth day of the test (local time, so localDay() moves with it). */
const at = (n: number, hour = 12): Date => new Date(2026, 9, 12 + n, hour);

interface Rig {
  save: SaveData;
  ui: ComebackUi;
  host: { started: boolean; moments: boolean };
  toasts: string[];
  persisted: () => number;
  menus: () => number;
  started: unknown[];
}

function rig(): Rig {
  const save = defaultSave();
  const toasts: string[] = [];
  const started: unknown[] = [];
  let persisted = 0;
  let menus = 0;
  const host = { started: true, moments: true };
  const app = {
    save,
    menus: { toast: (t: string) => toasts.push(t) },
    persist: () => void persisted++,
    startMatch: (req: unknown) => void started.push(req),
    mainMenu: () => void menus++,
  } as unknown as AppContext;
  const h: ComebackHost = { started: () => host.started, momentsOpen: () => host.moments, gate: (go) => go() };
  return { save, ui: comebackUi(app, h), host, toasts, persisted: () => persisted, menus: () => menus, started };
}

/** Everything a player can read in a piece of markup: tags and their attributes out. */
const words = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(at(0));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('WELCOME BACK opens by itself once a day, and never over the first session', () => {
  it('not on the day of the first match, then once on a later day, then not again that day', () => {
    const r = rig();
    // Day one: the first match has just ended, then the hub opens.
    r.save.record.played = 1;
    r.ui.matchDone(null);
    expect(comebackOf(r.save).first).toBe(localDay());
    expect(r.ui.hubOpening()).toBe(false);
    expect(r.ui.hubOpening()).toBe(false);
    // Day two: once.
    vi.setSystemTime(at(1));
    expect(r.ui.hubOpening()).toBe(true);
    expect(r.ui.gift(calendarToday(r.save, localDay())!.step).title).toContain('WELCOME BACK');
    expect(r.ui.hubOpening()).toBe(false);
    // The same day, later, gift still unclaimed: the hub's GIFT button is there, the sheet does not jump out again.
    vi.setSystemTime(at(1, 20));
    expect(r.ui.hubOpening()).toBe(false);
    // Day three, the gift claimed before the hub is drawn again: nothing to open.
    vi.setSystemTime(at(2));
    claimCalendar(r.save, localDay(), calendarToday(r.save, localDay())!.step);
    expect(r.ui.hubOpening()).toBe(false);
  });

  it('never while the campaign leads the hub: no sheet and no strip before the first match or goal', () => {
    const r = rig();
    r.host.started = false;
    r.host.moments = false;
    expect(r.ui.hubOpening()).toBe(false);
    expect(r.ui.hubHtml()).toBe('');
    vi.setSystemTime(at(1));
    expect(r.ui.hubOpening()).toBe(false);
    expect(r.ui.hubHtml()).toBe('');
    // The campaign done (a match played): from the next day on it opens.
    r.host.started = true;
    expect(r.ui.hubOpening()).toBe(true);
  });

  it('is wired where the brief says: inside mainMenu, after the first session cards, through the hub\'s own GIFT button', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    const start = main.indexOf('function mainMenu(): void {');
    const end = main.indexOf('\n}\n', start);
    const body = main.slice(start, end);
    expect(start).toBeGreaterThan(0);
    const unlocked = body.indexOf('menus.unlocked(');
    const opening = body.indexOf('comeback.hubOpening()');
    const drawn = body.indexOf('menus.main(save,');
    const opened = body.indexOf('comeback.hubOpened(welcomeBack)');
    expect(unlocked).toBeGreaterThan(0);
    expect(opening).toBeGreaterThan(unlocked);
    expect(drawn).toBeGreaterThan(opening);
    expect(opened).toBeGreaterThan(drawn);
    // Never from the boot or title code, and never from a match.
    expect(main.split('comeback.hubOpening()').length).toBe(2);
    const ui = readFileSync('src/ui/comeback.ts', 'utf8');
    expect(ui).toContain(".hub-screen [data-a=gift]");
    const menus = readFileSync('src/ui/menus.ts', 'utf8');
    expect(menus).toContain("const cb = campaign ? '' : this.comeback?.hubHtml() ?? '';");
  });
});

describe('the hub strip', () => {
  it('shows today\'s gift until it is claimed, then exactly what tomorrow\'s is, with the look and its name', () => {
    const r = rig();
    r.save.record.played = 1;
    r.ui.hubOpening();
    const before = r.ui.hubHtml();
    expect(before).toContain('class="hub-cb"');
    expect(before).toContain('TODAY DAY 1');
    expect(before).toContain('data-a="cb-gift"');
    claimCalendar(r.save, localDay(), 1);
    r.ui.hubOpening();
    const after = r.ui.hubHtml();
    expect(after).not.toContain('TODAY DAY 1');
    expect(after).toContain('TOMORROW DAY 2');
    // The card: +150, a Scout Ticket and the ball's own art; the list names it.
    expect(after).toMatch(/TOMORROW DAY 2<\/small><b>.*\+150.*cb-tk.*cb-it/s);
    expect(words(after)).toContain('GIFT DAY 2');
    expect(words(after)).toContain('MELON BALL');
    expect(words(after)).toContain('PLAY STREAK DAY 2');
    expect(words(after)).toContain('FREE TRY');
    expect(words(after)).toContain('CLUB INCOME UP TO +128');
  });

  it('has the streak, the free try, club income with its fill and FULL IN, and the match of the day with its reward', () => {
    const r = rig();
    r.save.record.played = 1;
    r.ui.hubOpening();
    const html = r.ui.hubHtml();
    const text = words(html);
    expect(text).toContain('PLAY STREAK DAY 1 +20');
    expect(text).toContain(`TRY TODAY, FREE NEXT MATCH ${itemName(tryToday(r.save, localDay()).item!)}`);
    expect(text).toContain('CLUB INCOME 16 AN HOUR FULL IN 8H 00M');
    expect(html).toContain('class="cb-fill"');
    expect(text).toContain(`MATCH OF THE DAY ${MOMENTS[0].title} +${MOTD_REWARD.coins} ${MOTD_REWARD.gems}`);
    // Three hours on: what a tap collects, and how long until it is full.
    vi.setSystemTime(at(0, 15));
    expect(words(r.ui.hubHtml())).toContain('CLUB INCOME 16 AN HOUR +48 FULL IN 5H 00M');
    expect(r.ui.hubHtml()).toContain('style="width:38%"');
  });

  it('says what the club earned while away, and the welcome sheet\'s one CLAIM takes it too', () => {
    const r = rig();
    r.save.record.played = 1;
    r.ui.matchDone(null);
    r.ui.hubOpening();
    claimCalendar(r.save, localDay(), 1);
    r.ui.hubOpening();
    const coins = r.save.coins;
    vi.setSystemTime(at(1));
    expect(r.ui.hubOpening()).toBe(true);
    const strip = r.ui.hubHtml();
    expect(words(strip)).toContain('YOUR CLUB EARNED +128 COLLECT');
    expect(strip).toContain('Your club earned 128 coins while you were away. Collect');
    expect(strip).toMatch(/class="cb-card cb-inc ready"/);
    // The sheet lists it; CLAIM (the calendar's own) is followed by the hub, which collects it and says so.
    const sheet = r.ui.gift(2);
    expect(words(sheet.rows)).toContain('YOUR CLUB EARNED +128 WHILE AWAY');
    claimCalendar(r.save, localDay(), 2);
    r.ui.hubOpening();
    expect(r.save.coins).toBe(coins + 150 + 128);
    r.ui.hubOpened(false);
    vi.runAllTimers();
    expect(r.toasts).toContain('YOUR CLUB EARNED 128 COINS WHILE YOU WERE AWAY');
    expect(r.toasts).toContain('DAY 2: +1 SCOUT TICKET. MELON BALL IS YOURS AND ON');
    expect(owns(r.save, 'ball', 'melon')).toBe(true);
  });

  it('greys the match of the day with TOMORROW once it is done, and hides it while MOMENTS is locked', () => {
    const r = rig();
    r.save.record.played = 1;
    r.ui.hubOpening();
    r.ui.momentDone(MOMENTS[0].id, true);
    expect(words(r.ui.momentHtml())).toBe(`MATCH OF THE DAY +${MOTD_REWARD.coins} ${MOTD_REWARD.gems}`);
    const html = r.ui.hubHtml();
    expect(html).toMatch(/class="cb-card cb-motd done"/);
    expect(words(html)).toContain(`MATCH OF THE DAY DONE ${MOMENTS[0].title} TOMORROW`);
    // A second finish the same day shows it is done, and pays nothing more.
    const coins = r.save.coins;
    r.ui.momentDone(MOMENTS[0].id, true);
    expect(words(r.ui.momentHtml())).toBe('MATCH OF THE DAY DONE. A NEW ONE TOMORROW');
    expect(r.save.coins).toBe(coins);
    r.host.moments = false;
    expect(r.ui.hubHtml()).not.toContain('cb-motd');
  });

  it('a failed try at the match of the day says what completing it today pays; another moment says nothing', () => {
    const r = rig();
    r.ui.hubOpening();
    r.ui.momentDone(MOMENTS[0].id, false);
    expect(words(r.ui.momentHtml())).toBe(`MATCH OF THE DAY: COMPLETE IT TODAY FOR +${MOTD_REWARD.coins} ${MOTD_REWARD.gems}`);
    r.ui.momentDone('giant-killing', true);
    expect(r.ui.momentHtml()).toBe('');
    // And nothing stale: the line belongs to the result it was made for.
    expect(r.ui.momentHtml()).toBe('');
  });
});

describe('the gift sheet', () => {
  it('is DAILY GIFT on the first day and WELCOME BACK with the day after it, with the look, the streak and the free try', () => {
    const r = rig();
    r.ui.hubOpening();
    const first = r.ui.gift(1);
    expect(first.title).toBe('DAILY GIFT<small>DAY 1</small>');
    // Day 2's cell shows a ticket and the ball; day 3's the calendar's 5 gems and the welcome week's 15.
    expect(first.day(1)).toMatch(/cb-tk.*\+1.*cb-it/s);
    expect(words(first.day(2)!)).toBe('20');
    expect(first.day(0)).toBeNull();
    expect(words(first.rows)).toContain('PLAY STREAK DAY 1 +20 FIRST MATCH');
    expect(words(first.rows)).toContain('TRY TODAY, FREE');
    expect(first.note).toBe('MISS A DAY, KEEP YOUR PLACE');
    claimCalendar(r.save, localDay(), 1);
    vi.setSystemTime(at(1));
    r.ui.hubOpening();
    const second = r.ui.gift(2);
    expect(second.title).toBe('WELCOME BACK<small>DAY 2</small>');
    expect(words(second.reward)).toBe('+1 SCOUT TICKET MELON BALL');
    expect(second.reward).toContain('class="cb-art"');
    // Days already taken this lap keep the calendar's own line.
    expect(second.day(0)).toBeNull();
  });

  it('says so when the look is owned already: its coin value instead', () => {
    const r = rig();
    r.ui.hubOpening();
    claimCalendar(r.save, localDay(), 1);
    grantItem(r.save, 'ball', 'melon');
    vi.setSystemTime(at(1));
    r.ui.hubOpening();
    expect(words(r.ui.gift(2).reward)).toBe('+1 SCOUT TICKET MELON BALL YOU OWN IT: +450 COINS');
    const coins = r.save.coins;
    claimCalendar(r.save, localDay(), 2);
    r.ui.hubOpening();
    // (The calendar's 150, the ball's coin value, and the full office the sheet listed: one CLAIM took it all.)
    expect(r.save.coins).toBe(coins + 150 + 450 + 128);
    r.ui.hubOpened(false);
    vi.runAllTimers();
    expect(r.toasts).toContain('DAY 2: +1 SCOUT TICKET. YOU OWN MELON BALL, SO +450 COINS');
  });

  it('never tells a returning player off: a halved streak says what was kept', () => {
    const r = rig();
    for (let d = 0; d < 10; d++) {
      vi.setSystemTime(at(d));
      r.ui.matchDone(null);
    }
    vi.setSystemTime(at(30));
    r.ui.hubOpening();
    const rows = words(r.ui.gift(calendarToday(r.save, localDay())!.step).rows);
    expect(rows).toContain('PLAY STREAK DAY 5 YOU KEPT 5 OF 10 DAYS');
    expect(rows).not.toMatch(/LOST|BROKE|MISSED|RESET/);
  });
});

describe('full time', () => {
  it('shows the streak day it paid and a TOMORROW strip with the gift, the streak and the free try', () => {
    const r = rig();
    r.save.record.played = 1;
    const coins = r.save.coins;
    r.ui.matchDone(null);
    expect(r.save.coins).toBe(coins + 20);
    const lines = r.ui.ftLines();
    expect(words(lines)).toBe('PLAY STREAK DAY 1 +20');
    // Once: the lines belong to the match that made them.
    expect(r.ui.ftLines()).toBe('');
    const tm = r.ui.ftTomorrow();
    expect(tm).toContain('class="cb-ft-tm"');
    expect(words(tm)).toMatch(/^TOMORROW GIFT DAY 2 \+150 \+1 STREAK DAY 2 \+30 FREE TRY /);
    expect(tm).toContain('Tomorrow. Gift day 2: 150 coins and a scout ticket and melon ball. Play streak day 2: 30 coins');
    // A second match the same day: no streak line, the same promise.
    r.ui.matchDone(null);
    expect(r.ui.ftLines()).toBe('');
  });

  it('after a free try: YOU TRIED it, and KEEP IT at the shop price', () => {
    const r = rig();
    r.save.record.played = 3;
    r.ui.hubOpening();
    const it = r.ui.tryFor()!;
    expect(it).toBe(tryToday(r.save, localDay()).item);
    r.ui.matchDone(it);
    const lines = words(r.ui.ftLines());
    expect(lines).toContain(`YOU TRIED ${itemName(it)} KEEP IT ${it.price.toLocaleString('en-US')}`);
    // Used for today: the next match wears the player's own again, and the hub offers to keep it.
    expect(r.ui.tryFor()).toBeNull();
    expect(words(r.ui.hubHtml())).toContain(`YOU TRIED IT, KEEP ${it.price.toLocaleString('en-US')} ${itemName(it)}`);
    expect(owns(r.save, it.cat, it.id)).toBe(false);
  });

  it('is wired into the right pane: the strip fixed under the XP bar, the lines first in the list', () => {
    const menus = readFileSync('src/ui/menus.ts', 'utf8');
    const prog = menus.indexOf('${progHtml}\n              ${this.comeback?.ftTomorrow() ?? \'\'}');
    expect(prog).toBeGreaterThan(0);
    expect(menus).toMatch(/const extras = \[\s*\/\/[^\n]*\n\s*this\.comeback\?\.ftLines\(\) \?\? '',/);
    expect(menus).toContain("${this.comeback?.momentHtml() ?? ''}");
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).toContain('comeback.matchDone(tried);');
    expect(main).toContain('comeback.momentDone(req.scenario.id, o.won);');
    // TRY TODAY never goes on in a drill, a moment, the very first match or a match brought back after a reload.
    expect(main).toContain('const tried = !recovered && !basics && !req.scenario && !req.firstMatch && played() > 0 ? comeback.tryFor() : null;');
  });
});

describe('copy and art', () => {
  it('names looks as prizes read, and draws each kind from its own colours', () => {
    expect(itemName(shopItem('ball', 'melon')!)).toBe('MELON BALL');
    expect(itemName(shopItem('kit', 'tiger')!)).toBe('TIGER KIT');
    expect(itemName(shopItem('look', 'afro')!)).toBe('BIG AFRO');
    expect(itemName(shopItem('trail', 'notes')!)).toBe('MUSIC NOTES TRAIL');
    expect(itemName(shopItem('trail', 'ice')!)).toBe('ICE TRAIL');
    expect(itemName(shopItem('goalfx', 'rainbow')!)).toBe('RAINBOW GOAL');
    for (const [cat, id] of [['ball', 'melon'], ['kit', 'tiger'], ['trail', 'notes'], ['goalfx', 'rainbow'], ['look', 'afro'], ['celebration', 'robot']] as const) {
      const art = itemArt(shopItem(cat, id)!);
      expect(art, `${cat}:${id}`).toMatch(/^<svg class="(cb-art|picon cb-art)"/);
      expect(art).toContain('<rect');
    }
    expect(itemArt(shopItem('ball', 'melon')!)).not.toBe(itemArt(shopItem('ball', 'ice')!));
    expect(itemArt(shopItem('kit', 'tiger')!)).not.toBe(itemArt(shopItem('kit', 'camo')!));
  });

  it('everything a player reads on the strip, the sheet and full time is upper case, with no dot or dash between facts', () => {
    const r = rig();
    r.save.record.played = 2;
    r.ui.hubOpening();
    const it = r.ui.tryFor();
    r.ui.matchDone(it);
    const all = [r.ui.hubHtml(), r.ui.ftLines(), r.ui.ftTomorrow(), r.ui.gift(1).rows, r.ui.gift(1).reward, r.ui.gift(1).title, r.ui.gift(1).note].map(words).join(' ');
    expect(all.length).toBeGreaterThan(200);
    expect(all).toBe(all.toUpperCase());
    expect(all).not.toMatch(/[·•●—–]| - /);
  });
});
