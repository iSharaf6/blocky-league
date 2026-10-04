import type { MatchRequest } from '../app';
import { Rng } from '../core/rng';
import { Ball } from '../sim/ball';
import { savedBlitz, restoreBlitz } from '../sim/blitz';
import { HumanCtl, Match } from '../sim/match';
import { Player } from '../sim/player';
import { savedHype, restoreHype } from '../sim/hype';
import { savedScenario, restoreScenario } from '../sim/scenario';
import type { SessionOptions } from './matchSession';
import { decodeState, type StateGraph } from './stateCodec';

export { savedBlitz, restoreBlitz, savedHype, restoreHype, savedScenario, restoreScenario };
export const RECOVERY_KEY = 'blockyleague.match.v1';
export const RECOVERY_INTERVAL_S = 2;
export type RecoveryRequest = Omit<MatchRequest, 'reward' | 'onBanked' | 'onDone' | 'onQuit'>;
export interface PendingMatch {
  version: 1;
  savedAt: string;
  /** A result already banked in the regular save can never be paid again from an old snapshot. */
  recordPlayed: number;
  progressXp?: number;
  context?: string;
  route: 'career' | 'run' | 'friendly' | 'moment' | 'basics';
  request: RecoveryRequest;
  options: SessionOptions;
  runtime: StateGraph;
  tally: Record<string, unknown>;
}
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PHASES = new Set(['kickoff', 'play', 'out', 'restart', 'goal', 'halftime', 'fulltime', 'shootout']);

function team(v: unknown): boolean {
  const t = v as MatchRequest['home'];
  return !!t && typeof t.name === 'string' && typeof t.short === 'string' && !!t.kit &&
    Array.isArray(t.players) && t.players.length >= 11 && t.players.length <= 40 &&
    t.players.every(p => p && typeof p.name === 'string' && !!p.stats);
}

/** Validate a detached copy before any live session is changed. A partial or unsupported save stays harmless. */
export function recoveredMatch(graph: StateGraph): Match {
  const state = decodeState<{ match: Match }>(graph);
  const m = state?.match;
  if (!(m instanceof Match) || !(m.ball instanceof Ball) || !(m.rng instanceof Rng) ||
      !team(m.cfg?.home) || !team(m.cfg?.away) || !PHASES.has(m.phase) ||
      (m.half !== 1 && m.half !== 2) || !Number.isFinite(m.clock) || m.clock < 0 ||
      !Number.isFinite(m.cfg.halfLength) || m.cfg.halfLength < 15 || (m.cfg.halfLength > 1800 && m.cfg.halfLength !== Number.MAX_SAFE_INTEGER) ||
      !Array.isArray(m.players) || m.players.length !== 22 || !Array.isArray(m.ctl) || m.ctl.length !== 2 ||
      !Array.isArray(m.score) || m.score.length !== 2 || m.score.some(n => !Number.isInteger(n) || n < 0 || n > 999) ||
      !Number.isInteger(m.ball.owner) || m.ball.owner < -1 || m.ball.owner >= 22 ||
      ![m.ball.pos.x, m.ball.pos.y, m.ball.pos.z, m.ball.vel.x, m.ball.vel.y, m.ball.vel.z].every(Number.isFinite)) {
    throw new Error('Invalid saved football state');
  }
  const fresh = new Match(m.cfg);
  if (Object.keys(fresh).some(k => !Object.hasOwn(m, k)) ||
      m.players.some((p, i) => !(p instanceof Player) || p.idx !== i ||
        Object.keys(fresh.players[i]).some(k => !Object.hasOwn(p, k)) ||
        ![p.pos.x, p.pos.z, p.vel.x, p.vel.z, p.stamina].every(Number.isFinite)) ||
      m.ctl.some((c, i) => !(c instanceof HumanCtl) || Object.keys(fresh.ctl[i]).some(k => !Object.hasOwn(c, k)))) {
    throw new Error('Incomplete or outdated saved match');
  }
  return m;
}

export function recoveryRequest(req: MatchRequest): RecoveryRequest {
  const { reward: _reward, onBanked: _banked, onDone: _done, onQuit: _quit, ...plain } = req;
  return plain;
}

export function recoveryRoute(req: MatchRequest): PendingMatch['route'] {
  if (req.kind === 'career') return 'career';
  if (req.kind === 'run' || req.nextLabel === 'CONTINUE RUN') return 'run';
  if (req.kind === 'basics') return 'basics';
  return req.scenario ? 'moment' : 'friendly';
}

/** Local only: an unfinished attack never overwrites the ordinary progress save or another device's match. */
export class MatchRecoveryStore {
  constructor(private readonly store: Store) {}

  write(state: PendingMatch): boolean {
    try {
      const json = JSON.stringify(state);
      if (json.length > 2_000_000) return false;
      this.store.setItem(RECOVERY_KEY, json);
      return true;
    } catch { return false; }
  }

  read(recordPlayed: number, progressXp?: number): PendingMatch | null {
    try {
      const raw = this.store.getItem(RECOVERY_KEY);
      if (!raw) return null;
      if (raw.length > 2_000_000) throw new Error('Snapshot too large');
      const p = JSON.parse(raw) as PendingMatch;
      if (p.version !== 1 || p.recordPlayed !== recordPlayed || (progressXp !== undefined && p.progressXp !== undefined && p.progressXp !== progressXp) ||
          !['career', 'run', 'friendly', 'moment', 'basics'].includes(p.route) ||
          !team(p.options?.home) || !team(p.options?.away) || !team(p.request?.home) || !team(p.request?.away) ||
          !Array.isArray(p.options.kits) || p.options.kits.length !== 2 || !p.tally || typeof p.tally !== 'object') {
        throw new Error('Invalid snapshot envelope');
      }
      recoveredMatch(p.runtime);
      return p;
    } catch { this.clear(); return null; }
  }

  clear(): void { try { this.store.removeItem(RECOVERY_KEY); } catch { /* A full/private store must not stop play. */ } }
}
