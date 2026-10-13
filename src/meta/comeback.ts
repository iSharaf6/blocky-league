/**
 * REASONS TO COME BACK TOMORROW (docs/ECONOMY.md, 14 October 2026). CrazyGames' reviewer: "We believe average playtime
 * and retention can be improved further. You can add more progression features." Day 1 retention was 4.3%.
 *
 * - WELCOME WEEK: the first time each day of the login calendar is claimed it carries a standout reward on top of the
 *   coins: a named ball and a Scout Ticket on day 2 (the hook), gems on day 3, a kit on day 5, a rare look on day 7.
 *   Every one is an item the shop already sells; a player who owns it already is paid its coin value instead.
 * - WELCOME BACK: the first time the hub opens on a new local day with the gift unclaimed, the gift sheet opens by
 *   itself, once. Never on the day of the very first match, never while the first session's campaign leads the hub.
 * - PLAY STREAK: the first completed match of a local day counts. It forgives: one missed day a week costs nothing,
 *   and a longer break halves the streak instead of zeroing it (the game says what was kept). A few coins that grow
 *   for a week, a few gems on days 3, 5 and every 7th, and a catalogue item on days 7, 14 and 30.
 * - TRY TODAY: one look the player does not own (a ball, a trail, a goal explosion or a celebration), cheaper to
 *   dearer, picked from the date, worn free for one completed match a day, with KEEP IT at its shop price after.
 * - MATCH OF THE DAY: one Football Moment a local day (from the ones the player has opened), with coins and gems for
 *   completing it, once.
 * - TOMORROW: what the next local day brings, said plainly (the next gift, the next streak day, the next free try).
 *
 * The rules that keep it kind (tests/comeback.test.ts pins them): nothing here is lost by staying away, nothing is
 * random, nothing is sold, and every date is a high-water mark, so a clock set back never pays twice.
 *
 * Pure rules over SaveData.comeback (core/comebackState.ts), no DOM. CLUB INCOME has its own module (clubIncome.ts).
 */
import { VETERAN_DAY, comebackOf, type ComebackState } from '../core/comebackState';
import { hashString } from '../core/rng';
import type { SaveData } from '../core/save';
import { addGems } from './gems';
import { CALENDAR, calendarNext, calendarToday } from './loops';
import { MOMENTS, momentById, momentUnlocked, type Moment } from './moments';
import {
  DEFAULT_ID, creditCoins, earnTokens, equipItem, equippedId, equippedIn, grantItem, isSlotCat, itemKey, owns, priceOn, shopItem, shopItems,
  type ShopCat, type ShopItem,
} from './shop';

type CbSave = Pick<SaveData, 'comeback' | 'gift' | 'coins' | 'gems' | 'shop' | 'progress' | 'settings' | 'record' | 'moments'>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------------ days

/** Whole days since 1970 for a local day (YYYY-MM-DD): the difference of two is the calendar days between them. */
export function epochDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y || 1970, (m || 1) - 1, d || 1) / 86_400_000);
}

/** The local day `n` calendar days after `day`. */
export function dayAfter(day: string, n = 1): string {
  const t = new Date((epochDay(day) + n) * 86_400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ items as prizes

/** A catalogue item as a prize: the item, whether the player has it already, and the coins paid instead when he has. */
export interface ItemPrize {
  item: ShopItem;
  owned: boolean;
  coins: number;
}

function itemPrize(save: CbSave, ref: { cat: ShopCat; id: string } | undefined): ItemPrize | undefined {
  const item = ref ? shopItem(ref.cat, ref.id) : undefined;
  if (!item) return undefined;
  const owned = owns(save, item.cat, item.id);
  return { item, owned, coins: owned ? item.price : 0 };
}

/**
 * Hand a prize over: the item (worn at once where nothing else is worn, never a kit: your club's own strip is yours to
 * change), or its coin value when it was owned already. Returns true when the item is now on.
 */
function payItem(save: CbSave, p: ItemPrize): boolean {
  if (p.owned) {
    creditCoins(save, p.coins);
    return false;
  }
  const { cat, id } = p.item;
  grantItem(save, cat, id);
  if (cat === 'kit') return false;
  const free = isSlotCat(cat) ? !!p.item.slot && equippedIn(save, cat, p.item.slot) === '' : equippedId(save, cat) === DEFAULT_ID[cat];
  return free && equipItem(save, cat, id);
}

// ------------------------------------------------------------------ the first day, and WELCOME BACK

/**
 * Write the save's first day, once. A save that was here before this existed (matches played, or a gift claimed) is a
 * veteran; `fullTime` is the call made as a match ends, when the first ever match has just been counted.
 */
export function noteFirstDay(save: CbSave, day: string, fullTime = false): void {
  const c = comebackOf(save);
  if (c.first || !DAY.test(day)) return;
  const played = save.record?.played ?? 0;
  c.first = played > (fullTime ? 1 : 0) || (!fullTime && !!save.gift) ? VETERAN_DAY : day;
}

/**
 * The WELCOME BACK sheet is due: a later local day than the first one, not yet opened today, today's gift unclaimed,
 * and the first session's campaign behind the player (`started`: a match played or the first goal scored).
 */
export function welcomeDue(save: CbSave, day: string, started: boolean): boolean {
  if (!started || !DAY.test(day)) return false;
  const c = comebackOf(save);
  if (!c.first || c.first >= day || c.greeted >= day) return false;
  return !!calendarToday(save, day);
}

/** The sheet opened by itself today: never again until a later day. */
export function markWelcomed(save: CbSave, day: string): void {
  const c = comebackOf(save);
  if (DAY.test(day) && day > c.greeted) c.greeted = day;
}

// ------------------------------------------------------------------ WELCOME WEEK

export interface WelcomeExtra {
  item?: { cat: ShopCat; id: string };
  gems?: number;
  tokens?: number;
}

/**
 * What each day of the calendar adds the FIRST time it is claimed (day 1 first; null = the calendar's own reward).
 * For a new player that is the first lap; a player from before this gets each day once from wherever his calendar is.
 */
export const WELCOME_WEEK: readonly (WelcomeExtra | null)[] = [
  null,
  { item: { cat: 'ball', id: 'melon' }, tokens: 1 },
  { gems: 15 },
  { tokens: 1 },
  { item: { cat: 'kit', id: 'tiger' } },
  { gems: 5 },
  { item: { cat: 'look', id: 'afro' } },
];

export interface WelcomePrize {
  step: number;
  item?: ItemPrize;
  gems: number;
  tokens: number;
}

/** What calendar day `step` (1..7) adds for this save on top of the calendar (null: nothing, or handed over already). */
export function welcomePrize(save: CbSave, step: number): WelcomePrize | null {
  const s = Math.floor(step);
  const extra = WELCOME_WEEK[s - 1];
  if (!extra || comebackOf(save).welcome.includes(s)) return null;
  return { step: s, item: itemPrize(save, extra.item), gems: extra.gems ?? 0, tokens: extra.tokens ?? 0 };
}

export interface WelcomePaid extends WelcomePrize {
  /** The item went on at once. */
  worn: boolean;
}

/**
 * Hand over the welcome week reward of a calendar day that has just been claimed (called whenever the hub opens:
 * the claim itself is meta/loops.ts claimCalendar). Each claim is accounted for once, by its date; a save from
 * before this existed is adopted where its calendar stands, without paying for days claimed long ago.
 */
export function syncWelcomeWeek(save: CbSave): WelcomePaid | null {
  const g = save.gift;
  const c = comebackOf(save);
  if (!g || !DAY.test(g.last) || g.last <= c.seen) return null;
  const step = Math.max(1, Math.min(7, Math.floor(g.streak) || 1));
  const adopted = c.seen === '' && c.welcome.length === 0 && step > 1;
  c.seen = g.last;
  if (adopted) return null;
  const prize = welcomePrize(save, step);
  if (!c.welcome.includes(step)) c.welcome = [...c.welcome, step].sort((a, b) => a - b);
  if (!prize) return null;
  const worn = prize.item ? payItem(save, prize.item) : false;
  if (prize.gems) addGems(save, prize.gems, 'welcomeWeek');
  if (prize.tokens) earnTokens(save, prize.tokens);
  return { ...prize, worn };
}

/** Coins of looks and gems the whole welcome week is worth (docs and the model). */
export function welcomeWeekWorth(): { coins: number; gems: number; tokens: number } {
  let coins = 0;
  let gems = 0;
  let tokens = 0;
  for (const e of WELCOME_WEEK) {
    if (!e) continue;
    coins += e.item ? shopItem(e.item.cat, e.item.id)?.price ?? 0 : 0;
    gems += e.gems ?? 0;
    tokens += e.tokens ?? 0;
  }
  return { coins, gems, tokens };
}

// ------------------------------------------------------------------ the PLAY STREAK

/** A missed day is forgiven once in this many days. */
export const FREE_DAY_EVERY = 7;

/** The catalogue items kept for the streak's big days: handed over once each (the coin value if owned already). */
export const STREAK_ITEMS: { readonly [day: number]: { cat: ShopCat; id: string } } = {
  7: { cat: 'trail', id: 'notes' },
  14: { cat: 'goalfx', id: 'rainbow' },
  30: { cat: 'look', id: 'halo' },
};
export const STREAK_ITEM_DAYS: readonly number[] = Object.keys(STREAK_ITEMS).map(Number).sort((a, b) => a - b);

/** Coins the first match of streak day `day` pays: 20 on day 1, ten more a day, 80 from day 7. */
export function streakCoins(day: number): number {
  return Math.min(80, 10 + 10 * Math.max(1, Math.floor(day)));
}

/** Gems on streak day `day`: 2 on day 3, 3 on day 5, 5 on every seventh day. */
export function streakGems(day: number): number {
  const d = Math.floor(day);
  if (d > 0 && d % 7 === 0) return 5;
  return d === 3 ? 2 : d === 5 ? 3 : 0;
}

export interface StreakNow {
  /** The streak's day today: what it is when today has been played, else what today's first match will make it. */
  days: number;
  playedToday: boolean;
  /** A missed day was forgiven to get here. */
  saved: boolean;
  /** A longer break halved it; `was` is what it stood at before. */
  halved: boolean;
  was: number;
}

export function streakToday(save: CbSave, day: string): StreakNow {
  const s = comebackOf(save).streak;
  const cur = Math.max(0, Math.floor(s.days) || 0);
  // (A clock set back: the latest day played still counts as today's.)
  if (s.playedOn && s.playedOn >= day) return { days: Math.max(1, cur), playedToday: true, saved: s.how === 1, halved: s.how === 2, was: s.how === 2 ? s.was : 0 };
  if (!s.playedOn || cur <= 0) return { days: 1, playedToday: false, saved: false, halved: false, was: 0 };
  const gap = epochDay(day) - epochDay(s.playedOn);
  if (gap <= 1) return { days: cur + 1, playedToday: false, saved: false, halved: false, was: 0 };
  const free = !s.freeOn || epochDay(day) - epochDay(s.freeOn) >= FREE_DAY_EVERY;
  if (gap === 2 && free) return { days: cur + 1, playedToday: false, saved: true, halved: false, was: 0 };
  return { days: Math.max(1, Math.floor(cur / 2)), playedToday: false, saved: false, halved: cur >= 2, was: cur };
}

export interface StreakPrize {
  day: number;
  coins: number;
  gems: number;
  item?: ItemPrize;
}

/** What the first match of streak day `day` pays this save (the reserved item only until it has been handed over). */
export function streakPrize(save: CbSave, day: number): StreakPrize {
  const d = Math.max(1, Math.floor(day));
  const reserved = STREAK_ITEMS[d] && !comebackOf(save).streak.paid.includes(d) ? STREAK_ITEMS[d] : undefined;
  return { day: d, coins: streakCoins(d), gems: streakGems(d), item: itemPrize(save, reserved) };
}

export interface StreakPaid extends StreakNow {
  prize: StreakPrize;
  worn: boolean;
}

/**
 * A match was completed: today's first one moves the streak on and pays its day (coins, gems, the reserved item).
 * Null when today was counted already.
 */
export function startStreakDay(save: CbSave, day: string): StreakPaid | null {
  if (!DAY.test(day)) return null;
  const now = streakToday(save, day);
  if (now.playedToday) return null;
  const s = comebackOf(save).streak;
  const prize = streakPrize(save, now.days);
  s.days = now.days;
  s.best = Math.max(s.best, now.days);
  s.playedOn = day;
  if (now.saved) s.freeOn = day;
  s.how = now.saved ? 1 : now.halved ? 2 : 0;
  s.was = now.halved ? now.was : 0;
  creditCoins(save, prize.coins);
  if (prize.gems) addGems(save, prize.gems, 'playStreak');
  let worn = false;
  if (prize.item) {
    worn = payItem(save, prize.item);
    s.paid = [...s.paid, prize.day].sort((a, b) => a - b);
  }
  return { ...now, prize, worn };
}

/** The next reserved item still to come from streak day `from` on (null once all three are handed over). */
export function nextStreakItem(save: CbSave, from: number): { day: number; item: ItemPrize } | null {
  const paid = comebackOf(save).streak.paid;
  for (const d of STREAK_ITEM_DAYS) {
    if (d < from || paid.includes(d)) continue;
    const item = itemPrize(save, STREAK_ITEMS[d]);
    if (item) return { day: d, item };
  }
  return null;
}

/** How today's streak day came about, in the game's words (never a telling off: what was kept comes first). */
export function streakWords(now: Pick<StreakNow, 'days' | 'saved' | 'halved' | 'was'>): string {
  if (now.halved) return `YOU KEPT ${now.days} OF ${now.was} DAYS`;
  if (now.saved) return 'ONE DAY OFF IS ON US';
  return now.days > 1 ? `${now.days} DAYS IN A ROW` : 'DAY ONE';
}

// ------------------------------------------------------------------ TRY TODAY

/** The kinds of look a free try can be: the ones a match wears one of (main.ts equipped()). */
export const TRY_CATS: readonly ShopCat[] = ['ball', 'trail', 'goalfx', 'celebration'];

/** The looks not owned yet that a try can be, cheaper to dearer. */
export function tryPool(save: CbSave): ShopItem[] {
  return shopItems()
    .filter((it) => TRY_CATS.includes(it.cat) && it.price > 0 && !it.pass && !owns(save, it.cat, it.id))
    .sort((a, b) => a.price - b.price || TRY_CATS.indexOf(a.cat) - TRY_CATS.indexOf(b.cat) || a.id.localeCompare(b.id));
}

function itemOfKey(key: string): ShopItem | undefined {
  const [cat, id] = key.split(':') as [ShopCat, string];
  return shopItem(cat, id);
}

export interface TryView {
  /** Today's look (null: everything is owned). */
  item: ShopItem | null;
  /** It has been worn in a completed match today. */
  used: boolean;
}

/** Today's free try. Reads only: one a day from the date, round and round the looks not owned. */
export function tryToday(save: CbSave, day: string): TryView {
  const c = comebackOf(save);
  if (c.tryOn && c.tryOn >= day) return { item: itemOfKey(c.tryKey) ?? null, used: true };
  const list = DAY.test(day) ? tryPool(save) : [];
  return { item: list.length ? list[epochDay(day) % list.length] : null, used: false };
}

/** The try was worn in a completed match: used for today. Returns the look (null when today's was used already). */
export function useTry(save: CbSave, day: string, item: ShopItem): ShopItem | null {
  const c = comebackOf(save);
  if (!DAY.test(day) || (c.tryOn && c.tryOn >= day)) return null;
  c.tryOn = day;
  c.tryKey = itemKey(item.cat, item.id);
  return item;
}

/** What keeping a tried look costs today (its shop price; today's deal price when it is the deal). */
export function keepPrice(save: CbSave, item: ShopItem, day: string): number {
  return priceOn(save, item, day);
}

// ------------------------------------------------------------------ MATCH OF THE DAY

/** What completing the day's featured moment pays, once a local day. */
export const MOTD_REWARD = { coins: 100, gems: 3 } as const;

/** The moments a save can be given: the ones its ladder has opened (the first is always open). */
function motdPool(save: CbSave): Moment[] {
  const best = save.moments ?? {};
  return MOMENTS.filter((m) => momentUnlocked(m.id, best));
}

/** The moment of `day` for this save, without touching it: date-seeded, and never the one before twice running. */
export function motdPick(save: CbSave, day: string): Moment {
  const pool = motdPool(save);
  const prev = comebackOf(save).motd;
  let i = hashString(`motd|${day}`) % pool.length;
  if (pool.length > 1 && prev.day < day && pool[i].id === prev.id) i = (i + 1) % pool.length;
  return pool[i];
}

export interface MotdView {
  moment: Moment;
  /** Today's reward has been paid. */
  done: boolean;
}

/** Today's MATCH OF THE DAY: picked once a day and kept in the save, so it holds still while the ladder opens. */
export function motdOf(save: CbSave, day: string): MotdView | null {
  if (!DAY.test(day)) return null;
  const c = comebackOf(save);
  if (c.motd.day >= day && c.motd.day) {
    const kept = momentById(c.motd.id);
    if (kept) return { moment: kept, done: c.motd.paid };
  }
  if (c.motd.day > day) return null;
  const moment = motdPick(save, day);
  c.motd = { day, id: moment.id, paid: false };
  return { moment, done: false };
}

/** A moment was finished: today's featured one, won, pays its coins and gems once. Null otherwise. */
export function claimMotd(save: CbSave, day: string, id: string, won: boolean): { coins: number; gems: number } | null {
  if (!won) return null;
  const v = motdOf(save, day);
  const c = comebackOf(save);
  if (!v || v.done || v.moment.id !== id || c.motd.day !== day) return null;
  c.motd.paid = true;
  creditCoins(save, MOTD_REWARD.coins);
  addGems(save, MOTD_REWARD.gems, 'matchOfTheDay');
  return { coins: MOTD_REWARD.coins, gems: MOTD_REWARD.gems };
}

// ------------------------------------------------------------------ TOMORROW

export interface TomorrowView {
  /** Today's gift is still waiting on the hub (tomorrow's is shown as if it is taken first). */
  todayOpen: boolean;
  gift: { step: number; coins: number; gems: number; tokens: number; item?: ItemPrize };
  streak: StreakPrize;
  /** Tomorrow's free try (null: every look is owned). */
  tryItem: ShopItem | null;
}

/** Tomorrow: the next gift (as if today's is taken), the next day of the streak, the next free try. */
export function tomorrowOf(save: CbSave, day: string): TomorrowView {
  const open = calendarToday(save, day);
  const step = open ? (open.step % 7) + 1 : calendarNext(save).step;
  const cal = CALENDAR[step - 1];
  const extra = welcomePrize(save, step);
  const st = streakToday(save, day);
  const pool = tryPool(save);
  return {
    todayOpen: !!open,
    gift: { step, coins: cal.coins, gems: cal.gems + (extra?.gems ?? 0), tokens: cal.tokens + (extra?.tokens ?? 0), item: extra?.item },
    streak: streakPrize(save, st.days + 1),
    tryItem: pool.length ? pool[epochDay(dayAfter(day)) % pool.length] : null,
  };
}

/** Today's gift with its welcome week reward on top (null once claimed): what the gift sheet and the hub show. */
export function giftView(save: CbSave, day: string): TomorrowView['gift'] | null {
  const open = calendarToday(save, day);
  if (!open) return null;
  const extra = welcomePrize(save, open.step);
  return { step: open.step, coins: open.reward.coins, gems: open.reward.gems + (extra?.gems ?? 0), tokens: open.reward.tokens + (extra?.tokens ?? 0), item: extra?.item };
}

// ------------------------------------------------------------------ what a week of it pays (docs, tests, the model)

/**
 * Gems a week from the come-back loops at their steady rate: the MATCH OF THE DAY every day and the streak's seventh
 * day. (The welcome week's 20 gems and the streak's first days 3 and 5 are once only.)
 */
export function weeklyComebackGems(): number {
  return 7 * MOTD_REWARD.gems + streakGems(7);
}

/** Coins a week from them, at a streak that has reached its seventh day: seven match days and seven streak days. */
export function weeklyComebackCoins(): number {
  return 7 * MOTD_REWARD.coins + 7 * streakCoins(7);
}

export type { ComebackState };
