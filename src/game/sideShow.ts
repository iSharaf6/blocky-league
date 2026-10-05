/**
 * SIDE SHOWS (the owner: "we said more cutscenes", "commentators watching in their studio with the replay celebrating
 * the goal"): short comic scenes on their own little stage (render/sideStage.ts), shown as a picture in the corner so
 * they take no time from the match, and full screen only for a big goal.
 *
 * - THE COMMENTARY BOX: two commentators at their desk watch a goal's replay and react when the ball goes in (six ways
 *   to celebrate, three to groan). A late winner, a hat trick, a SUPER SHOT or a knockout lead gets a full-screen cut
 *   of BOX_FULL_S before the replay (FULL_CAP a match).
 * - FAN CAM (the popcorn), DUGOUT CAM (the manager and the bench): the other pictures a goal's replay may get.
 * - COIN TOSS before the first kick-off, KEEPER CAM while a penalty is prepared, EARLY BATH after a red card, and the
 *   MATCH BALL for a hat trick at full time: the real players in their real kits.
 *
 * This file decides what plays and when (SideShow: the caps, the triggers, the sounds) and where everyone is at each
 * moment (sidePose), with no drawing in it, so the tests can check it. Nothing here writes to the sim or its frames.
 */
import { sfx, type Sfx } from '../audio/sfx';
import type { Match } from '../sim/match';
import type { Kit, MatchEvent, PlayerDef, Side } from '../sim/types';

export type SideKind = 'box' | 'fans' | 'dugout' | 'coin' | 'penalty' | 'redcard' | 'matchball';
export type SideMood = 'joy' | 'groan';

/** The corner tag for each (Silkscreen capitals: no hyphens, no punctuation). */
export const SIDE_LABEL: Record<SideKind, string> = {
  box: 'COMMENTARY BOX', fans: 'FAN CAM', dugout: 'DUGOUT CAM', coin: 'COIN TOSS', penalty: 'KEEPER CAM', redcard: 'EARLY BATH',
  matchball: 'MATCH BALL',
};

/** A timed side show is this long (s); the full-screen commentary cut; two full cuts are at least FULL_GAP_S apart. */
export const SIDE_S = 3;
export const BOX_FULL_S = 2.4;
export const FULL_GAP_S = 45;
export const FULL_CAP = 2;
/** The reaction starts this long into a full cut (a beat at the desk first). */
export const FULL_REACT_AT = 0.2;
/** At most this many of each in a match, so none of them plays every time. */
export const SIDE_CAPS: Record<SideKind, number> = { box: 5, fans: 2, dugout: 2, coin: 1, penalty: 1, redcard: 1, matchball: 1 };
/** The coin toss is shown before this share of matches; this share of goal replays keeps the whole picture. */
export const COIN_CHANCE = 0.7;
export const CLEAN_REPLAY_CHANCE = 0.2;
/** A goal this far through the second half (of its length) that levels it or puts you ahead is late drama. */
export const LATE_FROM = 0.8;
/** A SUPER SHOT this recent (s) scored the goal. */
const SUPER_WINDOW_S = 8;
/** A red card's walk waits at most this long (s) for the picture to be free. */
const RED_WAIT_S = 14;

/** The commentators' reactions: to a goal of yours, and to one against. */
export const BOX_JOY = ['leap', 'chair', 'headset', 'papers', 'five', 'spin'] as const;
export const BOX_GROAN = ['facepalm', 'headdesk', 'sink'] as const;
export type BoxReaction = (typeof BOX_JOY)[number] | (typeof BOX_GROAN)[number];

/** Why a goal is big enough for the full-screen cut, and its headline. */
export type BigGoal = 'hattrick' | 'super' | 'late' | 'cup';
export const BIG_LINE: Record<BigGoal, string> = { hattrick: 'HAT TRICK HERO', super: 'WHAT A STRIKE', late: 'LATE DRAMA', cup: 'CUP FEVER' };

// ------------------------------------------------------------------ poses

/** Hip height of a footballer standing (render/characters.ts: 5 voxels of 0.075 m at CHAR_SCALE 1.15). */
export const HIP_M = 5 * 0.075 * 1.15;
/** The top of his hair, standing. */
export const TALL_M = 22 * 0.075 * 1.15;

/**
 * One figure at one moment. x, y, z: his feet on the stage (m; x to screen right, z towards the lens); yaw: 0 faces the
 * lens, + turns to screen right. lean: the whole body pitched back (+) or forward (-); roll: sideways; sit: 0..1 legs
 * out in front (seated); torso / twist: the upper body alone; head: up (+) or down (-). Arms and legs are the rig's own
 * angles (characters.ts): an arm's z swings it forward and up (1.4 level, 2.75 overhead), its x out to the side.
 */
export interface PuppetPose {
  on: boolean;
  x: number; y: number; z: number; yaw: number;
  lean: number; roll: number; sit: number; torso: number; twist: number;
  head: number; headYaw: number; headRoll: number;
  alx: number; aly: number; alz: number; arx: number; ary: number; arz: number;
  legL: number; legR: number; spread: number;
}

export function newPose(): PuppetPose {
  return {
    on: false, x: 0, y: 0, z: 0, yaw: 0, lean: 0, roll: 0, sit: 0, torso: 0, twist: 0, head: 0, headYaw: 0, headRoll: 0,
    alx: 0, aly: 0, alz: 0, arx: 0, ary: 0, arz: 0, legL: 0, legR: 0, spread: 0,
  };
}

/** Most figures a side show has, and its loose things (papers, popcorn, a coin): PROP_F numbers each. */
export const PUPPET_MAX = 5;
export const PROP_MAX = 14;
/** x, y, z, rx, ry, rz, shown (1 / 0). */
export const PROP_F = 7;

/** How many figures each kind has (the stage builds as many). */
export const SIDE_CAST: Record<SideKind, number> = { box: 2, fans: 5, dugout: 4, coin: 3, penalty: 2, redcard: 5, matchball: 3 };

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const sm = (a: number, b: number, v: number): number => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const hop = (t: number, rate: number): number => Math.abs(Math.sin(t * rate));

function stand(p: PuppetPose, x: number, z: number, yaw = 0): PuppetPose {
  p.on = true;
  p.x = x; p.y = 0; p.z = z; p.yaw = yaw;
  p.lean = p.roll = p.sit = p.torso = p.twist = p.head = p.headYaw = p.headRoll = 0;
  p.alx = p.aly = p.alz = p.arx = p.ary = p.arz = p.legL = p.legR = p.spread = 0;
  return p;
}

/** Seated with his hip at `hipY`, hands in front of him (on a desk, in his lap). */
function seat(p: PuppetPose, x: number, z: number, hipY: number): PuppetPose {
  stand(p, x, z);
  p.y = hipY - HIP_M;
  p.sit = 1;
  p.alz = p.arz = 1.0;
  p.alx = 0.12; p.arx = -0.12;
  return p;
}

/** Both arms: `out` to the side (0 straight ahead), `up` forward and up (1.4 level, 2.75 overhead). */
function arms(p: PuppetPose, out: number, up: number): void {
  // (Above the shoulder an arm's x swings the other way: see characters.ts.)
  const s = up > 1.57 ? -1 : 1;
  p.alx = out * s; p.arx = -out * s;
  p.alz = p.arz = up;
}

function setProp(v: Float32Array, i: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, on = true): void {
  const o = i * PROP_F;
  v[o] = x; v[o + 1] = y; v[o + 2] = z; v[o + 3] = rx; v[o + 4] = ry; v[o + 5] = rz; v[o + 6] = on ? 1 : 0;
}

// The commentary box: two seats behind a desk (its top at BOX_DESK_Y), the wall screen between their heads.
export const BOX_SEAT_X = 0.95;
export const BOX_HIP_Y = 0.62;
export const BOX_DESK_Y = 0.9;
export const BOX_DESK_Z = 0.62;
/** Props: 0..7 the papers on the desk, 8 the first commentator's headset (an offset from his head), 9 the second's chair. */
export const BOX_PAPERS = 8;
export const BOX_HEADSET = 8;
export const BOX_CHAIR = 9;

/** Out of the seat, arms in the air, bouncing: `k` how far up he is, `amp` how much he bounces. */
function leap(p: PuppetPose, h: number, ph: number, k: number, amp: number): void {
  p.sit = 1 - k;
  p.y += k * 0.14 + hop(h + ph, 9) * 0.16 * k * amp;
  p.lean = 0.08 * k;
  p.head = 0.22 * k;
  arms(p, 0.4, mix(1.0, 2.75 + Math.sin((h + ph) * 13) * 0.16, k));
}

function clap(p: PuppetPose, h: number, ph: number): void {
  const c = 0.5 + 0.5 * Math.sin((h + ph) * 16);
  p.alx = p.arx = 0;
  p.aly = -0.25 - 0.5 * c;
  p.ary = 0.25 + 0.5 * c;
  p.alz = p.arz = 1.4;
}

function boxPose(r: BoxReaction, t: number, h: number, ps: PuppetPose[], v: Float32Array): void {
  const a = seat(ps[0], -BOX_SEAT_X, 0, BOX_HIP_Y);
  const b = seat(ps[1], BOX_SEAT_X, 0, BOX_HIP_Y);
  // Papers in two piles; the headset on his head; the chair upright.
  for (let j = 0; j < BOX_PAPERS; j++) {
    const pile = j < 4 ? -1 : 1;
    setProp(v, j, pile * 0.38 + (j % 4) * 0.012, BOX_DESK_Y + 0.012 + (j % 4) * 0.014, BOX_DESK_Z + 0.02, 0, (j % 4) * 0.22 - 0.3);
  }
  setProp(v, BOX_HEADSET, 0, 0, 0);
  setProp(v, BOX_CHAIR, BOX_SEAT_X, 0, -0.34);
  if (h < 0) {
    // Watching the move build: leaning in at their monitors, a nod, one of them pointing as it gets close.
    const lean = -0.1 - 0.14 * sm(0, 1.6, t);
    a.lean = b.lean = lean;
    a.head = -0.12 + Math.sin(t * 2.3) * 0.03;
    b.head = -0.12 + Math.sin(t * 2.3 + 1.4) * 0.03;
    a.headYaw = 0.3;
    b.headYaw = -0.3;
    const point = sm(0.7, 1, t);
    b.arz = mix(1.0, 1.55, point);
    b.arx = mix(-0.12, 0.5, point);
    return;
  }
  const up = sm(0, 0.16, h);
  switch (r) {
    case 'leap':
      leap(a, h, 0, up, 1);
      leap(b, h, 0.19, up, 1);
      break;
    case 'chair': {
      // He leans back to cheer and goes over, chair and all: two boots kicking above the desk.
      const back = sm(0.2, 0.75, h);
      const calm = 1 - sm(0.8, 1.05, h) * (1 - sm(1.7, 1.95, h));
      leap(a, h, 0, up, calm);
      a.headYaw = 0.75 * (1 - calm);
      if (calm < 0.5) arms(a, 0.9, 0.9);
      // (Right over: his head goes down behind the desk and only the legs are left standing up above it.)
      b.sit = mix(1, 0.57, back);
      b.lean = 2.3 * back;
      b.y += 0.38 * back;
      arms(b, 0.5, mix(2.7, 2.2, back));
      b.legL = Math.sin(h * 13) * 0.4 * back;
      b.legR = -Math.sin(h * 13) * 0.4 * back;
      setProp(v, BOX_CHAIR, BOX_SEAT_X, 0, -0.34 - 0.25 * back, -1.45 * back);
      break;
    }
    case 'headset': {
      // Off comes the headset, up it goes; the other one pumps both fists in his seat.
      leap(a, h, 0, sm(0.25, 0.45, h), 1);
      if (h < 0.3) {
        a.arx = -0.5;
        a.arz = mix(1.0, 2.5, sm(0, 0.2, h));
      }
      const f = h - 0.25;
      if (f > 0) {
        const y = 3.3 * f - 3.1 * f * f;
        setProp(v, BOX_HEADSET, -0.25 * f, y, 0.5 * f, f * 3, f * 2, f * 13, y > -0.9);
      }
      b.y += hop(h, 8) * 0.07;
      b.alz = 2.45 + Math.sin(h * 16) * 0.38;
      b.arz = 2.45 - Math.sin(h * 16) * 0.38;
      b.alx = -0.3; b.arx = 0.3;
      b.head = 0.15;
      break;
    }
    case 'papers': {
      // Everything on the desk goes up, and comes down all over it.
      const st = sm(0.5, 0.75, h);
      leap(a, h, 0, st, 1);
      leap(b, h, 0.2, st, 1);
      if (h < 1.3) {
        arms(a, 0.3, mix(1.0, 2.85, sm(0, 0.18, h)));
        arms(b, 0.3, mix(1.0, 2.85, sm(0.04, 0.22, h)));
      } else {
        clap(a, h, 0);
        clap(b, h, 0.1);
      }
      for (let j = 0; j < BOX_PAPERS; j++) {
        const f = h - 0.06 - j * 0.015;
        if (f <= 0) continue;
        const x0 = (j < 4 ? -0.38 : 0.38) + ((j * 37) % 7 - 3) * 0.19 * f;
        const y = BOX_DESK_Y + 0.02 + (3.3 + (j % 3) * 0.55) * f - 2.3 * f * f;
        const z = BOX_DESK_Z + (0.15 + (j % 2) * 0.3 - (j % 3) * 0.12) * Math.min(f, 1.4);
        if (y > BOX_DESK_Y + 0.02) setProp(v, j, x0, y, z, f * (5 + j), f * 2, f * (3 + j * 0.7));
        else setProp(v, j, (j < 4 ? -0.38 : 0.38) + ((j * 37) % 7 - 3) * 0.27, BOX_DESK_Y + 0.012 + j * 0.003, BOX_DESK_Z + (j % 3) * 0.12 - 0.1, 0, j * 0.9);
      }
      break;
    }
    case 'five': {
      // Up, a turn to each other, palms meet over the desk, and round to the lens again.
      const turn = sm(0, 0.3, h) * (1 - sm(0.6, 0.9, h));
      leap(a, h, 0, up, 1 - turn);
      leap(b, h, 0.1, up, 1 - turn);
      a.yaw = 0.8 * turn;
      b.yaw = -0.8 * turn;
      a.x += 0.2 * turn;
      b.x -= 0.2 * turn;
      if (turn > 0.05) {
        // (His arm on the lens side: the palms meet where the picture can see them. The far arm comes down for it.)
        a.arx = 0; a.arz = 2.5;
        b.alx = 0; b.alz = 2.5;
        a.alz = mix(a.alz, 0.6, turn);
        b.arz = mix(b.arz, 0.6, turn);
      }
      break;
    }
    case 'spin': {
      // One spins on his chair, arms out; the other drums the desk, then points and laughs at the dizzy one.
      const k = sm(0, 1.5, h);
      b.yaw = Math.PI * 4 * k;
      b.y += 0.05;
      arms(b, 1.1, 1.5);
      const dizzy = sm(1.5, 1.7, h);
      b.roll = Math.sin(h * 6) * 0.16 * dizzy;
      b.headRoll = Math.sin(h * 6 + 1) * 0.2 * dizzy;
      if (dizzy > 0) arms(b, 0.9, 0.7);
      a.lean = -0.18;
      a.alz = 1.05 + Math.max(0, Math.sin(h * 22)) * 0.45;
      a.arz = 1.05 + Math.max(0, -Math.sin(h * 22)) * 0.45;
      a.head = Math.sin(h * 11) * 0.08;
      if (h > 1.5) {
        a.lean = 0.12;
        a.y += hop(h, 9) * 0.05;
        a.headYaw = 0.6;
        a.alx = 0.6; a.alz = 1.45;
        a.arz = 1.0;
      }
      break;
    }
    case 'facepalm': {
      // A hand over the face, each; one shakes his head, the other slides the hand down and looks through it.
      const k = sm(0, 0.3, h);
      for (let i = 0; i < 2; i++) {
        const p = ps[i];
        p.arx = -0.95 * k;
        p.arz = mix(1.0, 2.35, k);
        p.head = -0.3 * k;
        p.lean = -0.1 - 0.1 * k;
      }
      a.headYaw = Math.sin(h * 7) * 0.2 * sm(0.4, 0.7, h);
      const peek = sm(1.3, 1.7, h);
      b.arz = mix(2.35, 1.75, peek);
      b.head = mix(-0.3, -0.05, peek);
      break;
    }
    case 'headdesk': {
      // Forehead to the desk with a thump; the other one asks the ceiling why.
      const k = sm(0.12, 0.38, h);
      const ring = h > 0.38 ? Math.sin((h - 0.38) * 22) * 0.07 * Math.exp(-(h - 0.38) * 6) : 0;
      a.y += 0.2 * k;
      a.lean = -0.1 - 0.5 * k + ring;
      a.head = -0.5 * k;
      a.alz = a.arz = mix(1.0, 2.3, k);
      a.alx = -0.5 * k; a.arx = 0.5 * k;
      const why = sm(0, 0.3, h);
      b.lean = 0.24 * why;
      b.head = 0.42 * why;
      arms(b, 1.15 * why, mix(1.0, 1.25, why));
      b.alz += Math.sin(h * 9) * 0.1 * why;
      b.arz += Math.sin(h * 9) * 0.1 * why;
      break;
    }
    case 'sink': {
      // Down behind the desk, slowly, both of them; one comes back up as far as his eyes.
      const k = sm(0.1, 0.9, h);
      const peek = sm(1.15, 1.4, h);
      a.y -= 0.7 * k;
      b.y -= 0.7 * k - 0.3 * peek;
      a.alz = a.arz = b.alz = b.arz = mix(1.0, 0.2, k);
      a.head = b.head = -0.15 * (1 - peek);
      b.headYaw = Math.sin((h - 1.4) * 4) * 0.4 * peek;
      break;
    }
  }
}

// The stand: three seats in front (the middle fan has the popcorn), two behind and above.
export const FAN_HIP_Y = 0.55;
export const FAN_ROW_Z = 0.3;
export const FAN_BACK_Y = 1.05;
export const FAN_BACK_Z = -0.6;
/** Props: 0 the bucket, 1..12 the popcorn. */
const FAN_X = [0, -0.95, 0.95, -0.48, 0.48];
export const FAN_BUCKET = 0;
export const FAN_CORN = 12;

function fansPose(mood: SideMood, t: number, h: number, ps: PuppetPose[], v: Float32Array): void {
  for (let i = 0; i < 5; i++) seat(ps[i], FAN_X[i], i < 3 ? FAN_ROW_Z : FAN_BACK_Z, i < 3 ? FAN_HIP_Y : FAN_BACK_Y);
  const me = ps[0];
  const lapX = 0.14, lapY = FAN_HIP_Y + 0.34, lapZ = FAN_ROW_Z + 0.42;
  for (let j = 0; j <= FAN_CORN; j++) setProp(v, j, 0, 0, 0, 0, 0, 0, false);
  setProp(v, FAN_BUCKET, lapX, lapY, lapZ);
  if (h < 0) {
    // Watching, on the edge of their seats; the one with the popcorn keeps eating.
    for (let i = 0; i < 5; i++) {
      ps[i].lean = -0.12 - 0.1 * sm(0, 1.6, t);
      ps[i].head = Math.sin(t * 2 + i) * 0.04;
    }
    const munch = Math.max(0, Math.sin(t * 5.5));
    me.arx = -0.75 * munch;
    me.arz = mix(1.0, 2.25, munch);
    me.alz = 1.15;
    return;
  }
  if (mood === 'joy') {
    // Everybody up: the bucket goes with his arms, and it rains popcorn. Then he notices.
    const up = sm(0, 0.16, h);
    const empty = sm(1.2, 1.4, h) * (1 - sm(2.1, 2.3, h));
    for (let i = 0; i < 5; i++) {
      const p = ps[i];
      const still = i === 0 ? 1 - empty : 1;
      p.sit = 1 - up;
      p.y += up * 0.14 + hop(h + i * 0.13, 9) * 0.16 * up * still;
      p.head = 0.2 * up * still;
      arms(p, 0.4, mix(1.0, 2.75 + Math.sin((h + i * 0.3) * 13) * 0.16, up));
    }
    if (empty > 0) {
      me.head = -0.42 * empty;
      me.alx = 0.3; me.arx = -0.3;
      me.alz = me.arz = mix(2.75, 1.3, empty);
    }
    const f = h - 0.04;
    const by = lapY + 4.4 * f - 3.6 * f * f;
    setProp(v, FAN_BUCKET, lapX + 0.55 * f, by, lapZ + 0.25 * f, 0, f * 2, f * 9, f < 0 || by > 0.1);
    for (let j = 0; j < FAN_CORN; j++) {
      const g = h - 0.12 - (j % 4) * 0.03;
      if (g <= 0) continue;
      const ang = j * 0.52 + 0.3;
      const y = lapY + 0.5 + (2.6 + (j % 3) * 0.8) * g - 3 * g * g;
      setProp(v, 1 + j, lapX + Math.cos(ang) * (0.5 + (j % 4) * 0.22) * g, y, lapZ + 0.1 + Math.sin(ang) * 0.35 * g, g * 7, g * 5, 0, y > 0.15);
    }
    return;
  }
  // A goal against: hands on heads; the bucket goes on his, upside down, and the popcorn comes out of it.
  const k = sm(0, 0.3, h);
  for (let i = 1; i < 5; i++) {
    const p = ps[i];
    p.lean = 0.14 * k;
    p.head = -0.2 * k;
    if (i === 2) arms(p, 1.1 * k, mix(1.0, 1.2, k));
    else arms(p, 0.95 * k, mix(1.0, 2.55, k));
  }
  const lift = sm(0.4, 0.95, h);
  const drop = sm(1.3, 1.6, h);
  const topY = FAN_HIP_Y + 1.68;
  me.head = -0.25 * drop;
  arms(me, 0.5 * lift, mix(1.0, 2.6, lift * (1 - drop)));
  setProp(v, FAN_BUCKET, mix(lapX, 0, lift), mix(lapY, topY, lift) + Math.sin(lift * Math.PI) * 0.25, mix(lapZ, FAN_ROW_Z + 0.02, lift), 0, 0, Math.PI * lift);
  for (let j = 0; j < FAN_CORN; j++) {
    const g = h - 0.7 - (j % 5) * 0.05;
    if (g <= 0) continue;
    const y = topY - 0.1 - 2.2 * g * g;
    setProp(v, 1 + j, ((j * 29) % 9 - 4) * 0.09, y, FAN_ROW_Z + 0.3 + (j % 3) * 0.1, g * 6, g * 4, 0, y > FAN_HIP_Y + 0.35);
  }
}

// The dugout: the manager on the touchline, three substitutes on the bench behind him. Prop 0: his water bottle.
export const DUG_BENCH_Y = 0.55;
export const DUG_BENCH_Z = -0.6;
const DUG_BENCH_X = [0.2, 1.05, 1.9];
const DUG_BOSS_X = -1.45;
const DUG_BOSS_Z = 0.3;

function benchSeats(ps: PuppetPose[]): void {
  for (let i = 0; i < 3; i++) {
    const p = seat(ps[1 + i], DUG_BENCH_X[i], DUG_BENCH_Z, DUG_BENCH_Y);
    p.lean = -0.28;
    p.alz = p.arz = 0.8;
  }
}

/** The bottle, kicked along the touchline from `at` s: the bench ducks as it goes by. */
function bottleKick(boss: PuppetPose, ps: PuppetPose[], v: Float32Array, h: number, at: number): void {
  const wind = sm(at - 0.3, at - 0.08, h);
  const kick = sm(at - 0.08, at + 0.06, h);
  boss.legR = -0.7 * wind + 2.0 * kick - 1.3 * sm(at + 0.15, at + 0.4, h);
  boss.lean = 0.12 * kick;
  const f = h - at;
  if (f <= 0) return;
  const x = DUG_BOSS_X + 0.5 + 4.6 * f;
  const y = 0.14 + Math.abs(Math.sin(Math.min(f, 1.2) * 4.2)) * 1.0 * Math.exp(-f * 1.3);
  setProp(v, 0, x, y, 0.75, 0, f * 4, f * 16, x < 4);
  for (let i = 0; i < 3; i++) {
    const near = 1 - clamp01(Math.abs(x - DUG_BENCH_X[i]) / 0.9);
    const p = ps[1 + i];
    p.lean = mix(p.lean, -0.75, near);
    p.head = mix(p.head, -0.3, near);
    if (near > 0.2) arms(p, 0.9, 2.5);
  }
}

function dugoutPose(mood: SideMood, t: number, h: number, ps: PuppetPose[], v: Float32Array): void {
  const boss = stand(ps[0], DUG_BOSS_X, DUG_BOSS_Z);
  benchSeats(ps);
  setProp(v, 0, DUG_BOSS_X + 0.5, 0.14, 0.75);
  if (h < 0) {
    // Hands on hips, a step one way and back; the bench with their elbows on their knees.
    boss.x += Math.sin(t * 1.4) * 0.14;
    boss.alx = 0.55; boss.arx = -0.55;
    boss.alz = boss.arz = 0.25;
    boss.head = Math.sin(t * 2.1) * 0.04;
    return;
  }
  if (mood === 'joy') {
    // He is off down the touchline, fists going; the bench is up in a wave.
    const up = sm(0, 0.16, h);
    const run = sm(0.5, 1.7, h);
    boss.x = DUG_BOSS_X + 1.0 * run;
    boss.yaw = 0.5 * Math.sin(run * Math.PI);
    boss.y = hop(h, 9) * 0.2 * up;
    const moving = run > 0.02 && run < 0.98 ? 1 : 0;
    boss.legL = Math.sin(h * 14) * 0.7 * moving;
    boss.legR = -Math.sin(h * 14) * 0.7 * moving;
    boss.alx = -0.3; boss.arx = 0.3;
    boss.alz = 2.5 + Math.sin(h * 15) * 0.35;
    boss.arz = 2.5 - Math.sin(h * 15) * 0.35;
    boss.head = 0.2;
    for (let i = 0; i < 3; i++) {
      const p = ps[1 + i];
      const k = sm(0.08 + i * 0.12, 0.26 + i * 0.12, h);
      p.sit = 1 - k;
      p.lean = mix(-0.28, 0.06, k);
      p.y += k * 0.2 + hop(h + i * 0.2, 9) * 0.18 * k;
      arms(p, 0.4, mix(0.8, 2.75, k));
    }
    return;
  }
  // A goal against: side on to the lens, hands to his head, and the water bottle gets it.
  const k = sm(0, 0.3, h);
  boss.yaw = (Math.PI / 2) * k;
  boss.head = -0.2 * k;
  arms(boss, 0.95 * k, mix(0, 2.55, k * (1 - sm(1.5, 1.8, h))));
  for (let i = 0; i < 3; i++) {
    const p = ps[1 + i];
    p.head = -0.3 * k;
    if (i === 1) {
      p.arx = -0.95 * k;
      p.arz = mix(0.8, 2.35, k);
    }
  }
  bottleKick(boss, ps, v, h, 0.9);
}

/** The red card's walk (figure 4): along the touchline past his manager, who has a few things to say. */
function redcardPose(t: number, ps: PuppetPose[], v: Float32Array): void {
  const boss = stand(ps[0], DUG_BOSS_X + 0.3, 0.15);
  benchSeats(ps);
  setProp(v, 0, DUG_BOSS_X + 0.8, 0.14, 0.75);
  const px = mix(3.1, -3.1, clamp01(t / SIDE_S));
  const pz = 1.0;
  const man = stand(ps[4], px, pz, -Math.PI / 2);
  man.head = -0.38;
  man.lean = -0.1;
  man.legL = Math.sin(t * 8) * 0.55;
  man.legR = -Math.sin(t * 8) * 0.55;
  man.alz = -Math.sin(t * 8) * 0.25;
  man.arz = Math.sin(t * 8) * 0.25;
  // The manager turns with him as he goes by, both hands doing the talking, stamping; then asks the bench.
  const beat = Math.sin(t * 5.3);
  const after = sm(2.2, 2.5, t);
  boss.yaw = mix(Math.atan2(px - boss.x, pz - boss.z) * 0.8, 1.1, after);
  boss.y = hop(t, 7) * 0.07 * (1 - after);
  boss.alx = -0.7; boss.aly = -0.35;
  boss.alz = 0.75 + Math.max(0, beat) * 0.75;
  boss.arx = 0.65; boss.ary = 0.35;
  boss.arz = 0.7 + Math.max(0, -beat) * 0.9;
  boss.twist = beat * 0.14;
  boss.headYaw = Math.sin(t * 6.4) * 0.14;
  if (after > 0) arms(boss, 1.2, mix(1.0, 1.25, after));
  for (let i = 0; i < 3; i++) {
    const p = ps[1 + i];
    p.headYaw = clamp01(Math.abs(px - p.x) < 3 ? 1 : 0) * Math.atan2(px - p.x, 1.6) * 0.7;
    p.head = -0.1;
    if (i === 2) {
      // (One of them cannot watch.)
      p.arx = -0.95;
      p.arz = 2.35;
      p.headYaw = 0;
      p.head = -0.3;
    }
  }
}

/** The referee's tossing hand (he faces the lens: his right is screen left), and when a bad toss lands on his head. */
const COIN_HAND_X = -0.43;
const COIN_HAND_Y = 1.38;
export const COIN_BONK_F = 0.81;

/** Props: 0 the coin. Figures: 0 your captain (screen left), 1 theirs, 2 the referee between and behind them. */
function coinPose(variant: number, t: number, ps: PuppetPose[], v: Float32Array): void {
  const step = sm(0, 0.3, t) * (1 - sm(0.9, 1.15, t));
  const c0 = stand(ps[0], -1.05 + 0.4 * step, 0.25, 1.2);
  const c1 = stand(ps[1], 1.05 - 0.4 * step, 0.25, -1.2);
  const ref = stand(ps[2], 0, -0.5);
  // The handshake (right hands), a good firm one.
  const grip = sm(0.15, 0.35, t) * (1 - sm(0.85, 1.0, t));
  const shake = t > 0.35 && t < 0.85 ? Math.sin(t * 20) * 0.13 : 0;
  c0.arz = c1.arz = 1.35 * grip + shake;
  // The coin: up off the referee's thumb, turning, and everybody watches it.
  const f = t - 1.05;
  const flick = sm(1.0, 1.12, t);
  ref.arz = mix(0.9, 2.5, flick) * (1 - sm(1.4, 1.7, t) * 0.6);
  ref.arx = -0.2;
  const air = f > 0 && f < 1;
  const look = air ? Math.sin(Math.PI * f) * 0.5 : 0;
  ref.head = c0.head = c1.head = look;
  // (His hand is at about COIN_HAND_Y with the arm up; the bad toss drifts over his own head and meets it at COIN_BONK_F.)
  const catchF = variant === 0 ? 1 : COIN_BONK_F;
  const coinY = COIN_HAND_Y + 3.6 * f - 3.6 * f * f;
  const drift = variant === 0 ? 0 : COIN_HAND_X * (1 - clamp01(f / COIN_BONK_F));
  if (f <= 0) setProp(v, 0, COIN_HAND_X, COIN_HAND_Y, -0.24, 0, 0, 0, t > 1);
  else if (f < catchF) setProp(v, 0, variant === 0 ? COIN_HAND_X : drift, coinY, -0.24 - (variant === 0 ? 0 : 0.2 * f), f * 30, 0, 0.3);
  else setProp(v, 0, 0, 0, 0, 0, 0, 0, false);
  if (f < catchF) return;
  const g = f - catchF;
  if (variant === 0) {
    // Caught, and he points to the winner (yours): a fist pump one side, a shrug the other.
    const k = sm(0, 0.15, g);
    ref.arx = -1.35 * k; ref.arz = 0.3;
    ref.alz = 0.3;
    c0.y = hop(g, 9) * 0.16 * k;
    arms(c0, 0.4, mix(0, 2.7, k));
    c0.yaw = mix(1.2, 0.3, k);
    arms(c1, 0.95 * k, 0.55 * k);
    c1.headRoll = 0.22 * k;
    c1.yaw = mix(-1.2, -0.5, k);
    return;
  }
  // It comes down on the referee's head, and off into the grass: he rubs it, and the captains cannot keep straight faces.
  const y = TALL_M + 0.06 + 1.7 * g - 3.6 * g * g;
  setProp(v, 0, 0.9 * g, Math.max(0.04, y), -0.4 + 0.7 * g, y > 0.04 ? g * 18 : 0, 0, y > 0.04 ? 0.3 : Math.PI / 2);
  const ouch = sm(0, 0.1, g);
  ref.head = -0.3 * ouch * (1 - sm(0.3, 0.6, g)) - 0.08;
  ref.y = -0.04 * Math.sin(Math.min(g, 0.3) / 0.3 * Math.PI);
  ref.arx = -0.55 * ouch;
  ref.arz = mix(1.0, 2.5, ouch) + Math.sin(g * 14) * 0.1;
  c0.y = hop(g, 10) * 0.07 * ouch;
  c1.y = hop(g + 0.17, 10) * 0.07 * ouch;
  c0.lean = c1.lean = 0.16 * ouch;
  c0.head = c1.head = 0.2 * ouch;
  c0.yaw = mix(1.2, 0.6, ouch);
  c1.yaw = mix(-1.2, -0.6, ouch);
  c1.alz = 1.45 * ouch;
  c0.arx = -0.7 * ouch;
  c0.arz = 2.2 * ouch;
}

/** The ball on the stage: its radius (m), drawn as big as the match draws it so it reads in a small picture. */
export const BALL_M = 0.25;

/** The goal line is this far behind the spot's patch of grass (stage z). */
export const PEN_GOAL_Z = -3.1;
export const PEN_BALL_Z = 0.5;
export const PEN_BALL_X = -0.05;

/** Figures: 0 the taker, back to the lens; 1 the keeper on his line. Prop 0: the ball. */
function penaltyPose(t: number, ps: PuppetPose[], v: Float32Array): void {
  // The taker puts it down just so, walks back, and breathes.
  const down = 1 - sm(0.55, 0.95, t);
  const back = sm(0.95, 1.7, t);
  // (He comes at it from the left, so the lens over his right shoulder keeps the ball in the picture.)
  const taker = stand(ps[0], mix(-0.3, -0.95, back), 1.3 + 0.75 * back, Math.PI - 0.3 * back);
  taker.lean = -1.0 * down;
  taker.y = -0.12 * down;
  taker.alz = taker.arz = 0.9 * down;
  const walking = back > 0.02 && back < 0.98 ? 1 : 0;
  taker.legL = Math.sin(t * 11) * 0.5 * walking;
  taker.legR = -Math.sin(t * 11) * 0.5 * walking;
  const breath = sm(1.8, 2.2, t);
  taker.lean += 0.08 * Math.sin(breath * Math.PI);
  taker.alx = 0.5 * breath; taker.arx = -0.5 * breath;
  taker.alz += 0.22 * breath; taker.arz += 0.22 * breath;
  taker.y += hop(t, 6) * 0.03 * breath;
  setProp(v, 0, PEN_BALL_X, BALL_M, PEN_BALL_Z, 0, (1 - sm(0, 0.6, t)) * 2.5, 0);
  // The keeper: big, busy, side to side along his line; then the wobbly legs.
  const keeper = stand(ps[1], Math.sin(t * 3.1) * 0.75, PEN_GOAL_Z + 0.15);
  const jelly = sm(1.5, 1.7, t) * (1 - sm(2.5, 2.7, t));
  keeper.y = hop(t, 6.2) * 0.13 * (1 - jelly);
  keeper.spread = 0.3;
  keeper.alx = 1.05 + Math.sin(t * 6.2) * 0.3;
  keeper.arx = -1.05 - Math.sin(t * 6.2) * 0.3;
  keeper.alz = keeper.arz = 1.3;
  keeper.legL = Math.sin(t * 21) * 0.5 * jelly;
  keeper.legR = -Math.sin(t * 21) * 0.5 * jelly;
  keeper.roll = Math.sin(t * 10.5) * 0.13 * jelly;
  keeper.x *= 1 - jelly;
}

/** Figures: 0 the scorer with the match ball (prop 0), 1 and 2 team-mates applauding him. */
function matchballPose(t: number, ps: PuppetPose[], v: Float32Array): void {
  const me = stand(ps[0], 0, 0.3);
  for (let i = 1; i < 3; i++) {
    const side = i === 1 ? -1 : 1;
    const p = stand(ps[i], side * 1.2, -0.25, -side * 0.5);
    const c = 0.5 + 0.5 * Math.sin((t + i * 0.2) * 16);
    p.aly = -0.25 - 0.5 * c;
    p.ary = 0.25 + 0.5 * c;
    p.alz = p.arz = 1.4;
    p.y = -0.02 * c + 0.02;
  }
  const lift = sm(0.4, 0.9, t) * (1 - sm(1.6, 1.9, t));
  const kiss = sm(1.6, 1.9, t) * (1 - sm(2.15, 2.4, t));
  const tuck = sm(2.15, 2.5, t);
  const hold = 1 - tuck;
  me.y = hop(t - 0.9, 8) * 0.14 * (t > 0.9 && t < 1.65 ? 1 : 0);
  const up = 1.25 + 1.55 * lift + 0.95 * kiss;
  me.alx = (up > 1.57 ? 0.28 : -0.28) * hold; me.arx = -me.alx;
  me.alz = me.arz = up * hold;
  me.head = 0.25 * lift - 0.18 * kiss;
  const chestY = HIP_M + 0.62;
  const by = chestY + 1.3 * lift + 0.72 * kiss;
  const bz = 0.3 + 0.56 - 0.4 * lift + 0.04 * kiss;
  setProp(v, 0, mix(0, -0.56, tuck), mix(by, HIP_M + 0.46, tuck), mix(bz, 0.46, tuck), 0, t * 0.6, 0);
  if (tuck > 0) {
    // Under his arm, where it is staying, and a thumb up for the lens.
    me.arx = -0.25 * tuck; me.arz = 0.45 * tuck;
    me.alx = -0.45 * tuck;
    me.alz = (2.5 + Math.sin(t * 11) * 0.18) * tuck;
    me.head = 0.1;
  }
}

/** What a side show looks like right now: the kind's figures and loose things at `t` s in, `h` s after the goal went in (< 0: not yet). */
export function sidePose(kind: SideKind, mood: SideMood, variant: number, t: number, h: number, ps: PuppetPose[], v: Float32Array): void {
  for (let i = 0; i < ps.length; i++) ps[i].on = false;
  for (let j = 0; j < PROP_MAX; j++) v[j * PROP_F + 6] = 0;
  switch (kind) {
    case 'box': boxPose((mood === 'joy' ? BOX_JOY : BOX_GROAN)[variant] ?? 'leap', t, h, ps, v); break;
    case 'fans': fansPose(mood, t, h, ps, v); break;
    case 'dugout': dugoutPose(mood, t, h, ps, v); break;
    case 'redcard': redcardPose(t, ps, v); break;
    case 'coin': coinPose(variant, t, ps, v); break;
    case 'penalty': penaltyPose(t, ps, v); break;
    case 'matchball': matchballPose(t, ps, v); break;
  }
}

// ------------------------------------------------------------------ the director

/** What the stage is asked to show. `cast`: the real players (and whose kit each wears), in the kind's figure order. */
export interface SideCue {
  kind: SideKind;
  mood: SideMood;
  /** Which reaction (box: an index into BOX_JOY / BOX_GROAN) or which ending (the coin: 0 caught, 1 off the referee's head). */
  variant: number;
  /** The whole screen (a big goal's commentary cut) instead of the corner. */
  full: boolean;
  label: string;
  /** The headline under the tag, full screen only. */
  line: string;
  /** Whose colours the set wears (the desk's trim, the seats, the dugout roof). */
  side: Side;
  kits: [Kit, Kit];
  cast: { def: PlayerDef; side: Side; keeper: boolean }[];
  /** The studio's wall screen: the fixture, the score and the scorer. */
  screen: { home: string; away: string; score: [number, number]; scorer: string } | null;
  /** Seconds since it came up, and since the ball went in (-1 before). */
  t: number;
  h: number;
}

/** The picture (render/sideStage.ts; a recording fake in tests). */
export interface SidePicture {
  begin(c: SideCue): void;
  frame(c: SideCue, dt: number): void;
  end(): void;
}

/** Once a frame, from the session: what is on the screen and in the match. One object, filled in place. */
export interface SideFacts {
  dt: number;
  /** The session's own clock (s). */
  time: number;
  m: Match;
  /** A goal's replay is playing, and its ball has gone in. */
  goalReplay: boolean;
  replayHit: boolean;
  /** An incident recap is playing or waiting. */
  incident: boolean;
  /** Another staged scene has the screen (the line-up, a substitution, the tunnel, the award, a card), or a set piece is being aimed. */
  busy: boolean;
  /** The pre-match fly-in is on. */
  intro: boolean;
  /** The full-time scene on now ('sportsmanship' takes the match ball), or ''. */
  interlude: string;
  /** The goal's celebration or replay was skipped. */
  goalSkipped: boolean;
}

export type SideSink = Pick<Sfx, 'click' | 'whoosh' | 'flop' | 'coin' | 'highFive' | 'applause' | 'groan' | 'ooh' | 'cheer' | 'thump' | 'whip' | 'crowdWhistles' | 'sting'>;
type Sound = 'click' | 'whoosh' | 'flop' | 'coin' | 'slap' | 'clap' | 'groan' | 'ooh' | 'cheer' | 'thump' | 'whip' | 'whistles' | 'ident';

/** Each reaction's sounds: [seconds after the goal goes in, what]. */
const BOX_SOUNDS: Record<BoxReaction, readonly (readonly [number, Sound])[]> = {
  leap: [[0, 'cheer']],
  chair: [[0, 'cheer'], [0.72, 'flop']],
  headset: [[0.25, 'whip'], [0.3, 'cheer']],
  papers: [[0.06, 'whoosh'], [0.5, 'cheer']],
  five: [[0.32, 'slap'], [0.5, 'cheer']],
  spin: [[0, 'whoosh'], [0.2, 'cheer']],
  facepalm: [[0.25, 'slap'], [0.3, 'groan']],
  headdesk: [[0.38, 'thump'], [0.45, 'groan']],
  sink: [[0.2, 'groan']],
};
const KIND_SOUNDS: Record<Exclude<SideKind, 'box'>, Record<SideMood, readonly (readonly [number, Sound])[]>> = {
  fans: { joy: [[0, 'cheer'], [0.1, 'whip']], groan: [[0.1, 'groan'], [0.95, 'flop']] },
  dugout: { joy: [[0, 'clap']], groan: [[0.2, 'groan'], [0.9, 'thump']] },
  coin: { joy: [[0.34, 'slap'], [1.05, 'coin'], [2.05, 'coin']], groan: [[0.34, 'slap'], [1.05, 'coin'], [1.86, 'slap'], [1.95, 'ooh']] },
  penalty: { joy: [[0.1, 'whistles']], groan: [[0.1, 'whistles']] },
  redcard: { joy: [[0.2, 'whistles']], groan: [[0.2, 'whistles']] },
  matchball: { joy: [[0.1, 'clap'], [0.9, 'cheer']], groan: [[0.1, 'clap']] },
};

export interface SideOptions {
  /** Settings > SIDE SHOWS (default on). */
  enabled: boolean;
  kits: [Kit, Kit];
  humanSide: Side;
  /** A knockout tie: taking the lead in the second half is a big goal. */
  knockout?: boolean;
  /** A side's captain (a player index), for the coin toss. */
  captain: (side: Side) => number;
  /** 0..1 (Math.random; a fixed sequence in tests). Presentation only: never the sim's generator. */
  rng?: () => number;
}

interface PendingGoal {
  side: Side;
  scorer: number;
  mood: SideMood;
  big: BigGoal | null;
  fullAsked: boolean;
  fullShown: boolean;
  replaySeen: boolean;
}

export class SideShow {
  private cur: SideCue | null = null;
  private curSounds: readonly (readonly [number, Sound])[] = [];
  private soundI = 0;
  private dur = 0;
  private readonly counts: Record<SideKind, number> = { box: 0, fans: 0, dugout: 0, coin: 0, penalty: 0, redcard: 0, matchball: 0 };
  private fulls = 0;
  private fullAt = -999;
  private lastGoalKind: SideKind | '' = '';
  private goal: PendingGoal | null = null;
  private red: { player: number; at: number } | null = null;
  private readonly goals = new Map<number, number>();
  private superAt: [number, number] = [-99, -99];
  private coinAsked = false;
  private penaltyOn = false;
  private time = 0;
  /** The reactions not used yet this time round, per mood: all of them are seen before one comes back. */
  private readonly bags: Record<SideMood, number[]> = { joy: [], groan: [] };
  private readonly rng: () => number;

  constructor(private readonly picture: SidePicture, private readonly opt: SideOptions, private readonly out: SideSink = sfx) {
    this.rng = opt.rng ?? Math.random;
  }

  /** Settings > SIDE SHOWS, changed mid-match: off takes down whatever is up. */
  setEnabled(on: boolean): void {
    if (!on) this.reset();
    this.opt.enabled = on;
  }

  /** The cue on now (the dev panel, tests). */
  get current(): SideCue | null {
    return this.cur;
  }

  /** A full-screen cut is on: the match is not drawn under it. */
  get full(): boolean {
    return !!this.cur?.full;
  }

  get state(): { kind: string; full: boolean; counts: Record<SideKind, number>; fulls: number } {
    return { kind: this.cur?.kind ?? '', full: this.full, counts: { ...this.counts }, fulls: this.fulls };
  }

  /** A sim step's events: goals (who, and whether it is a big one), SUPER SHOTS, red cards. */
  events(evs: readonly MatchEvent[], m: Match): void {
    if (!this.opt.enabled) return;
    for (const e of evs) {
      if (e.type === 'superShot') this.superAt[e.side] = this.time;
      else if (e.type === 'card' && e.color === 'red') this.red = { player: e.player, at: this.time };
      else if (e.type === 'goal') {
        const n = e.own ? 0 : (this.goals.get(e.scorer) ?? 0) + 1;
        if (!e.own) this.goals.set(e.scorer, n);
        const us = this.opt.humanSide;
        const ours = e.side === us;
        const lead = m.score[us] - m.score[us === 0 ? 1 : 0];
        const hl = m.cfg.halfLength;
        let big: BigGoal | null = null;
        if (ours && !e.own) {
          if (n === 3) big = 'hattrick';
          else if (this.time - this.superAt[e.side] < SUPER_WINDOW_S) big = 'super';
          else if (m.half >= 2 && hl > 0 && m.clock / hl >= LATE_FROM && (lead === 0 || lead === 1)) big = 'late';
          else if (this.opt.knockout && m.half >= 2 && lead === 1) big = 'cup';
        }
        this.goal = { side: e.side, scorer: e.scorer, mood: ours ? 'joy' : 'groan', big, fullAsked: false, fullShown: false, replaySeen: false };
      }
    }
  }

  /**
   * The session, when a goal's replay is due: true while the commentary box has the whole screen first (a big goal,
   * FULL_CAP a match, FULL_GAP_S apart). It starts the cut the first time it is asked.
   */
  holdsReplay(m: Match): boolean {
    const g = this.goal;
    if (!this.opt.enabled || !g) return false;
    if (this.cur?.full) return true;
    if (g.fullAsked) return false;
    g.fullAsked = true;
    if (!g.big || this.fulls >= FULL_CAP || this.time - this.fullAt < FULL_GAP_S || this.counts.box >= SIDE_CAPS.box) return false;
    this.end();
    this.fulls++;
    this.fullAt = this.time;
    g.fullShown = true;
    this.start(this.goalCue('box', g, m, true), BOX_FULL_S);
    this.play('ident', g.side);
    return true;
  }

  /** Once a frame (dt 0 while paused). */
  frame(f: SideFacts): void {
    if (!this.opt.enabled) return;
    this.time = f.time;
    if (this.devCue) {
      this.devStep(f.dt);
      if (this.cur && this.cur.t >= this.dur) this.end();
      return;
    }
    const m = f.m;
    const g = this.goal;
    // The goal is over (kicked off again, or skipped with no replay): forget it.
    if (g && m.phase !== 'goal' && !f.goalReplay) {
      this.goal = null;
      if (this.cur && this.isGoalKind(this.cur.kind)) this.end();
    }
    if (this.red && this.time - this.red.at > RED_WAIT_S) this.red = null;
    const c = this.cur;
    if (c) {
      c.t += f.dt;
      if (c.full) {
        c.h = c.t - FULL_REACT_AT;
        if (c.t >= this.dur || f.goalSkipped || m.phase !== 'goal') this.end();
      } else if (this.isGoalKind(c.kind)) {
        if (f.replayHit && c.h < 0) c.h = 0;
        else if (c.h >= 0) c.h += f.dt;
        if (!f.goalReplay) this.end();
      } else {
        c.h = c.t;
        const gone = c.kind === 'penalty' ? !this.penaltyPrep(m) || f.incident || f.busy : c.kind === 'matchball' ? f.interlude !== 'sportsmanship' : f.busy || f.goalReplay || f.incident;
        if (c.t >= this.dur || gone) this.end();
      }
      if (this.cur) {
        while (this.soundI < this.curSounds.length && c.h >= this.curSounds[this.soundI][0]) this.play(this.curSounds[this.soundI++][1], c.side);
        this.picture.frame(c, f.dt);
      }
    }
    if (this.cur) return;
    // A goal's replay has started: the commentary box, the fans or the dugout in the corner (or nothing).
    if (g && f.goalReplay && !g.replaySeen) {
      g.replaySeen = true;
      const kind = g.fullShown ? '' : this.pickGoalKind();
      if (kind) this.start(this.goalCue(kind, g, m, false), 99);
      return;
    }
    if (f.goalReplay || f.incident) return;
    const pen = this.penaltyPrep(m);
    if (!pen) this.penaltyOn = false;
    if (f.interlude === 'sportsmanship') {
      const hero = this.hatTrickHero(m);
      if (hero >= 0 && this.counts.matchball < SIDE_CAPS.matchball) this.start(this.matchballCue(hero, m), SIDE_S);
      return;
    }
    if (f.busy) return;
    if (f.intro && !this.coinAsked && m.half === 1 && m.phase === 'kickoff') {
      this.coinAsked = true;
      if (this.rng() < COIN_CHANCE) this.start(this.coinCue(m), SIDE_S);
    } else if (pen && !this.penaltyOn && this.counts.penalty < SIDE_CAPS.penalty) {
      this.penaltyOn = true;
      this.start(this.penaltyCue(m), SIDE_S + 0.4);
    } else if (this.red && this.counts.redcard < SIDE_CAPS.redcard && (m.phase === 'restart' || m.phase === 'out' || m.phase === 'play')) {
      const cue = this.redcardCue(this.red.player, m);
      this.red = null;
      if (cue) this.start(cue, SIDE_S);
    }
  }

  /** The session is over (or a checkpoint was restored): nothing on, nothing pending. */
  reset(): void {
    this.end();
    this.goal = null;
    this.red = null;
  }

  /** Dev (window.__bl.session.sideShow.dev): show one now, whatever the caps say. */
  dev(kind: SideKind, m: Match, mood: SideMood = 'joy', variant = 0, full = false): void {
    this.end();
    const g: PendingGoal = { side: this.opt.humanSide, scorer: m.teamPlayers(this.opt.humanSide)[9]?.idx ?? 0, mood, big: full ? 'late' : null, fullAsked: true, fullShown: full, replaySeen: true };
    const cue = kind === 'coin' ? this.coinCue(m) : kind === 'penalty' ? this.penaltyCue(m, true) : kind === 'redcard' ? this.redcardCue(g.scorer, m)
      : kind === 'matchball' ? this.matchballCue(g.scorer, m) : this.goalCue(kind, g, m, full);
    if (!cue) return;
    if (kind === 'box' || kind === 'coin') cue.variant = variant;
    if (kind === 'coin') cue.mood = variant === 0 ? 'joy' : 'groan';
    cue.full = full;
    this.start(cue, kind === 'box' && full ? BOX_FULL_S : SIDE_S + 0.6);
    // (No replay to follow: the goal goes in a moment after the picture comes up.)
    this.devHit = this.isGoalKind(kind);
    this.devCue = true;
  }

  /** Dev: a forced picture runs on its own clock; a forced goal picture has no replay to tell it the ball went in. */
  private devCue = false;
  private devHit = false;

  /** Dev: move a forced picture on by `dt` s (no session facts needed). */
  private devStep(dt: number): void {
    const c = this.cur;
    if (!c) return;
    c.t += dt;
    c.h = this.devHit ? c.t - (c.full ? FULL_REACT_AT : 0.6) : c.t;
    while (this.soundI < this.curSounds.length && c.h >= this.curSounds[this.soundI][0]) this.play(this.curSounds[this.soundI++][1], c.side);
    this.picture.frame(c, dt);
  }

  private isGoalKind(k: SideKind): boolean {
    return k === 'box' || k === 'fans' || k === 'dugout';
  }

  private penaltyPrep(m: Match): boolean {
    return m.phase === 'restart' && m.restart?.kind === 'penalty';
  }

  /**
   * Which picture a goal's replay gets: the box for the first; then never the same twice running, each under its cap,
   * the box likeliest; and one replay in five keeps the whole screen.
   */
  private pickGoalKind(): SideKind | '' {
    const first = this.counts.box + this.counts.fans + this.counts.dugout === 0;
    if (first) return 'box';
    if (this.rng() < CLEAN_REPLAY_CHANCE) {
      this.lastGoalKind = '';
      return '';
    }
    const weights: [SideKind, number][] = [['box', 3], ['fans', 2], ['dugout', 2]];
    let total = 0;
    for (const w of weights) {
      if (w[0] === this.lastGoalKind || this.counts[w[0]] >= SIDE_CAPS[w[0]]) w[1] = 0;
      total += w[1];
    }
    if (total <= 0) return '';
    let r = this.rng() * total;
    for (const [k, w] of weights) {
      r -= w;
      if (w > 0 && r < 0) return k;
    }
    return weights.find((w) => w[1] > 0)?.[0] ?? '';
  }

  /** The next reaction for a mood: a shuffled round of them all, never the same one twice running. */
  private nextReaction(mood: SideMood): number {
    const n = (mood === 'joy' ? BOX_JOY : BOX_GROAN).length;
    const bag = this.bags[mood];
    if (!bag.length) {
      for (let i = 0; i < n; i++) bag.push(i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.min(i, Math.floor(this.rng() * (i + 1)));
        const s = bag[i];
        bag[i] = bag[j];
        bag[j] = s;
      }
      // (A new round never opens with the one the last round closed on.)
      if (n > 1 && bag[bag.length - 1] === this.lastReaction[mood]) bag.unshift(bag.pop()!);
    }
    const r = bag.pop()!;
    this.lastReaction[mood] = r;
    return r;
  }

  private readonly lastReaction: Record<SideMood, number> = { joy: -1, groan: -1 };

  private cue(kind: SideKind, mood: SideMood, side: Side): SideCue {
    return {
      kind, mood, variant: 0, full: false, label: SIDE_LABEL[kind], line: '', side, kits: this.opt.kits, cast: [], screen: null, t: 0, h: -1,
    };
  }

  private goalCue(kind: SideKind, g: PendingGoal, m: Match, full: boolean): SideCue {
    const us = this.opt.humanSide;
    const c = this.cue(kind, g.mood, us);
    c.full = full;
    if (kind === 'box') {
      c.variant = this.nextReaction(g.mood);
      c.line = full && g.big ? BIG_LINE[g.big] : '';
      const who = m.players[g.scorer]?.def.name ?? '';
      c.screen = { home: m.teams[0].short, away: m.teams[1].short, score: [m.score[0], m.score[1]], scorer: who.split(' ').pop() ?? who };
    } else if (kind === 'dugout') {
      for (const def of m.bench[us].slice(0, 3)) c.cast.push({ def, side: us, keeper: false });
    }
    return c;
  }

  private coinCue(m: Match): SideCue {
    const us = this.opt.humanSide;
    const them = (us === 0 ? 1 : 0) as Side;
    const c = this.cue('coin', 'joy', us);
    for (const s of [us, them]) {
      const p = m.players[this.opt.captain(s)] ?? m.teamPlayers(s)[9];
      c.cast.push({ def: p.def, side: s, keeper: p.isKeeper });
    }
    c.variant = this.rng() < 0.5 ? 0 : 1;
    c.mood = c.variant === 0 ? 'joy' : 'groan';
    return c;
  }

  private penaltyCue(m: Match, dev = false): SideCue {
    const side = dev ? this.opt.humanSide : (m.restart?.side ?? this.opt.humanSide);
    const other = (side === 0 ? 1 : 0) as Side;
    const c = this.cue('penalty', 'joy', other);
    const taker = (dev ? undefined : m.players[m.restart?.taker ?? -1]) ?? m.teamPlayers(side)[9];
    const keeper = m.teamPlayers(other).find((p) => p.isKeeper) ?? m.teamPlayers(other)[0];
    c.cast.push({ def: taker.def, side, keeper: false }, { def: keeper.def, side: other, keeper: true });
    return c;
  }

  private redcardCue(player: number, m: Match): SideCue | null {
    const p = m.players[player];
    if (!p) return null;
    const c = this.cue('redcard', 'groan', p.side);
    for (const def of m.bench[p.side].slice(0, 3)) c.cast.push({ def, side: p.side, keeper: false });
    // (Figure 4 is the man himself, after the bench: fewer than three substitutes leaves seats empty.)
    while (c.cast.length < 3) c.cast.push({ def: p.def, side: p.side, keeper: false });
    c.cast.push({ def: p.def, side: p.side, keeper: p.isKeeper });
    return c;
  }

  private matchballCue(hero: number, m: Match): SideCue {
    const p = m.players[hero];
    const c = this.cue('matchball', 'joy', p.side);
    c.cast.push({ def: p.def, side: p.side, keeper: p.isKeeper });
    for (const mate of m.teamPlayers(p.side)) {
      if (c.cast.length >= 3) break;
      if (mate.idx !== hero && !mate.isKeeper && !mate.sentOff) c.cast.push({ def: mate.def, side: p.side, keeper: false });
    }
    return c;
  }

  /** Whoever scored three or more (the most, if two did), still on the pitch: -1 if nobody. */
  private hatTrickHero(m: Match): number {
    let best = -1;
    let most = 2;
    for (const [idx, n] of this.goals) {
      if (n > most && m.players[idx] && !m.players[idx].sentOff) {
        most = n;
        best = idx;
      }
    }
    return best;
  }

  private start(c: SideCue, dur: number): void {
    this.cur = c;
    this.dur = dur;
    this.soundI = 0;
    this.devHit = false;
    this.curSounds = c.kind === 'box' ? BOX_SOUNDS[(c.mood === 'joy' ? BOX_JOY : BOX_GROAN)[c.variant] ?? 'leap'] : KIND_SOUNDS[c.kind][c.mood];
    this.counts[c.kind]++;
    if (this.isGoalKind(c.kind)) this.lastGoalKind = c.kind;
    this.picture.begin(c);
    if (!c.full) this.play('click', c.side);
  }

  private end(): void {
    if (!this.cur) return;
    this.cur = null;
    this.devCue = false;
    this.picture.end();
  }

  private play(s: Sound, side: Side): void {
    const o = this.out;
    switch (s) {
      case 'click': o.click(); break;
      case 'whoosh': o.whoosh(); break;
      case 'flop': o.flop(); break;
      case 'coin': o.coin(); break;
      case 'slap': o.highFive(); break;
      case 'clap': o.applause(0.5, side); break;
      case 'groan': o.groan(0.45, side); break;
      case 'ooh': o.ooh(); break;
      case 'cheer': o.cheer(0.5); break;
      case 'thump': o.thump(); break;
      case 'whip': o.whip(); break;
      case 'whistles': o.crowdWhistles(0.55, side, false); break;
      case 'ident': o.sting('studio'); break;
    }
  }
}
