import { createClub, matchDifficulty, migrateCareer, newSeason, nextMatch, BOTTOM_DIVISION } from '../src/meta/career';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { Match, type MatchConfig } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import { HumanBot, type BotOptions } from './humanBot';

/**
 * The owner's four ways of playing (2026-10-05, from his iPhone, a career in the bottom division: "ive played 4 games
 * and the ai i keep scoring on him 15+ goals, but he never scored one on me"), as whole matches at the settings he
 * really plays, and what the AI does about each: how long he keeps the ball, how often a defender goes in and wins it,
 * from where (in front of him, beside him, behind him), what becomes of a tell he ignores, and the score.
 *
 * Human side 0. Deterministic per seed.
 */
export type OwnerBot = 'casual' | 'ignore' | 'circle' | 'straight';
export type OwnerSetting = 'career' | 'easy' | 'normal' | 'hard' | 'first';

export const OWNER_BOTS: Record<OwnerBot, BotOptions> = {
  casual: { casual: true, sprint: 'auto', skills: 'react' },
  ignore: { takeOn: true, sprint: 'auto', skills: 'off' },
  circle: { circle: 1, sprint: 'auto', skills: 'off' },
  straight: { straight: true, sprint: 'auto', skills: 'off' },
};

/** The menu's levels in sim units (ui/menus.ts DIFF_LEVEL). */
const LEVEL = [0.6, 1.8, 3, 4];

/** The match the game really starts for each setting (main.ts startMatch, ui/career.ts, core/dda.ts). */
export function ownerConfig(setting: OwnerSetting, seed: number): MatchConfig {
  const base = { halfLength: 120, humanSide: 0 as const, seed, coach: true, hype: true };
  if (setting === 'career') {
    // A new career's league fixture in the bottom division (his own club against a rival of that division), after
    // the first two matches' dynamic ease has gone (core/dda.ts): the difficulty is the division's.
    const career = migrateCareer(null, seed);
    career.club = createClub({ name: 'Test FC', short: 'TST', kit: makeTeam(PRESET_CLUBS[5]).kit, formation: '4-4-2' }, seed);
    newSeason(career, BOTTOM_DIVISION, 1);
    const f = nextMatch(career)!;
    const mine = f.userHome ? f.home : f.away;
    const theirs = f.userHome ? f.away : f.home;
    return { ...base, home: mine, away: theirs, difficulty: LEVEL[matchDifficulty(BOTTOM_DIVISION)] };
  }
  const home = makeTeam(PRESET_CLUBS[5]);
  const away = makeTeam(PRESET_CLUBS[6]);
  // PLAY NOW on a fresh save: EASY, 90 s halves, the first-match script and the first matches' ease.
  if (setting === 'first') return { ...base, home, away, difficulty: 0.6, halfLength: 90, firstMatch: true, assist: 0.5 };
  return { ...base, home, away, difficulty: setting === 'easy' ? 0.6 : setting === 'normal' ? 1.8 : 3 };
}

export type Where = 'front' | 'side' | 'behind';
/** How an AI spell ended: his man's tackle (`mineQuick`: within a second of the AI getting it), a team-mate's, a shot, a pass cut out, a clearance / long ball lost, out of play or a whistle, a loose ball lost. */
export type AiEnd = 'mine' | 'mineQuick' | 'mate' | 'shot' | 'cutOut' | 'hoof' | 'dead' | 'loose';
const AI_ENDS: AiEnd[] = ['mine', 'mineQuick', 'mate', 'shot', 'cutOut', 'hoof', 'dead', 'loose'];
const aiEnds = (): Record<AiEnd, number> => ({ mine: 0, mineQuick: 0, mate: 0, shot: 0, cutOut: 0, hoof: 0, dead: 0, loose: 0 });
const WHERE: Where[] = ['front', 'side', 'behind'];
const by3 = (): Record<Where, number> => ({ front: 0, side: 0, behind: 0 });

export interface OwnerMatch {
  gf: number;
  ga: number;
  shotsFor: number;
  shotsAgainst: number;
  /** Shots on target, his and the AI's; saves by his keeper and by the AI's. */
  onFor: number;
  onAgainst: number;
  savesMine: number;
  savesTheirs: number;
  /** His man's carries (from his first touch to the ball leaving him): count, seconds, the longest. */
  carries: number;
  carryT: number;
  /** Carries a defender got within ENGAGE m of, and of those the ones he had lost to the AI within 3 s of that. */
  engaged: number;
  lostIn3: number;
  /** Carries that ended with the AI taking it off him (a tackle won, or simply theirs next). */
  robbed: number;
  /** Seconds an AI man stood within REACH m of his ball, by where he stood. */
  reachT: Record<Where, number>;
  /** The AI's challenges on him (standing and slides), and those it won, by where they came from. */
  tries: Record<Where, number>;
  wins: Record<Where, number>;
  /** Tells: all; answered with SKILL; ignored with the ball kept at his feet; of those, the ones the defender then challenged, and the ones that challenge won (within TELL_OUT s). */
  tells: number;
  tellAnswered: number;
  tellIgnored: number;
  tellTried: number;
  tellLost: number;
  /** PERFECT answers, and those the man who showed the tell did not win the ball from. */
  perfect: number;
  perfectKept: number;
  /** Contested carries that ended in a free kick to him, and those he kept longer than 3 s. */
  fouled: number;
  keptOver3: number;
  /** The AI's spells on the ball: count, seconds, and how they ended (his man's tackle, a team-mate's, a shot, anything else). */
  aiSpells: number;
  aiSpellT: number;
  aiEnd: Record<AiEnd, number>;
  /** His man's own challenges (TACKLE taps, PRESS steals, bumps) and those that won it. */
  myTries: number;
  myWins: number;
}

/** A defender this near (m) his ball could reach it; this near him, the carry is contested. */
const REACH = 1.6;
const ENGAGE = 4;
const TELL_OUT = 1.4;

function where(c: Player, o: Player): Where {
  const tx = o.pos.x - c.pos.x;
  const tz = o.pos.z - c.pos.z;
  const tl = Math.hypot(tx, tz) || 1;
  // Where he is going (his run; standing, the way he faces).
  const sp = c.speed();
  const fx = sp > 1 ? c.vel.x / sp : Math.cos(c.facing);
  const fz = sp > 1 ? c.vel.z / sp : Math.sin(c.facing);
  const cos = (fx * tx + fz * tz) / tl;
  return cos > 0.5 ? 'front' : cos > -0.5 ? 'side' : 'behind';
}

export function ownerMatch(bot: OwnerBot | BotOptions, setting: OwnerSetting, seed: number, cfg: Partial<MatchConfig> = {}): OwnerMatch {
  const m = new Match({ ...ownerConfig(setting, seed), ...cfg });
  const human = new HumanBot(seed, typeof bot === 'string' ? OWNER_BOTS[bot] : bot);
  const r: OwnerMatch = {
    gf: 0, ga: 0, shotsFor: 0, shotsAgainst: 0, onFor: 0, onAgainst: 0, savesMine: 0, savesTheirs: 0, carries: 0, carryT: 0, engaged: 0, lostIn3: 0, robbed: 0,
    reachT: by3(), tries: by3(), wins: by3(), tells: 0, tellAnswered: 0, tellIgnored: 0, tellTried: 0, tellLost: 0, perfect: 0, perfectKept: 0,
    fouled: 0, keptOver3: 0, aiSpells: 0, aiSpellT: 0, aiEnd: aiEnds(), myTries: 0, myWins: 0,
  };
  let ai: { t: number; shot: boolean; by: 'mine' | 'mate' | null; kick: string } | null = null;
  let carry: { idx: number; t: number; engagedAt: number } | null = null;
  // The carry that has just ended, until the ball is somebody's (was it theirs next?).
  let ended: { t: number; engagedFor: number; left: number } | null = null;
  const tells: { by: number; t: number; answered: boolean; tried: boolean; lost: boolean; perfect: boolean; gone: boolean }[] = [];
  let t = 0;
  for (let steps = 0; m.phase !== 'fulltime' && steps < 60 * 60 * 16; steps++) {
    const pad = human.pad(m);
    const before = m.ball.owner;
    // Where the nearest AI man stands to his carrier, before the step (a won tackle moves both).
    const c0 = before >= 0 && !m.ball.held && m.players[before].side === 0 && m.phase === 'play' ? m.players[before] : null;
    const spots = new Map<number, Where>();
    if (c0) {
      let near = Infinity;
      let nearW: Where = 'front';
      for (const o of m.teamPlayers(1)) {
        if (o.sentOff || o.isKeeper) continue;
        const w = where(c0, o);
        spots.set(o.idx, w);
        const d = Math.hypot(o.pos.x - m.ball.pos.x, o.pos.z - m.ball.pos.z);
        if (d < near) {
          near = d;
          nearW = w;
        }
        if (carry && carry.engagedAt < 0 && Math.hypot(o.pos.x - c0.pos.x, o.pos.z - c0.pos.z) < ENGAGE) carry.engagedAt = carry.t;
      }
      if (near < REACH && o0(m, c0)) r.reachT[nearW] += DT;
    }
    m.step(DT, pad);
    const evs = m.drainEvents();
    human.observe(m, evs, before);
    t += DT;
    const owner = m.ball.owner;
    const mine = m.phase === 'play' && owner >= 0 && !m.ball.held && m.isHumanControlled(m.players[owner]);
    if (mine) {
      if (!carry || carry.idx !== owner) carry = { idx: owner, t: 0, engagedAt: -1 };
      carry.t += DT;
      ended = null;
    } else if (carry) {
      r.carries++;
      r.carryT += carry.t;
      // (A challenge that knocks it off him has taken it from him, whoever picks it up.)
      const poked = evs.some((e) => e.type === 'tackle' && e.won && m.players[e.by].side === 1);
      const engagedFor = carry.engagedAt >= 0 ? carry.t - carry.engagedAt : -1;
      if (engagedFor >= 0) {
        r.engaged++;
        if (engagedFor > 3) r.keptOver3++;
        else if (evs.some((e) => e.type === 'foul' && m.players[e.on].side === 0)) r.fouled++;
      }
      if (poked) {
        r.robbed++;
        if (engagedFor >= 0 && engagedFor <= 3) r.lostIn3++;
      } else ended = { t, engagedFor, left: 1.5 };
      carry = null;
    }
    if (ended) {
      ended.left -= DT;
      const theirs = owner >= 0 && m.players[owner].side === 1;
      if (theirs && m.phase === 'play') {
        r.robbed++;
        if (ended.engagedFor >= 0 && ended.engagedFor <= 3) r.lostIn3++;
        ended = null;
      } else if (ended.left <= 0 || m.phase !== 'play' || (owner >= 0 && m.players[owner].side === 0)) ended = null;
    }
    for (const e of evs) {
      if (e.type === 'kick' && e.kind === 'shot' && e.player !== undefined && m.players[e.player].side === 1 && ai) ai.shot = true;
      if (e.type === 'kick' && e.player !== undefined && m.players[e.player].side === 1 && ai) ai.kick = e.kind;
      if (e.type === 'kick' && e.player !== undefined && m.players[e.player].side === 0) for (const tl of tells) if (!tl.tried) tl.gone = true;
      if (e.type === 'tackle' && m.players[e.by].side === 0) {
        const me = e.by === m.active;
        if (me) {
          r.myTries++;
          if (e.won) r.myWins++;
        }
        if (e.won && ai) ai.by = me ? 'mine' : 'mate';
      }
      if (e.type === 'tackle' && m.players[e.by].side === 1 && c0) {
        const w = spots.get(e.by) ?? 'front';
        r.tries[w]++;
        if (e.won) r.wins[w]++;
        const tl = tells.find((x) => x.by === e.by && !x.tried);
        if (tl) {
          tl.tried = true;
          tl.lost = e.won;
        }
      } else if (e.type === 'skillTell' && m.players[e.on].side === 0) {
        tells.push({ by: e.by, t, answered: false, tried: false, lost: false, perfect: false, gone: false });
      } else if (e.type === 'skillMove' && m.players[e.player].side === 0 && e.move !== 'cut' && e.move !== 'knock' && e.move !== 'past') {
        const tl = tells[tells.length - 1];
        if (tl && !tl.answered) {
          tl.answered = true;
          tl.perfect = e.grade === 'perfect';
        }
      }
    }
    // The AI's spells on the ball.
    const theirs = m.phase === 'play' && owner >= 0 && m.players[owner].side === 1;
    if (theirs) {
      ai ??= { t: 0, shot: false, by: null, kick: '' };
      ai.t += DT;
      ai.kick = '';
    } else if (ai && (m.phase !== 'play' || (owner >= 0 && m.players[owner].side === 0))) {
      r.aiSpells++;
      r.aiSpellT += ai.t;
      r.aiEnd[ai.shot ? 'shot' : ai.by === 'mine' && ai.t < 1 ? 'mineQuick' : ai.by ?? (m.phase !== 'play' ? 'dead' : ai.kick === 'clear' || ai.kick === 'lob' ? 'hoof' : ai.kick ? 'cutOut' : 'loose')]++;
      ai = null;
    }
    // A tell is settled TELL_OUT s on: has the AI got it (or knocked it off him) by then?
    while (tells.length && t - tells[0].t >= TELL_OUT) {
      const tl = tells.shift()!;
      r.tells++;
      if (tl.answered) {
        r.tellAnswered++;
        if (tl.perfect) {
          r.perfect++;
          if (!tl.lost) r.perfectKept++;
        }
      } else if (!tl.gone) {
        // (He kept the ball at his feet through it: a pass or a shot before the challenge is an answer of its own.)
        r.tellIgnored++;
        if (tl.tried) r.tellTried++;
        if (tl.lost) r.tellLost++;
      }
    }
    if (m.phase === 'halftime') {
      m.aiSubs(1, 2);
      m.continueSecondHalf();
    }
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
  }
  r.gf = m.score[0];
  r.ga = m.score[1];
  r.shotsFor = m.stats.shots[0];
  r.shotsAgainst = m.stats.shots[1];
  r.onFor = m.stats.onTarget[0];
  r.onAgainst = m.stats.onTarget[1];
  r.savesMine = m.stats.saves[0];
  r.savesTheirs = m.stats.saves[1];
  return r;
}

/** (Only while it is his controlled man's ball: a team-mate's carry isn't the owner's dribble.) */
function o0(m: Match, c: Player): boolean {
  return m.isHumanControlled(c);
}

export interface OwnerSummary {
  n: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  shotsFor: number;
  shotsAgainst: number;
  onFor: number;
  onAgainst: number;
  savesMine: number;
  savesTheirs: number;
  /** Matches the AI scored in (share). */
  aiScored: number;
  /** Mean carry (s); carries a match. */
  carryS: number;
  carries: number;
  /** Of his contested carries: lost to the AI within 3 s of a man arriving (share); robbed at all (a match). */
  lostIn3: number;
  robbed: number;
  /** A match: seconds a man stood in reach, challenges and wins, by where. */
  reachT: Record<Where, number>;
  tries: Record<Where, number>;
  wins: Record<Where, number>;
  /** Tells a match; of the ignored ones, challenged / lost the ball (share); PERFECT answers kept (share). */
  tells: number;
  ignoredTried: number;
  ignoredLost: number;
  perfectKept: number;
  perfect: number;
  /** A match: tells he answered with SKILL, and tells he kept the ball at his feet through without answering. */
  answered: number;
  ignored: number;
  /** Of his contested carries: ended by a foul on him / kept over 3 s (share). */
  fouled: number;
  keptOver3: number;
  /** The AI's spells a match, their mean length (s), and how they ended (share). */
  aiSpells: number;
  aiSpellS: number;
  aiEnd: Record<AiEnd, number>;
  /** His own challenges a match, and the share won. */
  myTries: number;
  myWinPct: number;
}

export function ownerSeries(bot: OwnerBot | BotOptions, setting: OwnerSetting, n: number, seed0 = 1, cfg: Partial<MatchConfig> = {}): OwnerSummary {
  const s: OwnerSummary = {
    n, w: 0, d: 0, l: 0, gf: 0, ga: 0, shotsFor: 0, shotsAgainst: 0, onFor: 0, onAgainst: 0, savesMine: 0, savesTheirs: 0, aiScored: 0, carryS: 0, carries: 0, lostIn3: 0, robbed: 0,
    reachT: by3(), tries: by3(), wins: by3(), tells: 0, ignoredTried: 0, ignoredLost: 0, perfectKept: 0, perfect: 0,
    fouled: 0, keptOver3: 0, aiSpells: 0, aiSpellS: 0, aiEnd: aiEnds(), myTries: 0, myWinPct: 0, answered: 0, ignored: 0,
  };
  let aiT = 0;
  let myWins = 0;
  let carryT = 0;
  let engaged = 0;
  let lost3 = 0;
  let ignored = 0;
  let kept = 0;
  for (let i = 0; i < n; i++) {
    const r = ownerMatch(bot, setting, seed0 + i, cfg);
    if (r.gf > r.ga) s.w++;
    else if (r.gf === r.ga) s.d++;
    else s.l++;
    s.gf += r.gf / n;
    s.ga += r.ga / n;
    s.shotsFor += r.shotsFor / n;
    s.shotsAgainst += r.shotsAgainst / n;
    s.onFor += r.onFor / n;
    s.onAgainst += r.onAgainst / n;
    s.savesMine += r.savesMine / n;
    s.savesTheirs += r.savesTheirs / n;
    if (r.ga > 0) s.aiScored += 1 / n;
    s.carries += r.carries / n;
    carryT += r.carryT;
    engaged += r.engaged;
    lost3 += r.lostIn3;
    s.robbed += r.robbed / n;
    for (const k of WHERE) {
      s.reachT[k] += r.reachT[k] / n;
      s.tries[k] += r.tries[k] / n;
      s.wins[k] += r.wins[k] / n;
    }
    s.tells += r.tells / n;
    s.answered += r.tellAnswered / n;
    s.ignored += r.tellIgnored / n;
    ignored += r.tellIgnored;
    s.ignoredTried += r.tellTried;
    s.ignoredLost += r.tellLost;
    s.perfect += r.perfect;
    kept += r.perfectKept;
    s.fouled += r.fouled;
    s.keptOver3 += r.keptOver3;
    s.aiSpells += r.aiSpells;
    aiT += r.aiSpellT;
    for (const k of AI_ENDS) s.aiEnd[k] += r.aiEnd[k];
    s.myTries += r.myTries / n;
    myWins += r.myWins;
  }
  s.fouled /= Math.max(1, engaged);
  s.keptOver3 /= Math.max(1, engaged);
  s.aiSpellS = aiT / Math.max(1, s.aiSpells);
  for (const k of AI_ENDS) s.aiEnd[k] /= Math.max(1, s.aiSpells);
  s.aiSpells /= n;
  s.myWinPct = myWins / Math.max(1, s.myTries * n);
  s.carryS = carryT / Math.max(1, s.carries * n);
  s.lostIn3 = lost3 / Math.max(1, engaged);
  s.ignoredTried /= Math.max(1, ignored);
  s.ignoredLost /= Math.max(1, ignored);
  s.perfectKept = kept / Math.max(1, s.perfect);
  return s;
}

const f1 = (v: number) => v.toFixed(1);
const pc = (v: number) => `${Math.round(v * 100)}%`;

/** One line a bot and setting: the table the report is built from. */
export function fmtOwner(bot: string, setting: string, s: OwnerSummary): string {
  const side = (k: Where) => `${k} ${f1(s.wins[k])}/${f1(s.tries[k])} in ${f1(s.reachT[k])}s`;
  return `${bot.padEnd(8)} ${setting.padEnd(7)} n${s.n} W-D-L ${s.w}-${s.d}-${s.l} goals ${f1(s.gf)}-${f1(s.ga)} shots ${f1(s.shotsFor)}-${f1(s.shotsAgainst)} on target ${f1(s.onFor)}-${f1(s.onAgainst)} saves by his keeper ${f1(s.savesMine)} theirs ${f1(s.savesTheirs)} aiScored ${pc(s.aiScored)}` +
    ` | carry ${f1(s.carryS)}s x${f1(s.carries)} robbed ${f1(s.robbed)} lostIn3 ${pc(s.lostIn3)} (fouled ${pc(s.fouled)} kept>3s ${pc(s.keptOver3)})` +
    ` | won/tries ${side('front')}, ${side('side')}, ${side('behind')}` +
    ` | tells ${f1(s.tells)} (answered ${f1(s.answered)}, ignored ${f1(s.ignored)}) ignored: tried ${pc(s.ignoredTried)} won ${pc(s.ignoredLost)} perfect kept ${pc(s.perfectKept)} (${s.perfect})` +
    ` | AI spells ${f1(s.aiSpells)} x ${f1(s.aiSpellS)}s end: ${AI_ENDS.map((k) => `${k} ${pc(s.aiEnd[k])}`).join(' ')}` +
    ` | his tackles ${f1(s.myTries)} won ${pc(s.myWinPct)}`;
}
