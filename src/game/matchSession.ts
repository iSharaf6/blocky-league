import { sfx } from '../audio/sfx';
import type { Input } from '../core/input';
import { clamp } from '../core/math';
import { CameraRig } from '../render/cameraRig';
import { Effects } from '../render/effects';
import { MatchView } from '../render/matchView';
import { Stadium } from '../render/stadium';
import type { World } from '../render/world';
import { DT, HALF_L } from '../sim/constants';
import { EMPTY_PAD, Match, type MatchConfig, type Pad } from '../sim/match';
import type { Kit, MatchEvent, RestartKind, Side } from '../sim/types';
import { Hud, hudTeam } from '../ui/hud';
import { TouchControls, isTouchDevice } from '../ui/touch';
import { BALL_OFS, FRAME_LEN, PF, ReplayBuffer, writeFrame } from './replay';

export interface SessionOptions extends MatchConfig {
  kits: [Kit, Kit];
  attendance: number;
  demo?: boolean;
}

export interface MatchResult {
  score: [number, number];
  humanSide: Side | -1;
  match: Match;
}

const RESTART_LABEL: Record<RestartKind, string> = {
  kickoff: 'KICK OFF', throwin: 'THROW-IN', corner: 'CORNER', goalkick: 'GOAL KICK', freekick: 'FREE KICK', penalty: 'PENALTY!',
};

export class MatchSession {
  readonly match: Match;
  readonly view: MatchView;
  readonly stadium: Stadium;
  readonly effects = new Effects();
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
  private readonly demo: boolean;

  constructor(private world: World, private input: Input, readonly opt: SessionOptions) {
    this.demo = !!opt.demo;
    this.match = new Match(opt);
    const teams = this.match.teams;
    this.stadium = new Stadium({
      home: opt.kits[0].shirt,
      away: opt.kits[1].shirt,
      homeName: teams[0].name,
      awayName: teams[1].name,
      attendance: opt.attendance,
      seed: this.match.rng.int(1e9),
    });
    this.view = new MatchView(teams, opt.kits, opt.humanSide);
    world.scene.add(this.stadium.group, this.view.group, this.effects.mesh);
    this.cam = new CameraRig(world.camera);
    this.cam.setMode(this.demo ? 'menu' : 'broadcast');
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
  }

  requestPause(): void {
    if (this.demo || this.paused) return;
    this.paused = true;
    this.onPause?.();
  }

  resume(): void {
    this.paused = false;
  }

  continueSecondHalf(): void {
    this.match.continueSecondHalf();
    this.halftimeFired = false;
    this.hud?.show('SECOND HALF', '', 'small', 1.6);
  }

  private buildPad(): Pad {
    if (this.demo || this.match.cfg.humanSide < 0) return EMPTY_PAD;
    const c = this.input.read();
    const w = this.cam.screenToWorld(c.sx, c.sy);
    return { mx: w.x, mz: w.z, sprint: c.sprint, pass: c.pass, shoot: c.shoot, through: c.through };
  }

  update(realDt: number): void {
    const dt = Math.min(realDt, 0.1);
    this.time += dt;
    const m = this.match;

    if (this.replay) {
      this.stepReplay(dt);
    } else if (!this.paused) {
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
    }

    // Camera.
    const f = this.view.frame;
    const hs = m.cfg.humanSide;
    const attack = hs >= 0 ? m.attackDir(hs as Side) : 1;
    let ax = f[BALL_OFS];
    let az = f[BALL_OFS + 2];
    const act = f[BALL_OFS + 8];
    if (this.cam.mode === 'celebrate' && m.lastGoalScorer >= 0) {
      ax = f[m.lastGoalScorer * PF];
      az = f[m.lastGoalScorer * PF + 1];
    } else if (act >= 0) {
      ax = f[act * PF];
      az = f[act * PF + 1];
    }
    this.cam.update(dt, {
      bx: f[BALL_OFS], by: f[BALL_OFS + 1], bz: f[BALL_OFS + 2],
      bvx: f[BALL_OFS + 3], bvz: f[BALL_OFS + 5],
      ax, az, attack,
    }, this.time);
    this.world.focusShadows(this.cam.focusX, this.cam.focusZ);
    this.view.faceCamera(this.world.camera);
    this.stadium.update(dt, this.time);
    this.effects.update(dt);
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
      if (m.phaseT > 2.6 && !this.replayDone) this.startReplay();
      else if (this.replayDone) {
        this.replayDone = false;
        m.resumeAfterGoal();
        this.cam.setMode('broadcast');
      }
    }
    if (m.phase === 'halftime' && !this.halftimeFired && m.phaseT > 1.6) {
      this.halftimeFired = true;
      if (this.demo) m.continueSecondHalf();
      else this.onHalftime?.();
    }
    if (m.phase === 'fulltime' && !this.finishFired && m.phaseT > 2.4) {
      this.finishFired = true;
      if (this.demo) return;
      this.onFinish?.({ score: [...m.score] as [number, number], humanSide: m.cfg.humanSide, match: m });
    }
  }

  private startReplay(): void {
    const lead = 4.6 * 60;
    const tail = 1.3 * 60;
    const since = this.recorded - this.goalFrame;
    const frames = this.buffer.snapshot(Math.min(this.buffer.count, since + lead));
    const cut = Math.max(2, frames.length - since + tail);
    this.replay = frames.slice(0, Math.min(frames.length, cut));
    this.replayGoalIdx = Math.max(0, this.replay.length - tail);
    this.replayT = 0;
    this.cam.replayAngle = Math.floor(Math.random() * 3);
    this.cam.setMode('replay');
    this.hud?.setReplay(true);
    this.view.setMarkerVisible(false);
    this.prevButtons = true;
  }

  private stepReplay(dt: number): void {
    const frames = this.replay!;
    const idx = this.replayT * 60;
    // Slow-motion as the ball goes in.
    const near = Math.abs(idx - this.replayGoalIdx) < 70;
    this.replayT += dt * (near ? 0.38 : 0.75);
    const i = Math.floor(idx);
    const c = this.input.read();
    const btn = c.pass || c.shoot || c.through;
    const skip = btn && !this.prevButtons;
    this.prevButtons = btn;
    if (i >= frames.length - 1 || skip) {
      this.replay = null;
      this.replayDone = true;
      this.hud?.setReplay(false);
      this.view.setMarkerVisible(this.match.cfg.humanSide >= 0);
      this.cam.setMode('broadcast');
      this.flow();
      return;
    }
    this.view.apply(frames[i], frames[i + 1], idx - i, this.time, dt * (near ? 0.38 : 0.75));
  }

  private handleEvents(events: MatchEvent[]): void {
    const m = this.match;
    for (const e of events) {
      switch (e.type) {
        case 'kick': {
          sfx.kick(e.power, e.kind === 'header');
          if (e.kind === 'shot' && e.power > 0.5) {
            this.effects.grass(e.x, e.z, 10, e.power);
            this.cam.kick(0.05 + e.power * 0.08);
          } else if (e.power > 0.6) this.effects.grass(e.x, e.z, 5, e.power * 0.6);
          break;
        }
        case 'goal': {
          this.goalFrame = this.recorded;
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
          if (!this.demo) this.cam.setMode('celebrate');
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
          sfx.save();
          if (m.shotClock < 2) {
            this.hud?.toastMsg(e.caught ? 'GREAT SAVE!' : 'PARRIED!');
            sfx.cheer(0.6);
          }
          break;
        case 'tackle':
          if (e.won) {
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
        case 'foul':
          if (!e.penalty) this.hud?.toastMsg('FOUL!', 1.2);
          break;
        case 'halftime':
          this.hud?.show('HALF TIME', `${m.score[0]} - ${m.score[1]}`, 'small', 3);
          break;
        case 'fulltime':
          this.hud?.show('FULL TIME', `${m.score[0]} - ${m.score[1]}`, 'small', 3);
          break;
        default:
          break;
      }
    }
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
    const minute = m.minute();
    if (minute !== this.lastMinute) {
      this.lastMinute = minute;
      const stoppage = m.clock > m.cfg.halfLength;
      hud.setClock(Math.min(minute, m.half * 45), stoppage);
      this.stadium.setScore(m.score[0], m.score[1], `${minute}'`);
    }
    hud.update(dt, this.view.frame);
    const hs = m.cfg.humanSide;
    if (hs < 0) return;
    const dev = this.input.lastDevice;
    const key = (k: 'pass' | 'shoot' | 'through') =>
      dev === 'gamepad' ? { pass: 'A', shoot: 'B', through: 'X' }[k] : dev === 'touch' ? k.toUpperCase() : { pass: 'SPACE', shoot: 'K', through: 'L' }[k];
    let hint = '';
    const r = m.restart;
    if ((m.phase === 'kickoff' || m.phase === 'restart') && r && r.side === hs) {
      switch (r.kind) {
        case 'kickoff': hint = `${key('pass')} to kick off`; break;
        case 'throwin': hint = `Aim + ${key('pass')} to throw`; break;
        case 'corner': hint = `${key('pass')} short · hold ${key('through')} to cross`; break;
        case 'goalkick': hint = `${key('pass')} short · hold ${key('through')} to go long`; break;
        case 'freekick': hint = `${key('shoot')} to shoot · hold ${key('through')} to cross`; break;
        case 'penalty': hint = `Aim + hold ${key('shoot')} to shoot`; break;
      }
    } else if (m.ball.held && m.ball.owner >= 0 && m.players[m.ball.owner].side === hs) {
      hint = `${key('pass')} throw · ${key('through')} kick long`;
    }
    hud.setHint(this.replay ? '' : hint);
    if (m.active >= 0) {
      const p = m.players[m.active];
      hud.setPlayer(p.def.number, p.def.name, p.stamina);
      const charging = m.ball.owner === p.idx && m.shootCharge > 0.04;
      this.view.setPower(charging ? Math.min(1, m.shootCharge / 0.85) : null, p.pos.x, p.pos.z);
    }
    if (this.touch) {
      const mine = m.ball.owner >= 0 && m.players[m.ball.owner].side === hs;
      this.touch.setContext(m.phase === 'restart' || m.phase === 'kickoff' ? 'setpiece' : mine ? 'attack' : 'defend');
    }
    // Pause via keyboard / gamepad.
    const c = this.input.gamepadPause();
    if (c && !this.paused) this.requestPause();
  }

  dispose(): void {
    this.world.scene.remove(this.stadium.group, this.view.group, this.effects.mesh);
    this.hud?.dispose();
    this.touch?.root.remove();
    this.input.touch.enabled = false;
    this.stadium.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }
}

import type * as THREE from 'three';
