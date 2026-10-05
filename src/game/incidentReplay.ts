import { HALF_L } from '../sim/constants';
import type { Match, Phase, Restart } from '../sim/match';
import type { MatchEvent, Side } from '../sim/types';
import { BALL_OFS, PF, ReplayBuffer, SENT_OFF_CODE } from './replay';

/** A television recap of an actual incident, separate from the goal/celebration lifecycle. */
export interface IncidentReplay {
  kind: 'offside' | 'foul' | 'yellow' | 'red' | 'penalty-award' | 'penalty-result';
  label: string;
  /** One short line on the clip naming who did it ("FOUL BY 5 CINDER"); empty for none. */
  caption: string;
  frames: Float32Array[];
  /** The frame the decision is about: the contact of a foul, the outcome of a penalty, the offside flag. */
  actionIdx: number;
  /** Slow motion runs between these two frames (the contact; a penalty from the strike to its outcome). */
  slowFrom: number;
  slowTo: number;
  /** Offside is judged at the original pass release, rather than the receiver's later touch. */
  releaseIdx?: number;
  /** Offside, read off the release frame: the line (second-last defender, ball or halfway) and the two men on it. */
  offside?: { lineX: number; attacker: number; defender: number };
  /** A foul: the two men the clip marks. */
  fouler?: number;
  victim?: number;
  actors: number[];
  /** A settled penalty can be replayed with possession still live, then resumed at precisely that frame. */
  settledPenalty: boolean;
}

/** Read before stepping: a strike clears/replaces the restart in that same simulation step. */
export interface IncidentStep {
  phase: Phase;
  restart: Restart | null;
  kickId: number;
  shootoutStage?: string;
}

const LEAD_FRAMES = 3 * 60;
const SHOT_LEAD_FRAMES = 60;
/** A foul clip opens this long before the contact (1.8 s) and runs this long after it (0.9 s). */
export const FOUL_LEAD_FRAMES = 108;
export const FOUL_TAIL_FRAMES = 54;
/** Slow motion through the contact: from 0.3 s before it to 0.4 s after. */
const FOUL_SLOW_BEFORE = 18;
const FOUL_SLOW_AFTER = 24;
/**
 * How long a dead ball is left running before its recap holds the match. The sim's shortest "out" beat is 0.6 s,
 * after which it stands the taker on the ball: the hold comes just before that, so the fall, the ball leaving
 * play and the players easing up are all real recorded frames and nobody is seen jumping to a restart.
 */
export const DEAD_HOLD_S = 0.55;
/** A taken penalty: the whole run-up before the strike (1.75 s), and the outcome held this long before the cut. */
export const PEN_LEAD_FRAMES = 105;
export const PEN_SETTLE_FRAMES = 30;
/** A rebound nobody settles for this long is live play again: its penalty recap is dropped, not shown late. */
const PEN_STALE_FRAMES = 6 * 60;

type PendingFoul = {
  by: number; on: number; at: number; penalty: boolean; card: 'yellow' | 'red' | null;
  caption: string; clip: IncidentReplay | null;
};
type PendingPenalty = {
  kickId: number; first: number; strike: number; taker: number; saved: boolean; post: boolean;
  /** The step the outcome was first final (held, controlled, out of play); -1 while the shot is still live. */
  settledAt: number;
  /** A shootout kick already judged: its title, and the keeper who faced it. */
  judged?: { title: string; keeper: number };
};

function nameOf(m: Match, idx: number): string {
  const d = m.players[idx]?.def;
  return d ? `${d.number} ${d.name.toUpperCase()}` : '';
}

/**
 * Draw-only footage past the last recorded frame: everyone carries on the way he was going, easing off, with
 * his pose clock running. Used only for the last fraction of a foul's tail, when the whistle went at once and
 * the dead-ball hold (DEAD_HOLD_S) came before FOUL_TAIL_FRAMES of real frames existed. Never read by the sim.
 */
export function continueFrames(frames: Float32Array[], n: number): void {
  for (let k = 0; k < n && frames.length >= 2; k++) {
    const a = frames[frames.length - 2];
    const b = frames[frames.length - 1];
    const c = b.slice();
    for (let i = 0; i < 22; i++) {
      const o = i * PF;
      const dx = b[o] - a[o];
      const dz = b[o + 1] - a[o + 1];
      // (A man the sim placed somewhere between two frames is not "moving" at that speed.)
      if (Math.hypot(dx, dz) < 0.4) {
        c[o] = b[o] + dx * 0.9;
        c[o + 1] = b[o + 1] + dz * 0.9;
      }
      c[o + 5] = b[o + 5] + 1 / 60;
      let dp = b[o + 6] - a[o + 6];
      if (dp < -0.5) dp += 1;
      else if (dp > 0.5) dp -= 1;
      c[o + 6] = (b[o + 6] + dp * 0.9 + 1) % 1;
      c[o + 7] = b[o + 7] * 0.9;
    }
    for (const j of [0, 2]) {
      const d = b[BALL_OFS + j] - a[BALL_OFS + j];
      if (Math.abs(d) < 1) c[BALL_OFS + j] = b[BALL_OFS + j] + d * 0.9;
    }
    c[BALL_OFS + 9] = b[BALL_OFS + 9] + 1 / 60;
    frames.push(c);
  }
}

/** Presentation only. Never writes the match graph, consumes RNG or creates a restart. */
export class IncidentReplays {
  private queue: IncidentReplay[] = [];
  private foul: PendingFoul | null = null;
  private penalty: PendingPenalty | null = null;
  private offsidePass: { kickId: number; side: number; player: number; first: number } | null = null;

  clear(): void {
    this.queue.length = 0;
    this.foul = null;
    this.penalty = null;
    this.offsidePass = null;
  }

  get pending(): number { return this.queue.length; }

  /** The clip that plays next, if any (read only). */
  get next(): IncidentReplay | null { return this.queue[0] ?? null; }

  private push(clip: IncidentReplay): IncidentReplay {
    // An unusually long advantage cannot accumulate an unbounded presentation backlog.
    if (this.queue.length >= 4) this.queue.shift();
    this.queue.push(clip);
    return clip;
  }

  private capture(kind: IncidentReplay['kind'], label: string, buffer: ReplayBuffer, actors: number[], settledPenalty = false, n = LEAD_FRAMES, caption = ''): IncidentReplay | null {
    const frames = buffer.snapshot(n);
    if (frames.length < 2) return null;
    const actionIdx = frames.length - 1;
    return this.push({ kind, label, caption, frames, actionIdx, slowFrom: actionIdx - 39, slowTo: actionIdx, actors, settledPenalty });
  }

  private dress(f: PendingFoul): void {
    const clip = f.clip;
    if (!clip) return;
    clip.kind = f.card ?? (f.penalty ? 'penalty-award' : 'foul');
    clip.label = f.card ? `${f.card === 'red' ? 'RED CARD' : 'YELLOW CARD'}${f.penalty ? ' + PENALTY' : ''} REPLAY`
      : f.penalty ? 'PENALTY REPLAY' : 'FOUL REPLAY';
  }

  /**
   * Cut a foul's clip once its aftermath is on tape: FOUL_TAIL_FRAMES after the contact when play ran on
   * (advantage), or at the end of the dead-ball beat when the whistle went at once. The contact is always inside it.
   */
  private settleFoul(m: Match, buffer: ReplayBuffer, recorded: number, force = false): void {
    const f = this.foul;
    if (!f || f.clip) return;
    const since = recorded - f.at;
    const dead = m.phase === 'out' ? m.phaseT >= DEAD_HOLD_S : m.phase !== 'play';
    if (!force && !dead && since < FOUL_TAIL_FRAMES) return;
    const frames = buffer.snapshot(FOUL_LEAD_FRAMES + since + 1);
    const contact = frames.length - 1 - since;
    if (frames.length < 2 || contact < 0) { this.foul = null; return; }
    continueFrames(frames, FOUL_TAIL_FRAMES - since);
    f.clip = this.push({
      kind: 'foul', label: 'FOUL REPLAY', caption: f.caption, frames, actionIdx: contact,
      slowFrom: Math.max(0, contact - FOUL_SLOW_BEFORE), slowTo: Math.min(frames.length - 1, contact + FOUL_SLOW_AFTER),
      fouler: f.by, victim: f.on, actors: [f.by, f.on], settledPenalty: false,
    });
    this.dress(f);
  }

  private penaltyClip(m: Match, buffer: ReplayBuffer, recorded: number, pen: PendingPenalty, title: string, keeper: number): void {
    const frames = buffer.snapshot(recorded - pen.first + 1);
    if (frames.length < 2) return;
    const last = frames.length - 1;
    const strike = Math.max(0, last - (recorded - pen.strike));
    const outcome = pen.settledAt < 0 ? last : Math.max(strike, last - (recorded - pen.settledAt));
    const who = title === 'PENALTY SAVED' && keeper >= 0 ? `SAVED BY ${nameOf(m, keeper)}`
      : `${title.replace('PENALTY ', '')} ${nameOf(m, pen.taker)}`;
    this.push({
      kind: 'penalty-result', label: `${title} REPLAY`, caption: who.trim(), frames, actionIdx: outcome,
      slowFrom: Math.max(0, strike - 3), slowTo: Math.min(last, outcome + 12, strike + 60),
      actors: [pen.taker, keeper].filter(i => i >= 0), settledPenalty: true,
    });
  }

  /** Called after the step's final frame is recorded, while the whistle/contact positions still exist. */
  observe(events: readonly MatchEvent[], m: Match, buffer: ReplayBuffer, recorded: number, before: IncidentStep): void {
    // Ordinary goals own their existing celebration and replay. Do not recap a preceding advantage twice.
    if (events.some(e => e.type === 'goal')) { this.clear(); return; }

    for (const e of events) {
      if (e.type === 'foul') {
        // (A second foul before the first one's tail is on tape: the first is cut with what there is.)
        this.settleFoul(m, buffer, recorded, true);
        const by = nameOf(m, e.by);
        this.foul = { by: e.by, on: e.on, at: recorded, penalty: e.penalty, card: null, clip: null,
          caption: by ? `FOUL BY ${by}` : 'FOUL' };
      } else if (e.type === 'offside') {
        this.settleFoul(m, buffer, recorded, true);
        this.foul = null;
        const pass = this.offsidePass;
        const watched = pass?.kickId === m.kickId && pass.side === e.side;
        const lead = watched ? Math.max(LEAD_FRAMES, recorded - pass.first + 1) : LEAD_FRAMES;
        const who = nameOf(m, e.player);
        const clip = this.capture('offside', 'OFFSIDE REPLAY', buffer, watched ? [e.player, pass.player] : [e.player], false, lead,
          who ? `OFFSIDE ${who}` : 'OFFSIDE');
        if (clip && watched) {
          clip.releaseIdx = Math.max(0, clip.frames.length - 1 - (recorded - (pass.first + SHOT_LEAD_FRAMES)));
          clip.offside = offsideAt(clip.frames[clip.releaseIdx], m, e.side, e.player);
          // (The release is the decision: no slow motion at the flag as well.)
          clip.slowFrom = clip.slowTo = -1;
        }
        this.offsidePass = null;
      } else if (e.type === 'card') {
        const f = this.foul;
        if (f && f.by === e.player && (!f.clip || this.queue.includes(f.clip))) {
          // A foul, its card and penalty award share one clip.
          f.card = e.color === 'red' ? 'red' : 'yellow';
          this.dress(f);
        } else this.capture(e.color === 'red' ? 'red' : 'yellow', e.color === 'red' ? 'RED CARD REPLAY' : 'YELLOW CARD REPLAY', buffer, [e.player]);
      } else if (e.type === 'restart' && e.kind === 'penalty') {
        const f = this.foul;
        if (f && (!f.clip || this.queue.includes(f.clip))) {
          f.penalty = true;
          this.dress(f);
        } else this.capture('penalty-award', 'PENALTY REPLAY', buffer, [m.restart?.taker ?? -1].filter(i => i >= 0));
      }

      if (e.type === 'kick') {
        const passer = e.player === undefined ? null : m.players[e.player];
        const eligible = e.kind === 'pass' || e.kind === 'through' || e.kind === 'lob';
        this.offsidePass = eligible && passer ? { kickId: m.kickId, side: passer.side, player: passer.idx, first: recorded - SHOT_LEAD_FRAMES } : null;
      }
      if (e.type === 'kick' && e.kind === 'shot') {
        const r = before.restart;
        const inMatch = before.phase === 'restart' && r?.kind === 'penalty' &&
          (e.player === undefined || e.player === r.taker) && m.kickId !== before.kickId;
        const shootout = before.phase === 'shootout' && m.shootout &&
          (before.shootoutStage === 'aim' || before.shootoutStage === 'flight');
        if (inMatch || shootout) this.penalty = { kickId: m.kickId, first: recorded - PEN_LEAD_FRAMES, strike: recorded,
          taker: e.player ?? r?.taker ?? m.shootout?.taker ?? -1, saved: false, post: false, settledAt: -1 };
      } else if (e.type === 'save' && this.penalty) this.penalty.saved = true;
      else if (e.type === 'post' && this.penalty) this.penalty.post = true;
      else if (e.type === 'shootoutKick') {
        const how = m.shootout?.last?.how;
        const title = e.scored ? 'PENALTY SCORED' : how === 'saved' ? 'PENALTY SAVED' : how === 'post' ? 'PENALTY OFF THE POST' : 'PENALTY MISSED';
        const pen = this.penalty ?? { kickId: m.kickId, first: recorded - LEAD_FRAMES, strike: recorded - SHOT_LEAD_FRAMES,
          taker: e.taker, saved: false, post: false, settledAt: -1 };
        pen.taker = e.taker;
        pen.settledAt = recorded;
        pen.judged = { title, keeper: m.shootout?.keeper ?? -1 };
        this.penalty = pen;
      }
    }

    this.settleFoul(m, buffer, recorded);

    const pen = this.penalty;
    if (!pen) return;
    if (pen.judged) {
      // A shootout kick: the ball is seen into the net, the gloves or the crowd before its recap cuts in.
      const result = m.phase === 'shootout' && m.shootout?.stage === 'result';
      if (result && recorded - pen.settledAt < PEN_SETTLE_FRAMES) return;
      this.penaltyClip(m, buffer, recorded, pen, pen.judged.title, pen.judged.keeper);
      this.penalty = null;
      return;
    }
    if (m.phase === 'shootout') return;
    // A parry or the post alone is still a live shot: wait for a claim, controlled rebound or whistle.
    const stopped = m.phase !== 'play';
    const controlled = m.ball.held || m.ball.owner >= 0;
    if (pen.settledAt < 0) {
      if (!stopped && !controlled) {
        if (recorded - pen.strike > PEN_STALE_FRAMES) this.penalty = null;
        return;
      }
      pen.settledAt = recorded;
    }
    // Final, and seen to be: a miss has left play and the ball has gone dead, a save is in the keeper's hands.
    const ready = m.phase === 'out' ? m.phaseT >= DEAD_HOLD_S : stopped || (controlled && recorded - pen.settledAt >= PEN_SETTLE_FRAMES);
    if (!ready) {
      if (recorded - pen.strike > PEN_STALE_FRAMES) this.penalty = null;
      return;
    }
    const keeper = m.teamPlayers(m.players[pen.taker]?.side === 0 ? 1 : 0)[0]?.idx ?? -1;
    const saved = pen.saved || (m.ball.held && m.ball.owner === keeper);
    const title = saved ? 'PENALTY SAVED' : pen.post ? 'PENALTY OFF THE POST' : 'PENALTY MISSED';
    this.penaltyClip(m, buffer, recorded, pen, title, keeper);
    this.penalty = null;
  }

  /**
   * A dead ball whose recap is still being recorded (a foul's fall, a missed penalty leaving play): nothing else
   * may take the stoppage (a substitution's shot, the tunnel) in the half second before the clip holds it.
   */
  settling(m: Match): boolean {
    if (m.phase !== 'out') return false;
    return (!!this.foul && !this.foul.clip) || (!!this.penalty && this.penalty.settledAt >= 0);
  }

  /** Advantage stays live. A settled penalty is safe to hold even when a keeper now owns the live ball. */
  waiting(m: Match): boolean {
    if (!this.queue.length || m.phase === 'goal' || m.phase === 'kickoff') return false;
    return this.queue[0].settledPenalty || m.phase === 'out' || m.phase === 'restart' || m.phase === 'halftime' || m.phase === 'fulltime' ||
      (m.phase === 'shootout' && m.shootout?.stage === 'result');
  }

  take(m: Match): IncidentReplay | null {
    if (!this.waiting(m)) return null;
    const clip = this.queue.shift()!;
    if (this.foul?.clip === clip) this.foul = null;
    return clip;
  }
}

/**
 * The offside line in a recorded frame, by the sim's own rule (Match.offsideLine / inOffsidePosition): level with
 * the second-last opponent, the ball or the halfway line, whichever is nearest the goal attacked.
 */
export function offsideAt(fr: Float32Array, m: Match, side: Side, attacker: number): { lineX: number; attacker: number; defender: number } {
  const ad = m.attackDir(side);
  let last = -Infinity;
  let second = -Infinity;
  let lastI = -1;
  let secondI = -1;
  for (const p of m.players) {
    if (p.side === side || fr[p.idx * PF + 4] === SENT_OFF_CODE) continue;
    const x = fr[p.idx * PF] * ad;
    if (x > last) {
      second = last; secondI = lastI;
      last = x; lastI = p.idx;
    } else if (x > second) {
      second = x; secondI = p.idx;
    }
  }
  const line = Math.min(HALF_L, Math.max(0, second, fr[BALL_OFS] * ad));
  return { lineX: line * ad, attacker, defender: secondI };
}
