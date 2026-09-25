import type { SaveData } from './core/save';
import type { MatchResult } from './game/matchSession';
import type { TimeOfDay } from './render/world';
import type { Kit, Side, TeamDef } from './sim/types';
import type { Menus } from './ui/menus';

/** What a result screen shows for coins earned. */
export interface Reward {
  coins: number;
  label: string;
}

export interface MatchRequest {
  home: TeamDef;
  away: TeamDef;
  /** Kits actually worn (clash already resolved). */
  kits: [Kit, Kit];
  humanSide: Side;
  /** Index into DIFFICULTIES (0 easy .. 3 legend). */
  difficulty: number;
  halfMinutes: number;
  /** 0..1 crowd size. */
  attendance: number;
  /** Lighting; omitted = the player's setting (random by default). */
  timeOfDay?: TimeOfDay;
  /** Compute the coins for this result (called once at full time). */
  reward: (r: MatchResult) => Reward;
  /** Label for the full-time continue button. */
  nextLabel?: string;
  /** Called after the player leaves the full-time screen (not called if they quit mid-match). */
  onDone: (r: MatchResult, coinsEarned: number) => void;
  /** Called if the player quits mid-match. */
  onQuit?: () => void;
}

/** Shared services the menus and meta screens use. */
export interface AppContext {
  save: SaveData;
  menus: Menus;
  persist: () => void;
  startMatch: (req: MatchRequest) => void;
  mainMenu: () => void;
}
