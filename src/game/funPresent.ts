import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import { buzz } from '../platform/haptics';
import type { CameraRig } from '../render/cameraRig';
import type { Effects } from '../render/effects';
import { SHAKE_PX } from '../render/juice';
import type { MatchView } from '../render/matchView';
import type { Stadium } from '../render/stadium';
import { BALL_OFS, PF } from './replay';
import { devFillHype, hypeOf, superArmed, superBall } from '../sim/hype';
import { DT } from '../sim/constants';
import type { Match } from '../sim/match';
import type { Kit, MatchEvent, Side } from '../sim/types';
import { FunHud } from '../ui/funHud';
import type { Hud } from '../ui/hud';
import { FunTracker, type BountyKind, type DailyLive, type FunCue, type FunSummary } from './funLayer';

/**
 * The fun layer on screen and in the ears (the rules: game/funLayer.ts; the HUD: ui/funHud.ts). The session makes one
 * for any match with a human in it and hands it every sim step's events (after) and every frame (frame):
 *
 * - HYPE: the bars; "SUPER SHOT READY" (a plate for ours, the event flag for theirs); the ball smouldering at our
 *   man's feet while it's armed; the super shot itself: a hold on the strike, a beat of slow motion (against the AI
 *   only, never online), the camera punch and shake, the ball flashing white and then flying ablaze with lightning
 *   coming off it, the stadium lights popping, the roar, a heavy double buzz. Theirs gets the fire and the roar.
 * - LIVE GOALS and SHOWTIME: the card, its tick and its payout (coins flying from our man to the bank, the coin sound,
 *   a success buzz); the grade letter.
 * - Goals: the callouts under GOAL!, and more of everything for a late winner, an equaliser, a hat trick, a super shot.
 * - The final minutes: the call, the heartbeat pulse round the edge, the camera tightening a touch (CameraRig.tension).
 *
 * Sound goes through the audio engineer's hooks where they exist (sfx.superShot, objectiveDone, coinsBurst,
 * setTension, finalMinute), else the nearest existing sound: no synthesis here.
 */

/** The audio hooks src/audio/sfx.ts is getting (optional until they land). */
type FunAudio = {
  superShot?: () => void;
  objectiveDone?: () => void;
  coinsBurst?: (n: number) => void;
  setTension?: (k: number) => void;
  finalMinute?: (on: boolean) => void;
};
const audio = sfx as unknown as FunAudio;

/** The super shot: the hold on the strike (60 Hz frames), the slow motion after it (s, rate), how long the ball burns (s). */
const SUPER_HOLD = 5;
const SUPER_SLOW_S = 0.5;
const SUPER_SLOW_RATE = 0.4;
const SUPER_FLY_S = 1.6;
const SUPER_PUNCH = 0.2;
/** The super shot's fire and lightning. */
const SUPER_COLS = [0xffd23a, 0xfff3b0, 0xffffff, 0x8fe3ff] as const;
const BOLT_COLS = [0xffffff, 0x8fe3ff, 0x4fb8ff] as const;
/** The final minutes' heartbeat (beats a second) from the call to the whistle. */
const BEAT_FROM = 1.15;
const BEAT_TO = 1.9;

export interface FunPresenterOpts {
  match: Match;
  hud: Hud;
  view: MatchView;
  cam: CameraRig;
  effects: Effects;
  stadium: Stadium;
  camera: THREE.Camera;
  kits: [Kit, Kit];
  /** Bounties and SHOWTIME (an ordinary match against the AI: not online, not a moment). */
  bounties: boolean;
  showtime: boolean;
  reducedMotion: boolean;
  /** The session's hit-stop and slow motion (the session drops the slow motion online). */
  hold: (frames: number) => void;
  slow: (seconds: number, rate: number) => void;
  /** No live picture (a replay, the pause): the per-frame effects wait. */
  replaying: () => boolean;
}

export class FunPresenter {
  readonly tracker: FunTracker;
  readonly hud: FunHud;
  private readonly m: Match;
  private readonly hs: Side | -1;
  private superFlyT = 0;
  private hot = false;
  private emberAcc = 0;
  private fireAcc = 0;
  private boltAcc = 0;
  private finalOn = false;
  private v = new THREE.Vector3();

  constructor(private readonly o: FunPresenterOpts) {
    const m = (this.m = o.match);
    const hs = m.cfg.humanSide;
    this.hs = hs === 0 || hs === 1 ? hs : -1;
    this.tracker = new FunTracker(m, { humanSide: this.hs, bounties: o.bounties, showtime: o.showtime, seed: m.cfg.seed ?? 1 });
    this.hud = new FunHud(o.hud.root, [o.kits[0].shirt, o.kits[1].shirt], this.hs, {
      hype: !!m.cfg.hype, showtime: o.showtime, bounties: o.bounties, reducedMotion: o.reducedMotion,
    });
  }

  /** Today's daily challenges with this match counted in (main.ts, after each event). */
  setDaily(list: DailyLive[], kinds?: Iterable<BountyKind>): void {
    this.tracker.setDaily(list, kinds);
  }

  /** After every sim step: its events. */
  after(events: readonly MatchEvent[]): void {
    for (const e of events) {
      if (e.type === 'hypeFull') this.hypeFull(e.side);
      else if (e.type === 'superShot') this.superShot(e.side, e.player);
    }
    this.tracker.after(events, DT);
  }

  /** Every frame (dt 0 while paused). */
  frame(dt: number): void {
    const m = this.m;
    const hud = this.hud;
    for (const c of this.tracker.cues.splice(0)) this.cue(c);
    if (m.cfg.hype) hud.setHype(hypeOf(m, 0), hypeOf(m, 1));
    hud.tickBounty(this.tracker.bounty, dt);
    hud.update(dt);
    // The final minutes: the heartbeat round the edge, the crowd's tension, the camera a touch tighter.
    const k = m.phase === 'goal' ? this.tracker.tension * 0.5 : this.tracker.tension;
    hud.tension(k, BEAT_FROM + (BEAT_TO - BEAT_FROM) * Math.max(0, (k - 0.55) / 0.45), dt);
    audio.setTension?.(k);
    (this.o.cam as CameraRig & { tension?: number }).tension = this.o.reducedMotion ? 0 : k;
    if (this.finalOn && (m.phase === 'fulltime' || m.phase === 'shootout')) {
      this.finalOn = false;
      audio.finalMinute?.(false);
    }
    if (m.cfg.hype && dt > 0) this.ballFx(dt);
  }

  private cue(c: FunCue): void {
    const hud = this.hud;
    switch (c.type) {
      case 'bounty':
        hud.bounty(c);
        if (c.state === 'offer') sfx.spawnBlip();
        else if (c.state === 'progress') sfx.click();
        else if (c.state === 'done') this.bountyDone(c.b.def.coins);
        break;
      case 'style':
        hud.style(c);
        if (c.up && (c.grade === 'A' || c.grade === 'S')) sfx.click();
        break;
      case 'goalCall':
        hud.goalTags(c.tags, c.ours || this.hs < 0);
        this.goalJuice(c);
        break;
      case 'final':
        this.finalOn = true;
        hud.finalMinutes(c.diff);
        audio.finalMinute?.(true);
        if (!audio.finalMinute) sfx.whistle('short');
        break;
      case 'daily':
        hud.daily(c);
        if (c.done) sfx.coin();
        else sfx.click();
        break;
    }
  }

  /** A live goal done: the coins fly from our man (or the card) to the bank, with the sound and a buzz. */
  private bountyDone(coins: number): void {
    const m = this.m;
    const a = this.hs >= 0 ? m.activeOf(this.hs as Side) : -1;
    const from = a >= 0 ? this.screenOf(this.o.view.frame[a * PF], 1.6, this.o.view.frame[a * PF + 1]) : null;
    if (audio.objectiveDone) audio.objectiveDone();
    else sfx.coin();
    audio.coinsBurst?.(coins);
    buzz('bounty');
    let last = -1;
    this.hud.coins(coins, from, (i) => {
      // (One coin sound per landing at most every few: a rattle, not a machine gun.)
      if (!audio.coinsBurst && i - last >= 2) {
        last = i;
        sfx.coin();
      }
    });
  }

  /** CSS px of a world point (null behind the camera). */
  private screenOf(x: number, y: number, z: number): { x: number; y: number } | null {
    if (typeof window === 'undefined') return null;
    const v = this.v.set(x, y, z).project(this.o.camera);
    if (v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }

  // ---------------------------------------------------------------- HYPE

  private hypeFull(side: Side): void {
    this.hud.hypeFull(side);
    const m = this.m;
    if (side === this.hs) {
      this.o.hud.show('SUPER SHOT READY', '', 'power small', 1.7);
      this.o.hud.root.querySelector<HTMLElement>('.hud-banner')?.style.setProperty('--pw', '#ffd23a');
      sfx.powerup();
      buzz('success');
    } else if (this.hs >= 0) {
      this.o.hud.toastMsg(`${m.teams[side].short} SUPER SHOT READY`, 1.8);
      sfx.spawnBlip();
    }
  }

  /** The super shot struck: the full show for ours, the fire and the roar for theirs. */
  private superShot(side: Side, player: number): void {
    const o = this.o;
    const ours = side === this.hs;
    this.superFlyT = SUPER_FLY_S;
    const b = this.m.ball.pos;
    const kit = o.kits[side];
    if (audio.superShot) audio.superShot();
    else sfx.powerUse('mega');
    sfx.cheer(ours ? 1.5 : 1.1);
    o.view.flashBall();
    o.effects.burst(b.x, Math.max(0.3, b.y), b.z, [...SUPER_COLS, kit.shirt], ours ? 60 : 36, ours ? 11 : 8, 1.4);
    o.effects.sparks(b.x, Math.max(0.3, b.y), b.z, BOLT_COLS, ours ? 26 : 14, 9, 0.35, 2);
    o.stadium.flashBurst(ours ? 70 : 40);
    if (ours) {
      o.hold(SUPER_HOLD);
      o.slow(SUPER_SLOW_S, SUPER_SLOW_RATE);
      o.cam.kick(SUPER_PUNCH);
      o.cam.shakePx(SHAKE_PX.mega);
      o.view.flashPlayer(player, 6);
      buzz('super');
      o.hud.toastMsg('SUPER SHOT!', 1.4);
    } else {
      o.cam.kick(0.07);
      o.hud.toastMsg(`${this.m.teams[side].short} SUPER SHOT!`, 1.4);
    }
  }

  /**
   * The ball: smouldering at our man's feet while our meter is full (and theirs' too: you see it coming), ablaze with
   * lightning crackling off it while a super shot flies (SUPER_FLY_S, or till someone has it).
   */
  private ballFx(dt: number): void {
    const m = this.m;
    const o = this.o;
    const f = o.view.frame;
    const live = !o.replaying();
    const bx = f[BALL_OFS], by = f[BALL_OFS + 1], bz = f[BALL_OFS + 2];
    const flying = live && this.superFlyT > 0 && superBall(m) !== -1;
    if (this.superFlyT > 0) this.superFlyT = m.ball.owner >= 0 || m.ball.held ? 0 : this.superFlyT - dt;
    const owner = m.ball.owner >= 0 && !m.ball.held ? m.players[m.ball.owner] : null;
    const armed = live && !!owner && m.phase === 'play' && superArmed(m, owner.side);
    const hot = flying || armed;
    if (hot !== this.hot) {
      this.hot = hot;
      o.view.setBallHot(hot);
    }
    if (flying) {
      const vx = f[BALL_OFS + 3], vz = f[BALL_OFS + 5];
      this.fireAcc += dt * 80;
      while (this.fireAcc >= 1) {
        this.fireAcc -= 1;
        o.effects.fire(bx, Math.max(0.1, by), bz, 1, -vx * 0.05, 0, -vz * 0.05);
      }
      // Lightning: bright crackles shed off it.
      this.boltAcc += dt * 26;
      while (this.boltAcc >= 1) {
        this.boltAcc -= 1;
        o.effects.sparks(bx, Math.max(0.15, by), bz, BOLT_COLS, 2, 5, 0.18, 0);
      }
    } else {
      this.fireAcc = this.boltAcc = 0;
    }
    if (armed && !flying) {
      this.emberAcc += dt * 12;
      while (this.emberAcc >= 1) {
        this.emberAcc -= 1;
        o.effects.fire(bx, Math.max(0.12, by + 0.05), bz, 1);
      }
    } else this.emberAcc = 0;
  }

  // ---------------------------------------------------------------- goals

  /** A big goal (a late winner, an equaliser, a hat trick, a super shot) gets more of everything. */
  private goalJuice(c: Extract<FunCue, { type: 'goalCall' }>): void {
    const big = c.tags.filter((t) => t.big).length;
    if (!big) return;
    const o = this.o;
    const m = this.m;
    const gx = Math.sign(m.ball.pos.x || 1) * 52.5;
    const kit = o.kits[c.side];
    const cols = [kit.shirt, kit.shirt2, 0xffd23a, 0xfbfbf4];
    const mine = c.ours || this.hs < 0;
    o.effects.confetti(gx * 0.55, 0, cols, mine ? 260 : 120, 55);
    o.stadium.flashBurst(mine ? 80 : 40);
    if (mine) {
      o.cam.shakePx(SHAKE_PX.goal * 0.6);
      sfx.cheer(1.8);
      if (big > 1) o.effects.burst(gx * 0.9, 3, m.ball.pos.z, cols, 80, 12, 2.2);
    } else sfx.cheer(1);
  }

  // ---------------------------------------------------------------- full time, dev

  summary(): FunSummary {
    return this.tracker.summary();
  }

  /** Dev builds (window.__bl.superShot): `side`'s meter full now (a local match). */
  devSuperShot(side: Side | -1 = this.hs): boolean {
    const s = side === -1 ? 0 : side;
    if (!this.m.cfg.hype) return false;
    devFillHype(this.m, s);
    return true;
  }

  /** Dev builds (window.__bl.objective): put up a live goal now (the one up, if any, ends). */
  devObjective(kind: BountyKind = 'score'): boolean {
    this.tracker.bounty = null;
    return !!this.tracker.offer(kind);
  }

  dispose(): void {
    if (this.finalOn) audio.finalMinute?.(false);
    audio.setTension?.(0);
    if (this.hot) this.o.view.setBallHot(false);
    this.hud.dispose();
  }
}
