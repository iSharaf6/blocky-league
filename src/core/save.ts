import type { Quality, TimeOfDay } from '../render/world';
import type { AssistLevel } from '../sim/types';

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
  /** Broadcast commentary ticker in matches (default on). */
  commentary: boolean;
  /** Spoken commentary through the browser's speech synthesis (default off). */
  commentaryVoice: boolean;
  /** Match camera distance (default 'normal'; older saves lack it). */
  camZoom?: CamZoom;
  /** Pass assistance (default ground 'assisted', through 'assisted'), switch move assist and timed finishing (default on). */
  groundAssist?: AssistLevel;
  throughAssist?: AssistLevel;
  moveAssist?: boolean;
  timedFinish?: boolean;
}

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
}

export const CONTROL_DEFAULTS: Readonly<ControlSettings> = {
  groundAssist: 'assisted',
  throughAssist: 'assisted',
  autoSwitch: true,
  moveAssist: true,
  timedFinish: true,
};

/** The control options in these settings, with the default for anything missing. */
export function controlsOf(s: Settings): ControlSettings {
  return {
    groundAssist: s.groundAssist ?? CONTROL_DEFAULTS.groundAssist,
    throughAssist: s.throughAssist ?? CONTROL_DEFAULTS.throughAssist,
    autoSwitch: s.autoSwitch ?? CONTROL_DEFAULTS.autoSwitch,
    moveAssist: s.moveAssist ?? CONTROL_DEFAULTS.moveAssist,
    timedFinish: s.timedFinish ?? CONTROL_DEFAULTS.timedFinish,
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
  if (!ASSIST_LEVELS.includes(s.groundAssist as AssistLevel)) s.groundAssist = CONTROL_DEFAULTS.groundAssist;
  if (!ASSIST_LEVELS.includes(s.throughAssist as AssistLevel)) s.throughAssist = CONTROL_DEFAULTS.throughAssist;
  for (const k of ['autoSwitch', 'moveAssist', 'timedFinish'] as const) {
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
  updatedAt: string;
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
      commentary: true, commentaryVoice: false, camZoom: 'normal', ...CONTROL_DEFAULTS,
    },
    record: { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 },
    career: null,
    cup: null,
    seenTutorial: false,
    updatedAt: new Date().toISOString(),
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const d = JSON.parse(raw) as Partial<SaveData>;
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
    } as SaveData;
  } catch {
    return defaultSave();
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
