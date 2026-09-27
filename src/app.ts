import type { SaveData } from './core/save';
import type { MatchResult } from './game/matchSession';
import type { TimeOfDay } from './render/world';
import type { Kit, MatchMode, ScenarioSpec, Side, TeamDef } from './sim/types';
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
  /** Home stadium size 0 (park pitch) .. 5 (full bowl); omitted = 5. */
  stadiumLevel?: number;
  /** Weather; omitted = the player's setting. */
  weather?: 'clear' | 'rain' | 'snow';
  /** Cup tie: level at full time goes to a penalty shootout. */
  knockout?: boolean;
  /** 'classic' (default) or 'blitz' power-up mode. */
  mode?: MatchMode;
  /**
   * The player's very first match (PLAY NOW on a fresh save): the kick-off waits for a button, the AI eases off in
   * the first minute and the trainer's first two cards teach MOVE and PASS (src/ui/trainer.ts). Passed through to
   * SessionOptions / MatchConfig.
   */
  firstMatch?: boolean;
  /**
   * A Football Moment (src/meta/moments.ts) to run instead of a full match. The result then carries
   * `scenarioOutcome`; the full-time screen shows MOMENT COMPLETE / FAILED with RETRY (this request again, intro
   * skipped), NEXT MOMENT (`nextLabel` + `onDone`) and MENU; no coins, XP only (30 + 25 a star), and the best stars
   * are kept in `save.moments[scenario.id]`.
   */
  scenario?: ScenarioSpec;
  /** Compute the coins for this result (called once at full time). */
  reward: (r: MatchResult) => Reward;
  /** Label for the full-time continue button. */
  nextLabel?: string;
  /** Offer REMATCH on the full-time screen (quick matches): the same request again, intro skipped. */
  rematch?: boolean;
  /** Straight to the kick-off, no fly-in title (a rematch). */
  skipIntro?: boolean;
  /** Called after the player leaves the full-time screen (not called if they quit mid-match). */
  onDone: (r: MatchResult, coinsEarned: number) => void;
  /** Called if the player quits mid-match. */
  onQuit?: () => void;
  /** What quitting costs, shown on the quit confirmation (default: the match doesn't count, no coins). */
  quitNote?: string;
}

/** Shared services the menus and meta screens use. */
export interface AppContext {
  save: SaveData;
  menus: Menus;
  persist: () => void;
  startMatch: (req: MatchRequest) => void;
  mainMenu: () => void;
}
