export type Side = 0 | 1;
export type Role = 'GK' | 'DF' | 'MF' | 'FW';
export type KitPattern = 'plain' | 'stripes' | 'hoops' | 'halves' | 'sash' | 'sleeves';
export type FormationId = '4-4-2' | '4-3-3' | '4-2-3-1' | '3-5-2' | '5-3-2';

export interface PlayerStats {
  pace: number; // 1..99
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  keeping: number;
  stamina: number;
}

export interface Look {
  skin: number; // index into palette.SKIN
  hair: number; // hair style index
  hairColor: number; // index into palette.HAIR
  beard: number; // 0 none
  boots: number; // hex colour
}

export interface PlayerDef {
  id: string;
  name: string;
  number: number;
  role: Role;
  stats: PlayerStats;
  look: Look;
}

export interface Kit {
  shirt: number;
  shirt2: number;
  pattern: KitPattern;
  shorts: number;
  socks: number;
  gk: number;
}

export interface TeamDef {
  id: string;
  name: string;
  short: string;
  kit: Kit;
  formation: FormationId;
  /** Starting XI in formation slot order (slot 0 is the keeper). */
  players: PlayerDef[];
  /** Substitutes available on the bench. */
  bench?: PlayerDef[];
  /** How the AI plays this club (line height, press, width, tempo); undefined = 'balanced'. */
  style?: TeamStyle;
}

/** A club's playing style for the AI: distinct opponents (a high press, a low block, patient possession, fast counters). */
export type TeamStyle = 'balanced' | 'high-press' | 'park-bus' | 'possession' | 'counter';

export function overall(p: PlayerDef): number {
  const s = p.stats;
  switch (p.role) {
    case 'GK':
      return Math.round(s.keeping * 0.75 + s.pace * 0.05 + s.passing * 0.1 + s.defending * 0.1);
    case 'DF':
      return Math.round(s.defending * 0.45 + s.pace * 0.2 + s.passing * 0.15 + s.stamina * 0.1 + s.dribbling * 0.1);
    case 'MF':
      return Math.round(s.passing * 0.35 + s.dribbling * 0.2 + s.stamina * 0.15 + s.shooting * 0.1 + s.defending * 0.1 + s.pace * 0.1);
    case 'FW':
      return Math.round(s.shooting * 0.4 + s.pace * 0.25 + s.dribbling * 0.2 + s.passing * 0.1 + s.stamina * 0.05);
  }
}

export function teamRating(t: TeamDef): number {
  let sum = 0;
  for (const p of t.players) sum += overall(p);
  return Math.round(sum / t.players.length);
}

/** Human pass assistance (FIFA-style): the lock-on, power correction and error the assist applies. */
export type AssistLevel = 'assisted' | 'semi' | 'manual';

/**
 * A Football Moment: a short scripted situation (score from a cross, 1v1 with the keeper, hold a lead…) set up
 * on the normal sim and graded with stars. src/sim/scenario.ts applies and judges it; src/meta/moments.ts lists
 * them; the session runs one when SessionOptions.scenario is set.
 */
export interface ScenarioSpec {
  id: string;
  title: string;
  /** One line shown before the whistle ("Score from the cross. 20 seconds."). */
  brief: string;
  /** Match clock at the start (s) and how long the moment runs (s). */
  clock: number;
  seconds: number;
  /** Practice drills wait for the skill, with no countdown or time-up failure. */
  untimed?: boolean;
  /** Small teaching drills can omit offside; ordinary moments retain the match's rules. */
  offside?: boolean;
  score: [number, number];
  humanSide: Side;
  /** DIFFICULTIES index (0 easy .. 3 legend), converted by the match request. */
  difficulty?: number;
  mode?: MatchMode;
  /** Placements by side and lineup slot (0 = keeper); anyone not listed keeps his formation spot. */
  players?: { side: Side; slot: number; x: number; z: number; facing?: number }[];
  /** Players already sent off at the start, by side and lineup slot. */
  sentOff?: { side: Side; slot: number }[];
  /** Blitz pickups available at the start, in the human's attacking frame. */
  powerups?: { kind: PowerUpKind; x: number; z: number }[];
  ball?: { x: number; z: number; y?: number; vx?: number; vy?: number; vz?: number };
  /** Who starts with the ball at his feet (null: loose). */
  owner?: { side: Side; slot: number } | null;
  /** A restart to begin from instead of open play (a corner, a penalty…). */
  restart?: RestartKind | null;
  /** What wins it, judged when the time is up or the moment ends early. */
  goal: 'score' | 'complete-pass' | 'lead' | 'no-concede' | 'draw-or-better' | 'win-shootout';
  /** A scoring drill must first perform this kind of kick (e.g. a cross, not a direct shot). */
  requireKick?: 'lob';
  /** Star thresholds, meaning depends on `goal` (e.g. seconds left on scoring, goals margin). */
  stars?: [number, number, number];
}

/** Match mode: 'classic' football, or 'blitz' with power-up pickups on the pitch (see PowerUpKind). */
export type MatchMode = 'classic' | 'blitz';

/**
 * Blitz power-ups. turbo: a burst of pace; mega: the next shot is a rocket that knocks the keeper back;
 * freeze: the other side is slowed for a few seconds; magnet: the ball sticks to your feet and passes
 * find you; shield: your carrier can't be tackled for a few seconds; golden: your side's next goal within
 * GOLDEN_S counts double.
 */
export type PowerUpKind = 'turbo' | 'mega' | 'freeze' | 'magnet' | 'shield' | 'golden';

/** A pickup lying on the pitch (blitz mode). `t` is seconds since it spawned. */
export interface PowerUp {
  id: number;
  kind: PowerUpKind;
  x: number;
  z: number;
  t: number;
}

export type MatchEvent =
  /** A strike of the ball. `style`: a shot played as a chip or a finesse (curled, placed) one. */
  | { type: 'kick'; power: number; x: number; y: number; z: number; kind: KickKind; style?: ShotStyle; player?: number; firstTime?: boolean }
  | { type: 'goal'; side: Side; scorer: number; own: boolean }
  | { type: 'whistle'; kind: 'short' | 'long' | 'end' }
  | { type: 'post'; x: number; y: number; z: number; speed: number }
  | { type: 'save'; keeper: number; caught: boolean }
  | { type: 'tackle'; by: number; won: boolean; slide: boolean }
  /** A TACKLE press committed to a lunge or slide (fires on the attempt, before any contact; render/HUD react). */
  | { type: 'tackleTry'; by: number; slide: boolean }
  | { type: 'bounce'; speed: number }
  | { type: 'net'; x: number; y: number; z: number; speed: number }
  | { type: 'ooh' }
  | { type: 'control'; player: number }
  | { type: 'halftime' }
  | { type: 'fulltime' }
  | { type: 'kickoffReady'; side: Side }
  | { type: 'foul'; by: number; on: number; penalty: boolean }
  | { type: 'sub'; side: Side; slot: number; on: string; off: string }
  /**
   * A booking. `red` sends the player off for the rest of the match (Player.sentOff); `second` marks a
   * red that came from a second yellow (show both cards).
   */
  | { type: 'card'; player: number; color: 'yellow' | 'red'; second?: boolean }
  | { type: 'skill'; player: number }
  | { type: 'setpiece'; kind: RestartKind; side: Side }
  | { type: 'restart'; kind: RestartKind; side: Side }
  /** A pass or shot cannoned off a defender. */
  | { type: 'block'; by: number; shot: boolean; x: number; z: number }
  /** Keeper came for a cross: caught it or punched it clear. */
  | { type: 'claim'; keeper: number; caught: boolean }
  /** A dribbler wrong-footed a defender. */
  | { type: 'beat'; by: number; on: number }
  /** One penalty of a shootout has been settled. */
  | { type: 'shootoutKick'; side: Side; taker: number; scored: boolean }
  /** The shootout (and the tie) is over. */
  | { type: 'shootoutEnd'; winner: Side }
  /**
   * Flag up: `player` (of the attacking `side`) was offside when the ball was played to him and
   * was first to it. An indirect free kick to the other side follows (a 'restart' freekick).
   */
  | { type: 'offside'; side: Side; player: number }
  /** Timed finishing: the human's second SHOOT tap at the moment of contact (perfect / good) or mistimed. */
  | { type: 'timing'; player: number; grade: 'perfect' | 'good' | 'early' | 'late' }
  /** Blitz mode: a pickup appeared / was collected / was activated / wore off. */
  | { type: 'powerupSpawn'; id: number; kind: PowerUpKind; x: number; z: number }
  | { type: 'powerupTaken'; id: number; kind: PowerUpKind; player: number; side: Side }
  | { type: 'powerupUsed'; kind: PowerUpKind; player: number; side: Side }
  | { type: 'powerupEnd'; kind: PowerUpKind; player: number; side: Side }
  /**
   * The referee plays advantage after a foul on `side` (the fouled team kept or won the ball back
   * in their attacking half): no free kick; any card for the foul is shown straight away.
   */
  | { type: 'advantage'; side: Side };

export type KickKind = 'pass' | 'through' | 'lob' | 'shot' | 'clear' | 'header' | 'throw' | 'keeper';
/** How a shot is struck, beyond a plain strike: lifted over the keeper, or curled and placed. */
export type ShotStyle = 'chip' | 'finesse';
export type RestartKind = 'kickoff' | 'throwin' | 'corner' | 'goalkick' | 'freekick' | 'penalty';
