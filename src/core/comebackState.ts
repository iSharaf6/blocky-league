/**
 * What the REASONS TO COME BACK remember (rules: meta/comeback.ts and meta/clubIncome.ts; screens: ui/comeback.ts):
 * the welcome week, the WELCOME BACK sheet, the play streak, TRY TODAY, CLUB INCOME and the MATCH OF THE DAY.
 *
 * State and its tolerant loader only, with no imports at all: core/save.ts builds a save from it, and the rule modules
 * read the shop's catalogue (which itself needs core/save.ts loaded first).
 *
 * Every date here is a local day (YYYY-MM-DD) kept as a high-water mark, and the one clock (income.at, ms) only
 * moves forward: setting the device's date or time back never reopens a reward (tests/rewardClock.test.ts).
 */

export interface StreakState {
  /** Days in the play streak as of `playedOn` (0 = never played). */
  days: number;
  best: number;
  /** The last local day a match was completed ('' = never). */
  playedOn: string;
  /** The local day a missed day was last forgiven ('' = never): one a week costs nothing. */
  freeOn: string;
  /** How `playedOn`'s day came about: 0 in a row, 1 a missed day forgiven, 2 halved after a longer break. */
  how: 0 | 1 | 2;
  /** The streak before it was halved (so the game can say what was kept). */
  was: number;
  /** Reserved streak items already handed over, by streak day (7, 14, 30): each once. */
  paid: number[];
}

export interface IncomeState {
  /** The clock's high-water mark (ms since 1970; 0 = the ticket office has not opened yet). */
  at: number;
  /** Coins waiting to be collected (fractions kept until they add up). */
  banked: number;
}

export interface MotdState {
  /** The local day `id` was picked for ('' = none yet), the moment, and whether its reward was paid. */
  day: string;
  id: string;
  paid: boolean;
}

export interface ComebackState {
  /** The local day this save first played ('' until then; VETERAN_DAY for a save from before this existed). */
  first: string;
  /** The local day the WELCOME BACK sheet last opened by itself ('' = never). */
  greeted: string;
  /** WELCOME WEEK: the calendar days (1..7) whose standout reward was handed over, each once. */
  welcome: number[];
  /** The calendar claim (SaveData.gift.last) the welcome week has already accounted for. */
  seen: string;
  streak: StreakState;
  /** TRY TODAY: the local day the free try was last worn, and what it was (`cat:id`). */
  tryOn: string;
  tryKey: string;
  income: IncomeState;
  motd: MotdState;
}

/** A player who was here before the come-back features: never "the day of the very first run". */
export const VETERAN_DAY = '2000-01-01';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z]+:[a-z0-9]+$/;
const day = (v: unknown): string => (typeof v === 'string' && DAY.test(v) ? v : '');
const whole = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, Math.floor(v)) : 0);
const days = (v: unknown, max: number): number[] =>
  Array.isArray(v) ? [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= max))].sort((a, b) => a - b) : [];

/** The most coins the ticket office can ever hold (a damaged or edited number is cut to it). */
export const INCOME_BANK_MAX = 5000;

export function defaultComeback(): ComebackState {
  return {
    first: '', greeted: '', welcome: [], seen: '',
    streak: { days: 0, best: 0, playedOn: '', freeOn: '', how: 0, was: 0, paid: [] },
    tryOn: '', tryKey: '',
    income: { at: 0, banked: 0 },
    motd: { day: '', id: '', paid: false },
  };
}

/** A blob as stored by any build (or none) made whole: unknown or damaged fields become the defaults. */
export function normalizeComeback(raw: unknown): ComebackState {
  const base = defaultComeback();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const r = raw as { [k: string]: unknown };
  const s = (r.streak && typeof r.streak === 'object' ? r.streak : {}) as { [k: string]: unknown };
  const i = (r.income && typeof r.income === 'object' ? r.income : {}) as { [k: string]: unknown };
  const m = (r.motd && typeof r.motd === 'object' ? r.motd : {}) as { [k: string]: unknown };
  const playedOn = day(s.playedOn);
  const streakDays = playedOn ? Math.max(1, whole(s.days, 99999)) : 0;
  const tryOn = day(r.tryOn);
  const tryKey = typeof r.tryKey === 'string' && KEY.test(r.tryKey) ? r.tryKey : '';
  const motdDay = day(m.day);
  const motdId = typeof m.id === 'string' && /^[a-z0-9-]{1,40}$/.test(m.id) ? m.id : '';
  const at = typeof i.at === 'number' && Number.isFinite(i.at) && i.at > 0 ? Math.floor(i.at) : 0;
  const banked = typeof i.banked === 'number' && Number.isFinite(i.banked) && i.banked > 0 ? Math.min(INCOME_BANK_MAX, i.banked) : 0;
  return {
    first: day(r.first),
    greeted: day(r.greeted),
    welcome: days(r.welcome, 7),
    seen: day(r.seen),
    streak: {
      days: streakDays,
      best: Math.max(streakDays, whole(s.best, 99999)),
      playedOn,
      freeOn: day(s.freeOn),
      how: s.how === 1 ? 1 : s.how === 2 ? 2 : 0,
      was: whole(s.was, 99999),
      paid: days(s.paid, 9999),
    },
    tryOn: tryOn && tryKey ? tryOn : '',
    tryKey: tryOn && tryKey ? tryKey : '',
    income: { at, banked: at ? banked : 0 },
    motd: motdDay && motdId ? { day: motdDay, id: motdId, paid: m.paid === true } : base.motd,
  };
}

/** The save's come-back state, made whole in place first if it isn't (a save from any path: storage, a file, the cloud). */
export function comebackOf(save: { comeback?: ComebackState }): ComebackState {
  const c = save.comeback;
  if (
    !c || typeof c !== 'object' || typeof c.first !== 'string' || typeof c.greeted !== 'string' || typeof c.seen !== 'string' || !Array.isArray(c.welcome)
    || !c.streak || !Array.isArray(c.streak.paid) || typeof c.streak.playedOn !== 'string' || typeof c.tryOn !== 'string'
    || !c.income || typeof c.income.at !== 'number' || !c.motd || typeof c.motd.day !== 'string'
  ) save.comeback = normalizeComeback(c);
  return save.comeback!;
}
