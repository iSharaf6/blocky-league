/**
 * Blitz mode: power-up pickups on the pitch (MatchConfig.mode === 'blitz'). Everything the mode does lives
 * here; the rest of the sim only calls in through a handful of one-line hooks, each guarded by the mode
 * (classic matches never reach this file, so they stay bit-identical):
 *
 *   Match.step            -> blitzStep      (pickups, collection, timers, uses, Player.boost, the brace)
 *   Match.endHalf         -> blitzClear     (a held power-up and any effect end with the half)
 *   Match.goal            -> blitzGoal      (golden: the scoring side's goal counts double)
 *   Match.tryTackle       -> blitzTackle    (shield / freeze: the challenge bounces off; magnet: cleaner contact)
 *   Match.startSlide      -> blitzNoSlide   (a frozen man can't go to ground; nobody slides a shielded carrier)
 *   Match.checkKeeperHands-> megaHands      (a mega shot knocks the keeper back and is never held; a brace parries)
 *   keeper.ts dive        -> blitzDive      (a frozen keeper's dive is FREEZE_DIVE of its pace and reach)
 *   actions.resolveKick   -> megaLaunch     (the armed side's next open-play shot is a rocket, after the telegraph)
 *   Player.locomote / controlRadius read Player.boost (TURBO_PACE, FREEZE_PACE, MAGNET_CONTROL_R).
 *
 * For the render / HUD:
 *   - PowerUp.t is seconds since the cube became collectable: it starts at -MATERIALISE (the powerupSpawn event
 *     fires at once, so the cube can pop in), nobody can take it while t < 0, and it fades at PICKUP_LIFE.
 *   - Match.goldenSide is the side whose next goal counts double (-1: none): gild the ball, show "x2".
 *   - Player.boost === 'mega' from the press: the ball is red-hot for MEGA_TELEGRAPH s before the rocket can be
 *     struck (a shot inside the telegraph is an ordinary one and leaves the mega armed).
 *   - The human's keeper braces for a rocket while the human holds TACKLE (SHOOT) off the ball: half the
 *     knock-back and he can parry it. AI keepers brace by their keeping (AI_BRACE).
 *
 * Fairness: nothing here touches a penalty, a free kick strike or a shootout (mega only fires in open play);
 * timers only run while the ball is live (phase 'play'); freeze slows men, never a ball in flight; a held
 * power-up is cleared at half-time and full-time. Only Match.rng is used, so a seed replays exactly.
 */
import { clamp, dist2 } from '../core/math';
import { BOX_DEPTH, BOX_W, GOAL_H, GRAVITY, HALF_L, HALF_W, SIX_DEPTH, SIX_W } from './constants';
import type { Launch } from './actions';
import type { Match, Pad } from './match';
import type { Player } from './player';
import type { PowerUp, PowerUpKind, Side } from './types';

// ------------------------------------------------------------------ tunables

/** Seconds of open play between pickups (the first of each half comes sooner: FIRST_SPAWN). */
export const SPAWN_MIN = 6;
export const SPAWN_MAX = 10;
export const FIRST_SPAWN: readonly [number, number] = [3, 6];
/** A cube materialises for this long (s) after it appears before anyone can take it (PowerUp.t < 0). */
export const MATERIALISE = 2;
/** Then it lies there this long (s) before it fades. */
export const PICKUP_LIFE = 8;
/** Never more than this many on the pitch. */
export const MAX_PICKUPS = 3;
/** Run within this (m) of a pickup to take it. */
export const PICKUP_R = 1.2;
/**
 * Where a cube appears: with the ball at someone's feet, SPAWN_AHEAD m ahead of it the way his side attacks
 * and within SPAWN_LANE m of its line (in the play, where the man on the ball and the man closing him down
 * both run); with the ball loose (or nowhere ahead is clear, up against the goal line), SPAWN_LOOSE m from it
 * in any direction.
 */
export const SPAWN_AHEAD: readonly [number, number] = [6, 16];
export const SPAWN_LANE = 5;
export const SPAWN_LOOSE: readonly [number, number] = [4, 10];
/** ... this far inside the lines, and clear of both six-yard boxes by SIX_MARGIN. */
export const SPAWN_MARGIN = 4;
export const SIX_MARGIN = 1.5;
/** Kinds are drawn with these weights. */
export const KIND_WEIGHTS: readonly (readonly [PowerUpKind, number])[] = [
  ['turbo', 30], ['mega', 20], ['freeze', 15], ['magnet', 20], ['shield', 15], ['golden', 10],
];
/** How long (s) each effect lasts once used (mega: the window for the rocket shot; it ends at the strike). */
export const DURATION: Readonly<Record<PowerUpKind, number>> = { turbo: 4, mega: 6, freeze: 3, magnet: 5, shield: 4, golden: 20 };
/** Turbo: the whole side's top speed and acceleration. */
export const TURBO_PACE = 1.3;
export const TURBO_ACCEL = 1.3;
/** Freeze: the other side's top speed and acceleration (keeper too), and they can't tackle... */
export const FREEZE_PACE = 0.45;
export const FREEZE_ACCEL = 0.45;
/** ... and their keeper's dive is this much of its pace and reach. */
export const FREEZE_DIVE = 0.6;
/** Mega: the shot's pace, how much of its error is kept, and from how close (m) an on-target one is unsavable. */
export const MEGA_PACE = 1.5;
export const MEGA_ERR = 0.5;
export const MEGA_UNSAVABLE_D = 12;
/** Mega: the ball is red-hot this long (s) after the press before the rocket can be struck. */
export const MEGA_TELEGRAPH = 1;
/** Mega: the keeper is knocked back at this speed (m/s; on the floor he brakes at 5/s, so ~2 m)... */
export const MEGA_KNOCK = 10;
/** ... and the ball keeps this much of its pace through his hands. */
export const MEGA_THROUGH = 0.85;
/** A braced keeper takes this much of the knock-back, and gets a hand to it from any distance. */
export const MEGA_BRACE_KNOCK = 0.5;
/** An AI keeper braces with this chance: AI_BRACE[0] + keeping (0..1) x AI_BRACE[1]. */
export const AI_BRACE: readonly [number, number] = [0.3, 0.35];
/** Magnet: the side's control radius (m; normally CONTROL_R + dribbling x 0.18, 0.78..0.96)... */
export const MAGNET_CONTROL_R = 1.3;
/** ... and this share of tackles on its carrier don't get clean contact. */
export const MAGNET_GUARD = 0.25;
/**
 * An AI side holds an item at least this long (s) before using it, goes for any loose fit past AI_HOLD_MAX,
 * uses it whatever the situation past AI_HOLD_CAP, and uses whatever it holds inside the last AI_ENDGAME s of
 * a half (a held item is lost at the whistle).
 */
export const AI_HOLD_MIN = 0.6;
export const AI_HOLD_MAX = 12;
export const AI_HOLD_CAP = 30;
export const AI_ENDGAME = 15;
/** A challenge that bounces off a shielded carrier leaves the tackler off balance this long (s). */
export const BOUNCE_STUMBLE = 0.45;

const KINDS: readonly PowerUpKind[] = ['turbo', 'mega', 'freeze', 'magnet', 'shield', 'golden'];

// ------------------------------------------------------------------ state

type Timers = Record<PowerUpKind, number>;

export interface BlitzState {
  /** Seconds of open play until the next pickup. */
  spawnT: number;
  nextId: number;
  /** Seconds left of each effect the SIDE activated (its freeze slows the other side). */
  fx: [Timers, Timers];
  /** Who used each (player idx), for powerupEnd. */
  user: [Timers, Timers];
  /** Kick id of the side's live mega shot (-1: none). */
  megaKick: [number, number];
  /** Each human's power button on the last step (a use is a press). */
  prevPower: [boolean, boolean];
  half: number;
  /** Seconds (of play) each AI side has held its current item. */
  aiHold: [number, number];
  /** The side's human is holding TACKLE off the ball this step: his keeper braces for a rocket. */
  brace: [boolean, boolean];
}

const STATES = new WeakMap<Match, BlitzState>();

/** Recovery must retain spawn timing and active powers, never generate another first-spawn draw. */
export function savedBlitz(m: Match): BlitzState | null { return STATES.get(m) ?? null; }
export function restoreBlitz(m: Match, state: BlitzState | null): void {
  if (state) STATES.set(m, state); else STATES.delete(m);
}

function timers(v = 0): Timers {
  return { turbo: v, mega: v, freeze: v, magnet: v, shield: v, golden: v };
}

/** The mode's state for this match (made on first use). */
export function blitzState(m: Match): BlitzState {
  let s = STATES.get(m);
  if (!s) {
    s = {
      spawnT: m.rng.range(FIRST_SPAWN[0], FIRST_SPAWN[1]), nextId: 1, fx: [timers(), timers()], user: [timers(-1), timers(-1)],
      megaKick: [-1, -1], prevPower: [false, false], half: m.half, aiHold: [0, 0], brace: [false, false],
    };
    STATES.set(m, s);
  }
  return s;
}

/** Seconds left of `kind` for `side` (0 when it isn't running). */
export function effectLeft(m: Match, side: Side, kind: PowerUpKind): number {
  return STATES.get(m)?.fx[side][kind] ?? 0;
}

/** Whether `p` may take a cube: a side holding an item uses it first, except the human's own man (his choice). */
function canTake(m: Match, p: Player): boolean {
  if (p.sentOff) return false;
  if (!m.heldPower[p.side]) return true;
  return m.isHumanControlled(p);
}

// ------------------------------------------------------------------ the step

const NO_PAD: Pad = { mx: 0, mz: 0, sprint: false, pass: false, shoot: false, through: false };

/**
 * Called from Match.step every fixed step (before the AI and the humans' input are applied), with the pads by
 * side (or, as tests call it, the view's human's one pad).
 */
export function blitzStep(m: Match, dt: number, input: Pad | readonly [Pad, Pad]): void {
  const pads = (Array.isArray(input) ? input
    : m.viewSide === 0 ? [input, NO_PAD] : [NO_PAD, input]) as readonly [Pad, Pad];
  const s = blitzState(m);
  const b = m.ball;
  const press: [boolean, boolean] = [false, false];
  for (const side of [0, 1] as Side[]) {
    const pad = pads[side];
    // (The view's side keeps its button history while the AI has it, as the one human's always did.)
    if (m.human[side] || side === m.viewSide) {
      press[side] = !!pad.power && !s.prevPower[side];
      s.prevPower[side] = !!pad.power;
    }
    s.brace[side] = m.human[side] && !!pad.shoot && !(b.owner >= 0 && m.players[b.owner].side === side);
  }
  if (m.half !== s.half) {
    blitzClear(m);
    s.half = m.half;
  }
  if (m.phase === 'halftime' || m.phase === 'fulltime' || m.phase === 'shootout') {
    blitzClear(m);
    return;
  }
  // Dead ball: pickups lie where they are, timers wait, nothing can be used.
  if (m.phase !== 'play') return;

  // Pickups materialise, age, fade, and go to whoever runs over them (his side holds it).
  for (let i = m.powerups.length - 1; i >= 0; i--) {
    const pu = m.powerups[i];
    pu.t += dt;
    if (pu.t < 0) continue;
    if (pu.t > PICKUP_LIFE) {
      m.powerups.splice(i, 1);
      continue;
    }
    let taker: Player | null = null;
    let best = PICKUP_R;
    for (const p of m.players) {
      if (!canTake(m, p)) continue;
      const d = dist2(p.pos.x, p.pos.z, pu.x, pu.z);
      if (d < best) {
        best = d;
        taker = p;
      }
    }
    if (taker) {
      m.heldPower[taker.side] = pu.kind;
      s.aiHold[taker.side] = 0;
      m.events.push({ type: 'powerupTaken', id: pu.id, kind: pu.kind, player: taker.idx, side: taker.side });
      m.powerups.splice(i, 1);
    }
  }

  // The next one.
  s.spawnT -= dt;
  if (s.spawnT <= 0 && m.powerups.length < MAX_PICKUPS) {
    const spot = spawnSpot(m);
    if (spot) {
      const kind = drawKind(m);
      m.powerups.push({ id: s.nextId++, kind, x: spot.x, z: spot.z, t: -MATERIALISE });
      m.events.push({ type: 'powerupSpawn', id: s.nextId - 1, kind, x: spot.x, z: spot.z });
      s.spawnT = m.rng.range(SPAWN_MIN, SPAWN_MAX);
    } else s.spawnT = 0.5; // nowhere clear right now: look again shortly
  }

  // Effects wear off.
  for (const side of [0, 1] as Side[]) {
    for (const kind of KINDS) {
      const t = s.fx[side][kind];
      if (t <= 0) continue;
      const nt = t - dt;
      if (nt <= 0) {
        s.fx[side][kind] = 0;
        m.events.push({ type: 'powerupEnd', kind, player: s.user[side][kind], side });
        if (kind === 'golden') syncGolden(m, s);
      } else s.fx[side][kind] = nt;
    }
  }

  // Uses: the humans' presses; the AI sides by policy.
  for (const side of [0, 1] as Side[]) if (m.human[side] && press[side]) usePower(m, side, sideUser(m, side));
  for (const side of [0, 1] as Side[]) {
    if (m.human[side]) continue;
    const kind = m.heldPower[side];
    if (!kind) continue;
    s.aiHold[side] += dt;
    if (s.aiHold[side] >= AI_HOLD_MIN && aiWants(m, side, kind, s.aiHold[side])) usePower(m, side, sideUser(m, side));
  }

  applyBoosts(m, s);
}

/** Clears pickups, held items and running effects (half-time, full-time, a shootout). */
export function blitzClear(m: Match): void {
  const s = STATES.get(m);
  if (!s) return;
  let any = m.powerups.length > 0 || m.heldPower[0] !== null || m.heldPower[1] !== null;
  m.powerups.length = 0;
  m.heldPower[0] = m.heldPower[1] = null;
  for (const side of [0, 1] as Side[]) {
    s.aiHold[side] = 0;
    s.megaKick[side] = -1;
    for (const kind of KINDS) {
      if (s.fx[side][kind] > 0) {
        m.events.push({ type: 'powerupEnd', kind, player: s.user[side][kind], side });
        any = true;
      }
      s.fx[side][kind] = 0;
    }
  }
  m.goldenSide = -1;
  if (any) s.spawnT = m.rng.range(FIRST_SPAWN[0], FIRST_SPAWN[1]);
  applyBoosts(m, s);
}

/**
 * `side` uses what it's holding (a press; nothing happens with nothing held or the ball dead). `player` is
 * who did it (the carrier, the human's man), for the events. True when something was used.
 */
export function usePower(m: Match, side: Side, player: number): boolean {
  const kind = m.heldPower[side];
  if (!kind || m.phase !== 'play') return false;
  const s = blitzState(m);
  m.heldPower[side] = null;
  s.fx[side][kind] = DURATION[kind];
  s.user[side][kind] = player;
  s.aiHold[side] = 0;
  m.events.push({ type: 'powerupUsed', kind, player, side });
  if (kind === 'golden') m.goldenSide = side;
  applyBoosts(m, s);
  return true;
}

/**
 * Match.goal, once `side`'s goal is on the board: with its golden active the goal counts double (one more on
 * the score, still one 'goal' event) and the golden ends.
 */
export function blitzGoal(m: Match, side: Side): void {
  const s = STATES.get(m);
  if (!s || s.fx[side].golden <= 0) return;
  m.score[side]++;
  s.fx[side].golden = 0;
  m.events.push({ type: 'powerupEnd', kind: 'golden', player: s.user[side].golden, side });
  syncGolden(m, s);
}

/** Match.goldenSide from the timers (with both sides golden at once, a rarity, the one armed last shows). */
function syncGolden(m: Match, s: BlitzState): void {
  const g = m.goldenSide;
  if (g !== -1 && s.fx[g].golden > 0) return;
  m.goldenSide = s.fx[0].golden > 0 ? 0 : s.fx[1].golden > 0 ? 1 : -1;
}

/** The man a use is credited to: the side's carrier, else the human's man, else its nearest to the ball. */
function sideUser(m: Match, side: Side): number {
  const b = m.ball;
  if (b.owner >= 0 && m.players[b.owner].side === side) return b.owner;
  const act = m.activeOf(side);
  if (act >= 0) return act;
  return nearestOf(m, side, b.pos.x, b.pos.z).idx;
}

/**
 * Player.boost / boostT for the render: one effect shows on a man at a time. Being frozen (the other side's
 * freeze) shows over anything his own side is running; then shield, turbo, mega, magnet. (Golden is the
 * ball's, not a man's: Match.goldenSide.)
 */
function applyBoosts(m: Match, s: BlitzState): void {
  for (const p of m.players) {
    let kind: PowerUpKind | null = null;
    let t = 0;
    if (!p.sentOff) {
      const own = s.fx[p.side];
      const opp = s.fx[p.side === 0 ? 1 : 0];
      if (opp.freeze > 0) {
        kind = 'freeze';
        t = opp.freeze;
      } else {
        for (const k of ['shield', 'turbo', 'mega', 'magnet'] as const) {
          if (own[k] > 0) {
            kind = k;
            t = own[k];
            break;
          }
        }
      }
    }
    p.boost = kind;
    p.boostT = t;
  }
}

// ------------------------------------------------------------------ pickups

function drawKind(m: Match): PowerUpKind {
  let total = 0;
  for (const [, w] of KIND_WEIGHTS) total += w;
  let r = m.rng.next() * total;
  for (const [kind, w] of KIND_WEIGHTS) {
    r -= w;
    if (r < 0) return kind;
  }
  return KIND_WEIGHTS[KIND_WEIGHTS.length - 1][0];
}

/** Inside either six-yard box (with SIX_MARGIN to spare): no pickups there. */
export function inSixYardBox(x: number, z: number): boolean {
  return Math.abs(x) > HALF_L - SIX_DEPTH - SIX_MARGIN && Math.abs(z) < SIX_W / 2 + SIX_MARGIN;
}

/** Somewhere a pickup may lie right now: inside the margins, out of the six-yard boxes, clear of the ball and other cubes. */
export function spawnOk(m: Match, x: number, z: number): boolean {
  if (Math.abs(x) > HALF_L - SPAWN_MARGIN || Math.abs(z) > HALF_W - SPAWN_MARGIN) return false;
  if (inSixYardBox(x, z)) return false;
  if (dist2(x, z, m.ball.pos.x, m.ball.pos.z) < 3) return false;
  for (const pu of m.powerups) if (dist2(x, z, pu.x, pu.z) < 4) return false;
  return true;
}

/** The side a cube is placed for: the ball's owner's, else whoever touched it last (-1: nobody yet). */
function playSide(m: Match): Side | -1 {
  const b = m.ball;
  return b.owner >= 0 ? m.players[b.owner].side : b.lastTouchSide;
}

/** Where the next cube goes (see SPAWN_AHEAD / SPAWN_LANE / SPAWN_LOOSE), or null when nowhere was clear. */
function spawnSpot(m: Match): { x: number; z: number } | null {
  const b = m.ball.pos;
  const side = playSide(m);
  if (m.ball.owner >= 0 && side !== -1) {
    const ad = m.attackDir(side);
    for (let i = 0; i < 16; i++) {
      const x = b.x + ad * m.rng.range(SPAWN_AHEAD[0], SPAWN_AHEAD[1]);
      const z = b.z + m.rng.range(-SPAWN_LANE, SPAWN_LANE);
      if (spawnOk(m, x, z)) return { x, z };
    }
  }
  for (let i = 0; i < 16; i++) {
    const a = m.rng.next() * Math.PI * 2;
    const r = m.rng.range(SPAWN_LOOSE[0], SPAWN_LOOSE[1]);
    const x = b.x + Math.cos(a) * r;
    const z = b.z + Math.sin(a) * r;
    if (spawnOk(m, x, z)) return { x, z };
  }
  return null;
}

// ------------------------------------------------------------------ AI policy

function nearestOf(m: Match, side: Side, x: number, z: number): Player {
  let best = m.teamPlayers(side)[0];
  let bd = Infinity;
  for (const p of m.teamPlayers(side)) {
    if (p.sentOff) continue;
    const d = dist2(p.pos.x, p.pos.z, x, z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function nearestDist(m: Match, side: Side, x: number, z: number): number {
  let bd = Infinity;
  for (const p of m.teamPlayers(side)) {
    if (p.sentOff) continue;
    bd = Math.min(bd, dist2(p.pos.x, p.pos.z, x, z));
  }
  return bd;
}

/** How far (m) the carrier can run the way he's facing before an opponent is in his path. */
function spaceAhead(m: Match, c: Player): number {
  const fx = Math.cos(c.facing);
  const fz = Math.sin(c.facing);
  let best = 99;
  for (const o of m.teamPlayers(c.side === 0 ? 1 : 0)) {
    if (o.sentOff) continue;
    const dx = o.pos.x - c.pos.x;
    const dz = o.pos.z - c.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    if ((dx * fx + dz * fz) / d > 0.5) best = Math.min(best, d);
  }
  return best;
}

/**
 * When an AI side uses what it holds: turbo chasing or dribbling into space; mega with a shot on within 26 m
 * (the telegraph passes while he closes in); freeze with the opponents attacking near its box, or its own
 * carrier pressed in their half; magnet only on the attack (receiving / dribbling under pressure outside its
 * own third: near its own box a magnet carrier being pressed just lost the ball where it hurt); shield
 * dribbling under pressure; golden with its carrier in their half. Held past AI_HOLD_MAX s it goes on the next
 * loose fit, past AI_HOLD_CAP or inside the last AI_ENDGAME s of a half it goes whatever is happening.
 */
export function aiWants(m: Match, side: Side, kind: PowerUpKind, held: number): boolean {
  if (held > AI_HOLD_CAP || m.clock > m.cfg.halfLength - AI_ENDGAME) return true;
  const b = m.ball;
  const c = b.owner >= 0 && !b.held ? m.players[b.owner] : null;
  const we = c !== null && c.side === side;
  const they = c !== null && c.side !== side;
  const opp: Side = side === 0 ? 1 : 0;
  const ad = m.attackDir(side);
  const late = held > AI_HOLD_MAX;
  switch (kind) {
    case 'turbo': {
      if (we && c) {
        if (c.isKeeper) return false;
        return late || (spaceAhead(m, c) > 4 && c.pos.x * ad > -HALF_L * 0.3 && c.speed() > 3);
      }
      if (they && c) {
        const d = nearestDist(m, side, c.pos.x, c.pos.z);
        return d > 2 && d < 12 && (late || c.vel.x * -ad > 3);
      }
      return false;
    }
    case 'mega': {
      if (!we || !c || c.isKeeper) return false;
      const gx = ad * HALF_L;
      const d = dist2(c.pos.x, c.pos.z, gx, 0);
      if (late) return d < 30;
      const toGoal = Math.atan2(-c.pos.z, gx - c.pos.x);
      return d < 26 && Math.abs(c.pos.z) < BOX_W / 2 + 3 && Math.cos(c.facing - toGoal) > 0.2;
    }
    case 'freeze': {
      if (they && c) {
        const d = dist2(c.pos.x, c.pos.z, -ad * HALF_L, 0);
        return d < (late ? 40 : BOX_DEPTH + 10);
      }
      if (we && c && !c.isKeeper && c.pos.x * ad > 0) return late || nearestDist(m, opp, c.pos.x, c.pos.z) < 4;
      return false;
    }
    case 'magnet': {
      const attacking = (p: Player) => p.pos.x * ad > -HALF_L / 3;
      if (we && c) return attacking(c) && (late || nearestDist(m, opp, c.pos.x, c.pos.z) < 2.5);
      const t = m.passTarget >= 0 ? m.players[m.passTarget] : null;
      return t !== null && t.side === side && attacking(t) && nearestDist(m, opp, t.pos.x, t.pos.z) < 3;
    }
    case 'shield':
      return we && c !== null && !c.isKeeper && (late || nearestDist(m, opp, c.pos.x, c.pos.z) < 2.5);
    case 'golden':
      // Worth most with an attack on: our carrier in their half, or held too long.
      return late || (we && c !== null && c.pos.x * ad > 0);
  }
}

// ------------------------------------------------------------------ hooks

/**
 * Match.tryTackle, once the tackler is in reach of the carrier `c`: true when the challenge is off. A
 * shielded carrier, or a frozen tackler: it bounces off him (he's knocked off his stride; no foul, no ball).
 * A magnet carrier: MAGNET_GUARD of challenges don't get clean contact.
 */
export function blitzTackle(m: Match, p: Player, c: Player): boolean {
  const s = STATES.get(m);
  if (!s) return false;
  const guard = s.fx[c.side];
  if (guard.shield > 0 || guard.freeze > 0) {
    p.tackleCooldown = 1.0;
    p.vel.x *= -0.35;
    p.vel.z *= -0.35;
    p.stumbleT = Math.max(p.stumbleT, BOUNCE_STUMBLE);
    m.events.push({ type: 'tackle', by: p.idx, won: false, slide: false });
    return true;
  }
  if (guard.magnet > 0 && m.rng.chance(MAGNET_GUARD)) {
    p.tackleCooldown = 0.8;
    m.events.push({ type: 'tackle', by: p.idx, won: false, slide: false });
    return true;
  }
  return false;
}

/** Match.startSlide: a frozen man can't go to ground, and nobody slides in on a shielded carrier. */
export function blitzNoSlide(m: Match, p: Player): boolean {
  const s = STATES.get(m);
  if (!s) return false;
  const opp: Side = p.side === 0 ? 1 : 0;
  if (s.fx[opp].freeze > 0) return true;
  const b = m.ball;
  return b.owner >= 0 && !b.held && m.players[b.owner].side === opp && s.fx[opp].shield > 0;
}

/** keeper.ts, as keeper `k` sets his dive: frozen, it's FREEZE_DIVE of its pace and reach. */
export function blitzDive(m: Match, k: Player): void {
  const s = STATES.get(m);
  if (!s || s.fx[k.side === 0 ? 1 : 0].freeze <= 0) return;
  k.vel.z *= FREEZE_DIVE;
  k.diveTravel *= FREEZE_DIVE;
}

/**
 * actions.resolveKick: the armed side's open-play shot (not a chip, never a set piece, not inside the
 * MEGA_TELEGRAPH s after the press: that one is an ordinary shot and the mega stays armed) becomes a rocket:
 * MEGA_PACE the pace, flat (re-solved to cross the line at its intended height, kept under the bar), with
 * MEGA_ERR of its error and half its curl. The launch is changed in place; mega ends here.
 */
export function megaLaunch(m: Match, p: Player, L: Launch): void {
  const s = STATES.get(m);
  if (!s || L.kind !== 'shot' || L.style === 'chip' || m.phase !== 'play' || s.fx[p.side].mega <= 0) return;
  if (DURATION.mega - s.fx[p.side].mega < MEGA_TELEGRAPH) return;
  const b = m.ball.pos;
  L.vx *= MEGA_PACE;
  L.vz *= MEGA_PACE;
  const hs = Math.hypot(L.vx, L.vz);
  if (L.aim) {
    const tz = L.aim.z + L.aim.errZ * MEGA_ERR;
    const h = clamp(L.aim.h + L.aim.errH * MEGA_ERR, 0.25, GOAL_H - 0.45);
    const dx = L.aim.gx - b.x;
    const dz = tz - b.z;
    const dl = Math.hypot(dx, dz) || 1;
    L.vx = (dx / dl) * hs;
    L.vz = (dz / dl) * hs;
    // (The same drag allowance as the shot model: it gets there at ~0.9 of its launch pace.)
    const t = dl / (hs * 0.9);
    L.vy = clamp((h - b.y + 0.5 * GRAVITY * t * t) / t, -2, 13);
  } else L.vy *= 0.8;
  L.spinY *= 0.5;
  // (Match.execute counts the kick after this solve: the rocket's kick id is the next one.)
  s.megaKick[p.side] = m.kickId + 1;
  s.fx[p.side].mega = 0;
  m.events.push({ type: 'powerupEnd', kind: 'mega', player: s.user[p.side].mega, side: p.side });
  applyBoosts(m, s);
}

/**
 * Match.checkKeeperHands, with keeper `k` on the ball: true when it was the other side's live mega shot and this
 * settled it. He's knocked back along its line (MEGA_KNOCK); on target from inside MEGA_UNSAVABLE_D m it goes
 * through his hands (MEGA_THROUGH of its pace, still the shooter's ball); from further out he gets a hand to it
 * (a parry out, up and away), never a catch. Braced (the human holding TACKLE off the ball, or an AI keeper by
 * his keeping) he takes MEGA_BRACE_KNOCK of the knock and parries it from any distance.
 */
export function megaHands(m: Match, k: Player, onFrame: boolean): boolean {
  const s = STATES.get(m);
  if (!s) return false;
  const side: Side = k.side === 0 ? 1 : 0;
  if (m.shotKick !== m.kickId || m.shotSide !== side || s.megaKick[side] !== m.shotKick || m.shotClock > 2) return false;
  const b = m.ball;
  const hs = b.hspeed() || 1;
  const braced = m.human[k.side] ? s.brace[k.side] : m.rng.chance(AI_BRACE[0] + (k.stat.keeping / 100) * AI_BRACE[1]);
  const knock = MEGA_KNOCK * (braced ? MEGA_BRACE_KNOCK : 1);
  k.setState('fallen');
  k.vel.x = (b.vel.x / hs) * knock;
  k.vel.z = (b.vel.z / hs) * knock;
  k.claiming = false;
  k.kickCooldown = 0.6;
  if (onFrame && !braced && m.shotDist <= MEGA_UNSAVABLE_D) {
    b.vel.x *= MEGA_THROUGH;
    b.vel.y *= MEGA_THROUGH;
    b.vel.z *= MEGA_THROUGH;
    m.events.push({ type: 'ooh' });
    return true;
  }
  const ad = m.attackDir(k.side);
  b.vel.x = ad * (4 + m.rng.next() * 4);
  b.vel.z = (Math.sign(b.pos.z - k.pos.z) || (m.rng.chance(0.5) ? 1 : -1)) * (4 + m.rng.next() * 5);
  b.vel.y = 3 + m.rng.next() * 3;
  b.spin.x = b.spin.y = b.spin.z = 0;
  b.lastTouch = k.idx;
  b.lastTouchSide = k.side;
  m.passTarget = -1;
  if (onFrame) {
    m.stats.saves[k.side]++;
    m.events.push({ type: 'save', keeper: k.idx, caught: false });
  }
  return true;
}

/** How far (m) a free man goes out of his way for a cube. */
export const SEEK_R = 11;

/**
 * After the team AI and the human have set their runs: one free man per side goes for the nearest cube in
 * reach (never the human's controlled man, a keeper, the ball carrier, a man with a kick to make, or anyone
 * inside 6 m of the ball, who is in the play). A side holding an item doesn't go for another (it uses what it
 * has first), and the human's teammates leave a cube alone while his controlled man is within SEEK_R of it:
 * the cubes near the play are his to take. The other side still contests them.
 */
export function blitzSeek(m: Match): void {
  if (m.phase !== 'play' || m.powerups.length === 0) return;
  for (const side of [0, 1] as Side[]) {
    if (m.heldPower[side]) continue;
    const act = m.activeOf(side);
    const active = act >= 0 ? m.players[act] : null;
    let best: Player | null = null;
    let bestD = SEEK_R;
    let target: PowerUp | null = null;
    for (const pu of m.powerups) {
      if (active && dist2(active.pos.x, active.pos.z, pu.x, pu.z) <= SEEK_R) continue;
      for (const p of m.players) {
        if (p.side !== side || p.isKeeper || p.sentOff || p.state !== 'move' || p.order) continue;
        if (p.idx === act) continue;
        if (m.ball.owner === p.idx || dist2(p.pos.x, p.pos.z, m.ball.pos.x, m.ball.pos.z) < 6) continue;
        const d = dist2(p.pos.x, p.pos.z, pu.x, pu.z);
        if (d < bestD) {
          bestD = d;
          best = p;
          target = pu;
        }
      }
    }
    if (!best || !target) continue;
    const dx = target.x - best.pos.x;
    const dz = target.z - best.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    best.wantX = dx / l;
    best.wantZ = dz / l;
    best.sprint = bestD > 2.5;
    best.faceTarget = null;
  }
}
