import { sfx } from '../audio/sfx';
import { matchAudio } from '../audio/director';
import { freeKey, freePadButton, moveKeys, type Input } from '../core/input';
import { CAM_ZOOMS, CELEBRATION_IDS, type CamZoom, type CelebrationId } from '../core/save';
import { clamp, damp, smoothstep } from '../core/math';
import { crestFor, crestPixels } from '../core/crest';
import { BlitzFx, POWER_COLOR, POWER_LIGHT } from '../render/blitz';
import { CameraRig, type CamFocus, type SceneShot } from '../render/cameraRig';
import { AI_CELEBRATIONS, type CelebCue } from '../render/celebration';
import { setCharacterFill, setCharacterHemiFill, setCharacterWhiteBalance } from '../render/characters';
import { goalFxColors, trailColors } from '../render/cosmetics';
import { Effects } from '../render/effects';
import { goalShow } from '../render/fx/goals';
import { FxKit, TrailState, type FxCue } from '../render/fx/kit';
import { BOOT_STEP_M, bootStep, emitTrail } from '../render/fx/trails';
import type { StyledKit } from '../render/kitDesigns';
import { GhostArc } from '../render/ghostArc';
import { SetPieceAimView, type RunArrow } from '../render/setPieceAim';
import {
  HARD_STRIKE, HIT_STOP, KEEPER_FLASH_FRAMES, PLAYER_FLASH_FRAMES, SHAKE_PX, SLOW_POST, TRAIL_LOOK, endHeat, impactBits, kickTrailStyle, trailStrength,
  type TrailStyle,
} from '../render/juice';
import { MatchView } from '../render/matchView';
import { cssHex } from '../render/palette';
import { SubScene } from '../render/subScene';
import { MatchTunnel } from '../render/matchTunnel';
import { SKILL_SLOW_RATE, SKILL_SLOW_S } from '../render/juice';
import { actionKey } from '../core/input';
import { deliveryShape, FK_AUTO_POWER } from '../sim/setPiece';
import { skillFlair, skillWindow, type SkillEvent } from '../sim/skills';
import { SkillHud } from '../ui/skillHud';
import { ActionPop } from '../ui/actionPop';
import { RUSH_RANGE } from '../sim/keeper';
import { STAND_REACH } from '../sim/dribble';
import { CutFlash } from '../render/transition';
import { PITCH_Y, Stadium, stadiumFill, type StadiumParts } from '../render/stadium';
import { StadiumDecor } from '../render/stadiumStyle';
import { Weather, type WeatherKind } from '../render/weather';
import type { DecorStyle } from '../meta/style';
import type { TimeOfDay, World } from '../render/world';
import { BALL_R, DT, HALF_L, HALF_W, PEN_SPOT } from '../sim/constants';
import { EMPTY_PAD, Match, SHOOT_BAR, type MatchConfig, type Pad } from '../sim/match';
import { goalsOf } from '../sim/shootout';
import type { Kit, MatchEvent, PlayerDef, PowerUpKind, RestartKind, ScenarioSpec, Side } from '../sim/types';
import { applyScenario, finishScenario, judgeScenario, scenarioSecondsLeft, type ScenarioOutcome } from '../sim/scenario';
import { EdgeArrows, type EdgeMate, type EdgeRect } from '../ui/edgeArrows';
import { Hud, hudTeam } from '../ui/hud';
import { crestSvg } from '../ui/crest';
import { surname } from '../ui/commentary';
import { PresentHud } from '../ui/presentHud';
import { safeAreaInsets, type Insets } from '../ui/safeArea';
import { defendCue, diveCue, keeperCue, keyCap, moveCue, penaltyCue, pressVerb, restartCue, type CoachCtx, type CoachCue } from '../ui/coach';
import { skillCue } from '../ui/coach';
import { SEP_MARK } from '../ui/text';
import { QuickSubCard } from '../ui/quickSub';
import { ShootoutHud } from '../ui/shootoutHud';
import { TouchControls, isTouchDevice } from '../ui/touch';
import { buzz, hapticForEvent, primeHaptics } from '../platform/haptics';
import { Trainer } from '../ui/trainer';
import { grassSafeKit, resolveKitClash } from '../meta/data';
import { captainOf } from '../meta/style';
import { playFocus } from './camFocus';
import { ClipRecorder, clipSupported, type Clip } from './clip';
import { FOUL_BEAT_S, FoulPresentation, type BookingShot } from './foulPresentation';
import { GHOST_MAX_PTS, flyGhost, freeKickGhost, ghostBlocked, lobLaunch, penaltyGhost, type GhostLaunch, type GhostWall } from './ghostArc';
import { contrastAwayKit } from './kitContrast';
import { QuickSubs, quickSubsAllowed } from './quickSub';
import {
  LINEUP_INTRO_FROM, LINEUP_S, MOTM_S, SUB_MAX_SHOWN, SUB_S, applyLineup, applyMotm, lineupOrder, lineupShot, motmShot, motmSpot, newSubStage, subBeatS,
  subStage,
} from './showcase';
import { INTERLUDE_SECONDS, MatchInterlude, applyInterlude, interludeOrder, interludeShot, type MatchInterludeKind } from './matchInterludes';
import { MatchTally, type PlayerRating } from './ratings';
import { FunPresenter } from './funPresent';
import type { FunSummary } from './funLayer';
import { BALL_OFS, FRAME_LEN, LUNGE_S, PF, ReplayBuffer, STATE_CODE, isSentOff, writeFrame } from './replay';

export type { PlayerRating } from './ratings';

export interface SessionOptions extends MatchConfig {
  kits: [Kit, Kit];
  attendance: number;
  demo?: boolean;
  timeOfDay?: TimeOfDay;
  weather?: WeatherKind;
  /** Home stadium size 0..5 (5 = full bowl). */
  stadiumLevel?: number;
  /** Your ground built part by part (ROAD TO GLORY home matches): render/stadium.ts StadiumParts. */
  ground?: StadiumParts;
  /** Show first-match control tips. */
  tutorial?: boolean;
  /** No fly-in intro: straight to the kick-off framing (a rematch). */
  skipIntro?: boolean;
  /** Broadcast camera distance (default 'normal'). */
  camZoom?: CamZoom;
  /** Unlockable ball look (progression); undefined = the classic ball. */
  ballSkin?: string;
  /** The human side's goal celebration (progression; CelebrationId); undefined = classic. */
  celebration?: string;
  /** SHOP cosmetics for the human side (render/cosmetics.ts): its goals' explosion colours, its sprint speed lines. */
  goalFx?: string;
  trail?: string;
  /** SHOP stadium style for a home match of the human's (meta/style.ts decorOf; render/stadiumStyle.ts draws it). */
  decor?: DecorStyle | null;
  /** A Football Moment to run instead of a full match (src/sim/scenario.ts applies and judges it). */
  scenario?: ScenarioSpec;
  /** Colour-blind aid: shape cues on rings and markers (dashed opponent rings, a chevron on your team), not colour alone. */
  colorblind?: boolean;
  /** No screen shake or camera punch (default: the OS "reduce motion" setting). */
  reducedMotion?: boolean;
  /** Settings > QUICK SUBS (default on): the card that offers a tired player's change (game/quickSub.ts). */
  quickSubs?: boolean;
}

/**
 * Feeds the sim its steps instead of this machine's input alone: an online match (src/ui/online.ts drives it
 * with the lockstep engine, src/net/lockstep.ts). With a driver the session steps only when the driver has
 * both sides' pads, lets it move the match on at stoppages (the same tick on both machines), and plays no
 * replays and shows no half-time menu (either would hold one screen and not the other).
 */
export interface StepDriver {
  /** An online pause or stopped connection also holds local decision presentation. */
  readonly paused?: boolean;
  /** Both sides' pads for the next step, or null to wait (the network hasn't brought them; paused). */
  next(sample: () => Pad): readonly [Pad, Pad] | null;
  /** After every step (the stoppages it resumes itself, the desync check). */
  after(m: Match): void;
  /** Once a frame, stepping or not (resends, pings, the timeout). */
  frame(): void;
  /** Real-time scale for the fixed-step clock (time sync with the other machine). */
  pace(): number;
}

export interface MatchResult {
  score: [number, number];
  humanSide: Side | -1;
  match: Match;
  /** Per-player 1–10 ratings, best first. */
  ratings?: PlayerRating[];
  /** Who went through: by the score, or by the shootout in a level knockout tie (undefined = a draw). */
  winner?: Side;
  /** A Football Moment's verdict (only when SessionOptions.scenario was set). */
  scenarioOutcome?: ScenarioOutcome;
  /** The in-match fun layer's verdict for the human (game/funLayer.ts): live goals' coins and XP, SHOWTIME, super shots. */
  fun?: FunSummary;
}

/** Seconds on the wide shot after a goal (the ball in the net) before cutting to the scorer. */
const GOAL_WIDE_S = 0.7;
/**
 * ...and after a goal of yours with a SHOP goal explosion on (render/fx/goals.ts): long enough to see it go off.
 * The celebration starts that much later too, so its moment still lands after the cut (render/celebration.ts).
 */
const GOAL_FX_WIDE_S = 1.8;
/** Your side's strikes at least this hard (and this fast, m/s) carry your SHOP trail behind the ball. */
const SHOT_FX_POWER = 0.5;
const SHOT_FX_MS = 9;
/** The trails are drawn this much bigger than in the shop's close-up: they're seen from the gantry. */
const TRAIL_FX_K = 1.35;

/** The SHOP effects' sound cues (render/fx/kit.ts FxCue), each at most once per 90 ms however busy the show. */
const cueAt: { [k in FxCue]?: number } = {};
function fxCue(c: FxCue): void {
  const now = performance.now();
  if (now - (cueAt[c] ?? -1e9) < 90) return;
  cueAt[c] = now;
  if (c === 'coin') sfx.coin();
  else if (c === 'whoosh') sfx.whoosh();
  else if (c === 'pop') sfx.click();
  else sfx.thump();
}
/** The replay rolls once the celebration has had its moment (the scorer has been mobbed). */
const REPLAY_AT = 2.6;
/** A goal that gets no replay (an ordinary tap-in by either side): the celebration runs this long, then the kick-off. */
const NO_REPLAY_AT = 3.4;
/**
 * A goal against the human (no replay): the cut to the kick-off comes this soon (s), however long the scorers' move
 * (2026-10-04, the owner: "sloggy", "slow and boring": watching the AI celebrate 3.4 s was dead time). Any goal can
 * be tapped through once the wide shot has had its moment (a goal explosion's 1.8 s one included): GOAL_SKIP_GRACE s
 * after it, a tap ends the celebration and skips the replay.
 */
const THEIR_GOAL_AT = 2.4;
const GOAL_SKIP_GRACE = 0.15;
/**
 * Presentation pace (owner playtest: "the gameplay is very very slow"): the pre-match fly-in, the replay's
 * lead-in before the goal and tail after it (s of match time), the build-up's playback rate and the slow-mo
 * finish's (from REPLAY_SLOW_FROM s before the goal: ~5.5 s of replay in all, always skippable), and the
 * holds at half time and full time before the menus come up.
 */
const INTRO_S = 2.4;
const REPLAY_LEAD_S = 2.4;
const REPLAY_TAIL_S = 0.9;
const REPLAY_BUILD_RATE = 0.85;
const REPLAY_SLOW_RATE = 0.5;
const REPLAY_SLOW_FROM = 1.2;
const HALFTIME_HOLD_S = 1.4;
/** The match camera's key and gamepad button (VIEW / BACK, standard mapping), when no action is bound to them. */
const CAM_KEY = 'KeyV';
const CAM_PAD = 8;
const FULLTIME_HOLD_S = 1.5;
const SHOOTOUT_HOLD_S = 3.4;
/**
 * Football Moments (SessionOptions.scenario): the brief holds the sim this long before "GO!"; a settled
 * moment holds on its verdict card this long before the full-time screen; the last MOMENT_COUNT_S seconds
 * are counted down big on the banner.
 */
const MOMENT_BRIEF_S = 2.2;
const MOMENT_END_S = 2.4;
const MOMENT_COUNT_S = 5;
/** Hit-stop at the top of the backflip (frames). */
const HIT_STOP_APEX = 2;
/**
 * Ball glide (glideBall): a jump of the ball this big (m) that its velocity doesn't explain is drawn as a quick
 * glide (time constant BALL_GLIDE_TAU s) instead. Smaller is a dribble's touch; bigger is a restart, never smoothed.
 */
const BALL_GLIDE_MIN = 0.25;
const BALL_GLIDE_MAX = 4;
const BALL_GLIDE_TAU = 0.05;
/**
 * Hit-stop (60 Hz frames the drawn picture holds on the impact: the sim waits, its clock untouched, while the
 * camera punch, the flash and the burst land on the frozen picture) on a won tackle and on a goal (the rest:
 * render/juice.ts HIT_STOP), and the camera punch (m: ~3 px at broadcast distance). The screen shake is in
 * pixels (juice.ts SHAKE_PX).
 */
const HIT_STOP_TACKLE = HIT_STOP.tackle;
const HIT_STOP_GOAL = HIT_STOP.goal;
const PUNCH_TACKLE = 0.09;
/** A won standing tackle is "heavy" (it shakes the picture) when the two men met at this closing speed (m/s). */
const HEAVY_TACKLE_MS = 8;
/**
 * The camera push-in on a big chance: a shot struck at the goal (within CHANCE_S s, the ball loose and still
 * going goalwards at CHANCE_MS m/s or more) from inside CHANCE_RANGE m of the goal line.
 */
const CHANCE_S = 1.1;
const CHANCE_MS = 5;
const CHANCE_RANGE = 28;
/** Set-piece ghost arc: at or below this AI difficulty (EASY 0.6, NORMAL 1.8; HARD is 3). */
const GHOST_MAX_DIFFICULTY = 2.4;
/** Recent kicks' trail styles kept for replays (a replayed header still glows). */
const KICK_LOG = 24;
/** A goal's poster still: at most this wide (px). */
const POSTER_W = 1280;
/** A 'tackle' outcome within this long (s) of a 'tackleTry' from the same man is the same attempt. */
const TACKLE_TRY_S = 0.15;
/** The first this many tells of a match (until his first PERFECT) name the SKILL button (MatchSession.skillEvent). */
const SKILL_TEACH_TELLS = 3;
/** Pace readability: speed lines and dust from this speed (m/s); the ball trails from this speed. */
const SPRINT_FX_MS = 7;
/** Blitz: the mega ball stays a fireball this long (s) after it leaves the shooter's foot; a freeze's fallback length. */
const MEGA_FLY_S = 1.5;
const FREEZE_MAX_S = 6;
const FREEZE_TINT = 0x9fdcff;
/** Referee close-up when a card is shown at a stoppage. */
const CARD_CAM_S = 1.8;

/**
 * Low lenses see through whoever crowds them: anyone (but the taker / the booked player) within LENS_CLEAR m
 * of the lens (FK_LENS_CLEAR over the free-kick taker's shoulder) is faded right out, back to solid over the
 * next metre.
 */
const LENS_CLEAR = 3;
const FK_LENS_CLEAR = 4;
/**
 * The replays' low goal-line angle (30 degree lens, 2 m up): a head 5 m off would fill ~30% of the frame, so
 * it clears further out; nobody within REPLAY_KEEP m of the ball is ever cleared (that's the finish).
 */
const REPLAY_LENS_CLEAR = 4.5;
const REPLAY_KEEP = 3;
/** Replays never fade anyone below this (a see-through ghost, never gone): the finish stays readable. */
const REPLAY_MIN_ALPHA = 0.6;
/** The replay's goal-line shot only starts once the ball is this close (m) to the goal it went into. */
const REPLAY_GOAL_NEAR = 18;
/**
 * Card close-up: the man who was fouled is held this far (m) beyond the booked player (away from the
 * referee) and this much further from the lens: small in the background, well clear of him (~6.5 m).
 */
const CARD_VICTIM_GAP = 3.8;
const CARD_VICTIM_BACK = 4;
/** The minimap stays off this long (s) after a set piece is taken (the delivery is still coming in). */
const RADAR_SETPIECE_HOLD = 1.5;
/** ...and this long after the ball or the controlled player was drawn under it (no flicker at its edge). */
const RADAR_OCCLUDE_HOLD = 1;
/** Margin (px) round the minimap that counts as under it, and how often (s) its rectangle is re-measured. */
const RADAR_MARGIN = 14;
const RADAR_RECT_S = 0.5;
/**
 * Fixed-step phase: the frame drawn blends the last two sim steps by the time left over (acc / DT), so it
 * trails the newest step (the one that just read the stick and buttons) by (1 - acc / DT) of a step: up to a
 * whole 16.7 ms, wherever the phase happened to settle. On a display running at about the step rate the
 * leftover is nudged (at most PHASE_NUDGE of a step a frame, a time stretch nobody can see) towards
 * PHASE_WANT, so what is drawn is ~85% of the newest step (~2.5 ms behind it) and every frame still runs
 * exactly one step (the margin either side absorbs rAF jitter).
 */
const PHASE_WANT = 0.85;
const PHASE_NUDGE = 0.03;
/**
 * Off-screen team-mate arrows (ui/edgeArrows): on with our ball (or a loose one near us: within EDGE_LOOSE m of
 * one of ours and nearer to us than to them) in open play on the broadcast shot, easing in / out over
 * EDGE_FADE_S. Each fades with his distance from the ball: solid to EDGE_NEAR m, down to EDGE_MIN_ALPHA by
 * EDGE_FAR m. They stay inside a band clear of the score bug (EDGE_TOP px) and the bottom HUD (EDGE_BOTTOM px).
 */
const EDGE_LOOSE = 9;
const EDGE_FADE_S = 0.15;
const EDGE_NEAR = 18;
const EDGE_FAR = 50;
const EDGE_MIN_ALPHA = 0.4;
const EDGE_SIDE = 22;
const EDGE_TOP = 72;
const EDGE_BOTTOM = 82;

/** Which labels the touch buttons wear right now (attack / defend / set piece): hints name the button on screen. */
type HintCtx = CoachCtx;
/** An action a hint names (keyName: the player's own key, the pad button, or the touch button's label). */
type HintKey = 'pass' | 'shoot' | 'through' | 'sprint';

/** The presentation pace, for tests (seconds; see INTRO_S and friends). */
export const PRESENTATION = {
  introS: INTRO_S, goalWideS: GOAL_WIDE_S, replayAtS: REPLAY_AT, replayLeadS: REPLAY_LEAD_S, replayTailS: REPLAY_TAIL_S,
  buildRate: REPLAY_BUILD_RATE, slowRate: REPLAY_SLOW_RATE, slowFromS: REPLAY_SLOW_FROM, halftimeHoldS: HALFTIME_HOLD_S,
  fulltimeHoldS: FULLTIME_HOLD_S, hitStopTackle: HIT_STOP_TACKLE, hitStopGoal: HIT_STOP_GOAL,
  hitStopPost: HIT_STOP.post, hitStopPostSlow: HIT_STOP.postSlow, hitStopSlide: HIT_STOP.slide, hitStopSave: HIT_STOP.save,
  foulBeatS: FOUL_BEAT_S, noReplayAtS: NO_REPLAY_AT, theirGoalAtS: THEIR_GOAL_AT, goalSkipGraceS: GOAL_SKIP_GRACE,
  // The staged shots (game/showcase.ts), each skipped by a tap: the line-up, one substitution, the man of the match.
  lineupS: LINEUP_S, subS: SUB_S, motmS: MOTM_S,
  tunnelS: INTERLUDE_SECONDS.halftime, returnS: INTERLUDE_SECONDS.return, sportsmanshipS: INTERLUDE_SECONDS.sportsmanship,
} as const;

/** A staged shot can be skipped from this long in (s): the tap that started the match never skips it. */
const SCENE_SKIP_GRACE = 0.3;
/** Staged shots clear the frame: anyone not in the shot within this far (m) of the lens is faded out of it. */
const LINEUP_CLEAR = 9;
const SUB_CLEAR = 8.5;
const MOTM_CLEAR = 14;

/** One change waiting for (or playing in) the touchline shot: who went off, who came on, the shirt he now wears. */
interface SubBeat {
  side: Side;
  off: PlayerDef;
  on: PlayerDef;
  idx: number;
  keeper: boolean;
}

/** White chips off the woodwork. */
const POST_BITS = [0xffffff, 0xf4f4ea, 0xdfe6ec] as const;

const RESTART_LABEL: Record<RestartKind, string> = {
  kickoff: 'KICK OFF', throwin: 'THROW IN', corner: 'CORNER', goalkick: 'GOAL KICK', freekick: 'FREE KICK', penalty: 'PENALTY!',
};

/** A plain name for a colour (the first-match card names the ring under the player's man). */
function colourName(hex: number): string {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (max > 0.85 && d < 0.18) return 'WHITE';
  if (max < 0.25) return 'BLACK';
  if (d < 0.12) return 'GREY';
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = ((h * 60) + 360) % 360;
  if (h < 18 || h >= 340) return 'RED';
  if (h < 42) return 'ORANGE';
  if (h < 68) return 'YELLOW';
  if (h < 165) return 'GREEN';
  if (h < 200) return 'TEAL';
  if (h < 260) return 'BLUE';
  if (h < 300) return 'PURPLE';
  return 'PINK';
}

export class MatchSession {
  readonly match: Match;
  readonly view: MatchView;
  readonly stadium: Stadium;
  readonly effects = new Effects();
  /** The SHOP cosmetics: your goal explosion and your trail (render/fx/kit.ts). */
  readonly fxKit = new FxKit();
  /** The human's home ground dressed in its SHOP stadium style (null: none, an away match, or the menu demo). */
  private decor: StadiumDecor | null = null;
  readonly weather = new Weather();
  readonly cam: CameraRig;
  readonly hud: Hud | null;
  readonly touch: TouchControls | null;
  private trainer: Trainer | null = null;
  /** The quick-sub card (an ordinary match against the AI only: quickSubsAllowed). */
  private quick: QuickSubCard | null = null;
  paused = false;
  private padPauseHeld = false;
  /** Online: the lockstep driver (see StepDriver); null for a local match. */
  driver: StepDriver | null = null;
  /** Online: seconds the sim has been waiting on the driver (the other machine's pads), 0 while stepping. */
  netWaitS = 0;
  /** Online: the phase last seen, for the view changes at a stoppage the driver moved on from. */
  private netPhase = '';
  onHalftime: (() => void) | null = null;
  onFinish: ((r: MatchResult) => void) | null = null;
  onPause: (() => void) | null = null;

  private acc = 0;
  private time = 0;
  private prev = new Float32Array(FRAME_LEN);
  private cur = new Float32Array(FRAME_LEN);
  private buffer = new ReplayBuffer(60 * 10);
  private recorded = 0;
  private goalFrame = -1;
  private replay: Float32Array[] | null = null;
  private replayT = 0;
  private replayGoalIdx = 0;
  private replayDone = false;
  /** Whether the goal just scored gets the automatic replay (see the 'goal' case: only ones worth watching again). */
  private replayWanted = true;
  private goldenGoalArmed = false;
  private megaShotT = -9;
  private halftimeFired = false;
  private finishFired = false;
  private lastMinute = -1;
  private goalHypeT = 0;
  private prevButtons = false;
  private introLeft = 0;
  /** Per-player tallies, keyed by identity (a sub starts at zero; see game/ratings.ts). */
  private readonly tally = new MatchTally();
  private lastPasser: [number, number] = [-1, -1];
  /**
   * The player's very first match (SessionOptions.firstMatch): after the fly-in the sim holds on the kick-off
   * framing, with a "this is you" card up, until he first moves the stick or presses a button. The sim
   * itself makes his kick-off wait for a button; the session never presses it for him (a button that was
   * still down from skipping the intro or releasing the hold is swallowed until it is let go).
   */
  private holdFirst = false;
  private firstCardUp = false;
  private eatButtons = false;
  /**
   * A Football Moment in progress (SessionOptions.scenario): the sim clock it started on, the brief's hold,
   * the verdict once judged (the match ends on it, after the goal celebration if that is what settled it), the
   * beat on the verdict card, and the last big countdown number shown.
   */
  private moment: { spec: ScenarioSpec; briefT: number; outcome: ScenarioOutcome | null; endT: number; count: number } | null = null;
  private tut = { moved: false, passed: false, shot: false, chip: false, chipT: 0, switched: false, step: 0, t: 0 };
  private readonly demo: boolean;
  /** Penalty tracker, once a knockout tie goes to a shootout. */
  private so: ShootoutHud | null = null;
  /** Seconds left on the referee close-up for a card. */
  private cardT = 0;
  private cardRestart: Match['restart'] = null;
  private cardIdentity: string | null = null;
  private readonly foulPresentation = new FoulPresentation();
  /** Where the last foul happened (a sent-off player is already by his dugout when the card is shown). */
  private foulAt = { x: 0, z: 0 };
  /** Where the fouler stood when he committed it (the booked player's mark in the close-up if he's sent off). */
  private foulBy = { x: 0, z: 0 };
  /** Smoothed radius of the celebrating group the camera frames. */
  private celebG = 0;
  /** Who is being booked (never faded out of the card close-up). */
  private cardPlayer = -1;
  /** The man who was brought down (held off to one side of the card close-up), and the last foul's victim. */
  private cardVictim = -1;
  private foulOn = -1;
  /** Seconds the minimap stays hidden after a set piece (see RADAR_SETPIECE_HOLD). */
  private radarHoldT = 0;
  /**
   * Our set piece filmed over the taker's shoulder: the taker, the spot, and how far the ball has got, so the
   * post-strike hold can end early (a rebound back towards him, a touch by anyone but him or a keeper).
   */
  private holdKick: { taker: number; x: number; z: number; far: number; struck: boolean } | null = null;
  /** The HUD is in its cinematic state (card close-up: ticker, tags and touch buttons off). */
  private cineHud = false;
  /** Our set piece's aim (radians) as it stood when the taker stepped in to strike it (the arrow holds it). */
  private aimFrozen: number | null = null;
  /**
   * The minimap's screen rectangle (re-measured every RADAR_RECT_S while shown), and how long it stays off
   * after the ball or the controlled player was last drawn under it.
   */
  private radarEl: HTMLElement | null = null;
  private radarRect: { l: number; t: number; r: number; b: number } | null = null;
  private radarRectT = 0;
  private radarOccT = 0;
  private scratchV: THREE.Vector3 | null = null;
  /**
   * Action presses since the last live sim step (keyboard key-downs, touch button presses): a tap that goes
   * down and up between two steps (shorter than a frame, or during a slow frame) still reaches the sim as a
   * one-step press, never lost. Cleared whenever the sim isn't stepping (intro, replay, pause), so a press
   * that skipped a replay never fires a pass at the restart.
   */
  private latch = { pass: false, shoot: false, through: false, power: false, skill: false };
  private offKey: (() => void) | null = null;
  /** The camera's own key (CAM_KEY) while a match is on, and the pad's VIEW button last frame (an edge, not a hold). */
  private offCamKey: (() => void) | null = null;
  private padCamHeld = false;
  /** The camera button / key / pad changed the camera: main.ts keeps the choice in Settings. */
  onCamZoom: ((z: CamZoom) => void) | null = null;
  /** Off-screen team-mate arrows (see EDGE_FADE_S), their eased opacity, and the HUD boxes they keep off. */
  private edge: EdgeArrows | null = null;
  private edgeFade = 0;
  private edgeAvoid: EdgeRect[] = [];
  private edgeAvoidT = 0;
  /** The notch / home-indicator insets the arrows also keep inside (re-read with edgeAvoid). */
  private edgeInset: Insets = { l: 0, t: 0, r: 0, b: 0 };
  private edgeMates: EdgeMate[] = [];
  /** Hit-stop: seconds of hold left (frames / 60; see HIT_STOP_TACKLE). */
  private hitStopT = 0;
  /**
   * SKILL moves (sim/skills.ts) on screen: the tell over a defender and each move's pop (ui/skillHud.ts); the slow
   * motion after a PERFECT (s left, see SKILL_SLOW_S); the tells seen and PERFECTs landed this match (the first
   * SKILL_TEACH_TELLS tells, until his first PERFECT, name the button).
   */
  private skillHud: SkillHud | null = null;
  /** A TACKLE press answered in a word over his man (sim 'tackleCue': TACKLE!, TOO FAR, MISTIMED, FROM BEHIND). */
  private actionPop: ActionPop | null = null;
  private slowT = 0;
  /** The slow motion's rate (a PERFECT skill's, or a super shot's: game/funPresent.ts). */
  private slowRate = SKILL_SLOW_RATE;
  /** HYPE, live goals, SHOWTIME, goal callouts, the final minutes (game/funPresent.ts); null in the menu's demo. */
  readonly fun: FunPresenter | null = null;
  private skillTells = 0;
  private skillPerfects = 0;
  /** The ball's owner and pace before the last sim step (who was tackled; was a strike first-time; how hard it hit the post). */
  private ownerBefore = -1;
  private activeBefore = -1;
  private ballSpeedBefore = 0;
  /** The ball's trail look since the last kick (see juice.ts kickTrailStyle), and the recent kicks' for replays. */
  private trailStyle: TrailStyle = 'strike';
  private kickLogT = new Float32Array(KICK_LOG).fill(-1e9);
  private kickLogS: TrailStyle[] = new Array(KICK_LOG).fill('strike');
  /** ...and whether each was a hard strike of the human side's (it wears the SHOP trail). */
  private kickLogMine = new Uint8Array(KICK_LOG);
  private kickLogI = 0;
  /** The last kick was a hard strike of the human side's: the ball wears the SHOP trail till someone has it. */
  private shotFx = false;
  /** The SHOP trail's emitters: the player you control, and the ball. */
  private trailFx = new TrailState();
  private ballFx = new TrailState();
  /** This goal's wide shot (GOAL_FX_WIDE_S for a goal explosion), and a celebration waiting for it to end. */
  private goalWideS = GOAL_WIDE_S;
  private celebDue: Side | -1 = -1;
  /** The set-piece ghost arc (Easy / Normal), its path scratch and launch. */
  private ghost: GhostArc | null = null;
  /** The landing ring, the runs and the free kick's power ring (render/setPieceAim.ts), and the wall the preview is flown against. */
  private spAim: SetPieceAimView | null = null;
  private runArrows: RunArrow[] = [];
  private ghostWall: { spots: { x: number; z: number }[]; bend: number } = { spots: [], bend: 0 };
  private ghostPath = new Float32Array(GHOST_MAX_PTS * 3);
  private ghostL: GhostLaunch = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  /** Replay in / out flash cut. */
  private flash = new CutFlash();
  /** Goal clips (lastClip / lastPoster) and whether this goal's clip is the live celebration (no replay). */
  private clips = new ClipRecorder();
  private poster: Blob | null = null;
  private posterWanted = false;
  private clipLive = false;
  private clipName = '';
  /** Any input at all since the last frame (key, button, tap): skips a replay. */
  private anyPress = false;
  private offPointer: (() => void) | null = null;
  /** Scratch (no allocation per frame). */
  private fadeKeep: number[] = [];
  private fadeSight: { x: number; z: number }[] = [];
  private sightPool: { x: number; z: number }[] = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
  private matePool: EdgeMate[] = [];
  private celebNear: number[] = [];
  private edgeBox: EdgeRect = { l: 0, t: 0, r: 0, b: 0 };
  private cardFocus = { rx: 0, rz: 0, fx: 0, fz: 0 };
  private focusOut = { bx: 0, by: 0, bz: 0, bvx: 0, bvz: 0, ax: 0, az: 0, attack: 1 } as CamFocus;
  /**
   * Standing-tackle lunges baked into the frames (replay.ts writeFrame): per player, seconds since his TACKLE
   * press (< 0: none) and the leg he lunges with; and when his last attempt was seen (TACKLE_TRY_S).
   */
  private lunge = new Float32Array(22).fill(-1);
  private lungeLeg = new Float32Array(22).fill(1);
  private tryAt = new Float32Array(22).fill(-1e9);
  /** Per player: the pose state drawn last frame (dust on a dive / a fall) and a particle-rate accumulator. */
  private lastState = new Float32Array(22).fill(-1);
  /** LIGHT UP BOOTS (a SHOP player look) per side, and each player's distance since his last glowing step and which foot. */
  private lightBoots: [boolean, boolean] = [false, false];
  private stepDist = new Float32Array(22);
  private stepSide = new Float32Array(22).fill(1);
  private fxAcc = new Float32Array(22);
  private ballFxAcc = 0;
  /** The human side's sprint speed-line colours (SessionOptions.trail), looked up on the first sprint. */
  private trailCols: readonly number[] | null = null;
  /** Blitz visuals (made on the first frame of a blitz match; never otherwise). */
  private blitz: BlitzFx | null = null;
  /** Blitz: which side is frozen by a freeze event (and its fallback timer), the mega ball in flight, the last hot state. */
  private frozenSide = -1;
  private frozenT = 0;
  private megaFlyT = 0;
  private megaHot = false;
  private frozen = new Uint8Array(22);
  /**
   * Staged shots (game/showcase.ts; presentation only, the sim never hears of them): their captions; the touchline
   * scene's own three footballers; who is in each shirt as last drawn (a 'sub' event names the man going off, his
   * number comes from here); the changes waiting for the next stoppage, and the one playing; the line-up's clock and
   * its row; the man of the match. `sceneShot` is the lens for whichever is on, `sceneKeep` / `sceneClear` who stays
   * in the frame and how far round the lens everyone else is faded out.
   */
  private present: PresentHud | null = null;
  private readonly subScene = new SubScene();
  private wearing: PlayerDef[] = [];
  private subQueue: SubBeat[] = [];
  private subCut: { list: SubBeat[]; i: number; t: number; per: number; age: number; met: boolean } | null = null;
  private readonly subSt = newSubStage();
  private lineupLeft = 0;
  private lineupAge = 0;
  private lineupRow: number[] = [];
  private motm: { idx: number; x: number; z: number; t: number; lost: boolean } | null = null;
  private motmDone = false;
  private interlude: MatchInterlude | null = null;
  private matchTunnel: MatchTunnel | null = null;
  private sportsmanshipDone = false;
  private sceneShot: SceneShot = { px: 0, py: 20, pz: 40, tx: 0, ty: 0, tz: 0, fov: 30 };
  private sceneKeep: number[] = [];
  private sceneClear = 0;
  private bzTurbo = [false, false];
  private bzFrozen = [false, false];
  private bzMagMan = [-1, -1];
  private bzMagD = [Infinity, Infinity];

  constructor(private world: World, private input: Input, readonly opt: SessionOptions) {
    this.demo = !!opt.demo;
    // Readability first: no green shirts on green grass, then re-check the clash.
    const home = grassSafeKit(opt.kits[0]);
    const away = resolveKitClash(home, grassSafeKit(opt.kits[1]));
    // ...and the two sides must read apart from the gantry (light against dark): see kitContrast. The side
    // that changes strip is never the human's: you always play in your own club's colours. (Online, both sides
    // are human and both screens must show the same strips: the away side changes, as src/net/setup.ts netKits.)
    opt.kits = opt.humanSide === 1 && !opt.humanSides ? [contrastAwayKit(away, home), away] : [home, contrastAwayKit(home, away)];
    this.match = new Match(opt);
    // A Football Moment: the sim is set up for it (score, clock, placements, ball) before anything is drawn or
    // recorded; no fly-in, the brief instead of the fixture card.
    if (opt.scenario && !this.demo) {
      applyScenario(this.match, opt.scenario);
      this.moment = { spec: opt.scenario, briefT: opt.scenario.untimed ? 0 : MOMENT_BRIEF_S, outcome: null, endT: -1, count: -1 };
    }
    const teams = this.match.teams;
    const level = Math.max(0, Math.min(5, Math.round(opt.stadiumLevel ?? 5)));
    this.stadium = new Stadium({
      home: opt.kits[0].shirt,
      away: opt.kits[1].shirt,
      homeName: teams[0].name,
      awayName: teams[1].name,
      // A small ground rarely sells out; and fewer fans on lower graphics settings (the crowd is the biggest
      // vertex cost).
      attendance: opt.attendance * stadiumFill(level) * (world.quality === 'low' ? 0.45 : world.quality === 'medium' ? 0.75 : 1),
      level,
      parts: opt.ground,
      // The clubs' crests on the big screen (core/crest.ts: yours as you designed it), the same as the score bug's.
      crests: [crestPixels(crestFor(teams[0].name, teams[0].short, teams[0].kit), teams[0].short, teams[0].name), crestPixels(crestFor(teams[1].name, teams[1].short, teams[1].kit), teams[1].short, teams[1].name)],
      // (A draw from the sim's own rng: online, both machines build the session the same way, so they draw it
      // alike. Never draw from match.rng on anything local, like the graphics quality: the two games would part.)
      seed: this.match.rng.int(1e9),
    });
    this.view = new MatchView(teams, opt.kits, opt.humanSide, !!opt.colorblind);
    for (const sd of [0, 1] as const) this.lightBoots[sd] = (opt.kits[sd] as StyledKit).looks?.boots === 'bootlight';
    this.applyTimeOfDay(opt.timeOfDay ?? 'day', opt.weather ?? 'clear');
    this.view.group.position.y = PITCH_Y;
    this.effects.mesh.position.y = PITCH_Y;
    world.scene.add(this.stadium.group, this.view.group, this.effects.mesh, this.weather.group);
    this.fxKit.group.position.y = PITCH_Y;
    world.scene.add(this.fxKit.group);
    this.subScene.group.position.y = PITCH_Y;
    world.scene.add(this.subScene.group);
    if (!this.demo && !opt.humanSides && !this.moment && this.match.cfg.humanSide >= 0) {
      this.matchTunnel = new MatchTunnel(opt.kits[0].shirt, opt.kits[1].shirt);
      this.matchTunnel.group.position.y = PITCH_Y;
      world.scene.add(this.matchTunnel.group);
    }
    this.wearing = this.match.players.map((p) => p.def);
    this.warmFx();
    this.fxKit.onCue = fxCue;
    this.cam = new CameraRig(world.camera);
    this.cam.players = this.view.frame;
    // Reduced motion (the setting, or the OS preference): no screen shake, no camera punch.
    const reduce = opt.reducedMotion ?? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.cam.setReducedMotion(!!reduce);
    world.scene.add(this.flash.mesh);
    // The set-piece ghost arc, built now (hidden, no dots) so World.warmShaders compiles it with the rest, not
    // at the first free kick's aim.
    if (!this.demo && this.match.cfg.humanSide >= 0) {
      this.ghost = this.makeGhost();
      this.spAim = new SetPieceAimView();
      this.view.group.add(this.spAim.group);
    }
    // The crowd: louder and singing more in a bigger, fuller ground.
    sfx.setStadium(level, Math.max(0, Math.min(1, opt.attendance * stadiumFill(level))));
    this.cam.touchLayout = !this.demo && isTouchDevice();
    this.cam.setZoom(opt.camZoom ?? 'normal');
    this.view.setBallSkin(opt.ballSkin);
    this.view.celeb.onCue = (c) => this.celebCue(c);
    const intro = !this.demo && !opt.skipIntro && !this.moment;
    // THE LINE-UP first (game/showcase.ts): your XI big in the frame before the fly-in. Never a new player's first
    // match (he gets to the ball sooner), an online match (no intro there) or a match he only watches.
    const lineup = intro && !opt.firstMatch && !opt.humanSides && (opt.humanSide === 0 || opt.humanSide === 1);
    this.cam.setMode(this.demo ? 'menu' : lineup ? 'scene' : intro ? 'intro' : 'broadcast');
    if (intro) this.introLeft = INTRO_S;
    if (lineup) this.startLineup(opt.humanSide as Side);
    // Stadium style (decorative layers over the home ground): the walkout goes off as the fly-in starts (its high
    // shot sees the fireworks over the stands), or soon after a kick-off without one.
    if (opt.decor && !this.demo) {
      this.decor = new StadiumDecor(this.stadium.decorAnchors(), opt.decor, this.fxKit, this.world.camera);
      this.decor.setTimeOfDay(opt.timeOfDay ?? 'day');
      this.decor.kickoffIn(lineup ? LINEUP_S + 0.15 : intro ? 0.15 : 0.8);
    }
    this.holdFirst = !this.demo && !!opt.firstMatch && !this.moment && (opt.humanSide === 0 || opt.humanSide === 1);
    if (!this.demo) {
      this.hud = new Hud(
        [hudTeam(teams[0], opt.kits[0].shirt, opt.kits[0].shirt2), hudTeam(teams[1], opt.kits[1].shirt, opt.kits[1].shirt2)],
        opt.humanSide,
      );
      this.hud.onPause = () => this.requestPause();
      this.hud.onCamera = () => this.cycleCamZoom();
      if (typeof window !== 'undefined') {
        const camKey = (e: KeyboardEvent): void => {
          if (e.repeat || e.code !== CAM_KEY || !freeKey(e.code) || this.paused) return;
          if (e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
          this.cycleCamZoom();
        };
        window.addEventListener('keydown', camKey);
        this.offCamKey = () => window.removeEventListener('keydown', camKey);
      }
      document.getElementById('ui')!.appendChild(this.hud.root);
      this.trainer = new Trainer();
      this.hud.root.appendChild(this.trainer.root);
      this.skillHud = new SkillHud();
      this.hud.root.appendChild(this.skillHud.root);
      // (The word over his man that answers a TACKLE press: ui/actionPop.ts.)
      this.actionPop = new ActionPop();
      this.hud.root.appendChild(this.actionPop.root);
      this.present = new PresentHud();
      this.hud.root.appendChild(this.present.root);
      // The crowd's chants, captioned as they start (src/audio/sfx.ts).
      sfx.onChant = this.onChant;
      if (opt.humanSide === 0 || opt.humanSide === 1) {
        this.edge = new EdgeArrows(this.view.teamColor.fill, this.view.teamColor.edge);
        this.hud.root.appendChild(this.edge.root);
      }
      if (quickSubsAllowed(opt)) {
        const side = opt.humanSide as Side;
        const qs = new QuickSubs(this.match, side, (slot, benchIdx) => this.substitute(side, slot, benchIdx));
        qs.enabled = opt.quickSubs !== false;
        this.quick = new QuickSubCard(qs, input);
        this.hud.root.appendChild(this.quick.root);
      }
      this.touch = new TouchControls(input);
      document.getElementById('ui')!.appendChild(this.touch.root);
      // (The haptic generators woken for the match's first tap: platform/haptics.ts.)
      primeHaptics();
      this.touch.setEnabled(isTouchDevice());
      // With the touch buttons on screen, the trainer and hints name them (PASS, SHOOT), not keys, until a key or a
      // pad is actually used. (Some phones and tablets show the buttons without reporting a coarse pointer.)
      if (isTouchDevice()) input.lastDevice = 'touch';
      // Latch presses as they happen (see `latch`): a key-down is read through Input itself (whatever it maps
      // to), a touch button by its own press.
      this.offKey = input.onKey(() => {
        this.anyPress = true;
        this.latchPresses(input.read());
      });
      this.touch.onPress = (k) => {
        this.anyPress = true;
        this.latch[k] = true;
      };
      // A tap or click on the picture itself counts as "any input" too (it skips a replay).
      const cv = (world as { canvas?: HTMLCanvasElement }).canvas;
      if (cv && typeof cv.addEventListener === 'function') {
        const down = () => {
          this.anyPress = true;
        };
        cv.addEventListener('pointerdown', down);
        this.offPointer = () => cv.removeEventListener('pointerdown', down);
      }
    } else {
      this.hud = null;
      this.touch = null;
    }
    if (this.hud) {
      // The fun layer: live goals and SHOWTIME only in an ordinary match against the AI (not online, not a moment).
      const solo = !opt.humanSides && !this.moment && (opt.humanSide === 0 || opt.humanSide === 1);
      this.fun = new FunPresenter({
        match: this.match, hud: this.hud, view: this.view, cam: this.cam, effects: this.effects, stadium: this.stadium, camera: world.camera,
        kits: opt.kits, bounties: solo, showtime: solo, reducedMotion: !!reduce,
        hold: (frames) => this.hold(frames),
        slow: (seconds, rate) => {
          this.slowT = seconds;
          this.slowRate = rate;
        },
        replaying: () => !!this.replay,
      });
    }
    writeFrame(this.match, this.cur, 0);
    this.prev.set(this.cur);
    sfx.setAmbienceActive(!this.demo);
    // The crowd's and the music's cues for this match (src/audio/director.ts; never the menu's demo).
    if (!this.demo) matchAudio.begin(this.match, { scenario: !!this.moment });
    if (this.hud && this.moment) {
      const s = this.moment.spec;
      // Practice waits on its teaching cue, never on a timed intro that swallows the first action.
      if (!s.untimed) this.hud.show(s.title, s.brief, 'small intro', MOMENT_BRIEF_S - 0.1);
      this.hud.setScore(this.match.score[0], this.match.score[1]);
      this.stadium.setScore(this.match.score[0], this.match.score[1], `${this.match.minute()}'`);
      this.prevButtons = true;
    } else if (this.hud && intro) {
      // (After a line-up the fixture card comes up with the fly-in: endLineup.)
      if (lineup) this.lineupPlate(opt.humanSide as Side);
      else this.fixtureCard(INTRO_S);
      this.prevButtons = true;
    }
  }

  /** The pre-match title card, up for the fly-in. */
  private fixtureCard(seconds: number): void {
    const teams = this.match.teams;
    this.hud?.show(`${teams[0].short} v ${teams[1].short}`, `${teams[0].name} v ${teams[1].name}`, 'small intro', Math.max(0.6, seconds - 0.2));
  }

  // ------------------------------------------------------------------ staged shots (game/showcase.ts)

  /** Your captain: the styled kit names him (meta/style.ts); a plain kit's is the best outfielder all the same. */
  private captainIdx(side: Side): number {
    const m = this.match;
    const id = (this.opt.kits[side] as StyledKit).captain ?? captainOf(m.teams[side]);
    return m.teamPlayers(side).find((p) => p.def.id === id)?.idx ?? -1;
  }

  /** THE LINE-UP: your XI in a row by the far touchline, the lens along it, the captain last. */
  private startLineup(side: Side): void {
    const idxs = this.match.teamPlayers(side).map((p) => p.idx);
    this.lineupRow = lineupOrder(idxs, this.captainIdx(side));
    this.lineupLeft = LINEUP_S;
    this.lineupAge = 0;
    this.sceneKeep = this.lineupRow;
    this.sceneClear = LINEUP_CLEAR;
    this.view.frameHook = (f) => applyLineup(f, this.lineupRow, 1 - this.lineupLeft / LINEUP_S, this.time);
    lineupShot(0, this.lineupRow.length, this.sceneShot, this.view.headTop);
  }

  private lineupPlate(side: Side): void {
    const t = this.match.teams[side];
    const kit = this.opt.kits[side];
    const cap = this.match.players[this.captainIdx(side)];
    this.present?.showPlate('LINE UP', t.name.toUpperCase(), cap ? `CAPTAIN ${surname(cap.def.name).toUpperCase()}` : '', crestSvg(t.name, t.short, kit, 3), cssHex(kit.shirt));
    this.hud?.setSkippable(true);
  }

  /** The line-up, a frame at a time; a tap, a click or a button moves on to the fly-in. */
  private stepLineup(dt: number): void {
    this.lineupLeft -= dt;
    this.lineupAge += dt;
    const c = this.input.read();
    const btn = c.pass || c.shoot || c.through;
    const skip = this.lineupAge > SCENE_SKIP_GRACE && ((btn && !this.prevButtons) || this.anyPress);
    this.prevButtons = btn;
    lineupShot(1 - Math.max(0, this.lineupLeft) / LINEUP_S, this.lineupRow.length, this.sceneShot, this.view.headTop);
    this.view.apply(this.prev, this.cur, 1, this.time, dt);
    if (skip || this.lineupLeft <= 0) this.endLineup();
  }

  /** On to the fly-in, from part way in (the establishing shot has been had): the fixture card and the walkout go with it. */
  private endLineup(): void {
    this.lineupLeft = 0;
    this.view.frameHook = null;
    this.sceneKeep = [];
    this.sceneClear = 0;
    this.present?.hidePlate();
    this.hud?.setSkippable(false);
    this.introLeft = INTRO_S * (1 - LINEUP_INTRO_FROM);
    this.cam.introT = LINEUP_INTRO_FROM;
    this.cam.setMode('intro');
    this.fixtureCard(this.introLeft);
    this.decor?.kickoffIn(0.15);
    // (The men are back on their marks this frame, as they are: no cross-fade out of the row.)
    this.view.apply(this.prev, this.cur, 1, this.time, 0);
  }

  /** Is there a change to show, and is the picture free for it? At a dead ball, on the broadcast shot, nothing else on. */
  private subCutReady(): boolean {
    const m = this.match;
    if (!this.subQueue?.length) return false;
    if (m.phase === 'fulltime' || m.phase === 'shootout') {
      this.subQueue.length = 0;
      return false;
    }
    if (this.replay || this.hitStopT > 1e-4 || this.cardT > 0 || this.foulPresentation.waiting) return false;
    if (this.cam.mode !== 'broadcast' || this.cam.behindActive) return false;
    if (m.phase !== 'out' && m.phase !== 'restart' && m.phase !== 'kickoff') return false;
    // (A penalty keeps its tension: the change is shown at the stoppage after.)
    return m.restart?.kind !== 'penalty';
  }

  /** The changes waiting, back to back: each gets subBeatS of the touchline shot. */
  private startSubCut(): void {
    const list = this.subQueue.splice(0, SUB_MAX_SHOWN);
    this.subCut = { list, i: 0, t: 0, per: subBeatS(list.length), age: 0, met: false };
    this.sceneKeep = [];
    this.sceneClear = SUB_CLEAR;
    // The man who came on is drawn in the scene: the one the sim already has in his shirt waits out of sight.
    this.view.frameHook = (f) => {
      for (const b of list) f[b.idx * PF + 1] = -(HALF_W + 60);
    };
    this.cam.setMode('scene');
    this.hud?.setSkippable(true);
    this.clearLatch();
    this.beginSubBeat();
  }

  private beginSubBeat(): void {
    const sc = this.subCut!;
    const b = sc.list[sc.i];
    sc.t = 0;
    sc.met = false;
    this.subScene.begin(b.off, b.on, this.opt.kits[b.side], b.keeper);
    subStage(0, b.side, this.subSt, this.view.headTop);
    this.subScene.update(this.subSt, this.time, 0);
    Object.assign(this.sceneShot, this.subSt.shot);
    this.present?.showSub(
      { number: b.off.number, name: surname(b.off.name) }, { number: b.on.number, name: surname(b.on.name) }, sc.i + 1, sc.list.length,
    );
    // His own fans clap him off.
    sfx.applause(0.45, b.side);
  }

  /** A change on the touchline, a frame at a time (the sim waits: it is a dead ball); a tap skips the lot. */
  private stepSubCut(dt: number): void {
    const sc = this.subCut!;
    sc.t += dt;
    sc.age += dt;
    const c = this.input.read();
    const btn = c.pass || c.shoot || c.through;
    const skip = sc.age > SCENE_SKIP_GRACE && ((btn && !this.prevButtons) || this.anyPress);
    this.prevButtons = btn;
    this.acc = 0;
    if (skip) {
      this.endSubCut(btn);
      return;
    }
    if (sc.t >= sc.per) {
      if (++sc.i >= sc.list.length) {
        this.endSubCut(false);
        return;
      }
      this.beginSubBeat();
    }
    const b = sc.list[sc.i];
    subStage(clamp(sc.t / sc.per, 0, 1), b.side, this.subSt, this.view.headTop);
    if (this.subSt.met && !sc.met) {
      // The high five: palms meet (a clap, a tap in the hand, a puff off the line).
      sc.met = true;
      sfx.highFive();
      buzz('sub');
      this.effects.dust((this.subSt.off.x + this.subSt.on.x) / 2, (this.subSt.off.z + this.subSt.on.z) / 2, 4, 0.4);
    }
    this.subScene.update(this.subSt, this.time, dt);
    Object.assign(this.sceneShot, this.subSt.shot);
    this.view.apply(this.prev, this.cur, 1, this.time, dt);
  }

  /** Back to the match, on a cut. `held`: a button skipped it, and must be let go before it counts as a press. */
  private endSubCut(held: boolean): void {
    this.subCut = null;
    this.subScene.end();
    this.view.frameHook = null;
    this.sceneKeep = [];
    this.sceneClear = 0;
    this.present?.hideSub();
    this.hud?.setSkippable(false);
    this.cam.setMode('broadcast');
    this.cam.cut();
    this.eatButtons = this.eatButtons || held;
    this.clearLatch();
    this.acc = 0;
    this.view.apply(this.prev, this.cur, 1, this.time, 0);
  }

  /** Dressing-room departures / return, then the post-match greeting. Local presentation, with no sim changes. */
  private startMatchInterlude(kind: MatchInterludeKind): boolean {
    const m = this.match;
    if (this.driver || this.demo || this.moment || !this.hud || m.cfg.humanSide < 0 || this.interlude || this.subCut) return false;
    if ((kind === 'halftime' && m.phase !== 'halftime') || (kind === 'return' && m.phase !== 'kickoff') ||
      (kind === 'sportsmanship' && (m.phase !== 'fulltime' || !!m.shootout))) return false;
    const cast = (side: Side) => interludeOrder(m.teamPlayers(side).filter((p) => !isSentOff(p)).map((p) => p.idx), this.captainIdx(side));
    const scene = new MatchInterlude(kind, cast(0), cast(1));
    if (!scene.actors.length) return false;
    this.interlude = scene;
    this.sceneKeep = scene.actors;
    this.sceneClear = 11;
    this.view.celeb.end();
    this.view.frameHook = (f) => applyInterlude(f, scene, this.time);
    this.matchTunnel?.show(scene.tunnel);
    interludeShot(scene, this.sceneShot, this.view.headTop);
    this.cam.setMode('scene');
    this.cam.cut();
    this.view.setMarkerVisible(false);
    this.present?.hideChant();
    const [home, away] = m.teams;
    const kit = this.opt.kits[m.cfg.humanSide as Side];
    const human = m.teams[m.cfg.humanSide as Side];
    const tag = kind === 'halftime' ? 'HALF TIME' : kind === 'return' ? 'SECOND HALF' : 'FULL TIME';
    const title = kind === 'halftime' ? 'INTO THE TUNNEL' : kind === 'return' ? 'BACK FOR THE SECOND HALF' : 'RESPECT AT THE WHISTLE';
    const line = `${home.short} ${m.score[0]} : ${m.score[1]} ${away.short}${kind === 'halftime' ? '   TIME FOR THE TEAM TALK' : kind === 'return' ? '   A FRESH HALF' : '   FOOTBALL FIRST'}`;
    this.present?.showPlate(tag, title, line, crestSvg(human.name, human.short, kit, 3), cssHex(kit.shirt));
    this.hud.hideIntro();
    this.hud.setSkippable(true);
    this.clearLatch();
    this.acc = 0;
    this.view.apply(this.prev, this.cur, 1, this.time, 0);
    if (kind === 'sportsmanship') sfx.applause(0.6);
    return true;
  }

  private stepMatchInterlude(dt: number): void {
    const scene = this.interlude!;
    const c = this.input.read();
    const btn = c.pass || c.shoot || c.through || c.skill || c.power || c.sprint;
    const press = (btn && !this.prevButtons) || this.anyPress;
    this.prevButtons = btn;
    this.acc = 0;
    const done = scene.tick(dt, press);
    if (!done && scene.takeGreeting()) sfx.highFive();
    interludeShot(scene, this.sceneShot, this.view.headTop);
    this.view.apply(this.prev, this.cur, 1, this.time, dt);
    if (done) this.endMatchInterlude(btn);
  }

  private endMatchInterlude(held: boolean): void {
    const scene = this.interlude;
    if (!scene) return;
    this.interlude = null;
    this.matchTunnel?.show(false);
    this.view.frameHook = null;
    this.sceneKeep = [];
    this.sceneClear = 0;
    this.present?.hidePlate();
    this.hud?.setSkippable(false);
    this.view.setBallHidden(false);
    this.cam.setMode('broadcast');
    this.cam.cut();
    this.eatButtons = this.eatButtons || held;
    this.clearLatch();
    this.acc = 0;
    this.view.apply(this.prev, this.cur, 1, this.time, 0);
    if (scene.kind === 'halftime') {
      this.halftimeFired = true;
      this.onHalftime?.();
    } else if (scene.kind === 'return') {
      this.resetView();
      this.view.setMarkerVisible(this.match.cfg.humanSide >= 0);
      this.hud?.show('SECOND HALF', '', 'small', 1.2);
    } else this.flow(0); // The man of the match follows the greeting; its callback stays exactly once.
  }

  /**
   * MAN OF THE MATCH, between the final whistle's beat and the result screen: true while his close-up runs (a tap
   * ends it). Never online (the two screens finish together), in a moment, after a shootout (the winners' pile-up is
   * that beat) or with nobody rated.
   */
  private motmBeat(dt: number): boolean {
    if (this.motmDone) return false;
    const m = this.match;
    if (!this.motm) {
      const best = !this.driver && !this.moment && !m.shootout && this.hud ? this.ratings()[0] : undefined;
      const p = best ? m.players[best.idx] : undefined;
      if (!best || !p || isSentOff(p)) {
        this.motmDone = true;
        return false;
      }
      const spot = motmSpot(p.pos.x, p.pos.z);
      const o = p.side === 0 ? 1 : 0;
      this.motm = { idx: p.idx, x: spot.x, z: spot.z, t: 0, lost: m.score[p.side] < m.score[o] };
      this.sceneKeep = [p.idx];
      this.sceneClear = MOTM_CLEAR;
      this.view.frameHook = (f) => {
        const mo = this.motm;
        if (mo) applyMotm(f, mo.idx, mo.x, mo.z, mo.lost, this.time);
      };
      motmShot(0, spot.x, spot.z, this.view.headTop, this.sceneShot);
      this.view.celeb.end();
      this.cam.setMode('scene');
      this.cam.cut();
      const kit = this.opt.kits[p.side];
      const t = m.teams[p.side];
      const bits = [best.goals ? `${best.goals} ${best.goals > 1 ? 'GOALS' : 'GOAL'}` : '', best.assists ? `${best.assists} ${best.assists > 1 ? 'ASSISTS' : 'ASSIST'}` : ''].filter(Boolean);
      this.present?.showPlate(
        'MAN OF THE MATCH', `${p.def.number} ${surname(p.def.name).toUpperCase()}`, [t.name.toUpperCase(), `RATING ${best.rating.toFixed(1)}`, ...bits].join('   '),
        crestSvg(t.name, t.short, kit, 3), cssHex(kit.shirt),
      );
      this.hud?.setSkippable(true);
      this.view.setMarkerVisible(false);
      return true;
    }
    const mo = this.motm;
    mo.t += dt;
    if (mo.t < MOTM_S && !(mo.t > SCENE_SKIP_GRACE && this.anyPress)) return true;
    // (He stays in the frame behind the result screen: only the caption and the skip line go.)
    this.motmDone = true;
    this.present?.hidePlate();
    this.hud?.setSkippable(false);
    return false;
  }

  /** The staged shot's lens this frame (the line-up and a change move theirs as they step). */
  private updateScene(): void {
    if (this.interlude) {
      interludeShot(this.interlude, this.sceneShot, this.view.headTop);
      return;
    }
    const mo = this.motm;
    if (mo) motmShot(clamp(mo.t / MOTM_S, 0, 1), mo.x, mo.z, this.view.headTop, this.sceneShot);
  }

  /**
   * A chant has started (src/audio/sfx.ts): its words, small, top right. Off with Settings > COMMENTARY (the ticker's
   * switch: Hud.setCommentary), and nothing over a staged shot, a replay or the pause menu.
   */
  private readonly onChant = (c: { caption: string; seconds: number }): void => {
    if (!this.present || !this.hud?.commentaryOn || !c.caption || this.demo || this.paused) return;
    if (this.cam.mode === 'scene' || this.replay) return;
    // (Up for most of the chant, never long enough to be clutter.)
    this.present.showChant(`CROWD: ${c.caption}`, Math.max(2.6, Math.min(4.2, c.seconds * 0.7)));
  };

  /** Dev (window.__bl.session): what the staged shots are doing now. */
  get staging(): { lineup: number; sub: string; subsQueued: number; motm: number; interlude: string; plate: string; chant: string } {
    return {
      lineup: +this.lineupLeft.toFixed(2), sub: this.present?.subShown ?? '', subsQueued: this.subQueue.length,
      motm: this.motm ? this.motm.idx : -1, plate: this.present?.plateShown ?? '', chant: this.present?.chantShown ?? '',
      interlude: this.interlude?.kind ?? '',
    };
  }

  /**
   * Dev (window.__bl.stage): give the human a set piece now, in open play: 'freekick' (22 m out: the reticle on the
   * goal), 'wide' (a wide free kick: the landing ring), 'corner', 'penalty'; or 'shootout' (straight to penalties).
   */
  devStage(kind: 'freekick' | 'wide' | 'corner' | 'penalty' | 'shootout'): boolean {
    const m = this.match;
    const hs = m.cfg.humanSide;
    if (hs < 0 || m.phase !== 'play') return false;
    const dev = m as unknown as { goOut(k: string, s: number, x: number, z: number): void; startShootout(): void };
    if (kind === 'shootout') {
      dev.startShootout();
      return true;
    }
    const ad = m.attackDir(hs as Side);
    const gx = ad * HALF_L;
    const at = kind === 'freekick' ? [gx - ad * 22, 3] : kind === 'wide' ? [gx - ad * 20, 24] : kind === 'corner' ? [gx - ad * 0.35, HALF_W - 0.35] : [gx - ad * PEN_SPOT, 0];
    m.ball.owner = -1;
    dev.goOut(kind === 'wide' ? 'freekick' : kind, hs, at[0], at[1]);
    return true;
  }

  /** Dev (window.__bl.score): the score as given (yours, theirs), so the AI coach (sim/coach.ts) changes its plan at the next dead ball. */
  devScore(mine: number, theirs: number): boolean {
    const m = this.match;
    const hs = m.cfg.humanSide;
    if (hs < 0) return false;
    m.score[hs as Side] = Math.max(0, Math.floor(mine));
    m.score[hs === 0 ? 1 : 0] = Math.max(0, Math.floor(theirs));
    this.hud?.setScore(m.score[0], m.score[1]);
    return true;
  }

  /** The human side's goal celebration for the next goal (Settings > CELEBRATION changed mid-match). */
  setCelebration(id: string | undefined): void {
    this.opt.celebration = id;
  }

  /**
   * Build the SHOP effects' props now, off screen (the first goal or sprint of the match shouldn't hitch building
   * them): the equipped goal explosion's show and trail, run through once and cleared.
   */
  private warmFx(): void {
    const k = this.fxKit;
    const show = goalShow(this.opt.goalFx);
    if (show) {
      k.play(show.run, show.dur, 0, -60, 0, 1, 0, 1, goalFxColors(this.opt.goalFx, [0xffffff]), 0);
      for (let i = 0; i < 4; i++) k.update(show.dur / 3, this.world.camera);
    }
    const st = new TrailState();
    for (let i = 0; i < 8; i++) emitTrail(k, st, this.opt.trail, trailColors(this.opt.trail), i, -60, 0, 1, 0, 8, 0.1);
    k.update(0.1, this.world.camera);
    k.clear();
  }

  /** Dev (ui/shopStage.ts window.__blfx.goal): set goal explosion `id` off at the goal nearest the camera, now. */
  previewGoalFx(id: string): boolean {
    const show = goalShow(id);
    if (!show) return false;
    const gx = (Math.sign(this.cam.focusX) || 1) * HALF_L;
    this.fxKit.play(show.run, show.dur, gx, 0, 0, -Math.sign(gx), 0, 1, goalFxColors(id, [0xffffff, 0xffd23a]), 0);
    return true;
  }

  /** Dev (window.__blfx.trail): wear trail `id` from now on (the player you control on a sprint, your hard shots). */
  previewTrail(id: string): void {
    this.opt.trail = id;
    this.trailCols = null;
    this.trailFx.reset();
    this.ballFx.reset();
  }

  /** Light the match for a time of day and weather (sky, lights, stadium, footballers, particles, rain audio). */
  applyTimeOfDay(tod: TimeOfDay, wx: WeatherKind): void {
    const world = this.world;
    world.setTimeOfDay(tod, wx);
    // Night matches: the UI can key off this (vignette, HUD tint); the 3D vignette is the stadium's own.
    if (!this.demo) document.body.classList.toggle('night', tod === 'night');
    this.stadium.setTimeOfDay(tod);
    this.stadium.setWeather(wx);
    this.decor?.setTimeOfDay(tod);
    this.view.setTimeOfDay(tod, this.stadium.lightTowers);
    // Sunset: the footballers keep only ~8% of the orange light's tint, so a white kit stays white.
    if (tod === 'sunset') setCharacterWhiteBalance(world.sun.color, world.sun.intensity, world.hemi.color, world.hemi.intensity);
    else setCharacterWhiteBalance();
    this.weather.set(wx, world.quality);
    sfx.setRain(wx === 'rain');
  }

  /** Broadcast camera distance, live (Settings changed mid-match): the camera cuts to the new framing. */
  /** Change the ball's look mid-match (Settings > BALL). */
  setBallSkin(id: string | undefined): void {
    this.view.setBallSkin(id);
  }

  setCamZoom(z: CamZoom): void {
    this.cam.setZoom(z);
  }

  /**
   * The match camera, live (the owner: "zoom in or zoom out or perhaps a cinematic camera while playing"): the
   * HUD's camera button, V on a keyboard or VIEW on a pad steps WIDE, NORMAL, CLOSE, CINEMATIC; the board says which
   * and main.ts keeps it (onCamZoom), so Settings > CAMERA shows the same.
   */
  cycleCamZoom(): void {
    if (this.demo) return;
    const z = CAM_ZOOMS[(CAM_ZOOMS.indexOf(this.cam.zoom) + 1) % CAM_ZOOMS.length];
    this.cam.setZoom(z);
    this.hud?.toastMsg(`${z.toUpperCase()} CAMERA`, 1.2);
    buzz('camera');
    this.onCamZoom?.(z);
  }

  /** Settings > QUICK SUBS changed mid-match (off: the card goes, a queued change with it). */
  setQuickSubs(on: boolean): void {
    if (this.quick) this.quick.qs.enabled = on;
  }

  requestPause(): void {
    if (this.demo || this.paused) return;
    this.paused = true;
    this.input.reset();
    this.touch?.setVisible(false);
    this.clearLatch();
    sfx.setAmbienceActive(false);
    this.onPause?.();
  }

  resume(): void {
    this.paused = false;
    sfx.setAmbienceActive(!this.demo);
  }

  /** Make a substitution (human manager). Returns false if not allowed. */
  substitute(side: Side, slot: number, benchIdx: number): boolean {
    const m = this.match;
    const off = m.teamPlayers(side)[slot]?.def;
    const ok = m.substitute(side, slot, benchIdx);
    if (ok) {
      const on = m.teamPlayers(side)[slot];
      // Snapshot each manager change now. Two changes in the same slot before the next sim step would otherwise
      // both see only its final occupant when the queued events are drained.
      if (off && !this.demo && !this.driver && !this.moment && this.hud) {
        this.subQueue.push({ side, off, on: on.def, idx: on.idx, keeper: on.isKeeper });
      }
      this.wearing[on.idx] = on.def;
      this.view.replacePlayer(on.idx, on.def, this.opt.kits[side]);
    }
    return ok;
  }

  setMentality(side: Side, v: number): void {
    this.match.mentality[side] = Math.max(-1, Math.min(1, v));
  }

  continueSecondHalf(): void {
    // The AI managers (both in AI-vs-AI, never the human's) freshen up tired legs at the break.
    const m = this.match;
    if (m.phase !== 'halftime') return;
    // A native ad or an app interruption can pause the session while the half-time screen is opening. The
    // second-half action resumes that same session, as well as the simulation, and consumes the menu tap.
    this.resume();
    this.input.reset();
    this.clearLatch();
    this.anyPress = false;
    this.eatButtons = true;
    for (const side of [0, 1] as Side[]) {
      if (side === m.cfg.humanSide) continue;
      const before = m.teamPlayers(side).map((p) => p.def);
      m.aiSubs(side, 2);
      m.teamPlayers(side).forEach((p, i) => {
        if (p.def !== before[i]) this.view.replacePlayer(p.idx, p.def, this.opt.kits[side]);
      });
    }
    this.match.continueSecondHalf();
    this.resetView();
    this.halftimeFired = false;
    if (!this.startMatchInterlude('return')) this.hud?.show('SECOND HALF', '', 'small', 1.6);
  }

  /** The pad for the next sim step: the controls as they are now, plus any press latched since the last step. */
  private buildPad(): Pad {
    if (this.demo || this.match.cfg.humanSide < 0) return EMPTY_PAD;
    const c = this.input.read();
    const w = this.cam.screenToWorld(c.sx, c.sy);
    const l = this.latch;
    // A button still down from skipping the intro / the brief / the first-match hold is not a new press:
    // swallowed (with anything latched off it) until every button has been let go.
    if (this.eatButtons) {
      this.clearLatch();
      if (c.pass || c.shoot || c.through || c.skill || c.power) {
        return { mx: w.x, mz: w.z, sprint: c.sprint, pass: false, shoot: false, through: false, digital: this.input.lastDevice === 'keyboard', power: false, skill: false,
          autoSprint: this.autoSprint() };
      }
      this.eatButtons = false;
    }
    const pad: Pad = {
      mx: w.x, mz: w.z, sprint: c.sprint, pass: c.pass || l.pass, shoot: c.shoot || l.shoot, through: c.through || l.through,
      // AUTO SPRINT (touch): the thumbstick pushed all the way sprints (sim/dribble.ts autoRun).
      autoSprint: this.autoSprint(),
      // Keys give 8-way digital input: the sim turns set-piece aim gradually for those.
      digital: this.input.lastDevice === 'keyboard',
      // Blitz: use the held power-up (keyboard E / pad Y / the touch button, once the input maps it).
      power: ((c as { power?: boolean }).power ?? false) || l.power,
      // SKILL (Q / U, pad LB, the touch SKILL button): a skill move with the ball (sim/skills.ts).
      skill: c.skill || l.skill,
    };
    this.clearLatch();
    return pad;
  }

  /**
   * AUTO SPRINT is on for the pad: always with the touch stick in hand (there is no SPRINT button: the stick sprints),
   * and for keys and a gamepad by the setting (TouchControls.autoSprint, on unless he turned it off).
   */
  private autoSprint(): boolean {
    return this.input.lastDevice === 'touch' ? !!this.touch : TouchControls.autoSprint;
  }

  /** Note whichever action buttons are down right now (called on every key-down). */
  private latchPresses(c: { pass: boolean; shoot: boolean; through: boolean; power?: boolean; skill?: boolean }): void {
    if (this.demo || this.paused) return;
    const l = this.latch;
    l.pass ||= c.pass;
    l.shoot ||= c.shoot;
    l.through ||= c.through;
    l.power ||= c.power ?? false;
    l.skill ||= c.skill ?? false;
  }

  private clearLatch(): void {
    const l = this.latch;
    l.pass = l.shoot = l.through = l.power = l.skill = false;
  }

  /**
   * A touch that put the ball somewhere its flight never took it (onto a foot, down off a chest, into a keeper's
   * hands): the newest step's ball is that far (`j`) from the last one plus its velocity. The older frame takes
   * the jump too, so the blend between them never draws it, and the drawn ball is held back by it instead
   * (MatchView.ballGlide), closing over ~BALL_GLIDE_TAU: it travels there rather than teleporting a metre.
   */
  private glideBall(live: boolean): void {
    if (!live) return;
    const a = this.prev;
    const b = this.cur;
    const jx = b[BALL_OFS] - (a[BALL_OFS] + a[BALL_OFS + 3] * DT);
    const jy = b[BALL_OFS + 1] - (a[BALL_OFS + 1] + a[BALL_OFS + 4] * DT);
    const jz = b[BALL_OFS + 2] - (a[BALL_OFS + 2] + a[BALL_OFS + 5] * DT);
    const j = Math.hypot(jx, jy, jz);
    if (j < BALL_GLIDE_MIN || j > BALL_GLIDE_MAX) return;
    a[BALL_OFS] += jx;
    a[BALL_OFS + 1] += jy;
    a[BALL_OFS + 2] += jz;
    const g = this.view.ballGlide;
    g.x -= jx;
    g.y -= jy;
    g.z -= jz;
  }

  /** The drawn ball closes on the sim's; none outside live play or in a replay (a restart, a cut: it is just there). */
  private easeBallGlide(dt: number): void {
    const g = this.view.ballGlide;
    const k = this.match.phase === 'play' && !this.replay ? Math.exp(-dt / BALL_GLIDE_TAU) : 0;
    g.x *= k;
    g.y *= k;
    g.z *= k;
  }

  /** Hold the picture for `frames` 60 Hz frames (the longer of what is already held and this). */
  private hold(frames: number): void {
    this.hitStopT = Math.max(this.hitStopT, frames / 60);
  }

  /** Seconds of hit-stop left (tests / dev tools). */
  get hitStopLeft(): number {
    return this.hitStopT;
  }

  update(realDt: number): void {
    const dt = Math.min(realDt, 0.1);
    this.time += dt;
    const m = this.match;
    // (Online: the link is kept up every frame, whatever the screen is doing.)
    this.driver?.frame();
    const presentationPaused = this.paused || !!this.driver?.paused;
    if (!presentationPaused) this.foulPresentation.tick(dt);
    // (Not while a hit-stop holds the picture: the glide waits with it, or the ball jumps when it lets go.)
    if (!this.paused && this.hitStopT <= 1e-4) this.easeBallGlide(dt);
    // Hit flashes count rendered frames, before this frame's events (see MatchView.tickFlashes).
    if (!this.paused) this.view.tickFlashes(dt);

    // (A press only carries over to the next live step: nothing latched while the sim isn't stepping.)
    const briefing = this.moment !== null && this.moment.briefT > 0;
    if (this.paused || this.introLeft > 0 || this.replay || briefing || this.subCut || this.interlude) this.clearLatch();
    let held = false;
    if (this.paused) {
      // Frozen: live play, a replay or the pre-match fly-in all wait for the pause menu.
    } else if (this.hitStopT > 1e-4) {
      // Hit-stop: the drawn frame, the sim and the particles hold for a frame or two (the punch lands on it).
      // (The sim is simply not stepped: its clock waits, nothing in it is scaled or skipped.)
      this.hitStopT -= dt;
      held = true;
      // Picking up where the held frame (the newest step, drawn whole) left off: the next frame steps at once and
      // draws past it. (From an empty clock a fast display drew half a step BEHIND it first: a jolt back.)
      if (this.hitStopT <= 1e-4) this.acc = DT * 0.999;
    } else if (this.lineupLeft > 0) {
      this.stepLineup(dt);
    } else if (this.introLeft > 0) {
      this.introLeft -= dt;
      this.cam.introT = Math.min(1, 1 - this.introLeft / INTRO_S);
      const c = this.input.read();
      const btn = c.pass || c.shoot || c.through;
      if (btn && !this.prevButtons) this.introLeft = 0;
      this.prevButtons = btn;
      if (this.introLeft <= 0) {
        this.cam.setMode('broadcast');
        // Skipped (or over): the pre-match title card goes with the fly-in, never lingering over the kick-off.
        this.hud?.hideIntro();
        // The button that skipped it never doubles as the kick-off (the sim reads a press edge next step).
        this.eatButtons = btn;
      }
      this.view.apply(this.prev, this.cur, 1, this.time, dt);
    } else if (briefing) {
      // The moment's brief: the picture holds on the set-up until "GO!".
      const mo = this.moment!;
      mo.briefT -= dt;
      if (mo.briefT <= 0) {
        this.hud?.hideIntro();
        this.hud?.show('GO!', '', 'goal', 0.9);
        sfx.whistle('short');
        this.eatButtons = true;
      }
      this.view.apply(this.prev, this.cur, 1, this.time, dt);
    } else if (this.holdFirst) {
      this.firstMatchHold(dt);
    } else if (this.interlude) {
      this.stepMatchInterlude(dt);
    } else if (this.subCut) {
      this.stepSubCut(dt);
    } else if (this.replay) {
      this.stepReplay(dt);
    } else if (this.holdLesson()) {
      this.acc = 0;
      this.view.apply(this.prev, this.cur, 1, this.time, dt);
    } else {
      const drv = this.driver;
      // (A PERFECT skill move's slow-motion beat: against the AI only, never in an online match's lockstep.)
      const slow = !drv && this.slowT > 0 ? this.slowRate : 1;
      if (this.slowT > 0) this.slowT -= dt;
      this.acc += drv ? dt * drv.pace() : dt * slow;
      let steps = 0;
      let waited = false;
      while (this.acc >= DT && steps < 6) {
        let pad: Pad | readonly [Pad, Pad];
        if (drv) {
          const pp = drv.next(() => this.buildPad());
          if (!pp) {
            // Waiting on the other machine: hold the picture, and don't bank the time (no burst once it comes).
            this.acc = Math.min(this.acc, DT);
            waited = true;
            break;
          }
          pad = pp;
        } else pad = this.buildPad();
        this.prev.set(this.cur);
        this.ownerBefore = m.ball.owner;
        const hs = m.cfg.humanSide;
        this.activeBefore = hs === 0 || hs === 1 ? m.activeOf(hs) : -1;
        this.ballSpeedBefore = Math.hypot(m.ball.vel.x, m.ball.vel.y, m.ball.vel.z);
        const livePrev = m.phase === 'play';
        m.step(DT, pad);
        drv?.after(m);
        // (Events first: a TACKLE press this step is baked into this very frame as the lunge.)
        const evs = m.drainEvents();
        this.handleEvents(evs);
        matchAudio.events(evs, m);
        this.fun?.after(evs);
        if (this.moment) this.judgeMoment();
        for (let i = 0; i < 22; i++) if (this.lunge[i] >= 0 && (this.lunge[i] += DT) >= LUNGE_S) this.lunge[i] = -1;
        writeFrame(m, this.cur, this.time, this.lunge, this.lungeLeg);
        this.glideBall(m.phase === 'play' && livePrev);
        this.buffer.push(m, this.time, this.lunge, this.lungeLeg);
        this.recorded++;
        this.acc -= DT;
        steps++;
        if (this.hitStopT > 1e-4) {
          // Freeze on the impact frame: whatever was left over is dropped, never caught up after the hold.
          this.acc = 0;
          break;
        }
      }
      if (steps === 6) this.acc = 0;
      this.netWaitS = waited && steps === 0 ? this.netWaitS + dt : 0;
      // (See PHASE_WANT: at about the step rate, keep the drawn frame close to the newest step.)
      const stopped = this.hitStopT > 1e-4;
      if (dt > DT * 0.8 && dt < DT * 2.5 && !stopped && !waited) this.acc += clamp(PHASE_WANT * DT - this.acc, -PHASE_NUDGE * DT, PHASE_NUDGE * DT);
      this.view.apply(this.prev, this.cur, stopped ? 1 : clamp(this.acc / DT, 0, 1), this.time, dt);
      this.updateFrameFx(dt);
      this.updateBlitz(dt);
      this.flow(dt);
      // A change made (yours or theirs): its touchline shot, now that play has stopped.
      if (this.subCutReady()) this.startSubCut();
      if (this.cardT > 0) {
        if (!presentationPaused) this.cardT -= dt;
        // The shot belongs to this stoppage and this footballer, even if a kick and another whistle
        // arrive in the same rendered frame or the manager substitutes him while paused.
        if (this.cardT <= 0 || (m.phase !== 'out' && m.phase !== 'restart') || m.restart !== this.cardRestart ||
          m.players[this.cardPlayer]?.def.id !== this.cardIdentity) {
          this.cardT = 0;
          this.cardRestart = null;
          this.cardIdentity = null;
          this.view.pinPlayer(null);
          this.view.setBallHidden(false);
          this.cardPlayer = -1;
          this.cardVictim = -1;
          if (this.cam.mode === 'card') this.cam.setMode('broadcast');
        }
      }
    }

    if (!presentationPaused) {
      const decision = this.foulPresentation.take(m.phase, m.restart);
      if (decision?.booking) this.showBooking(decision.booking);
      if (decision?.verdict) this.showRestart(decision.verdict.kind);
    }

    // Camera: the live-play focus (ball, controlled player, possession lean, set piece; see camFocus), with
    // the subject swapped for the celebrating scorer / the shootout winners.
    const f = this.view.frame;
    const focus = playFocus(m, f, this.view.headTop, this.focusOut);
    if (this.foulPresentation.impact(m.phase, m.restart)) {
      // Stay with the fallen player while the impact settles, rather than framing the new taker early.
      focus.bx = focus.ax = this.foulAt.x;
      focus.bz = focus.az = this.foulAt.z;
      focus.bvx = focus.bvz = 0;
      focus.setPiece = null;
      focus.hold = false;
    }
    let ax = focus.ax;
    let az = focus.az;
    let avx = 0;
    let avz = 0;
    let subject = -1;
    let group = 0;
    let groupFacing: number | undefined;
    let lockAngle: number | undefined;
    let close = false;
    let tight = false;
    const soWinner = m.shootout && m.phase === 'fulltime' ? m.shootout.winner : -1;
    if (this.cam.mode === 'celebrate' && soWinner >= 0) {
      // Shootout won: the winners' pile-up (the sim gathers them round a hub on the halfway line).
      let n = 0;
      let sx = 0;
      let sz = 0;
      for (const p of m.teamPlayers(soWinner as Side)) {
        if (p.state !== 'celebrate') continue;
        sx += f[p.idx * PF];
        sz += f[p.idx * PF + 1];
        n++;
      }
      ax = n ? sx / n : 0;
      az = n ? sz / n : HALF_W * 0.3;
      group = 3;
      // The sim turns the pile-up to face the main stand (+z).
      groupFacing = Math.PI / 2;
    } else if (this.cam.mode === 'celebrate' && (m.celebHero >= 0 || m.lastGoalScorer >= 0)) {
      // The scorer, and the team-mates arriving to mob him: frame the bunch (weighted to the scorer).
      // On an own goal the sim picks the nearest attacker as the celebrating "hero".
      const si = m.celebHero >= 0 ? m.celebHero : m.lastGoalScorer;
      const sc = m.players[si];
      const sx = f[si * PF];
      const sz = f[si * PF + 1];
      let cx = sx * 2;
      let cz = sz * 2;
      let n = 2;
      const near = this.celebNear;
      near.length = 0;
      for (const p of m.teamPlayers(sc.side)) {
        const o = p.idx * PF;
        if (p.idx === si || f[o + 4] !== STATE_CODE.celebrate) continue;
        if (Math.hypot(f[o] - sx, f[o + 1] - sz) > 6.5) continue;
        cx += f[o];
        cz += f[o + 1];
        n++;
        near.push(o);
      }
      cx /= n;
      cz /= n;
      let g = Math.hypot(sx - cx, sz - cz);
      for (const o of near) g = Math.max(g, Math.hypot(f[o] - cx, f[o + 1] - cz));
      this.celebG = damp(this.celebG, Math.min(3.5, g), 2.5, this.paused ? 0 : dt);
      ax = cx;
      az = cz;
      // (A choreographed celebration draws the scorer somewhere the sim isn't running him: lead by what is drawn.)
      const rig = this.view.celeb;
      avx = ((rig.active ? rig.heroVx : sc.vel.x) * 2) / n;
      avz = ((rig.active ? rig.heroVz : sc.vel.z) * 2) / n;
      // (A move that wants a particular angle, e.g. the backflip in profile, tells the camera its "front".)
      if (rig.active && rig.camFacing !== undefined) groupFacing = rig.camFacing;
      if (rig.active && rig.camLock !== undefined) {
        // A move filmed from its own angle (the flip side-on, the shush's close-up): the scorer alone, the
        // lens exactly where the choreography puts it.
        lockAngle = rig.camLock;
        close = rig.camClose;
        ax = sx;
        az = sz;
        avx = rig.heroVx;
        avz = rig.heroVz;
        group = 0;
      }
      subject = si;
      group = lockAngle === undefined ? this.celebG : 0;
      // YOUR scorer is filmed full length and big (his kit, boots and hair are seen), the mob round him; the other
      // side's keeps the wider shot. (A move with its own lens, or a group shot after a shootout, is left alone.)
      tight = lockAngle === undefined && m.phase === 'goal' && sc.side === m.cfg.humanSide && !m.cfg.humanSides;
      if (tight) {
        group = Math.min(group, 0.5);
        ax = (sx * 3 + cx) / 4;
        az = (sz * 3 + cz) / 4;
      }
    }
    this.updateScene();
    const ref = this.cam.mode === 'card' ? this.view.refState : null;
    this.trackHold();
    // (The focus object is reused frame to frame: filled in place, never spread into a new one.)
    focus.ax = ax;
    focus.az = az;
    focus.avx = avx;
    focus.avz = avz;
    focus.subject = subject;
    focus.group = group;
    focus.groupFacing = groupFacing;
    focus.lockAngle = lockAngle;
    focus.close = close;
    focus.tight = tight;
    focus.scene = this.cam.mode === 'scene' ? this.sceneShot : null;
    if (this.replay) focus.setPiece = null;
    focus.hold = !this.replay && focus.hold;
    if (ref) {
      const cf = this.cardFocus;
      cf.rx = ref.x;
      cf.rz = ref.z;
      cf.fx = ref.faceX;
      cf.fz = ref.faceZ;
      focus.card = cf;
    } else focus.card = null;
    // A big chance: the broadcast lens pushes in and leans towards the goal (see CHANCE_S).
    this.updateChance();
    this.cam.viewH = typeof window !== 'undefined' ? window.innerHeight : 720;
    this.cam.update(this.paused ? 0 : dt, focus, this.time);
    // Low cameras (over the set-piece taker's shoulder, the shootout) drop the name tag and arrow, which would
    // otherwise float over the goal mouth; the referee close-up drops the marker altogether.
    this.view.setMarkerMode(this.cam.mode === 'card' || this.cam.mode === 'scene' ? 'off' : this.cam.behindActive || this.cam.mode === 'penalty' ? 'ring' : 'full');
    // The Mega Dome's arch: never for the menu orbit or the pre-match fly-in (their paths cut through it).
    this.stadium.setArchVisible(this.cam.mode !== 'menu' && this.cam.mode !== 'intro');
    // Team rings: the broadcast shot (and the fly-in landing on it) only; never under a low or close lens.
    this.view.setTeamRings((this.cam.mode === 'broadcast' && !this.cam.behindActive) || this.cam.mode === 'intro');
    // Team pips over the human's team-mates: the broadcast shot only.
    this.view.setTeamPips(this.cam.mode === 'broadcast' && !this.cam.behindActive && !this.replay);
    // The referee close-up is a clean cinematic frame: the HUD drops its ticker, tags and touch buttons. A staged
    // shot (the line-up, a change, the man of the match) too, and its caption has the banner's place ('staged').
    const cine = this.cam.mode === 'card' || this.cam.mode === 'scene';
    if (cine !== this.cineHud) {
      this.cineHud = cine;
      this.hud?.setCinematic(cine);
    }
    if (this.present) {
      this.hud?.root.classList.toggle('staged', this.cam.mode === 'scene');
      this.present.update(this.paused ? 0 : dt);
    }
    this.updateFades(ref, this.paused ? 0 : dt);
    // Shadow budget: on the lower settings only the players nearest the ball cast (see MatchView).
    this.view.setShadowBudget(this.world.quality === 'high' ? null : this.world.quality === 'medium' ? 6 : 0);
    this.world.focusShadows(this.cam.focusX, this.cam.focusZ);
    this.stadium.updateGlare(this.world.camera);
    if (this.weather.kind === 'rain' && !this.paused) this.effects.rain(dt, this.cam.focusX, this.cam.focusZ, 22, 15, 90, this.world.camera.position);
    this.view.faceCamera(this.world.camera);
    this.view.updateReferee(presentationPaused ? 0 : dt, this.time, !this.replay);
    this.stadium.update(dt, this.time);
    // (The mascot's cutaway, under a second, may take the lens during a goal celebration only: never a replay, and
    // never a celebration filmed from its own angle, the flip or the shush, whose moment it would cut away from.)
    this.decor?.update(this.paused ? 0 : dt, this.time, m.phase === 'goal' && !this.replay && focus.lockAngle === undefined);
    this.effects.update(held || this.paused ? 0 : dt);
    this.fxKit.update(held || this.paused ? 0 : dt, this.world.camera);
    this.weather.update(dt, this.cam.focusX, this.cam.focusZ, this.time, this.world.camera.position);
    this.updateAtmosphere(dt);
    this.updateHud(dt);
    this.fun?.frame(this.paused ? 0 : dt);
    this.updateQuickSub(dt);
    // Online: the man the other player controls gets his own ring.
    if (this.driver) {
      const hs = m.cfg.humanSide;
      this.view.setRival(hs === 0 || hs === 1 ? m.activeOf(hs === 0 ? 1 : 0) : -1);
    }
    this.updateGhost(this.paused ? 0 : dt);
    this.flash.update(this.paused ? 0 : dt);
    this.clips.update(this.paused ? 0 : dt);
    // The clip of a goal with no replay: the celebration, until the kick-off.
    if (this.clipLive && this.clips.recording && m.phase !== 'goal') this.endClip();
    if (this.posterWanted) this.takePoster();
    this.anyPress = false;
  }

  /** Untimed teaching cards hold players and the ball, rather than letting the AI spoil the setup. */
  private holdLesson(): boolean {
    const lesson = this.moment?.spec.untimed ? Trainer.lesson : null;
    if (!lesson || this.match.phase !== 'play') return false;
    const c = this.input.read();
    if (this.eatButtons) {
      if (c.pass || c.shoot || c.through) { this.clearLatch(); return true; }
      this.eatButtons = false;
    }
    return lesson.hold(this.match, { ...c, pass: c.pass || this.latch.pass,
      shoot: c.shoot || this.latch.shoot, through: c.through || this.latch.through });
  }

  /** Recovery timers use live simulation time, so reading a cue never causes an unexplained retry. */
  get teachingHeld(): boolean {
    return !!this.moment?.spec.untimed && this.match.phase === 'play' && this.holdLesson();
  }

  /** Goal → celebration → replay → kick-off; half/full time callbacks. */
  private flow(dt: number): void {
    const m = this.match;
    if (this.driver) {
      this.netFlow();
      return;
    }
    if (m.phase === 'goal') {
      if (this.demo) {
        if (m.phaseT > Math.max(3.2, this.view.celeb.holdS)) {
          this.view.celeb.end();
          m.resumeAfterGoal();
        }
        return;
      }
      // A beat on the wide shot (the ball in the net), then cut to the scorer and his team-mates.
      if (!this.replay && !this.replayDone && this.cam.mode !== 'celebrate' && m.phaseT > this.goalWideS) this.cam.setMode('celebrate');
      // (A goal explosion's longer wide shot pushes the celebration, the replay and the kick-off back by as much.)
      const late = this.goalWideS - GOAL_WIDE_S;
      if (this.celebDue !== -1 && m.phaseT > late) {
        const sd = this.celebDue;
        this.celebDue = -1;
        this.startCelebration(sd);
      }
      // The replay rolls for a goal worth seeing again; a plain one goes straight from the celebration to the
      // kick-off (round 9's critic: every goal replayed cost 8.5 s, ~7% of a two-minute half).
      // (An iconic celebration holds the replay / kick-off until its moment has landed: celeb.holdS.)
      const theirs = m.cfg.humanSide >= 0 && m.goalSide !== m.cfg.humanSide && !this.replayWanted;
      const at = theirs ? THEIR_GOAL_AT + late : Math.max(this.replayWanted ? REPLAY_AT : NO_REPLAY_AT, this.view.celeb.holdS) + late;
      // A tap once the wide shot has had its moment gets on with it: no more celebration, no replay.
      const skippable = !this.moment && !this.replayDone && m.phaseT > this.goalWideS + GOAL_SKIP_GRACE;
      this.hud?.setSkippable(skippable);
      if (skippable && this.anyPress) {
        this.replayWanted = false;
        this.replayDone = true;
        this.hud?.setSkippable(false);
        // (The press that skipped it is never also the kick-off.)
        this.eatButtons = true;
      }
      if (this.moment?.outcome) {
        // The goal settled the moment: no replay, no kick-off; the verdict once the celebration has landed
        // (the party plays on under it).
        if (m.phaseT > at) this.finishMoment();
      } else if (m.phaseT > at && !this.replayDone) {
        if (this.replayWanted) this.startReplay();
        else this.replayDone = true;
      } else if (this.replayDone) {
        this.replayDone = false;
        this.view.celeb.end();
        m.resumeAfterGoal();
        this.cam.setMode('broadcast');
        this.view.setMarkerVisible(m.cfg.humanSide >= 0);
        // Straight to the kick-off framing: never a glide from the replayed goal to the centre spot.
        this.resetView();
      }
    }
    if (this.moment) {
      this.momentFlow(dt);
      return;
    }
    if (m.phase === 'halftime' && !this.halftimeFired && m.phaseT > HALFTIME_HOLD_S) {
      if (this.demo) {
        this.halftimeFired = true;
        m.continueSecondHalf();
      } else if (!this.interlude && !this.startMatchInterlude('halftime')) {
        this.halftimeFired = true;
        this.onHalftime?.();
      }
    }
    if (m.phase === 'shootout' && !this.so && this.hud) this.startShootoutView();
    if (m.phase === 'fulltime' && !this.finishFired && m.phaseT > (m.shootout ? SHOOTOUT_HOLD_S : FULLTIME_HOLD_S)) {
      if (this.demo) {
        this.finishFired = true;
        return;
      }
      if (!this.sportsmanshipDone) {
        this.sportsmanshipDone = true;
        if (this.startMatchInterlude('sportsmanship')) return;
      }
      if (this.interlude) return;
      // The man of the match first (a tap moves on), then the result screen.
      if (this.motmBeat(dt)) return;
      this.finishFired = true;
      this.onFinish?.({
        score: [...m.score] as [number, number], humanSide: m.cfg.humanSide, match: m, ratings: this.ratings(), winner: this.winner(),
        fun: this.fun?.summary(),
      });
    }
  }

  /**
   * flow() for an online match: the driver moves the sim on from a goal and from half time by itself (the same
   * tick on both machines: src/net/setup.ts netStoppages), so this only follows with the picture: the wide shot
   * then the scorer, back to the broadcast shot at the kick-off, a banner through the break, and full time.
   */
  private netFlow(): void {
    const m = this.match;
    if (m.phase === 'goal' && this.cam.mode !== 'celebrate' && m.phaseT > this.goalWideS) this.cam.setMode('celebrate');
    // (A celebration held back for a goal explosion starts as in flow().)
    if (this.celebDue !== -1 && m.phase === 'goal' && m.phaseT > this.goalWideS - GOAL_WIDE_S) {
      const sd = this.celebDue;
      this.celebDue = -1;
      this.startCelebration(sd);
    }
    const was = this.netPhase;
    if (m.phase !== was) {
      this.netPhase = m.phase;
      if (was === 'goal') {
        this.celebDue = -1;
        this.view.celeb.end();
        this.cam.setMode('broadcast');
        this.view.setMarkerVisible(true);
        this.resetView();
      } else if (was === 'halftime') {
        this.resetView();
        this.hud?.show('SECOND HALF', '', 'small', 1.6);
      }
      if (m.phase === 'halftime') {
        const [h, a] = m.teams;
        this.hud?.show('HALF TIME', `${h.short} ${m.score[0]} - ${m.score[1]} ${a.short}`, 'small', 3.2);
      }
    }
    // A level tie with IF LEVEL: PENALTIES (MatchSetup.knockout): the shootout, each player taking his own side's
    // kicks and keeping his own goal.
    if (m.phase === 'shootout' && !this.so && this.hud) this.startShootoutView();
    if (m.phase === 'fulltime' && !this.finishFired && m.phaseT > (m.shootout ? SHOOTOUT_HOLD_S : FULLTIME_HOLD_S)) {
      this.finishFired = true;
      this.onFinish?.({
        score: [...m.score] as [number, number], humanSide: m.cfg.humanSide, match: m, ratings: this.ratings(), winner: this.winner(),
        fun: this.fun?.summary(),
      });
    }
  }

  /**
   * The first match's hold on the kick-off framing (see holdFirst): the picture is live (rings, crowd, the
   * camera), the sim waits, a card names the player's man; the first stick movement or button lets it go.
   */
  private firstMatchHold(dt: number): void {
    const m = this.match;
    if (!this.hud || m.phase !== 'kickoff') {
      this.holdFirst = false;
      return;
    }
    if (!this.firstCardUp) {
      // (An 'intro' card: hideIntro() takes it down the moment the hold is released.)
      this.firstCardUp = true;
      const you = colourName(this.view.teamColor.fill);
      const dev = this.input.lastDevice;
      const move = dev === 'gamepad' ? 'the left stick' : dev === 'touch' ? 'the stick' : moveKeys('keyboard').replace(' / ', ' or ');
      // (A short title: the banner's letters are huge; "YOU ARE THE BLUE RING" ran off both edges.)
      this.hud.show('THIS IS YOU', `The ${you} ring. Move with ${move} to start`, 'small intro', 30);
    }
    const c = this.input.read();
    const btn = c.pass || c.shoot || c.through;
    const moved = Math.hypot(c.sx, c.sy) > 0.3;
    if (moved || (btn && !this.eatButtons) || this.latch.pass || this.latch.shoot || this.latch.through) {
      this.holdFirst = false;
      this.hud.hideIntro();
      // A button that released the hold is not the kick-off (the sim makes it wait for its own press).
      this.eatButtons = this.eatButtons || btn;
      this.clearLatch();
    } else if (!btn) this.eatButtons = false;
    this.view.apply(this.prev, this.cur, 1, this.time, dt);
  }

  /** Each live step of a moment: the referee's verdict, or the sim ending the half under it (time up, unjudged). */
  private judgeMoment(): void {
    const mo = this.moment!;
    const m = this.match;
    if (mo.outcome) return;
    let o = judgeScenario(m, mo.spec);
    if (!o && (m.phase === 'halftime' || m.phase === 'fulltime')) o = { won: false, stars: 0, secondsLeft: 0 };
    if (!o) return;
    mo.outcome = o;
    // No replay of the goal that settled it: the celebration, then the verdict (its clip is the celebration).
    this.replayWanted = false;
    if (m.phase === 'goal' && this.clipName && !this.clips.recording) this.startClip(true);
    // Settled in open play (time up, a concession): straight to the verdict. A goal: after its celebration.
    if (m.phase !== 'goal') this.finishMoment();
  }

  /** The moment is over: the whistle, the verdict card, the sim stopped; the full-time screen after a beat. */
  private finishMoment(): void {
    const mo = this.moment!;
    const m = this.match;
    if (mo.endT >= 0) return;
    mo.endT = MOMENT_END_S;
    const o = mo.outcome ?? { won: false, stars: 0, secondsLeft: 0 };
    // The final whistle now (the sim's own end-of-match events follow), unless the goal that settled it is
    // still being celebrated: then the party plays on under the card and the whistle goes with the result.
    if (m.phase !== 'goal') finishScenario(m);
    // (Short titles: the banner's letters are huge; "MOMENT COMPLETE" ran off both edges.)
    const stars = o.won ? '★'.repeat(o.stars) + '☆'.repeat(Math.max(0, 3 - o.stars)) : '';
    this.hud?.show(o.won ? 'COMPLETE!' : 'FAILED', o.won ? `MOMENT ${stars}` : 'Try again', o.won ? 'goal' : 'small goal against', MOMENT_END_S + 0.4);
    if (o.won) {
      sfx.cheer(1.4);
      this.goalHypeT = Math.max(this.goalHypeT, 3);
    }
    this.view.setMarkerVisible(false);
  }

  /** A moment's own half / full time: never the half-time menu; the full-time screen once the verdict has landed. */
  private momentFlow(dt: number): void {
    const mo = this.moment!;
    const m = this.match;
    if (mo.endT < 0 || this.finishFired) return;
    // (A settling goal keeps the goal phase, and its celebration, going under the verdict card.)
    mo.endT -= dt;
    if (mo.endT > 0) return;
    this.finishFired = true;
    const o = mo.outcome ?? { won: false, stars: 0, secondsLeft: 0 };
    // (Settled by a goal: the whistle goes now, with the celebration done; the match is at full time for the result.)
    finishScenario(m);
    this.view.celeb.end();
    this.onFinish?.({
      score: [...m.score] as [number, number], humanSide: m.cfg.humanSide, match: m, ratings: this.ratings(), winner: this.winner(),
      scenarioOutcome: o,
    });
  }

  /** Players were just reset (kick-off): show the new positions this frame and cut the camera to them. */
  private resetView(): void {
    this.foulPresentation.clear();
    writeFrame(this.match, this.cur, this.time);
    this.prev.set(this.cur);
    this.acc = 0;
    this.view.apply(this.prev, this.cur, 1, this.time, 0);
    this.cam.cut();
  }

  /** Who won: by the score, or by the shootout in a level knockout tie. */
  private winner(): Side | undefined {
    const m = this.match;
    if (m.score[0] !== m.score[1]) return m.score[0] > m.score[1] ? 0 : 1;
    const w = m.shootout?.winner ?? -1;
    return w >= 0 ? (w as Side) : undefined;
  }

  /** Level knockout tie at the final whistle: penalty camera, kick tracker, banner (no replays from here). */
  private startShootoutView(): void {
    const m = this.match;
    const so = m.shootout!;
    const [h, a] = m.teams;
    const [kh, ka] = this.opt.kits;
    this.so = new ShootoutHud(this.hud!.root, [
      { short: h.short, color: kh.shirt, color2: kh.shirt2 },
      { short: a.short, color: ka.shirt, color2: ka.shirt2 },
    ]);
    this.so.update(so);
    this.cam.penaltyGoal = so.goal;
    this.cam.setMode('penalty');
    this.cam.cut();
    this.view.setMarkerVisible(m.cfg.humanSide >= 0);
    this.hud?.show('PENALTIES!', `${h.short} ${m.score[0]} - ${m.score[1]} ${a.short}`, 'small', 2.2);
  }

  /** DLS-style 1–10 match ratings from what each player actually did, best first (see game/ratings.ts). */
  ratings(): PlayerRating[] {
    return this.tally.ratings(this.match);
  }

  /**
   * Hand the scoring side's celebration to the choreography rig (render/celebration.ts): the human's chosen
   * move (SessionOptions.celebration), a random one of the AI's for the other side. 'classic' (and an unknown
   * id) leaves the sim's own celebration to run.
   */
  private startCelebration(side: Side): void {
    const m = this.match;
    const rig = this.view.celeb;
    rig.end();
    if (m.phase !== 'goal' || m.celebHero < 0) return;
    const chosen = this.opt.celebration;
    const mine = side === m.cfg.humanSide && chosen && (CELEBRATION_IDS as readonly string[]).includes(chosen) ? (chosen as CelebrationId) : null;
    const id = mine ?? AI_CELEBRATIONS[Math.floor(Math.random() * AI_CELEBRATIONS.length)];
    if (id === 'classic') return;
    const hero = m.players[m.celebHero];
    const cast = m.teamPlayers(side)
      .filter((p) => !p.isKeeper && !isSentOff(p) && p.state === 'celebrate')
      .map((p) => ({ idx: p.idx, x: p.pos.x, z: p.pos.z, facing: p.facing, vx: p.vel.x, vz: p.vel.z, runPhase: p.runPhase }));
    rig.begin(id, hero.idx, cast, Math.sign(hero.pos.x) || 1);
  }

  /** The choreography's moments: grass off the knee slide, the flip's whoosh, the landing's dust, the pile's thuds and roar. */
  private celebCue(c: CelebCue): void {
    const fx = this.effects;
    switch (c.kind) {
      case 'spray':
        fx.dust(c.x - c.ux * 0.4, c.z - c.uz * 0.4, 1, 0.7, -c.ux * 1.4, -c.uz * 1.4, 0.1);
        if (Math.random() < 0.6) fx.grass(c.x - c.ux * 0.3, c.z - c.uz * 0.3, 2, 0.7);
        break;
      case 'whoosh':
        sfx.whoosh();
        fx.dust(c.x, c.z, 5, 0.5);
        break;
      case 'land':
        fx.dust(c.x, c.z, 9, 0.8);
        fx.grass(c.x, c.z, 4, 0.5);
        sfx.flop();
        break;
      case 'thud':
        fx.dust(c.x, c.z, 7, 0.7);
        sfx.flop();
        break;
      case 'roar':
        sfx.cheer(1.6);
        this.goalHypeT = Math.max(this.goalHypeT, 4);
        break;
      case 'apex':
        // The top of the backflip: the picture holds a couple of frames (the tuck, upside down, reads).
        this.hold(HIT_STOP_APEX);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ juice helpers

  /** Note a kick's trail style at the session time its frame is stamped with (replays look it up). */
  private logKick(style: TrailStyle, mine = false): void {
    const i = this.kickLogI;
    this.kickLogT[i] = this.time;
    this.kickLogS[i] = style;
    this.kickLogMine[i] = mine ? 1 : 0;
    this.kickLogI = (i + 1) % KICK_LOG;
  }

  /** Whether the last kick at or before session time `t` was a hard strike of the human side's (as styleAt). */
  private mineAt(t: number): boolean {
    let best = -1;
    let bt = -Infinity;
    for (let i = 0; i < KICK_LOG; i++) {
      const k = this.kickLogT[i];
      if (k <= t + 1e-4 && k > bt) {
        bt = k;
        best = i;
      }
    }
    return best >= 0 && this.kickLogMine[best] === 1;
  }

  /** The trail style of the last kick at or before session time `t` (a replayed frame's own stamp). */
  private styleAt(t: number): TrailStyle {
    let best = -1;
    let bt = -Infinity;
    for (let i = 0; i < KICK_LOG; i++) {
      const k = this.kickLogT[i];
      if (k <= t + 1e-4 && k > bt) {
        bt = k;
        best = i;
      }
    }
    return best >= 0 ? this.kickLogS[best] : 'strike';
  }

  /**
   * A big chance for the camera (see CHANCE_S): a shot struck at goal from within CHANCE_RANGE, still loose and
   * going goalwards; and the goal's own wide shot (the ball in the net) before the cut to the scorer.
   */
  private updateChance(): void {
    const m = this.match;
    const cam = this.cam;
    let c = 0;
    if (!this.replay && m.phase === 'play' && m.shotClock < CHANCE_S && m.ball.owner < 0 && !m.ball.held) {
      const ad = m.attackDir(m.shotSide);
      const b = m.ball;
      if (b.vel.x * ad >= CHANCE_MS && Math.abs(ad * HALF_L - b.pos.x) < CHANCE_RANGE && Math.abs(b.pos.z) < HALF_W * 0.8) {
        c = 1;
        cam.chanceGoal = ad;
      }
    } else if (!this.replay && m.phase === 'goal' && m.phaseT < this.goalWideS) {
      c = 1;
      cam.chanceGoal = Math.sign(m.ball.pos.x) || 1;
    }
    cam.chance = c;
  }

  /**
   * Set-piece ghost arc (Easy / Normal): while the human lines up a free kick, corner or penalty (or his
   * shootout kick), a dotted preview of the ball's path for the aim and power on right now (game/ghostArc.ts),
   * fading once it is struck.
   */
  private updateGhost(dt: number): void {
    const m = this.match;
    const hs = m.cfg.humanSide;
    this.spAim?.update(dt);
    const want = !this.demo && hs >= 0 && m.cfg.difficulty <= GHOST_MAX_DIFFICULTY;
    if (!want) return;
    const g = (this.ghost ??= this.makeGhost());
    const L = this.ghostLaunch();
    if (L) {
      // (A shooting free kick's path is flown against the wall, as the kick will be: it ends there when it is blocked.)
      g.show(this.ghostPath, flyGhost(L, this.ghostPath, this.freeKickWall()));
      g.setBlocked(ghostBlocked);
    } else g.release();
    if (this.replay || this.cam.mode === 'card') g.clear();
    g.update(dt, this.world.camera.position);
  }

  /** The wall his shooting free kick has to beat (where its men stand, how bent the kick is), or undefined. */
  private freeKickWall(): GhostWall | undefined {
    const m = this.match;
    const r = m.restart;
    const hs = m.cfg.humanSide;
    if (!r || r.kind !== 'freekick' || !m.penAim || hs < 0) return undefined;
    const w = this.ghostWall;
    w.spots.length = 0;
    for (const idx of m.brains[hs === 0 ? 1 : 0].spWall) if (!m.players[idx].sentOff) w.spots.push(m.players[idx].pos);
    w.bend = Math.min(1, Math.abs(m.fkCurl));
    return w;
  }

  /**
   * His set-piece aim on the pitch (render/setPieceAim.ts): the landing ring of a corner or a wide free kick with the
   * runs into the box, and the power ring round a shooting free kick's reticle while SHOOT is held.
   */
  private updateSetPieceAim(cinematic: boolean): void {
    const sp = this.spAim;
    if (!sp) return;
    const m = this.match;
    const hs = m.cfg.humanSide;
    const r = m.restart;
    const live = !cinematic && hs >= 0 && m.phase === 'restart' && !!r && this.cam.mode === 'broadcast' && this.introLeft <= 0;
    const zone = live ? m.zoneAim : null;
    sp.setZone(zone);
    let runs: RunArrow[] | null = null;
    if (zone && !zone.locked) {
      const br = m.brains[hs as Side];
      runs = this.runArrows;
      runs.length = 0;
      for (const idx of br.spRunners) {
        const p = m.players[idx];
        const to = idx === zone.runner ? zone : br.spZones.get(idx);
        if (!to || p.sentOff) continue;
        runs.push({ x0: p.pos.x, z0: p.pos.z, x1: to.x, z1: to.z, hot: idx === zone.runner });
      }
    }
    sp.setRuns(runs);
    const pen = live && r?.kind === 'freekick' ? m.penAim : null;
    sp.setPower(pen && !pen.locked && m.shootCharge > 0.04 ? clamp(m.shootCharge / SHOOT_BAR, 0, 1) : null, pen);
  }

  private makeGhost(): GhostArc {
    const g = new GhostArc();
    this.view.group.add(g.mesh);
    return g;
  }

  /** The launch the human's set piece would have if struck now, or null when there's nothing to preview. */
  private ghostLaunch(): GhostLaunch | null {
    const m = this.match;
    const hs = m.cfg.humanSide as Side;
    const b = m.ball.pos;
    const out = this.ghostL;
    const so = m.phase === 'shootout' ? m.shootout : null;
    const r = m.restart;
    // A penalty (in the match or his shootout kick): through the reticle, at the power charged so far (let go of
    // SHOOT, the last path, at the power it was struck with, fades out).
    const pen = m.penAim;
    if (so || (pen && r?.kind === 'penalty')) {
      if (!pen || pen.locked || !r || r.side !== hs) return null;
      if (!so && (this.cam.mode !== 'broadcast' || this.introLeft > 0)) return null;
      const t = m.players[r.taker];
      const p = m.shootCharge > 0.04 ? clamp(m.shootCharge / SHOOT_BAR, 0.45, 1) : 0.6;
      return penaltyGhost(b.x, b.y, b.z, pen.gx, pen.z, p, t.stat.shooting / 100, out, pen.h);
    }
    if (m.phase !== 'restart' || !r || r.side !== hs) return null;
    if (this.cam.mode !== 'broadcast' || this.introLeft > 0) return null;
    const t = m.players[r.taker];
    // A shooting free kick: through his reticle, bent as his stick has it, at the power charged so far (the kick's own
    // solve: sim/setPiece.ts).
    if (pen && r.kind === 'freekick') {
      if (pen.locked) return null;
      const p = m.shootCharge > 0.04 ? clamp(m.shootCharge / SHOOT_BAR, 0.45, 1) : FK_AUTO_POWER;
      return freeKickGhost(b.x, b.y, b.z, pen.gx, pen.z, pen.h, p, t.stat.shooting / 100, m.fkCurl, out);
    }
    // A corner or a wide free kick: to his landing ring, floated (SHOOT held: the driven one's flight). Any other free
    // kick has no arc: the arrow and the ringed team-mate say where it goes.
    const zone = m.zoneAim;
    if (!zone || zone.locked) return null;
    const driven = m.shootCharge > 0.04;
    const sh = deliveryShape(r.kind === 'corner', t.pos.z, zone.z, driven);
    return lobLaunch(b.x, b.y, b.z, zone.x, zone.z, sh.power, driven, out, sh.land, sh.hang);
  }

  /** Start this goal's clip: `live` the celebration (no replay), else the replay about to roll. */
  private startClip(live: boolean): void {
    if (!this.clipName || this.clips.recording) return;
    const cv = (this.world as { canvas?: HTMLCanvasElement }).canvas;
    if (!cv) return;
    const audio = sfx.captureStream();
    const ok = this.clips.start(cv, `${this.clipName}.webm`, audio, () => sfx.endCapture());
    if (!ok) sfx.endCapture();
    this.clipLive = ok && live;
  }

  private endClip(): void {
    this.clipLive = false;
    this.clipName = '';
    this.clips.stop();
  }

  /**
   * The goal's poster frame: this frame's picture, copied as it is drawn (no extra render) into a small canvas
   * (at most POSTER_W wide) and encoded to JPEG off the frame loop.
   */
  private takePoster(): void {
    this.posterWanted = false;
    const cv = (this.world as { canvas?: HTMLCanvasElement }).canvas;
    const w = this.world as { onNextRender?: (fn: () => void) => void };
    if (!cv || typeof document === 'undefined' || typeof w.onNextRender !== 'function') return;
    // (A WebGL canvas is only readable in the task that drew it: straight after the frame is drawn.)
    w.onNextRender(() => {
      try {
        const k = Math.min(1, POSTER_W / Math.max(1, cv.width));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(cv.width * k));
        c.height = Math.max(1, Math.round(cv.height * k));
        const g = c.getContext('2d');
        if (!g) return;
        g.drawImage(cv, 0, 0, c.width, c.height);
        c.toBlob((b) => {
          if (b) this.poster = b;
        }, 'image/jpeg', 0.88);
      } catch {
        // (No poster on a browser that won't read the canvas back.)
      }
    });
  }

  /** The human's last goal as a clip (webm), or null (none yet, or this browser can't record). */
  lastClip(): Clip | null {
    return this.clips.last;
  }

  /** Can this browser record goal clips? */
  clipSupported(): boolean {
    return clipSupported();
  }

  /** A still of the human's last goal (JPEG, the moment it went in), or null. */
  lastPoster(): Blob | null {
    return this.poster;
  }

  private startReplay(): void {
    this.view.celeb.end();
    // A flash cut into the replay (the wash clears in ~0.2 s) and, for the human's goal, the clip rolls.
    this.flash.play(0xfbfbf4, 0.85, 0.22);
    this.ghost?.clear();
    if (this.clipName && !this.clips.recording) this.startClip(false);
    const lead = Math.round(REPLAY_LEAD_S * 60);
    const tail = Math.round(REPLAY_TAIL_S * 60);
    const since = this.recorded - this.goalFrame;
    const frames = this.buffer.snapshot(Math.min(this.buffer.count, since + lead));
    const cut = Math.max(2, frames.length - since + tail);
    this.replay = frames.slice(0, Math.min(frames.length, cut));
    this.replayGoalIdx = Math.max(0, this.replay.length - tail);
    this.replayT = 0;
    // No confetti / grass flecks from the live celebration drifting over the replayed build-up; no pickups
    // either (the replay frames don't carry them; they come back with live play).
    this.effects.clear();
    this.fxKit.clear();
    if (this.blitz) this.blitz.group.visible = false;
    this.cam.replayAngle = Math.floor(Math.random() * 2);
    this.cam.replayGoalSign = this.match.attackDir(this.match.goalSide);
    // Goal-line camera goes across the mouth from where the ball crossed (or from the shooter if dead centre).
    const atGoal = this.replay[Math.min(this.replay.length - 1, this.replayGoalIdx)];
    const early = this.replay[Math.max(0, this.replayGoalIdx - 60)];
    const zg = atGoal[BALL_OFS + 2];
    this.cam.replaySide = Math.abs(zg) > 0.6 ? -Math.sign(zg) : early[BALL_OFS + 2] > 0 ? -1 : 1;
    // A short replay may open on the goal-line shot, but only with the ball already near the goal.
    this.cam.replayShot = this.replayGoalIdx > 100 || this.replayBallFar(this.replay[0]) ? 'build' : 'goal';
    this.cam.setMode('replay');
    // The camera cuts on this frame: show the first replay frame now, so it cuts to where the replay starts.
    this.view.apply(this.replay[0], this.replay[Math.min(1, this.replay.length - 1)], 0, this.time, 0);
    this.hud?.setReplay(true);
    this.view.setMarkerVisible(false);
    this.prevButtons = true;
  }

  private stepReplay(dt: number): void {
    const frames = this.replay!;
    const idx = this.replayT * 60;
    // Two shots like TV: the move in real-ish time, then the finish from the goal line in slow-mo: from
    // REPLAY_SLOW_FROM s before the goal, but never while the ball is still more than REPLAY_GOAL_NEAR m out
    // (a long-range strike is seen struck on the wide shot, then arriving on the goal-line one).
    const at = frames[Math.min(frames.length - 1, Math.floor(idx))];
    const finish = this.cam.replayShot === 'goal' || idx >= this.replayGoalIdx - 20 ||
      (idx >= this.replayGoalIdx - REPLAY_SLOW_FROM * 60 && !this.replayBallFar(at));
    if (finish && this.cam.replayShot === 'build') {
      this.cam.replayShot = 'goal';
      this.cam.cut();
    }
    const near = finish;
    this.replayT += dt * (near ? REPLAY_SLOW_RATE : REPLAY_BUILD_RATE);
    const i = Math.floor(idx);
    const c = this.input.read();
    const btn = c.pass || c.shoot || c.through || c.sprint || !!(c as { power?: boolean }).power;
    // Any input skips it: a button, any key, a tap on the picture or a touch button.
    const skip = (btn && !this.prevButtons) || this.anyPress;
    this.prevButtons = btn;
    if (i >= frames.length - 1 || skip) {
      this.replay = null;
      this.replayDone = true;
      this.hud?.setReplay(false);
      // A thumb still down from skipping or watching the replay cannot also take the next kick-off.
      this.eatButtons = true;
      this.clearLatch();
      this.anyPress = false;
      this.cam.setMode('broadcast');
      // Out of the replay with the same quick flash cut; the clip ends with it.
      this.flash.play(0xfbfbf4, 0.7, 0.18);
      this.endClip();
      this.flow(dt);
      return;
    }
    this.view.apply(frames[i], frames[i + 1], idx - i, this.time, dt * (near ? REPLAY_SLOW_RATE : REPLAY_BUILD_RATE));
    this.updateFrameFx(dt * (near ? REPLAY_SLOW_RATE : REPLAY_BUILD_RATE));
  }

  /** Is the ball in this replay frame still more than REPLAY_GOAL_NEAR m from the goal it went into? */
  private replayBallFar(fr: Float32Array): boolean {
    const gx = this.cam.replayGoalSign * HALF_L;
    return Math.hypot(fr[BALL_OFS] - gx, fr[BALL_OFS + 2]) > REPLAY_GOAL_NEAR;
  }

  private handleEvents(events: MatchEvent[]): void {
    const m = this.match;
    const hs = m.cfg.humanSide;
    for (const e of events) {
      // Haptics (platform/haptics.ts): his pass and shot, a tackle won or lost, a skill that beat a man, a goal, the
      // woodwork, the whistle; throttled there.
      const hk = hs === 0 || hs === 1 ? hapticForEvent(e, m, hs, this.ownerBefore, this.activeBefore) : null;
      if (hk && !this.demo) buzz(hk);
      // Every event goes to the commentary ticker too (a moment's own ending has no half-time / full-time line:
      // the verdict card is that beat).
      const endOfHalf = e.type === 'halftime' || e.type === 'fulltime';
      if (!(this.moment && endOfHalf)) this.hud?.commentary(e, m);
      if (e.type === 'powerupEnd') {
        // (Both fire before the goal event they belong to: golden at the score, mega at the strike.)
        if (e.kind === 'golden') this.goldenGoalArmed = true;
        if (e.kind === 'mega') this.megaShotT = this.time;
      }
      switch (e.type) {
        case 'kick': {
          const kicker = e.player ?? m.ball.lastTouch;
          // A strike he never had under control first (a volley, a one-touch finish): the sim executes it at
          // the contact, with the ball still loose.
          const firstTime = e.firstTime ?? (kicker >= 0 && this.ownerBefore !== kicker);
          // Sound: the layered strike for a shot (with the crowd's "oooh" if it's on target), the header's own
          // thock, the plain boot for everything else.
          if (e.kind === 'header') sfx.header(e.power);
          else if (e.kind === 'shot') sfx.shot(e.power, m.shotOnTarget);
          else sfx.kick(e.power);
          // The trail it leaves (juice.ts kickTrailStyle), logged for the replay.
          this.trailStyle = kickTrailStyle(e.kind, e.power, e.y, firstTime);
          // (A hard shot or header of the human side's wears the SHOP trail behind the ball: render/fx/trails.ts.)
          this.shotFx = (e.kind === 'shot' || e.kind === 'header') && e.power >= SHOT_FX_POWER && kicker >= 0 && m.players[kicker].side === m.cfg.humanSide;
          this.logKick(this.trailStyle, this.shotFx);
          // Struck hard: the ball flashes white and pops (a throw is no strike).
          if (e.power >= HARD_STRIKE && e.kind !== 'throw' && e.kind !== 'keeper') this.view.flashBall();
          if (firstTime && e.kind === 'shot' && e.power >= HARD_STRIKE && kicker >= 0 && m.players[kicker].side === m.cfg.humanSide) {
            this.hold(HIT_STOP.firstTime);
            this.cam.shakePx(SHAKE_PX.firstTime);
          }
          if (e.kind === 'header' && kicker >= 0) {
            // Off the head: chunky bits in his kit colour.
            const kit = this.opt.kits[m.players[kicker].side];
            this.effects.chunks(e.x, e.y, e.z, [kit.shirt, kit.shirt2, 0xfbfbf4], 6 + Math.round(e.power * 6), 3 + e.power * 3, 1.2);
          }
          // The mega ball struck (blitz: its powerupEnd came just before this kick): the picture jolts.
          if (e.kind === 'shot' && this.time - this.megaShotT < 0.05) this.cam.shakePx(SHAKE_PX.mega);
          if (kicker >= 0) {
            const kp = m.players[kicker];
            if (e.kind === 'shot' || (e.kind === 'header' && m.shotClock < 0.05)) this.tally.get(kp.idx).shots++;
            else if (e.kind !== 'clear') {
              this.tally.get(kp.idx).passes++;
              this.lastPasser[kp.side] = kp.idx;
            }
          }
          if (kicker >= 0 && m.players[kicker].side === m.cfg.humanSide) {
            if (e.kind === 'shot' || e.kind === 'header') this.tut.shot = true;
            else this.tut.passed = true;
            // (The sim tags a chip / finesse strike on the kick event; typed loosely for older sims.)
            const style = (e as { style?: string }).style;
            if (style === 'chip' || style === 'finesse') this.tut.chip = true;
          }
          if (e.kind === 'shot' && e.power > 0.5) {
            this.effects.grass(e.x, e.z, 10, e.power);
            // (The lens punches for a human's strike only: every AI shot wobbling the picture read as a glitch.)
            if (kicker >= 0 && m.human[m.players[kicker].side]) this.cam.kick(0.04 + e.power * 0.06);
          } else if (e.power > 0.6) this.effects.grass(e.x, e.z, 5, e.power * 0.6);
          break;
        }
        case 'goal': {
          this.goalFrame = this.recorded;
          if (!e.own) {
            this.tally.get(e.scorer).goals++;
            const a = this.lastPasser[e.side];
            if (a >= 0 && a !== e.scorer) this.tally.get(a).assists++;
          }
          this.lastPasser = [-1, -1];
          this.replayDone = false;
          // Worth a replay: the human's side (or nobody's, in an AI match) scoring from range, with the head, a
          // chip or a curler, a golden or mega goal, or any own goal. A tap-in gets the celebration only.
          const human = m.cfg.humanSide;
          const special = e.own || m.shotDist >= 16 || m.kickKind === 'header' || m.shotStyle === 'chip' || m.shotStyle === 'finesse' ||
            this.goldenGoalArmed || this.time - this.megaShotT < 3;
          this.replayWanted = (human < 0 || e.side === human || e.own) && special;
          const golden = this.goldenGoalArmed;
          this.goldenGoalArmed = false;
          sfx.goal(e.side);
          // The human's goal: a poster frame now (the impact, on the hold) and a clip (the replay, or the
          // celebration when no replay rolls).
          const ours = human >= 0 && e.side === human && !this.demo;
          this.clipName = ours ? `blocky-league-goal-${m.minute()}min` : '';
          if (ours) {
            this.posterWanted = true;
            if (!this.replayWanted) this.startClip(true);
          }
          const side = e.side;
          const s = m.teams[side];
          const scorer = m.players[e.scorer];
          const g = m.goals[m.goals.length - 1];
          const who = e.own ? `${scorer.def.name} (OG)` : scorer.def.name;
          this.hud?.show(golden ? 'GOAL! ×2' : 'GOAL!', `${who} ${g.minute}'`, side === m.cfg.humanSide || m.cfg.humanSide < 0 ? 'goal' : 'goal against', 3.2);
          this.hud?.setScore(m.score[0], m.score[1]);
          this.stadium.setScore(m.score[0], m.score[1], `${m.minute()}'`);
          this.goalHypeT = 5;
          // A golden goal (Blitz: it counts double) celebrates in gold, with an extra shower over the goal mouth.
          const kitCols = [this.opt.kits[side].shirt, this.opt.kits[side].shirt2, 0xffd23a, 0xfbfbf4];
          // (Your goals burst in the SHOP theme you equipped: render/cosmetics.ts.)
          const cols = golden ? [0xffd23a, 0xffb300, 0xfff0b0, 0xfbfbf4] : side === human ? goalFxColors(this.opt.goalFx, kitCols) : kitCols;
          const gx = Math.sign(m.ball.pos.x) * HALF_L;
          // (A goal of yours with a SHOP goal explosion on: its own show, render/fx/goals.ts, and the wide shot
          // holds on it. Otherwise the burst and confetti below.)
          const show = side === human && !this.demo ? goalShow(this.opt.goalFx) : null;
          this.goalWideS = show ? GOAL_FX_WIDE_S : GOAL_WIDE_S;
          // Juice: a hold on the impact frame, a decaying shake, the net rippling, a fat burst in the scorer's
          // colours out of the goal mouth, confetti from the roof and the ground and the whole bowl flashing.
          this.hold(HIT_STOP_GOAL);
          this.view.flashBall();
          if (show) {
            const dir = -Math.sign(gx);
            this.fxKit.play(show.run, show.dur, gx, 0, 0, dir, 0, 1, goalFxColors(this.opt.goalFx, kitCols), Math.max(-3.4, Math.min(3.4, dir * m.ball.pos.z)));
          } else {
            this.effects.burst(gx, 1.5, m.ball.pos.z, cols, 90, 13, 2.4);
            this.effects.burst(gx - Math.sign(gx) * 2, 0.3, m.ball.pos.z, cols, 50, 9, 2);
            this.effects.confetti(gx * 0.7, 0, cols, 320, 60);
          }
          this.stadium.punchNet(gx, Math.max(0.6, Math.min(2, m.ball.pos.y)), m.ball.pos.z, 24);
          this.stadium.flashBurst(golden ? 90 : 60);
          if (golden) this.effects.burst(gx - Math.sign(gx) * 3, 2.4, m.ball.pos.z, [0xffd23a, 0xfff0b0, 0xffb300], 70, 11, 3);
          this.cam.shakePx(SHAKE_PX.goal);
          this.cam.kick(0.12);
          this.view.setMarkerVisible(false);
          this.celebG = 0;
          // (Behind a goal explosion the celebration waits for it, so its moment still lands after the cut.)
          if (show) this.celebDue = side;
          else this.startCelebration(side);
          // Your home crowd's party: the mascot dances, the lights go wild (render/stadiumStyle.ts).
          // (The show goes off behind the goal scored in. The mascot's cutaway comes a second into the scorer's
          // close-up, which has the lens first and gets it back after, or hands straight on to the replay.)
          if (side === human) this.decor?.goal(gx, this.goalWideS + 1);
          void s;
          break;
        }
        case 'whistle':
          // Half-time: two short and a long; full time: three (audio/sfx.ts).
          if (e.kind === 'long') sfx.whistleHalf();
          else if (e.kind === 'end') sfx.whistleFull();
          else sfx.whistle(e.kind);
          break;
        case 'addedTime':
          // The fourth official's board goes up by the clock (Law 7.3: the minimum the half has left).
          if (!this.moment) this.hud?.showAddedBoard(e.minutes);
          break;
        case 'post': {
          // Off the woodwork: a hold on the clang, the picture jolting, the ball flashing and white chips of
          // paint flying back off the frame (a softer knock holds and shakes less).
          // (The sim reports the pace into the post; the ball's own pace says how hard it was struck.)
          const hit = Math.max(e.speed, this.ballSpeedBefore);
          const slow = hit <= SLOW_POST;
          sfx.post(hit);
          this.hud?.toastMsg('OFF THE WOODWORK!');
          this.hold(slow ? HIT_STOP.postSlow : HIT_STOP.post);
          this.cam.shakePx(slow ? SHAKE_PX.postSlow : SHAKE_PX.post);
          this.cam.kick(0.08);
          this.view.flashBall();
          const bits = impactBits(hit, 8, 0.8, 30);
          this.effects.chunks(e.x, e.y, e.z, POST_BITS, bits.n, bits.v, 1.5, -Math.sign(e.x || 1) * 0.6, 0.3, 0);
          this.effects.sparks(e.x, e.y, e.z, POST_BITS, 8, bits.v * 1.3, 0.18, 4);
          break;
        }
        case 'save': {
          this.tally.get(e.keeper).saves++;
          const k = m.players[e.keeper];
          // A real save (a shot on its way in): a hold on the gloves, the keeper lit up, the gasp.
          const big = m.shotClock < 2;
          sfx.save(e.caught, big);
          this.effects.dust(k.pos.x, k.pos.z, 8, 0.7);
          const gk = this.opt.kits[k.side].gk;
          const b = m.ball.pos;
          this.effects.chunks(b.x, Math.max(0.3, b.y), b.z, [gk, 0xfbfbf4], big ? 10 : 5, big ? 4.5 : 3, 1.3);
          if (big) {
            this.hud?.toastMsg(e.caught ? 'GREAT SAVE!' : 'PARRIED!');
            sfx.saveFlash(e.caught);
            sfx.cheer(0.6);
            this.hold(HIT_STOP.save);
            this.view.flashPlayer(e.keeper, KEEPER_FLASH_FRAMES);
            this.cam.kick(0.06);
          }
          break;
        }
        case 'block': {
          // Cannoned off a man: bits in his kit colour where it hit him, and a body thud.
          const by = m.players[e.by];
          if (by) {
            const kit = this.opt.kits[by.side];
            const sp = Math.hypot(m.ball.vel.x, m.ball.vel.z);
            const bits = impactBits(sp, 4, 0.35, 14);
            this.effects.chunks(e.x, Math.max(0.5, m.ball.pos.y), e.z, [kit.shirt, kit.shirt2, 0xfbfbf4], bits.n, bits.v, 1.2);
            sfx.block(e.shot);
            if (e.shot) this.view.flashPlayer(e.by, PLAYER_FLASH_FRAMES);
          }
          break;
        }
        case 'claim': {
          const k = m.players[e.keeper];
          if (k) {
            const b = m.ball.pos;
            this.effects.chunks(b.x, Math.max(0.5, b.y), b.z, [this.opt.kits[k.side].gk, 0xfbfbf4], 4, 2.5, 1.1);
            sfx.save(e.caught, false);
          }
          break;
        }
        case 'skillTell':
        case 'skillMove':
        case 'skillGoal':
          this.skillEvent(e);
          break;
        case 'tackleTry':
          this.tackleAttempt(e.by, e.slide);
          break;
        case 'tackleCue':
          // The press answered in a word over the man he controls (and only his own side's, on his own screen).
          if (hs === m.players[e.by]?.side && !this.replay) this.actionPop?.tackle(e.by, e.cue);
          break;
        case 'tackle': {
          const p = m.players[e.by];
          // (The sim fires a lost slide as the slide starts, before any contact: that is the attempt itself.
          // A standing tackle with no 'tackleTry' before it, older sims, lunges from here.)
          const fresh = this.time - this.tryAt[e.by] < TACKLE_TRY_S;
          if (!fresh) this.tackleAttempt(e.by, e.slide);
          if (e.slide && !e.won) break;
          if (e.won) {
            this.tally.get(e.by).tackles++;
            // WON IT: the picture holds on the impact (a slide that connects longest), the camera punches, a
            // heavy one shakes the picture, the man who lost it flashes white, a burst in the winner's colours.
            const ob = this.ownerBefore;
            const victim = ob >= 0 && ob < m.players.length && m.players[ob].side !== p.side ? m.players[ob] : null;
            const closing = victim ? Math.hypot(p.vel.x - victim.vel.x, p.vel.z - victim.vel.z) : p.speed();
            const heavy = e.slide || closing >= HEAVY_TACKLE_MS;
            // (Only a tackle a human's side wins: the AI taking it off him is no payoff, and a frozen frame and a
            // jolted camera there read as the game hitching.)
            if (m.human[p.side]) {
              this.hold(e.slide ? HIT_STOP.slide : HIT_STOP_TACKLE);
              this.cam.kick(PUNCH_TACKLE);
              if (heavy) this.cam.shakePx(e.slide ? SHAKE_PX.slide : SHAKE_PX.tackleHeavy);
            }
            const kit = this.opt.kits[p.side];
            const b = m.ball.pos;
            this.effects.burst(b.x, Math.max(0.25, b.y), b.z, [kit.shirt, kit.shirt2, 0xfbfbf4], 30, 7, 1.6);
            this.effects.dust(b.x, b.z, 8, 0.9, p.vel.x * 0.3, p.vel.z * 0.3);
            this.effects.grass(p.pos.x, p.pos.z, e.slide ? 12 : 6, e.slide ? 0.8 : 0.5);
            if (victim) {
              this.view.flashPlayer(victim.idx, PLAYER_FLASH_FRAMES);
              const vk = this.opt.kits[victim.side];
              this.effects.chunks(victim.pos.x, 0.6, victim.pos.z, [vk.shirt, vk.shirt2], 6, 3.5, 1.1);
            }
            sfx.tackleHit(heavy);
          } else {
            // Missed: a scuff of boot on grass. In blitz, a challenge that bounced off a shielded carrier (or
            // was thrown by a frozen tackler) bonks off the bubble instead.
            const c = m.ball.owner >= 0 ? m.players[m.ball.owner] : null;
            const bounced = m.cfg.mode === 'blitz' && !e.slide && ((c && c.side !== p.side && c.boost === 'shield') || p.boost === 'freeze');
            if (bounced) {
              const kind: PowerUpKind = c && c.boost === 'shield' && p.boost !== 'freeze' ? 'shield' : 'freeze';
              const at = kind === 'shield' && c ? c.pos : p.pos;
              this.effects.burst(at.x, 0.9, at.z, [POWER_COLOR[kind], POWER_LIGHT[kind], 0xfbfbf4], 22, 6, 1.4);
              sfx.shieldHit();
            } else sfx.scuff();
            this.effects.dust(p.footX(), p.footZ(), 3, 0.35);
          }
          break;
        }
        case 'bounce': {
          sfx.bounce(e.speed);
          // Turf kicked up where it lands, more the harder it comes down.
          if (e.speed > 3.5) {
            const b = m.ball.pos;
            this.effects.grass(b.x, b.z, impactBits(e.speed, -1, 0.9, 14).n, Math.min(1, e.speed / 12));
          }
          break;
        }
        case 'net':
          this.stadium.punchNet(e.x, e.y, e.z, e.speed);
          sfx.net(e.speed);
          break;
        case 'ooh':
          sfx.ooh();
          break;
        case 'restart':
          if (!this.foulPresentation.queueRestart(e, m.restart)) this.showRestart(e.kind);
          break;
        case 'setpiece':
          // A new set-piece framing: cut if it is far from where we are, otherwise glide there.
          this.cam.softCut();
          break;
        case 'sub': {
          // (A quick sub has its own board up: no flag as well.)
          if (!this.quick?.qs.claims(e)) this.hud?.toastMsg(`SUB ${SEP_MARK} ${e.on} ON ${SEP_MARK} ${e.off} OFF`, 2);
          // Manager and AI subs alike: draw whoever the sim now has in that slot (no-op if already swapped).
          const on = m.teamPlayers(e.side)[e.slot];
          // ...and its touchline shot at the next dead ball (startSubCut), in a match played here against the AI. Never
          // online (the two screens step together: nothing may hold one of them), in a moment or the menu's demo.
          const worn = this.wearing;
          const off = on && worn ? worn[on.idx] : undefined;
          if (on && worn) worn[on.idx] = on.def;
          if (on && off && off !== on.def && !this.demo && !this.driver && !this.moment && this.hud) {
            this.subQueue.push({ side: e.side, off, on: on.def, idx: on.idx, keeper: on.isKeeper });
          }
          if (on) {
            this.view.replacePlayer(on.idx, on.def, this.opt.kits[e.side]);
            // The man going off keeps what he did under his own name; the sub's rating starts from nothing.
            this.tally.sub(on.idx, e.off, e.side, on.isKeeper, on.role === 'DF');
            if (this.lastPasser[e.side] === on.idx) this.lastPasser[e.side] = -1;
          }
          break;
        }
        case 'card': {
          const p = m.players[e.player];
          // Compare as a string: stays valid whichever colours the sim's event type lists.
          const color: string = e.color ?? 'yellow';
          const red = color === 'red';
          const second = 'second' in e && !!e.second;
          // One call per card: the HUD swaps that player's yellow for the red on a second booking.
          this.hud?.card(p.side, red ? 'red' : 'yellow', p.idx);
          // The referee holds the card up at the offender; at a stoppage we cut to a close-up of it (in
          // live play he just shows it: the game never waits for the camera).
          const live = m.phase === 'play';
          const gone = isSentOff(p);
          let x = gone ? this.foulBy.x : p.pos.x;
          let z = gone ? this.foulBy.z : p.pos.z;
          // Never on top of the man he brought down (he is drawn on his mark for the close-up).
          const dv = Math.hypot(x - this.foulAt.x, z - this.foulAt.z);
          if (dv < 1.3) {
            const ux = dv > 0.05 ? (x - this.foulAt.x) / dv : 1;
            const uz = dv > 0.05 ? (z - this.foulAt.z) / dv : 0;
            x = this.foulAt.x + ux * 1.3;
            z = this.foulAt.z + uz * 1.3;
          }
          const close = !live && !this.demo && !this.replay && this.cam.mode === 'broadcast';
          const shot: BookingShot = { player: p.idx, playerId: p.def.id, name: p.def.name,
            color: red ? 'red' : 'yellow', second, x, z, close, restart: m.restart };
          if (close && this.foulPresentation.waiting) this.foulPresentation.queueBooking(shot);
          else this.showBooking(shot);
          break;
        }
        case 'foul': {
          const on = m.players[e.on];
          const by = m.players[e.by];
          this.foulPresentation.contact(on.side);
          // The contact: a thump and a grunt (the sim blows the whistle), the man brought down flashing white; a
          // slide that connects holds the picture and shakes it.
          const slide = by.state === 'slide';
          sfx.tackleHit(slide);
          this.view.flashPlayer(e.on, PLAYER_FLASH_FRAMES);
          if (slide) {
            this.hold(HIT_STOP.slide);
            this.cam.shakePx(SHAKE_PX.slide);
          }
          this.foulOn = e.on;
          this.foulAt = { x: on.pos.x, z: on.pos.z };
          this.foulBy = { x: by.pos.x, z: by.pos.z };
          this.view.refSignal(1.2);
          if (!e.penalty) this.hud?.toastMsg('FOUL!', 1.2);
          break;
        }
        case 'halftime':
          if (!this.moment) this.hud?.show('HALF TIME', `${m.score[0]} - ${m.score[1]}`, 'small', 3);
          // The board comes down; the referee's arm goes up as everyone eases to a stop (Match.windDown).
          this.hud?.showAddedBoard(null);
          this.view.refSignal(1.6, 'arm');
          // (The mascot's half time show: render/stadiumStyle.ts.)
          this.decor?.halfTime();
          break;
        case 'fulltime':
          if (!this.moment) this.hud?.show('FULL TIME', `${m.score[0]} - ${m.score[1]}`, 'small', 3);
          this.hud?.showAddedBoard(null);
          this.view.refSignal(1.6, 'arm');
          // (A home win: the stadium style's fireworks and club-colour smoke, the mascot celebrating.)
          this.decor?.fullTime(m.cfg.humanSide === 0 ? m.score[0] > m.score[1] : m.cfg.humanSide === 1 && m.score[1] > m.score[0]);
          break;
        case 'shootoutKick': {
          // A short beat per kick: banner + burst, never the goal replay.
          const how = m.shootout?.last?.how ?? (e.scored ? 'goal' : 'saved');
          const ours = m.cfg.humanSide < 0 || e.side === m.cfg.humanSide;
          const title = e.scored ? 'SCORED!' : how === 'saved' ? 'SAVED!' : how === 'post' ? 'POST!' : how === 'over' ? 'OVER!' : 'WIDE!';
          this.hud?.show(title, m.players[e.taker].def.name, e.scored ? (ours ? 'small goal' : 'small goal against') : 'small', 1.2);
          if (e.scored) {
            sfx.cheer(0.9);
            this.goalHypeT = 2;
            const k = this.opt.kits[e.side];
            this.effects.burst((m.shootout?.goal ?? 1) * HALF_L, 1.2, m.ball.pos.z, [k.shirt, k.shirt2, 0xffd23a], 36, 7);
            this.cam.kick(0.12);
          }
          break;
        }
        case 'shootoutEnd': {
          const so = m.shootout;
          const pens = so ? `${goalsOf(so.kicks[e.winner])} - ${goalsOf(so.kicks[e.winner === 0 ? 1 : 0])}` : '';
          const ours = m.cfg.humanSide < 0 || e.winner === m.cfg.humanSide;
          this.hud?.show(`${m.teams[e.winner].short} WIN!`, `ON PENALTIES ${pens}`, ours ? 'goal' : 'small goal against', 3.2);
          // Off the penalty camera and onto the winners' pile-up until the full-time screen.
          this.cam.setMode('celebrate');
          this.cam.cut();
          this.view.setMarkerVisible(false);
          if (ours) {
            sfx.goal();
            const k = this.opt.kits[e.winner];
            this.effects.confetti((so?.goal ?? 1) * HALF_L * 0.7, 0, [k.shirt, k.shirt2, 0xffd23a, 0xfbfbf4], 220, 50);
          }
          break;
        }
        default: {
          // Newer sim events (typed loosely so this compiles whichever sim version it meets).
          const t = (e as { type: string }).type;
          if (t === 'offside') {
            this.foulPresentation.clear();
            this.hud?.toastMsg('OFFSIDE', 1.4);
            this.view.refSignal(1.4, 'arm');
          } else if (t === 'advantage') {
            this.foulPresentation.clear();
            this.hud?.toastMsg('ADVANTAGE', 1.4);
            this.view.refSignal(1.6, 'advantage');
          } else if (t === 'powerupTaken' || t === 'powerupUsed' || t === 'powerupEnd') {
            this.powerEvent(e as { type: string; kind: PowerUpKind; player: number; side: Side; id?: number });
          } else if (t === 'powerupSpawn' && m.cfg.mode === 'blitz') sfx.spawnBlip();
          break;
        }
      }
    }
  }

  /**
   * SKILL moves (sim/skills.ts) for the human's side: the tell's "ting" (the cue to press), each move's swish and pop
   * (ui/skillHud.ts), and a PERFECT's payoff: the hold, then a beat of slow motion, a jolt, the man who bit flashing,
   * the ring round the dribbler, the "shing" and the crowd's olé. A SKILL GOAL is called under the score.
   */
  private skillEvent(e: SkillEvent): void {
    const m = this.match;
    const hs = m.cfg.humanSide;
    if (hs < 0 || this.demo) return;
    if (e.type === 'skillTell') {
      if (m.players[e.on]?.side !== hs) return;
      this.skillTells++;
      sfx.skillTell();
      return;
    }
    if (e.type === 'skillGoal') {
      if (e.side !== hs) return;
      this.hud?.toastMsg(e.combo >= 2 ? `SKILL GOAL ×${e.combo}` : 'SKILL GOAL', 2.6);
      sfx.cheer(1.2);
      return;
    }
    const p = m.players[e.player];
    if (!p || p.side !== hs) return;
    this.skillHud?.show(e.player, e.grade, e.move, e.combo);
    if (e.move === 'cut' || e.move === 'knock' || e.move === 'past') {
      sfx.skillMove('good');
      return;
    }
    sfx.skillMove(e.grade);
    if (e.grade === 'perfect') {
      this.skillPerfects++;
      this.hold(HIT_STOP.skillPerfect);
      // (The slow motion counts down only once the hold is over: it follows it.)
      this.slowT = SKILL_SLOW_S;
      this.slowRate = SKILL_SLOW_RATE;
      this.cam.shakePx(SHAKE_PX.skillPerfect);
      this.view.flashBall();
      if (e.on >= 0) this.view.flashPlayer(e.on, PLAYER_FLASH_FRAMES);
      const kit = this.opt.kits[p.side];
      this.effects.burst(p.pos.x, 0.5, p.pos.z, [kit.shirt, kit.shirt2, 0xfbfbf4, 0xffd23a], 26, 6, 1.2);
      this.effects.dust(p.pos.x, p.pos.z, 10, 0.8);
    } else if (e.grade === 'good') {
      this.effects.dust(p.pos.x, p.pos.z, 6, 0.6);
    }
  }

  /**
   * A TACKLE press (the sim's 'tackleTry', before any contact): a standing tackle lunges at once (baked into
   * the frames: replay.ts writeFrame, so replays lunge too), with a puff of dust at the boot and a whip of
   * air; a slide gets a bigger cloud and a longer swish.
   */
  private tackleAttempt(by: number, slide: boolean): void {
    const m = this.match;
    const p = m.players[by];
    if (!p) return;
    this.tryAt[by] = this.time;
    const b = m.ball.pos;
    if (!slide) {
      // Lunge with the leg nearer the ball (the sim's own poke picks it the same way).
      const side = -Math.sin(p.facing) * (b.x - p.pos.x) + Math.cos(p.facing) * (b.z - p.pos.z);
      this.lungeLeg[by] = side >= 0 ? 1 : -1;
      this.lunge[by] = 0;
      // A puff at the planted boot and a scuff of turf: the press reads even from the gantry.
      this.effects.dust(p.pos.x, p.pos.z, 12, 0.9, Math.cos(p.facing) * 1.2, Math.sin(p.facing) * 1.2);
      this.effects.grass(p.pos.x, p.pos.z, 4, 0.6);
    } else {
      this.effects.dust(p.pos.x, p.pos.z, 14, 1, p.vel.x * 0.3, p.vel.z * 0.3);
      this.effects.grass(p.pos.x, p.pos.z, 6, 0.6);
    }
    sfx.whip(slide);
  }

  /**
   * Frame-driven action readability, live and in replays (it all comes off the drawn frame, so a replayed
   * slide leaves the same dust): a slide's long dust trail and grass flecks, dust when a keeper hits the deck
   * (or anyone goes down), speed lines and dust off sprinting boots, and the ball's trail when it is really
   * moving (a mega ball's fire, in blitz).
   */
  private updateFrameFx(dt: number): void {
    if (dt <= 0) return;
    const f = this.view.frame;
    const fx = this.effects;
    const k = this.view.headTop / 1.94;
    for (let i = 0; i < 22; i++) {
      const o = i * PF;
      const state = f[o + 4];
      const x = f[o];
      const z = f[o + 1];
      const facing = f[o + 3];
      const ux = Math.cos(facing);
      const uz = Math.sin(facing);
      const speed = f[o + 7];
      const prev = this.lastState[i];
      this.lastState[i] = state;
      if (state !== prev && (state === STATE_CODE.dive || state === STATE_CODE.fallen || state === STATE_CODE.stumble)) {
        // A keeper hitting the deck (a dive, a mega ball knocking him back) throws up the most.
        const keeper = i === 0 || i === 11;
        fx.dust(x, z, state === STATE_CODE.dive || keeper ? 12 : 7, keeper ? 1 : 0.8, -ux * 0.5, -uz * 0.5);
        if (state === STATE_CODE.dive || keeper) fx.grass(x, z, 4, 0.5);
      }
      // Light up boots: a glowing print at every footstep (render/fx/trails.ts bootStep), jogging or sprinting.
      if (this.lightBoots[i < 11 ? 0 : 1] && speed > 2 && state !== STATE_CODE.slide && f[o + 2] < 0.15) {
        this.stepDist[i] += speed * dt;
        if (this.stepDist[i] >= BOOT_STEP_M) {
          this.stepDist[i] = 0;
          this.stepSide[i] = -this.stepSide[i];
          bootStep(this.fxKit, x, z, ux, uz, this.stepSide[i], k);
        }
      }
      if (state === STATE_CODE.slide && f[o + 5] < 0.9) {
        // A long trail of dust and turf off the hip, back along the path.
        this.fxAcc[i] += dt * (24 + speed * 3);
        while (this.fxAcc[i] >= 1) {
          this.fxAcc[i] -= 1;
          fx.dust(x - ux * 0.4, z - uz * 0.4, 1, 0.5 + speed * 0.05, -ux * 1.2, -uz * 1.2, 0.1);
          if (Math.random() < 0.3) fx.grass(x - ux * 0.3, z - uz * 0.3, 1, 0.5);
        }
        continue;
      }
      const turbo = this.blitz !== null && !this.replay && this.match.players[i]?.boost === 'turbo';
      const fast = speed > SPRINT_FX_MS || (turbo && speed > 3);
      if (!fast) {
        this.fxAcc[i] = 0;
        continue;
      }
      // The player you control wears your SHOP trail (render/fx/trails.ts: popcorn, hearts, lightning...), in
      // place of the chalk lines; everyone else, and the Chalk trail, keeps the lines.
      if (!turbo && i === f[BALL_OFS + 8] && this.match.players[i]?.side === this.match.cfg.humanSide &&
        emitTrail(this.fxKit, this.trailFx, this.opt.trail, (this.trailCols ??= trailColors(this.opt.trail)), x, 0, z, ux, uz, speed, dt, k * TRAIL_FX_K)) {
        this.fxAcc[i] = 0;
        continue;
      }
      // Speed lines and dust off the boots: subtle white streaks trailing back, a puff every few frames.
      this.fxAcc[i] += dt * (turbo ? 40 : 22);
      while (this.fxAcc[i] >= 1) {
        this.fxAcc[i] -= 1;
        const sway = (Math.random() - 0.5) * 0.5 * k;
        const col = turbo ? (Math.random() < 0.5 ? POWER_COLOR.turbo : POWER_LIGHT.turbo) : 0xf4f4ea;
        fx.streak(x - ux * 0.6 - uz * sway, 0.14 + Math.random() * 0.5 * k, z - uz * 0.6 + ux * sway, facing, 0.5 + Math.random() * 0.5, 0.045, col, 0.14, -ux * 3, -uz * 3);
        if (Math.random() < (turbo ? 0.6 : 0.4)) fx.dust(x - ux * 0.35, z - uz * 0.35, 1, 0.3, -ux, -uz, 0.05);
        if (turbo && Math.random() < 0.5) fx.sparks(x - ux * 0.3, 0.3 * k, z - uz * 0.3, [POWER_COLOR.turbo, POWER_LIGHT.turbo], 1, 3, 0.2, 2);
      }
    }
    // The ball's trail: nothing under TRAIL_FROM m/s, growing to full strength at TRAIL_FULL (more bits, bigger,
    // longer-lived), in the look of what last struck it (juice.ts: white off a boot, lighter and longer off a
    // long pass, a cyan glow off a head, a volley or a first-time strike); a fireball when it is the mega ball.
    const bx = f[BALL_OFS], by = f[BALL_OFS + 1], bz = f[BALL_OFS + 2];
    const bvx = f[BALL_OFS + 3], bvy = f[BALL_OFS + 4], bvz = f[BALL_OFS + 5];
    const bs = Math.hypot(bvx, bvy, bvz);
    const hot = this.megaHot && !this.replay;
    // (Controlled again: back to the plain look for whatever strikes it next.)
    if (f[BALL_OFS + 7] >= 0 && !this.replay) this.trailStyle = 'strike';
    const tk = trailStrength(bs);
    if (tk > 0 || (hot && bs > 2)) {
      const style = this.replay ? this.styleAt(f[BALL_OFS + 9]) : this.trailStyle;
      const look = TRAIL_LOOK[style];
      this.ballFxAcc += dt * (hot ? 90 : look.rate * (0.35 + 0.65 * tk));
      while (this.ballFxAcc >= 1) {
        this.ballFxAcc -= 1;
        // Placed back along the path, so the trail starts at the ball rather than inside it.
        const back = Math.random() * (style === 'long' ? 0.8 : 0.5);
        const px = bx - (bvx / bs) * back, py = Math.max(0.1, by - (bvy / bs) * back), pz = bz - (bvz / bs) * back;
        if (hot) fx.fire(px, py, pz, 2, -bvx * 0.04, 0, -bvz * 0.04);
        else {
          const col = look.colors[(Math.random() * look.colors.length) | 0];
          fx.trailBit(px, py, pz, col, look.size * (0.55 + 0.45 * tk), look.life * (0.6 + 0.4 * tk));
          // The glow's hot core: a few sparks shed off it.
          if (style === 'glow' && Math.random() < 0.25 * tk) fx.sparks(px, py, pz, look.colors, 1, 2, 0.16, 0);
        }
      }
    } else this.ballFxAcc = 0;
    // Your side's hard shots carry your SHOP trail too, till someone has the ball (live, and in the replay).
    const shot = this.replay ? this.mineAt(f[BALL_OFS + 9]) : this.shotFx;
    if (!(shot && !hot && bs > SHOT_FX_MS && f[BALL_OFS + 7] < 0 &&
      emitTrail(this.fxKit, this.ballFx, this.opt.trail, (this.trailCols ??= trailColors(this.opt.trail)), bx, by, bz, bvx, bvz, bs, dt, TRAIL_FX_K, true))) this.ballFx.reset();
  }

  /** Blitz power-up events: the pickup's burst, each power's own voice and burst, and the side-wide effects. */
  private powerEvent(e: { type: string; kind: PowerUpKind; player: number; side: Side; id?: number }): void {
    const m = this.match;
    if (m.cfg.mode !== 'blitz') return;
    const fx = this.effects;
    const cols = [POWER_COLOR[e.kind], POWER_LIGHT[e.kind], 0xfbfbf4];
    const p = m.players[e.player];
    if (e.type === 'powerupTaken') {
      const at = (e.id !== undefined && this.blitz?.at(e.id)) || (p ? { x: p.pos.x, z: p.pos.z } : null);
      if (e.id !== undefined) this.blitz?.take(e.id);
      if (at) {
        fx.burst(at.x, 0.6, at.z, cols, 40, 8);
        fx.sparks(at.x, 0.6, at.z, cols, 16, 6, 0.4, 4);
      }
      sfx.powerup();
    } else if (e.type === 'powerupUsed') {
      sfx.powerUse(e.kind);
      if (p) {
        fx.burst(p.pos.x, 0.8, p.pos.z, cols, 36, 7);
        if (e.kind === 'freeze') fx.frost(p.pos.x, 0.5, p.pos.z, 30);
      }
      if (e.kind === 'freeze') {
        this.frozenSide = e.side === 0 ? 1 : 0;
        this.frozenT = FREEZE_MAX_S;
        this.cam.kick(0.06);
      }
      if (e.kind === 'mega') {
        this.cam.kick(0.05);
        this.cam.shakePx(SHAKE_PX.mega * 0.6);
      }
    } else if (e.type === 'powerupEnd') {
      sfx.powerEnd();
      if (e.kind === 'freeze') this.frozenSide = -1;
      // The mega ball has just been struck: it flies as a fireball for a moment.
      if (e.kind === 'mega' && this.megaHot) this.megaFlyT = MEGA_FLY_S;
    }
  }

  /**
   * Blitz visuals every live frame (a classic match never makes them): the pickups from Match.powerups, the
   * held item over the controlled player, and each power's effect on the players it acts on (Player.boost):
   * turbo trails (updateFrameFx) and a glow under the whole side, a shield bubble, magnet sparks between ball
   * and boot, an ice tint plus frost on the frozen side, the mega ball red-hot with a fireball tail.
   */
  private updateBlitz(dt: number): void {
    const m = this.match;
    if (m.cfg.mode !== 'blitz') return;
    if (!this.blitz) {
      this.blitz = new BlitzFx();
      this.view.group.add(this.blitz.group);
    }
    const bz = this.blitz;
    const f = this.view.frame;
    const k = this.view.headTop / 1.94;
    const time = this.time;
    bz.group.visible = !this.replay;
    bz.sync(m.powerups ?? [], dt, time, k);
    // The held item over the man we control (the broadcast shot only).
    const hs = m.cfg.humanSide;
    const held = hs === 0 || hs === 1 ? m.heldPower?.[hs] ?? null : null;
    const a = m.active;
    if (held && a >= 0 && a < 22 && this.cam.mode === 'broadcast' && !this.cam.behindActive) {
      bz.setHeld(held, f[a * PF], this.view.headTop + f[a * PF + 2], f[a * PF + 1], time, k);
    } else bz.setHeld(null, 0, 0, 0, time);
    // Per-player effects.
    this.frozenT = Math.max(0, this.frozenT - dt);
    if (this.frozenT <= 0) this.frozenSide = -1;
    const turboSide = this.bzTurbo;
    const frozenSide = this.bzFrozen;
    turboSide[0] = turboSide[1] = false;
    frozenSide[0] = this.frozenSide === 0;
    frozenSide[1] = this.frozenSide === 1;
    let hot = false;
    const ball = m.ball;
    const bxp = f[BALL_OFS], byp = f[BALL_OFS + 1], bzp = f[BALL_OFS + 2];
    bz.beginBubbles();
    // (The sim sets Player.boost on a whole side: the bubble goes round that side's carrier alone, and the
    // magnet's sparks between the ball and the boot of the one man on it or nearest it.)
    const magnetMan = this.bzMagMan;
    const magnetD = this.bzMagD;
    magnetMan[0] = magnetMan[1] = -1;
    magnetD[0] = magnetD[1] = Infinity;
    for (const p of m.players) {
      if (p.boost !== 'magnet') continue;
      const d = ball.owner === p.idx ? -1 : Math.hypot(f[p.idx * PF] - bxp, f[p.idx * PF + 1] - bzp);
      if (d < magnetD[p.side]) {
        magnetD[p.side] = d;
        magnetMan[p.side] = p.idx;
      }
    }
    for (const p of m.players) {
      const i = p.idx;
      const o = i * PF;
      const boost = p.boost ?? null;
      const x = f[o], z = f[o + 1], y = f[o + 2];
      const frozen = boost === 'freeze' || this.frozenSide === p.side;
      const want = frozen && !isSentOff(p) ? 1 : 0;
      if (want !== this.frozen[i]) {
        this.frozen[i] = want;
        this.view.tintPlayer(i, want ? FREEZE_TINT : null);
      }
      if (want) {
        frozenSide[p.side] = true;
        this.fxAcc[i] += dt * 5;
        if (this.fxAcc[i] >= 1) {
          this.fxAcc[i] -= 1;
          this.effects.frost(x, y + 0.2, z, 1);
        }
      }
      if (!boost) continue;
      if (boost === 'turbo') turboSide[p.side] = true;
      else if (boost === 'shield') {
        if (ball.owner === i) bz.bubble(i, x, y + this.view.headTop * 0.52, z, time, k);
      } else if (boost === 'magnet') {
        const dx = bxp - x, dz = bzp - z;
        const d = Math.hypot(dx, dz);
        if (magnetMan[p.side] === i && d < 3.2) {
          this.fxAcc[i] += dt * 28;
          while (this.fxAcc[i] >= 1) {
            this.fxAcc[i] -= 1;
            const u = Math.random();
            this.effects.sparks(x + dx * u, 0.1 + Math.random() * 0.3 + byp * u, z + dz * u, [POWER_COLOR.magnet, POWER_LIGHT.magnet, 0xffffff], 1, 2.5, 0.22, 1);
          }
        }
      } else if (boost === 'mega' && ball.owner === i) hot = true;
    }
    bz.endBubbles();
    // The mega ball: red-hot at the shooter's feet, a fireball for MEGA_FLY_S after it leaves them.
    if (!hot && this.megaHot && this.megaFlyT <= 0 && Math.hypot(ball.vel.x, ball.vel.z) > 10) this.megaFlyT = MEGA_FLY_S;
    this.megaFlyT = Math.max(0, this.megaFlyT - dt);
    this.megaHot = hot || this.megaFlyT > 0;
    this.view.setBallHot(this.megaHot);
    if (hot) this.effects.fire(bxp, byp + 0.1, bzp, 1);
    for (let side = 0; side < 2; side++) {
      const kind: PowerUpKind | null = turboSide[side] ? 'turbo' : frozenSide[side] ? 'freeze' : null;
      if (bz.sideGlows[side] !== kind) bz.setSideGlow(side as Side, kind);
    }
    bz.updateSideGlow(f, PF, k, time);
  }

  private showRestart(kind: RestartKind): void {
    if (kind !== 'kickoff') this.hud?.toastMsg(RESTART_LABEL[kind], 1.2);
    if (kind === 'penalty') this.hud?.show('PENALTY!', '', 'small', 1.8);
  }

  private showBooking(shot: BookingShot): void {
    const p = this.match.players[shot.player];
    const red = shot.color === 'red';
    const close = shot.close && p.def.id === shot.playerId;
    this.hud?.show(red ? 'RED CARD' : 'YELLOW CARD', shot.second ? `${shot.name}, second yellow` : shot.name,
      red ? 'small card red' : 'small card', red ? 2.2 : 1.8);
    this.view.showCard(shot.color, shot.x, shot.z, close ? CARD_CAM_S : red ? 2.2 : 1.8, close);
    if (close) this.startCardShot(shot.player, shot.x, shot.z);
  }

  /**
   * Referee close-up for a card at a stoppage: the booked player stands on his mark (x, z) facing the
   * referee, the lens picks its side of the pair (CameraRig.cardLens), and the man he brought down is held
   * beyond him, further from the lens and off to the side: small in the background, never standing in front
   * of him (all render only; the camera cuts away before anyone is let go).
   */
  private startCardShot(booked: number, x: number, z: number): void {
    this.cardT = CARD_CAM_S;
    this.cardRestart = this.match.restart;
    this.cardIdentity = this.match.players[booked].def.id;
    this.cardPlayer = booked;
    this.view.clearFades();
    this.view.pinPlayer(null);
    this.view.pinPlayer(booked, x, z);
    this.cam.setMode('card');
    const ref = this.view.refState;
    const victim = this.foulOn >= 0 && this.foulOn !== booked && !isSentOff(this.match.players[this.foulOn]) ? this.foulOn : -1;
    const lens = this.cam.cardLens(ref.x, ref.z, x, z, [booked, victim], this.view.headTop);
    this.cardVictim = victim;
    if (victim < 0) return;
    let ux = x - ref.x;
    let uz = z - ref.z;
    const h = Math.hypot(ux, uz) / 2 || 1;
    ux /= 2 * h;
    uz /= 2 * h;
    const mx = (ref.x + x) / 2;
    const mz = (ref.z + z) / 2;
    let wx = lens.x - mx;
    let wz = lens.z - mz;
    const wl = Math.hypot(wx, wz) || 1;
    wx /= wl;
    wz /= wl;
    const vx = clamp(mx + ux * (h + CARD_VICTIM_GAP) - wx * CARD_VICTIM_BACK, -(HALF_L + 2), HALF_L + 2);
    const vz = clamp(mz + uz * (h + CARD_VICTIM_GAP) - wz * CARD_VICTIM_BACK, -(HALF_W + 1.5), HALF_W + 1.5);
    this.view.pinPlayer(victim, vx, vz);
  }

  /**
   * Post-strike hold on our set piece: it ends early (a cut to the broadcast shot) once the ball comes back
   * towards the taker (off the wall, the woodwork, a parry) or anyone but the taker or a keeper touches it.
   */
  private trackHold(): void {
    const m = this.match;
    const b = m.ball;
    if (this.cam.behindActive && m.phase === 'restart' && m.restart) {
      this.holdKick = { taker: m.restart.taker, x: b.pos.x, z: b.pos.z, far: 0, struck: false };
      return;
    }
    const hk = this.holdKick;
    if (!hk) return;
    if (!this.cam.holding) {
      if (m.phase !== 'restart') this.holdKick = null;
      return;
    }
    if (!hk.struck) {
      // Armed from the moment the taker's boot sends it on its way.
      if (b.owner < 0 && b.lastTouch === hk.taker) hk.struck = true;
      else return;
    }
    const d = Math.hypot(b.pos.x - hk.x, b.pos.z - hk.z);
    hk.far = Math.max(hk.far, d);
    const lt = b.lastTouch;
    const other = lt >= 0 && lt !== hk.taker && !m.players[lt].isKeeper;
    if (other || (hk.far > 4 && d < hk.far - 1.5)) {
      this.cam.endHold();
      this.holdKick = null;
    }
  }

  /**
   * Low lenses see through whoever crowds them: within LENS_CLEAR of the camera (FK_LENS_CLEAR over the
   * free-kick taker's shoulder) a player fades right out (the free-kick camera's team-mates behind the ball,
   * anyone by a replay's goal-line lens or the card close-up's), and in the card close-up so does anyone
   * standing on the sight line to the referee or the offender. The card shot also drops the ball if it
   * sits right in front of the lens.
   */
  private updateFades(ref: { x: number; z: number; faceX: number; faceZ: number } | null, dt: number): void {
    const cam = this.cam;
    const scene = cam.mode === 'scene' && this.sceneClear > 0;
    const low = cam.behindActive || cam.mode === 'penalty' || cam.mode === 'card' || cam.mode === 'replay' || scene;
    const lens = this.world.camera.position;
    const f = this.view.frame;
    // The ball waiting on the free-kick spot is only clutter by the booked player's boots (or right in front
    // of the lens): the close-up leaves it out.
    this.view.setBallHidden(cam.mode === 'card' || !!this.interlude);
    if (!low) {
      this.view.clearFades();
      return;
    }
    const m = this.match;
    const keep = this.fadeKeep;
    const sight = this.fadeSight;
    keep.length = 0;
    sight.length = 0;
    const pool = this.sightPool;
    if (cam.mode === 'card') {
      if (this.cardPlayer >= 0) keep.push(this.cardPlayer);
      if (this.cardVictim >= 0) keep.push(this.cardVictim);
      // Sight lines to the referee, the offender and the gap between them run on past the pair, so nobody
      // stands in front of, between or right behind them in shot.
      const lx = this.world.camera.position.x;
      const lz = this.world.camera.position.z;
      if (ref) {
        const mx = (ref.x + ref.faceX) / 2;
        const mz = (ref.z + ref.faceZ) / 2;
        for (let k = 0; k < 3; k++) {
          const x = k === 0 ? ref.x : k === 1 ? mx : ref.faceX;
          const z = k === 0 ? ref.z : k === 1 ? mz : ref.faceZ;
          const q = pool[k];
          q.x = lx + (x - lx) * 1.6;
          q.z = lz + (z - lz) * 1.6;
          sight.push(q);
        }
      }
    } else if (scene) for (const i of this.sceneKeep) keep.push(i);
    else if (cam.mode === 'penalty' && m.shootout) keep.push(m.shootout.taker);
    else if (cam.mode === 'replay') {
      // Replays keep the action (whoever is at the ball; both keepers, the scorer and the defender nearest
      // the ball, always) and, on the low goal-line angle, see through anyone else standing between the
      // lens and the ball (never below REPLAY_MIN_ALPHA).
      const bx = f[BALL_OFS];
      const bz = f[BALL_OFS + 2];
      for (let i = 0; i < 22; i++) if (Math.hypot(f[i * PF] - bx, f[i * PF + 1] - bz) < REPLAY_KEEP) keep.push(i);
      keep.push(0, 11);
      if (m.lastGoalScorer >= 0) keep.push(m.lastGoalScorer);
      let best = -1;
      let bd = Infinity;
      for (const p of m.teamPlayers(m.goalSide === 0 ? 1 : 0)) {
        if (p.isKeeper) continue;
        const d = Math.hypot(f[p.idx * PF] - bx, f[p.idx * PF + 1] - bz);
        if (d < bd) {
          bd = d;
          best = p.idx;
        }
      }
      if (best >= 0) keep.push(best);
      if (cam.replayShot === 'goal') {
        const q = pool[3];
        q.x = bx;
        q.z = bz;
        sight.push(q);
      }
    } else if (cam.behindActive && m.restart && !this.replay) keep.push(m.restart.taker);
    // The card close-up is a clean two-shot: everyone (but the pair and the man held in the background)
    // standing no further from the lens than the booked player is cleared out of the frame.
    const bk = this.cardPlayer;
    const radius = scene ? this.sceneClear : cam.mode === 'card' && bk >= 0
      ? Math.max(LENS_CLEAR, Math.hypot(f[bk * PF] - lens.x, f[bk * PF + 1] - lens.z) + 0.5)
      : cam.mode === 'replay' && cam.replayShot === 'goal' ? REPLAY_LENS_CLEAR
        : cam.behindActive && !this.replay ? FK_LENS_CLEAR : LENS_CLEAR;
    // (The card shot latches its fades, with wider sight lines: a clean frame, no ghosts at the edges.)
    const card = cam.mode === 'card';
    const floor = cam.mode === 'replay' ? REPLAY_MIN_ALPHA : 0;
    this.view.fadeNearLens(lens.x, lens.z, radius, floor, keep, sight, card ? 1.3 : 0.85, card, dt, cam.justCut);
  }

  /** How far (0..1) the ball is towards the goal `side` attacks (past the first fifth of that half). */
  private toward(side: Side): number {
    const m = this.match;
    return clamp(((m.ball.pos.x * m.attackDir(side)) / HALF_L - 0.2) / 0.8, 0, 1);
  }

  private updateAtmosphere(dt: number): void {
    const m = this.match;
    // Fans lift as the ball nears the goal their team attacks.
    const t0 = this.toward(0);
    const t1 = this.toward(1);
    let h0 = 0.12 + t0 * 0.35;
    let h1 = 0.12 + t1 * 0.35;
    if (this.goalHypeT > 0) {
      this.goalHypeT -= dt;
      if (m.goalSide === 0) h0 = 1;
      else h1 = 1;
    }
    if (m.phase === 'halftime' || m.phase === 'fulltime') {
      h0 = h1 = 0.3;
    }
    this.stadium.setHype(h0, h1, dt);
    sfx.setExcitement(clamp(Math.max(t0, t1) * 0.8 + (this.goalHypeT > 0 ? 0.6 : 0), 0, 1));
    // The crowd behind each goal: murmuring, then restless, then roaring as the ball (a carrier bearing down
    // most of all) gets to their box; the whole end up after a goal there.
    const b = m.ball;
    const live = m.phase === 'play' && !this.replay;
    const owner = b.owner >= 0 ? m.players[b.owner] : null;
    let left = 0;
    let right = 0;
    if (live) {
      for (let e = -1; e <= 1; e += 2) {
        // The side attacking the goal at x = e * HALF_L.
        const att: Side = m.attackDir(0) === e ? 0 : 1;
        const heat = endHeat(Math.hypot(e * HALF_L - b.pos.x, b.pos.z), owner !== null && owner.side === att, owner === null && !b.held);
        if (e < 0) left = heat;
        else right = heat;
      }
    }
    if (this.goalHypeT > 0 && m.phase === 'goal') {
      if (m.ball.pos.x < 0) left = 1;
      else right = 1;
    }
    sfx.setEnds(left, right);
    sfx.tick(this.paused ? 0 : dt);
    matchAudio.frame(this.paused ? 0 : dt, m);
  }

  private updateHud(dt: number): void {
    const hud = this.hud;
    if (!hud) return;
    const m = this.match;
    if (this.moment) {
      // A moment counts down live-play seconds, with the HUD highlighting the final five seconds.
      const mo = this.moment;
      // (Live-play seconds: the judge's own count, never the match clock, which runs through dead balls.)
      const s = Math.ceil(scenarioSecondsLeft(m, mo.spec) - 1e-6);
      if (s !== this.lastMinute) {
        this.lastMinute = s;
        hud.setCountdown(s);
        this.stadium.setScore(m.score[0], m.score[1], mo.spec.untimed ? hud.countdownLabel ?? 'PRACTICE' : `${s}s`);
        if (!mo.spec.untimed && s > 0 && s <= MOMENT_COUNT_S && !mo.outcome && mo.briefT <= 0 && m.phase !== 'goal' && s !== mo.count) {
          mo.count = s;
          hud.show(String(s), '', 'small', 0.85);
        }
      }
    } else {
      // Broadcast clock: game time mm:ss, held at 45:00 / 90:00 while the added time counts on beside it ("+0:37").
      const halfGame = 45 * 60;
      const played = Math.min(m.clock / m.cfg.halfLength, 1) * halfGame;
      const gameSec = Math.floor((m.half - 1) * halfGame + played);
      const added = m.clock > m.cfg.halfLength ? Math.floor(((m.clock - m.cfg.halfLength) / m.cfg.halfLength) * halfGame) : -1;
      const key = gameSec * 10000 + added + 1;
      if (key !== this.lastMinute) {
        this.lastMinute = key;
        hud.setClock(gameSec, added >= 0 ? added : null);
        const minute = Math.floor(gameSec / 60);
        this.stadium.setScore(m.score[0], m.score[1], added >= 0 ? `${minute}+${Math.floor(added / 60) + 1}'` : `${minute}'`);
      }
    }
    // The minimap sits bottom-centre: off for set pieces, the low cameras, the shootout, and whenever play
    // is in the near third where it would cover the action.
    // (Set pieces: from the whistle until the delivery has had a moment to come in.)
    const setPiece = m.phase === 'restart' || m.phase === 'out';
    this.radarHoldT = setPiece ? RADAR_SETPIECE_HOLD : Math.max(0, this.radarHoldT - dt);
    // ...and whenever the ball or the man we control is drawn under it (a close camera distance), and through
    // a goal celebration (it would sit on the scorer's feet).
    this.radarOccT = this.radarOccludes(dt) ? RADAR_OCCLUDE_HOLD : Math.max(0, this.radarOccT - dt);
    // The owner (2026-09-30): "the map isnt always there for the players keep it always there". So it stays up
    // through open play, set pieces and goals; only the shots that need the whole screen take it away (the
    // shootout, the penalty and behind-the-taker cameras, a card close-up). When the ball or our man is drawn
    // under it, or play is on the near touchline it sits over, it goes see-through instead of vanishing.
    hud.setRadarHidden(m.phase === 'shootout' || this.cam.behindActive || this.cam.mode === 'penalty' || this.cam.mode === 'card');
    hud.setRadarDim(
      setPiece || this.radarHoldT > 0 || this.cam.mode === 'celebrate' || m.phase === 'goal' ||
      m.ball.pos.z > HALF_W * 0.45 || this.radarOccT > 0,
    );
    hud.update(dt, this.view.frame);
    // The over-the-shoulder set-piece camera needs the whole lower screen for the taker: no radar / chip.
    hud.setLive(
      !this.replay && !this.interlude && this.cam.mode !== 'scene' && this.cam.mode !== 'celebrate' && !this.cam.behindActive &&
      m.phase !== 'halftime' && m.phase !== 'fulltime' && this.introLeft <= 0 && !this.holdFirst &&
      !(this.moment !== null && this.moment.briefT > 0),
    );
    if (this.so && m.shootout) this.so.update(m.shootout);
    const hs = m.cfg.humanSide;
    if (hs < 0) return;
    const dev = this.input.lastDevice;
    const r = m.restart;
    const so = m.phase === 'shootout' ? m.shootout : null;
    const mine = m.ball.owner >= 0 && m.players[m.ball.owner].side === hs;
    const incoming = m.ball.owner < 0 && m.passTarget >= 0 && m.players[m.passTarget].side === hs && m.kickSide === hs;
    // The context the touch buttons are labelled for right now: hints name the button on screen.
    // (His corner or wide free kick, sim/setPiece.ts: the buttons are the three deliveries.)
    const ctx: HintCtx = so ? (so.turn === hs ? 'setpiece' : 'defend') : m.phase === 'restart' || m.phase === 'kickoff' ? (m.zoneAim ? 'delivery' : 'setpiece') : mine || incoming || m.canStrikeLoose() ? 'attack' : 'defend';
    this.hintCtx = ctx;
    // The hint is a coach card (ui/coach.ts: the same card, caps and words as the trainer's). A new hint: add a
    // cue there, or write words with key(), which names the player's own binding / the button on screen
    // ("`${key('pass')} to kick off`" draws as [SPACE] Kick off).
    const key = this.keyName;
    let hint: string | CoachCue | null = null;
    const soAim = !!so && (so.stage === 'aim' || so.stage === 'intro');
    if (so) {
      if (soAim && so.turn === hs) hint = penaltyCue(dev);
      else if (soAim) hint = diveCue(dev);
    } else if (m.phase === 'restart' && r && r.side === hs && r.kind === 'penalty') {
      hint = penaltyCue(dev);
    } else if ((m.phase === 'kickoff' || m.phase === 'restart') && r && r.side === hs) {
      hint = restartCue(r.kind, dev, m.zoneAim ? 'zone' : m.penAim ? 'goal' : undefined);
    } else if (m.ball.held && mine && !m.trainer) {
      // (With the trainer on, its card over the keeper says this already.)
      hint = keeperCue(dev);
    }
    // SKILL: a defender winding up a challenge on his man (sim/skills.ts) has the tell over him; the first few times
    // (until his first PERFECT) the tell names the button as well. The cue itself is the trainer's card when the trainer
    // is on (ui/trainer.ts), else then the hint band's.
    const sw = m.phase === 'play' && !this.replay ? skillWindow(m, hs as Side) : null;
    const teach = !!sw && this.skillTells <= SKILL_TEACH_TELLS && this.skillPerfects === 0;
    if (teach && !hint && !m.trainer) hint = skillCue(dev);
    // Nothing over the referee close-up (the set-piece hint comes back when the camera cuts back to the game).
    const cinematic = !!this.replay || this.cam.mode === 'card' || this.cam.mode === 'scene';
    hud.setHint(cinematic ? null : hint, true);
    // The penalty reticle on the goal, where his penalty (or shootout kick) is aimed, until it's struck.
    this.view.setPenAim(cinematic ? null : m.penAim);
    this.updateSetPieceAim(cinematic);
    // Aim arrow for our set pieces. A penalty (in the match or his shootout kick) and a shooting free kick have the
    // reticle instead, a corner or a wide free kick the landing ring.
    if (m.penAim || m.zoneAim || (so && soAim && so.turn === hs)) {
      this.aimFrozen = null;
      this.view.setAim(false);
    } else if (!cinematic && r?.kind === 'throwin' && r.side === hs && m.phase === 'restart' && m.throwPreview) {
      const aim = m.throwPreview;
      this.view.setAim(true, r.x, r.z, Math.atan2(aim.z - r.z, aim.x - r.x), 1.4);
    } else if (!cinematic && r && r.side === hs && m.phase === 'restart' && r.kind !== 'kickoff') {
      const t = m.players[r.taker];
      const long = r.kind === 'corner' || r.kind === 'goalkick' ? 1.6 : r.kind === 'freekick' || r.kind === 'penalty' ? 1.3 : 1;
      // From the ball (where the kick goes from, not the taker waiting at his run-up spot), along the aim he
      // has set; once he steps in to strike it the aim is fixed, so the arrow no longer follows his body
      // round on the run-up.
      const stepping = m.stepIn === r.taker;
      if (!stepping) this.aimFrozen = t.facing;
      const aim = stepping ? (this.aimFrozen ??= t.facing) : t.facing;
      this.view.setAim(true, m.ball.pos.x, m.ball.pos.z, aim, long);
    } else {
      this.aimFrozen = null;
      this.view.setAim(false);
    }
    this.updateTutorial(dt, key);
    if (m.active >= 0) {
      const p = m.players[m.active];
      hud.setPlayer(p.def.number, p.def.name, p.stamina);
      const charging = m.ball.owner === p.idx && m.shootCharge > 0.04;
      // Over his head is the goal mouth on the over-the-shoulder free-kick lens: the bar goes to his feet there.
      this.view.setPower(charging ? Math.min(1, m.shootCharge / 0.85) : null, p.pos.x, p.pos.z, p.y, this.cam.behindActive);
    }
    this.updatePassCharge(cinematic, dt);
    this.updateEdgeArrows(dt);
    // (While a skill move's pop rides over his man it has the space there: the card over him steps aside.)
    if (this.paused || cinematic || this.introLeft > 0 || this.cam.mode !== 'broadcast' || this.cam.behindActive || this.skillHud?.popping) this.trainer?.hide();
    else this.trainer?.update(m, this.view.frame, this.world.camera, this.view.headTop, dev);
    if (this.touch) {
      // Off for the intro, goal celebrations, replays and half / full time (CSS hides them too).
      // Off for the referee close-up too (the buttons would sit on the booked player).
      this.touch.setVisible(!(this.paused || this.introLeft > 0 || this.replay || this.cam.mode === 'card' || this.cam.mode === 'scene' || m.phase === 'goal' || m.phase === 'halftime' || m.phase === 'fulltime'));
      this.touch.setContext(ctx);
      // SKILL: shown with the ball at his feet in open play (and with a pass on its way to his man: the FLICK ON),
      // lit while a tell is open over his man; its pips are his FLAIR.
      const onBall = m.phase === 'play' && !m.ball.held && m.ball.owner >= 0 && m.ball.owner === m.active;
      const coming = m.phase === 'play' && incoming && m.passTarget === m.active;
      this.touch.setSkill(sw ? 'cue' : onBall || coming ? 'on' : 'off', skillFlair(m, hs as Side));
      // KEEPER: while defending with the ball near enough our goal for him to come for it (sim/keeper.ts keeperRush).
      const gx = -m.attackDir(hs as Side) * HALF_L;
      this.touch.setKeeper(ctx === 'defend' && m.phase === 'play' && !m.ball.held && Math.hypot(m.ball.pos.x - gx, m.ball.pos.z) < RUSH_RANGE);
      // TACKLE lit while their carrier's ball is in his man's reach: a tap now goes in at once (sim/dribble.ts).
      const man = m.active >= 0 ? m.players[m.active] : null;
      const theirs = m.ball.owner >= 0 && m.players[m.ball.owner].side !== hs;
      this.touch.setTackleReady(ctx === 'defend' && m.phase === 'play' && !m.ball.held && theirs && !!man && man.state === 'move' &&
        Math.hypot(man.footX() - m.ball.pos.x, man.footZ() - m.ball.pos.z) <= STAND_REACH);
    }
    this.actionPop?.update(this.view.frame, this.world.camera, this.view.headTop, this.paused || cinematic || this.cam.mode !== 'broadcast', dt);
    // (Keys and pads: the FLAIR chip over the player chip, while his man is on the ball.)
    this.skillHud?.setFlair(skillFlair(m, hs as Side), dev !== 'touch' && m.phase === 'play' && !m.ball.held && m.ball.owner >= 0 && m.ball.owner === m.active);
    const skillOff = this.paused || cinematic || this.introLeft > 0 || this.cam.mode !== 'broadcast';
    // (With the trainer's card up, the card names the button and the tell keeps off it.)
    const card = sw && m.trainer && this.trainer && !this.trainer.root.hidden ? this.trainer.root.querySelector('.trainer-card')?.getBoundingClientRect() : null;
    const avoid = card && card.width > 0 ? { l: card.left, t: card.top, r: card.right, b: card.bottom } : null;
    this.skillHud?.update(this.view.frame, this.world.camera, this.view.headTop, sw, teach && !avoid ? actionKey('skill', dev) : null, skillOff, dt, avoid);
    // Pause via keyboard / gamepad.
    const c = this.input.gamepadPause();
    if (c && !this.padPauseHeld && !this.paused) this.requestPause();
    this.padPauseHeld = c;
    const v = freePadButton(CAM_PAD);
    if (v && !this.padCamHeld && !this.paused) this.cycleCamZoom();
    this.padCamHeld = v;
  }

  /**
   * The quick-sub card: up over live play and dead balls on the broadcast lens only (never a replay, a goal
   * celebration, the card close-up, the over-the-shoulder set-piece lens, the fly-in or the pause menu). A queued
   * change is made at the first stoppage the picture is free for: never under the referee's close-up or the foul's
   * impact beat (the man coming off might be the one in it).
   */
  private updateQuickSub(dt: number): void {
    const q = this.quick;
    if (!q) return;
    const m = this.match;
    const cam = this.cam;
    const ph = m.phase;
    const live = !this.paused && !this.driver && !this.replay && !this.interlude && this.introLeft <= 0 && !this.holdFirst;
    const shown = live && cam.mode === 'broadcast' && !cam.behindActive && !this.cineHud &&
      (ph === 'play' || ph === 'out' || ph === 'restart' || ph === 'kickoff');
    const ready = live && this.cardT <= 0 && cam.mode !== 'card' && !this.foulPresentation.waiting;
    q.update(this.paused ? 0 : dt, shown, ready);
  }

  /** The touch-button context the hints are worded for this frame (see updateHud). */
  private hintCtx: HintCtx = 'attack';
  /**
   * The cap for `k` on the device in hand: the player's own key or pad button, or the label the touch button wears
   * now (bound once: the hints call it several times a frame). Already the binding: never remapped again.
   */
  private readonly keyName = (k: HintKey): string => keyCap(k, this.input.lastDevice, this.hintCtx);

  /** Is the ball, or the controlled player (boots to head), drawn under the minimap (or within RADAR_MARGIN of it)? */
  private radarOccludes(dt: number): boolean {
    const hud = this.hud;
    if (!hud || typeof window === 'undefined') return false;
    this.radarEl ??= hud.root.querySelector<HTMLElement>('.hud-radar');
    const el = this.radarEl;
    if (!el) return false;
    this.radarRectT -= dt;
    if (this.radarRectT <= 0) {
      // (Measured while it is shown: hidden, it has no box, and the last one stands.)
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) this.radarRect = { l: r.left, t: r.top, r: r.right, b: r.bottom };
      this.radarRectT = RADAR_RECT_S;
    }
    const R = this.radarRect;
    if (!R) return false;
    const f = this.view.frame;
    if (this.underRadar(R, f[BALL_OFS], f[BALL_OFS + 1], f[BALL_OFS + 2])) return true;
    const a = this.match.active;
    if (a < 0 || a >= 22) return false;
    const x = f[a * PF];
    const z = f[a * PF + 1];
    return this.underRadar(R, x, 0, z) || this.underRadar(R, x, this.view.headTop * 0.5, z) || this.underRadar(R, x, this.view.headTop, z);
  }

  /** Is world point (x, y, z) drawn under the minimap's rectangle `R` (or within RADAR_MARGIN of it)? */
  private underRadar(R: { l: number; t: number; r: number; b: number }, x: number, y: number, z: number): boolean {
    const cam = this.world.camera;
    const v = (this.scratchV ??= cam.position.clone());
    v.set(x, y, z).project(cam);
    if (v.z > 1) return false;
    const sx = ((v.x + 1) / 2) * window.innerWidth;
    const sy = ((1 - v.y) / 2) * window.innerHeight;
    return sx > R.l - RADAR_MARGIN && sx < R.r + RADAR_MARGIN && sy > R.t - RADAR_MARGIN && sy < R.b + RADAR_MARGIN;
  }

  /**
   * Pass charging (PASS held, Match.passCharge 0..1 / passAim): the teal bar at the passer's feet, and the
   * ring and arrow on the teammate the pass is locked onto. Live play only (never over a replay or the card
   * close-up); it all goes the frame PASS is let go (passCharge back to -1). Not charging, with the ball at
   * the human's feet: the pass-target preview (Match.passPreview / throughPreview; see updatePreview).
   */
  private updatePassCharge(off: boolean, dt: number): void {
    const m = this.match;
    const hs = m.cfg.humanSide;
    const charge = typeof m.passCharge === 'number' ? m.passCharge : -1;
    const own = m.ball.owner;
    const passer = own >= 0 && m.players[own].side === hs ? own : m.active;
    if (off || this.replay || hs < 0 || !(charge >= 0) || passer < 0 || passer >= m.players.length) {
      this.view.setPassCharge(null);
      this.updatePreview(off || !!this.replay || hs < 0, dt);
      this.updateLanding(off || !!this.replay || hs < 0);
      return;
    }
    // (The charge visuals take over from the preview at once.)
    this.view.setPassPreview(-1, -1, 0, 0, dt, true);
    const f = this.view.frame;
    const aim = typeof m.passAim === 'number' ? m.passAim : -1;
    const locked = aim >= 0 && aim < m.players.length && aim !== passer && m.players[aim].side === hs;
    this.view.setPassCharge(
      charge, f[passer * PF], f[passer * PF + 1], locked ? f[aim * PF] : null, locked ? f[aim * PF + 1] : 0, this.cam.behindActive,
      locked ? aim : -1,
    );
  }

  /** A preview index from the sim made safe: one of the human's team-mates on the pitch (not him), else -1. */
  private mateIdx(v: unknown): number {
    const m = this.match;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= m.players.length || v === m.active) return -1;
    const p = m.players[v];
    return p.side === m.cfg.humanSide && !isSentOff(p) ? v : -1;
  }

  /**
   * Pass-target preview while the human has the ball at his feet and isn't charging: the calm ring (and white
   * pip) on whoever a PASS pressed now goes to, the dashed ring in the space ahead of whoever a THROUGH goes to
   * (MatchView.setPassPreview cross-fades any change of target). The broadcast shot only, never under a low
   * lens; anything else fades it off.
   */
  /**
   * A ring where the human side's airborne ball (a lob, cross or clearance, not a shot) will come down; and, whoever
   * struck it, where his man meets a ball in the air he is locked onto (the sim's aerial lock: HumanCtl.air), lit.
   */
  private updateLanding(off: boolean): void {
    const m = this.match;
    const b = m.ball;
    const hs = m.cfg.humanSide;
    const air = hs >= 0 && m.phase === 'play' && b.owner < 0 && !b.held ? m.ctl[hs as Side].air : null;
    if (!off && air && air.on && b.pos.y > 0.6) {
      this.view.setLanding(true, air.x, air.z, this.time, true);
      return;
    }
    const ours = m.cfg.humanSide >= 0 && b.lastTouchSide === m.cfg.humanSide;
    const flying = !b.held && b.owner < 0 && b.pos.y > 1.2 && m.kickKind !== 'shot' && m.kickKind !== 'header';
    let down: { x: number; z: number } | null = null;
    if (!off && ours && flying) {
      const path = m.ballPath;
      for (let i = 0; i < path.length; i++) {
        if (path[i].y <= BALL_R + 0.05) {
          down = path[i];
          break;
        }
      }
    }
    if (!down) this.view.setLanding(false);
    else this.view.setLanding(true, down.x, down.z, this.time);
  }

  private updatePreview(off: boolean, dt: number): void {
    const m = this.match;
    const cam = this.cam;
    // (At his kick-off too: the ring is on the team-mate the protected kick-off goes to, sim Match.kickoffMate.)
    const on = !off && m.active >= 0 && m.ball.owner === m.active && (m.phase === 'play' || m.phase === 'restart' || m.phase === 'kickoff') &&
      cam.mode === 'broadcast' && !cam.behindActive && this.introLeft <= 0;
    if (!on) {
      this.view.setPassPreview(-1, -1, 0, 0, dt, !!this.replay || cam.mode !== 'broadcast');
      return;
    }
    const pass = this.mateIdx((m as { passPreview?: unknown }).passPreview);
    const through = m.phase === 'kickoff' || (m.phase === 'restart' && m.restart?.kind === 'throwin') ? -1 : this.mateIdx((m as { throughPreview?: unknown }).throughPreview);
    let ax = 0;
    let az = 0;
    if (through >= 0) {
      // The space ahead of the runner: along his run, or (standing) towards the goal we attack.
      const r = m.players[through];
      const f = this.view.frame;
      const sp = Math.hypot(r.vel.x, r.vel.z);
      const ad = m.attackDir(m.cfg.humanSide as Side);
      const ux = sp > 1.2 ? r.vel.x / sp : ad;
      const uz = sp > 1.2 ? r.vel.z / sp : 0;
      const ahead = clamp(2.4 + sp * 0.35, 2.4, 5);
      ax = clamp(f[through * PF] + ux * ahead, -HALF_L + 1, HALF_L - 1);
      az = clamp(f[through * PF + 1] + uz * ahead, -HALF_W + 1, HALF_W - 1);
    }
    this.view.setPassPreview(pass, through, ax, az, dt);
  }

  /**
   * Off-screen team-mates (EDGE_FADE_S): project the human's team-mates through this frame's camera and hand
   * them to the edge arrows, which draw the ones outside the frame. Our ball, or a loose one near us, in open
   * play on the broadcast shot only: never over a set piece, a replay, a celebration or a close-up.
   */
  private updateEdgeArrows(dt: number): void {
    const ea = this.edge;
    if (!ea || typeof window === 'undefined') return;
    const m = this.match;
    const hs = m.cfg.humanSide as Side;
    const cam = this.cam;
    const show = !this.paused && !this.replay && this.introLeft <= 0 && m.phase === 'play' && cam.mode === 'broadcast' &&
      !cam.behindActive && this.nearOurBall();
    this.edgeFade = clamp(this.edgeFade + (show ? dt : -dt) / EDGE_FADE_S, 0, 1);
    if (this.edgeFade <= 0) {
      ea.hide();
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.edgeAvoidT -= dt;
    if (this.edgeAvoidT <= 0) {
      // The minimap, (touch) the action buttons, the quick-sub card and the score bug: re-measured twice a second.
      this.edgeAvoidT = RADAR_RECT_S;
      this.edgeAvoid = [];
      safeAreaInsets(this.edgeInset);
      const boxes = [this.hud?.root.querySelector('.hud-radar'), this.touch?.isVisible ? this.touch.root.querySelector('.touch-btns') : null,
        this.hud?.root.querySelector('.hud-qsub.on'), this.hud?.root.querySelector('.hud-pause'), this.hud?.root.querySelector('.hud-cam'),
        // (The score bug grows with the HYPE bars and a live goal under it: game/funPresent.ts.)
        this.hud?.root.querySelector('.scorebug')];
      for (const el of boxes) {
        const r = el?.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) this.edgeAvoid.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
      }
    }
    const camera = this.world.camera;
    camera.updateMatrixWorld();
    const v = (this.scratchV ??= camera.position.clone());
    const f = this.view.frame;
    const bx = f[BALL_OFS];
    const bz = f[BALL_OFS + 2];
    const out = this.edgeMates;
    out.length = 0;
    // While a pass is charged, the man it's locked onto is the one lit (the preview is off by then).
    const charging = typeof m.passCharge === 'number' && m.passCharge >= 0;
    const aim = charging && typeof m.passAim === 'number' ? m.passAim : -1;
    for (const p of m.teamPlayers(hs)) {
      const i = p.idx;
      if (i === m.active || isSentOff(p)) continue;
      const x = f[i * PF];
      const z = f[i * PF + 1];
      // Chest height, in the lens's own space first: someone behind it (portrait, end-on) points the other way.
      v.set(x, this.view.headTop * 0.5 + PITCH_Y, z).applyMatrix4(camera.matrixWorldInverse);
      let sx: number;
      let sy: number;
      if (v.z > -0.5) {
        sx = W / 2 + v.x * 1e4;
        sy = H / 2 - v.y * 1e4;
      } else {
        v.applyMatrix4(camera.projectionMatrix);
        sx = ((v.x + 1) / 2) * W;
        sy = ((1 - v.y) / 2) * H;
      }
      const d = Math.hypot(x - bx, z - bz);
      // (Pooled: the same EdgeMate objects every frame, refilled.)
      const q = (this.matePool[out.length] ??= { idx: 0, x: 0, y: 0, num: 0, alpha: 1, pass: 0, through: 0 });
      q.idx = i;
      q.x = sx;
      q.y = sy;
      q.num = p.def.number;
      q.alpha = 1 - (1 - EDGE_MIN_ALPHA) * smoothstep(EDGE_NEAR, EDGE_FAR, d);
      q.pass = i === aim ? 1 : this.view.previewWeight(i);
      q.through = this.view.throughWeight(i);
      out.push(q);
    }
    // Inside the notch's insets too (a landscape iPhone's camera housing takes about 62 px of one side).
    const box = this.edgeBox;
    const ins = this.edgeInset;
    box.l = EDGE_SIDE + ins.l;
    box.t = Math.min(EDGE_TOP, H * 0.2) + ins.t;
    box.r = W - EDGE_SIDE - ins.r;
    box.b = H - Math.min(EDGE_BOTTOM, H * 0.22) - ins.b;
    ea.update(out, this.edgeFade, box, this.edgeAvoid);
  }

  /** Our ball, our pass on its way, or a loose ball nearer one of ours (within EDGE_LOOSE m) than any of them. */
  private nearOurBall(): boolean {
    const m = this.match;
    const hs = m.cfg.humanSide;
    const b = m.ball;
    if (b.owner >= 0) return m.players[b.owner].side === hs;
    const pt = this.view.frame[BALL_OFS + 10];
    if (pt >= 0 && pt < 22 && m.players[pt].side === hs) return true;
    let us = Infinity;
    let them = Infinity;
    for (const p of m.players) {
      if (isSentOff(p)) continue;
      const d = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
      if (p.side === hs) us = Math.min(us, d);
      else them = Math.min(them, d);
    }
    return us < EDGE_LOOSE && us <= them;
  }

  /**
   * The first match's tips for a player who turned the trainer off: the trainer's own cards (ui/coach.ts), one
   * at a time in the tip slot, until he has moved, passed, shot, tried a chip and defended.
   */
  private updateTutorial(dt: number, key: (k: HintKey) => string): void {
    const hud = this.hud;
    if (!hud || !this.opt.tutorial) return;
    // The persistent trainer carries the controls beside the player; don't duplicate them across the pitch.
    if (this.match.trainer) { hud.setTip(null); return; }
    const m = this.match;
    const t = this.tut;
    const c = this.input.read();
    if (Math.hypot(c.sx, c.sy) > 0.3 && m.phase === 'play') t.moved = true;
    if (m.phase !== 'play' || this.replay) {
      hud.setTip(null);
      return;
    }
    t.t += dt;
    const dev = this.input.lastDevice;
    const mine = m.ball.owner >= 0 && m.players[m.ball.owner].side === m.cfg.humanSide;
    let tip: CoachCue | null = null;
    if (!t.moved) {
      const mv = moveCue(dev);
      // (Sprinting is the stick's job: only keys or a pad with AUTO SPRINT turned off have a SPRINT to hold.)
      tip = dev !== 'touch' && !TouchControls.autoSprint ? { ...mv, actions: [...mv.actions, [key('sprint'), 'Hold to sprint']] } : mv;
    }
    // (Round 9 controls: PASS goes at once to the mate the preview rings; THROUGH sends that runner in behind.)
    else if (mine && !t.passed) tip = {
      title: 'PASS',
      // (On MANUAL passing nobody is ringed: the ball goes where the stick points.)
      actions: [[key('pass'), m.groundAssist === 'manual' ? 'Pass where you aim' : 'Pass to the ringed teammate'], [key('through'), 'Through ball']],
      ...(m.quickPass ? {} : { detail: `Hold ${key('pass')} for a harder pass` }),
    };
    else if (mine && !t.shot) tip = {
      title: 'SHOOT', actions: [[key('shoot'), 'Hold, aim, let go']],
      detail: m.timedFinish ? `${pressVerb(dev)} ${key('shoot')} again as you strike` : 'A longer hold lifts it',
    };
    else if (mine && !t.chip) {
      // Once he has had a shot: the finishes (shown for a while on the ball, or until he tries one).
      tip = { title: 'CHIP', actions: [[key('shoot'), 'Hold'], [key('through'), `${pressVerb(dev)} to chip`]], detail: 'A soft diagonal shot curls' };
      t.chipT += dt;
      if (t.chipT > 14) t.chip = true;
    }
    else if (!mine && m.ball.owner >= 0 && !t.switched) {
      tip = defendCue(dev);
      if (t.t > 60) t.switched = true;
    }
    if (t.moved && t.passed && t.shot && t.chip && (t.switched || t.t > 90)) this.opt.tutorial = false;
    hud.setTip(tip);
  }

  dispose(): void {
    this.foulPresentation.clear();
    this.world.scene.remove(this.stadium.group, this.view.group, this.effects.mesh, this.weather.group);
    if (!this.demo) document.body.classList.remove('night');
    // The night fill is shared by every footballer drawn (menu kit previews too): off until a match sets it.
    setCharacterFill(0);
    setCharacterHemiFill(0);
    setCharacterWhiteBalance();
    sfx.setRain(false);
    sfx.setAmbienceActive(false);
    matchAudio.end(this.match);
    this.offKey?.();
    this.offKey = null;
    this.offCamKey?.();
    this.offCamKey = null;
    this.offPointer?.();
    this.offPointer = null;
    this.clips.dispose();
    sfx.endCapture();
    this.ghost?.dispose();
    this.ghost = null;
    this.flash.dispose();
    this.blitz?.dispose();
    this.blitz = null;
    this.quick?.dispose();
    this.quick = null;
    // (Only if it is still this match's: a new session may have taken it over already.)
    if (sfx.onChant === this.onChant) sfx.onChant = null;
    this.view.frameHook = null;
    this.subScene.dispose();
    this.matchTunnel?.dispose();
    this.matchTunnel = null;
    this.interlude = null;
    this.present?.dispose();
    this.present = null;
    this.hud?.dispose();
    this.touch?.dispose();
    this.input.touch.enabled = false;
    this.stadium.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.decor?.dispose();
    this.fun?.dispose();
    this.stadium.dispose();
    this.fxKit.dispose();
  }
}

import type * as THREE from 'three';
