import { normalizeFriendReceipts } from '../meta/referrals';
import { normalizeMastery, type MasteryState } from '../meta/mastery';
import { PRESET_CLUBS } from '../meta/data';
import { normalizeGems, type GemState } from '../meta/gems';
import { normalizeLoops, type LoopState } from '../meta/loops';
import { normalizeRun, type RunState } from '../meta/run';
import { normalizeSeason, type SeasonState } from '../meta/season';
import type { Quality, TimeOfDay } from '../render/world';
import type { AssistLevel, MatchMode } from '../sim/types';
import { normalizeDda, type DdaState } from './dda';
import { normalizeKeyMap, normalizePadMap, type KeyMap, type PadMap } from './input';
import type { HapticLevel } from '../platform/haptics';
import { normalizeOnboarding, type OnboardingState } from './onboarding';
import { Rng, hashString } from './rng';
import { isWeather, type WeatherKind } from '../sim/weather';

export type { AssistLevel };

export interface Settings {
  sfx: boolean;
  music: boolean;
  crowd: boolean;
  quality: Quality;
  /**
   * The player chose `quality` himself (Settings > GRAPHICS). Until he does it is always HIGH: an older save
   * still on a build's own default (phones used to start on MEDIUM) moves up to HIGH on load.
   */
  qualityPicked?: boolean;
  difficulty: number;
  halfMinutes: number;
  autoSwitch: boolean;
  timeOfDay: TimeOfDay | 'random';
  weather: WeatherKind | 'random';
  /** Broadcast commentary ticker in matches (default on). Text only: the spoken voice was removed (old saves' commentaryVoice is dropped on load). */
  commentary: boolean;
  /** Match camera distance (default 'normal'; older saves lack it). */
  camZoom?: CamZoom;
  /** Chosen unlockable ball look (progression); undefined = classic. */
  ballSkin?: string;
  /** Chosen goal celebration (progression; see CELEBRATION_IDS); undefined = classic. */
  celebration?: string;
  /** Goal explosion colours for your goals (SHOP; see GOAL_FX_IDS); undefined = your club's colours. */
  goalFx?: string;
  /** Sprint speed-line colour for your side (SHOP; see TRAIL_IDS); undefined = chalk white. */
  trail?: string;
  /** Your club's premium kit (SHOP; see KIT_IDS); undefined = the club's own kit. */
  kit?: string;
  /** Player looks by slot (SHOP; see LOOK_IDS): an empty slot wears nothing extra. Always an object once loaded. */
  looks?: { [k in LookSlot]?: string };
  /** Stadium style by slot for home matches (SHOP; see DECOR_IDS). Always an object once loaded. */
  decor?: { [k in DecorSlot]?: string };
  /** Pass assistance (default ground 'assisted', through 'assisted'), switch move assist and timed finishing (default on). */
  groundAssist?: AssistLevel;
  throughAssist?: AssistLevel;
  moveAssist?: boolean;
  timedFinish?: boolean;
  /** Persistent help beside the controlled player; independent of the first-match tutorial. */
  trainer?: boolean;
  /** Play a ground pass on the press. Turn off for hold-to-power passing. */
  quickPass?: boolean;
  /** AUTO SPRINT (default on): the touch thumbstick pushed all the way sprints, no SPRINT button needed. Touch only. */
  autoSprint?: boolean;
  /**
   * VIBRATION (the app only; platform/haptics.ts): OFF, LIGHT (only the big moments: goals, wins, level ups, rewards) or
   * FULL (the default). Older saves' true / false read as FULL / OFF.
   */
  vibration?: HapticLevel;
  /** The mode Quick Match last kicked off in (default classic; older saves lack it). */
  lastMode?: MatchMode;
  /** Keyboard and gamepad bindings (Settings > Controls > KEYS; core/input.ts reads them). Always whole once loaded. */
  keys?: KeyMap;
  pad?: PadMap;
  /** Touch thumbstick: 'floating' (appears under the thumb, the default) or 'fixed' (anchored bottom-left, base always drawn). */
  stick?: StickMode;
  /** Colour-blind aid: shape cues on rings, markers and the minimap as well as colour (SessionOptions.colorblind). */
  colorblind?: boolean;
  /** Quick subs: a card offers a tired player's change, made at the next stoppage (default on; game/quickSub.ts). */
  quickSubs?: boolean;
  /** Side shows: the commentary cam and the other corner pictures in a match (default on; game/sideShow.ts). */
  sideShows?: boolean;
  /** ROAD TO GLORY's "how it works" panel has been shown once (ui/career.ts; it stays one tap away on the hub). */
  roadIntroSeen?: boolean;
  /** Menu and HUD text size (Settings > TEXT SIZE; ui/textSize.ts). MEDIUM is the designed size; touch controls, pitch and camera never change. */
  textSize?: TextSize;
}

export type TextSize = 'small' | 'medium' | 'large';

export const TEXT_SIZES: readonly TextSize[] = ['small', 'medium', 'large'];

export type StickMode = 'floating' | 'fixed';

export type CamZoom = 'wide' | 'normal' | 'close' | 'cinematic';

export const CAM_ZOOMS: readonly CamZoom[] = ['wide', 'normal', 'close', 'cinematic'];

export const ASSIST_LEVELS: readonly AssistLevel[] = ['assisted', 'semi', 'manual'];

/** The control options a match is given (Settings > Controls); the demo match always plays on these. */
export interface ControlSettings {
  groundAssist: AssistLevel;
  throughAssist: AssistLevel;
  autoSwitch: boolean;
  moveAssist: boolean;
  timedFinish: boolean;
  trainer: boolean;
  quickPass: boolean;
  autoSprint: boolean;
  vibration: HapticLevel;
}

export const CONTROL_DEFAULTS: Readonly<ControlSettings> = {
  groundAssist: 'assisted',
  throughAssist: 'assisted',
  autoSwitch: true,
  moveAssist: true,
  timedFinish: true,
  trainer: true,
  quickPass: true,
  autoSprint: true,
  vibration: 'full',
};

/** The control options in these settings, with the default for anything missing. */
export function controlsOf(s: Settings): ControlSettings {
  return {
    groundAssist: s.groundAssist ?? CONTROL_DEFAULTS.groundAssist,
    throughAssist: s.throughAssist ?? CONTROL_DEFAULTS.throughAssist,
    autoSwitch: s.autoSwitch ?? CONTROL_DEFAULTS.autoSwitch,
    moveAssist: s.moveAssist ?? CONTROL_DEFAULTS.moveAssist,
    timedFinish: s.timedFinish ?? CONTROL_DEFAULTS.timedFinish,
    trainer: s.trainer ?? CONTROL_DEFAULTS.trainer,
    quickPass: s.quickPass ?? CONTROL_DEFAULTS.quickPass,
    autoSprint: s.autoSprint ?? CONTROL_DEFAULTS.autoSprint,
    vibration: s.vibration ?? CONTROL_DEFAULTS.vibration,
  };
}

/**
 * Settings as stored by any build (or hand-edited storage) made whole: missing keys get the defaults, and a
 * value this build doesn't know (a camera distance, an assist level, a non-boolean switch) becomes the default.
 */
export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSave().settings;
  const s: Settings = { ...base, ...(raw && typeof raw === 'object' ? (raw as Partial<Settings>) : {}) };
  for (const k of ['sfx', 'music', 'crowd'] as const) if (typeof s[k] !== 'boolean') s[k] = base[k];
  if (s.quality !== 'high' && s.quality !== 'medium' && s.quality !== 'low') s.quality = base.quality;
  // Graphics start on HIGH everywhere. A save from before the flag that sits on LOW chose it (no build ever
  // started there); MEDIUM was the phones' old default, so it goes up like any quality nobody picked.
  // (The stored flag, not the default spread under it.)
  const picked = raw && typeof raw === 'object' ? (raw as Partial<Settings>).qualityPicked : undefined;
  s.qualityPicked = typeof picked === 'boolean' ? picked : s.quality === 'low';
  if (!s.qualityPicked) s.quality = 'high';
  if (!Number.isInteger(s.difficulty) || s.difficulty < 0 || s.difficulty > 3) s.difficulty = base.difficulty;
  if (typeof s.halfMinutes !== 'number' || !Number.isFinite(s.halfMinutes) || s.halfMinutes < 0.5 || s.halfMinutes > 10) s.halfMinutes = base.halfMinutes;
  if (!['day', 'sunset', 'night', 'random'].includes(s.timeOfDay)) s.timeOfDay = base.timeOfDay;
  if (s.weather !== 'random' && !isWeather(s.weather)) s.weather = base.weather;
  if (!CAM_ZOOMS.includes(s.camZoom as CamZoom)) s.camZoom = 'normal';
  if (s.lastMode !== 'classic' && s.lastMode !== 'blitz') s.lastMode = 'classic';
  // The spoken commentary is gone: an old save's switch for it is dropped.
  delete (s as unknown as { commentaryVoice?: unknown }).commentaryVoice;
  if (typeof s.commentary !== 'boolean') s.commentary = true;
  s.keys = normalizeKeyMap(s.keys);
  s.pad = normalizePadMap(s.pad);
  if (s.stick !== 'floating' && s.stick !== 'fixed') s.stick = 'floating';
  if (typeof s.colorblind !== 'boolean') s.colorblind = false;
  if (typeof s.quickSubs !== 'boolean') s.quickSubs = true;
  if (typeof s.sideShows !== 'boolean') s.sideShows = true;
  if (typeof s.roadIntroSeen !== 'boolean') s.roadIntroSeen = false;
  if (!TEXT_SIZES.includes(s.textSize as TextSize)) s.textSize = 'medium';
  if (s.ballSkin !== undefined && !(BALL_SKIN_IDS as readonly string[]).includes(s.ballSkin)) s.ballSkin = undefined;
  if (s.celebration !== undefined && !(CELEBRATION_IDS as readonly string[]).includes(s.celebration)) s.celebration = undefined;
  if (s.goalFx !== undefined && !(GOAL_FX_IDS as readonly string[]).includes(s.goalFx)) s.goalFx = undefined;
  if (s.trail !== undefined && !(TRAIL_IDS as readonly string[]).includes(s.trail)) s.trail = undefined;
  if (s.kit !== undefined && !(KIT_IDS as readonly string[]).includes(s.kit)) s.kit = undefined;
  s.looks = normalizeLooks(s.looks);
  s.decor = normalizeDecor(s.decor);
  if (!ASSIST_LEVELS.includes(s.groundAssist as AssistLevel)) s.groundAssist = CONTROL_DEFAULTS.groundAssist;
  if (!ASSIST_LEVELS.includes(s.throughAssist as AssistLevel)) s.throughAssist = CONTROL_DEFAULTS.throughAssist;
  for (const k of ['autoSwitch', 'moveAssist', 'timedFinish', 'trainer', 'quickPass', 'autoSprint'] as const) {
    if (typeof s[k] !== 'boolean') s[k] = CONTROL_DEFAULTS[k];
  }
  // (VIBRATION was a switch for a moment: on is FULL, off is OFF.)
  const vib = s.vibration as unknown;
  s.vibration = vib === false ? 'off' : vib === 'off' || vib === 'light' || vib === 'full' ? vib : CONTROL_DEFAULTS.vibration;
  return s;
}

export interface Record {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
}

export interface SaveData {
  version: 1;
  coins: number;
  clubIdx: number;
  opponentIdx: number;
  settings: Settings;
  record: Record;
  /** Opaque career blob owned by meta/career.ts. */
  career: unknown;
  /** Opaque Blocky Cup blob owned by meta/cup.ts (null = no cup in progress). */
  cup: unknown;
  seenTutorial: boolean;
  /** Daily gift: last claim date (YYYY-MM-DD, local) and consecutive-day streak. */
  gift?: { last: string; streak: number };
  /** XP, level, win streak, match stars and the day's challenges (older saves lack it: see normalizeProgress). */
  progress: Progress;
  /**
   * Football Moments: best stars (0..3) by moment id (src/meta/moments.ts). Optional in the type (older saves lack
   * it) but always an object once loaded, so screens can read `save.moments![id]` and write through recordMoment.
   */
  moments?: { [id: string]: number };
  /** LEARN THE BASICS progress and the first-goal unlock (core/onboarding.ts). Always whole once loaded. */
  onboarding?: OnboardingState;
  /** The hidden ease's loss streaks (core/dda.ts). Always whole once loaded. */
  dda?: DdaState;
  /** Club Run, mastery badges and the season track (src/meta/run.ts, mastery.ts, season.ts). */
  run?: RunState;
  mastery?: MasteryState;
  season?: SeasonState;
  /** The coin SHOP (src/meta/shop.ts): what has been bought, seen and the daily free pack. Always whole once loaded. */
  shop?: ShopState;
  /** Real-money purchases and the free-coin ads (src/platform/iap.ts, src/meta/shop.ts). Always whole once loaded. */
  iap?: IapState;
  /** SHOWTIME (game/funLayer.ts): the best style grade and points by mode (see showtimeMode, recordShowtime). */
  showtime?: { [mode: string]: ShowtimeBest };
  /**
   * GEMS, the premium currency (src/meta/gems.ts): the balance, lifetime totals, one-time rewards paid and the
   * Scouting Network tier. Always whole once loaded; a save from before gems starts with the welcome gift.
   */
  gems?: GemState;
  /** Applied referral grants. Stored atomically with both currency balances, including in cloud saves. */
  friendReceipts?: string[];
  /** The reasons to come back (src/meta/loops.ts): weekly objectives, the daily sweep, rewarded-ad caps. Always whole once loaded. */
  loops?: LoopState;
  updatedAt: string;
}

/** What the coin SHOP remembers (src/meta/shop.ts owns the rules; normalizeShop makes any stored copy whole). */
export interface ShopState {
  /** Items bought with coins, as `${category}:${id}` (level unlocks aren't listed here: XP earns those). */
  owned: string[];
  /** Items the shop has already shown (an affordable one not in here is NEW on the menu's SHOP button). */
  seen: string[];
  /** Local day (YYYY-MM-DD) the free daily scout pack was last opened ('' = never). */
  freePack: string;
  /** Packs opened so far: it seeds the next one (the same save always draws the same players). */
  packs: number;
  /**
   * A paid-for pack whose card hasn't been signed or sold yet (the tab closed mid-reveal): enough to draw the same
   * card again (meta/shop.ts pendingCard), so it is never lost. Null when there is none.
   */
  pending: PendingPack | null;
  /** Today's deal (meta/shop.ts dailyDeal): the local day and the item key it picked, fixed for that day. */
  deal: { day: string; key: string } | null;
  /**
   * Scout Tokens: what scout packs cost (meta/shop.ts PACK_TOKENS). Earned only (a daily challenge done is one),
   * never sold, so nothing random is ever bought with money (docs/ECONOMY.md). A new or older save starts with 2.
   */
  tokens: number;
}

export interface PendingPack {
  kind: 'scout' | 'elite';
  seed: number;
  /** The club rating the card was drawn against, and what the pack cost (the resale cap reads it). */
  base: number;
  price: number;
  /** Resale credit on a newly opened scout card. Missing on legacy pending cards, which keep their old value. */
  scoutResale?: number;
}

/** A shop blob as stored by any build (or none) made whole: unknown entries dropped, numbers sane. */
export function normalizeShop(raw: unknown): ShopState {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Partial<ShopState>) : {};
  // (Item ids may carry digits: the Club Pass's pass01 to pass12.)
  const KEY = /^[a-z]+:[a-z0-9]+$/;
  // (Room for the whole catalogue: kits, looks and stadium style took it past 200.)
  const keys = (v: unknown): string[] =>
    Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === 'string' && KEY.test(k)))].slice(0, 800) : [];
  const d = r.deal && typeof r.deal === 'object' ? (r.deal as Partial<NonNullable<ShopState['deal']>>) : null;
  return {
    owned: keys(r.owned),
    seen: keys(r.seen),
    freePack: typeof r.freePack === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.freePack) ? r.freePack : '',
    packs: num(r.packs),
    pending: normalizePending(r.pending),
    deal: d && typeof d.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.day) && typeof d.key === 'string' && KEY.test(d.key) ? { day: d.day, key: d.key } : null,
    tokens: typeof r.tokens === 'number' && Number.isFinite(r.tokens) ? Math.max(0, Math.min(999, Math.floor(r.tokens))) : 2,
  };
}

function normalizePending(raw: unknown): PendingPack | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Partial<PendingPack>;
  if (p.kind !== 'scout' && p.kind !== 'elite') return null;
  if (typeof p.seed !== 'number' || !Number.isFinite(p.seed) || typeof p.base !== 'number' || !Number.isFinite(p.base)) return null;
  return {
    kind: p.kind, seed: p.seed >>> 0, base: Math.max(0, Math.min(99, Math.round(p.base))), price: num(p.price),
    ...(typeof p.scoutResale === 'number' && Number.isFinite(p.scoutResale) && p.scoutResale > 0
      ? { scoutResale: Math.min(250, Math.max(1, Math.floor(p.scoutResale))) } : {}),
  };
}

/**
 * What store purchases and the free-coin ads leave in the save (src/platform/iap.ts owns the rules, meta/shop.ts
 * the free-ad cap; normalizeIap makes any stored copy whole). It travels with the cloud copy, so a purchase
 * follows the account.
 */
export interface IapState {
  /** One-time products owned (non-consumables: the Starter Pack, NO ADS), by store id. A new device restores them. */
  owned: string[];
  /**
   * Transactions already paid out, `${transactionId}|${productId}`, oldest first and capped (IAP_APPLIED_MAX): a
   * store that delivers one transaction twice (a crash before it was finished, a restore) never pays twice.
   */
  applied: string[];
  /** Rewarded ads watched for coins on one local day (YYYY-MM-DD; '' = none yet): the FREE COINS daily cap. */
  freeAds: { day: string; count: number };
  /** Coin packs bought at least once, by store id: the first buy of each pays double (platform/iap.ts). */
  firsts: string[];
  /** The one-time welcome offer (the Starter Pack, after the first win) has been shown. */
  welcome: boolean;
  /** Journey selected when an unfinished Club Pass order was placed; survives delayed store approval. */
  pendingPass?: string;
}

/** How many paid-out transaction ids a save keeps (a store re-delivers within days, never hundreds of purchases later). */
export const IAP_APPLIED_MAX = 200;

/** An IAP blob as stored by any build (or none) made whole: unknown entries dropped, numbers sane. */
export function normalizeIap(raw: unknown): IapState {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Partial<IapState>) : {};
  const strings = (v: unknown, ok: RegExp, max: number): string[] =>
    Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === 'string' && ok.test(k)))].slice(-max) : [];
  const f = r.freeAds && typeof r.freeAds === 'object' ? (r.freeAds as Partial<IapState['freeAds']>) : {};
  const day = typeof f.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.day) ? f.day : '';
  return {
    owned: strings(r.owned, /^[A-Za-z0-9._-]{1,64}$/, 50),
    applied: strings(r.applied, /^[^\0]{1,160}$/, IAP_APPLIED_MAX),
    freeAds: { day, count: day ? Math.min(99, num(f.count)) : 0 },
    firsts: strings(r.firsts, /^[A-Za-z0-9._-]{1,64}$/, 50),
    welcome: r.welcome === true,
    ...(typeof r.pendingPass === 'string' && /^(?:\d{4}-(?:0[1-9]|1[0-2])|journey-(?:0[1-9]|1[0-2]))$/.test(r.pendingPass)
      ? { pendingPass: r.pendingPass } : {}),
  };
}

/** The player's progression (everything here is earned by playing; nothing is bought). */
export interface Progress {
  /** Total XP ever earned. */
  xp: number;
  /** Current win streak (a draw keeps it, a loss ends it) and the best one. */
  streak: number;
  bestStreak: number;
  /** Match stars collected (1–3 a match). */
  stars: number;
  /** Today's three challenges: the local day they are for, progress on each, and which have paid out. */
  daily: DailyState;
}

export interface DailyState {
  day: string;
  progress: [number, number, number];
  claimed: [boolean, boolean, boolean];
  /** True from the day's roll-over until the first match of the day (the card says NEW DAY). */
  fresh: boolean;
}

const KEY = 'blocky-league-save-v1';

/**
 * Every device starts on HIGH (phones included: World keeps it crisp and smooth there, see ResolutionGovernor);
 * a graphics setting the player picked himself always takes precedence (Settings.qualityPicked).
 */
function defaultQuality(): Quality {
  return 'high';
}

export function defaultSave(): SaveData {
  return {
    version: 1,
    coins: 500,
    clubIdx: 5,
    opponentIdx: 6,
    settings: {
      sfx: true, music: true, crowd: true, quality: defaultQuality(), qualityPicked: false, difficulty: 1, halfMinutes: 2, timeOfDay: 'random', weather: 'random',
      commentary: true, camZoom: 'normal', ...CONTROL_DEFAULTS,
      keys: normalizeKeyMap(undefined), pad: normalizePadMap(undefined), stick: 'floating', colorblind: false,
      quickSubs: true, roadIntroSeen: false, textSize: 'medium', looks: {}, decor: {},
    },
    record: { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 },
    career: null,
    cup: null,
    seenTutorial: false,
    progress: defaultProgress(),
    moments: {},
    onboarding: normalizeOnboarding(undefined, null),
    dda: normalizeDda(undefined),
    // Whole from the start (a brand-new player's first session counts toward badges and the season too).
    run: normalizeRun(undefined),
    mastery: normalizeMastery(undefined),
    season: normalizeSeason(undefined),
    shop: normalizeShop(undefined),
    iap: normalizeIap(undefined),
    gems: normalizeGems(undefined),
    friendReceipts: [],
    loops: normalizeLoops(undefined),
    updatedAt: new Date().toISOString(),
  };
}

export function defaultProgress(): Progress {
  return { xp: 0, streak: 0, bestStreak: 0, stars: 0, daily: { day: '', progress: [0, 0, 0], claimed: [false, false, false], fresh: true } };
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(v)) : d);
const clubIndex = (v: unknown, d: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < PRESET_CLUBS.length ? v : d);

/** Progress as stored by any build made whole: missing or damaged fields get the defaults, nothing else is lost. */
export function normalizeProgress(raw: unknown): Progress {
  const base = defaultProgress();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Progress>;
  const d = (r.daily && typeof r.daily === 'object' ? r.daily : {}) as Partial<DailyState>;
  const prog = Array.isArray(d.progress) ? d.progress : [];
  const claimed = Array.isArray(d.claimed) ? d.claimed : [];
  return {
    xp: num(r.xp),
    streak: num(r.streak),
    bestStreak: Math.max(num(r.bestStreak), num(r.streak)),
    stars: num(r.stars),
    daily: {
      day: typeof d.day === 'string' ? d.day : '',
      progress: [num(prog[0]), num(prog[1]), num(prog[2])],
      claimed: [claimed[0] === true, claimed[1] === true, claimed[2] === true],
      fresh: d.fresh !== false,
    },
  };
}

/** A stored save (any build's) made whole over this build's defaults: see loadSave and importSave. */
function mergeSave(raw: unknown): SaveData {
  const base = defaultSave();
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Partial<SaveData> : {};
  // Saves from before the camera / assist settings (or with values this build doesn't know) get the defaults.
  const settings = normalizeSettings(d.settings);
  const record = { ...base.record };
  for (const k of ['played', 'won', 'drawn', 'lost', 'goalsFor', 'goalsAgainst'] as const) record[k] = num(d.record?.[k]);
  const clubIdx = clubIndex(d.clubIdx, base.clubIdx);
  const opponentIdx = clubIndex(d.opponentIdx, clubIdx === base.opponentIdx ? base.clubIdx : base.opponentIdx);
  const gift = d.gift;
  return {
    ...base,
    ...d,
    version: 1,
    coins: num(d.coins, base.coins),
    clubIdx,
    opponentIdx: opponentIdx === clubIdx ? (clubIdx + 1) % PRESET_CLUBS.length : opponentIdx,
    seenTutorial: d.seenTutorial === true,
    settings,
    record,
    career: d.career && typeof d.career === 'object' && !Array.isArray(d.career) ? d.career : null,
    gift: gift && typeof gift === 'object' && typeof gift.last === 'string'
      ? { last: gift.last, streak: Math.max(1, Math.min(7, num(gift.streak, 1))) } : undefined,
    updatedAt: typeof d.updatedAt === 'string' && Number.isFinite(Date.parse(d.updatedAt)) ? d.updatedAt : base.updatedAt,
    // Saves from before the cup existed (or a blob that isn't an object) start with no cup.
    cup: d.cup && typeof d.cup === 'object' && !Array.isArray(d.cup) ? d.cup : null,
    // Saves from before progression start at level 1 with no streak; a damaged blob does too.
    progress: normalizeProgress(d.progress),
    // Saves from before Football Moments (or a damaged blob) have no stars yet.
    moments: normalizeMoments(d.moments),
    // Saves from before the basics campaign: a player with matches behind him has everything open.
    onboarding: normalizeOnboarding(d.onboarding, record),
    dda: normalizeDda(d.dda),
    run: normalizeRun(d.run),
    mastery: normalizeMastery(d.mastery),
    season: normalizeSeason(d.season),
    // Saves from before the shop own nothing bought (their level unlocks stay: those come from XP).
    shop: normalizeShop(d.shop),
    // Saves from before store purchases own nothing and have watched no ads.
    iap: normalizeIap(d.iap),
    // Saves from before gems start with the welcome gift (meta/gems.ts WELCOME_GEMS); the loops start empty.
    gems: normalizeGems(d.gems),
    friendReceipts: normalizeFriendReceipts(d.friendReceipts),
    loops: normalizeLoops(d.loops),
  } as SaveData;
}

// ------------------------------------------------------------------ Football Moments (best stars by id)

/** Moment stars as stored by any build made whole: an object of id -> 0..3 (anything else is dropped). */
export function normalizeMoments(raw: unknown): { [id: string]: number } {
  const out: { [id: string]: number } = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as { [k: string]: unknown })) {
    if (!id || typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[id] = Math.max(0, Math.min(3, Math.floor(v)));
  }
  return out;
}

/** Best stars earned on a moment so far (0 = never completed). */
export function momentStars(d: Pick<SaveData, 'moments'>, id: string): number {
  return d.moments?.[id] ?? 0;
}

/** Keep a moment's result if it beats the best so far. Returns true when the best improved. */
export function recordMoment(d: Pick<SaveData, 'moments'>, id: string, stars: number): boolean {
  const s = Math.max(0, Math.min(3, Math.floor(stars)));
  d.moments ??= {};
  if (s <= (d.moments[id] ?? 0) && id in d.moments) return false;
  d.moments[id] = Math.max(s, d.moments[id] ?? 0);
  return true;
}

/** Total XP entitlement for a moment: 30 for its first try, 25 per best star. */
export function momentXp(stars: number): number {
  return 30 + 25 * Math.max(0, Math.min(3, Math.floor(stars)));
}

/** Bank only a moment's first attempt and new best stars. Existing results are already paid. */
export function claimMomentXp(d: Pick<SaveData, 'moments'>, id: string, stars: number): number {
  if (!id || !Number.isFinite(stars)) return 0;
  const before = d.moments?.[id];
  const best = Math.max(0, Math.min(3, Math.floor(stars)));
  const xp = before === undefined ? momentXp(best) : Math.max(0, momentXp(best) - momentXp(before));
  recordMoment(d, id, best);
  return xp;
}

/** Stars collected over every moment (for the menu tile). */
export function momentStarsTotal(d: Pick<SaveData, 'moments'>): number {
  let n = 0;
  for (const v of Object.values(d.moments ?? {})) n += v;
  return n;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    return mergeSave(JSON.parse(raw) as Partial<SaveData>);
  } catch {
    return defaultSave();
  }
}

/** The save as a file (Settings > Backup > EXPORT): plain JSON, the same shape as the stored one. */
export function exportSave(d: SaveData): string {
  return JSON.stringify(d, null, 2);
}

/**
 * A save read back from an exported file (or a cloud copy): null unless it is recognisably a Blocky League
 * save (version 1 with coins and settings); otherwise made whole like a stored one, with the numbers that
 * index things clamped to sane values. Never throws.
 */
export function importSave(raw: unknown): SaveData | null {
  try {
    const src = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
    if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
    const d = src as Partial<SaveData>;
    if (d.version !== 1 || typeof d.coins !== 'number' || !d.settings || typeof d.settings !== 'object') return null;
    return mergeSave(d);
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData): boolean {
  d.updatedAt = new Date().toISOString();
  const json = JSON.stringify(d);
  let localSaved = false;
  try {
    localStorage.setItem(KEY, json);
    localSaved = true;
  } catch {
    // Private mode / storage full: the game still runs, progress just isn't kept.
  }
  try {
    portalStore?.setItem(KEY, json);
  } catch {
    // The portal's store refused it: the browser's copy still holds it.
  }
  return localSaved;
}

/** A portal's save store (CrazyGames' Data Module, platform/ads.ts portalStore), mirrored on every write once adopted. */
let portalStore: { getItem(key: string): string | null; setItem(key: string, value: string): void } | null = null;

/**
 * The portal's store is up (the game's boot, once its SDK has started): from now on every save is mirrored there.
 * Returns the portal's copy when it is the newer one (the player signed in on another device: the caller swaps it
 * in), else null, and the browser's copy is written there at once.
 */
export function adoptPortalStore(store: NonNullable<typeof portalStore>, local: SaveData): SaveData | null {
  portalStore = store;
  let remote: SaveData | null = null;
  try {
    const raw = store.getItem(KEY);
    remote = raw ? importSave(raw) : null;
  } catch {
    remote = null;
  }
  const newer = remote && (!local.updatedAt || (remote.updatedAt ?? '') > local.updatedAt);
  if (remote && newer) return remote;
  writeSave(local);
  return null;
}

// ------------------------------------------------------------------ progression (pure; see tests/progress.test.ts)

/** XP needed to go from `level` to the next one (100, 160, 240, 340 ... quadratic, so early levels come fast). */
export function xpToNext(level: number): number {
  const l = Math.max(1, level) - 1;
  return 100 + 50 * l + 10 * l * l;
}

export const MAX_LEVEL = 99;

/** Level (1..MAX_LEVEL) reached with `xp` total, and how far into it the player is. */
export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = Math.max(0, Math.floor(xp));
  while (level < MAX_LEVEL && left >= xpToNext(level)) {
    left -= xpToNext(level);
    level++;
  }
  return { level, into: level >= MAX_LEVEL ? xpToNext(level) : left, need: xpToNext(level) };
}

/** Titles by level: the first one at level 1, the last from its level on. */
export const LEVEL_TITLES: readonly { level: number; title: string }[] = [
  // No level title may read like a division (Park, District, Sunday, County, National ...): next to the club's real
  // league on the hub it looked like the club's division was wrong.
  { level: 1, title: 'Rookie' },
  { level: 3, title: 'Local Talent' },
  { level: 5, title: 'Rising Star' },
  { level: 7, title: 'First Teamer' },
  { level: 10, title: 'Fan Favourite' },
  { level: 13, title: 'Club Captain' },
  { level: 16, title: 'Cult Hero' },
  { level: 20, title: 'Star Striker' },
  { level: 25, title: 'Golden Boot' },
  { level: 30, title: 'Blocky Legend' },
];

export function levelTitle(level: number): string {
  let t = LEVEL_TITLES[0].title;
  for (const e of LEVEL_TITLES) if (level >= e.level) t = e.title;
  return t;
}

/** What one match adds up to for the human side (the session's result, counted by main.ts). */
export interface MatchSummary {
  won: boolean;
  drawn: boolean;
  goals: number;
  conceded: number;
  assists: number;
  tacklesWon: number;
  passes: number;
  skills: number;
  /** SKILL GOALs: goals within a few seconds of a skill move that beat a man (sim/skills.ts 'skillGoal'). */
  skillGoals?: number;
  headers: number;
  /** Goals scored from outside the box. */
  longGoals: number;
  powerups: number;
  motm: boolean;
  blitz: boolean;
  /** 0 easy .. 3 legend. */
  difficulty: number;
}

/** A SKILL GOAL's bonus: XP (up to three a match count) and coins (main.ts adds them to the match's reward). */
export const SKILL_GOAL_XP = 20;
export const SKILL_GOAL_COINS = 25;

/** XP for a match: taking part, the result, and every good thing the player did (a clean sheet counts even in a draw). */
export function matchXp(s: MatchSummary): number {
  let xp = 40;
  xp += s.won ? 60 : s.drawn ? 25 : 0;
  xp += s.goals * 15 + s.assists * 10 + Math.min(10, s.tacklesWon) * 4 + Math.min(10, s.skills) * 3;
  xp += Math.min(3, s.skillGoals ?? 0) * SKILL_GOAL_XP;
  if (s.conceded === 0 && !(s.goals === 0 && !s.won && !s.drawn)) xp += 25;
  if (s.motm) xp += 20;
  return Math.round(xp * (1 + 0.15 * Math.max(0, Math.min(3, s.difficulty))));
}

/** Coins multiplier for a win streak: ×1.1 per win in a row, up to ×2. */
export function streakMult(streak: number): number {
  return Math.min(2, Math.round((1 + 0.1 * Math.max(0, streak)) * 100) / 100);
}

/** The streak after this result: a win extends it, a draw keeps it, a loss ends it. */
export function nextStreak(streak: number, won: boolean, drawn: boolean): number {
  return won ? streak + 1 : drawn ? streak : 0;
}

/**
 * Stars for a match, 1–3: everyone gets one for playing; a win makes two; three for a win with two of a
 * comfortable margin, a clean sheet and the man of the match.
 */
export function matchStars(s: Pick<MatchSummary, 'won' | 'goals' | 'conceded' | 'motm'>): 1 | 2 | 3 {
  if (!s.won) return 1;
  const extras = (s.goals - s.conceded >= 2 ? 1 : 0) + (s.conceded === 0 ? 1 : 0) + (s.motm ? 1 : 0);
  return extras >= 2 ? 3 : 2;
}

export type ChallengeKind = 'goals' | 'goalsOne' | 'headers' | 'blitzWins' | 'passes' | 'cleanWins' | 'longGoals' | 'tackles' | 'wins' | 'skills' | 'assists' | 'powerups' | 'motm' | 'hardWins';

export interface Challenge {
  id: string;
  text: string;
  kind: ChallengeKind;
  goal: number;
  coins: number;
}

/** Every daily challenge; three are drawn a day. */
export const CHALLENGE_POOL: readonly Challenge[] = [
  { id: 'goals2', text: 'Score 2 goals', kind: 'goals', goal: 2, coins: 120 },
  { id: 'goals3', text: 'Score a hat-trick in one match', kind: 'goalsOne', goal: 3, coins: 220 },
  { id: 'headers2', text: 'Score 2 headers', kind: 'headers', goal: 2, coins: 180 },
  { id: 'blitzWin', text: 'Win a Blitz match', kind: 'blitzWins', goal: 1, coins: 150 },
  { id: 'passes30', text: 'Complete 30 passes', kind: 'passes', goal: 30, coins: 100 },
  { id: 'cleanWin', text: 'Win without conceding', kind: 'cleanWins', goal: 1, coins: 160 },
  { id: 'longGoal', text: 'Score from outside the box', kind: 'longGoals', goal: 1, coins: 160 },
  { id: 'tackles5', text: 'Win 5 tackles', kind: 'tackles', goal: 5, coins: 100 },
  { id: 'wins2', text: 'Win 2 matches', kind: 'wins', goal: 2, coins: 170 },
  { id: 'skills3', text: 'Pull off 3 skill moves', kind: 'skills', goal: 3, coins: 120 },
  { id: 'assists2', text: 'Set up 2 goals', kind: 'assists', goal: 2, coins: 140 },
  { id: 'powerups3', text: 'Grab 3 power-ups in Blitz', kind: 'powerups', goal: 3, coins: 120 },
  { id: 'motm', text: 'Be Man of the Match', kind: 'motm', goal: 1, coins: 150 },
  { id: 'hardWin', text: 'Win on Hard or Legend', kind: 'hardWins', goal: 1, coins: 220 },
];

/** The three challenges for a local day (YYYY-MM-DD): the same three for everyone, every time that day. */
export function dailyChallenges(day: string): [Challenge, Challenge, Challenge] {
  const rng = new Rng(hashString(`daily:${day}`));
  const pool = [...CHALLENGE_POOL];
  const out: Challenge[] = [];
  while (out.length < 3 && pool.length) {
    const c = pool.splice(rng.int(pool.length), 1)[0];
    // One Blitz challenge a day at most: classic players always have two they can do.
    if ((c.kind === 'blitzWins' || c.kind === 'powerups') && out.some((o) => o.kind === 'blitzWins' || o.kind === 'powerups')) continue;
    out.push(c);
  }
  return out as [Challenge, Challenge, Challenge];
}

/** Today's daily state: rolled over (progress cleared, marked fresh) when the stored one is for another day. */
export function dailyFor(p: Progress, day: string): DailyState {
  // Keep the latest period intact when a clock/timezone moves backwards; only a later day resets rewards.
  if (/^\d{4}-\d{2}-\d{2}$/.test(day) && (!/^\d{4}-\d{2}-\d{2}$/.test(p.daily.day) || p.daily.day < day)) {
    p.daily = { day, progress: [0, 0, 0], claimed: [false, false, false], fresh: true };
  }
  return p.daily;
}

/** What a match counts for towards each kind of challenge. */
export function challengeCounts(s: MatchSummary): { [k in ChallengeKind]: number } {
  return {
    goals: s.goals,
    goalsOne: s.goals,
    headers: s.headers,
    blitzWins: s.blitz && s.won ? 1 : 0,
    passes: s.passes,
    cleanWins: s.won && s.conceded === 0 ? 1 : 0,
    longGoals: s.longGoals,
    tackles: s.tacklesWon,
    wins: s.won ? 1 : 0,
    skills: s.skills,
    assists: s.assists,
    powerups: s.powerups,
    motm: s.motm ? 1 : 0,
    hardWins: s.won && s.difficulty >= 2 ? 1 : 0,
  };
}

/**
 * Add a match to today's challenges. Returns the ones just completed (their coins are the reward) and
 * marks them paid; `goalsOne` is a single-match target (the best match counts), the rest accumulate.
 */
export function advanceDaily(d: DailyState, cs: readonly Challenge[], s: MatchSummary): { index: number; challenge: Challenge }[] {
  const counts = challengeCounts(s);
  const done: { index: number; challenge: Challenge }[] = [];
  d.fresh = false;
  cs.forEach((c, i) => {
    if (i > 2) return;
    const add = counts[c.kind];
    d.progress[i] = Math.min(c.goal, c.kind === 'goalsOne' ? Math.max(d.progress[i], add) : d.progress[i] + add);
    if (d.progress[i] >= c.goal && !d.claimed[i]) {
      d.claimed[i] = true;
      done.push({ index: i, challenge: c });
    }
  });
  return done;
}

// ------------------------------------------------------------------ unlocks (earned only: levels and stars)

/** Ball looks (src/render/characters BALL_SKINS) and the level that earns each; 'classic' is always there. */
// (Saved and owned: never rename or drop one. Listed in ladder order, so the next one to earn comes first.)
export const BALL_SKIN_IDS = ['classic', 'retro', 'blaze', 'ice', 'neon', 'gold', 'beach', 'melon', 'hoops', 'eight', 'moon', 'disco', 'planet', 'diamond'] as const;
export type BallSkinId = (typeof BALL_SKIN_IDS)[number];
export const BALL_SKIN_LEVEL: { readonly [k in BallSkinId]: number } = {
  classic: 1, retro: 2, blaze: 4, ice: 6, neon: 8, gold: 12, beach: 15, melon: 17, hoops: 19, eight: 21, moon: 23, disco: 25, planet: 27, diamond: 30,
};
export const BALL_SKIN_NAMES: { readonly [k in BallSkinId]: string } = {
  classic: 'Classic', retro: 'Retro', blaze: 'Blaze', ice: 'Ice', neon: 'Neon', gold: 'Gold', diamond: 'Diamond',
  beach: 'Beach', melon: 'Melon', hoops: 'Hoops', eight: 'Eight', moon: 'Moon', disco: 'Disco', planet: 'Planet',
};

export function skinUnlocked(id: BallSkinId, level: number): boolean {
  return level >= BALL_SKIN_LEVEL[id];
}

/** Match stars that open LEGEND difficulty (Easy, Normal and Hard are always open). */
export const LEGEND_STARS = 10;
export function legendUnlocked(p: Pick<Progress, 'stars'>): boolean {
  return p.stars >= LEGEND_STARS;
}

/** Total XP at which `level` starts. */
export function xpAt(level: number): number {
  let t = 0;
  for (let l = 1; l < level; l++) t += xpToNext(l);
  return t;
}

export type UnlockKind = 'ball' | 'celebration';

export interface NextUnlock {
  kind: UnlockKind;
  id: BallSkinId | CelebrationId;
  /** "Retro ball", "Knee slide celebration". */
  name: string;
  level: number;
  xpLeft: number;
}

/** Everything on the level ladder (ball looks and celebrations), by the level that earns it. */
export function unlockLadder(): NextUnlock[] {
  const balls: NextUnlock[] = BALL_SKIN_IDS.map((id) => ({ kind: 'ball', id, name: `${BALL_SKIN_NAMES[id]} ball`, level: BALL_SKIN_LEVEL[id], xpLeft: 0 }));
  const celebs: NextUnlock[] = CELEBRATION_IDS.map((id) => ({
    kind: 'celebration', id, name: `${CELEBRATION_NAMES[id]} celebration`, level: CELEBRATION_LEVEL[id], xpLeft: 0,
  }));
  // Same level: the ball first (it is the one seen every match).
  return [...balls, ...celebs].sort((a, b) => a.level - b.level || (a.kind === b.kind ? 0 : a.kind === 'ball' ? -1 : 1));
}

/**
 * The next thing XP earns, ball look or celebration, whichever comes at the lower level (the earliest next
 * level wins), and the XP still needed; null once the whole ladder is climbed. `owned` (ShopState.owned) skips
 * anything already bought in the SHOP: the level would bring nothing new.
 */
export function nextUnlock(xp: number, owned?: readonly string[]): NextUnlock | null {
  const lv = levelOf(xp).level;
  const next = unlockLadder().find((u) => u.level > lv && !owned?.includes(`${u.kind}:${u.id}`));
  return next ? { ...next, xpLeft: Math.max(0, xpAt(next.level) - xp) } : null;
}

/**
 * Goal celebrations (src/render/characters + game/matchSession choreograph them) and the level that earns each;
 * 'classic' (arms up, mobbed by team-mates) is always there.
 */
export const CELEBRATION_IDS = ['classic', 'knee', 'shush', 'plane', 'robot', 'backflip', 'pile'] as const;
export type CelebrationId = (typeof CELEBRATION_IDS)[number];
export const CELEBRATION_LEVEL: { readonly [k in CelebrationId]: number } = { classic: 1, knee: 3, shush: 5, plane: 7, robot: 9, backflip: 11, pile: 14 };
export const CELEBRATION_NAMES: { readonly [k in CelebrationId]: string } = {
  classic: 'Classic', knee: 'Knee slide', shush: 'Shush', plane: 'Aeroplane', robot: 'Robot', backflip: 'Backflip', pile: 'Pile-on',
};
export function celebrationUnlocked(id: CelebrationId, level: number): boolean {
  return level >= CELEBRATION_LEVEL[id];
}

/**
 * SHOP cosmetics with no level ladder (coins only; src/meta/shop.ts prices them, render/cosmetics.ts colours
 * them): goal explosion themes ('club' = your kit's colours, always yours) and sprint trails ('white' always yours).
 */
/**
 * Club Pass looks: one goal explosion and one sprint trail per season theme (meta/season.ts SEASON_THEMES, January
 * first), earned on that month's pass track only, never sold for coins (meta/shop.ts `pass`).
 */
export const PASS_IDS = ['pass01', 'pass02', 'pass03', 'pass04', 'pass05', 'pass06', 'pass07', 'pass08', 'pass09', 'pass10', 'pass11', 'pass12'] as const;
export type PassId = (typeof PASS_IDS)[number];
// (Saved and owned: never rename or drop one; new ones go before the pass ids. The shop sorts them by price.)
export const GOAL_FX_IDS = [
  'club', 'gold', 'fire', 'ice', 'neon', 'rainbow', 'galaxy', 'diamond', 'supernova',
  'shockwave', 'balloons', 'confetti', 'popcorn', 'pinata', 'fireworks', 'volcano', 'lightning', 'meteor', ...PASS_IDS,
] as const;
export type GoalFxId = (typeof GOAL_FX_IDS)[number];
export const TRAIL_IDS = ['white', 'fire', 'ice', 'lime', 'pink', 'gold', 'rainbow', 'lightning', 'comet', 'toon', 'hearts', 'popcorn', 'notes', 'glitch', ...PASS_IDS] as const;
export type TrailId = (typeof TRAIL_IDS)[number];

// ------------------------------------------------------------------ cosmetics 2.0: kits, player looks, stadium style

/**
 * PREMIUM KITS (meta/shop.ts sells them, render/kitDesigns.ts paints them): your club plays in one in every match
 * you play (career and Quick Match; never online, where both screens must show the same strips). 'club' is your
 * club's own kit, always yours. Saved and owned: never rename or drop one; new ones go before the pass ids.
 */
export const KIT_IDS = [
  'club', 'zigzag', 'checker', 'camo', 'tiger', 'fade', 'retro', 'crest', 'inferno', 'bolt', 'iceking', 'holo', 'galaxy',
  'pinstripe', 'neonglow', 'goldfoil', ...PASS_IDS,
] as const;
export type KitId = (typeof KIT_IDS)[number];

/**
 * PLAYER LOOKS: one per slot, worn by your club in every match you play. Hair, headgear and the armband go on your
 * CAPTAIN (your best outfield player) and the headgear also on the man you control; boots on the whole team,
 * gloves on your keepers, shades on everyone in a goal celebration (render/looks.ts builds them).
 */
export const LOOK_SLOTS = ['hair', 'head', 'arm', 'boots', 'gloves', 'shades'] as const;
export type LookSlot = (typeof LOOK_SLOTS)[number];
/** Saved and owned: never rename or drop one; new ones go before the pass ids. */
export const LOOK_IDS = [
  'bun', 'tips', 'mohawk', 'afro', 'spikes', 'flamehair',
  'headband', 'sweatband', 'halo', 'icecrown', 'crown',
  'armband', 'armrainbow', 'armgold',
  'bootneon', 'bootgold', 'bootlight',
  'glovepro', 'glovefire', 'glovegold',
  'shades', 'shadestar', 'shadegold',
  ...PASS_IDS,
] as const;
export type LookId = (typeof LOOK_IDS)[number];
/** The month's Club Pass look goes in this slot (January first: a bobble hat, mud stompers, a flower crown...). */
export const PASS_LOOK_SLOT: readonly LookSlot[] = ['head', 'boots', 'head', 'shades', 'arm', 'shades', 'head', 'gloves', 'hair', 'boots', 'gloves', 'head'];
export const LOOK_SLOT_OF: { readonly [k in LookId]: LookSlot } = {
  bun: 'hair', tips: 'hair', mohawk: 'hair', afro: 'hair', spikes: 'hair', flamehair: 'hair',
  headband: 'head', sweatband: 'head', halo: 'head', icecrown: 'head', crown: 'head',
  armband: 'arm', armrainbow: 'arm', armgold: 'arm',
  bootneon: 'boots', bootgold: 'boots', bootlight: 'boots',
  glovepro: 'gloves', glovefire: 'gloves', glovegold: 'gloves',
  shades: 'shades', shadestar: 'shades', shadegold: 'shades',
  ...(Object.fromEntries(PASS_IDS.map((id, m) => [id, PASS_LOOK_SLOT[m]])) as { [k in PassId]: LookSlot }),
};

/**
 * STADIUM STYLE: decorative layers on your ground in every HOME match (render/stadiumStyle.ts), one per slot. Never
 * structural (the career's stadium levels own the stands) and never anything that changes play.
 */
export const DECOR_SLOTS = ['pitch', 'net', 'flags', 'seats', 'tifo', 'kickoff', 'lights', 'mascot'] as const;
export type DecorSlot = (typeof DECOR_SLOTS)[number];
/** Saved and owned: never rename or drop one. */
/** Signature Club Pass stadium pieces share the month's permanent identity, separate from ordinary coin decor. */
export type PassDecorId = `net${PassId}` | `kick${PassId}`;
export const PASS_NET_IDS = PASS_IDS.map((id) => `net${id}` as const);
export const PASS_ENTRY_IDS = PASS_IDS.map((id) => `kick${id}` as const);
export const DECOR_IDS = [
  'mowchecks', 'mowdiag', 'mowcircle', 'mowcrest',
  'netclub', 'nethex', 'netrainbow', 'netglow',
  'flagclub', 'flagcheck', 'flagfire',
  'seatname',
  'tifoflags', 'tifobig',
  'kickconfetti', 'kickfire', 'kickpyro',
  'lightclub', 'lightshow',
  'mascotbear', 'mascotrobot', 'mascotdragon',
  ...PASS_NET_IDS, ...PASS_ENTRY_IDS,
] as const;
export type DecorId = (typeof DECOR_IDS)[number];
export const DECOR_SLOT_OF: { readonly [k in DecorId]: DecorSlot } = {
  mowchecks: 'pitch', mowdiag: 'pitch', mowcircle: 'pitch', mowcrest: 'pitch',
  netclub: 'net', nethex: 'net', netrainbow: 'net', netglow: 'net',
  flagclub: 'flags', flagcheck: 'flags', flagfire: 'flags',
  seatname: 'seats',
  tifoflags: 'tifo', tifobig: 'tifo',
  kickconfetti: 'kickoff', kickfire: 'kickoff', kickpyro: 'kickoff',
  lightclub: 'lights', lightshow: 'lights',
  mascotbear: 'mascot', mascotrobot: 'mascot', mascotdragon: 'mascot',
  ...(Object.fromEntries(PASS_NET_IDS.map((id) => [id, 'net'])) as { [id in `net${PassId}`]: 'net' }),
  ...(Object.fromEntries(PASS_ENTRY_IDS.map((id) => [id, 'kickoff'])) as { [id in `kick${PassId}`]: 'kickoff' }),
};

/** A slot map as stored by any build made whole: only known ids, each in its own slot. */
function normalizeSlots<S extends string>(raw: unknown, slots: readonly S[], slotOf: { readonly [id: string]: S }): { [k in S]?: string } {
  const out: { [k in S]?: string } = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const s of slots) {
    const v = (raw as { [k: string]: unknown })[s];
    if (typeof v === 'string' && slotOf[v] === s) out[s] = v;
  }
  return out;
}

export function normalizeLooks(raw: unknown): { [k in LookSlot]?: string } {
  return normalizeSlots(raw, LOOK_SLOTS, LOOK_SLOT_OF);
}

export function normalizeDecor(raw: unknown): { [k in DecorSlot]?: string } {
  return normalizeSlots(raw, DECOR_SLOTS, DECOR_SLOT_OF);
}

// ------------------------------------------------------------------ SHOWTIME bests (game/funLayer.ts grades a match)

export type ShowtimeGrade = 'S' | 'A' | 'B' | 'C';
export interface ShowtimeBest {
  grade: ShowtimeGrade;
  score: number;
}
/** The modes a best is kept for: Quick Match (and PLAY NOW), Blitz, Road to Glory (and its cup ties), Club Run. */
export type ShowtimeMode = 'quick' | 'blitz' | 'career' | 'run';
const SHOWTIME_RANK: { readonly [g in ShowtimeGrade]: number } = { C: 0, B: 1, A: 2, S: 3 };

export function showtimeMode(kind: string | undefined, blitz: boolean): ShowtimeMode {
  if (kind === 'career' || kind === 'cup') return 'career';
  if (kind === 'run') return 'run';
  return blitz ? 'blitz' : 'quick';
}

/** The stored best for a mode (null: none yet, or a damaged entry). */
export function showtimeBest(d: Pick<SaveData, 'showtime'>, mode: ShowtimeMode): ShowtimeBest | null {
  const b = d.showtime?.[mode];
  if (!b || typeof b !== 'object' || !(b.grade in SHOWTIME_RANK) || typeof b.score !== 'number' || !Number.isFinite(b.score)) return null;
  return { grade: b.grade, score: Math.max(0, Math.floor(b.score)) };
}

/**
 * A match's grade and points into the mode's best (the better grade wins; a level grade, the more points): the best
 * before it, and whether this one beat it.
 */
export function recordShowtime(d: Pick<SaveData, 'showtime'>, mode: ShowtimeMode, grade: ShowtimeGrade, score: number): { before: ShowtimeBest | null; best: ShowtimeBest; newBest: boolean } {
  const before = showtimeBest(d, mode);
  const now: ShowtimeBest = { grade, score: Math.max(0, Math.floor(score)) };
  const better = !before || SHOWTIME_RANK[grade] > SHOWTIME_RANK[before.grade] || (grade === before.grade && now.score > before.score);
  if (better) {
    const all = d.showtime && typeof d.showtime === 'object' && !Array.isArray(d.showtime) ? d.showtime : {};
    d.showtime = { ...all, [mode]: now };
  }
  return { before, best: better ? now : before!, newBest: better };
}
