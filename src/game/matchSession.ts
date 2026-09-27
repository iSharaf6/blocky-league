import { sfx } from '../audio/sfx';
import type { Input } from '../core/input';
import { CELEBRATION_IDS, type CamZoom, type CelebrationId } from '../core/save';
import { clamp, damp, smoothstep } from '../core/math';
import { BlitzFx, POWER_COLOR, POWER_LIGHT } from '../render/blitz';
import { CameraRig } from '../render/cameraRig';
import { AI_CELEBRATIONS, type CelebCue } from '../render/celebration';
import { setCharacterFill, setCharacterHemiFill, setCharacterWhiteBalance } from '../render/characters';
import { Effects } from '../render/effects';
import { MatchView } from '../render/matchView';
import { PITCH_Y, Stadium, stadiumFill } from '../render/stadium';
import { Weather, type WeatherKind } from '../render/weather';
import type { TimeOfDay, World } from '../render/world';
import { BALL_R, DT, HALF_L, HALF_W } from '../sim/constants';
import { EMPTY_PAD, Match, type MatchConfig, type Pad } from '../sim/match';
import { goalsOf } from '../sim/shootout';
import type { Kit, MatchEvent, PowerUpKind, RestartKind, ScenarioSpec, Side } from '../sim/types';
import { applyScenario, finishScenario, judgeScenario, scenarioSecondsLeft, type ScenarioOutcome } from '../sim/scenario';
import { EdgeArrows, type EdgeMate, type EdgeRect } from '../ui/edgeArrows';
import { Hud, hudTeam } from '../ui/hud';
import { ShootoutHud } from '../ui/shootoutHud';
import { TouchControls, isTouchDevice } from '../ui/touch';
import { Trainer } from '../ui/trainer';
import { grassSafeKit, resolveKitClash } from '../meta/data';
import { playFocus } from './camFocus';
import { contrastAwayKit } from './kitContrast';
import { MatchTally, type PlayerRating } from './ratings';
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
  /** A Football Moment to run instead of a full match (src/sim/scenario.ts applies and judges it). */
  scenario?: ScenarioSpec;
  /** Colour-blind aid: shape cues on rings and markers (dashed opponent rings, a chevron on your team), not colour alone. */
  colorblind?: boolean;
}

/**
 * Feeds the sim its steps instead of this machine's input alone: an online match (src/ui/online.ts drives it
 * with the lockstep engine, src/net/lockstep.ts). With a driver the session steps only when the driver has
 * both sides' pads, lets it move the match on at stoppages (the same tick on both machines), and plays no
 * replays and shows no half-time menu (either would hold one screen and not the other).
 */
export interface StepDriver {
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
}

/** Seconds on the wide shot after a goal (the ball in the net) before cutting to the scorer. */
const GOAL_WIDE_S = 0.7;
/** The replay rolls once the celebration has had its moment (the scorer has been mobbed). */
const REPLAY_AT = 2.6;
/** A goal that gets no replay (an ordinary tap-in by either side): the celebration runs this long, then the kick-off. */
const NO_REPLAY_AT = 3.4;
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
const HALFTIME_HOLD_S = 1.0;
const FULLTIME_HOLD_S = 1.8;
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
 * Hit-stop (frames the drawn frame and the sim hold still, the camera punch and the burst landing on the
 * frozen picture) on a won tackle and on a goal; the camera punch (m: ~3 px at broadcast distance) and the
 * goal's shake (~8 px, decaying).
 */
const HIT_STOP_TACKLE = 2;
const HIT_STOP_GOAL = 3;
const PUNCH_TACKLE = 0.09;
const SHAKE_GOAL = 0.27;
/** A 'tackle' outcome within this long (s) of a 'tackleTry' from the same man is the same attempt. */
const TACKLE_TRY_S = 0.15;
/** Pace readability: speed lines and dust from this speed (m/s); the ball trails from this speed. */
const SPRINT_FX_MS = 7;
const BALL_TRAIL_MS = 18;
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

/**
 * On-screen labels of the touch buttons (mirrors ui/touch.ts LABELS): hints name the button the player sees.
 * [pass, shoot, through] per context.
 */
const TOUCH_LABELS = {
  attack: ['PASS', 'SHOOT', 'THROUGH'],
  defend: ['SWITCH', 'TACKLE', 'PRESS'],
  setpiece: ['PASS', 'SHOOT', 'CROSS'],
} as const;
type HintCtx = keyof typeof TOUCH_LABELS;
type HintKey = 'pass' | 'shoot' | 'through';

/** The presentation pace, for tests (seconds; see INTRO_S and friends). */
export const PRESENTATION = {
  introS: INTRO_S, goalWideS: GOAL_WIDE_S, replayAtS: REPLAY_AT, replayLeadS: REPLAY_LEAD_S, replayTailS: REPLAY_TAIL_S,
  buildRate: REPLAY_BUILD_RATE, slowRate: REPLAY_SLOW_RATE, slowFromS: REPLAY_SLOW_FROM, halftimeHoldS: HALFTIME_HOLD_S,
  fulltimeHoldS: FULLTIME_HOLD_S, hitStopTackle: HIT_STOP_TACKLE, hitStopGoal: HIT_STOP_GOAL,
} as const;

const RESTART_LABEL: Record<RestartKind, string> = {
  kickoff: 'KICK OFF', throwin: 'THROW-IN', corner: 'CORNER', goalkick: 'GOAL KICK', freekick: 'FREE KICK', penalty: 'PENALTY!',
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
  readonly weather = new Weather();
  readonly cam: CameraRig;
  readonly hud: Hud | null;
  readonly touch: TouchControls | null;
  private trainer: Trainer | null = null;
  paused = false;
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
  private latch = { pass: false, shoot: false, through: false, power: false };
  private offKey: (() => void) | null = null;
  /** Off-screen team-mate arrows (see EDGE_FADE_S), their eased opacity, and the HUD boxes they keep off. */
  private edge: EdgeArrows | null = null;
  private edgeFade = 0;
  private edgeAvoid: EdgeRect[] = [];
  private edgeAvoidT = 0;
  private edgeMates: EdgeMate[] = [];
  /** Hit-stop frames left (see HIT_STOP_TACKLE). */
  private hitStop = 0;
  /**
   * Standing-tackle lunges baked into the frames (replay.ts writeFrame): per player, seconds since his TACKLE
   * press (< 0: none) and the leg he lunges with; and when his last attempt was seen (TACKLE_TRY_S).
   */
  private lunge = new Float32Array(22).fill(-1);
  private lungeLeg = new Float32Array(22).fill(1);
  private tryAt = new Float32Array(22).fill(-1e9);
  /** Per player: the pose state drawn last frame (dust on a dive / a fall) and a particle-rate accumulator. */
  private lastState = new Float32Array(22).fill(-1);
  private fxAcc = new Float32Array(22);
  private ballFxAcc = 0;
  /** Blitz visuals (made on the first frame of a blitz match; never otherwise). */
  private blitz: BlitzFx | null = null;
  /** Blitz: which side is frozen by a freeze event (and its fallback timer), the mega ball in flight, the last hot state. */
  private frozenSide = -1;
  private frozenT = 0;
  private megaFlyT = 0;
  private megaHot = false;
  private frozen = new Uint8Array(22);

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
      this.moment = { spec: opt.scenario, briefT: MOMENT_BRIEF_S, outcome: null, endT: -1, count: -1 };
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
      // (A draw from the sim's own rng: online, both machines build the session the same way, so they draw it
      // alike. Never draw from match.rng on anything local, like the graphics quality: the two games would part.)
      seed: this.match.rng.int(1e9),
    });
    this.view = new MatchView(teams, opt.kits, opt.humanSide);
    this.applyTimeOfDay(opt.timeOfDay ?? 'day', opt.weather ?? 'clear');
    this.view.group.position.y = PITCH_Y;
    this.effects.mesh.position.y = PITCH_Y;
    world.scene.add(this.stadium.group, this.view.group, this.effects.mesh, this.weather.group);
    this.cam = new CameraRig(world.camera);
    this.cam.players = this.view.frame;
    this.cam.touchLayout = !this.demo && isTouchDevice();
    this.cam.setZoom(opt.camZoom ?? 'normal');
    this.view.setBallSkin(opt.ballSkin);
    this.view.celeb.onCue = (c) => this.celebCue(c);
    const intro = !this.demo && !opt.skipIntro && !this.moment;
    this.cam.setMode(this.demo ? 'menu' : intro ? 'intro' : 'broadcast');
    if (intro) this.introLeft = INTRO_S;
    this.holdFirst = !this.demo && !!opt.firstMatch && !this.moment && (opt.humanSide === 0 || opt.humanSide === 1);
    if (!this.demo) {
      this.hud = new Hud(
        [hudTeam(teams[0], opt.kits[0].shirt, opt.kits[0].shirt2), hudTeam(teams[1], opt.kits[1].shirt, opt.kits[1].shirt2)],
        opt.humanSide,
      );
      this.hud.onPause = () => this.requestPause();
      document.getElementById('ui')!.appendChild(this.hud.root);
      this.trainer = new Trainer();
      this.hud.root.appendChild(this.trainer.root);
      if (opt.humanSide === 0 || opt.humanSide === 1) {
        this.edge = new EdgeArrows(this.view.teamColor.fill, this.view.teamColor.edge);
        this.hud.root.appendChild(this.edge.root);
      }
      this.touch = new TouchControls(input);
      document.getElementById('ui')!.appendChild(this.touch.root);
      this.touch.setEnabled(isTouchDevice());
      // Latch presses as they happen (see `latch`): a key-down is read through Input itself (whatever it maps
      // to), a touch button by its own press.
      this.offKey = input.onKey(() => this.latchPresses(input.read()));
      this.touch.onPress = (k) => {
        if (k !== 'sprint') this.latch[k] = true;
      };
    } else {
      this.hud = null;
      this.touch = null;
    }
    writeFrame(this.match, this.cur, 0);
    this.prev.set(this.cur);
    sfx.setAmbienceActive(!this.demo);
    if (this.hud && this.moment) {
      const s = this.moment.spec;
      this.hud.show(s.title, s.brief, 'small intro', MOMENT_BRIEF_S - 0.1);
      this.hud.setScore(this.match.score[0], this.match.score[1]);
      this.stadium.setScore(this.match.score[0], this.match.score[1], `${this.match.minute()}'`);
      this.prevButtons = true;
    } else if (this.hud && intro) {
      this.hud.show(`${teams[0].short} v ${teams[1].short}`, `${teams[0].name} · ${teams[1].name}`, 'small intro', INTRO_S - 0.2);
      this.prevButtons = true;
    }
  }

  /** The human side's goal celebration for the next goal (Settings > CELEBRATION changed mid-match). */
  setCelebration(id: string | undefined): void {
    this.opt.celebration = id;
  }

  /** Light the match for a time of day and weather (sky, lights, stadium, footballers, particles, rain audio). */
  applyTimeOfDay(tod: TimeOfDay, wx: WeatherKind): void {
    const world = this.world;
    world.setTimeOfDay(tod, wx);
    // Night matches: the UI can key off this (vignette, HUD tint); the 3D vignette is the stadium's own.
    if (!this.demo) document.body.classList.toggle('night', tod === 'night');
    this.stadium.setTimeOfDay(tod);
    this.stadium.setWeather(wx);
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

  requestPause(): void {
    if (this.demo || this.paused) return;
    this.paused = true;
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
    const ok = m.substitute(side, slot, benchIdx);
    if (ok) this.view.replacePlayer(m.teamPlayers(side)[slot].idx, m.teamPlayers(side)[slot].def, this.opt.kits[side]);
    return ok;
  }

  setMentality(side: Side, v: number): void {
    this.match.mentality[side] = Math.max(-1, Math.min(1, v));
  }

  continueSecondHalf(): void {
    // The AI managers (both in AI-vs-AI, never the human's) freshen up tired legs at the break.
    const m = this.match;
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
    this.hud?.show('SECOND HALF', '', 'small', 1.6);
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
      if (c.pass || c.shoot || c.through) return { mx: w.x, mz: w.z, sprint: c.sprint, pass: false, shoot: false, through: false, digital: this.input.lastDevice === 'keyboard', power: false };
      this.eatButtons = false;
    }
    const pad: Pad = {
      mx: w.x, mz: w.z, sprint: c.sprint, pass: c.pass || l.pass, shoot: c.shoot || l.shoot, through: c.through || l.through,
      // Keys give 8-way digital input: the sim turns set-piece aim gradually for those.
      digital: this.input.lastDevice === 'keyboard',
      // Blitz: use the held power-up (keyboard E / pad Y / the touch button, once the input maps it).
      power: ((c as { power?: boolean }).power ?? false) || l.power,
    };
    this.clearLatch();
    return pad;
  }

  /** Note whichever action buttons are down right now (called on every key-down). */
  private latchPresses(c: { pass: boolean; shoot: boolean; through: boolean; power?: boolean }): void {
    if (this.demo || this.paused) return;
    const l = this.latch;
    l.pass ||= c.pass;
    l.shoot ||= c.shoot;
    l.through ||= c.through;
    l.power ||= c.power ?? false;
  }

  private clearLatch(): void {
    const l = this.latch;
    l.pass = l.shoot = l.through = l.power = false;
  }

  update(realDt: number): void {
    const dt = Math.min(realDt, 0.1);
    this.time += dt;
    const m = this.match;
    // (Online: the link is kept up every frame, whatever the screen is doing.)
    this.driver?.frame();

    // (A press only carries over to the next live step: nothing latched while the sim isn't stepping.)
    const briefing = this.moment !== null && this.moment.briefT > 0;
    if (this.paused || this.introLeft > 0 || this.replay || briefing) this.clearLatch();
    let held = false;
    if (this.paused) {
      // Frozen: live play, a replay or the pre-match fly-in all wait for the pause menu.
    } else if (this.hitStop > 0) {
      // Hit-stop: the drawn frame, the sim and the particles hold for a frame or two (the punch lands on it).
      this.hitStop--;
      held = true;
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
    } else if (this.replay) {
      this.stepReplay(dt);
    } else {
      const drv = this.driver;
      this.acc += drv ? dt * drv.pace() : dt;
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
        m.step(DT, pad);
        drv?.after(m);
        // (Events first: a TACKLE press this step is baked into this very frame as the lunge.)
        this.handleEvents(m.drainEvents());
        if (this.moment) this.judgeMoment();
        for (let i = 0; i < 22; i++) if (this.lunge[i] >= 0 && (this.lunge[i] += DT) >= LUNGE_S) this.lunge[i] = -1;
        writeFrame(m, this.cur, this.time, this.lunge, this.lungeLeg);
        this.buffer.push(m, this.time, this.lunge, this.lungeLeg);
        this.recorded++;
        this.acc -= DT;
        steps++;
        if (this.hitStop > 0) {
          // Freeze on the impact frame: whatever was left over is dropped, never caught up after the hold.
          this.acc = 0;
          break;
        }
      }
      if (steps === 6) this.acc = 0;
      this.netWaitS = waited && steps === 0 ? this.netWaitS + dt : 0;
      // (See PHASE_WANT: at about the step rate, keep the drawn frame close to the newest step.)
      if (dt > DT * 0.8 && dt < DT * 2.5 && this.hitStop <= 0 && !waited) this.acc += clamp(PHASE_WANT * DT - this.acc, -PHASE_NUDGE * DT, PHASE_NUDGE * DT);
      this.view.apply(this.prev, this.cur, this.hitStop > 0 ? 1 : clamp(this.acc / DT, 0, 1), this.time, dt);
      this.updateFrameFx(dt);
      this.updateBlitz(dt);
      this.flow(dt);
      if (this.cardT > 0) {
        this.cardT -= dt;
        // Back to the game when the close-up is done, or at once if play restarts under it.
        if (this.cardT <= 0 || m.phase === 'play' || m.phase === 'goal') {
          this.cardT = 0;
          this.view.pinPlayer(null);
          this.view.setBallHidden(false);
          this.cardPlayer = -1;
          this.cardVictim = -1;
          if (this.cam.mode === 'card') this.cam.setMode('broadcast');
        }
      }
    }

    // Camera: the live-play focus (ball, controlled player, possession lean, set piece; see camFocus), with
    // the subject swapped for the celebrating scorer / the shootout winners.
    const f = this.view.frame;
    const focus = playFocus(m, f, this.view.headTop);
    let ax = focus.ax;
    let az = focus.az;
    let avx = 0;
    let avz = 0;
    let subject = -1;
    let group = 0;
    let groupFacing: number | undefined;
    let lockAngle: number | undefined;
    let close = false;
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
      const near: number[] = [];
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
    }
    const ref = this.cam.mode === 'card' ? this.view.refState : null;
    this.trackHold();
    this.cam.update(this.paused ? 0 : dt, {
      ...focus,
      ax, az, avx, avz, subject, group, groupFacing, lockAngle, close,
      setPiece: this.replay ? null : focus.setPiece,
      hold: !this.replay && focus.hold,
      card: ref ? { rx: ref.x, rz: ref.z, fx: ref.faceX, fz: ref.faceZ } : null,
    }, this.time);
    // Low cameras (over the set-piece taker's shoulder, the shootout) drop the name tag and arrow, which would
    // otherwise float over the goal mouth; the referee close-up drops the marker altogether.
    this.view.setMarkerMode(this.cam.mode === 'card' ? 'off' : this.cam.behindActive || this.cam.mode === 'penalty' ? 'ring' : 'full');
    // The Mega Dome's arch: never for the menu orbit or the pre-match fly-in (their paths cut through it).
    this.stadium.setArchVisible(this.cam.mode !== 'menu' && this.cam.mode !== 'intro');
    // Team rings: the broadcast shot (and the fly-in landing on it) only; never under a low or close lens.
    this.view.setTeamRings((this.cam.mode === 'broadcast' && !this.cam.behindActive) || this.cam.mode === 'intro');
    // Team pips over the human's team-mates: the broadcast shot only.
    this.view.setTeamPips(this.cam.mode === 'broadcast' && !this.cam.behindActive && !this.replay);
    // The referee close-up is a clean cinematic frame: the HUD drops its ticker, tags and touch buttons.
    const cine = this.cam.mode === 'card';
    if (cine !== this.cineHud) {
      this.cineHud = cine;
      this.hud?.setCinematic(cine);
    }
    this.updateFades(ref, this.paused ? 0 : dt);
    this.world.focusShadows(this.cam.focusX, this.cam.focusZ);
    this.stadium.updateGlare(this.world.camera);
    if (this.weather.kind === 'rain' && !this.paused) this.effects.rain(dt, this.cam.focusX, this.cam.focusZ, 22, 15, 90, this.world.camera.position);
    this.view.faceCamera(this.world.camera);
    this.view.updateReferee(this.paused ? 0 : dt, this.time, !this.replay);
    this.stadium.update(dt, this.time);
    this.effects.update(held || this.paused ? 0 : dt);
    this.weather.update(dt, this.cam.focusX, this.cam.focusZ, this.time, this.world.camera.position);
    this.updateAtmosphere(dt);
    this.updateHud(dt);
    // Online: the man the other player controls gets his own ring.
    if (this.driver) {
      const hs = m.cfg.humanSide;
      this.view.setRival(hs === 0 || hs === 1 ? m.activeOf(hs === 0 ? 1 : 0) : -1);
    }
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
      if (!this.replay && !this.replayDone && this.cam.mode !== 'celebrate' && m.phaseT > GOAL_WIDE_S) this.cam.setMode('celebrate');
      // The replay rolls for a goal worth seeing again; a plain one goes straight from the celebration to the
      // kick-off (round 9's critic: every goal replayed cost 8.5 s, ~7% of a two-minute half).
      // (An iconic celebration holds the replay / kick-off until its moment has landed: celeb.holdS.)
      const at = Math.max(this.replayWanted ? REPLAY_AT : NO_REPLAY_AT, this.view.celeb.holdS);
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
      this.halftimeFired = true;
      if (this.demo) m.continueSecondHalf();
      else this.onHalftime?.();
    }
    if (m.phase === 'shootout' && !this.so && this.hud) this.startShootoutView();
    if (m.phase === 'fulltime' && !this.finishFired && m.phaseT > (m.shootout ? SHOOTOUT_HOLD_S : FULLTIME_HOLD_S)) {
      this.finishFired = true;
      if (this.demo) return;
      this.onFinish?.({
        score: [...m.score] as [number, number], humanSide: m.cfg.humanSide, match: m, ratings: this.ratings(), winner: this.winner(),
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
    if (m.phase === 'goal' && this.cam.mode !== 'celebrate' && m.phaseT > GOAL_WIDE_S) this.cam.setMode('celebrate');
    const was = this.netPhase;
    if (m.phase !== was) {
      this.netPhase = m.phase;
      if (was === 'goal') {
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
    if (m.phase === 'fulltime' && !this.finishFired && m.phaseT > FULLTIME_HOLD_S) {
      this.finishFired = true;
      this.onFinish?.({
        score: [...m.score] as [number, number], humanSide: m.cfg.humanSide, match: m, ratings: this.ratings(), winner: this.winner(),
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
      const move = dev === 'gamepad' ? 'the LEFT STICK' : dev === 'touch' ? 'the thumbstick' : 'WASD / ARROWS';
      // (A short title: the banner's letters are huge; "YOU ARE THE BLUE RING" ran off both edges.)
      this.hud.show('THIS IS YOU', `the ${you} ring · move with ${move} to begin`, 'small intro', 30);
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
    // No replay of the goal that settled it: the celebration, then the verdict.
    this.replayWanted = false;
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
    this.hud?.show(o.won ? 'COMPLETE!' : 'FAILED', o.won ? `MOMENT ${stars}` : 'MOMENT · try again', o.won ? 'goal' : 'small goal against', MOMENT_END_S + 0.4);
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
        this.hitStop = Math.max(this.hitStop, HIT_STOP_APEX);
        break;
      default:
        break;
    }
  }

  private startReplay(): void {
    this.view.celeb.end();
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
    const btn = c.pass || c.shoot || c.through;
    const skip = btn && !this.prevButtons;
    this.prevButtons = btn;
    if (i >= frames.length - 1 || skip) {
      this.replay = null;
      this.replayDone = true;
      this.hud?.setReplay(false);
      this.cam.setMode('broadcast');
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
    for (const e of events) {
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
          sfx.kick(e.power, e.kind === 'header');
          if (m.ball.lastTouch >= 0) {
            const kp = m.players[m.ball.lastTouch];
            if (e.kind === 'shot' || (e.kind === 'header' && m.shotClock < 0.05)) this.tally.get(kp.idx).shots++;
            else if (e.kind !== 'clear') {
              this.tally.get(kp.idx).passes++;
              this.lastPasser[kp.side] = kp.idx;
            }
          }
          if (m.ball.lastTouch >= 0 && m.players[m.ball.lastTouch].side === m.cfg.humanSide) {
            if (e.kind === 'shot' || e.kind === 'header') this.tut.shot = true;
            else this.tut.passed = true;
            // (The sim tags a chip / finesse strike on the kick event; typed loosely for older sims.)
            const style = (e as { style?: string }).style;
            if (style === 'chip' || style === 'finesse') this.tut.chip = true;
          }
          if (e.kind === 'shot' && e.power > 0.5) {
            this.effects.grass(e.x, e.z, 10, e.power);
            this.cam.kick(0.05 + e.power * 0.08);
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
          sfx.goal();
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
          const cols = golden ? [0xffd23a, 0xffb300, 0xfff0b0, 0xfbfbf4] : [this.opt.kits[side].shirt, this.opt.kits[side].shirt2, 0xffd23a, 0xfbfbf4];
          const gx = Math.sign(m.ball.pos.x) * HALF_L;
          // Juice: a hold on the impact frame, a decaying shake, the net rippling, a fat burst in the scorer's
          // colours out of the goal mouth, confetti from the roof and the ground and the whole bowl flashing.
          this.hitStop = HIT_STOP_GOAL;
          this.effects.burst(gx, 1.5, m.ball.pos.z, cols, 90, 13, 2.4);
          this.effects.burst(gx - Math.sign(gx) * 2, 0.3, m.ball.pos.z, cols, 50, 9, 2);
          this.effects.confetti(gx * 0.7, 0, cols, 320, 60);
          this.stadium.punchNet(gx, Math.max(0.6, Math.min(2, m.ball.pos.y)), m.ball.pos.z, 24);
          this.stadium.flashBurst(golden ? 90 : 60);
          if (golden) this.effects.burst(gx - Math.sign(gx) * 3, 2.4, m.ball.pos.z, [0xffd23a, 0xfff0b0, 0xffb300], 70, 11, 3);
          this.cam.kick(SHAKE_GOAL);
          this.view.setMarkerVisible(false);
          this.celebG = 0;
          this.startCelebration(side);
          void s;
          break;
        }
        case 'whistle':
          sfx.whistle(e.kind);
          break;
        case 'post':
          sfx.post(e.speed);
          this.hud?.toastMsg('OFF THE WOODWORK!');
          this.cam.kick(0.08);
          break;
        case 'save': {
          this.tally.get(e.keeper).saves++;
          sfx.save();
          const k = m.players[e.keeper];
          this.effects.dust(k.pos.x, k.pos.z, 8, 0.7);
          if (m.shotClock < 2) {
            this.hud?.toastMsg(e.caught ? 'GREAT SAVE!' : 'PARRIED!');
            sfx.saveFlash(e.caught);
            sfx.cheer(0.6);
          }
          break;
        }
        case 'tackleTry':
          this.tackleAttempt(e.by, e.slide);
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
            // WON IT: the picture holds on the impact, the camera punches, a burst in his colours at the ball.
            this.hitStop = HIT_STOP_TACKLE;
            this.cam.kick(PUNCH_TACKLE);
            const kit = this.opt.kits[p.side];
            const b = m.ball.pos;
            this.effects.burst(b.x, Math.max(0.25, b.y), b.z, [kit.shirt, kit.shirt2, 0xfbfbf4], 30, 7, 1.6);
            this.effects.dust(b.x, b.z, 8, 0.9, p.vel.x * 0.3, p.vel.z * 0.3);
            this.effects.grass(p.pos.x, p.pos.z, e.slide ? 12 : 6, e.slide ? 0.8 : 0.5);
            sfx.thump();
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
        case 'bounce':
          sfx.bounce(e.speed);
          break;
        case 'net':
          this.stadium.punchNet(e.x, e.y, e.z, e.speed);
          sfx.net(e.speed);
          break;
        case 'ooh':
          sfx.ooh();
          break;
        case 'restart':
          if (e.kind !== 'kickoff') this.hud?.toastMsg(RESTART_LABEL[e.kind], 1.2);
          if (e.kind === 'penalty') this.hud?.show('PENALTY!', '', 'small', 1.8);
          break;
        case 'setpiece':
          // A new set-piece framing: cut if it is far from where we are, otherwise glide there.
          this.cam.softCut();
          break;
        case 'sub': {
          this.hud?.toastMsg(`SUB · ${e.on} ON · ${e.off} OFF`, 2);
          // Manager and AI subs alike: draw whoever the sim now has in that slot (no-op if already swapped).
          const on = m.teamPlayers(e.side)[e.slot];
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
          this.hud?.show(red ? 'RED CARD' : 'YELLOW CARD', second ? `${p.def.name} · 2nd yellow` : p.def.name, red ? 'small card red' : 'small card', red ? 2.2 : 1.8);
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
          this.view.showCard(red ? 'red' : 'yellow', x, z, close ? CARD_CAM_S : red ? 2.2 : 1.8, close);
          if (close) this.startCardShot(p.idx, x, z);
          break;
        }
        case 'foul': {
          const on = m.players[e.on];
          const by = m.players[e.by];
          this.foulOn = e.on;
          this.foulAt = { x: on.pos.x, z: on.pos.z };
          this.foulBy = { x: by.pos.x, z: by.pos.z };
          this.view.refSignal(1.2);
          if (!e.penalty) this.hud?.toastMsg('FOUL!', 1.2);
          break;
        }
        case 'halftime':
          if (!this.moment) this.hud?.show('HALF TIME', `${m.score[0]} - ${m.score[1]}`, 'small', 3);
          break;
        case 'fulltime':
          if (!this.moment) this.hud?.show('FULL TIME', `${m.score[0]} - ${m.score[1]}`, 'small', 3);
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
            this.hud?.toastMsg('OFFSIDE', 1.4);
            this.view.refSignal(1.4, 'arm');
          } else if (t === 'advantage') {
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
    // The ball: a short white trail at real pace; a fireball when it is the mega ball.
    const bx = f[BALL_OFS], by = f[BALL_OFS + 1], bz = f[BALL_OFS + 2];
    const bvx = f[BALL_OFS + 3], bvy = f[BALL_OFS + 4], bvz = f[BALL_OFS + 5];
    const bs = Math.hypot(bvx, bvy, bvz);
    const hot = this.megaHot && !this.replay;
    if (bs > BALL_TRAIL_MS || (hot && bs > 2)) {
      this.ballFxAcc += dt * (hot ? 90 : 60);
      while (this.ballFxAcc >= 1) {
        this.ballFxAcc -= 1;
        // Placed back along the path, so the trail starts at the ball rather than inside it.
        const back = Math.random() * 0.5;
        const px = bx - (bvx / bs) * back, py = Math.max(0.1, by - (bvy / bs) * back), pz = bz - (bvz / bs) * back;
        if (hot) fx.fire(px, py, pz, 2, -bvx * 0.04, 0, -bvz * 0.04);
        else fx.spawn(px, py, pz, 0, 0, 0, 0xffffff, 0.09 + Math.min(0.06, (bs - BALL_TRAIL_MS) * 0.004), 0.16, 0, 0);
      }
    } else this.ballFxAcc = 0;
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
      if (e.kind === 'mega') this.cam.kick(0.05);
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
    const turboSide = [false, false];
    const frozenSide = [this.frozenSide === 0, this.frozenSide === 1];
    let hot = false;
    const ball = m.ball;
    const bxp = f[BALL_OFS], byp = f[BALL_OFS + 1], bzp = f[BALL_OFS + 2];
    bz.beginBubbles();
    // (The sim sets Player.boost on a whole side: the bubble goes round that side's carrier alone, and the
    // magnet's sparks between the ball and the boot of the one man on it or nearest it.)
    const magnetMan: [number, number] = [-1, -1];
    const magnetD: [number, number] = [Infinity, Infinity];
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
    for (const side of [0, 1] as const) {
      const kind: PowerUpKind | null = turboSide[side] ? 'turbo' : frozenSide[side] ? 'freeze' : null;
      if (bz.sideGlows[side] !== kind) bz.setSideGlow(side, kind);
    }
    bz.updateSideGlow(f, PF, k, time);
  }

  /**
   * Referee close-up for a card at a stoppage: the booked player stands on his mark (x, z) facing the
   * referee, the lens picks its side of the pair (CameraRig.cardLens), and the man he brought down is held
   * beyond him, further from the lens and off to the side: small in the background, never standing in front
   * of him (all render only; the camera cuts away before anyone is let go).
   */
  private startCardShot(booked: number, x: number, z: number): void {
    this.cardT = CARD_CAM_S;
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
    const low = cam.behindActive || cam.mode === 'penalty' || cam.mode === 'card' || cam.mode === 'replay';
    const lens = this.world.camera.position;
    const f = this.view.frame;
    // The ball waiting on the free-kick spot is only clutter by the booked player's boots (or right in front
    // of the lens): the close-up leaves it out.
    this.view.setBallHidden(cam.mode === 'card');
    if (!low) {
      this.view.clearFades();
      return;
    }
    const m = this.match;
    const keep: number[] = [];
    const sight: { x: number; z: number }[] = [];
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
        for (const [x, z] of [[ref.x, ref.z], [mx, mz], [ref.faceX, ref.faceZ]]) sight.push({ x: lx + (x - lx) * 1.6, z: lz + (z - lz) * 1.6 });
      }
    } else if (cam.mode === 'penalty' && m.shootout) keep.push(m.shootout.taker);
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
      if (cam.replayShot === 'goal') sight.push({ x: bx, z: bz });
    } else if (cam.behindActive && m.restart && !this.replay) keep.push(m.restart.taker);
    // The card close-up is a clean two-shot: everyone (but the pair and the man held in the background)
    // standing no further from the lens than the booked player is cleared out of the frame.
    const bk = this.cardPlayer;
    const radius = cam.mode === 'card' && bk >= 0
      ? Math.max(LENS_CLEAR, Math.hypot(f[bk * PF] - lens.x, f[bk * PF + 1] - lens.z) + 0.5)
      : cam.mode === 'replay' && cam.replayShot === 'goal' ? REPLAY_LENS_CLEAR
        : cam.behindActive && !this.replay ? FK_LENS_CLEAR : LENS_CLEAR;
    // (The card shot latches its fades, with wider sight lines: a clean frame, no ghosts at the edges.)
    const card = cam.mode === 'card';
    const floor = cam.mode === 'replay' ? REPLAY_MIN_ALPHA : 0;
    this.view.fadeNearLens(lens.x, lens.z, radius, floor, keep, sight, card ? 1.3 : 0.85, card, dt, cam.justCut);
  }

  private updateAtmosphere(dt: number): void {
    const m = this.match;
    const bx = m.ball.pos.x;
    // Fans lift as the ball nears the goal their team attacks.
    const toward = (side: Side) => clamp(((bx * m.attackDir(side)) / HALF_L - 0.2) / 0.8, 0, 1);
    let h0 = 0.12 + toward(0) * 0.35;
    let h1 = 0.12 + toward(1) * 0.35;
    if (this.goalHypeT > 0) {
      this.goalHypeT -= dt;
      if (m.goalSide === 0) h0 = 1;
      else h1 = 1;
    }
    if (m.phase === 'halftime' || m.phase === 'fulltime') {
      h0 = h1 = 0.3;
    }
    this.stadium.setHype(h0, h1, dt);
    sfx.setExcitement(clamp(Math.max(toward(0), toward(1)) * 0.8 + (this.goalHypeT > 0 ? 0.6 : 0), 0, 1));
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
        this.stadium.setScore(m.score[0], m.score[1], `${s}s`);
        if (s > 0 && s <= MOMENT_COUNT_S && !mo.outcome && mo.briefT <= 0 && m.phase !== 'goal' && s !== mo.count) {
          mo.count = s;
          hud.show(String(s), '', 'small', 0.85);
        }
      }
    } else {
      // Broadcast clock: game time mm:ss, frozen at 45:00 / 90:00 with "+N" added time.
      const halfGame = 45 * 60;
      const played = Math.min(m.clock / m.cfg.halfLength, 1) * halfGame;
      const gameSec = Math.floor((m.half - 1) * halfGame + played);
      const extra = m.clock > m.cfg.halfLength ? Math.max(1, Math.ceil(((m.clock - m.cfg.halfLength) / m.cfg.halfLength) * 45)) : 0;
      const key10 = gameSec * 10 + extra;
      if (key10 !== this.lastMinute) {
        this.lastMinute = key10;
        hud.setClock(gameSec, extra);
        const minute = Math.floor(gameSec / 60);
        this.stadium.setScore(m.score[0], m.score[1], extra ? `${minute}+${extra}'` : `${minute}'`);
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
    hud.setRadarHidden(
      setPiece || this.radarHoldT > 0 || m.phase === 'shootout' || this.cam.behindActive ||
      this.cam.mode === 'penalty' || this.cam.mode === 'card' || this.cam.mode === 'celebrate' || m.phase === 'goal' ||
      m.ball.pos.z > HALF_W * 0.45 || this.radarOccT > 0,
    );
    hud.update(dt, this.view.frame);
    // The over-the-shoulder set-piece camera needs the whole lower screen for the taker: no radar / chip.
    hud.setLive(
      !this.replay && this.cam.mode !== 'celebrate' && !this.cam.behindActive &&
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
    const ctx: HintCtx = so ? (so.turn === hs ? 'setpiece' : 'defend') : m.phase === 'restart' || m.phase === 'kickoff' ? 'setpiece' : mine || incoming ? 'attack' : 'defend';
    const key = (k: HintKey): string =>
      dev === 'gamepad' ? { pass: 'A', shoot: 'B', through: 'X' }[k]
        : dev === 'touch' ? TOUCH_LABELS[ctx][k === 'pass' ? 0 : k === 'shoot' ? 1 : 2]
          : { pass: 'SPACE', shoot: 'K', through: 'L' }[k];
    let hint = '';
    const soAim = !!so && (so.stage === 'aim' || so.stage === 'intro');
    // Hold for power, let go to strike (never "SHOOT to shoot": the touch button already says SHOOT).
    const strike = `hold ${key('shoot')} to strike`;
    if (so) {
      if (soAim) hint = so.turn === hs ? `Aim · ${strike}` : 'Dive: point the stick when they shoot';
    } else if ((m.phase === 'kickoff' || m.phase === 'restart') && r && r.side === hs) {
      switch (r.kind) {
        case 'kickoff': hint = `${key('pass')} to kick off`; break;
        case 'throwin': hint = `Point to a teammate · ${key('pass')} to throw`; break;
        // SHOOT on a corner is a driven cross (flat and fast), not a shot. (Touch labels the through button
        // CROSS at set pieces, so the verb is "whip it in", never "CROSS to cross".)
        case 'corner': hint = `${key('pass')} short · hold ${key('through')} to whip it in · ${key('shoot')} = driven cross`; break;
        case 'goalkick': hint = `${key('pass')} short · hold ${key('through')} to go long`; break;
        case 'freekick': hint = `Aim · ${strike} · hold ${key('through')} to whip it in`; break;
        case 'penalty': hint = `Aim · ${strike}`; break;
      }
    } else if (m.ball.held && mine) {
      hint = `${key('pass')} to throw it out · ${key('through')} to kick long`;
    }
    // Nothing over the referee close-up (the set-piece hint comes back when the camera cuts back to the game).
    const cinematic = !!this.replay || this.cam.mode === 'card';
    hud.setHint(cinematic ? '' : hint);
    // Aim arrow for our set pieces (shootout: at the spot picked across the goal mouth).
    if (so && soAim && so.turn === hs) {
      const t = m.players[so.taker];
      this.view.setAim(true, t.pos.x, t.pos.z, Math.atan2(so.aimZ - t.pos.z, so.goal * HALF_L - t.pos.x), 1.3);
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
    if (this.paused || cinematic || this.introLeft > 0 || this.cam.mode !== 'broadcast' || this.cam.behindActive) this.trainer?.hide();
    else this.trainer?.update(m, this.view.frame, this.world.camera, this.view.headTop, dev);
    if (this.touch) {
      // Off for the intro, goal celebrations, replays and half / full time (CSS hides them too).
      // Off for the referee close-up too (the buttons would sit on the booked player).
      this.touch.setVisible(!(this.introLeft > 0 || this.replay || this.cam.mode === 'card' || m.phase === 'goal' || m.phase === 'halftime' || m.phase === 'fulltime'));
      this.touch.setContext(ctx);
    }
    // Pause via keyboard / gamepad.
    const c = this.input.gamepadPause();
    if (c && !this.paused) this.requestPause();
  }

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
    const cam = this.world.camera;
    const v = (this.scratchV ??= cam.position.clone());
    const W = window.innerWidth;
    const H = window.innerHeight;
    const under = (x: number, y: number, z: number): boolean => {
      v.set(x, y, z).project(cam);
      if (v.z > 1) return false;
      const sx = ((v.x + 1) / 2) * W;
      const sy = ((1 - v.y) / 2) * H;
      return sx > R.l - RADAR_MARGIN && sx < R.r + RADAR_MARGIN && sy > R.t - RADAR_MARGIN && sy < R.b + RADAR_MARGIN;
    };
    const f = this.view.frame;
    if (under(f[BALL_OFS], f[BALL_OFS + 1], f[BALL_OFS + 2])) return true;
    const a = this.match.active;
    if (a < 0 || a >= 22) return false;
    const x = f[a * PF];
    const z = f[a * PF + 1];
    return under(x, 0, z) || under(x, this.view.headTop * 0.5, z) || under(x, this.view.headTop, z);
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
  /** A ring where the human side's airborne ball (a lob, cross or clearance, not a shot) will come down. */
  private updateLanding(off: boolean): void {
    const m = this.match;
    const b = m.ball;
    const ours = m.cfg.humanSide >= 0 && b.lastTouchSide === m.cfg.humanSide;
    const flying = !b.held && b.owner < 0 && b.pos.y > 1.2 && m.kickKind !== 'shot' && m.kickKind !== 'header';
    const down = off || !ours || !flying ? undefined : m.ballPath.find((q) => q.y <= BALL_R + 0.05);
    if (!down) this.view.setLanding(false);
    else this.view.setLanding(true, down.x, down.z, this.time);
  }

  private updatePreview(off: boolean, dt: number): void {
    const m = this.match;
    const cam = this.cam;
    const on = !off && m.active >= 0 && m.ball.owner === m.active && (m.phase === 'play' || m.phase === 'restart') &&
      cam.mode === 'broadcast' && !cam.behindActive && this.introLeft <= 0;
    if (!on) {
      this.view.setPassPreview(-1, -1, 0, 0, dt, !!this.replay || cam.mode !== 'broadcast');
      return;
    }
    const pass = this.mateIdx((m as { passPreview?: unknown }).passPreview);
    const through = m.phase === 'restart' && m.restart?.kind === 'throwin' ? -1 : this.mateIdx((m as { throughPreview?: unknown }).throughPreview);
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
      // The minimap and (touch) the action buttons: re-measured twice a second.
      this.edgeAvoidT = RADAR_RECT_S;
      this.edgeAvoid = [];
      const boxes = [this.hud?.root.querySelector('.hud-radar'), this.touch?.isVisible ? this.touch.root.querySelector('.touch-btns') : null];
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
      out.push({
        idx: i, x: sx, y: sy, num: p.def.number,
        alpha: 1 - (1 - EDGE_MIN_ALPHA) * smoothstep(EDGE_NEAR, EDGE_FAR, d),
        pass: i === aim ? 1 : this.view.previewWeight(i), through: this.view.throughWeight(i),
      });
    }
    const box = { l: EDGE_SIDE, t: Math.min(EDGE_TOP, H * 0.2), r: W - EDGE_SIDE, b: H - Math.min(EDGE_BOTTOM, H * 0.22) };
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

  private updateTutorial(dt: number, key: (k: HintKey) => string): void {
    const hud = this.hud;
    if (!hud || !this.opt.tutorial) return;
    // The persistent trainer carries the controls beside the player; don't duplicate them across the pitch.
    if (this.match.trainer) { hud.setTip(''); return; }
    const m = this.match;
    const t = this.tut;
    const c = this.input.read();
    if (Math.hypot(c.sx, c.sy) > 0.3 && m.phase === 'play') t.moved = true;
    if (m.phase !== 'play' || this.replay) {
      hud.setTip('');
      return;
    }
    t.t += dt;
    const dev = this.input.lastDevice;
    const move = dev === 'gamepad' ? 'LEFT STICK' : dev === 'touch' ? 'the left thumbstick' : 'WASD / ARROWS';
    const sprint = dev === 'gamepad' ? 'RT' : dev === 'touch' ? 'SPRINT' : 'SHIFT';
    const mine = m.ball.owner >= 0 && m.players[m.ball.owner].side === m.cfg.humanSide;
    let tip = '';
    if (!t.moved) tip = `Move with <kbd>${move}</kbd> · sprint with <kbd>${sprint}</kbd>`;
    // (Round 9 controls: PASS goes at once to the mate the preview rings; THROUGH sends that runner in behind.)
    else if (mine && !t.passed) {
      // (On MANUAL passing nobody is ringed: the ball goes where the stick points.)
      const to = m.groundAssist === 'manual' ? 'passes where you point the stick' : 'passes to the <b>ringed</b> mate at once (point the stick to pick him)';
      tip = `<kbd>${key('pass')}</kbd> ${to}${m.quickPass ? '' : ' · hold it to hit it harder'} · <kbd>${key('through')}</kbd> sends a runner through`;
    }
    else if (mine && !t.shot) {
      tip = `Near goal? <b>Hold</b> <kbd>${key('shoot')}</kbd> and release to shoot: a tap drives it low, a long hold rises`;
      if (this.match.timedFinish) tip += ` · tap it again as the boot meets the ball for a perfect finish`;
    }
    else if (mine && !t.chip) {
      // Once he has had a shot: the finishes (shown for a while on the ball, or until he tries one).
      tip = `Keeper off his line? <b>Hold</b> <kbd>${key('shoot')}</kbd> and tap <kbd>${key('through')}</kbd> to chip him · a soft shot aimed at a corner curls in`;
      t.chipT += dt;
      if (t.chipT > 14) t.chip = true;
    }
    else if (!mine && m.ball.owner >= 0 && !t.switched) {
      tip = `Defending: tap <kbd>${key('shoot')}</kbd> to tackle (hold it to slide) · hold <kbd>${key('through')}</kbd> to press · <kbd>${key('pass')}</kbd> switches player`;
      if (t.t > 60) t.switched = true;
    }
    if (t.moved && t.passed && t.shot && t.chip && (t.switched || t.t > 90)) this.opt.tutorial = false;
    hud.setTip(tip);
  }

  dispose(): void {
    this.world.scene.remove(this.stadium.group, this.view.group, this.effects.mesh, this.weather.group);
    if (!this.demo) document.body.classList.remove('night');
    // The night fill is shared by every footballer drawn (menu kit previews too): off until a match sets it.
    setCharacterFill(0);
    setCharacterHemiFill(0);
    setCharacterWhiteBalance();
    sfx.setRain(false);
    sfx.setAmbienceActive(false);
    this.offKey?.();
    this.offKey = null;
    this.blitz?.dispose();
    this.blitz = null;
    this.hud?.dispose();
    this.touch?.root.remove();
    this.input.touch.enabled = false;
    this.stadium.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.stadium.dispose();
  }
}

import type * as THREE from 'three';
