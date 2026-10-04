import type { SaveData } from './core/save';
import type { MatchResult } from './game/matchSession';
import type { StadiumParts } from './render/stadium';
import type { TimeOfDay } from './render/world';
import type { Kit, MatchMode, PowerUpKind, ScenarioSpec, Side, TeamDef } from './sim/types';
import type { Menus } from './ui/menus';

/** What a result screen shows for coins earned. */
export interface Reward {
  coins: number;
  label: string;
}

/**
 * Which part of the game a match belongs to. main.ts keys the hidden ease (core/dda.ts), the ad breaks and the
 * onboarding off it; omitted = a friendly (no loss-streak tracking).
 */
export type MatchKind = 'quick' | 'playnow' | 'career' | 'cup' | 'run' | 'moment' | 'basics';

export interface MatchRequest {
  /** What this match is (see MatchKind). */
  kind?: MatchKind;
  /**
   * The hidden ease for this match (MatchConfig.assist, 0..1): the AI presses, tackles and finishes a little
   * softer against the human. Omitted = main.ts decides from the save (core/dda.ts: the first two matches, loss
   * streaks). A request that sets it (a Club Run perk, say) wins over that.
   */
  assist?: number;
  /** Club Run perks (passed through to MatchConfig): a starting score, a keeper boost per side, a golden first goal, a power-up held at kick-off. */
  startScore?: [number, number];
  keeperBoost?: [number, number];
  goldenFirst?: Side;
  startPower?: [PowerUpKind | null, PowerUpKind | null];
  /** Per-side AI difficulty in sim units (MatchConfig.sideDifficulty: the Club Run's SOFT DRAW perk), overriding `difficulty` for that side. */
  sideDifficulty?: [number, number];
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
  /** ROAD TO GLORY home matches: your ground as built, part by part (meta/ground.ts); overrides the level's look. */
  ground?: StadiumParts;
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
  /**
   * LEARN THE BASICS (kind 'basics', with a `scenario` from meta/moments.ts BASICS): which step (0..2). main.ts
   * runs these without the result screen: a miss restarts the step at once, a goal goes straight to the next.
   */
  basicsStep?: number;
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
