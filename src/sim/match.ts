import { angleDiff, clamp, dist2 } from '../core/math';
import { Rng } from '../core/rng';
import { onTarget, pickReceiver, resolveKick } from './actions';
import { intercept, isCrossingRestart, makeBrain, setPieceReady, updateTeamAI, type TeamBrain } from './ai';
import { Ball, type BallHit } from './ball';
import {
  AIR_DRAG, BALL_R, BOX_DEPTH, BOX_W, GOAL_H, GOAL_W, GRAVITY, HALF_L, HALF_W, KICK_WINDUP,
  PEN_SPOT, PLAYER_R, ROLL_A, ROLL_B, SIX_DEPTH, SIX_W,
} from './constants';
import { FORMATIONS, kickoffSlot, type Slot } from './formations';
import { inOwnBox } from './keeper';
import { Player } from './player';
import type { KickKind, MatchEvent, RestartKind, Side, TeamDef } from './types';

export type Phase = 'kickoff' | 'play' | 'out' | 'restart' | 'goal' | 'halftime' | 'fulltime';

export interface MatchConfig {
  home: TeamDef;
  away: TeamDef;
  /** Real seconds per half. */
  halfLength: number;
  /** 0 (Sunday league) .. 4 (legend). */
  difficulty: number;
  humanSide: Side | -1;
  seed?: number;
  /**
   * Optional per-side AI difficulty (0..4) overriding `difficulty` for that side's AI.
   * Used for AI-vs-AI balancing; the default keeps both sides on `difficulty`.
   */
  sideDifficulty?: [number, number];
}

/** Held button state from the input layer, move vector already in world space. */
export interface Pad {
  mx: number;
  mz: number;
  sprint: boolean;
  pass: boolean;
  shoot: boolean;
  through: boolean;
}

export interface Restart {
  kind: RestartKind;
  side: Side;
  x: number;
  z: number;
  taker: number;
  wait: number;
}

export interface Stats {
  shots: [number, number];
  onTarget: [number, number];
  possession: [number, number];
  passes: [number, number];
  tackles: [number, number];
  corners: [number, number];
  fouls: [number, number];
  saves: [number, number];
}

export interface GoalRecord {
  side: Side;
  scorer: number;
  name: string;
  minute: number;
  own: boolean;
}

export const EMPTY_PAD: Pad = { mx: 0, mz: 0, sprint: false, pass: false, shoot: false, through: false };

export class Match {
  readonly rng: Rng;
  readonly ball = new Ball();
  readonly players: Player[] = [];
  readonly slots: [Slot[], Slot[]];
  readonly brains: [TeamBrain, TeamBrain] = [makeBrain(), makeBrain()];
  readonly teams: [TeamDef, TeamDef];
  private readonly bySide: [Player[], Player[]] = [[], []];

  score: [number, number] = [0, 0];
  half = 1;
  clock = 0;
  phase: Phase = 'kickoff';
  phaseT = 0;
  restart: Restart | null = null;
  events: MatchEvent[] = [];
  goals: GoalRecord[] = [];
  stats: Stats = {
    shots: [0, 0], onTarget: [0, 0], possession: [0, 0], passes: [0, 0],
    tackles: [0, 0], corners: [0, 0], fouls: [0, 0], saves: [0, 0],
  };

  passTarget = -1;
  passT = 0;
  shotClock = 99;
  shotSide: Side = 0;
  ballPath: { t: number; x: number; y: number; z: number }[] = [];
  keeperHoldTime = 1.4;
  /** Human-controlled player index, -1 when nobody. */
  active = -1;
  shootCharge = 0;
  throughCharge = 0;
  goalSide: Side = 0;
  lastGoalScorer = -1;
  autoSwitch = true;
  /** Seconds since the last possession change (drives crowd tension, auto-switch). */
  sincePossession = 0;
  possessionSide: Side | -1 = -1;

  private prev: Pad = { ...EMPTY_PAD };
  private hits: BallHit[] = [];
  private switchT = 0;
  private firstKickoff: Side = 0;
  private pendingRestart: Restart | null = null;
  private pathT = 0;
  /** Increments on every strike of the ball; lets players react once per kick. */
  kickId = 0;
  /** Seconds since the last strike, where it was struck from, and by which side. */
  sinceKick = 99;
  kickX = 0;
  kickZ = 0;
  kickSide: Side = 0;
  kickKind: KickKind = 'pass';

  constructor(readonly cfg: MatchConfig) {
    this.rng = new Rng(cfg.seed ?? 12345);
    this.teams = [cfg.home, cfg.away];
    this.slots = [FORMATIONS[cfg.home.formation], FORMATIONS[cfg.away.formation]];
    for (const side of [0, 1] as Side[]) {
      const team = this.teams[side];
      // Harder AI sides get a small athletic edge (the human side is never scaled).
      const pace = cfg.humanSide === side ? 1 : 1 + (this.aiSkill(side) - 2) * 0.015;
      for (let s = 0; s < 11; s++) {
        const p = new Player(this.players.length, side, s, team.players[s]);
        p.runT = this.rng.next() * 4;
        p.top *= pace;
        p.jog *= pace;
        this.players.push(p);
        this.bySide[side].push(p);
      }
    }
    this.firstKickoff = this.rng.chance(0.5) ? 0 : 1;
    this.setupKickoff(this.firstKickoff);
    this.updateBallPath();
  }

  // ---------------------------------------------------------------- queries

  attackDir(side: Side): number {
    const base = side === 0 ? 1 : -1;
    return this.half === 1 ? base : -base;
  }

  teamPlayers(side: Side): Player[] {
    return this.bySide[side];
  }

  keeperOf(side: Side): Player | undefined {
    return this.bySide[side][0];
  }

  isHumanControlled(p: Player): boolean {
    return this.cfg.humanSide === p.side && this.active === p.idx;
  }

  aiSkill(side: Side): number {
    if (this.cfg.humanSide === side) return 2.6;
    return this.cfg.sideDifficulty?.[side] ?? this.cfg.difficulty;
  }

  /** Skill level that shapes this player's kick accuracy (humans get a fixed, fair level). */
  kickSkill(p: Player): number {
    return this.isHumanControlled(p) ? 3 : this.aiSkill(p.side);
  }

  keeperBonus(side: Side): number {
    return this.cfg.humanSide === side ? 0.01 : (this.aiSkill(side) - 2) * 0.025;
  }

  /** Deepest outfield defender of `side`, in the normalised frame of the team attacking them. */
  defLine(side: Side): number {
    const other = (side === 0 ? 1 : 0) as Side;
    const ad = this.attackDir(other);
    let line = -1;
    for (const p of this.bySide[side]) {
      if (p.isKeeper) continue;
      line = Math.max(line, (p.pos.x * ad) / HALF_L);
    }
    return line;
  }

  minute(): number {
    const m = Math.floor((this.clock / this.cfg.halfLength) * 45);
    return (this.half - 1) * 45 + Math.min(m, 45 + 4);
  }

  // ---------------------------------------------------------------- set-up

  setupKickoff(side: Side): void {
    this.phase = 'kickoff';
    this.phaseT = 0;
    this.ball.reset(0, 0);
    this.passTarget = -1;
    this.shotClock = 99;
    for (const p of this.players) {
      const ad = this.attackDir(p.side);
      const k = kickoffSlot(this.slots[p.side][p.slot], p.side === side);
      p.pos.x = k.x * HALF_L * ad;
      p.pos.z = k.z * HALF_W * ad;
      p.vel.x = p.vel.z = 0;
      p.facing = ad > 0 ? 0 : Math.PI;
      p.setState('move');
      p.order = null;
      p.y = 0;
      p.vy = 0;
      p.kickT = 0;
      p.wantX = p.wantZ = 0;
      p.running = false;
    }
    // Kicker: the forward nearest the spot stands over the ball.
    const ad = this.attackDir(side);
    let kicker = this.bySide[side][10];
    let best = Infinity;
    for (const p of this.bySide[side]) {
      if (p.role !== 'FW' && p.role !== 'MF') continue;
      const d = Math.hypot(p.pos.x, p.pos.z) + (p.role === 'FW' ? 0 : 6);
      if (d < best) {
        best = d;
        kicker = p;
      }
    }
    kicker.pos.x = -ad * 0.62;
    kicker.pos.z = 0.05;
    kicker.facing = ad > 0 ? 0 : Math.PI;
    this.ball.owner = kicker.idx;
    this.ball.lastTouch = kicker.idx;
    this.ball.lastTouchSide = side;
    this.restart = { kind: 'kickoff', side, x: 0, z: 0, taker: kicker.idx, wait: 1.2 };
    if (this.cfg.humanSide >= 0) {
      this.active = side === this.cfg.humanSide ? kicker.idx : this.nearestTo(this.cfg.humanSide as Side, 0, 0, true);
    }
    this.events.push({ type: 'kickoffReady', side });
  }

  private nearestTo(side: Side, x: number, z: number, skipKeeper: boolean, exclude = -1): number {
    let best = -1;
    let bd = Infinity;
    for (const p of this.bySide[side]) {
      if ((skipKeeper && p.isKeeper) || p.idx === exclude) continue;
      const d = dist2(p.pos.x, p.pos.z, x, z);
      if (d < bd) {
        bd = d;
        best = p.idx;
      }
    }
    return best;
  }

  continueSecondHalf(): void {
    if (this.phase !== 'halftime') return;
    this.half = 2;
    this.clock = 0;
    this.setupKickoff(this.firstKickoff === 0 ? 1 : 0);
  }

  resumeAfterGoal(): void {
    if (this.phase !== 'goal') return;
    this.setupKickoff(this.goalSide === 0 ? 1 : 0);
  }

  // ---------------------------------------------------------------- main step

  step(dt: number, pad: Pad): void {
    this.phaseT += dt;
    if (this.phase === 'halftime' || this.phase === 'fulltime') return;

    this.pathT -= dt;
    if (this.pathT <= 0) {
      this.updateBallPath();
      this.pathT = 0.05;
    }

    if (this.phase === 'goal') {
      this.celebrate();
    } else {
      updateTeamAI(this, 0, dt);
      updateTeamAI(this, 1, dt);
      this.applyHuman(dt, pad);
      this.restartTakers(dt);
    }
    this.prev = { ...pad };

    this.resolveOrders(dt);
    const frozen = this.phase === 'kickoff' || this.phase === 'restart';
    for (const p of this.players) {
      if (frozen && p.state === 'move' && (p.idx === this.restart?.taker || this.phase === 'kickoff')) {
        p.wantX = p.wantZ = 0;
        p.sprint = false;
      }
      p.step(dt, this.ball.owner === p.idx);
    }
    this.separate();
    this.keepHeldBall();
    this.dribbleControl();

    this.hits.length = 0;
    this.ball.step(dt, this.hits);
    for (const h of this.hits) {
      if (h.kind === 'post') {
        this.events.push({ type: 'post', x: h.x, y: h.y, z: h.z, speed: h.speed });
        if (this.shotClock < 2) this.events.push({ type: 'ooh' });
      } else if (h.kind === 'bounce') this.events.push({ type: 'bounce', speed: h.speed });
      else this.events.push({ type: 'net', x: h.x, y: h.y, z: h.z, speed: h.speed });
    }

    if (this.phase === 'play') {
      this.checkSlides();
      this.checkKeeperHands();
      this.checkPossession();
      this.autoTackle();
      this.humanCuts();
      this.checkBounds();
      this.autoSwitchUpdate(dt);
    } else if (this.phase === 'out') {
      // Corners and wide free kicks get a beat longer so the box can fill.
      const pr = this.pendingRestart;
      const beat = pr && isCrossingRestart(this, pr) ? 1.3 : 0.85;
      if (this.phaseT > beat && pr) this.beginRestart(pr);
    }

    if (this.phase === 'play' || this.phase === 'out' || this.phase === 'restart') {
      this.clock += dt;
      if (this.possessionSide !== -1) this.stats.possession[this.possessionSide as Side] += dt;
      if (this.clock >= this.cfg.halfLength && this.phase === 'play') {
        const b = this.ball.pos;
        const danger = Math.abs(b.x) > HALF_L - BOX_DEPTH - 6 && Math.abs(b.z) < BOX_W / 2 + 4;
        if (!danger || this.clock > this.cfg.halfLength + 7) this.endHalf();
      }
    }
    this.passT += dt;
    if (this.passT > 3.2) this.passTarget = -1;
    this.shotClock += dt;
    this.sinceKick += dt;
    this.sincePossession += dt;
    if (this.ball.owner >= 0) this.players[this.ball.owner].ballT += dt;
  }

  private endHalf(): void {
    this.ball.owner = -1;
    for (const p of this.players) {
      p.order = null;
      p.wantX = p.wantZ = 0;
    }
    if (this.half === 1) {
      this.phase = 'halftime';
      this.events.push({ type: 'whistle', kind: 'long' }, { type: 'halftime' });
    } else {
      this.phase = 'fulltime';
      this.events.push({ type: 'whistle', kind: 'end' }, { type: 'fulltime' });
    }
    this.phaseT = 0;
  }

  // ---------------------------------------------------------------- ball path prediction

  updateBallPath(): void {
    const path = this.ballPath;
    path.length = 0;
    const b = this.ball;
    if (b.owner >= 0) {
      const o = this.players[b.owner];
      for (let i = 1; i <= 16; i++) {
        const t = i * 0.1;
        path.push({ t, x: b.pos.x + o.vel.x * t, y: b.pos.y, z: b.pos.z + o.vel.z * t });
      }
      return;
    }
    let x = b.pos.x, y = b.pos.y, z = b.pos.z;
    let vx = b.vel.x, vy = b.vel.y, vz = b.vel.z;
    const dt = 0.05;
    for (let i = 1; i <= 64; i++) {
      const grounded = y <= BALL_R + 0.01 && Math.abs(vy) < 0.9;
      if (grounded) {
        y = BALL_R;
        vy = 0;
        const sh = Math.hypot(vx, vz);
        if (sh > 1e-3) {
          const ns = Math.max(0, sh - (ROLL_A + ROLL_B * sh) * dt);
          vx *= ns / sh;
          vz *= ns / sh;
        }
      } else {
        vy -= GRAVITY * dt;
        const sp = Math.hypot(vx, vy, vz);
        const k = AIR_DRAG * sp * dt;
        vx -= vx * k;
        vy -= vy * k;
        vz -= vz * k;
      }
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      if (y < BALL_R) {
        y = BALL_R;
        vy = vy < -1.1 ? -vy * 0.56 : 0;
        vx *= 0.86;
        vz *= 0.86;
      }
      if (i % 2 === 0) path.push({ t: i * dt, x, y, z });
    }
  }

  // ---------------------------------------------------------------- orders & kicking

  order(
    p: Player, kind: KickKind, dirX: number, dirZ: number, power: number, target: number,
    firstTime: boolean, aim?: { x: number; z: number }, land?: number,
  ): void {
    if (p.state !== 'move' && p.state !== 'hold') return;
    p.order = {
      kind, dirX, dirZ, power, target, firstTime,
      aimX: aim?.x, aimZ: aim?.z, land,
      expires: firstTime ? 0.6 : 0.6,
    };
    if (!firstTime) {
      p.setState(kind === 'throw' || (kind === 'keeper' && p.isKeeper) ? 'throw' : 'kick');
      p.kickT = 0;
      // Strike with the foot on the ball's side.
      const bx = this.ball.pos.x - p.pos.x;
      const bz = this.ball.pos.z - p.pos.z;
      const side = -Math.sin(p.facing) * bx + Math.cos(p.facing) * bz;
      p.kickLeg = side >= 0 ? 1 : -1;
    }
  }

  private ballReach(p: Player): 'foot' | 'head' | null {
    const b = this.ball.pos;
    const df = dist2(p.footX(), p.footZ(), b.x, b.z);
    if (df < 1.0 && b.y < 1.05) return 'foot';
    const dh = dist2(p.pos.x, p.pos.z, b.x, b.z);
    if (dh < 0.95 && b.y >= 1.05 && b.y < 2.55) return 'head';
    return null;
  }

  private resolveOrders(dt: number): void {
    for (const p of this.players) {
      const o = p.order;
      if (!o) continue;
      o.expires -= dt;
      if (o.firstTime) {
        if (p.state !== 'move' || o.expires < 0) {
          p.order = null;
          continue;
        }
        if (this.ball.held) continue;
        if (this.ball.owner >= 0 && this.ball.owner !== p.idx) continue;
        const reach = this.ballReach(p);
        if (!reach) continue;
        if (reach === 'head') {
          if (o.kind === 'shot') o.kind = 'header';
          else if (o.kind !== 'header') {
            o.kind = 'header';
            if (o.target < 0 && o.aimX === undefined) {
              // Header pass along the aim.
              const l = Math.hypot(o.dirX, o.dirZ) || 1;
              o.aimX = p.pos.x + (o.dirX / l) * 14;
              o.aimZ = p.pos.z + (o.dirZ / l) * 14;
            }
          }
          p.headerT = 1;
          p.vy = 3.2;
          p.y = 0.01;
        } else if (o.kind === 'header') {
          // Ball dropped below head height: volley a header shot, otherwise knock the aimed ball on.
          o.kind = o.aimX === undefined && o.target < 0 ? 'shot' : 'lob';
        }
        p.setState('kick');
        p.kickT = 0.32;
        this.execute(p);
        continue;
      }
      const windup = p.state === 'throw' ? 0.26 : KICK_WINDUP;
      if (p.state !== 'kick' && p.state !== 'throw') {
        p.order = null;
        continue;
      }
      if (p.stateT < windup) continue;
      const held = this.ball.held && this.ball.owner === p.idx;
      const reach = held || this.ball.owner === p.idx ? 'foot' : this.ballReach(p);
      if (reach && (this.ball.owner < 0 || this.ball.owner === p.idx)) this.execute(p);
      p.order = null;
    }
  }

  private execute(p: Player): void {
    const o = p.order;
    if (!o) return;
    const b = this.ball;
    if (b.held && b.owner === p.idx) {
      b.held = false;
      if (o.kind === 'throw' || o.kind === 'keeper') {
        b.pos.x = p.pos.x + Math.cos(p.facing) * 0.35;
        b.pos.z = p.pos.z + Math.sin(p.facing) * 0.35;
        b.pos.y = o.kind === 'throw' ? 2.1 : 1.5;
      } else {
        b.pos.x = p.pos.x + Math.cos(p.facing) * 0.6;
        b.pos.z = p.pos.z + Math.sin(p.facing) * 0.6;
        b.pos.y = 0.55;
      }
    }
    const L = resolveKick(this, p, o);
    b.owner = -1;
    b.vel.x = L.vx;
    b.vel.y = L.vy;
    b.vel.z = L.vz;
    b.spin.x = L.spinX;
    b.spin.y = L.spinY;
    b.spin.z = L.spinZ;
    if (b.pos.y < BALL_R) b.pos.y = BALL_R;
    if (L.vy > 0.5 && b.pos.y <= BALL_R + 0.01) b.pos.y = BALL_R + 0.02;
    b.lastTouch = p.idx;
    b.lastTouchSide = p.side;
    p.kickCooldown = 0.3;
    p.order = null;
    this.kickId++;
    this.sinceKick = 0;
    this.kickX = b.pos.x;
    this.kickZ = b.pos.z;
    this.kickSide = p.side;
    this.kickKind = L.kind;
    const isShot = L.kind === 'shot' || (L.kind === 'header' && L.target < 0 && o.aimX === undefined);
    if (isShot) {
      this.shotClock = 0;
      this.shotSide = p.side;
      this.stats.shots[p.side]++;
      if (onTarget(this, p.side)) this.stats.onTarget[p.side]++;
      this.passTarget = -1;
    } else {
      this.passTarget = L.target;
      this.passT = 0;
      if (L.target >= 0) this.stats.passes[p.side]++;
    }
    this.events.push({ type: 'kick', power: L.power, x: b.pos.x, y: b.pos.y, z: b.pos.z, kind: L.kind });
    if (this.cfg.humanSide === p.side && L.target >= 0 && !isShot) {
      const r = this.players[L.target];
      if (r.side === p.side) this.active = r.idx;
    }
    if (this.phase === 'kickoff' || this.phase === 'restart') {
      if (this.phase === 'kickoff') this.events.push({ type: 'whistle', kind: 'short' });
      this.phase = 'play';
      this.phaseT = 0;
      this.restart = null;
    }
  }

  keeperDistribute(k: Player, dirX = 0, dirZ = 0, long = false): void {
    if (k.state !== 'hold') return;
    const ad = this.attackDir(k.side);
    if (dirX !== 0 || dirZ !== 0) {
      const tgt = pickReceiver(this, k, dirX, dirZ, long ? 'lob' : 'pass');
      k.setState('move');
      this.order(k, long ? 'lob' : 'keeper', dirX, dirZ, 1, tgt, false);
      return;
    }
    // AI: short to a free defender, otherwise launch it.
    let best = -1;
    let bestS = -Infinity;
    for (const t of this.bySide[k.side]) {
      if (t === k) continue;
      const d = dist2(k.pos.x, k.pos.z, t.pos.x, t.pos.z);
      if (d > 28 || d < 6) continue;
      // Never roll it across the face of our own goal.
      if (Math.sign(t.pos.z) !== Math.sign(k.pos.z) && Math.abs(t.pos.z - k.pos.z) > 16) continue;
      let open = 10;
      for (const o of this.bySide[k.side === 0 ? 1 : 0]) open = Math.min(open, dist2(o.pos.x, o.pos.z, t.pos.x, t.pos.z));
      const s = open - d * 0.08 + this.rng.next() * 2;
      if (s > bestS) {
        bestS = s;
        best = t.idx;
      }
    }
    k.setState('move');
    if (best >= 0 && bestS > 5 && this.rng.chance(0.7)) {
      const t = this.players[best];
      this.order(k, 'keeper', t.pos.x - k.pos.x, t.pos.z - k.pos.z, 0.6, best, false);
    } else {
      let fw = -1;
      let fd = -Infinity;
      for (const t of this.bySide[k.side]) {
        if (t.role !== 'FW' && t.role !== 'MF') continue;
        const s = t.pos.x * ad + this.rng.next() * 12;
        if (s > fd) {
          fd = s;
          fw = t.idx;
        }
      }
      const t = this.players[fw];
      this.order(k, 'lob', t.pos.x - k.pos.x, t.pos.z - k.pos.z, 1, fw, false);
    }
  }

  /** Keeper with the ball at their feet: safe pass if one is on, otherwise hoof it. */
  keeperClear(k: Player): void {
    const ad = this.attackDir(k.side);
    let best = -1;
    let bestS = -Infinity;
    for (const t of this.bySide[k.side]) {
      if (t === k) continue;
      const d = dist2(k.pos.x, k.pos.z, t.pos.x, t.pos.z);
      if (d < 6 || d > 30) continue;
      let open = 10;
      for (const o of this.bySide[k.side === 0 ? 1 : 0]) open = Math.min(open, dist2(o.pos.x, o.pos.z, t.pos.x, t.pos.z));
      if (open - d * 0.1 > bestS) {
        bestS = open - d * 0.1;
        best = t.idx;
      }
    }
    if (best >= 0 && bestS > 4) {
      const t = this.players[best];
      this.order(k, 'pass', t.pos.x - k.pos.x, t.pos.z - k.pos.z, 0.6, best, false);
    } else {
      this.order(k, 'clear', ad, 0, 1, -1, false, { x: k.pos.x + ad * 45, z: (this.rng.next() - 0.5) * 30 });
    }
  }

  // ---------------------------------------------------------------- human control

  private applyHuman(dt: number, pad: Pad): void {
    const hs = this.cfg.humanSide;
    if (hs < 0) return;
    const side = hs as Side;
    const passP = pad.pass && !this.prev.pass;
    const shootP = pad.shoot && !this.prev.shoot;
    const shootR = !pad.shoot && this.prev.shoot;
    const throughP = pad.through && !this.prev.through;
    const throughR = !pad.through && this.prev.through;
    const stickLen = Math.hypot(pad.mx, pad.mz);
    // Charge is measured while held and read on the release frame.
    const shootPower = clamp(this.shootCharge / 0.85, 0.15, 1);
    const throughHold = this.throughCharge;
    this.shootCharge = pad.shoot ? this.shootCharge + dt : 0;
    this.throughCharge = pad.through ? this.throughCharge + dt : 0;

    // Set pieces we're taking.
    if ((this.phase === 'kickoff' || this.phase === 'restart') && this.restart && this.restart.side === side) {
      const t = this.players[this.restart.taker];
      this.active = t.idx;
      t.wantX = t.wantZ = 0;
      if (stickLen > 0.3 && this.restart.kind !== 'kickoff') {
        t.facing = Math.atan2(pad.mz, pad.mx);
      }
      if (this.phase === 'restart' && this.phaseT < 0.35) return;
      const kind = this.restart.kind;
      const dx = stickLen > 0.3 ? pad.mx : Math.cos(t.facing);
      const dz = stickLen > 0.3 ? pad.mz : Math.sin(t.facing);
      // Crossing set pieces: hold the delivery (briefly) until the runners are in the box, but
      // remember the button so the kick goes the moment they are.
      if (this.phase === 'restart' && isCrossingRestart(this, this.restart)) {
        let want: (() => void) | null = null;
        if (passP) want = () => this.order(t, 'pass', dx, dz, 0.6, -1, false);
        else if (throughR) {
          const pw = clamp(throughHold / 0.8, 0.3, 1);
          want = () => this.order(t, 'lob', dx, dz, pw, -1, false);
        } else if (shootR && kind === 'freekick') {
          const pw = shootPower;
          want = () => this.order(t, 'shot', dx, dz, pw, -1, false);
        } else if (shootR) want = () => this.order(t, 'lob', dx, dz, 1, -1, false);
        if (want) this.queuedKick = want;
        if (setPieceReady(this, side) < 4 && this.phaseT < 1.6) return;
        const q = this.queuedKick;
        this.queuedKick = null;
        q?.();
        return;
      }
      if (kind === 'kickoff') {
        if (passP || throughP || shootP) {
          const ad = this.attackDir(side);
          const kx = stickLen > 0.3 ? pad.mx : -ad * 0.4;
          const kz = stickLen > 0.3 ? pad.mz : 1;
          this.order(t, 'pass', kx, kz, 0.5, -1, false);
        }
      } else if (kind === 'throwin') {
        if (passP || throughP) this.order(t, 'throw', dx, dz, 0.5, -1, false);
      } else {
        if (passP) this.order(t, 'pass', dx, dz, 0.6, -1, false);
        else if (throughR) this.order(t, 'lob', dx, dz, clamp(throughHold / 0.8, 0.3, 1), -1, false);
        else if (shootR && (kind === 'freekick' || kind === 'penalty')) this.order(t, 'shot', dx, dz, shootPower, -1, false);
        else if (shootR) this.order(t, 'lob', dx, dz, 1, -1, false);
      }
      return;
    }
    if (this.phase !== 'play') {
      // Free movement while the ball is dead.
      if (this.phase !== 'kickoff' && this.active >= 0 && this.players[this.active].side === side) {
        const p = this.players[this.active];
        p.wantX = pad.mx;
        p.wantZ = pad.mz;
        p.sprint = pad.sprint;
        p.faceTarget = null;
      }
      return;
    }

    const b = this.ball;
    // Our keeper has it in their hands: they're ours to distribute.
    if (b.held && b.owner >= 0 && this.players[b.owner].side === side) {
      const k = this.players[b.owner];
      this.active = k.idx;
      const dx = stickLen > 0.3 ? pad.mx : this.attackDir(side);
      const dz = stickLen > 0.3 ? pad.mz : 0;
      if (k.stateT > 0.4) {
        if (passP) this.keeperDistribute(k, dx, dz, false);
        else if (throughP || shootP) this.keeperDistribute(k, dx, dz, true);
      }
      return;
    }

    if (this.active < 0 || this.players[this.active].side !== side) {
      this.active = this.nearestTo(side, b.pos.x, b.pos.z, true);
    }
    const p = this.players[this.active];
    p.faceTarget = null;
    p.wantX = pad.mx;
    p.wantZ = pad.mz;
    p.sprint = pad.sprint;

    const dirX = stickLen > 0.25 ? pad.mx : Math.cos(p.facing);
    const dirZ = stickLen > 0.25 ? pad.mz : Math.sin(p.facing);
    const hasBall = b.owner === p.idx;

    if (hasBall) {
      if (passP) this.order(p, 'pass', dirX, dirZ, 0.6, -1, false);
      else if (shootR) this.order(p, 'shot', stickLen > 0.25 ? pad.mx : 0, stickLen > 0.25 ? pad.mz : 0, shootPower, -1, false);
      else if (throughR) {
        if (throughHold < 0.24) this.order(p, 'through', dirX, dirZ, 0.7, -1, false);
        else this.order(p, 'lob', dirX, dirZ, clamp(throughHold / 0.8, 0.3, 1), -1, false);
      }
    } else {
      const d = dist2(p.pos.x, p.pos.z, b.pos.x, b.pos.z);
      const loose = b.owner < 0 && !b.held;
      const opp = b.owner >= 0 && this.players[b.owner].side !== side;
      if (loose && d < 4) {
        if (passP) this.order(p, 'pass', dirX, dirZ, 0.6, -1, true);
        else if (shootP) this.order(p, 'shot', stickLen > 0.25 ? pad.mx : 0, stickLen > 0.25 ? pad.mz : 0, 0.8, -1, true);
        else if (throughP) this.order(p, 'through', dirX, dirZ, 0.7, -1, true);
      } else {
        if (passP) this.switchPlayer(stickLen > 0.3 ? pad.mx : 0, stickLen > 0.3 ? pad.mz : 0);
        else if (shootP && opp && d < 6) this.startSlide(p);
      }
      // Hold "press" to have your player close the carrier down automatically.
      if (pad.through && opp && stickLen < 0.3) {
        const c = this.players[b.owner];
        const gx = -this.attackDir(side) * HALF_L;
        const ux = gx - c.pos.x;
        const uz = -c.pos.z;
        const ul = Math.hypot(ux, uz) || 1;
        const tx = c.pos.x + (ux / ul) * 0.7 - p.pos.x;
        const tz = c.pos.z + (uz / ul) * 0.7 - p.pos.z;
        const tl = Math.hypot(tx, tz) || 1;
        p.wantX = tx / tl;
        p.wantZ = tz / tl;
        p.sprint = tl > 2;
      }
      // Assisted receive: if a pass is on its way to you and you're not steering, go meet it.
      if (this.passTarget === p.idx && stickLen < 0.2) {
        const i = intercept(this, p);
        const tx = i.x - p.pos.x;
        const tz = i.z - p.pos.z;
        const tl = Math.hypot(tx, tz);
        if (tl > 0.3) {
          p.wantX = (tx / tl) * Math.min(1, tl / 2);
          p.wantZ = (tz / tl) * Math.min(1, tl / 2);
        }
      }
    }
  }

  switchPlayer(dirX = 0, dirZ = 0): void {
    const hs = this.cfg.humanSide;
    if (hs < 0) return;
    const b = this.ball;
    const cur = this.active >= 0 ? this.players[this.active] : null;
    let best = -1;
    let bestS = Infinity;
    const aim = Math.hypot(dirX, dirZ) > 0.3;
    for (const p of this.bySide[hs as Side]) {
      if (p.isKeeper || p.idx === this.active) continue;
      let s = intercept(this, p).t * 6 + dist2(p.pos.x, p.pos.z, b.pos.x, b.pos.z) * 0.4;
      // Prefer players goal-side of the ball.
      const ad = this.attackDir(hs as Side);
      if ((p.pos.x - b.pos.x) * ad > 0) s += 4;
      if (aim && cur) {
        const vx = p.pos.x - cur.pos.x;
        const vz = p.pos.z - cur.pos.z;
        const l = Math.hypot(vx, vz) || 1;
        s -= ((vx * dirX + vz * dirZ) / l) * 10;
      }
      if (s < bestS) {
        bestS = s;
        best = p.idx;
      }
    }
    if (best >= 0) {
      this.active = best;
      this.switchT = 0;
    }
  }

  private autoSwitchUpdate(dt: number): void {
    const hs = this.cfg.humanSide;
    if (hs < 0 || !this.autoSwitch) return;
    this.switchT += dt;
    const b = this.ball;
    if (b.owner >= 0 && this.players[b.owner].side === hs) return;
    if (this.passTarget >= 0 && this.players[this.passTarget].side === hs) return;
    if (this.switchT < 0.9 || this.active < 0) return;
    const cur = this.players[this.active];
    const curT = intercept(this, cur).t;
    let best = -1;
    let bestT = Infinity;
    for (const p of this.bySide[hs as Side]) {
      if (p.isKeeper || p === cur) continue;
      const t = intercept(this, p).t;
      if (t < bestT) {
        bestT = t;
        best = p.idx;
      }
    }
    if (best >= 0 && bestT < curT * 0.55 && curT > 1.2) {
      this.active = best;
      this.switchT = 0;
    }
  }

  // ---------------------------------------------------------------- set pieces

  private restartTakers(_dt: number): void {
    if (this.phase !== 'kickoff' && this.phase !== 'restart') return;
    const r = this.restart;
    if (!r) return;
    const t = this.players[r.taker];
    if (this.cfg.humanSide === r.side) {
      // Humans get a generous window, then it goes automatically.
      if (this.phaseT < 8) return;
    } else if (this.phaseT < r.wait) return;
    if (t.order) return;
    const ad = this.attackDir(r.side);
    const gx = ad * HALF_L;
    const mates = this.bySide[r.side].filter((p) => p !== t);
    const pick = (fn: (p: Player) => number): Player => {
      let best = mates[0];
      let bs = -Infinity;
      for (const p of mates) {
        const s = fn(p);
        if (s > bs) {
          bs = s;
          best = p;
        }
      }
      return best;
    };
    const openness = (p: Player): number => {
      let o = 10;
      for (const q of this.bySide[r.side === 0 ? 1 : 0]) o = Math.min(o, dist2(q.pos.x, q.pos.z, p.pos.x, p.pos.z));
      return o;
    };
    switch (r.kind) {
      case 'kickoff': {
        const m = pick((p) => (p.role === 'MF' ? 10 : 0) - dist2(p.pos.x, p.pos.z, 0, 0));
        this.order(t, 'pass', m.pos.x - t.pos.x, m.pos.z - t.pos.z, 0.5, m.idx, false);
        break;
      }
      case 'throwin': {
        const m = pick((p) => {
          const d = dist2(p.pos.x, p.pos.z, t.pos.x, t.pos.z);
          return d > 18 || d < 4 ? -99 : openness(p) - d * 0.2 + ((p.pos.x - t.pos.x) * ad) * 0.08;
        });
        this.order(t, 'throw', m.pos.x - t.pos.x, m.pos.z - t.pos.z, 0.5, m.idx, false);
        break;
      }
      case 'corner': {
        // Give the runners a moment to load the box.
        if (this.cfg.humanSide !== r.side && setPieceReady(this, r.side) < 4 && this.phaseT < r.wait + 3) return;
        this.deliverSetPiece(t, openness);
        break;
      }
      case 'goalkick': {
        if (this.rng.chance(0.45)) {
          const m = pick((p) => (p.role === 'DF' ? openness(p) : -99));
          this.order(t, 'pass', m.pos.x - t.pos.x, m.pos.z - t.pos.z, 0.6, m.idx, false);
        } else {
          const m = pick((p) => (p.role === 'FW' || p.role === 'MF' ? p.pos.x * ad * 0.3 + openness(p) + this.rng.next() * 4 : -99));
          this.order(t, 'lob', m.pos.x - t.pos.x, m.pos.z - t.pos.z, 1, m.idx, false);
        }
        break;
      }
      case 'penalty': {
        const zAim = this.rng.chance(0.5) ? 1 : -1;
        this.order(t, 'shot', 0, zAim, 0.72 + this.rng.next() * 0.2, -1, false);
        break;
      }
      case 'freekick': {
        const dg = dist2(r.x, r.z, gx, 0);
        if (dg < 30 && Math.abs(r.z) < 14) {
          this.order(t, 'shot', 0, this.rng.chance(0.5) ? 1 : -1, 0.8, -1, false);
        } else if (isCrossingRestart(this, r)) {
          if (this.cfg.humanSide !== r.side && setPieceReady(this, r.side) < 4 && this.phaseT < r.wait + 3) return;
          this.deliverSetPiece(t, openness);
        } else {
          const m = pick((p) => openness(p) + ((p.pos.x - t.pos.x) * ad) * 0.15 - dist2(p.pos.x, p.pos.z, t.pos.x, t.pos.z) * 0.1);
          this.order(t, dg < 40 ? 'lob' : 'pass', m.pos.x - t.pos.x, m.pos.z - t.pos.z, 0.7, m.idx, false);
        }
        break;
      }
    }
  }

  /** AI corner / wide free kick: whip it into the zone one of the box runners is attacking. */
  private deliverSetPiece(t: Player, openness: (p: Player) => number): void {
    const runners = this.brains[t.side].spRunners.map((i) => this.players[i]);
    let tgt: Player | null = null;
    let bs = -Infinity;
    for (let i = 0; i < runners.length; i++) {
      // Near post, far post and the spot are the prime targets.
      const s = (i < 3 ? 1.5 : 0) + openness(runners[i]) * 0.35 + this.rng.next() * 2.5;
      if (s > bs) {
        bs = s;
        tgt = runners[i];
      }
    }
    if (!tgt) {
      const ad = this.attackDir(t.side);
      this.order(t, 'lob', ad * HALF_L - t.pos.x, -t.pos.z, 0.8, -1, false, { x: ad * (HALF_L - 8), z: 0 });
      return;
    }
    const aim = { x: tgt.pos.x + this.rng.gauss() * 0.8, z: tgt.pos.z + this.rng.gauss() * 0.8 };
    this.order(t, 'lob', aim.x - t.pos.x, aim.z - t.pos.z, 0.8, tgt.idx, false, aim);
  }

  private goOut(kind: RestartKind, side: Side, x: number, z: number): void {
    this.phase = 'out';
    this.phaseT = 0;
    this.ball.owner = -1;
    this.passTarget = -1;
    this.pendingRestart = { kind, side, x, z, taker: -1, wait: 0.95 + this.rng.next() * 0.55 };
    // Choose the taker now so everyone can take up set-piece positions while the ball is dead.
    this.pendingRestart.taker = this.pickTaker(this.pendingRestart).idx;
    this.restart = this.pendingRestart;
    for (const p of this.players) p.order = null;
    this.events.push({ type: 'whistle', kind: 'short' }, { type: 'restart', kind, side });
    if (kind === 'corner') this.stats.corners[side]++;
  }

  private pickTaker(r: Restart): Player {
    const team = this.bySide[r.side];
    if (r.kind === 'goalkick') return team[0];
    let taker = team[1];
    let best = Infinity;
    for (const p of team) {
      if (p.isKeeper) continue;
      let d = dist2(p.pos.x, p.pos.z, r.x, r.z);
      // Your best shooter takes penalties and central free kicks.
      if (r.kind === 'penalty' || r.kind === 'freekick') d -= p.stat.shooting * 0.12;
      if (d < best) {
        best = d;
        taker = p;
      }
    }
    return taker;
  }

  private beginRestart(r: Restart): void {
    this.pendingRestart = null;
    this.queuedKick = null;
    const ad = this.attackDir(r.side);
    const taker = r.taker >= 0 ? this.players[r.taker] : this.pickTaker(r);
    r.taker = taker.idx;
    this.ball.reset(r.x, r.z);
    this.ball.lastTouchSide = r.side;
    // Stand the taker behind the ball, facing into play.
    let fx: number, fz: number;
    if (r.kind === 'throwin') {
      fx = 0;
      fz = -Math.sign(r.z);
    } else if (r.kind === 'corner') {
      fx = -Math.sign(r.x) * 0.7;
      fz = -Math.sign(r.z) * 0.7;
    } else if (r.kind === 'goalkick') {
      fx = ad;
      fz = 0;
    } else {
      const gx = ad * HALF_L;
      const l = Math.max(0.1, dist2(r.x, r.z, gx, 0));
      fx = (gx - r.x) / l;
      fz = -r.z / l;
    }
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    taker.facing = Math.atan2(fz, fx);
    taker.setState('move');
    taker.vel.x = taker.vel.z = 0;
    if (r.kind === 'throwin') {
      taker.pos.x = r.x;
      taker.pos.z = r.z + Math.sign(r.z) * 0.25;
      this.ball.owner = taker.idx;
      this.ball.held = true;
    } else {
      taker.pos.x = r.x - fx * 0.62;
      taker.pos.z = r.z - fz * 0.62;
      this.ball.owner = taker.idx;
    }
    if (r.kind === 'penalty') {
      // Everyone else out of the box; keeper on the line.
      const defSide = (r.side === 0 ? 1 : 0) as Side;
      const k = this.bySide[defSide][0];
      k.pos.x = ad * (HALF_L - 0.3);
      k.pos.z = 0;
      k.facing = ad > 0 ? Math.PI : 0;
      k.vel.x = k.vel.z = 0;
      for (const p of this.players) {
        if (p === taker || p === k) continue;
        if (Math.abs(p.pos.x - ad * HALF_L) < BOX_DEPTH + 1 && Math.abs(p.pos.z) < BOX_W / 2 + 1) {
          p.pos.x = ad * (HALF_L - BOX_DEPTH - 2 - this.rng.next() * 4);
          p.pos.z = clamp(p.pos.z, -BOX_W / 2, BOX_W / 2);
        }
      }
    }
    this.phase = 'restart';
    this.phaseT = 0;
    if (this.cfg.humanSide === r.side) this.active = taker.idx;
    else if (this.cfg.humanSide >= 0) this.active = this.nearestTo(this.cfg.humanSide as Side, r.x, r.z, true);
  }

  private checkBounds(): void {
    const b = this.ball;
    const p = b.pos;
    if (b.held) return;
    const lastSide = (b.lastTouchSide < 0 ? 0 : b.lastTouchSide) as Side;
    const other = (lastSide === 0 ? 1 : 0) as Side;
    if (Math.abs(p.z) > HALF_W + BALL_R * 0.5) {
      this.goOut('throwin', other, clamp(p.x, -HALF_L + 1, HALF_L - 1), Math.sign(p.z) * HALF_W);
      return;
    }
    if (Math.abs(p.x) > HALF_L + BALL_R) {
      const gs = Math.sign(p.x);
      const scoring = (this.attackDir(0) === gs ? 0 : 1) as Side;
      if (Math.abs(p.z) < GOAL_W / 2 && p.y < GOAL_H) {
        this.goal(scoring);
        return;
      }
      const defending = (scoring === 0 ? 1 : 0) as Side;
      if (this.shotClock < 2.5 && Math.abs(p.z) < GOAL_W / 2 + 3) this.events.push({ type: 'ooh' });
      if (b.lastTouchSide === defending) {
        this.goOut('corner', scoring, gs * (HALF_L - 0.35), Math.sign(p.z || 1) * (HALF_W - 0.35));
      } else {
        this.goOut('goalkick', defending, gs * (HALF_L - SIX_DEPTH), Math.sign(p.z || 1) * (SIX_W / 2) * 0.55);
      }
    }
  }

  private goal(side: Side): void {
    this.score[side]++;
    const scorer = this.ball.lastTouch >= 0 ? this.players[this.ball.lastTouch] : this.bySide[side][10];
    const own = scorer.side !== side;
    // Same minute the scorebug shows (stoppage time stays on 45'/90').
    const minute = Math.min(this.minute(), this.half * 45);
    this.goals.push({ side, scorer: scorer.idx, name: scorer.def.name, minute, own });
    this.goalSide = side;
    this.lastGoalScorer = scorer.idx;
    this.phase = 'goal';
    this.phaseT = 0;
    this.passTarget = -1;
    this.ball.owner = -1;
    this.ball.held = false;
    this.events.push({ type: 'goal', side, scorer: scorer.idx, own });
    // The 3-4 nearest teammates mob the scorer; the rest jog over; the keeper stays home.
    const hero = own ? null : scorer;
    this.celebrants = hero
      ? this.bySide[side]
        .filter((p) => p !== hero && !p.isKeeper)
        .sort((a, b) => dist2(a.pos.x, a.pos.z, hero.pos.x, hero.pos.z) - dist2(b.pos.x, b.pos.z, hero.pos.x, hero.pos.z))
        .slice(0, 3 + this.rng.int(2))
        .map((p) => p.idx)
      : [];
    for (const p of this.players) {
      p.order = null;
      p.claiming = false;
      if (p.side === side) {
        p.setState('celebrate');
        p.celebrate = p === hero ? this.rng.int(4) : 4 + this.rng.int(2);
      } else if (!p.isKeeper || p.state !== 'dive') {
        // Conceding keeper included (unless mid-dive; he gets up first).
        p.setState('dejected');
      }
    }
  }

  private celebrants: number[] = [];

  private celebrate(): void {
    const scorer = this.lastGoalScorer >= 0 ? this.players[this.lastGoalScorer] : null;
    const hero = scorer && scorer.side === this.goalSide ? scorer : null;
    const cx = hero ? Math.sign(hero.pos.x || 1) * (HALF_L - 6) : 0;
    const cz = HALF_W - 5;
    const t = this.phaseT;
    for (const p of this.players) {
      p.faceTarget = null;
      if (p.isKeeper && p.side !== this.goalSide && (p.state === 'move' || p.state === 'hold')) p.setState('dejected');
      if (p.state === 'celebrate') {
        let tx: number;
        let tz: number;
        let fast = true;
        let stopR = 0.8;
        const mob = this.celebrants.indexOf(p.idx);
        if (p.isKeeper) {
          // Punches the air near his own goal.
          const gx = -this.attackDir(p.side) * (HALF_L - 4);
          tx = gx;
          tz = clamp(p.pos.z, -6, 6);
          fast = false;
        } else if (p === hero) {
          // Wheel away towards the corner, then slow so the mob can catch him.
          tx = cx;
          tz = cz;
          fast = t < 1.1;
          if (t > 1.6) {
            tx = p.pos.x;
            tz = p.pos.z;
          }
        } else if (hero && mob >= 0) {
          const a = (mob / Math.max(1, this.celebrants.length)) * Math.PI * 2 + t * 1.3;
          const near = dist2(p.pos.x, p.pos.z, hero.pos.x, hero.pos.z) < 2.2;
          tx = hero.pos.x + Math.cos(a) * (near ? 1.1 : 0.6);
          tz = hero.pos.z + Math.sin(a) * (near ? 1.1 : 0.6);
          stopR = 0.25;
          // Hop around the scorer once they get there.
          if (near && p.y === 0 && this.rng.chance(0.05)) {
            p.vy = 3;
            p.y = 0.01;
          }
        } else if (hero) {
          // Everyone else jogs over but gives the scorer room.
          const dx = p.pos.x - hero.pos.x;
          const dz = p.pos.z - hero.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          tx = hero.pos.x + (dx / d) * 5;
          tz = hero.pos.z + (dz / d) * 5;
          fast = false;
        } else {
          tx = p.pos.x;
          tz = p.pos.z;
        }
        const dx = tx - p.pos.x;
        const dz = tz - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > stopR) {
          const f = fast ? 1 : Math.min(1, d / 3) * 0.6;
          p.wantX = (dx / d) * f;
          p.wantZ = (dz / d) * f;
          p.sprint = fast;
        } else {
          p.wantX = p.wantZ = 0;
          p.sprint = false;
          p.faceTarget = hero && p !== hero ? Math.atan2(hero.pos.z - p.pos.z, hero.pos.x - p.pos.x) : Math.PI / 2;
        }
      } else if (p.state === 'dejected') {
        let tx: number;
        let tz: number;
        if (p.isKeeper) {
          // Trudge back and pick the ball out of the net.
          const b = this.ball.pos;
          tx = clamp(b.x, -HALF_L - 1.2, HALF_L + 1.2);
          tz = clamp(b.z, -GOAL_W / 2 + 0.5, GOAL_W / 2 - 0.5);
        } else {
          const ad = this.attackDir(p.side);
          tx = this.slots[p.side][p.slot].x * HALF_L * 0.5 * ad;
          tz = p.pos.z;
        }
        const dx = tx - p.pos.x;
        const dz = tz - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > (p.isKeeper ? 0.7 : 1)) {
          p.wantX = (dx / d) * 0.35;
          p.wantZ = (dz / d) * 0.35;
        } else {
          p.wantX = p.wantZ = 0;
          if (p.isKeeper) p.faceTarget = Math.atan2(this.ball.pos.z - p.pos.z, this.ball.pos.x - p.pos.x);
        }
        p.sprint = false;
      } else {
        p.wantX = p.wantZ = 0;
      }
    }
  }

  // ---------------------------------------------------------------- contact

  private separate(): void {
    const ps = this.players;
    const minD = PLAYER_R * 2;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        a.pos.x -= nx * push;
        a.pos.z -= nz * push;
        b.pos.x += nx * push;
        b.pos.z += nz * push;
      }
    }
    for (const p of ps) {
      p.pos.x = clamp(p.pos.x, -HALF_L - 5, HALF_L + 5);
      p.pos.z = clamp(p.pos.z, -HALF_W - 4, HALF_W + 4);
    }
  }

  private keepHeldBall(): void {
    const b = this.ball;
    if (!b.held || b.owner < 0) return;
    const k = this.players[b.owner];
    if (k.state === 'dive' || k.state === 'stand') {
      b.pos.x = k.pos.x + Math.cos(k.facing) * 0.3;
      b.pos.z = k.pos.z + Math.sin(k.facing) * 0.3;
      b.pos.y = k.y + 0.55;
      b.vel.x = b.vel.y = b.vel.z = 0;
      if (k.state === 'stand' && k.isKeeper) k.setState('hold');
    } else if (k.state === 'throw') {
      b.pos.x = k.pos.x + Math.cos(k.facing) * 0.15;
      b.pos.z = k.pos.z + Math.sin(k.facing) * 0.15;
      b.pos.y = k.isKeeper ? 1.5 : 2.15;
    } else if (!k.isKeeper) {
      // Throw-in: ball above the taker's head.
      b.pos.x = k.pos.x;
      b.pos.z = k.pos.z;
      b.pos.y = 2.15;
      b.vel.x = b.vel.y = b.vel.z = 0;
    }
  }

  private dribbleControl(): void {
    const b = this.ball;
    if (b.owner < 0 || b.held) return;
    const p = this.players[b.owner];
    if (p.state !== 'move' && p.state !== 'kick' && p.state !== 'celebrate') {
      b.owner = -1;
      return;
    }
    const sp = p.speed();
    // Push the ball on in rhythm with the stride when running.
    const pulse = sp > 3 ? Math.max(0, Math.sin(p.runPhase * Math.PI * 4)) * 0.16 * (sp / 8) : 0;
    const fx = p.footX() + Math.cos(p.facing) * pulse;
    const fz = p.footZ() + Math.sin(p.facing) * pulse;
    const ex = fx - b.pos.x;
    const ez = fz - b.pos.z;
    if (Math.hypot(ex, ez) > 1.9) {
      b.owner = -1;
      return;
    }
    const k = p.state === 'kick' ? 8 : 15;
    b.vel.x = p.vel.x + ex * k;
    b.vel.z = p.vel.z + ez * k;
    if (b.pos.y <= BALL_R + 0.02) b.vel.y = 0;
  }

  private checkPossession(): void {
    const b = this.ball;
    if (b.owner >= 0 || b.held || b.pos.y > 1.1) return;
    let best: Player | null = null;
    let bestD = Infinity;
    const hs = b.hspeed();
    // A ball just struck (or any shot) can only be blocked by someone it's actually heading at.
    const fresh = this.kickId > 0 &&
      (dist2(this.kickX, this.kickZ, b.pos.x, b.pos.z) < 3.8 || this.shotClock < 1.2);
    for (const p of this.players) {
      if (p.state !== 'move' || p.kickCooldown > 0) continue;
      if (p.order?.firstTime) continue;
      if (p.blockKick === this.kickId) continue;
      if (fresh && p.side !== this.kickSide && hs > 4) {
        const fx = p.footX() - b.pos.x;
        const fz = p.footZ() - b.pos.z;
        if (fx * b.vel.x + fz * b.vel.z < 0) continue;
      }
      const d = dist2(p.footX(), p.footZ(), b.pos.x, b.pos.z);
      if (d < p.controlRadius() && d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return;
    const rel = Math.hypot(b.vel.x - best.vel.x, b.vel.z - best.vel.z, b.vel.y);
    const trap = 16 + best.stat.dribbling * 0.1;
    // A ball struck past an opponent at close range (or any shot) is a block attempt, not a
    // clean take: either it cannons off them or it's gone past before they can react.
    if (fresh && best.side !== this.kickSide && hs > 7 && (rel > 9 || this.shotClock < 1.2)) {
      best.blockKick = this.kickId;
      const def = best.stat.defending / 100;
      const shot = this.shotClock < 1.2;
      const pBlock = shot ? 0.34 + def * 0.3 : 0.3 + def * 0.3;
      if (this.rng.chance(pBlock)) this.deflect(best, shot);
      return;
    }
    // Stretching to cut out a fast ball from wide inside your own box: often only a touch.
    if (best.side !== this.kickSide && !best.isKeeper && hs > 9 && Math.abs(this.kickZ) > HALF_W * 0.35 &&
      inOwnBox(this, best.side, b.pos.x, b.pos.z) && best.blockKick !== this.kickId) {
      best.blockKick = this.kickId;
      if (this.rng.chance(0.35)) {
        this.deflect(best, false);
        return;
      }
    }
    if (rel > trap) {
      // Heavy touch: it squirts off the player.
      b.vel.x = b.vel.x * 0.3 + best.vel.x * 0.4 + this.rng.gauss() * 2;
      b.vel.z = b.vel.z * 0.3 + best.vel.z * 0.4 + this.rng.gauss() * 2;
      b.vel.y = 1.2;
      b.lastTouch = best.idx;
      b.lastTouchSide = best.side;
      best.kickCooldown = 0.25;
      this.passTarget = -1;
      return;
    }
    this.takePossession(best);
  }

  /** `p` now has the ball at their feet. */
  private takePossession(p: Player): void {
    const b = this.ball;
    b.owner = p.idx;
    b.lastTouch = p.idx;
    b.lastTouchSide = p.side;
    this.passTarget = -1;
    // Take a touch and look up before the next decision (the AI times its first touch).
    p.ballT = 0;
    p.aiT = 0;
    p.aiMode = 'dribble';
    if (this.possessionSide !== p.side) this.sincePossession = 0;
    this.possessionSide = p.side;
    this.events.push({ type: 'control', player: p.idx });
    if (this.cfg.humanSide === p.side && !p.isKeeper) this.active = p.idx;
  }

  /** The ball cannons off `p`: a blocked pass or shot, sometimes behind for a corner. */
  private deflect(p: Player, shot: boolean): void {
    const b = this.ball;
    const sp = b.hspeed();
    const gxOwn = -this.attackDir(p.side) * HALF_L;
    const nearLine = Math.abs(b.pos.x - gxOwn) < 22;
    const cross = Math.abs(this.kickZ) > HALF_W * 0.35 && this.kickKind !== 'shot';
    if (nearLine && (shot || cross) && this.rng.chance(shot ? 0.4 : 0.55)) {
      // Blocked cross or shot near our goal: it loops up and off behind the byline.
      const ns = 7 + this.rng.next() * 7;
      const zs = Math.sign(b.pos.z || 1) * (0.2 + this.rng.next() * 0.6);
      const xs = Math.sign(gxOwn - b.pos.x) || 1;
      const l = Math.hypot(1, zs);
      b.vel.x = (xs / l) * ns;
      b.vel.z = (zs / l) * ns;
      b.vel.y = 3 + this.rng.next() * 3.5;
    } else {
      const heading = Math.atan2(b.vel.z, b.vel.x);
      const turn = (this.rng.chance(0.5) ? 1 : -1) * (0.35 + this.rng.next() * (shot ? 1.5 : 2.3));
      const ns = sp * (0.25 + this.rng.next() * (shot ? 0.45 : 0.3));
      b.vel.x = Math.cos(heading + turn) * ns;
      b.vel.z = Math.sin(heading + turn) * ns;
      b.vel.y = 0.8 + this.rng.next() * (shot ? 4.5 : 3);
    }
    b.spin.x = b.spin.y = b.spin.z = 0;
    b.lastTouch = p.idx;
    b.lastTouchSide = p.side;
    p.kickCooldown = 0.28;
    this.passTarget = -1;
    this.events.push({ type: 'block', by: p.idx, shot, x: b.pos.x, z: b.pos.z });
    if (shot) this.events.push({ type: 'ooh' });
  }

  private checkKeeperHands(): void {
    const b = this.ball;
    if (b.held) return;
    for (const s of [0, 1] as Side[]) {
      const k = this.bySide[s][0];
      if ((k.state !== 'move' && k.state !== 'dive') || k.kickCooldown > 0) continue;
      if (!inOwnBox(this, s, k.pos.x, k.pos.z) || b.owner === k.idx) continue;
      // A keeper can smother a dribbler who gets too close.
      if (b.owner >= 0) {
        const c = this.players[b.owner];
        if (c.side !== s && dist2(k.pos.x, k.pos.z, b.pos.x, b.pos.z) < 0.9 && this.rng.chance(0.08 + (k.stat.keeping / 100) * 0.1)) {
          this.catchBall(k, false);
        }
        continue;
      }
      // Don't handle your own teammate's back-pass.
      if (b.lastTouchSide === s && this.shotClock > 1 && b.lastTouch !== k.idx && b.pos.y < 0.6) continue;
      const diving = k.state === 'dive';
      const claiming = k.claiming && !diving;
      const hx = k.pos.x;
      const hz = k.pos.z;
      const hy = diving ? k.y + 0.7 : claiming ? 1.55 + k.y : 1.1;
      const dh = dist2(hx, hz, b.pos.x, b.pos.z);
      const dy = Math.abs(b.pos.y - hy);
      const keeping = k.stat.keeping / 100;
      const reachH = (diving ? 0.82 : claiming ? 0.92 : 0.72) + keeping * 0.2 + this.keeperBonus(s);
      const reachV = diving ? 1.1 : claiming ? 1.4 : 1.45;
      if (dh < reachH && dy < reachV && b.pos.y < GOAL_H + (claiming ? 0.7 : 0.3)) {
        const speed = b.speed();
        const onFrame = this.shotClock < 2 && this.shotSide !== s;
        if (claiming && !onFrame) {
          this.claimCross(k);
          continue;
        }
        const catchLimit = 11 + keeping * 13 + this.keeperBonus(s) * 20;
        // Diving saves are mostly parries; balls straight at the keeper get held.
        const pCatch = speed < catchLimit ? (0.55 + keeping * 0.4) * (diving ? 0.45 : 1) : 0;
        if (this.rng.chance(pCatch)) {
          this.catchBall(k, onFrame);
        } else {
          this.parry(k, onFrame);
        }
      }
    }
  }

  /** Keeper meets a cross: catch it cleanly, or punch when an attacker is challenging. */
  private claimCross(k: Player): void {
    const b = this.ball;
    k.claiming = false;
    let rival = Infinity;
    for (const o of this.bySide[k.side === 0 ? 1 : 0]) rival = Math.min(rival, dist2(o.pos.x, o.pos.z, b.pos.x, b.pos.z));
    const keeping = k.stat.keeping / 100;
    const pCatch = (rival < 1.4 ? 0.35 : 0.85) * (0.7 + keeping * 0.3);
    if (this.rng.chance(pCatch)) {
      this.catchBall(k, false, false);
      this.events.push({ type: 'claim', keeper: k.idx, caught: true });
      return;
    }
    const ad = this.attackDir(k.side);
    const zs = Math.sign(b.pos.z) || (this.rng.chance(0.5) ? 1 : -1);
    b.vel.x = ad * (10 + this.rng.next() * 6);
    b.vel.z = zs * (2 + this.rng.next() * 6);
    b.vel.y = 4 + this.rng.next() * 2.5;
    b.spin.x = b.spin.y = b.spin.z = 0;
    b.lastTouch = k.idx;
    b.lastTouchSide = k.side;
    k.kickCooldown = 0.6;
    this.passTarget = -1;
    this.kickId++;
    this.sinceKick = 0;
    this.kickX = b.pos.x;
    this.kickZ = b.pos.z;
    this.kickSide = k.side;
    this.events.push({ type: 'claim', keeper: k.idx, caught: false }, { type: 'kick', power: 0.6, x: b.pos.x, y: b.pos.y, z: b.pos.z, kind: 'clear' });
  }

  /** Keeper gets a hand to it without holding on: back into play, or tipped behind. */
  private parry(k: Player, onFrame: boolean): void {
    const b = this.ball;
    const s = k.side;
    const ad = this.attackDir(s);
    const hw = GOAL_W / 2;
    const sp = b.speed();
    const vx0 = b.vel.x;
    const vy0 = b.vel.y;
    const vz0 = b.vel.z;
    let tipped = false;
    if (onFrame && this.rng.chance(0.45 + Math.min(0.2, (Math.abs(b.pos.z) / hw) * 0.2) + (sp > 24 ? 0.1 : 0))) {
      // Tip it round the post or over the bar.
      if (Math.abs(b.pos.z) < 1.3 || b.pos.y > 1.7) {
        b.vel.x = -ad * (2.5 + this.rng.next() * 2);
        b.vel.y = 7 + this.rng.next() * 2.5;
        b.vel.z = vz0 * 0.3;
      } else {
        b.vel.x = -ad * (1.5 + this.rng.next() * 2);
        b.vel.y = 1.5 + this.rng.next() * 2.5;
        b.vel.z = Math.sign(b.pos.z) * (7 + this.rng.next() * 4);
      }
      b.spin.x = b.spin.y = b.spin.z = 0;
      tipped = !onTarget(this, s === 0 ? 1 : 0);
      if (!tipped) {
        b.vel.x = vx0;
        b.vel.y = vy0;
        b.vel.z = vz0;
      }
    }
    if (!tipped) {
      // Parry away from goal.
      b.vel.x = Math.abs(b.vel.x) * 0.25 * ad + ad * 2.5;
      b.vel.z = b.vel.z * 0.3 + (Math.sign(b.pos.z - k.pos.z) || (this.rng.chance(0.5) ? 1 : -1)) * (3 + this.rng.next() * 5);
      b.vel.y = 2 + this.rng.next() * 3.5;
      b.spin.x = b.spin.y = b.spin.z = 0;
    }
    b.lastTouch = k.idx;
    b.lastTouchSide = s;
    k.kickCooldown = 0.6;
    this.passTarget = -1;
    if (onFrame) {
      this.stats.saves[s]++;
      this.events.push({ type: 'save', keeper: k.idx, caught: false });
    }
  }

  private catchBall(k: Player, save: boolean, emit = true): void {
    const b = this.ball;
    k.claiming = false;
    b.owner = k.idx;
    b.held = true;
    b.vel.x = b.vel.y = b.vel.z = 0;
    b.lastTouch = k.idx;
    b.lastTouchSide = k.side;
    this.passTarget = -1;
    this.possessionSide = k.side;
    if (k.state !== 'dive') k.setState('hold');
    this.keeperHoldTime = 1.1 + this.rng.next() * 1.1;
    if (save) this.stats.saves[k.side]++;
    if (emit) this.events.push({ type: 'save', keeper: k.idx, caught: true });
  }

  startSlide(p: Player): void {
    if (p.state !== 'move' || p.isKeeper) return;
    p.setState('slide');
    const sp = Math.max(p.speed(), 5) + 2.2;
    p.vel.x = Math.cos(p.facing) * sp;
    p.vel.z = Math.sin(p.facing) * sp;
    p.slideHit = false;
    p.tackleCooldown = 1.2;
    p.order = null;
    this.events.push({ type: 'tackle', by: p.idx, won: false, slide: true });
  }

  private checkSlides(): void {
    const b = this.ball;
    for (const p of this.players) {
      if (p.state !== 'slide' || p.stateT > 0.5) continue;
      const tipX = p.pos.x + Math.cos(p.facing) * 0.75;
      const tipZ = p.pos.z + Math.sin(p.facing) * 0.75;
      if (!p.slideHit && !b.held && b.pos.y < 0.7 && b.owner !== p.idx && dist2(tipX, tipZ, b.pos.x, b.pos.z) < 0.85) {
        const prev = b.owner;
        b.owner = -1;
        const sp = 6 + this.rng.next() * 3;
        b.vel.x = Math.cos(p.facing) * sp + this.rng.gauss() * 1.5;
        b.vel.z = Math.sin(p.facing) * sp + this.rng.gauss() * 1.5;
        b.vel.y = 0.8;
        b.lastTouch = p.idx;
        b.lastTouchSide = p.side;
        p.slideHit = true;
        this.passTarget = -1;
        if (prev >= 0) {
          const c = this.players[prev];
          c.kickCooldown = 0.5;
          if (c.side !== p.side && dist2(c.pos.x, c.pos.z, p.pos.x, p.pos.z) < 1.5) c.setState('fallen');
        }
        this.stats.tackles[p.side]++;
        this.events.push({ type: 'tackle', by: p.idx, won: true, slide: true });
        continue;
      }
      if (p.slideHit) continue;
      for (const c of this.players) {
        if (c.side === p.side || c.state !== 'move') continue;
        if (dist2(tipX, tipZ, c.pos.x, c.pos.z) < 0.7) {
          c.setState('fallen');
          p.slideHit = true;
          const hadBall = b.owner === c.idx || dist2(c.pos.x, c.pos.z, b.pos.x, b.pos.z) < 2;
          if (hadBall) this.foul(p, c);
          break;
        }
      }
    }
  }

  private foul(by: Player, on: Player): void {
    this.stats.fouls[by.side]++;
    const inBox = inOwnBox(this, by.side, on.pos.x, on.pos.z);
    this.events.push({ type: 'foul', by: by.idx, on: on.idx, penalty: inBox });
    if (inBox) {
      const ad = this.attackDir(on.side);
      this.goOut('penalty', on.side, ad * (HALF_L - PEN_SPOT), 0);
    } else {
      this.goOut('freekick', on.side, clamp(on.pos.x, -HALF_L + 1, HALF_L - 1), clamp(on.pos.z, -HALF_W + 1, HALF_W - 1));
    }
  }

  tryTackle(p: Player, c: Player, aggression: number): void {
    if (p.tackleCooldown > 0 || p.state !== 'move') return;
    p.tackleCooldown = 0.55;
    const b = this.ball;
    if (b.owner !== c.idx) return;
    if (dist2(p.footX(), p.footZ(), b.pos.x, b.pos.z) > 1.15) return;
    const def = p.stat.defending / 100;
    const drib = c.stat.dribbling / 100;
    const tb = Math.atan2(b.pos.z - p.pos.z, b.pos.x - p.pos.x);
    const facing = (Math.cos(tb - p.facing) + 1) / 2;
    // The carrier's body between tackler and ball (shielding) makes it harder and riskier.
    const bx = b.pos.x - c.pos.x;
    const bz = b.pos.z - c.pos.z;
    const tx = p.pos.x - c.pos.x;
    const tz = p.pos.z - c.pos.z;
    const bl = Math.hypot(bx, bz) || 1;
    const tl = Math.hypot(tx, tz) || 1;
    const shielded = clamp((-(bx * tx + bz * tz) / (bl * tl) - 0.1) / 0.7, 0, 1);
    // Coming from behind: the carrier is facing away from the tackler.
    const behind = clamp(-(Math.cos(c.facing) * tx + Math.sin(c.facing) * tz) / tl, 0, 1);
    const skill = this.isHumanControlled(p) ? 2.6 : this.aiSkill(p.side);
    let chance = clamp(0.42 + (def - drib) * 0.6 + (c.sprint ? 0.06 : 0), 0.12, 0.75) * (0.6 + 0.4 * facing) * aggression;
    chance *= (1 - shielded * 0.4) * (0.84 + skill * 0.06);
    if (this.isHumanControlled(p)) chance *= 1.2;
    if (this.isHumanControlled(c)) chance *= 0.85;
    if (this.rng.chance(chance)) {
      this.stats.tackles[p.side]++;
      this.events.push({ type: 'tackle', by: p.idx, won: true, slide: false });
      c.kickCooldown = 0.45;
      if (this.rng.chance(0.35 + def * 0.3)) {
        // Clean: the tackler comes away with it.
        p.kickCooldown = 0;
        b.vel.x = p.vel.x;
        b.vel.z = p.vel.z;
        this.takePossession(p);
        return;
      }
      b.owner = -1;
      const dx = b.pos.x - c.pos.x;
      const dz = b.pos.z - c.pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      const sp = 3 + this.rng.next() * 4;
      b.vel.x = ((dx / dl) * 0.5 + Math.cos(p.facing) * 0.5) * sp + this.rng.gauss();
      b.vel.z = ((dz / dl) * 0.5 + Math.sin(p.facing) * 0.5) * sp + this.rng.gauss();
      // On the flank, a poke tackle often just knocks it into touch.
      if (Math.abs(c.pos.z) > HALF_W - 6 && this.rng.chance(0.45)) b.vel.z += Math.sign(c.pos.z) * (3 + this.rng.next() * 3);
      b.lastTouch = p.idx;
      b.lastTouchSide = p.side;
      p.kickCooldown = 0.12;
      this.passTarget = -1;
    } else {
      p.tackleCooldown = 1.1;
      p.vel.x *= 0.35;
      p.vel.z *= 0.35;
      this.events.push({ type: 'tackle', by: p.idx, won: false, slide: false });
      // Mistimed: clipping the carrier from behind or through their back is a foul.
      const inBox = inOwnBox(this, p.side, c.pos.x, c.pos.z);
      const pFoul = (0.018 + behind * 0.08 + shielded * 0.04 + (c.speed() > 5 ? 0.02 : 0)) * (inBox ? 0.5 : 1);
      if (this.rng.chance(pFoul)) {
        c.setState('fallen');
        this.foul(p, c);
      }
    }
  }

  /** `p` has wrong-footed `o` with a feint / change of pace. */
  beatDefender(p: Player, o: Player): void {
    o.slowT = this.isHumanControlled(o) ? 0.45 : 0.7;
    o.commitT = 0;
    o.jockeyT = 0;
    o.tackleCooldown = Math.max(o.tackleCooldown, 0.6);
    this.events.push({ type: 'beat', by: p.idx, on: o.idx });
  }

  /** A human dribbler cutting sharply past a close defender can wrong-foot him too. */
  private humanCuts(): void {
    const hs = this.cfg.humanSide;
    const b = this.ball;
    if (hs < 0 || b.owner !== this.active || b.held) return;
    const p = this.players[this.active];
    const sp = p.speed();
    const ang = Math.atan2(p.vel.z, p.vel.x);
    const turn = Math.abs(angleDiff(this.cutAng, ang));
    this.cutAng += angleDiff(this.cutAng, ang) * 0.15;
    if (sp < 3.5 || turn < 0.9 || this.cutKick === this.kickId + p.idx * 1e5 + Math.floor(this.clock * 2)) return;
    this.cutKick = this.kickId + p.idx * 1e5 + Math.floor(this.clock * 2);
    for (const o of this.bySide[hs === 0 ? 1 : 0]) {
      if (o.isKeeper || o.slowT > 0 || o.state !== 'move') continue;
      if (dist2(o.pos.x, o.pos.z, p.pos.x, p.pos.z) > 2.6) continue;
      const pWin = clamp(0.3 + (p.stat.dribbling - o.stat.defending) / 100 * 0.9 - (this.aiSkill(o.side) - 2) * 0.04, 0.12, 0.6);
      if (this.rng.chance(pWin)) this.beatDefender(p, o);
      break;
    }
  }

  private cutAng = 0;
  private cutKick = -1;
  /** A human set-piece delivery pressed while the box was still filling. */
  private queuedKick: (() => void) | null = null;

  /** The human's player tackles automatically when they run into the carrier. */
  private autoTackle(): void {
    if (this.cfg.humanSide < 0 || this.active < 0) return;
    const p = this.players[this.active];
    const b = this.ball;
    if (b.owner < 0 || b.held) return;
    const c = this.players[b.owner];
    if (c.side === p.side) return;
    if (dist2(p.footX(), p.footZ(), b.pos.x, b.pos.z) < 1.0) this.tryTackle(p, c, 1);
  }

  drainEvents(): MatchEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
