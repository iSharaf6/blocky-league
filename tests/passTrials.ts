import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';

/**
 * Pass trials in real open play, the way the owner and his testers play (2026-09-30: "a player is running and then
 * i pass it and the ball is behind him but it doesnt get attached to him"). Not a staged drill: whole matches
 * against the normal AI, and whenever our man has the ball he runs with it, then taps PASS at a team-mate who is
 * on the move (keys: eight directions, aimed roughly), and after the tap KEEPS HOLDING a key the way a person does:
 *
 *  - 'keep'  the key he was running with before the pass (the commonest: he never lets go);
 *  - 'run'   the receiver's own run direction (he steers the new man on with his run);
 *  - 'none'  nothing (he lets go and waits);
 *  - 'back'  towards the passer (he tries to come to the ball).
 *
 * Every pass is scored by who touches the ball next: the man it was played to ('got'), another of ours, one of
 * theirs ('cut'), or nobody before it went dead ('dead'). A NEAR miss is the frustrating one: the ball came
 * within NEAR_M of the receiver's body at ground height, and he still didn't get it.
 */
export type Hold = 'keep' | 'run' | 'none' | 'back';

export interface PassTrial {
  seed: number;
  hold: Hold;
  kind: string;
  dist: number;
  /** The receiver's speed (m/s) at the moment of the pass. */
  runSpeed: number;
  /** Angle (deg) between the receiver's run and the pass's line (0: running straight on away from the passer). */
  runAngle: number;
  outcome: 'got' | 'mate' | 'cut' | 'dead' | 'dropped' | 'offside';
  /** Closest the ball came to the receiver's body (m) while under 1 m high, before anyone touched it. */
  closest: number;
  /** At that closest moment: was the ball behind him (relative to his facing)? */
  behind: boolean;
  /** Diagnostics at the closest moment: locked on, his man (human controlled), state, ball speed / height. */
  diag?: string;
  /** Who touched it (idx) when it ended, and the frames since the kick. */
  by?: number;
  trace?: string[];
}

export const NEAR_M = 2.2;
/** Harness counters (debugging the harness itself). */
export const dbg = { carries: 0, taps: 0, kicks: 0, humanKicks: 0, gifts: 0, noCand: 0, playFrames: 0, lost: 0, phases: {} as Record<string, number>, carryEnds: [] as string[] };

/** A key press: the direction snapped to eight ways (a keyboard), unit or diagonal. */
function keys(x: number, z: number): { mx: number; mz: number } {
  const a = Math.round(Math.atan2(z, x) / (Math.PI / 4)) * (Math.PI / 4);
  return { mx: Math.round(Math.cos(a) * 1000) / 1000, mz: Math.round(Math.sin(a) * 1000) / 1000 };
}

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

type Live = PassTrial & { target: number; passer: number; t: number; keepT?: number };
/** Per-frame traces of the approach (debugging): off unless set. */
export let traceOn = false;
export function setTrace(on: boolean): void {
  traceOn = on;
}

function close(t: Live, outcome: PassTrial['outcome']): PassTrial {
  const { target: _t, passer: _p, t: _tt, keepT: _k, ...rest } = t;
  return { ...rest, outcome };
}

export function runPassTrials(seed: number, hold: Hold, seconds = 150, difficulty = 1.8): PassTrial[] {
  // One long half (the harness doesn't play the half-time break): `seconds` of match time.
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[seed % PRESET_CLUBS.length]), away: makeTeam(PRESET_CLUBS[(seed + 5) % PRESET_CLUBS.length]),
    halfLength: 1200, difficulty, humanSide: 0, seed,
  });
  const rnd = lcg(seed * 7919 + hold.length * 31);
  const out: PassTrial[] = [];
  const ad = () => m.attackDir(0);
  let carrying = false;
  let carryT = 0;
  let carryFor = 0;
  let runKey = { mx: 0, mz: 0 };
  let tapLeft = 0;
  let trial = null as Live | null;
  let sinceOurs = 0;
  let sprintCarry = false;
  let tapThrough = false;
  let lastKick = m.kickId;
  const mm = m as unknown as { humanPassKick: number; kickKind: string };
  /** Step, and open a trial on a new pass of the human's (the kick lands a few frames after the tap). */
  const step = (pad: Pad): void => {
    m.step(DT, pad);
    if (m.phase === 'play') dbg.playFrames++;
    dbg.phases[m.phase] = (dbg.phases[m.phase] ?? 0) + 1;
    if (m.kickId === lastKick) return;
    lastKick = m.kickId;
    dbg.kicks++;
    if (mm.humanPassKick === m.kickId) dbg.humanKicks++;
    if (trial || m.phase !== 'play' || m.ball.owner >= 0) return;
    const k = m.ball.lastTouch;
    if (k < 0 || m.players[k].side !== 0 || mm.humanPassKick !== m.kickId) return;
    if (mm.kickKind !== 'pass' && mm.kickKind !== 'through') return;
    const t = m.passTarget;
    if (t < 0 || t === k || m.players[t].side !== 0) return;
    const me = m.players[k];
    const r = m.players[t];
    const d = Math.hypot(r.pos.x - me.pos.x, r.pos.z - me.pos.z);
    const sp = Math.hypot(r.vel.x, r.vel.z);
    const lx = (r.pos.x - me.pos.x) / d, lz = (r.pos.z - me.pos.z) / d;
    const runAngle = sp > 0.3 ? (Math.acos(Math.max(-1, Math.min(1, (r.vel.x * lx + r.vel.z * lz) / sp))) * 180) / Math.PI : -1;
    trial = { seed, hold, kind: mm.kickKind, dist: Math.round(d * 10) / 10, runSpeed: Math.round(sp * 10) / 10, runAngle: Math.round(runAngle), outcome: 'dead', closest: 99, behind: false, target: t, passer: k, t: 0 };
    tapLeft = 0;
  };
  const frames = Math.round(seconds / DT);
  for (let f = 0; f < frames && m.phase !== 'fulltime' && m.phase !== 'halftime'; f++) {
    let pad: Pad = { ...EMPTY_PAD, digital: true };
    // The session ends a goal's celebration (the harness has no session): after 3 s, the kick-off.
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    if (m.phase !== 'play') {
      // Restarts: a quick tap so play goes on.
      pad.pass = f % 40 === 0;
      if (trial) {
        const pr = (m as unknown as { pendingRestart: { kind: string; indirect?: boolean } | null }).pendingRestart ?? m.restart;
        trial.diag = `WHISTLE ${m.phase} ${pr?.kind ?? ''}${pr?.indirect ? ' (offside)' : ''} ` + (trial.diag ?? '');
        out.push(close(trial, pr?.indirect ? 'offside' : 'dead'));
      }
      trial = null;
      carrying = false;
      step(pad);
      continue;
    }
    const cur = trial as Live | null;
    if (cur) {
      const b = m.ball;
      const r = m.players[cur.target];
      if (traceOn && cur.keepT === undefined && (cur.trace?.length ?? 0) > 0 && (cur.trace?.length ?? 0) < 30) {
        const d = Math.hypot(b.pos.x - r.pos.x, b.pos.z - r.pos.z);
        const ev = m.events.map((e) => e.type + ('kind' in e ? ':' + String(e.kind) : '')).join(',');
        cur.trace!.push(`  +d=${d.toFixed(2)} y=${b.pos.y.toFixed(2)} vy=${b.vel.y.toFixed(1)} bs=${b.hspeed().toFixed(1)} own=${b.owner} last=${b.lastTouch} pt=${m.passTarget} ph=${m.phase} ev=[${ev}] st=${r.state}`);
      }
      if (b.pos.y < 1 && cur.keepT === undefined) {
        const d = Math.hypot(b.pos.x - r.pos.x, b.pos.z - r.pos.z);
        if (d < 3.2 && traceOn && (cur.trace?.length ?? 0) === 0) {
          const mx = m as unknown as { receiveLocked(p: Player): boolean; lockSeen: unknown; sinceKick: number; kickId: number };
          const rec = (b.pos.x - r.pos.x) * (b.vel.x - r.vel.x) + (b.pos.z - r.pos.z) * (b.vel.z - r.vel.z) >= 0;
          (cur.trace ??= []).push(`d=${d.toFixed(2)} rec=${rec ? 1 : 0} lock=${mx.receiveLocked(r) ? 1 : 0} pt=${m.passTarget} tgt=${r.idx} own=${b.owner} seen=${JSON.stringify(mx.lockSeen)} sk=${mx.sinceKick.toFixed(2)} kid=${mx.kickId} lts=${b.lastTouchSide} y=${b.pos.y.toFixed(2)} st=${r.state} cd=${r.kickCooldown.toFixed(2)}`);
        }
        if (d < cur.closest) {
          cur.closest = Math.round(d * 100) / 100;
          cur.behind = (b.pos.x - r.pos.x) * Math.cos(r.facing) + (b.pos.z - r.pos.z) * Math.sin(r.facing) < 0;
          const mx = m as unknown as { receiveLocked(p: Player): boolean; magnetFor(p: Player): boolean; ctl: { active: number }[] };
          cur.diag = `lock=${mx.receiveLocked(r) ? 1 : 0} mag=${mx.magnetFor(r) ? 1 : 0} act=${mx.ctl[0].active === r.idx ? 1 : 0} pt=${m.passTarget === r.idx ? 1 : 0} st=${r.state} cd=${r.kickCooldown.toFixed(2)} bs=${b.hspeed().toFixed(1)} by=${b.pos.y.toFixed(2)} rs=${Math.hypot(r.vel.x, r.vel.z).toFixed(1)} foot=${Math.hypot(r.footX() - b.pos.x, r.footZ() - b.pos.z).toFixed(2)} cr=${r.controlRadius().toFixed(2)} t=${cur.t.toFixed(2)}`;
        }
      }
      if (hold === 'keep') pad = { ...pad, ...runKey };
      else if (hold === 'run') {
        const s = Math.hypot(r.vel.x, r.vel.z);
        pad = { ...pad, ...(s > 0.5 ? keys(r.vel.x, r.vel.z) : runKey) };
      } else if (hold === 'back') {
        const p = m.players[cur.passer];
        pad = { ...pad, ...keys(p.pos.x - r.pos.x, p.pos.z - r.pos.z) };
      }
      cur.t += DT;
      const own = b.owner;
      let done: PassTrial['outcome'] | null = null;
      if (cur.keepT !== undefined) {
        // Taken: still his 0.4 s on ('got'), or it came straight off him ('dropped')?
        cur.keepT -= DT;
        if (own !== cur.target && !(own < 0 && b.lastTouch === cur.target && Math.hypot(b.pos.x - r.pos.x, b.pos.z - r.pos.z) < 1.9)) {
          done = 'dropped';
          cur.diag = `DROP after ${(0.4 - cur.keepT).toFixed(2)}s own=${own} last=${b.lastTouch} st=${r.state} foot=${Math.hypot(r.footX() - b.pos.x, r.footZ() - b.pos.z).toFixed(2)} body=${Math.hypot(r.pos.x - b.pos.x, r.pos.z - b.pos.z).toFixed(2)} bs=${b.hspeed().toFixed(1)} rs=${Math.hypot(r.vel.x, r.vel.z).toFixed(1)} phase=${m.phase} ` + (cur.diag ?? '');
        }
        else if (cur.keepT <= 0) done = 'got';
      } else if (own === cur.target) cur.keepT = 0.4;
      else if (own >= 0) done = m.players[own].side === 0 ? 'mate' : 'cut';
      else if (b.lastTouch >= 0 && b.lastTouch !== cur.passer && b.lastTouch !== cur.target) done = m.players[b.lastTouch].side === 0 ? 'mate' : 'cut';
      else if (cur.t > 4.5) done = 'dead';
      if (done === null && cur.keepT === undefined && b.lastTouch === cur.target && own < 0 && cur.t > 0.1) cur.keepT = 0.4;
      if (done) {
        cur.by = own >= 0 ? own : b.lastTouch;
        out.push(close(cur, done));
        trial = null;
        carrying = false;
      }
      step(pad);
      continue;
    }
    const me = m.active >= 0 ? m.players[m.active] : null;
    if (me && m.ball.owner === me.idx && me.side === 0 && !me.isKeeper) {
      if (!carrying) {
        dbg.carries++;
        carrying = true;
        carryT = 0;
        carryFor = 0.15 + rnd() * 0.6;
        sprintCarry = rnd() < 0.5;
        runKey = keys(ad(), (rnd() - 0.5) * 1.4);
      }
      carryT += DT;
      pad = { ...pad, ...runKey, sprint: sprintCarry };
      if (tapLeft > 0) {
        tapLeft--;
        pad.pass = !tapThrough;
        pad.through = tapThrough;
        const aimKeep = trialAim;
        pad.mx = aimKeep.mx;
        pad.mz = aimKeep.mz;
      } else if (carryT > carryFor) {
        // A team-mate on the move, 8-30 m away, not far behind the passer.
        const mates = m.teamPlayers(0).filter((p: Player) => p !== me && !p.isKeeper && !p.sentOff);
        const cands = mates.filter((p) => {
          const d = Math.hypot(p.pos.x - me.pos.x, p.pos.z - me.pos.z);
          const s = Math.hypot(p.vel.x, p.vel.z);
          return d > 8 && d < 30 && s > 2.5 && (p.pos.x - me.pos.x) * ad() > -6 && Math.abs(p.pos.x) < HALF_L - 3 && Math.abs(p.pos.z) < HALF_W - 1;
        });
        if (cands.length) {
          const t = cands[Math.floor(rnd() * cands.length)];
          const a = Math.atan2(t.pos.z - me.pos.z, t.pos.x - me.pos.x) + (rnd() - 0.5) * 0.7;
          trialAim = keys(Math.cos(a), Math.sin(a));
          tapThrough = rnd() < 0.3;
          dbg.taps++;
          pad = { ...pad, ...trialAim, pass: !tapThrough, through: tapThrough };
          tapLeft = 1;
        } else {
          dbg.noCand++;
          carryFor = carryT + 0.5;
        }
      }
      step(pad);
      continue;
    }
    if (carrying && dbg.carryEnds.length < 30) dbg.carryEnds.push(`${carryT.toFixed(2)}/${carryFor.toFixed(2)} own=${m.ball.owner} act=${m.active} st=${me?.state}`);
    // Off the ball: our man drifts towards the ball (a casual defender) and taps TACKLE when close. If our side
    // hasn't had it for a while, it's given to our man nearest the ball (more trials per match; the rest of
    // the match, and every run our team-mates make, is the real thing).
    carrying = false;
    const ours = m.ball.owner >= 0 && m.players[m.ball.owner].side === 0;
    sinceOurs = ours ? 0 : sinceOurs + DT;
    if (sinceOurs > 5 && m.phase === 'play') {
      const b = m.ball.pos;
      let best: Player | null = null;
      for (const p of m.teamPlayers(0)) {
        if (p.isKeeper || p.sentOff) continue;
        if (!best || Math.hypot(p.pos.x - b.x, p.pos.z - b.z) < Math.hypot(best.pos.x - b.x, best.pos.z - b.z)) best = p;
      }
      if (best && Math.abs(best.pos.x) < HALF_L - 8 && Math.abs(best.pos.z) < HALF_W - 3) {
        m.ball.reset(best.footX(), best.footZ());
        m.ball.owner = best.idx;
        m.ball.lastTouch = best.idx;
        m.ball.lastTouchSide = 0;
        (m as unknown as { ctl: { active: number }[] }).ctl[0].active = best.idx;
        m.passTarget = -1;
        sinceOurs = 0;
        dbg.gifts++;
      }
    }
    if (me) {
      const b = m.ball.pos;
      const dx = b.x - me.pos.x, dz = b.z - me.pos.z;
      if (Math.hypot(dx, dz) > 1) pad = { ...pad, ...keys(dx, dz) };
      if (m.ball.owner >= 0 && m.players[m.ball.owner].side === 1 && Math.hypot(dx, dz) < 2.2) pad.shoot = f % 20 === 0;
    }
    step(pad);
  }
  return out;
}
let trialAim = { mx: 0, mz: 0 };

export function summarise(list: PassTrial[]): string {
  const n = list.length;
  const c = (o: PassTrial['outcome']) => list.filter((t) => t.outcome === o).length;
  const near = list.filter((t) => t.outcome !== 'got' && t.closest < NEAR_M);
  const nearBehind = near.filter((t) => t.behind).length;
  const pct = (k: number) => `${k} (${n ? Math.round((100 * k) / n) : 0}%)`;
  return `n=${n} got=${pct(c('got'))} dropped=${pct(c('dropped'))} mate=${pct(c('mate'))} cut=${pct(c('cut'))} dead=${pct(c('dead'))} | NEAR-MISS ${pct(near.length)} (ball behind him ${nearBehind})`;
}
