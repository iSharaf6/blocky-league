import { describe, expect, it } from 'vitest';
import { VETERAN_DAY, comebackOf, defaultComeback, normalizeComeback } from '../src/core/comebackState';
import { defaultSave, exportSave, importSave, xpAt, type SaveData } from '../src/core/save';
import {
  FREE_DAY_EVERY, MOTD_REWARD, STREAK_ITEMS, STREAK_ITEM_DAYS, TRY_CATS, WELCOME_WEEK, claimMotd, dayAfter, epochDay, giftView, keepPrice, markWelcomed,
  motdOf, motdPick, nextStreakItem, noteFirstDay, startStreakDay, streakCoins, streakGems, streakPrize, streakToday, streakWords, syncWelcomeWeek,
  tomorrowOf, tryPool, tryToday, useTry, weeklyComebackGems, welcomeDue, welcomePrize, welcomeWeekWorth,
} from '../src/meta/comeback';
import { gems } from '../src/meta/gems';
import { CALENDAR, calendarToday, claimCalendar, weeklyLoopGems } from '../src/meta/loops';
import { MOMENTS } from '../src/meta/moments';
import { buyItem, equippedId, equippedIn, grantItem, itemTier, owns, scoutTokens, shopItem, shopItems } from '../src/meta/shop';

const D1 = '2026-10-12';
const day = (n: number): string => dayAfter(D1, n);

/** Claim the calendar on `d` (as the gift sheet does), then let the hub hand over the welcome week reward. */
function claim(save: SaveData, d: string) {
  const today = calendarToday(save, d)!;
  expect(claimCalendar(save, d, today.step)).not.toBeNull();
  return syncWelcomeWeek(save);
}

describe('days', () => {
  it('counts calendar days, across months and clock changes', () => {
    expect(epochDay('2026-10-13') - epochDay('2026-10-12')).toBe(1);
    expect(epochDay('2026-11-01') - epochDay('2026-10-31')).toBe(1);
    expect(dayAfter('2026-10-31')).toBe('2026-11-01');
    expect(dayAfter('2026-12-31', 1)).toBe('2027-01-01');
    expect(dayAfter('2026-03-29', 1)).toBe('2026-03-30');
  });
});

describe('WELCOME WEEK', () => {
  it('uses only looks the shop already sells, and the week is worth a few days of play, not a fortune', () => {
    for (const e of WELCOME_WEEK) {
      if (!e?.item) continue;
      const it = shopItem(e.item.cat, e.item.id);
      expect(it, `${e.item.cat}:${e.item.id}`).toBeDefined();
      // Sold for coins (never a Club Pass look): a free player can also simply buy it.
      expect(it!.pass).toBeUndefined();
      expect(it!.price).toBeGreaterThan(0);
    }
    // Day 2 is the hook: a named ball and a Scout Ticket. Day 7 is a RARE look.
    expect(WELCOME_WEEK[1]).toEqual({ item: { cat: 'ball', id: 'melon' }, tokens: 1 });
    expect(itemTier(shopItem('look', WELCOME_WEEK[6]!.item!.id)!)).toBe('rare');
    const worth = welcomeWeekWorth();
    expect(worth.coins).toBeLessThanOrEqual(2500);
    expect(worth.gems).toBeLessThanOrEqual(25);
    expect(worth.tokens).toBe(2);
  });

  it('pays each day once on the first lap: the ball and a ticket on day 2, gems on day 3, a kit on day 5, a look on day 7', () => {
    const save = defaultSave();
    const tickets = scoutTokens(save);
    expect(claim(save, day(0))).toBeNull();
    expect(giftView(save, day(1))).toMatchObject({ step: 2, coins: 150, tokens: 1, item: { owned: false, coins: 0 } });
    const d2 = claim(save, day(1))!;
    expect(d2).toMatchObject({ step: 2, tokens: 1, gems: 0, worn: true });
    expect(d2.item!.item.name).toBe('Melon');
    expect(owns(save, 'ball', 'melon')).toBe(true);
    expect(equippedId(save, 'ball')).toBe('melon');
    expect(scoutTokens(save)).toBe(tickets + 1);
    const before = gems(save);
    expect(claim(save, day(2))).toMatchObject({ step: 3, gems: 15 });
    // (The calendar's own 5 gems on day 3, and the welcome week's 15.)
    expect(gems(save)).toBe(before + CALENDAR[2].gems + 15);
    expect(claim(save, day(3))).toMatchObject({ step: 4, tokens: 1 });
    const d5 = claim(save, day(4))!;
    expect(d5.item!.item.cat).toBe('kit');
    // A kit is handed over but never put on by itself: the club's own strip is the player's to change.
    expect(d5.worn).toBe(false);
    expect(owns(save, 'kit', 'tiger')).toBe(true);
    expect(equippedId(save, 'kit')).toBe('club');
    expect(claim(save, day(5))).toMatchObject({ step: 6, gems: 5 });
    const d7 = claim(save, day(6))!;
    expect(d7.item!.item.id).toBe('afro');
    expect(equippedIn(save, 'look', 'hair')).toBe('afro');
    expect(comebackOf(save).welcome).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('later laps keep the calendar as it was', () => {
    const save = defaultSave();
    for (let i = 0; i < 7; i++) claim(save, day(i));
    const coins = save.coins;
    const g = gems(save);
    for (let i = 7; i < 14; i++) {
      expect(giftView(save, day(i))!.item).toBeUndefined();
      expect(claim(save, day(i))).toBeNull();
    }
    expect(save.coins - coins).toBe(CALENDAR.reduce((n, d) => n + d.coins, 0));
    expect(gems(save) - g).toBe(CALENDAR.reduce((n, d) => n + d.gems, 0));
  });

  it('pays the coin value instead when the look is owned already, and says so', () => {
    const save = defaultSave();
    claim(save, day(0));
    save.coins = 5000;
    expect(buyItem(save, 'ball', 'melon').ok).toBe(true);
    const coins = save.coins;
    expect(welcomePrize(save, 2)).toMatchObject({ item: { owned: true, coins: 450 } });
    const paid = claim(save, day(1))!;
    expect(paid.item).toMatchObject({ owned: true, coins: 450 });
    expect(paid.worn).toBe(false);
    expect(save.coins).toBe(coins + CALENDAR[1].coins + 450);
    // (A ball earned by level counts as owned too.)
    const vet = defaultSave();
    vet.progress.xp = xpAt(17);
    expect(welcomePrize(vet, 2)!.item!.owned).toBe(true);
  });

  it('never pays a day twice: a reload, a second sync or a clock set back change nothing', () => {
    let save = defaultSave();
    claim(save, day(0));
    claim(save, day(1));
    const snap = exportSave(save);
    for (let i = 0; i < 5; i++) {
      save = importSave(exportSave(save))!;
      expect(syncWelcomeWeek(save)).toBeNull();
      expect(claimCalendar(save, day(0), 3)).toBeNull();
      expect(claimCalendar(save, day(1), 3)).toBeNull();
      expect(syncWelcomeWeek(save)).toBeNull();
    }
    expect(JSON.parse(exportSave(save)).comeback).toEqual(JSON.parse(snap).comeback);
    expect(JSON.parse(exportSave(save)).coins).toBe(JSON.parse(snap).coins);
  });

  it('a save from before the welcome week is adopted where its calendar stands, then gets each day once', () => {
    const old = defaultSave();
    delete old.comeback;
    old.gift = { last: '2026-09-01', streak: 4 };
    const save = importSave(exportSave(old))!;
    const coins = save.coins;
    expect(syncWelcomeWeek(save)).toBeNull();
    expect(save.coins).toBe(coins);
    expect(comebackOf(save).seen).toBe('2026-09-01');
    // His next claims are days 5, 6, 7, then 1, 2, 3, 4: every welcome reward once, wherever he started.
    const got: number[] = [];
    for (let i = 0; i < 14; i++) {
      const p = claim(save, day(i));
      if (p) got.push(p.step);
    }
    expect(got).toEqual([5, 6, 7, 2, 3, 4]);
  });

  it('missing days costs nothing: the next claim is simply the next day of the week', () => {
    const save = defaultSave();
    claim(save, day(0));
    expect(claim(save, day(40))).toMatchObject({ step: 2 });
    expect(claim(save, day(90))).toMatchObject({ step: 3, gems: 15 });
  });
});

describe('WELCOME BACK', () => {
  it('never opens on the day of the very first match, then once on each later day with a gift waiting', () => {
    const save = defaultSave();
    // The first match of all has just ended (the portal's first visit goes drills, match, full time).
    save.record.played = 1;
    noteFirstDay(save, D1, true);
    expect(comebackOf(save).first).toBe(D1);
    expect(welcomeDue(save, D1, true)).toBe(false);
    expect(welcomeDue(save, day(1), true)).toBe(true);
    markWelcomed(save, day(1));
    expect(welcomeDue(save, day(1), true)).toBe(false);
    expect(welcomeDue(save, day(2), true)).toBe(true);
  });

  it('never opens while the first session campaign leads the hub, or with nothing to claim', () => {
    const save = defaultSave();
    noteFirstDay(save, D1);
    expect(comebackOf(save).first).toBe(D1);
    // A player who did a drill yesterday and has not played a match yet: the campaign still leads.
    expect(welcomeDue(save, day(1), false)).toBe(false);
    expect(welcomeDue(save, day(1), true)).toBe(true);
    claimCalendar(save, day(1), 1);
    expect(welcomeDue(save, day(1), true)).toBe(false);
  });

  it('a clock set back does not open it again, and it survives a reload', () => {
    let save = defaultSave();
    noteFirstDay(save, D1);
    markWelcomed(save, day(3));
    save = importSave(exportSave(save))!;
    for (const d of [day(1), day(2), day(3)]) expect(welcomeDue(save, d, true)).toBe(false);
    expect(welcomeDue(save, day(4), true)).toBe(true);
    // A day before the first one (the device's date wound right back) is never a new day.
    expect(welcomeDue(save, day(-5), true)).toBe(false);
  });

  it('a player from before the feature is a veteran: welcomed on the first day he opens the new build', () => {
    const save = defaultSave();
    save.record.played = 40;
    noteFirstDay(save, D1);
    expect(comebackOf(save).first).toBe(VETERAN_DAY);
    expect(welcomeDue(save, D1, true)).toBe(true);
  });
});

describe('the PLAY STREAK', () => {
  it('counts the first completed match of a local day, once', () => {
    const save = defaultSave();
    const coins = save.coins;
    expect(streakToday(save, D1)).toMatchObject({ days: 1, playedToday: false });
    expect(startStreakDay(save, D1)).toMatchObject({ days: 1, prize: { coins: 20, gems: 0 } });
    expect(startStreakDay(save, D1)).toBeNull();
    expect(streakToday(save, D1)).toMatchObject({ days: 1, playedToday: true });
    expect(save.coins).toBe(coins + 20);
    expect(startStreakDay(save, day(1))).toMatchObject({ days: 2, prize: { coins: 30 } });
  });

  it('pays a little that grows for a week, a few gems on days 3, 5 and every 7th', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 30].map(streakCoins)).toEqual([20, 30, 40, 50, 60, 70, 80, 80, 80]);
    expect([1, 2, 3, 4, 5, 6, 7, 14, 15, 21].map(streakGems)).toEqual([0, 0, 2, 0, 3, 0, 5, 5, 0, 5]);
    const save = defaultSave();
    const g = gems(save);
    for (let i = 0; i < 7; i++) startStreakDay(save, day(i));
    expect(gems(save)).toBe(g + 2 + 3 + 5);
  });

  it('hands over a catalogue look on days 7, 14 and 30, each once, and its coin value when owned', () => {
    expect(STREAK_ITEM_DAYS).toEqual([7, 14, 30]);
    for (const d of STREAK_ITEM_DAYS) expect(shopItem(STREAK_ITEMS[d].cat, STREAK_ITEMS[d].id)!.price).toBeGreaterThan(0);
    const save = defaultSave();
    expect(nextStreakItem(save, 1)).toMatchObject({ day: 7, item: { owned: false } });
    for (let i = 0; i < 6; i++) startStreakDay(save, day(i));
    const d7 = startStreakDay(save, day(6))!;
    expect(d7.prize.item!.item.id).toBe('notes');
    expect(owns(save, 'trail', 'notes')).toBe(true);
    expect(nextStreakItem(save, 8)!.day).toBe(14);
    // Owned already (bought on the way): its coin value instead, once.
    grantItem(save, 'goalfx', 'rainbow');
    for (let i = 7; i < 13; i++) startStreakDay(save, day(i));
    const coins = save.coins;
    const d14 = startStreakDay(save, day(13))!;
    expect(d14.prize.item).toMatchObject({ owned: true, coins: 1400 });
    expect(save.coins).toBe(coins + 80 + 1400);
    // After a long break the streak comes back through day 7: the look was handed over, so the day pays its coins only.
    expect(startStreakDay(save, day(40))).toMatchObject({ days: 7, halved: true, was: 14 });
    expect(streakPrize(save, 7).item).toBeUndefined();
    expect(comebackOf(save).streak.paid).toEqual([7, 14]);
  });

  it('forgives one missed day a week: the streak carries on as if it had been played', () => {
    const save = defaultSave();
    for (let i = 0; i < 4; i++) startStreakDay(save, day(i));
    // Day 4 is missed; day 5 carries on.
    expect(streakToday(save, day(5))).toMatchObject({ days: 5, saved: true, halved: false });
    const kept = startStreakDay(save, day(5))!;
    expect(kept).toMatchObject({ days: 5, saved: true });
    expect(streakWords(kept)).toBe('ONE DAY OFF IS ON US');
    // A second missed day inside the same week is a break.
    startStreakDay(save, day(6));
    expect(streakToday(save, day(8))).toMatchObject({ days: 3, saved: false, halved: true, was: 6 });
    // A week later the free day is back.
    const again = defaultSave();
    for (let i = 0; i < 3; i++) startStreakDay(again, day(i));
    startStreakDay(again, day(4));
    for (let i = 5; i < 4 + FREE_DAY_EVERY; i++) startStreakDay(again, day(i));
    expect(streakToday(again, day(4 + FREE_DAY_EVERY + 1))).toMatchObject({ saved: true });
  });

  it('halves after a longer break instead of zeroing, and says what was kept', () => {
    const save = defaultSave();
    for (let i = 0; i < 12; i++) startStreakDay(save, day(i));
    const back = startStreakDay(save, day(30))!;
    expect(back).toMatchObject({ days: 6, halved: true, was: 12 });
    expect(streakWords(back)).toBe('YOU KEPT 6 OF 12 DAYS');
    expect(comebackOf(save).streak.best).toBe(12);
    // It is never a telling off: no word of it says lost, broken, missed or reset.
    for (const w of [streakWords(back), streakWords({ days: 3, saved: true, halved: false, was: 0 }), streakWords({ days: 1, saved: false, halved: false, was: 0 })]) {
      expect(w).not.toMatch(/LOST|BROKE|MISS|RESET|FAIL/);
    }
    // A one day streak has nothing to halve.
    const one = defaultSave();
    startStreakDay(one, D1);
    expect(startStreakDay(one, day(9))).toMatchObject({ days: 1, halved: false });
  });

  it('cannot be farmed by winding the date back, even after a reload', () => {
    let save = defaultSave();
    startStreakDay(save, D1);
    startStreakDay(save, day(1));
    const coins = save.coins;
    for (let i = 0; i < 6; i++) {
      save = importSave(exportSave(save))!;
      expect(startStreakDay(save, D1)).toBeNull();
      expect(startStreakDay(save, day(-3))).toBeNull();
      expect(startStreakDay(save, day(1))).toBeNull();
    }
    expect(save.coins).toBe(coins);
    expect(startStreakDay(save, day(2))).toMatchObject({ days: 3 });
  });
});

describe('TRY TODAY', () => {
  it('is one look the player does not own, cheaper to dearer, picked from the date and held all day', () => {
    const save = defaultSave();
    const pool = tryPool(save);
    expect(pool.length).toBeGreaterThan(20);
    for (const it of pool) {
      expect(TRY_CATS).toContain(it.cat);
      expect(it.pass).toBeUndefined();
      expect(owns(save, it.cat, it.id)).toBe(false);
    }
    expect(pool.map((it) => it.price)).toEqual([...pool.map((it) => it.price)].sort((a, b) => a - b));
    const a = tryToday(save, D1);
    expect(a).toEqual(tryToday(save, D1));
    expect(a.item).toBe(pool[epochDay(D1) % pool.length]);
    expect(a.used).toBe(false);
    // Tomorrow is another one, and tomorrow's card names it today.
    expect(tryToday(save, day(1)).item).not.toBe(a.item);
    expect(tomorrowOf(save, D1).tryItem).toBe(tryToday(save, day(1)).item);
  });

  it('is worn free in one completed match a day, and KEEP IT costs the shop price', () => {
    let save = defaultSave();
    const it = tryToday(save, D1).item!;
    expect(useTry(save, D1, it)).toBe(it);
    expect(useTry(save, D1, it)).toBeNull();
    expect(owns(save, it.cat, it.id)).toBe(false);
    expect(keepPrice(save, it, D1)).toBeLessThanOrEqual(it.price);
    save = importSave(exportSave(save))!;
    expect(tryToday(save, D1)).toMatchObject({ used: true, item: { id: it.id } });
    // A clock set back is still today.
    expect(tryToday(save, day(-1)).used).toBe(true);
    expect(useTry(save, day(-1), it)).toBeNull();
    expect(tryToday(save, day(1)).used).toBe(false);
  });

  it('skips what is owned, and stops when everything is', () => {
    const save = defaultSave();
    const first = tryToday(save, D1).item!;
    grantItem(save, first.cat, first.id);
    expect(tryToday(save, D1).item).not.toBe(first);
    for (const it of shopItems()) if (it.price > 0 && !it.pass) grantItem(save, it.cat, it.id);
    expect(tryPool(save)).toEqual([]);
    expect(tryToday(save, D1)).toEqual({ item: null, used: false });
    expect(tomorrowOf(save, D1).tryItem).toBeNull();
  });
});

describe('MATCH OF THE DAY', () => {
  it('is one moment a day from the ones the player has opened, the same all day', () => {
    const save = defaultSave();
    // A new player has only the first moment open.
    expect(motdOf(save, D1)!.moment.id).toBe(MOMENTS[0].id);
    // Opening more of the ladder mid day does not swap today's.
    save.moments = Object.fromEntries(MOMENTS.map((m) => [m.id, 1]));
    expect(motdOf(save, D1)!.moment.id).toBe(MOMENTS[0].id);
    const seen = new Set<string>();
    for (let i = 1; i < 40; i++) seen.add(motdOf(save, day(i))!.moment.id);
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it('is never the same moment two days running once more than one is open', () => {
    const save = defaultSave();
    save.moments = { [MOMENTS[0].id]: 1 };
    let prev = '';
    for (let i = 0; i < 30; i++) {
      const id = motdOf(save, day(i))!.moment.id;
      expect(id).not.toBe(prev);
      prev = id;
    }
    expect(motdPick(save, day(30)).id).not.toBe(prev);
  });

  it('pays its coins and gems for completing it, once a day, never for another moment or a failed try', () => {
    let save = defaultSave();
    const id = motdOf(save, D1)!.moment.id;
    const coins = save.coins;
    const g = gems(save);
    expect(claimMotd(save, D1, id, false)).toBeNull();
    expect(claimMotd(save, D1, 'giant-killing', true)).toBeNull();
    expect(claimMotd(save, D1, id, true)).toEqual({ coins: MOTD_REWARD.coins, gems: MOTD_REWARD.gems });
    expect(motdOf(save, D1)!.done).toBe(true);
    for (let i = 0; i < 5; i++) {
      save = importSave(exportSave(save))!;
      expect(claimMotd(save, D1, id, true)).toBeNull();
      // A clock set back shows the latest day's match, done, and pays nothing.
      expect(motdOf(save, day(-2))).toMatchObject({ done: true });
      expect(claimMotd(save, day(-2), id, true)).toBeNull();
    }
    expect(save.coins).toBe(coins + MOTD_REWARD.coins);
    expect(gems(save)).toBe(g + MOTD_REWARD.gems);
    const next = motdOf(save, day(1))!;
    expect(next.done).toBe(false);
    expect(claimMotd(save, day(1), next.moment.id, true)).not.toBeNull();
  });
});

describe('TOMORROW', () => {
  it('names the real next gift with its welcome week reward, the next streak day and the next free try', () => {
    const save = defaultSave();
    // Before today's gift is claimed, tomorrow is shown as if it is taken first: day 2, the hook.
    const t = tomorrowOf(save, D1);
    expect(t.todayOpen).toBe(true);
    expect(t.gift).toMatchObject({ step: 2, coins: 150, tokens: 1 });
    expect(t.gift.item!.item.name).toBe('Melon');
    expect(t.streak).toMatchObject({ day: 2, coins: 30 });
    claim(save, D1);
    startStreakDay(save, D1);
    const after = tomorrowOf(save, D1);
    expect(after.todayOpen).toBe(false);
    expect(after.gift).toMatchObject({ step: 2, coins: 150, tokens: 1 });
    expect(after.streak.day).toBe(2);
    claim(save, day(1));
    expect(tomorrowOf(save, day(1)).gift).toMatchObject({ step: 3, coins: 200, gems: CALENDAR[2].gems + 15 });
  });

  it('shows the reserved streak look the day before it is due', () => {
    const save = defaultSave();
    for (let i = 0; i < 6; i++) startStreakDay(save, day(i));
    expect(tomorrowOf(save, day(5)).streak).toMatchObject({ day: 7, coins: 80, gems: 5, item: { owned: false } });
  });
});

describe('the come-back state in the save', () => {
  it('a new save starts empty, and a save from before it loads whole', () => {
    expect(defaultSave().comeback).toEqual(defaultComeback());
    const old = JSON.parse(exportSave(defaultSave())) as { comeback?: unknown };
    delete old.comeback;
    expect(importSave(old)!.comeback).toEqual(defaultComeback());
  });

  it('is made whole when damaged, and keeps real progress across a reload', () => {
    expect(normalizeComeback('nope')).toEqual(defaultComeback());
    expect(normalizeComeback({ welcome: [1, 1, 9, 'x', 3], streak: { days: -4, playedOn: 'yesterday', paid: [7, 7, 0] }, income: { at: -1, banked: 1e12 }, motd: { day: D1 } }))
      .toEqual({ ...defaultComeback(), welcome: [1, 3], streak: { ...defaultComeback().streak, paid: [7] } });
    const save = defaultSave();
    claim(save, D1);
    for (let i = 0; i < 3; i++) startStreakDay(save, day(i));
    useTry(save, D1, tryToday(save, D1).item!);
    claimMotd(save, D1, motdOf(save, D1)!.moment.id, true);
    const back = importSave(exportSave(save))!;
    expect(back.comeback).toEqual(save.comeback);
    expect(comebackOf(back).streak).toMatchObject({ days: 3, playedOn: day(2) });
    // A damaged blob on a live save is healed in place the first time a rule reads it.
    (back as { comeback?: unknown }).comeback = { streak: 7 };
    expect(streakToday(back, D1)).toMatchObject({ days: 1, playedToday: false });
  });
});

describe('what the come-back loops add to a week', () => {
  it('stays small beside the calendar and inside the weekly gem pin', () => {
    // Steady state: the match of the day every day and the streak's seventh day.
    expect(weeklyComebackGems()).toBe(7 * MOTD_REWARD.gems + 5);
    // With the existing loops (economyV3's pin): still neither a trickle nor a flood.
    expect(weeklyLoopGems() + weeklyComebackGems()).toBeLessThanOrEqual(160);
  });
});
