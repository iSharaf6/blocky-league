import type { Match, Phase, Restart } from '../sim/match';
import type { MatchEvent } from '../sim/types';
import { ReplayBuffer } from './replay';

/** A television recap of an actual incident, separate from the goal/celebration lifecycle. */
export interface IncidentReplay {
  kind: 'offside' | 'foul' | 'yellow' | 'red' | 'penalty-award' | 'penalty-result';
  label: string;
  frames: Float32Array[];
  actionIdx: number;
  /** Offside is judged at the original pass release, rather than the receiver's later touch. */
  releaseIdx?: number;
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

/** Presentation only. Never writes the match graph, consumes RNG or creates a restart. */
export class IncidentReplays {
  private queue: IncidentReplay[] = [];
  private foul: { by: number; clip: IncidentReplay } | null = null;
  private penalty: { kickId: number; first: number; taker: number; saved: boolean; post: boolean } | null = null;
  private offsidePass: { kickId: number; side: number; player: number; first: number } | null = null;

  clear(): void {
    this.queue.length = 0;
    this.foul = null;
    this.penalty = null;
    this.offsidePass = null;
  }

  get pending(): number { return this.queue.length; }

  private capture(kind: IncidentReplay['kind'], label: string, buffer: ReplayBuffer, actors: number[], settledPenalty = false, n = LEAD_FRAMES): IncidentReplay | null {
    const frames = buffer.snapshot(n);
    if (frames.length < 2) return null;
    const clip: IncidentReplay = { kind, label, frames, actionIdx: frames.length - 1, actors, settledPenalty };
    // An unusually long advantage cannot accumulate an unbounded presentation backlog.
    if (this.queue.length >= 4) this.queue.shift();
    this.queue.push(clip);
    return clip;
  }

  /** Called after the step's final frame is recorded, while the whistle/contact positions still exist. */
  observe(events: readonly MatchEvent[], m: Match, buffer: ReplayBuffer, recorded: number, before: IncidentStep): void {
    // Ordinary goals own their existing celebration and replay. Do not recap a preceding advantage twice.
    if (events.some(e => e.type === 'goal')) { this.clear(); return; }

    for (const e of events) {
      if (e.type === 'foul') {
        const clip = this.capture(e.penalty ? 'penalty-award' : 'foul', e.penalty ? 'PENALTY REPLAY' : 'FOUL REPLAY', buffer, [e.by, e.on]);
        this.foul = clip ? { by: e.by, clip } : null;
      } else if (e.type === 'offside') {
        this.foul = null;
        const pass = this.offsidePass;
        const watched = pass?.kickId === m.kickId && pass.side === e.side;
        const lead = watched ? Math.max(LEAD_FRAMES, recorded - pass.first + 1) : LEAD_FRAMES;
        const clip = this.capture('offside', 'OFFSIDE REPLAY', buffer, watched ? [e.player, pass.player] : [e.player], false, lead);
        if (clip && watched) clip.releaseIdx = Math.max(0, clip.frames.length - 1 - (recorded - (pass.first + SHOT_LEAD_FRAMES)));
        this.offsidePass = null;
      } else if (e.type === 'card') {
        const clip = this.foul?.by === e.player && this.queue.includes(this.foul.clip) ? this.foul.clip :
          this.capture(e.color === 'red' ? 'red' : 'yellow', e.color === 'red' ? 'RED CARD REPLAY' : 'YELLOW CARD REPLAY', buffer, [e.player]);
        if (clip) {
          const penalty = clip.kind === 'penalty-award';
          clip.kind = e.color === 'red' ? 'red' : 'yellow';
          clip.label = `${e.color === 'red' ? 'RED CARD' : 'YELLOW CARD'}${penalty ? ' + PENALTY' : ''} REPLAY`;
        }
      } else if (e.type === 'restart' && e.kind === 'penalty') {
        // A foul/card/penalty is one incident, including a booking earlier in this event batch.
        const existing = this.foul && this.queue.includes(this.foul.clip) ? this.foul.clip : null;
        if (existing) {
          if (existing.kind === 'foul') existing.kind = 'penalty-award';
          if (!existing.label.includes('PENALTY')) existing.label = existing.label.replace(' REPLAY', ' + PENALTY REPLAY');
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
        if (inMatch || shootout) this.penalty = { kickId: m.kickId, first: recorded - SHOT_LEAD_FRAMES,
          taker: e.player ?? r?.taker ?? m.shootout?.taker ?? -1, saved: false, post: false };
      } else if (e.type === 'save' && this.penalty) this.penalty.saved = true;
      else if (e.type === 'post' && this.penalty) this.penalty.post = true;
      else if (e.type === 'shootoutKick') {
        const how = m.shootout?.last?.how;
        const title = e.scored ? 'PENALTY SCORED' : how === 'saved' ? 'PENALTY SAVED' : how === 'post' ? 'PENALTY OFF THE POST' : 'PENALTY MISSED';
        this.capture('penalty-result', `${title} REPLAY`, buffer, [e.taker, m.shootout?.keeper ?? -1].filter(i => i >= 0), true,
          this.penalty ? recorded - this.penalty.first + 1 : LEAD_FRAMES);
        this.penalty = null;
      }
    }

    const pen = this.penalty;
    if (!pen || m.phase === 'shootout') return;
    // A parry or the post alone is still a live shot: wait for a claim, controlled rebound or whistle.
    const settled = m.ball.held || m.ball.owner >= 0 || m.phase === 'out' || m.phase === 'restart' || m.phase === 'halftime' || m.phase === 'fulltime';
    if (!settled) return;
    const keeper = m.teamPlayers(m.players[pen.taker]?.side === 0 ? 1 : 0)[0]?.idx;
    const saved = pen.saved || (m.ball.held && m.ball.owner === keeper);
    const title = saved ? 'PENALTY SAVED' : pen.post ? 'PENALTY OFF THE POST' : 'PENALTY MISSED';
    this.capture('penalty-result', `${title} REPLAY`, buffer, [pen.taker, keeper ?? -1].filter(i => i >= 0), true, recorded - pen.first + 1);
    this.penalty = null;
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
