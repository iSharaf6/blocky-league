import type { Quality, TimeOfDay } from '../render/world';

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
    settings: { sfx: true, music: true, crowd: true, quality: 'high', difficulty: 1, halfMinutes: 2, autoSwitch: true, timeOfDay: 'random', weather: 'random' },
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
    return {
      ...base,
      ...d,
      settings: { ...base.settings, ...(d.settings ?? {}) },
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
