import { angleDiff, clamp, dist2 } from '../core/math';
import { TEMPO } from './constants';
import type { Match, Pad } from './match';
import type { Player } from './player';
import type { Side } from './types';

/**
 * Dribble and tackle assists for the human's man (arcade-generous, DLS / FIFA-assisted feel). Everything
 * here acts only on the human-controlled player, on defenders he beats, or on tackles against his carrier,
 * so AI-vs-AI play never reaches it. Randomness comes from `m.rng` only.
 *
 * Dribbling (humanDribble, called from Match.applyHuman while he has the ball):
 * - close control: jogging with it (no sprint) the ball sits tighter on his foot (closeTouch) and he turns
 *   CLOSE_TURN x quicker (Player.locomote); sprinting keeps the long touches;
 * - skill cut: a sharp stick change (over CUT_SWING within CUT_WINDOW s) is a quick burst turn (Player.cutT)
 *   with the ball kept close; a defender within CUT_REACH m who has committed to him (closing at speed,
 *   lunging, going in for the tackle) is wrong-footed (wrongFoot: planted the wrong way for 0.35-0.5 s), a
 *   'beat', and the dribbler is protected from a clean tackle for PROTECT_T s; the move is a 'skill';
 * - shielding: stick neutral (or running away from him) with a defender within SHIELD_R m, the body goes
 *   between ball and defender (Player.shieldT) and his tackles mostly fail;
 * - path assist: a defender square in the run within PATH_R m bends it up to PATH_BEND toward the free side.
 *
 * Defending (humanTackle, from applyHuman while the other side has it): SHOOT is TACKLE.
 * - PRESS with the ball already in reach (STAND_REACH m off his boot): the assisted standing tackle goes in
 *   on that frame, no wind-up;
 * - TAP within TAP_LUNGE m: an instant lunge at the ball (LUNGE_SPEED) and the poke the moment it's in reach;
 * - TAP from TAP_LUNGE..TAP_CLOSE m: he closes at a sprint and pokes on arrival (within CLOSE_T s; pulling
 *   the stick hard away cancels it);
 * - HOLD (SLIDE_HOLD s, the ball not yet in reach when pressed), double-tap, a TAP with SPRINT held, or a TAP
 *   with the carrier AUTO_SLIDE_MIN..MAX m off and getting away (moving away or across faster than a standing
 *   reach can follow): a slide (Match.startSlide), aimed where the ball will be, the human's long forgiving one;
 * - every committed press (the lunge / closing run, or the slide) is a 'tackleTry' event (render / HUD);
 * - every press is answered in words too (the 'tackleCue' event: TACKLE!, TOO FAR, MISTIMED, FROM BEHIND);
 * - PRESS (THROUGH held, whatever the stick is doing unless it is pulled hard away): he closes the carrier down flat
 *   out and jockeys goal-side PRESS_GAP m off the ball, facing it, plus pressSteal, an automatic poke when the
 *   carrier's touch leaves the ball exposed and our man is nearer it; and the nearest team-mate comes to press with
 *   him (Match.pressHelp, ai.ts pickPresser). Running into the carrier still tackles on its own (Match.autoTackle),
 *   a little less surely.
 *
 * The AI against the human (vsHuman, by difficulty): how readily it goes in on his dribbler and how often
 * that comes off, how its carriers stand up to his tackles and take his man on, how his skill cuts fare.
 */

/** Stick swing (rad) within CUT_WINDOW s that reads as a skill cut, and how far it must be off his run. */
export const CUT_SWING = (75 * Math.PI) / 180;
export const CUT_WINDOW = 0.15;
const CUT_OFF_RUN = 0.8;
/** The cut's burst turn (s), and the least time between two cuts. */
export const CUT_T = 0.25;
const CUT_COOL = 0.4;
/** Defenders within this of the dribbler can be wrong-footed by a cut. */
export const CUT_REACH = 3;
/** Wrong-footed: planted the wrong way this long (scaled by our dribbling against his defending). */
export const WRONG_FOOT_MIN = 0.35;
export const WRONG_FOOT_MAX = 0.5;
/** After beating his man with a skill, the dribbler can't be tackled cleanly for this long. */
export const PROTECT_T = 0.6;
/** Shielding: a defender this close, the stick neutral or pulling away from him. */
export const SHIELD_R = 1.6;
/** A shielding carrier's tackles succeed this much as often (from the far side of his body). */
const SHIELD_TACKLE = 0.4;
/** No ground gained for this long: the AI closes down a time-wasting human and begins reading his shield. */
export const STALL_S = 3;
/** Just after a successful skill, tackles on him succeed this much as often. */
const PROTECT_TACKLE = 0.15;
/** For RECEIVE_GUARD_T s after he takes the ball, tackles on him succeed RECEIVE_GUARD as often. */
const RECEIVE_GUARD_T = 0.5;
const RECEIVE_GUARD = 0.3;
/** Path assist: a defender square in the run within PATH_R m bends it up to PATH_BEND toward the free side. */
export const PATH_R = 2;
export const PATH_BEND = (20 * Math.PI) / 180;
const PATH_LANE = 1.1;
/** Close control: the ball pulled this much (m) nearer his body, and the stride's push-on scaled by this. */
const CLOSE_PULL = 0.18;
const CLOSE_PULSE = 0.5;
/**
 * ... and at a sprint (the owner: "the dribbling is slow"; with AUTO SPRINT his man sprints whenever the stick is
 * pushed all the way): the stride still pushes it on, SPRINT_PULSE as far, so a sprinting dribble isn't a ball left
 * a metre off his boot for every poke.
 */
const SPRINT_PULSE = 0.6;
/**
 * AUTO SPRINT (Pad.autoSprint: always on touch, where there is no SPRINT button; Settings > Controls for keys and a
 * gamepad): the stick pushed this far over (0..1, past the dead zone) sprints, and keeps sprinting until it drops under
 * AUTO_SPRINT_OFF (a thumb resting near the edge doesn't flicker between a jog and a sprint). Only a light push jogs,
 * with the close control. (2026-10-04, the owner: "sprinting button shoudlnt exist as players should be sprinting
 * automatcially". It was 0.7 / 0.58: a thumb resting three quarters of the way out jogged, and the game felt heavy.)
 */
export const AUTO_SPRINT_ON = 0.5;
export const AUTO_SPRINT_OFF = 0.38;
/** A 'skill' event is emitted for a cut near a defender at most this often (s). */
const SKILL_GAP = 1.2;

/**
 * The straight line (the owner, 2026-10-04: "i been walking in a straight line t opposie goal and i always make it to
 * keeper and score"). A defender can time a man who never changes his line. While the human's stick holds one line
 * (within LINE_ARC of where it pointed when the line began) with the ball at a run (over LINE_PACE m/s), the line's
 * clock runs (AssistState.line); a change of direction, a skill cut, a SKILL move or a new carrier starts it again,
 * and it runs down twice as fast as it ran up while he stands or walks. From LINE_FROM s of it to LINE_FULL s he is
 * READ (straightRead: 0..1, times the AI's vsHuman.line by difficulty): the AI's challenge on him goes in for real
 * (ai.ts press: a duel's tell stops being a bark, up to LINE_TACKLE of a tackle; it commits LINE_PRESS as readily
 * again), the block stops dropping off him (ai.ts zonalSpot: LINE_ENGAGE_R) and the path assist stops steering him
 * round the man in his way. A pass, a feint or a turn is all it takes to be unread again.
 */
export const LINE_ARC = (18 * Math.PI) / 180;
export const LINE_PACE = 3;
export const LINE_FROM = 0.9;
export const LINE_FULL = 1.9;
export const LINE_TACKLE = 2;
export const LINE_PRESS = 1;
export const LINE_ENGAGE_R = 2.5;
/**
 * ... and the told challenge on a man who is read starts from LINE_REACH m further out (a man sprinting straight at
 * him is on him before a tell begun at 3.8 m is up), with LINE_GAP of the usual wait between two tells left off (the
 * next man in his way winds up too: skills.ts tellReady).
 */
export const LINE_REACH = 2;
export const LINE_GAP = 0.6;

/** Double-tap SPRINT with the ball: the second press within this (s) knocks it on. */
export const KNOCK_TAP = 0.35;
/**
 * PRESS: the jockey stands this far (m) goal-side of the ball, reading the carrier's run this far ahead (s),
 * mirroring his run (his velocity) and closing any gap to that spot at PRESS_GAIN per second.
 */
export const PRESS_GAP = 1.0;
export const PRESS_LEAD = 0.1;
export const PRESS_GAIN = 4;

/** TACKLE: a tap this near (m, ball) is an instant lunge; from there to TAP_CLOSE he closes first. */
export const TAP_LUNGE = 3;
export const TAP_CLOSE = 7;
/**
 * Held this long (s), TACKLE is a slide; a second press within DOUBLE_TAP s too. (Round 9: 0.25 -> 0.14, "having
 * to hold would take too long"; a tap with SPRINT held slides at once, and so does a tap at a carrier
 * AUTO_SLIDE_MIN..AUTO_SLIDE_MAX m off who's moving away faster than AUTO_SLIDE_AWAY m/s or across faster
 * than AUTO_SLIDE_ACROSS: the assist picks the slide when a standing reach can't get there.)
 */
export const SLIDE_HOLD = 0.14;
export const DOUBLE_TAP = 0.3;
export const AUTO_SLIDE_MIN = 2.5;
export const AUTO_SLIDE_MAX = 5;
export const AUTO_SLIDE_AWAY = 1.5;
export const AUTO_SLIDE_ACROSS = 3;
/** How long (s) the tap keeps closing in before it gives up. */
export const CLOSE_T = 0.8;
/** Foot-to-ball reach (m) of the assisted standing tackle (the AI's is 1.15): it goes in the moment it's in reach. */
export const STAND_REACH = 2.1;
/**
 * The human's standing tackle (2026-10-04, the owner: "the button feels useless when its a standing tackle ... im not
 * sure if this is relatded to teh players skill level"): in reach and from the front or the side it wins the ball
 * TACKLE_FRONT of the time, whoever the two players are (their stats move it TACKLE_STAT at the very most, the AI's
 * level no more than TACKLE_LEVEL of it); through the back of the carrier it loses TACKLE_BEHIND of that (from past
 * TACKLE_SIDE of "behind": beside him, or just off his shoulder, still counts as facing him), and only from there
 * (FOUL_BEHIND, the carrier facing away) can a miss be a foul. (Over whole casual matches a tap in reach won 35%.)
 */
export const TACKLE_FRONT = 0.92;
export const TACKLE_BEHIND = 0.5;
export const TACKLE_SIDE = 0.3;
export const TACKLE_STAT = 0.12;
export const TACKLE_LEVEL = 0.3;
export const FOUL_BEHIND = 0.6;
/** A human's missed standing tackle: this long (s) before he can go again, keeping this much of his pace (it was 0.6 s, 0.6). */
export const MISS_COOLDOWN = 0.35;
export const MISS_PACE = 0.8;
/** TOO FAR is said at most this often (s). */
const CUE_GAP = 0.5;
/** The lunge: at least this pace (m/s) at the ball the moment a close tap lands. */
const LUNGE_SPEED = 9 * TEMPO;
/** PRESS auto-steal: the carrier's ball this far (m) from him, and our foot within this of it. */
export const STEAL_EXPOSED = 0.9;
const STEAL_REACH = 1.4;

/** Per-match state of the human's dribble / tackle assists (Match.assist). */
export class AssistState {
  /** Seconds of human control (the assists' clock). */
  t = 0;
  /** Stick directions (angle, time) over the last CUT_WINDOW s while he had the ball. */
  hist: { a: number; t: number }[] = [];
  carrier = -1;
  lastCut = -9;
  lastSkill = -9;
  /** The straight line (LINE_ARC): seconds his stick has held one line with the ball at a run, and that line (rad). */
  line = 0;
  lineA = 0;
  /** Match.clock when the line's clock last ran (a gap: he lost it and has it back, so the line starts again). */
  lineAt = 0;
  /** TACKLE: the press being played out (tap / hold; `born`: Match.clock when pressed), and when the last one was. */
  tackle: { t: number; held: boolean; target: number; player: number; born: number } | null = null;
  lastPress = -9;
  /** AUTO SPRINT is sprinting his man (autoRun: the stick's past AUTO_SPRINT_ON, and not yet back under AUTO_SPRINT_OFF). */
  autoRun = false;
  /** When TOO FAR was last said (CUE_GAP). */
  lastCue = -9;
}

/**
 * AUTO SPRINT (Pad.autoSprint, the touch thumbstick): does the stick (`stickLen`, 0..1) sprint his man this step?
 * Only the SPRINT button's own presses stay the button's (the knock-on's double tap, a TACKLE tap with it held).
 */
export function autoRun(st: AssistState, pad: Pad, stickLen: number): boolean {
  st.autoRun = !!pad.autoSprint && stickLen >= (st.autoRun ? AUTO_SPRINT_OFF : AUTO_SPRINT_ON);
  return st.autoRun;
}

// ------------------------------------------------------------------ dribbling

/**
 * The human's man has the ball at his feet (called once a frame from applyHuman, after the stick has set his
 * run): cut detection and wrong-footing, shielding, path assist. Charging a shot or a pass, it only watches.
 */
export function humanDribble(m: Match, p: Player, pad: Pad, stickLen: number, dt: number): void {
  const st = m.ctl[p.side].assist;
  st.t += dt;
  // (Winding up a shot he plants: his quick legs don't carry him across the goal as he aims.)
  p.quickLegs = !pad.shoot;
  if (st.carrier !== p.idx) {
    st.carrier = p.idx;
    st.hist.length = 0;
    st.line = 0;
  }
  if (p.state !== 'move') return;
  // ---- The straight line (straightRead): the clock runs while the stick holds its line at a run.
  if (m.clock - st.lineAt > 0.2 || m.clock < st.lineAt) st.line = 0;
  st.lineAt = m.clock;
  if (stickLen > 0.5 && p.speed() > LINE_PACE) {
    const a = Math.atan2(pad.mz, pad.mx);
    if (st.line <= 0 || Math.abs(angleDiff(st.lineA, a)) > LINE_ARC) {
      st.lineA = a;
      st.line = dt;
    } else st.line += dt;
  } else st.line = Math.max(0, st.line - 2 * dt);
  // (Charging a shot or a pass, or aiming one with PASS / THROUGH down, the stick is aiming: no skill move. With SKILL
  // down it is picking the move: skills.ts, never a cut as well.)
  const busy = pad.shoot || pad.pass || pad.through || !!pad.skill || m.ctl[p.side].passMode !== null;
  // ---- Skill cut. (A flick across a thumbstick passes near the middle for a frame or two: those frames
  // are skipped, not a reset.)
  const h = st.hist;
  while (h.length && st.t - h[0].t > CUT_WINDOW) h.shift();
  if (stickLen > 0.5) {
    const a = Math.atan2(pad.mz, pad.mx);
    let swing = 0;
    for (const s of h) swing = Math.max(swing, Math.abs(angleDiff(s.a, a)));
    h.push({ a, t: st.t });
    const sp = p.speed();
    const offRun = sp > 0.5 ? Math.abs(angleDiff(Math.atan2(p.vel.z, p.vel.x), a)) : 0;
    if (!busy && swing > CUT_SWING && offRun > CUT_OFF_RUN && sp > 1.5 && st.t - st.lastCut > CUT_COOL) {
      st.lastCut = st.t;
      h.length = 0;
      h.push({ a, t: st.t });
      skillCut(m, p);
    }
  }
  if (busy) return;
  // ---- Shielding.
  const o = nearestOpponent(m, p);
  if (o && o.d < SHIELD_R) {
    const brain = m.brains[o.p.side];
    const idleRead = stickLen < 0.25 && brain.stallBy === p.idx && m.clock - brain.stallSince >= STALL_S;
    const ax = (p.pos.x - o.p.pos.x) / Math.max(0.05, o.d);
    const az = (p.pos.z - o.p.pos.z) / Math.max(0.05, o.d);
    const away = stickLen > 0.25 ? (pad.mx * ax + pad.mz * az) / stickLen : 1;
    if (!idleRead && (stickLen < 0.25 || away > 0.3)) {
      p.shieldT = 0.15;
      // A brief neutral pause turns his back to protect the ball. After the defender has read an idle carrier,
      // he must turn or pull away himself; automatic facing cannot hide the ball forever as the presser circles.
      if (stickLen < 0.25) p.faceTarget = Math.atan2(az, ax);
    }
  }
  // ---- Path assist.
  if (stickLen > 0.5 && p.cutT <= 0) pathAssist(m, p, stickLen);
}

/** A skill cut: the burst turn, the 'skill', and any committed defender near enough wrong-footed. */
function skillCut(m: Match, p: Player): void {
  p.cutT = CUT_T;
  let near = false;
  let beat = false;
  for (const o of m.teamPlayers(p.side === 0 ? 1 : 0)) {
    if (o.isKeeper || o.sentOff || o.wrongFootT > 0) continue;
    if (o.state !== 'move' && o.state !== 'slide') continue;
    const dx = p.pos.x - o.pos.x;
    const dz = p.pos.z - o.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > CUT_REACH + 0.5) continue;
    near = true;
    if (d > CUT_REACH) continue;
    // Committed: going in for the tackle (or to ground), or closing on him at pace. (A man winding up a telegraphed
    // challenge, skills.ts, is set, not yet going: the SKILL button is the answer to that. A duel's tell, skills.ts
    // TELL_DUEL, is a man squaring up to go in: a cut on it catches him leaning, like the SKILL button.)
    const closing = (o.vel.x * dx + o.vel.z * dz) / Math.max(0.1, d);
    const committed = (o.tellT > 0 && o.tellDuel) ||
      (o.tellT <= 0 && (o.commitT > 0 || o.state === 'slide' || closing > 2 || (o.tackleCooldown <= 0 && d < 1.8)));
    const edge = (p.stat.dribbling - o.stat.defending) / 100;
    const shift = vsHuman(m.aiSkill(o.side)).cut;
    const pWin = committed ? clamp(0.72 + edge * 0.9 + shift, 0.45, 0.92) : clamp(0.3 + edge * 0.6 + shift, 0.12, 0.5);
    if (m.rng.chance(pWin)) {
      wrongFoot(m, p, o);
      beat = true;
    }
  }
  if (beat) {
    p.protectT = PROTECT_T;
    // (A cut that beats a man chains with the SKILL moves: skills.ts.)
    m.ctl[p.side].skill.chain(m, p, 'cut');
  }
  const st = m.ctl[p.side].assist;
  if (near && st.t - st.lastSkill > SKILL_GAP) {
    st.lastSkill = st.t;
    m.events.push({ type: 'skill', player: p.idx });
  }
}

/** `o` is planted the wrong way by `p`'s move: nearly frozen for 0.35-0.5 s, no tackle, a 'beat'. */
export function wrongFoot(m: Match, p: Player, o: Player, scale = 1): void {
  const edge = (p.stat.dribbling - o.stat.defending) / 100;
  const dur = clamp(0.42 + edge * 0.5, WRONG_FOOT_MIN, WRONG_FOOT_MAX) * scale;
  o.wrongFootT = Math.max(o.wrongFootT, dur);
  o.slowT = Math.max(o.slowT, dur + 0.25);
  o.commitT = 0;
  o.jockeyT = 0;
  o.tackleCooldown = Math.max(o.tackleCooldown, dur + 0.3);
  m.events.push({ type: 'beat', by: p.idx, on: o.idx });
}

function nearestOpponent(m: Match, p: Player): { p: Player; d: number } | null {
  let best: Player | null = null;
  let bd = Infinity;
  for (const o of m.teamPlayers(p.side === 0 ? 1 : 0)) {
    if (o.sentOff) continue;
    const d = dist2(o.pos.x, o.pos.z, p.pos.x, p.pos.z);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best ? { p: best, d: bd } : null;
}

/** A defender square in his run within PATH_R m: bend the run up to PATH_BEND round him, to the free side. */
function pathAssist(m: Match, p: Player, stickLen: number): void {
  // (His run's own length: AUTO SPRINT's push is flat out whatever the stick's, Match.applyHuman.)
  const wl = Math.hypot(p.wantX, p.wantZ) || stickLen;
  const ux = p.wantX / wl;
  const uz = p.wantZ / wl;
  let block: Player | null = null;
  let bAlong = Infinity;
  let bLat = 0;
  const opp = m.teamPlayers(p.side === 0 ? 1 : 0);
  for (const o of opp) {
    if (o.sentOff || o.isKeeper) continue;
    const ox = o.pos.x - p.pos.x;
    const oz = o.pos.z - p.pos.z;
    const along = ox * ux + oz * uz;
    const lat = -uz * ox + ux * oz;
    if (along < 0.3 || along > PATH_R + 0.5 || Math.abs(lat) > PATH_LANE) continue;
    if (along < bAlong) {
      bAlong = along;
      bLat = lat;
      block = o;
    }
  }
  if (!block) return;
  // The free side: away from where he stands across the run (dead ahead: away from the touchline), unless
  // another of theirs is there.
  // (Side s turns the run towards s * (-uz, ux): towards the middle of the pitch is -sign(z * ux).)
  let side = Math.abs(bLat) > 0.15 ? -Math.sign(bLat) : -Math.sign(p.pos.z * ux) || 1;
  const taken = (s: number) => opp.some((q) => {
    if (q === block || q.sentOff) return false;
    const qx = q.pos.x - p.pos.x;
    const qz = q.pos.z - p.pos.z;
    const along = qx * ux + qz * uz;
    const lat = (-uz * qx + ux * qz) * s;
    return along > 0 && along < PATH_R + 1.5 && lat > 0.3 && lat < 2.5;
  });
  if (taken(side)) {
    if (taken(-side)) return;
    side = -side;
  }
  // (A man who is read, straightRead, isn't steered round the defender in his way: that is his to do.)
  const f = clamp((PATH_R + 0.5 - bAlong) / PATH_R, 0.3, 1) * clamp(1.2 - Math.abs(bLat) / PATH_LANE, 0, 1) * (1 - straightRead(m, p));
  const bend = side * PATH_BEND * f;
  const c = Math.cos(bend);
  const s = Math.sin(bend);
  const wx = p.wantX;
  const wz = p.wantZ;
  p.wantX = wx * c - wz * s;
  p.wantZ = wx * s + wz * c;
}

/**
 * Close control, for Match.dribbleControl: the stride's push-on `pulse` (m ahead of his foot) for this
 * carrier. The human's man jogging with it (not sprinting, not settling a first touch) keeps it tighter.
 */
export function closeTouch(m: Match, p: Player, pulse: number): number {
  if (!m.isHumanControlled(p)) {
    // An AI carrier with the other side's human's man closing: the harder sides keep it tighter (vsHuman.tight).
    const hs = p.side === 0 ? 1 : 0;
    const act = m.activeOf(hs);
    if (act >= 0 && pulse > 0) {
      const h = m.players[act];
      if (h.side === hs && dist2(h.pos.x, h.pos.z, p.pos.x, p.pos.z) < TIGHT_R) return pulse * (1 - vsHuman(m.aiSkill(p.side)).tight);
    }
    return pulse;
  }
  if (p.touchT > 0 || p.state !== 'move') return pulse;
  if (p.sprint) return pulse * SPRINT_PULSE;
  return pulse * CLOSE_PULSE - CLOSE_PULL;
}

/**
 * A knock-on (double-tap SPRINT): bend it round a defender standing in its line (up to ~25 degrees, to the
 * free side), and one who has come in for it is wrong-footed now and then. Returns the direction to use.
 */
export function knockAssist(m: Match, p: Player, ux: number, uz: number): { x: number; z: number } {
  if (!m.isHumanControlled(p)) return { x: ux, z: uz };
  let best: Player | null = null;
  let bd = Infinity;
  let bl = 0;
  for (const o of m.teamPlayers(p.side === 0 ? 1 : 0)) {
    if (o.sentOff || o.isKeeper) continue;
    const ox = o.pos.x - p.pos.x;
    const oz = o.pos.z - p.pos.z;
    const along = ox * ux + oz * uz;
    const lat = -uz * ox + ux * oz;
    if (along < 0.2 || along > 5 || Math.abs(lat) > 1.6) continue;
    if (along < bd) {
      bd = along;
      bl = lat;
      best = o;
    }
  }
  if (!best) return { x: ux, z: uz };
  const bend = -(Math.sign(bl) || 1) * clamp(((1.6 - Math.abs(bl)) / 1.6) * 0.45, 0.1, 0.45);
  if (bd < 3.2) {
    const edge = (p.stat.dribbling - best.stat.defending + p.stat.pace - best.stat.pace) / 200;
    if (m.rng.chance(clamp(0.5 + edge + vsHuman(m.aiSkill(best.side)).cut, 0.25, 0.75))) {
      wrongFoot(m, p, best, 0.8);
      m.ctl[p.side].skill.chain(m, p, 'knock');
    }
  }
  const c = Math.cos(bend);
  const s = Math.sin(bend);
  return { x: ux * c - uz * s, z: ux * s + uz * c };
}

/**
 * How well the AI reads the human's carrier `c` (0..1): how long he has run one straight line with the ball (LINE_FROM
 * to LINE_FULL s), times the AI's vsHuman.line. 0 for anyone else, and for a man who has just changed his line.
 */
export function straightRead(m: Match, c: Player): number {
  if (!m.isHumanControlled(c)) return 0;
  const st = m.ctl[c.side].assist;
  if (st.carrier !== c.idx || m.ball.owner !== c.idx || st.line <= LINE_FROM) return 0;
  return clamp((st.line - LINE_FROM) / (LINE_FULL - LINE_FROM), 0, 1) * vsHuman(m.aiSkill(c.side === 0 ? 1 : 0)).line;
}

// ------------------------------------------------------------------ tackles on the human's carrier

/**
 * Multiplier on the chance of `tackler`'s standing tackle on carrier `c` (Match.tryTackle). 1 unless `c` is
 * the human's man: then his protection window after a skill, his shielding (from the far side of his body)
 * and the AI's difficulty against his dribbling decide it.
 */
export function carrierGuard(m: Match, tackler: Player, c: Player): number {
  if (!m.isHumanControlled(c)) return 1;
  if (c.protectT > 0) return PROTECT_TACKLE;
  let k = humanCarrierTackle(m.aiSkill(tackler.side), c.stat.dribbling);
  // Mid SKILL move (skills.ts) the ball is off his foot.
  k *= m.ctl[c.side].skill.exposure(c.idx);
  // He's only just got it: no stealing it off his first touch.
  if (c.ballT < RECEIVE_GUARD_T) k *= RECEIVE_GUARD;
  if (c.shieldT > 0) {
    // Body between ball and tackler: coming through the back of him mostly fails.
    const b = m.ball.pos;
    const bx = b.x - c.pos.x;
    const bz = b.z - c.pos.z;
    const tx = tackler.pos.x - c.pos.x;
    const tz = tackler.pos.z - c.pos.z;
    const cover = -(bx * tx + bz * tz) / Math.max(1e-3, Math.hypot(bx, bz) * Math.hypot(tx, tz));
    // Neutral-stick shielding is automatic, not a permanent safe haven. A presser who has watched the
    // same stationary carrier for STALL_S gets round that shield over the next STALL_S seconds. His
    // body still blocks a tackle from behind (tryTackle's geometry), and a timed SKILL still beats it.
    const brain = m.brains[tackler.side];
    const stale = c.speed() < LINE_PACE && brain.stallBy === c.idx
      ? clamp((m.clock - brain.stallSince - STALL_S) / STALL_S, 0, 1) : 0;
    const shield = SHIELD_TACKLE + (1 - SHIELD_TACKLE) * stale;
    k *= 1 - (1 - shield) * clamp((cover + 0.3) / 0.8, 0, 1);
  }
  return k;
}

/**
 * How the AI plays against the human, by its difficulty (MatchConfig.difficulty / Match.aiSkill: the menu's
 * EASY 0.6 · NORMAL 1.8 · HARD 3 · LEGEND 4). AI-vs-AI play never uses it.
 */
export interface VsHuman {
  /** How readily it goes in on the human's dribbler (commit rate, chase slides), against an AI dribbler. */
  press: number;
  /** Its standing tackles' success on the human's carrier, against an AI carrier (before his dribbling). */
  tackle: number;
  /** The human's assisted standing tackles on its carriers succeed this much as often. */
  resist: number;
  /** Added to the odds of a skill cut (or knock-on) wrong-footing its defenders. */
  cut: number;
  /** Its carriers' take-ons against the human's man succeed this much as often as against an AI defender... */
  takeOn: number;
  /** ... and leave him wrong-footed (Player.slowT) this long (s; an AI defender: 0.7). */
  beaten: number;
  /** How sure the human's automatic tackle (running into the carrier, Match.autoTackle) is, as an aggression. */
  auto: number;
  /** How quickly (per s) its carrier reads the human's man coming in for it and moves the ball on (readsHuman). */
  read: number;
  /**
   * How much tighter (0..1: share of the stride's push-on taken off) its carriers keep the ball with the human's man
   * within TIGHT_R m (closeTouch): fewer exposed touches for his PRESS steal and his taps to poke away.
   */
  tight: number;
  /**
   * How much of the human's shot help he gets (0..1; 2026-10-03, the owner: "its hard to score"): a man on him spoils
   * his strike less (actions.ts HUMAN_PRESSURE) and the AI's keeper reads it a beat later (keeper.ts
   * HUMAN_STRIKE_UNREAD). All of it on EASY and NORMAL, half on HARD, none on LEGEND.
   */
  shotHelp: number;
  /**
   * How much of a straight run it reads (straightRead): the share of the read's full effect (a duel that goes in for
   * real, a block that holds). Lenient on EASY, all of it from NORMAL up.
   */
  line: number;
}

/** The menu's difficulty levels (MatchConfig.difficulty), and vsHuman's value at each (linear between). */
const LEVELS = [0.6, 1.8, 3, 4];
/*
 * Round 9 (the owner: "balanced ... addictive"): measured against tests/humanBot.ts over N=40 matches a level at
 * 2x120 s. Round 8's table had the bot winning 87% at NORMAL with 0.25 goals against a match (the AI got 1.2 shots:
 * his man alone ended half its possessions). Now NORMAL ~W55 D25 L20 with ~0.8 against, HARD ~40/22/38 with ~1.0
 * against, LEGEND ~22/22/56, EASY still every match. (tests/difficulty.test.ts; the full runs are in the round's
 * report.)
 */
const VS_HUMAN: Record<keyof VsHuman, number[]> = {
  press: [0.6, 1.57, 1.65, 1.8],
  tackle: [0.68, 1.67, 1.75, 1.9],
  resist: [1.08, 0.56, 0.5, 0.42],
  cut: [0.12, -0.1, -0.3, -0.4],
  takeOn: [0.7, 2.45, 2.6, 2.9],
  beaten: [0.4, 1.0, 1.05, 1.15],
  auto: [0.8, 0.26, 0.24, 0.2],
  read: [0.3, 10.5, 12, 15],
  tight: [0, 0.64, 0.68, 0.75],
  shotHelp: [1, 1, 0.5, 0],
  line: [0.6, 1, 1, 1],
};
/** The human's man this near (m) an AI carrier: the carrier keeps it tighter (vsHuman.tight). */
const TIGHT_R = 3.5;

export function vsHuman(skill: number): VsHuman {
  const s = clamp(skill, LEVELS[0], LEVELS[LEVELS.length - 1]);
  let i = 0;
  while (i < LEVELS.length - 2 && s > LEVELS[i + 1]) i++;
  const f = (s - LEVELS[i]) / (LEVELS[i + 1] - LEVELS[i]);
  const at = (k: keyof VsHuman) => VS_HUMAN[k][i] + (VS_HUMAN[k][i + 1] - VS_HUMAN[k][i]) * f;
  return {
    press: at('press'), tackle: at('tackle'), resist: at('resist'), cut: at('cut'), takeOn: at('takeOn'), beaten: at('beaten'), auto: at('auto'),
    read: at('read'), tight: at('tight'), shotHelp: at('shotHelp'), line: at('line'),
  };
}

/** How an AI tackle on the human's carrier fares against the same tackle on an AI one (vsHuman, his dribbling). */
export function humanCarrierTackle(skill: number, dribbling: number): number {
  return vsHuman(skill).tackle * clamp(1.15 - (dribbling / 100) * 0.35, 0.8, 1.05);
}

/**
 * The human's assisted standing tackle (Match.tryTackle with `assisted`): see TACKLE_FRONT. `behind` 0 (in front of
 * the carrier, or beside him) .. 1 (straight through his back); `shielded`: his body between the tackler and the ball;
 * `exposed`: his touch has left the ball off his foot. Before carrierGuard.
 */
export function standingTackleChance(m: Match, p: Player, c: Player, behind: number, shielded: number, exposed: boolean): number {
  const edge = clamp((p.stat.defending - c.stat.dribbling) / 50, -1, 1);
  // (Beside him, or a little behind his shoulder, is still "facing him": only the back third of the circle costs.)
  const back = clamp((behind - TACKLE_SIDE) / (1 - TACKLE_SIDE), 0, 1);
  let k = TACKLE_FRONT - back * TACKLE_BEHIND + edge * TACKLE_STAT + (exposed ? 0.05 : 0);
  k *= 1 - shielded * 0.15;
  // The harder sides' carriers ride a little more of it (vsHuman.resist: 1 on EASY .. 0.42 on LEGEND), never most of it.
  k *= 1 - TACKLE_LEVEL * (1 - Math.min(1, vsHuman(m.aiSkill(c.side)).resist));
  return clamp(k, 0.2, 0.95);
}

/** Foul chance when the assisted standing tackle misses: only through the back of the man (FOUL_BEHIND). */
export function standingFoulChance(behind: number, shielded: number): number {
  return behind > FOUL_BEHIND ? 0.22 + shielded * 0.1 : 0;
}

/** The word for a human's missed standing tackle: through the back of him, or simply ridden. */
export function missCue(behind: number): 'behind' | 'mistimed' {
  return behind > FOUL_BEHIND ? 'behind' : 'mistimed';
}

/** TOO FAR, over his man (at most every CUE_GAP s). */
function tooFar(m: Match, p: Player, st: AssistState): void {
  if (st.t - st.lastCue < CUE_GAP) return;
  st.lastCue = st.t;
  m.events.push({ type: 'tackleCue', by: p.idx, cue: 'far' });
}

// ------------------------------------------------------------------ the human's TACKLE button

/**
 * SHOOT while the other side has it (applyHuman's defending branch): tap / hold / double-tap as above. Takes
 * over the man's run while a tap is closing in. `shootP`: pressed this frame.
 */
export function humanTackle(m: Match, p: Player, pad: Pad, shootP: boolean, stickLen: number, dt: number): void {
  const st = m.ctl[p.side].assist;
  st.t += dt;
  // His quick legs answer the stick and PRESS (and a TACKLE closing in, below), not a run the sim makes for him.
  p.quickLegs = stickLen > 0.2 || pad.through;
  const b = m.ball;
  const c = b.owner >= 0 && !b.held && m.players[b.owner].side !== p.side ? m.players[b.owner] : null;
  // (A second tap straight after a missed lunge: the slide is the second effort, out of the jab.)
  if (shootP && c && (p.state === 'move' || (p.state === 'kick' && p.poke)) && !p.sentOff) {
    const d = dist2(p.pos.x, p.pos.z, b.pos.x, b.pos.z);
    if (st.t - st.lastPress < DOUBLE_TAP && d < TAP_CLOSE) {
      st.lastPress = -9;
      st.tackle = null;
      slideAt(m, p);
      return;
    }
    st.lastPress = st.t;
    if (d < TAP_CLOSE && p.state === 'move') {
      // Already in reach: no wind-up, the tackle goes in on the press.
      if (p.tackleCooldown <= 0 && dist2(p.footX(), p.footZ(), b.pos.x, b.pos.z) <= STAND_REACH) {
        st.tackle = { t: 0, held: true, target: c.idx, player: p.idx, born: m.clock };
        m.events.push({ type: 'tackleTry', by: p.idx, slide: false });
        m.tryTackle(p, c, 1, true);
        // A won poke ends the action. A missed poke can still become a slide if the button stays held.
        if (m.ball.owner !== c.idx || m.phase !== 'play') st.tackle = null;
        return;
      }
      // SPRINT held, or the carrier getting away from a standing reach: the slide, at once.
      if (pad.sprint || (d >= AUTO_SLIDE_MIN && d <= AUTO_SLIDE_MAX && escaping(p, c, b.pos.x, b.pos.z))) {
        st.tackle = null;
        slideAt(m, p);
        return;
      }
      st.tackle = { t: 0, held: true, target: c.idx, player: p.idx, born: m.clock };
      m.events.push({ type: 'tackleTry', by: p.idx, slide: false });
      if (d < TAP_LUNGE) lunge(p, b.pos.x + b.vel.x * 0.1, b.pos.z + b.vel.z * 0.1);
    } else if (d >= TAP_CLOSE && p.state === 'move') tooFar(m, p, st);
  }
  const tk = st.tackle;
  if (!tk) return;
  // (Nor does it outlive a stoppage: the clock moved on, or a new half started, since it was pressed.)
  const stale = m.clock < tk.born || m.clock - tk.born > CLOSE_T + 0.25;
  // (A missed lunge's jab, Player.poke, doesn't end it: the button still held turns it into the slide.)
  const upright = p.state === 'move' || (p.state === 'kick' && p.poke);
  if (!c || c.idx !== tk.target || p.idx !== tk.player || !upright || p.sentOff || stale) {
    st.tackle = null;
    return;
  }
  tk.t += dt;
  if (tk.held && !pad.shoot) tk.held = false;
  const tx = b.pos.x + b.vel.x * 0.15 - p.pos.x;
  const tz = b.pos.z + b.vel.z * 0.15 - p.pos.z;
  const tl = Math.hypot(tx, tz) || 1;
  // Pulling the stick hard away from it calls the tap off; so does running out of time (TOO FAR: he never got there).
  if ((stickLen > 0.6 && (pad.mx * tx + pad.mz * tz) / (stickLen * tl) < -0.2) || tk.t > CLOSE_T) {
    if (tk.t > CLOSE_T) tooFar(m, p, st);
    st.tackle = null;
    return;
  }
  if (tk.held && tk.t >= SLIDE_HOLD) {
    st.tackle = null;
    slideAt(m, p);
    return;
  }
  p.wantX = tx / tl;
  p.wantZ = tz / tl;
  p.sprint = tl > 1.2;
  p.faceTarget = Math.atan2(tz, tx);
  p.quickLegs = true;
  // Arriving: a tap goes in the moment he's in reach (a press still held is on its way to being a slide).
  if (!tk.held && p.tackleCooldown <= 0 && dist2(p.footX(), p.footZ(), b.pos.x, b.pos.z) <= STAND_REACH) {
    st.tackle = null;
    m.tryTackle(p, c, 1, true);
  }
}

/**
 * An AI carrier's take-on against `o`: how its success compares with one against an AI defender. The human's
 * man by difficulty (vsHuman.takeOn); mid-way through a TACKLE tap he's already coming in for the ball, and the
 * tackle mostly gets there first (it used to be skipped outright whenever the take-on came off that frame).
 */
export function takeOnVsHuman(m: Match, o: Player): number {
  if (!m.isHumanControlled(o)) return 1;
  return m.ctl[o.side].assist.tackle !== null ? TAKE_ON_LUNGING : vsHuman(m.aiSkill(o.side === 0 ? 1 : 0)).takeOn;
}
const TAKE_ON_LUNGING = 0.35;

/**
 * An AI carrier `p` sees the human's man `o` (his nearest opponent, `d` m off) coming in for it (closing at pace,
 * or a TACKLE on its way) and decides again now rather than dribbling on into the challenge: at vsHuman.read per
 * second. (AI carriers against AI defenders, and every AI-vs-AI match, never get here.)
 */
export function readsHuman(m: Match, p: Player, o: Player | null, d: number, dt: number): boolean {
  if (!o || d > READ_D || !m.isHumanControlled(o) || p.ballT < 0.2) return false;
  const closing = ((o.vel.x * (p.pos.x - o.pos.x) + o.vel.z * (p.pos.z - o.pos.z)) / Math.max(0.1, d)) > READ_CLOSING;
  if (!closing && m.ctl[o.side].assist.tackle === null) return false;
  return m.rng.chance(vsHuman(m.aiSkill(p.side)).read * dt);
}
const READ_D = 3;
const READ_CLOSING = 2;

/** `side`'s human's tap is closing in on the carrier (Match.autoTackle leaves the challenge to it). */
export function tackleClosing(m: Match, side: Side): boolean {
  return m.ctl[side].assist.tackle !== null && m.phase === 'play';
}

/**
 * PRESS held (applyHuman, after the jockey has set his run): the carrier's touch has left the ball more than
 * STEAL_EXPOSED m off his foot and our man is nearer it: poke it away (an assisted standing tackle).
 */
export function pressSteal(m: Match, p: Player, c: Player): void {
  const b = m.ball.pos;
  if (p.state !== 'move' || p.tackleCooldown > 0 || m.ball.owner !== c.idx) return;
  const exposed = dist2(b.x, b.z, c.pos.x, c.pos.z);
  const mine = dist2(p.footX(), p.footZ(), b.x, b.z);
  if (exposed > STEAL_EXPOSED && mine < STEAL_REACH && mine < exposed) m.tryTackle(p, c, 1, true, false);
}

/** Face where the ball will be when he gets there, and go in with a slide (the human's long one). */
function slideAt(m: Match, p: Player): void {
  const b = m.ball;
  if (p.sentOff) return;
  if (p.state === 'kick' && p.poke) p.setState('move');
  if (p.state !== 'move') return;
  const lead = clamp(dist2(p.pos.x, p.pos.z, b.pos.x, b.pos.z) / 9, 0.1, 0.45);
  p.facing = Math.atan2(b.pos.z + b.vel.z * lead - p.pos.z, b.pos.x + b.vel.x * lead - p.pos.x);
  m.events.push({ type: 'tackleTry', by: p.idx, slide: true });
  m.startSlide(p);
}

/**
 * Is carrier `c` getting away from `p` (a standing reach can't follow): moving away from him along the line to
 * the ball faster than AUTO_SLIDE_AWAY m/s, or across it faster than AUTO_SLIDE_ACROSS?
 */
function escaping(p: Player, c: Player, bx: number, bz: number): boolean {
  const ux = bx - p.pos.x;
  const uz = bz - p.pos.z;
  const ul = Math.hypot(ux, uz) || 1;
  const away = (c.vel.x * ux + c.vel.z * uz) / ul;
  const across = Math.abs(-uz * c.vel.x + ux * c.vel.z) / ul;
  return away > AUTO_SLIDE_AWAY || across > AUTO_SLIDE_ACROSS;
}

/**
 * The human's slide (Match.startSlide / checkSlides): long and fast (HUMAN_SLIDE_BOOST m/s on top of his pace,
 * at least HUMAN_SLIDE_MIN + BOOST; it glides ~0.5 s, Player.longSlide), and forgiving: it takes the ball if it's
 * within HUMAN_SLIDE_REACH m of the line from his body to his boot, through HUMAN_SLIDE_T s. A foul only when it
 * goes through the back of the man (the carrier facing away, `behind` over HUMAN_SLIDE_BEHIND) or misses the
 * ball and takes him.
 */
export const HUMAN_SLIDE_BOOST = 3.5 * TEMPO;
export const HUMAN_SLIDE_MIN = 6.5 * TEMPO;
// (1.2 made the sprint-tap slide take the ball 19 times in 21 from 3-5.5 m: an exploit. ~60% now.)
export const HUMAN_SLIDE_REACH = 1.05;
export const HUMAN_SLIDE_T = 0.65;
export const HUMAN_SLIDE_BEHIND = 0.6;

/** Chance a human slide is mistimed (takes the man with the ball): from behind only. */
export function humanSlideFoul(behind: number): number {
  return behind > HUMAN_SLIDE_BEHIND ? 0.35 : 0.02;
}

/** The lunge of a close tap: straight at the ball, at LUNGE_SPEED at least. */
function lunge(p: Player, x: number, z: number): void {
  const dx = x - p.pos.x;
  const dz = z - p.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const sp = Math.max(p.speed(), LUNGE_SPEED);
  p.vel.x = (dx / d) * sp;
  p.vel.z = (dz / d) * sp;
  p.facing = Math.atan2(dz, dx);
}
