/**
 * THE BOARD: three objectives every season, so there is always an answer to "what am I playing for right now?".
 * One for the league (scaled to the division and to how strong your club is next to it), one for a cup, and one about
 * how you play or build (clean sheets, a big win, goals, the derby, a signing, the academy). Progress is read live from
 * the season (nothing to keep in step); an objective is checked off the moment it is met, which pays its coins (with
 * the moment on the hub: ui/career.ts) and lifts BOARD CONFIDENCE. Confidence moves the wage budget a little (up to
 * plus or minus 10%), never a sacking: the game stays kind.
 * Pure rules and state; no DOM.
 *
 * Runtime import cycle with career.ts: bindings from it are only used inside functions.
 */
import { hashString } from '../core/rng';
import { overall, type PlayerDef, type Role } from '../sim/types';
import {
  BOTTOM_DIVISION, CLUBS_PER_DIVISION, MATCHDAYS, TOP_DIVISION, YOU, clubRating, divisionPlayerOverall, leagueTable, userPosition,
  type CareerState,
} from './career';
import { exitRound } from './cup';
import { compReached } from './comps';
import { LEGACY_POINTS, addLegacy } from './legacy';
import type { LifePlayer } from './life';
import { addMoment } from './story';

export type ObjectiveKind = 'finish' | 'cup' | 'continental' | 'cleanSheets' | 'bigWin' | 'goals' | 'wins' | 'derby' | 'sign' | 'academy';

export interface Objective {
  kind: ObjectiveKind;
  /** Position to finish in or better, cup round to reach (1 SF, 2 final, 3 win), a count, a margin, an OVR. */
  target: number;
  /** For a signing: the position he plays. */
  role?: Role;
  /** Coins when met. */
  reward: number;
  /** 'done' once met (paid), 'failed' once it can't be any more. */
  state: 'open' | 'done' | 'failed';
}

export interface BoardState {
  /** Season these objectives are for. */
  season: number;
  objectives: Objective[];
  /** 0..100, starts at 50. */
  confidence: number;
  /** Coins earned by objectives and not yet paid (the hub pays them with the moment). */
  owed: number;
}

export interface ObjectiveView {
  obj: Objective;
  /** "FINISH TOP 2", "KEEP 3 CLEAN SHEETS". */
  label: string;
  /** Short form for chips: "TOP 2", "CUP SF", "3 CLEAN SHEETS". */
  short: string;
  /** Live: "NOW 4TH", "1 OF 3", "IN THE QF". */
  progress: string;
  have: number;
  need: number;
}

export const CONFIDENCE_START = 50;
export const CONFIDENCE_DONE = 10;
export const CONFIDENCE_FAILED = 6;

const ROLE_WORD: Record<Role, string> = { GK: 'KEEPER', DF: 'DEFENDER', MF: 'MIDFIELDER', FW: 'STRIKER' };
const CUP_WORD = ['QF', 'SEMI FINAL', 'FINAL', 'WIN'];

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'TH' : (['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH');
  return `${n}${s}`;
}

export function defaultBoard(): BoardState {
  return { season: 0, objectives: [], confidence: CONFIDENCE_START, owed: 0 };
}

/** Wage budget multiplier from board confidence: 0.9 at 0, 1 at 50, 1.1 at 100. */
export function confidenceBudget(board: BoardState | undefined): number {
  const c = board?.confidence ?? CONFIDENCE_START;
  return 1 + (Math.max(0, Math.min(100, c)) - 50) / 500;
}

export function confidenceWord(c: number): string {
  return c >= 80 ? 'DELIGHTED' : c >= 60 ? 'PLEASED' : c >= 40 ? 'CALM' : c >= 20 ? 'WORRIED' : 'NERVOUS';
}

// ------------------------------------------------------------------ setting them

/** The weakest outfield line in your best eleven (where a signing helps most). */
function weakestRole(state: CareerState): Role {
  const xi = state.club?.squad.slice(0, 11) ?? [];
  let best: Role = 'FW';
  let low = Infinity;
  for (const r of ['DF', 'MF', 'FW'] as Role[]) {
    const ps = xi.filter((p) => p.role === r);
    if (!ps.length) return r;
    const avg = ps.reduce((s, p) => s + overall(p), 0) / ps.length;
    if (avg < low) {
      low = avg;
      best = r;
    }
  }
  return best;
}

/**
 * The board's three objectives for the season just started, scaled to the division and to how your club compares
 * with the league (its rating against the rivals'): a strong club is asked for the title, a weak one to stay up.
 */
export function setObjectives(state: CareerState): void {
  const season = state.season;
  const club = state.club;
  if (!season || !club || state.board.season === season.number) return;
  const div = season.division;
  const mine = clubRating(club);
  const avg = season.rivals.reduce((s, r) => s + r.rating, 0) / Math.max(1, season.rivals.length);
  const edge = mine - avg;
  const step = BOTTOM_DIVISION - div;
  const objectives: Objective[] = [];
  // The league.
  const finish = edge >= 4 ? 1 : edge >= 0 ? 2 : edge >= -4 ? 4 : 6;
  // (No promotion from the top, so "top 2" there is "top 3"; nobody goes down from the bottom, so "stay up" is "top 4".)
  const pos = div === TOP_DIVISION && finish === 2 ? 3 : div === BOTTOM_DIVISION && finish === 6 ? 4 : finish;
  objectives.push({ kind: 'finish', target: pos, reward: Math.round((200 + 60 * step) * (pos === 1 ? 1.5 : 1)), state: 'open' });
  // A cup: the Continental Cup in the Elite League, else the Blocky Cup.
  const cupTarget = edge >= 6 ? 3 : edge >= 0 ? 2 : 1;
  if (div === TOP_DIVISION && season.continental) objectives.push({ kind: 'continental', target: Math.min(2, cupTarget), reward: 400, state: 'open' });
  else if (season.cup) objectives.push({ kind: 'cup', target: cupTarget, reward: Math.round((150 + 40 * step) * (cupTarget === 3 ? 1.5 : 1)), state: 'open' });
  // One about how you play or build, rotated by the season (the derby when there is one, every other season).
  const h = hashString(`${state.seed}|board|${season.number}`);
  const kinds: ObjectiveKind[] = ['cleanSheets', 'bigWin', 'goals', 'wins', 'sign', 'academy'];
  let kind = kinds[h % kinds.length];
  if (season.derby && season.number % 2 === 0) kind = 'derby';
  if (kind === 'academy' && !state.academy.prospects.length) kind = 'sign';
  const reward = 120 + 30 * step;
  const o = (k: ObjectiveKind, target: number, role?: Role): Objective => ({ kind: k, target, reward, state: 'open', ...(role ? { role } : {}) });
  switch (kind) {
    // (Sized for a home and away season of 14 league matchdays.)
    case 'cleanSheets': objectives.push(o(kind, edge >= 0 ? 5 : 4)); break;
    case 'bigWin': objectives.push(o(kind, 3)); break;
    case 'goals': objectives.push(o(kind, edge >= 0 ? 26 : 18)); break;
    case 'wins': objectives.push(o(kind, edge >= 0 ? 8 : 6)); break;
    case 'derby': objectives.push(o(kind, 1)); break;
    case 'academy': objectives.push(o(kind, 1)); break;
    case 'sign': {
      const role = weakestRole(state);
      objectives.push(o(kind, divisionPlayerOverall(div, role) + 2, role));
      break;
    }
    default: break;
  }
  state.board.season = season.number;
  state.board.objectives = objectives;
}

// ------------------------------------------------------------------ reading progress

/** Your results this season in every competition: goals for and against, and who went through a level knockout. */
export function seasonResults(state: CareerState): { my: number; their: number; league: boolean; forfeit: boolean; won?: boolean; vs: string }[] {
  const season = state.season;
  if (!season) return [];
  const out: { my: number; their: number; league: boolean; forfeit: boolean; won?: boolean; vs: string }[] = [];
  for (const f of season.fixtures) {
    if ((f.home !== YOU && f.away !== YOU) || f.hg === null || f.ag === null) continue;
    const home = f.home === YOU;
    out.push({ my: home ? f.hg : f.ag, their: home ? f.ag : f.hg, league: true, forfeit: !!f.forfeit, vs: home ? f.away : f.home });
  }
  const cup = season.cup;
  if (cup) {
    for (const t of cup.ties) {
      if ((t.home !== cup.user && t.away !== cup.user) || t.hg === null || t.ag === null) continue;
      const home = t.home === cup.user;
      out.push({ my: home ? t.hg : t.ag, their: home ? t.ag : t.hg, league: false, forfeit: false, won: t.winner === cup.user, vs: cup.slots[home ? t.away : t.home] ?? '' });
    }
  }
  for (const comp of [season.world, season.continental]) {
    if (!comp) continue;
    for (const f of comp.fixtures) {
      if ((f.home !== YOU && f.away !== YOU) || f.hg === null || f.ag === null) continue;
      const home = f.home === YOU;
      out.push({ my: home ? f.hg : f.ag, their: home ? f.ag : f.hg, league: false, forfeit: false, vs: home ? f.away : f.home });
    }
  }
  return out;
}

/** The Blocky Cup round you have reached: 0 the QF .. 2 the final, 3 won. */
function cupReached(state: CareerState): number {
  const cup = state.season?.cup;
  if (!cup) return 0;
  if (cup.status === 'won') return 3;
  return cup.status === 'active' ? cup.round : exitRound(cup);
}

function signedThisSeason(state: CareerState, role: Role | undefined, ovr: number): PlayerDef | undefined {
  const n = state.season?.number ?? -1;
  return state.club?.squad.find((p) => (p as LifePlayer).boughtSeason === n && (!role || p.role === role) && overall(p) >= ovr);
}

export function viewObjective(state: CareerState, obj: Objective): ObjectiveView {
  const season = state.season;
  const res = seasonResults(state);
  const league = res.filter((r) => r.league);
  const n = (have: number, need: number, label: string, short: string): ObjectiveView => ({
    obj, label, short, have: Math.min(have, need), need, progress: obj.state === 'done' ? 'DONE' : `${Math.min(have, need)} OF ${need}`,
  });
  switch (obj.kind) {
    case 'finish': {
      const pos = userPosition(state) || CLUBS_PER_DIVISION;
      const label = obj.target === 1 ? 'WIN THE LEAGUE' : obj.target >= 6 ? 'STAY UP' : `FINISH TOP ${obj.target}`;
      const short = obj.target === 1 ? 'WIN THE LEAGUE' : obj.target >= 6 ? 'STAY UP' : `TOP ${obj.target}`;
      const started = (season?.matchday ?? 0) > 0;
      return { obj, label, short, have: pos <= obj.target ? 1 : 0, need: 1, progress: obj.state === 'done' ? 'DONE' : started ? `NOW ${ordinal(pos)}` : 'NOT STARTED' };
    }
    case 'cup':
    case 'continental': {
      const reached = obj.kind === 'cup' ? cupReached(state) : season?.continental ? compReached(season.continental) : 0;
      const comp = obj.kind === 'cup' ? 'CUP' : 'CONTINENTAL';
      const label = obj.target === 3 ? `WIN THE ${obj.kind === 'cup' ? 'BLOCKY CUP' : 'CONTINENTAL CUP'}` : `REACH THE ${comp} ${CUP_WORD[obj.target]}`;
      const chip = obj.kind === 'cup' ? 'CUP' : 'CONT';
      const short = obj.target === 3 ? `WIN THE ${chip}` : `${chip} ${obj.target === 1 ? 'SF' : 'FINAL'}`;
      const where = obj.kind === 'cup' ? ['IN THE QF', 'IN THE SF', 'IN THE FINAL', 'WON'] : ['IN THE GROUP', 'IN THE SF', 'IN THE FINAL', 'WON'];
      return { obj, label, short, have: Math.min(reached, obj.target), need: obj.target, progress: obj.state === 'done' ? 'DONE' : obj.state === 'failed' ? 'OUT' : where[reached] };
    }
    case 'cleanSheets': {
      const have = res.filter((r) => r.their === 0 && !r.forfeit).length;
      return n(have, obj.target, `KEEP ${obj.target} CLEAN SHEETS`, `${obj.target} CLEAN SHEETS`);
    }
    case 'bigWin': {
      const best = res.reduce((b, r) => Math.max(b, r.my - r.their), 0);
      return { ...n(best >= obj.target ? 1 : 0, 1, `WIN BY ${obj.target} OR MORE ONCE`, `WIN BY ${obj.target}+`), progress: obj.state === 'done' ? 'DONE' : best > 0 ? `BEST +${best}` : 'NOT YET' };
    }
    case 'goals': {
      const have = league.reduce((s, r) => s + r.my, 0);
      return n(have, obj.target, `SCORE ${obj.target} LEAGUE GOALS`, `${obj.target} GOALS`);
    }
    case 'wins': {
      const have = league.filter((r) => r.my > r.their).length;
      return n(have, obj.target, `WIN ${obj.target} LEAGUE MATCHES`, `${obj.target} WINS`);
    }
    case 'derby': {
      const r = state.story.rival;
      const d = league.find((x) => x.vs === season?.derby);
      const name = r ? r.short : 'RIVALS';
      return { ...n(d && d.my > d.their ? 1 : 0, 1, `BEAT ${r ? r.name.toUpperCase() : 'YOUR RIVALS'} IN THE DERBY`, `BEAT ${name}`), progress: obj.state === 'done' ? 'DONE' : d ? 'NOT WON' : 'TO PLAY' };
    }
    case 'sign': {
      const p = signedThisSeason(state, obj.role, obj.target);
      const word = obj.role ? ROLE_WORD[obj.role] : 'PLAYER';
      return { ...n(p ? 1 : 0, 1, `SIGN A ${obj.target}+ OVR ${word}`, `SIGN ${obj.target}+ ${obj.role ?? ''}`.trim()), progress: obj.state === 'done' ? 'DONE' : 'IN THE MARKET' };
    }
    case 'academy': {
      const done = state.academy.promoted === season?.number;
      return { ...n(done ? 1 : 0, 1, 'PROMOTE AN ACADEMY PROSPECT', 'PROMOTE A PROSPECT'), progress: obj.state === 'done' ? 'DONE' : `${state.academy.prospects.length} WAITING` };
    }
  }
}

export function boardView(state: CareerState): ObjectiveView[] {
  return state.board.season === state.season?.number ? state.board.objectives.map((o) => viewObjective(state, o)) : [];
}

/** Met now (or already): the league finish only counts once the season is over. */
function met(state: CareerState, v: ObjectiveView, final: boolean): boolean {
  if (v.obj.kind === 'finish') return final && (userPosition(state) || 99) <= v.obj.target;
  return v.have >= v.need;
}

/** Can't be met any more. */
function lost(state: CareerState, v: ObjectiveView, final: boolean): boolean {
  if (final) return true;
  const season = state.season;
  switch (v.obj.kind) {
    case 'cup':
      return season?.cup ? season.cup.status !== 'active' && cupReached(state) < v.obj.target : true;
    case 'continental':
      return season?.continental ? season.continental.status !== 'active' && compReached(season.continental) < v.obj.target : true;
    case 'derby': {
      const r = seasonResults(state).find((x) => x.league && x.vs === season?.derby);
      return !!r && r.my <= r.their;
    }
    default:
      return false;
  }
}

/**
 * Check the objectives against the season as it stands (after every result; `final` at the season's end, when the
 * league finish is judged and anything still open has failed). Each one met is paid into `owed`, lifts confidence,
 * adds legacy and queues its moment. Returns the ones just met.
 */
export function checkBoard(state: CareerState, final = false): Objective[] {
  const board = state.board;
  if (!state.season || board.season !== state.season.number) return [];
  const done: Objective[] = [];
  for (const obj of board.objectives) {
    if (obj.state !== 'open') continue;
    const v = viewObjective(state, obj);
    if (met(state, v, final)) {
      obj.state = 'done';
      board.owed += obj.reward;
      board.confidence = Math.min(100, board.confidence + CONFIDENCE_DONE);
      done.push(obj);
      addMoment(state, { kind: 'board', icon: 'star', title: 'OBJECTIVE DONE', text: v.label, coins: obj.reward });
      addLegacy(state, LEGACY_POINTS.objective, `OBJECTIVE: ${v.label}`);
    } else if (lost(state, v, final)) {
      obj.state = 'failed';
      board.confidence = Math.max(0, board.confidence - CONFIDENCE_FAILED);
    }
  }
  return done;
}

/** Pay what the objectives have earned (the hub does it with the moment). Returns the coins paid. */
export function payBoard(state: CareerState, wallet: { coins: number }): number {
  const n = state.board.owed;
  if (n <= 0) return 0;
  wallet.coins += n;
  state.board.owed = 0;
  return n;
}

/** Points the league finish objective still needs, for the NEXT GOAL line ("2 WINS TO GO TOP 2"). */
export function finishGap(state: CareerState, target: number): { wins: number; inside: boolean } {
  const table = leagueTable(state);
  const me = table.findIndex((r) => r.id === YOU);
  if (me < 0) return { wins: 0, inside: false };
  if (me < target) return { wins: 0, inside: true };
  const gap = (table[target - 1]?.PTS ?? 0) - table[me].PTS;
  return { wins: Math.max(1, Math.ceil((gap + 1) / 3)), inside: false };
}

/** Matches left in the league (for the hub's lines). */
export function leagueLeft(state: CareerState): number {
  return MATCHDAYS - (state.season?.matchday ?? MATCHDAYS);
}

// ------------------------------------------------------------------ save

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const KINDS: ObjectiveKind[] = ['finish', 'cup', 'continental', 'cleanSheets', 'bigWin', 'goals', 'wins', 'derby', 'sign', 'academy'];
const ROLES: Role[] = ['GK', 'DF', 'MF', 'FW'];

export function readBoard(v: unknown): BoardState {
  const b = defaultBoard();
  if (!isObj(v)) return b;
  b.season = isNum(v.season) ? Math.max(0, Math.round(v.season)) : 0;
  b.confidence = isNum(v.confidence) ? Math.max(0, Math.min(100, Math.round(v.confidence))) : CONFIDENCE_START;
  b.owed = isNum(v.owed) ? Math.max(0, Math.min(1e7, Math.round(v.owed))) : 0;
  if (Array.isArray(v.objectives)) {
    b.objectives = v.objectives
      .filter((o): o is Obj => isObj(o) && KINDS.includes(o.kind as ObjectiveKind) && isNum(o.target))
      .slice(0, 3)
      .map((o) => {
        const obj: Objective = {
          kind: o.kind as ObjectiveKind,
          target: Math.max(0, Math.min(99, Math.round(o.target as number))),
          reward: isNum(o.reward) ? Math.max(0, Math.min(1e6, Math.round(o.reward))) : 0,
          state: o.state === 'done' || o.state === 'failed' ? o.state : 'open',
        };
        if (ROLES.includes(o.role as Role)) obj.role = o.role as Role;
        return obj;
      });
  }
  return b;
}
