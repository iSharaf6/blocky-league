import { sfx } from '../audio/sfx';
import type { Input } from '../core/input';
import { clamp } from '../core/math';
import { CameraRig } from '../render/cameraRig';
import { Effects } from '../render/effects';
import { MatchView } from '../render/matchView';
import { PITCH_Y, Stadium } from '../render/stadium';
import type { TimeOfDay, World } from '../render/world';
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
  timeOfDay?: TimeOfDay;
  /** Show first-match control tips. */
  tutorial?: boolean;
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
}

interface Tally {
  goals: number;
  assists: number;
  tackles: number;
  saves: number;
  passes: number;
  shots: number;
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
  private introLeft = 0;
  private tally: Tally[] = Array.from({ length: 22 }, () => ({ goals: 0, assists: 0, tackles: 0, saves: 0, passes: 0, shots: 0 }));
  private lastPasser: [number, number] = [-1, -1];
  private tut = { moved: false, passed: false, shot: false, switched: false, step: 0, t: 0 };
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
    const tod = opt.timeOfDay ?? 'day';
    world.setTimeOfDay(tod);
    this.stadium.setTimeOfDay(tod);
    this.view.group.position.y = PITCH_Y;
    this.effects.mesh.position.y = PITCH_Y;
    world.scene.add(this.stadium.group, this.view.group, this.effects.mesh);
    this.cam = new CameraRig(world.camera);
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

    if (this.introLeft > 0) {
      this.introLeft -= dt;
      this.cam.introT = Math.min(1, 1 - this.introLeft / 3.4);
      const c = this.input.read();
      const btn = c.pass || c.shoot || c.through;
      if (btn && !this.prevButtons) this.introLeft = 0;
      this.prevButtons = btn;
      if (this.introLeft <= 0) this.cam.setMode('broadcast');
      this.view.apply(this.prev, this.cur, 1, this.time, dt);
    } else if (this.replay) {
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
    let avx = 0;
    let avz = 0;
    const act = f[BALL_OFS + 8];
    if (this.cam.mode === 'celebrate' && m.lastGoalScorer >= 0) {
      const sc = m.players[m.lastGoalScorer];
      ax = f[m.lastGoalScorer * PF];
      az = f[m.lastGoalScorer * PF + 1];
      avx = sc.vel.x;
      avz = sc.vel.z;
    } else if (act >= 0) {
      ax = f[act * PF];
      az = f[act * PF + 1];
    }
    const owner = m.ball.owner >= 0 ? m.players[m.ball.owner] : null;
    const lean = owner ? m.attackDir(owner.side) : 0;
    this.cam.update(dt, {
      bx: f[BALL_OFS], by: f[BALL_OFS + 1], bz: f[BALL_OFS + 2],
      bvx: f[BALL_OFS + 3], bvz: f[BALL_OFS + 5],
      ax, az, avx, avz, attack, lean,
      setPiece: this.replay ? null : this.setPieceFrame(),
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
        this.view.setMarkerVisible(m.cfg.humanSide >= 0);
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
      this.onFinish?.({ score: [...m.score] as [number, number], humanSide: m.cfg.humanSide, match: m, ratings: this.ratings() });
    }
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

  /** Frame the taker and where the ball is going for set pieces. */
  private setPieceFrame(): { x: number; z: number; tx: number; tz: number } | null {
    const m = this.match;
    const r = m.restart;
    if (!r || (m.phase !== 'restart' && m.phase !== 'out')) return null;
    if (m.phase === 'out' && m.phaseT < 0.5) return null;
    const ad = m.attackDir(r.side);
    switch (r.kind) {
      case 'corner':
      case 'freekick':
      case 'penalty':
        return { x: r.x, z: r.z, tx: ad * (HALF_L - 9), tz: 0 };
      case 'throwin':
        return { x: r.x, z: r.z, tx: r.x + ad * 8, tz: r.z * 0.55 };
      case 'goalkick':
        return { x: r.x, z: r.z, tx: r.x + ad * 22, tz: 0 };
      default:
        return null;
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
    this.cam.replayAngle = Math.floor(Math.random() * 2);
    this.cam.replayGoalSign = this.match.attackDir(this.match.goalSide);
    this.cam.replayShot = this.replay.length - this.replayGoalIdx > 0 && this.replayGoalIdx > 100 ? 'build' : 'goal';
    this.cam.setMode('replay');
    this.hud?.setReplay(true);
    this.view.setMarkerVisible(false);
    this.prevButtons = true;
  }

  private stepReplay(dt: number): void {
    const frames = this.replay!;
    const idx = this.replayT * 60;
    // Two shots like TV: the move in real-ish time, then the finish from behind the net in slow-mo.
    const finish = idx >= this.replayGoalIdx - 95;
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

  private handleEvents(events: MatchEvent[]): void {
    const m = this.match;
    for (const e of events) {
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
    // Aim arrow for our set pieces.
    if (!this.replay && r && r.side === hs && m.phase === 'restart' && r.kind !== 'kickoff') {
      const t = m.players[r.taker];
      const long = r.kind === 'corner' || r.kind === 'goalkick' ? 1.6 : r.kind === 'freekick' || r.kind === 'penalty' ? 1.3 : 1;
      this.view.setAim(true, t.pos.x, t.pos.z, t.facing, long);
    } else this.view.setAim(false);
    this.updateTutorial(dt, key);
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

  private updateTutorial(dt: number, key: (k: 'pass' | 'shoot' | 'through') => string): void {
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
    else if (mine && !t.passed) tip = `<kbd>${key('pass')}</kbd> passes where you aim · tap <kbd>${key('through')}</kbd> for a through ball`;
    else if (mine && !t.shot) tip = `Near goal? <b>Hold</b> <kbd>${key('shoot')}</kbd> and release to shoot — longer hold, more power`;
    else if (!mine && m.ball.owner >= 0 && !t.switched) {
      tip = `Defending: <kbd>${key('pass')}</kbd> switches player · <kbd>${key('shoot')}</kbd> slide tackles · run into them to steal`;
      if (t.t > 60) t.switched = true;
    }
    if (t.moved && t.passed && t.shot && (t.switched || t.t > 90)) this.opt.tutorial = false;
    hud.setTip(tip);
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
