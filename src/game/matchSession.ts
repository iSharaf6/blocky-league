import { sfx } from '../audio/sfx';
import type { Input } from '../core/input';
import type { CamZoom } from '../core/save';
import { clamp, damp } from '../core/math';
import { CameraRig } from '../render/cameraRig';
import { setCharacterFill, setCharacterHemiFill, setCharacterWhiteBalance } from '../render/characters';
import { Effects } from '../render/effects';
import { MatchView } from '../render/matchView';
import { PITCH_Y, Stadium, stadiumFill } from '../render/stadium';
import { Weather, type WeatherKind } from '../render/weather';
import type { TimeOfDay, World } from '../render/world';
import { DT, HALF_L, HALF_W } from '../sim/constants';
import { EMPTY_PAD, Match, type MatchConfig, type Pad } from '../sim/match';
import { goalsOf } from '../sim/shootout';
import type { Kit, MatchEvent, RestartKind, Side } from '../sim/types';
import { Hud, hudTeam } from '../ui/hud';
import { ShootoutHud } from '../ui/shootoutHud';
import { TouchControls, isTouchDevice } from '../ui/touch';
import { grassSafeKit, resolveKitClash } from '../meta/data';
import { playFocus } from './camFocus';
import { contrastAwayKit } from './kitContrast';
import { BALL_OFS, FRAME_LEN, PF, ReplayBuffer, STATE_CODE, isSentOff, writeFrame } from './replay';

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
  /** Broadcast camera distance (default 'normal'). */
  camZoom?: CamZoom;
}

export interface PlayerRating {
  idx: number;
  name: string;
  side: Side;
  rating: number;
  goals: number;
  assists: number;
}

export interface MatchResult {
  score: [number, number];
  humanSide: Side | -1;
  match: Match;
  /** Per-player 1–10 ratings, best first. */
  ratings?: PlayerRating[];
  /** Who went through: by the score, or by the shootout in a level knockout tie (undefined = a draw). */
  winner?: Side;
}

interface Tally {
  goals: number;
  assists: number;
  tackles: number;
  saves: number;
  passes: number;
  shots: number;
}

/** Seconds on the wide shot after a goal (the ball in the net) before cutting to the scorer. */
const GOAL_WIDE_S = 0.9;
/** The replay rolls once the celebration has had its moment (players have reached the corner flag). */
const REPLAY_AT = 3.6;
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

const RESTART_LABEL: Record<RestartKind, string> = {
  kickoff: 'KICK OFF', throwin: 'THROW-IN', corner: 'CORNER', goalkick: 'GOAL KICK', freekick: 'FREE KICK', penalty: 'PENALTY!',
};

export class MatchSession {
  readonly match: Match;
  readonly view: MatchView;
  readonly stadium: Stadium;
  readonly effects = new Effects();
  readonly weather = new Weather();
  readonly cam: CameraRig;
  readonly hud: Hud | null;
  readonly touch: TouchControls | null;
  paused = false;
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
  private halftimeFired = false;
  private finishFired = false;
  private lastMinute = -1;
  private goalHypeT = 0;
  private prevButtons = false;
  private introLeft = 0;
  private tally: Tally[] = Array.from({ length: 22 }, () => ({ goals: 0, assists: 0, tackles: 0, saves: 0, passes: 0, shots: 0 }));
  private lastPasser: [number, number] = [-1, -1];
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

  constructor(private world: World, private input: Input, readonly opt: SessionOptions) {
    this.demo = !!opt.demo;
    // Readability first: no green shirts on green grass, then re-check the clash.
    const home = grassSafeKit(opt.kits[0]);
    const away = resolveKitClash(home, grassSafeKit(opt.kits[1]));
    // ...and the two sides must read apart from the gantry (light against dark): see kitContrast. The side
    // that changes strip is never the human's: you always play in your own club's colours.
    opt.kits = opt.humanSide === 1 ? [contrastAwayKit(away, home), away] : [home, contrastAwayKit(home, away)];
    this.match = new Match(opt);
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
    this.cam.setMode(this.demo ? 'menu' : 'intro');
    if (!this.demo) this.introLeft = 3.4;
    if (!this.demo) {
      this.hud = new Hud(
        [hudTeam(teams[0], opt.kits[0].shirt, opt.kits[0].shirt2), hudTeam(teams[1], opt.kits[1].shirt, opt.kits[1].shirt2)],
        opt.humanSide,
      );
      this.hud.onPause = () => this.requestPause();
      document.getElementById('ui')!.appendChild(this.hud.root);
      this.touch = new TouchControls(input);
      document.getElementById('ui')!.appendChild(this.touch.root);
      this.touch.setEnabled(isTouchDevice());
    } else {
      this.hud = null;
      this.touch = null;
    }
    writeFrame(this.match, this.cur, 0);
    this.prev.set(this.cur);
    sfx.setCrowd(true);
    if (this.hud) {
      this.hud.show(`${teams[0].short} v ${teams[1].short}`, `${teams[0].name} · ${teams[1].name}`, 'small intro', 3.2);
      this.prevButtons = true;
    }
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
  setCamZoom(z: CamZoom): void {
    this.cam.setZoom(z);
  }

  requestPause(): void {
    if (this.demo || this.paused) return;
    this.paused = true;
    this.onPause?.();
  }

  resume(): void {
    this.paused = false;
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

  private buildPad(): Pad {
    if (this.demo || this.match.cfg.humanSide < 0) return EMPTY_PAD;
    const c = this.input.read();
    const w = this.cam.screenToWorld(c.sx, c.sy);
    // Keys give 8-way digital input: the sim turns set-piece aim gradually for those.
    return { mx: w.x, mz: w.z, sprint: c.sprint, pass: c.pass, shoot: c.shoot, through: c.through, digital: this.input.lastDevice === 'keyboard' };
  }

  update(realDt: number): void {
    const dt = Math.min(realDt, 0.1);
    this.time += dt;
    const m = this.match;

    if (this.paused) {
      // Frozen: live play, a replay or the pre-match fly-in all wait for the pause menu.
    } else if (this.introLeft > 0) {
      this.introLeft -= dt;
      this.cam.introT = Math.min(1, 1 - this.introLeft / 3.4);
      const c = this.input.read();
      const btn = c.pass || c.shoot || c.through;
      if (btn && !this.prevButtons) this.introLeft = 0;
      this.prevButtons = btn;
      if (this.introLeft <= 0) {
        this.cam.setMode('broadcast');
        // Skipped (or over): the pre-match title card goes with the fly-in, never lingering over the kick-off.
        this.hud?.hideIntro();
      }
      this.view.apply(this.prev, this.cur, 1, this.time, dt);
    } else if (this.replay) {
      this.stepReplay(dt);
    } else {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 6) {
        const pad = this.buildPad();
        this.prev.set(this.cur);
        m.step(DT, pad);
        writeFrame(m, this.cur, this.time);
        this.buffer.push(m, this.time);
        this.recorded++;
        this.handleEvents(m.drainEvents());
        this.acc -= DT;
        steps++;
      }
      if (steps === 6) this.acc = 0;
      this.view.apply(this.prev, this.cur, this.acc / DT, this.time, dt);
      this.flow();
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
      avx = (sc.vel.x * 2) / n;
      avz = (sc.vel.z * 2) / n;
      subject = si;
      group = this.celebG;
    }
    const ref = this.cam.mode === 'card' ? this.view.refState : null;
    this.trackHold();
    this.cam.update(this.paused ? 0 : dt, {
      ...focus,
      ax, az, avx, avz, subject, group, groupFacing,
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
    this.effects.update(dt);
    this.weather.update(dt, this.cam.focusX, this.cam.focusZ, this.time, this.world.camera.position);
    this.updateAtmosphere(dt);
    this.updateHud(dt);
  }

  /** Goal → celebration → replay → kick-off; half/full time callbacks. */
  private flow(): void {
    const m = this.match;
    if (m.phase === 'goal') {
      if (this.demo) {
        if (m.phaseT > 3.2) m.resumeAfterGoal();
        return;
      }
      // A beat on the wide shot (the ball in the net), then cut to the scorer and his team-mates.
      if (!this.replay && !this.replayDone && this.cam.mode !== 'celebrate' && m.phaseT > GOAL_WIDE_S) this.cam.setMode('celebrate');
      if (m.phaseT > REPLAY_AT && !this.replayDone) this.startReplay();
      else if (this.replayDone) {
        this.replayDone = false;
        m.resumeAfterGoal();
        this.cam.setMode('broadcast');
        this.view.setMarkerVisible(m.cfg.humanSide >= 0);
        // Straight to the kick-off framing: never a glide from the replayed goal to the centre spot.
        this.resetView();
      }
    }
    if (m.phase === 'halftime' && !this.halftimeFired && m.phaseT > 1.6) {
      this.halftimeFired = true;
      if (this.demo) m.continueSecondHalf();
      else this.onHalftime?.();
    }
    if (m.phase === 'shootout' && !this.so && this.hud) this.startShootoutView();
    if (m.phase === 'fulltime' && !this.finishFired && m.phaseT > (m.shootout ? 4.2 : 2.4)) {
      this.finishFired = true;
      if (this.demo) return;
      this.onFinish?.({
        score: [...m.score] as [number, number], humanSide: m.cfg.humanSide, match: m, ratings: this.ratings(), winner: this.winner(),
      });
    }
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

  /** DLS-style 1–10 match ratings from what each player actually did. */
  ratings(): PlayerRating[] {
    const m = this.match;
    const out: PlayerRating[] = m.players.map((p) => {
      const t = this.tally[p.idx];
      const my = m.score[p.side];
      const their = m.score[p.side === 0 ? 1 : 0];
      let r = 6.1 + t.goals * 1.15 + t.assists * 0.6 + t.tackles * 0.14 + t.saves * 0.4 + Math.min(t.passes, 40) * 0.025 + t.shots * 0.05;
      r += my > their ? 0.4 : my < their ? -0.35 : 0;
      if (p.isKeeper || p.role === 'DF') r -= their * (p.isKeeper ? 0.35 : 0.15);
      if (p.isKeeper && their === 0) r += 0.6;
      return {
        idx: p.idx, name: p.def.name, side: p.side,
        rating: Math.round(Math.max(3.5, Math.min(10, r)) * 10) / 10,
        goals: t.goals, assists: t.assists,
      };
    });
    return out.sort((a, b) => b.rating - a.rating || b.goals - a.goals);
  }

  private startReplay(): void {
    const lead = 3.3 * 60;
    const tail = 1.3 * 60;
    const since = this.recorded - this.goalFrame;
    const frames = this.buffer.snapshot(Math.min(this.buffer.count, since + lead));
    const cut = Math.max(2, frames.length - since + tail);
    this.replay = frames.slice(0, Math.min(frames.length, cut));
    this.replayGoalIdx = Math.max(0, this.replay.length - tail);
    this.replayT = 0;
    // No confetti / grass flecks from the live celebration drifting over the replayed build-up.
    this.effects.clear();
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
    // Two shots like TV: the move in real-ish time, then the finish from the goal line in slow-mo: from ~1.6 s
    // before the goal, but never while the ball is still more than REPLAY_GOAL_NEAR m out (a long-range
    // strike is seen struck on the wide shot, then arriving on the goal-line one).
    const at = frames[Math.min(frames.length - 1, Math.floor(idx))];
    const finish = this.cam.replayShot === 'goal' || idx >= this.replayGoalIdx - 20 ||
      (idx >= this.replayGoalIdx - 95 && !this.replayBallFar(at));
    if (finish && this.cam.replayShot === 'build') {
      this.cam.replayShot = 'goal';
      this.cam.cut();
    }
    const near = finish;
    this.replayT += dt * (near ? 0.36 : 0.85);
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
      this.flow();
      return;
    }
    this.view.apply(frames[i], frames[i + 1], idx - i, this.time, dt * (near ? 0.36 : 0.85));
  }

  /** Is the ball in this replay frame still more than REPLAY_GOAL_NEAR m from the goal it went into? */
  private replayBallFar(fr: Float32Array): boolean {
    const gx = this.cam.replayGoalSign * HALF_L;
    return Math.hypot(fr[BALL_OFS] - gx, fr[BALL_OFS + 2]) > REPLAY_GOAL_NEAR;
  }

  private handleEvents(events: MatchEvent[]): void {
    const m = this.match;
    for (const e of events) {
      // Every event goes to the commentary ticker too.
      this.hud?.commentary(e, m);
      switch (e.type) {
        case 'kick': {
          sfx.kick(e.power, e.kind === 'header');
          if (m.ball.lastTouch >= 0) {
            const kp = m.players[m.ball.lastTouch];
            if (e.kind === 'shot' || (e.kind === 'header' && m.shotClock < 0.05)) this.tally[kp.idx].shots++;
            else if (e.kind !== 'clear') {
              this.tally[kp.idx].passes++;
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
            this.tally[e.scorer].goals++;
            const a = this.lastPasser[e.side];
            if (a >= 0 && a !== e.scorer) this.tally[a].assists++;
          }
          this.lastPasser = [-1, -1];
          this.replayDone = false;
          sfx.goal();
          const side = e.side;
          const s = m.teams[side];
          const scorer = m.players[e.scorer];
          const g = m.goals[m.goals.length - 1];
          const who = e.own ? `${scorer.def.name} (OG)` : scorer.def.name;
          this.hud?.show('GOAL!', `${who} ${g.minute}'`, side === m.cfg.humanSide || m.cfg.humanSide < 0 ? 'goal' : 'goal against', 3.2);
          this.hud?.setScore(m.score[0], m.score[1]);
          this.stadium.setScore(m.score[0], m.score[1], `${m.minute()}'`);
          this.goalHypeT = 5;
          const cols = [this.opt.kits[side].shirt, this.opt.kits[side].shirt2, 0xffd23a, 0xfbfbf4];
          const gx = Math.sign(m.ball.pos.x) * HALF_L;
          this.effects.burst(gx, 1.5, m.ball.pos.z, cols, 60, 9);
          this.effects.confetti(gx * 0.7, 0, cols, 260, 60);
          this.cam.kick(0.25);
          this.view.setMarkerVisible(false);
          this.celebG = 0;
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
        case 'save':
          this.tally[e.keeper].saves++;
          sfx.save();
          if (m.shotClock < 2) {
            this.hud?.toastMsg(e.caught ? 'GREAT SAVE!' : 'PARRIED!');
            sfx.cheer(0.6);
          }
          break;
        case 'tackle':
          if (e.won) {
            this.tally[e.by].tackles++;
            const p = m.players[e.by];
            this.effects.grass(p.pos.x, p.pos.z, e.slide ? 12 : 4, e.slide ? 0.8 : 0.3);
            if (e.slide) sfx.kick(0.3);
          }
          break;
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
          if (on) this.view.replacePlayer(on.idx, on.def, this.opt.kits[e.side]);
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
          this.hud?.show('HALF TIME', `${m.score[0]} - ${m.score[1]}`, 'small', 3);
          break;
        case 'fulltime':
          this.hud?.show('FULL TIME', `${m.score[0]} - ${m.score[1]}`, 'small', 3);
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
          }
          break;
        }
      }
    }
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
      m.phase !== 'halftime' && m.phase !== 'fulltime' && this.introLeft <= 0,
    );
    if (this.so && m.shootout) this.so.update(m.shootout);
    const hs = m.cfg.humanSide;
    if (hs < 0) return;
    const dev = this.input.lastDevice;
    const r = m.restart;
    const so = m.phase === 'shootout' ? m.shootout : null;
    const mine = m.ball.owner >= 0 && m.players[m.ball.owner].side === hs;
    // The context the touch buttons are labelled for right now: hints name the button on screen.
    const ctx: HintCtx = so ? (so.turn === hs ? 'setpiece' : 'defend') : m.phase === 'restart' || m.phase === 'kickoff' ? 'setpiece' : mine ? 'attack' : 'defend';
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
        case 'throwin': hint = `Aim · ${key('pass')} to throw`; break;
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
    this.updatePassCharge(cinematic);
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
   * close-up); it all goes the frame PASS is let go (passCharge back to -1).
   */
  private updatePassCharge(off: boolean): void {
    const m = this.match;
    const hs = m.cfg.humanSide;
    const charge = typeof m.passCharge === 'number' ? m.passCharge : -1;
    const own = m.ball.owner;
    const passer = own >= 0 && m.players[own].side === hs ? own : m.active;
    if (off || this.replay || hs < 0 || !(charge >= 0) || passer < 0 || passer >= m.players.length) {
      this.view.setPassCharge(null);
      return;
    }
    const f = this.view.frame;
    const aim = typeof m.passAim === 'number' ? m.passAim : -1;
    const locked = aim >= 0 && aim < m.players.length && aim !== passer && m.players[aim].side === hs;
    this.view.setPassCharge(
      charge, f[passer * PF], f[passer * PF + 1], locked ? f[aim * PF] : null, locked ? f[aim * PF + 1] : 0, this.cam.behindActive,
      locked ? aim : -1,
    );
  }

  private updateTutorial(dt: number, key: (k: HintKey) => string): void {
    const hud = this.hud;
    if (!hud || !this.opt.tutorial) return;
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
    else if (mine && !t.passed) tip = `Tap <kbd>${key('pass')}</kbd> to pass to the mate you point at · hold it to hit it harder · tap <kbd>${key('through')}</kbd> for a through ball`;
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
      tip = `Defending: <kbd>${key('pass')}</kbd> switches player · <kbd>${key('shoot')}</kbd> slide tackles · run into them to steal`;
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
