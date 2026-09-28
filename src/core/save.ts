import { normalizeMastery, type MasteryState } from '../meta/mastery';
import { normalizeRun, type RunState } from '../meta/run';
import { normalizeSeason, type SeasonState } from '../meta/season';
import type { Quality, TimeOfDay } from '../render/world';
import type { AssistLevel, MatchMode } from '../sim/types';
import { normalizeDda, type DdaState } from './dda';
import { normalizeKeyMap, normalizePadMap, type KeyMap, type PadMap } from './input';
import { normalizeOnboarding, type OnboardingState } from './onboarding';
import { Rng, hashString } from './rng';

export type { AssistLevel };

export interface Settings {
  sfx: boolean;
  music: boolean;
  crowd: boolean;
  quality: Quality;
  difficulty: number;
  halfMinutes: number;
  autoSwitch: boolean;
  timeOfDay: TimeOfDay | 'random';
  weather: 'clear' | 'rain' | 'snow' | 'random';
  /** Broadcast commentary ticker in matches (default on). Text only: the spoken voice was removed (old saves' commentaryVoice is dropped on load). */
  commentary: boolean;
  /** Match camera distance (default 'normal'; older saves lack it). */
  camZoom?: CamZoom;
  /** Chosen unlockable ball look (progression); undefined = classic. */
  ballSkin?: string;
  /** Chosen goal celebration (progression; see CELEBRATION_IDS); undefined = classic. */
  celebration?: string;
  /** Pass assistance (default ground 'assisted', through 'assisted'), switch move assist and timed finishing (default on). */
  groundAssist?: AssistLevel;
  throughAssist?: AssistLevel;
  moveAssist?: boolean;
  timedFinish?: boolean;
  /** Persistent help beside the controlled player; independent of the first-match tutorial. */
  trainer?: boolean;
  /** Play a ground pass on the press. Turn off for hold-to-power passing. */
  quickPass?: boolean;
  /** The mode Quick Match last kicked off in (default classic; older saves lack it). */
  lastMode?: MatchMode;
  /** Keyboard and gamepad bindings (Settings > Controls > KEYS; core/input.ts reads them). Always whole once loaded. */
  keys?: KeyMap;
  pad?: PadMap;
  /** Touch thumbstick: 'floating' (appears under the thumb, the default) or 'fixed' (anchored bottom-left, base always drawn). */
  stick?: StickMode;
  /** Colour-blind aid: shape cues on rings, markers and the minimap as well as colour (SessionOptions.colorblind). */
  colorblind?: boolean;
}

export type StickMode = 'floating' | 'fixed';

export type CamZoom = 'wide' | 'normal' | 'close';

export const CAM_ZOOMS: readonly CamZoom[] = ['wide', 'normal', 'close'];

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
}

export const CONTROL_DEFAULTS: Readonly<ControlSettings> = {
  groundAssist: 'assisted',
  throughAssist: 'assisted',
  autoSwitch: true,
  moveAssist: true,
  timedFinish: true,
  trainer: true,
  quickPass: true,
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
  };
}

/**
 * Settings as stored by any build (or hand-edited storage) made whole: missing keys get the defaults, and a
 * value this build doesn't know (a camera distance, an assist level, a non-boolean switch) becomes the default.
 */
export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSave().settings;
  const s: Settings = { ...base, ...(raw && typeof raw === 'object' ? (raw as Partial<Settings>) : {}) };
  if (!CAM_ZOOMS.includes(s.camZoom as CamZoom)) s.camZoom = 'normal';
  if (s.lastMode !== 'classic' && s.lastMode !== 'blitz') s.lastMode = 'classic';
  // The spoken commentary is gone: an old save's switch for it is dropped.
  delete (s as unknown as { commentaryVoice?: unknown }).commentaryVoice;
  if (typeof s.commentary !== 'boolean') s.commentary = true;
  s.keys = normalizeKeyMap(s.keys);
  s.pad = normalizePadMap(s.pad);
  if (s.stick !== 'floating' && s.stick !== 'fixed') s.stick = 'floating';
  if (typeof s.colorblind !== 'boolean') s.colorblind = false;
  if (s.ballSkin !== undefined && !(BALL_SKIN_IDS as readonly string[]).includes(s.ballSkin)) s.ballSkin = undefined;
  if (s.celebration !== undefined && !(CELEBRATION_IDS as readonly string[]).includes(s.celebration)) s.celebration = undefined;
  if (!ASSIST_LEVELS.includes(s.groundAssist as AssistLevel)) s.groundAssist = CONTROL_DEFAULTS.groundAssist;
  if (!ASSIST_LEVELS.includes(s.throughAssist as AssistLevel)) s.throughAssist = CONTROL_DEFAULTS.throughAssist;
  for (const k of ['autoSwitch', 'moveAssist', 'timedFinish', 'trainer', 'quickPass'] as const) {
    if (typeof s[k] !== 'boolean') s[k] = CONTROL_DEFAULTS[k];
  }
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
  updatedAt: string;
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

export function defaultSave(): SaveData {
  return {
    version: 1,
    coins: 500,
    clubIdx: 5,
    opponentIdx: 6,
    settings: {
      sfx: true, music: true, crowd: true, quality: 'high', difficulty: 1, halfMinutes: 2, timeOfDay: 'random', weather: 'random',
      commentary: true, camZoom: 'normal', ...CONTROL_DEFAULTS,
      keys: normalizeKeyMap(undefined), pad: normalizePadMap(undefined), stick: 'floating', colorblind: false,
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
    updatedAt: new Date().toISOString(),
  };
}

export function defaultProgress(): Progress {
  return { xp: 0, streak: 0, bestStreak: 0, stars: 0, daily: { day: '', progress: [0, 0, 0], claimed: [false, false, false], fresh: true } };
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);

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
function mergeSave(d: Partial<SaveData>): SaveData {
  const base = defaultSave();
  // Saves from before the camera / assist settings (or with values this build doesn't know) get the defaults.
  const settings = normalizeSettings(d.settings);
  return {
    ...base,
    ...d,
    settings,
    record: { ...base.record, ...(d.record ?? {}) },
    // Saves from before the cup existed (or a blob that isn't an object) start with no cup.
    cup: typeof d.cup === 'object' ? d.cup : null,
    // Saves from before progression start at level 1 with no streak; a damaged blob does too.
    progress: normalizeProgress(d.progress),
    // Saves from before Football Moments (or a damaged blob) have no stars yet.
    moments: normalizeMoments(d.moments),
    // Saves from before the basics campaign: a player with matches behind him has everything open.
    onboarding: normalizeOnboarding(d.onboarding, d.record),
    dda: normalizeDda(d.dda),
    run: normalizeRun(d.run),
    mastery: normalizeMastery(d.mastery),
    season: normalizeSeason(d.season),
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

/** XP for one attempt at a moment: 30 for the try, 25 a star (no coins: moments pay in XP only). */
export function momentXp(stars: number): number {
  return 30 + 25 * Math.max(0, Math.min(3, Math.floor(stars)));
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
    const base = defaultSave();
    const s = mergeSave(d);
    s.coins = num(d.coins, base.coins);
    s.clubIdx = num(d.clubIdx, base.clubIdx);
    s.opponentIdx = num(d.opponentIdx, base.opponentIdx);
    s.seenTutorial = d.seenTutorial === true;
    s.career = d.career && typeof d.career === 'object' ? d.career : null;
    const r = s.record;
    for (const k of ['played', 'won', 'drawn', 'lost', 'goalsFor', 'goalsAgainst'] as const) r[k] = num(r[k]);
    const g = d.gift;
    s.gift = g && typeof g === 'object' && typeof g.last === 'string' ? { last: g.last, streak: num(g.streak, 1) } : undefined;
    s.moments = normalizeMoments(d.moments);
    s.updatedAt = typeof d.updatedAt === 'string' ? d.updatedAt : new Date().toISOString();
    return s;
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData): void {
  d.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Private mode / storage full: the game still runs, progress just isn't kept.
  }
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
  { level: 1, title: 'Sunday Leaguer' },
  { level: 3, title: 'Park Player' },
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
  headers: number;
  /** Goals scored from outside the box. */
  longGoals: number;
  powerups: number;
  motm: boolean;
  blitz: boolean;
  /** 0 easy .. 3 legend. */
  difficulty: number;
}

/** XP for a match: taking part, the result, and every good thing the player did (a clean sheet counts even in a draw). */
export function matchXp(s: MatchSummary): number {
  let xp = 40;
  xp += s.won ? 60 : s.drawn ? 25 : 0;
  xp += s.goals * 15 + s.assists * 10 + Math.min(10, s.tacklesWon) * 4 + Math.min(10, s.skills) * 3;
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
  if (p.daily.day !== day) p.daily = { day, progress: [0, 0, 0], claimed: [false, false, false], fresh: true };
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
export const BALL_SKIN_IDS = ['classic', 'retro', 'blaze', 'ice', 'neon', 'gold'] as const;
export type BallSkinId = (typeof BALL_SKIN_IDS)[number];
export const BALL_SKIN_LEVEL: { readonly [k in BallSkinId]: number } = { classic: 1, retro: 2, blaze: 4, ice: 6, neon: 8, gold: 12 };
export const BALL_SKIN_NAMES: { readonly [k in BallSkinId]: string } = { classic: 'Classic', retro: 'Retro', blaze: 'Blaze', ice: 'Ice', neon: 'Neon', gold: 'Gold' };

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
 * level wins), and the XP still needed; null once the whole ladder is climbed.
 */
export function nextUnlock(xp: number): NextUnlock | null {
  const lv = levelOf(xp).level;
  const next = unlockLadder().find((u) => u.level > lv);
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
