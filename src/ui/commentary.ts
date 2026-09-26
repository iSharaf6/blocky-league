/**
 * Broadcast commentary: turns match events into one-line captions for the HUD ticker (and, when the player
 * turns it on, the browser's speech synthesis). Pure text logic lives in Commentator; the HUD decides where
 * and when a line shows. Nothing here may throw into the match loop.
 */
import { GOAL_H, HALF_L } from '../sim/constants';
import type { Match } from '../sim/match';
import { goalsOf } from '../sim/shootout';
import type { MatchEvent, PowerUpKind, ShotStyle, Side, TeamDef } from '../sim/types';

/** Blitz power-ups as the commentator, the HUD slot and the banners name them. */
export const POWER_INFO: Record<PowerUpKind, { name: string; banner: string; icon: string; color: string }> = {
  turbo: { name: 'turbo', banner: 'TURBO!', icon: '⚡', color: '#3aff9e' },
  mega: { name: 'mega shot', banner: 'MEGA SHOT!', icon: '💥', color: '#ff6a3a' },
  freeze: { name: 'freeze', banner: 'FREEZE!', icon: '❄️', color: '#5cc8f5' },
  magnet: { name: 'magnet', banner: 'MAGNET!', icon: '🧲', color: '#ffd23a' },
  shield: { name: 'shield', banner: 'SHIELD!', icon: '🛡️', color: '#c69cff' },
  golden: { name: 'golden goal', banner: 'GOLDEN GOAL! ×2', icon: '⭐', color: '#ffd166' },
};

/** 5 = goals, reds, penalties, half / full time · 4 = saves, woodwork, bookings · 3 = chances, flags, subs · 2 = fouls, corners · 1 = colour. */
export type Priority = 1 | 2 | 3 | 4 | 5;

export interface CommentaryLine {
  text: string;
  priority: Priority;
  /** Team the line is about (drives the ticker's colour stripe); -1 = neutral. */
  side: Side | -1;
  /** Caption tag: the match minute, or HT / FT / PENS. */
  tag: string;
  /** Visual flavour of the tag. */
  tone: 'goal' | 'yellow' | 'red' | 'big' | 'info';
}

type Vars = Record<string, string | number>;

// ------------------------------------------------------------------ templates

const T = {
  kickoff: [
    "And we're under way! {h} v {a}.",
    '{kt} get us started. Here we go!',
    'The referee blows and {kt} kick off.',
    "We're off! {h} against {a}, enjoy this one.",
  ],
  secondHalf: [
    'The second half is under way. {h} {hs}-{as} {a}.',
    'Back under way for the second half.',
    '{kt} get the second half going.',
  ],
  goal: [
    'GOAL! {p} scores!',
    "It's in! {p} finishes it!",
    'GOAL! What a finish from {p}!',
    '{p} makes no mistake!',
    'The net bulges! {p}!',
    '{p} slots it home!',
    '{p} fires it past {k}!',
  ],
  header: [
    'Header! {p} nods it in!',
    '{p} rises highest and scores!',
    'A bullet header from {p}!',
    '{p} heads it past {k}!',
  ],
  longRange: [
    'From {yd} yards! What a hit from {p}!',
    'A screamer from {p}!',
    '{p} lets fly... and it flies in!',
    'Stunning strike from {p}!',
  ],
  ownGoal: [
    'Own goal! Nightmare for {p}!',
    'Oh dear, {p} turns it into his own net!',
    '{p} diverts it past his own keeper!',
    "It's gone in off {p}! Own goal!",
  ],
  penGoal: [
    '{p} buries the penalty!',
    '{p} sends {k} the wrong way from the spot!',
    'Cool as you like, {p} scores the penalty!',
  ],
  // Tails appended to a goal line: what the goal means.
  opener: ['{t} take the lead!', '{t} draw first blood!', '{t} are in front!'],
  ahead: ['{t} lead {sc}!', '{t} are in front, {sc}!', '{t} go ahead!'],
  lateWinner: ["Surely that's the winner!", 'Late drama, {t} lead {sc}!', '{t} snatch it at the death!'],
  equaliser: ['All square at {sc}!', '{t} are level!', 'Game on at {sc}!'],
  lateEqualiser: ['Right at the death, {t} are level!', 'A late, late leveller, {sc}!'],
  extend: ['{t} lead {sc}!', "That's {sc}!", '{t} are cruising, {sc}!'],
  pullBack: ['{t} pull one back, {sc}.', "Game on? It's {sc}.", '{t} have hope at {sc}.'],
  saveCaught: [
    'Great hands from {k}! He holds on.',
    '{k} gathers {s}\'s shot. Safe hands.',
    'Straight at {k}. He makes it look easy.',
    '{k} claws it out of the air! Superb.',
  ],
  saveParried: [
    'What a save from {k}! Denied {s}!',
    '{k} palms it away!',
    "Brilliant from {k}, tipping {s}'s effort clear.",
    '{k} gets a strong hand to it!',
  ],
  penSaved: ["SAVED! {k} keeps out {s}'s penalty!", '{k} saves the penalty! What a moment!'],
  post: ["Off the post! {s} can't believe it!", 'It rattles the woodwork! So close from {s}.', 'Inches away! {s} hits the post.'],
  bar: ['Off the bar! {s} was inches away!', '{s} crashes it against the crossbar!', 'The crossbar saves {dt}!'],
  penMiss: ['{s} misses the penalty!', 'The penalty is wasted! {s} is off target.'],
  wide: ['Just wide from {s}!', '{s} drags it past the post.', 'Oh, so close! {s} fires just wide.', '{s} should have hit the target there.'],
  over: ['Over the bar from {s}!', '{s} leans back and blazes it over.', 'High and wide from {s}.'],
  block: ['Blocked! {b} throws himself in the way.', "{b} gets a body on {s}'s shot.", 'Brave block from {b}!'],
  foul: [
    'Foul by {p} on {q}.',
    'Clumsy from {p}, and {q} goes down.',
    '{p} goes through the back of {q}.',
    'Late challenge by {p} on {q}.',
    '{q} is clipped by {p}.',
  ],
  penalty: [
    'PENALTY! {p} brings down {q} in the box!',
    'The referee points to the spot! Penalty to {t}!',
    "Penalty! {q} goes down under {p}'s challenge.",
  ],
  yellow: [
    'Yellow card for {p}.',
    '{p} goes into the book.',
    'The referee reaches for his pocket: yellow for {p}.',
    "{p} is booked. He'll need to be careful now.",
    'A caution for {p} of {t}.',
  ],
  secondYellow: ['Second yellow! {p} is off! {t} down to {n}.', "{p} walks! That's a second booking.", 'Off he goes! {p} sees red for a second yellow.'],
  red: ['Straight red! {p} is sent off!', 'Red card! {p} has to go. {t} down to {n}.', "{p} is sent off! That's a big moment."],
  corner: ['Corner to {t}.', '{t} win a corner.', "It's behind for a corner. {t} load the box.", 'Corner kick. Can {t} make it count?'],
  cornerAgain: ['Another corner for {t}.', '{t} keep up the pressure. Another corner.'],
  freeKick: ['Free kick to {t} in a dangerous area.', '{t} have a free kick within shooting range.', 'Free kick, {yd} yards out. A chance for {t}.'],
  offside: ["Flag's up. {p} is offside.", '{p} strays offside.', 'Offside! {p} went a fraction too early.', "The assistant's flag goes up against {p}."],
  advantage: ['Advantage! The referee lets {t} play on.', 'Play on, says the referee. Good advantage.', 'Advantage {t}. They keep the ball.'],
  sub: ['Change for {t}: {on} on, {off} off.', '{off} makes way for {on}.', 'Substitution for {t}. On comes {on}.'],
  htLevel: ['Half time, and it is {hs}-{as}.', 'The referee blows for half time. Nothing between them.'],
  htGoalless: ["Half time, and it's goalless.", 'Half time. No goals yet, {h} 0-0 {a}.'],
  htLead: ['Half time: {lt} lead {lsc}.', "That's the break. {h} {hs}-{as} {a}.", '{lt} go in ahead at the break, {lsc}.'],
  ftLevel: ['Full time! It finishes {hs}-{as}.', 'The final whistle! Honours even, {hs}-{as}.', 'All over. They share the spoils.'],
  ftWin: ['Full time! {wt} win {wsc}!', "It's all over! {wt} take it, {wsc}.", 'The final whistle blows. {wt} win {wsc}.'],
  ftRout: ['{wt} run riot! {wsc} at full time.', 'Full time, and what a performance from {wt}! {wsc}.'],
  soStart: ["Level at full time... it's going to penalties!", 'Nothing to separate them. Penalties it is!'],
  soScored: ['{p} scores. Cool as you like.', '{p} sends {k} the wrong way.', '{p} makes no mistake from the spot.', 'Top corner from {p}!'],
  soSaved: ["Saved! {k} keeps out {p}'s penalty!", '{k} guesses right! {p} is denied.'],
  soPost: ['Off the post! {p} misses!', '{p} hits the woodwork!'],
  soOver: ['{p} blazes it over the bar!', '{p} skies it!'],
  soWide: ['{p} drags it wide!', '{p} misses the target!'],
  soWin: ['{wt} win it on penalties, {psc}!', '{wt} hold their nerve! Through on penalties.', "It's {wt}! They win the shootout {psc}."],
  skill: ['Lovely skill from {p}!', 'Neat footwork from {p}.'],
  beat: ['{p} leaves {q} for dead.', '{p} skips past {q}.', '{p} twists and turns past {q}.'],
  claim: ['{k} comes and claims it.', 'Good take from {k}.'],
  punch: ['{k} punches clear.', '{k} comes out and punches it away.'],
  tackle: ['Great tackle from {p}!', '{p} slides in and wins it cleanly.'],
  tackleClean: ['Won it clean! {p}.', '{p} wins it cleanly.', 'Perfectly timed by {p}!', '{p} nicks it off his toes.'],
  tackleTry: ['Crunching tackle from {p}!', '{p} flies in!', '{p} goes to ground!', 'Big challenge from {p}!'],
  // Blitz power-ups.
  powerTaken: ['{p} grabs a {pu}!', '{t} pick up a {pu}!', '{p} has a {pu} in his pocket!'],
  powerTurbo: ['TURBO! {p} is off like a rocket!', 'Turbo boost! Nobody is catching {p}!'],
  powerMega: ['MEGA SHOT loaded! {p} is winding up!', 'Mega shot armed for {p}. Keeper, beware!'],
  powerFreeze: ['FREEZE! {t} stop {o} in their tracks!', 'Frozen solid! {o} can barely move!'],
  powerMagnet: ['MAGNET! The ball is glued to {p}!', 'Magnet on! Everything finds {p}!'],
  powerShield: ['SHIELD! Nobody is getting the ball off {p}!', '{p} is untouchable with the shield up!'],
  powerEnd: ['The {pu} wears off for {t}.', "{t}'s {pu} is spent."],
  longShot: ['{p} tries his luck from distance...', '{p} shoots from way out...'],
  // Chips and finesse finishes (the kick event's style).
  chipTry: ['{p} tries the chip...', 'Cheeky! {p} goes for the chip...', '{p} dinks it towards goal...'],
  finesseTry: ['{p} tries to curl one in...', '{p} bends it towards the far corner...', 'Side-foot curler from {p}...'],
  chipGoal: [
    'What a chip from {p}! Over {k} and in!',
    '{p} lifts it over {k}! Sublime!',
    'The cheekiest of chips from {p}!',
    '{p} dinks it over the keeper!',
  ],
  finesseGoal: [
    '{p} curls it into the corner!',
    'Beautifully bent in by {p}!',
    'Top corner! {p} wraps his foot round it!',
    '{p} bends it past {k}! Lovely finish.',
  ],
  chipSaved: ["{k} backpedals and claws {s}'s chip away!", "{k} reads {s}'s chip and gets up to it!"],
  chipOver: ["{s}'s chip drifts over the bar.", 'Too much on the chip from {s}.'],
  finesseWide: ["{s}'s curler bends just the wrong side of the post.", 'Not enough curl from {s}, just wide.'],
} satisfies Record<string, string[]>;

type Cat = keyof typeof T;

function lastWord(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

/**
 * What the commentator calls a player: the surname of an "I. Chunk" style name. Pass the names of everyone
 * on the pitch (`onPitch`): when two of them share that surname it falls back to initial + surname
 * ("L. Santos") for both, so a line never leaves you guessing which Santos it means.
 */
export function surname(name: string, onPitch?: readonly string[]): string {
  const s = lastWord(name);
  if (!onPitch || !onPitch.length) return s;
  let same = 0;
  let self = false;
  for (const o of onPitch) {
    if (lastWord(o) !== s) continue;
    same++;
    if (o.trim() === name.trim()) self = true;
  }
  if (same < (self ? 2 : 1)) return s;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return s;
  const initial = parts[0].replace(/[^A-Za-zÀ-ɏ]/g, '').charAt(0).toUpperCase();
  return initial ? `${initial}. ${s}` : s;
}

/** Names of the 22 in the match (sent-off players included: one player keeps one call all match). */
export function pitchNames(m: Pick<Match, 'players'>): string[] {
  return m.players.map((p) => p.def.name);
}

const SUFFIXES = new Set(['united', 'rovers', 'athletic', 'city', 'wanderers', 'town', 'albion', 'rangers', 'sporting', 'royale', 'county']);

/** What a commentator calls a club: "Lakemoor Sporting" is "Lakemoor", "Harbourne FC" is "Harbourne". */
export function clubCall(t: Pick<TeamDef, 'name'>): string {
  let words = t.name.trim().split(/\s+/);
  if (words.length > 1 && /^(a?fc|cf)$/i.test(words[words.length - 1])) words = words.slice(0, -1);
  if (words.length === 2 && SUFFIXES.has(words[1].toLowerCase()) && words[0].length >= 5) words = words.slice(0, 1);
  return words.join(' ') || t.name;
}

function fill(tpl: string, v: Vars): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (k in v ? String(v[k]) : ''));
}

const other = (s: Side): Side => (s === 0 ? 1 : 0);

/**
 * Stateful event -> line mapper. Tracks just enough context to be right (a penalty awarded and not yet
 * taken, the event before this one) and avoids repeating the last template of each kind.
 */
export class Commentator {
  private lastPick = new Map<Cat, number>();
  private prevType = '';
  /** Sim-state stamp of the previous event: equal stamps = the same step's batch. */
  private prevBeat = '';
  /** Side awarded a penalty that hasn't been taken yet (-1 = none), and the match second it was given. */
  private penFor: Side | -1 = -1;
  private penAt = 0;
  private offsideAt = -99;
  /** Match second of the last save line (a near miss right after it would contradict it). */
  private saveAt = -99;
  private kicked = [false, false];
  /** Everyone in the match right now (refreshed per event): shared surnames get an initial. */
  private pitch: string[] = [];
  /** The last chip / finesse attempt: who struck it and when (match seconds). */
  private styled: { style: ShotStyle; by: number; at: number } | null = null;

  constructor(private readonly rand: () => number = Math.random) {}

  private sn(name: string): string {
    return surname(name, this.pitch);
  }

  /** Chip / finesse of the shot `by` struck in the last few seconds (the kick event's style, or the sim's field). */
  private styleOf(m: Match, by: number, within = 4): ShotStyle | null {
    const s = this.styled;
    if (s && s.by === by && Commentator.at(m) - s.at <= within) return s.style;
    const live = (m as Match & { shotStyle?: ShotStyle | null }).shotStyle;
    return m.kickKind === 'shot' && (live === 'chip' || live === 'finesse') && m.ball.lastTouch === by ? live : null;
  }

  private pick(cat: Cat, v: Vars): string {
    const list = T[cat];
    let i = Math.floor(this.rand() * list.length);
    const last = this.lastPick.get(cat);
    if (list.length > 1 && i === last) i = (i + 1 + Math.floor(this.rand() * (list.length - 1))) % list.length;
    this.lastPick.set(cat, i);
    return fill(list[i], v);
  }

  /** Seconds of match time (both halves), for "within a few seconds" context checks. */
  private static at(m: Match): number {
    return (m.half - 1) * m.cfg.halfLength + m.clock;
  }

  private name(m: Match, idx: number): string {
    const p = m.players[idx];
    return p ? this.sn(p.def.name) : '';
  }

  /** Two players in one line: initial + surname when they share one ("L. Novak on T. Novak"). */
  private two(m: Match, a: number, b: number): [string, string] {
    const pa = m.players[a]?.def.name ?? '';
    const pb = m.players[b]?.def.name ?? '';
    const sa = this.sn(pa);
    const sb = this.sn(pb);
    return sa === sb && pa !== pb ? [pa, pb] : [sa, sb];
  }

  private base(m: Match): Vars {
    return {
      h: clubCall(m.teams[0]),
      a: clubCall(m.teams[1]),
      hs: m.score[0],
      as: m.score[1],
    };
  }

  private minuteTag(m: Match): string {
    if (m.phase === 'shootout') return 'PENS';
    return `${m.goalMinute()}'`;
  }

  /** The line for this event, or null when it isn't worth a caption. */
  line(e: MatchEvent, m: Match): CommentaryLine | null {
    const prev = this.prevType;
    const beat = `${m.half}|${m.clock}|${m.phaseT}|${m.phase}`;
    const sameBeat = beat === this.prevBeat;
    this.prevType = e.type;
    this.prevBeat = beat;
    // A penalty that has not produced a goal, save or miss within 15 s of being given has gone.
    if (this.penFor >= 0 && Commentator.at(m) - this.penAt > 15 && m.phase === 'play') this.penFor = -1;
    try {
      this.pitch = pitchNames(m);
      return this.make(e, m, sameBeat ? prev : '');
    } catch {
      return null;
    }
  }

  private make(e: MatchEvent, m: Match, prev: string): CommentaryLine | null {
    const v = this.base(m);
    const tag = this.minuteTag(m);
    const shootout = m.phase === 'shootout' || (m.shootout !== null && m.phase === 'fulltime');
    const L = (text: string, priority: Priority, side: Side | -1, tone: CommentaryLine['tone'] = 'info', t = tag): CommentaryLine => ({
      text, priority, side, tone, tag: t,
    });
    const shooter = (): string => (m.shooter >= 0 ? this.name(m, m.shooter) : 'the striker');
    switch (e.type) {
      case 'kickoffReady': {
        if (m.clock > 0.5) return null; // restarts after a goal speak for themselves
        const kv = { ...v, kt: clubCall(m.teams[e.side]) };
        if (m.half === 1 && !this.kicked[0]) {
          this.kicked[0] = true;
          return L(this.pick('kickoff', kv), 4, -1, 'info', "1'");
        }
        if (m.half === 2 && !this.kicked[1]) {
          this.kicked[1] = true;
          return L(this.pick('secondHalf', kv), 4, -1, 'info', "46'");
        }
        return null;
      }
      case 'goal': {
        const side = e.side;
        const opp = other(side);
        const scorer = m.players[e.scorer];
        if (!scorer) return null;
        const sc = `${m.score[side]}-${m.score[opp]}`;
        const keeper = m.keeperOf(opp);
        const [pn, kn] = keeper ? this.two(m, scorer.idx, keeper.idx) : [this.sn(scorer.def.name), 'the keeper'];
        const kv: Vars = { ...v, p: pn, k: kn, t: clubCall(m.teams[side]), sc };
        const minute = m.goals[m.goals.length - 1]?.minute ?? m.goalMinute();
        const late = m.half === 2 && minute >= 85;
        let core: Cat = 'goal';
        if (e.own) core = 'ownGoal';
        else if (this.penFor === side) core = 'penGoal';
        else if (m.kickKind === 'header') core = 'header';
        else if (this.styleOf(m, scorer.idx)) core = this.styleOf(m, scorer.idx) === 'chip' ? 'chipGoal' : 'finesseGoal';
        else if (m.kickKind === 'shot') {
          const d = Math.hypot(m.attackDir(side) * HALF_L - m.kickX, m.kickZ);
          if (d >= 23) {
            core = 'longRange';
            kv.yd = Math.round(d * 1.094);
          }
        }
        this.penFor = -1;
        this.styled = null;
        const diff = m.score[side] - m.score[opp];
        const first = m.score[0] + m.score[1] === 1;
        const tail: Cat =
          diff === 0 ? (late ? 'lateEqualiser' : 'equaliser')
            : diff === 1 ? (late ? 'lateWinner' : first ? 'opener' : 'ahead')
              : diff > 1 ? 'extend'
                : 'pullBack';
        return L(`${this.pick(core, kv)} ${this.pick(tail, kv)}`, 5, side, 'goal', `${minute}'`);
      }
      case 'save': {
        if (shootout || m.shotClock >= 2) return null;
        const k = m.players[e.keeper];
        if (!k) return null;
        const [kn, sn] = m.shooter >= 0 ? this.two(m, k.idx, m.shooter) : [this.sn(k.def.name), shooter()];
        const kv = { ...v, k: kn, s: sn };
        this.saveAt = Commentator.at(m);
        if (this.penFor >= 0 && this.penFor !== k.side) {
          this.penFor = -1;
          return L(this.pick('penSaved', kv), 5, k.side, 'big');
        }
        if (m.shooter >= 0 && this.styleOf(m, m.shooter, 3) === 'chip') return L(this.pick('chipSaved', kv), 4, k.side, 'big');
        return L(this.pick(e.caught ? 'saveCaught' : 'saveParried', kv), 4, k.side, 'big');
      }
      case 'post': {
        if (shootout || m.shotClock >= 2) return null;
        const side = m.shooter >= 0 ? m.players[m.shooter].side : m.kickSide;
        const kv = { ...v, s: shooter(), dt: clubCall(m.teams[other(side)]) };
        if (this.penFor === side) {
          this.penFor = -1;
          return L(this.pick('penMiss', kv), 5, side, 'big');
        }
        return L(this.pick(e.y > GOAL_H - 0.3 ? 'bar' : 'post', kv), 4, side, 'big');
      }
      case 'ooh': {
        // The post / block / save / shootout kick that caused the gasp has its own line.
        if (shootout || prev === 'post' || prev === 'block' || prev === 'save' || prev === 'shootoutKick') return null;
        if (m.phase !== 'out' || m.restart?.kind !== 'goalkick') return null;
        if (Commentator.at(m) - this.saveAt < 3) return null; // "great save" then "just wide" reads wrong
        const side = m.shooter >= 0 ? m.players[m.shooter].side : m.kickSide;
        const kv = { ...v, s: shooter() };
        if (this.penFor === side) {
          this.penFor = -1;
          return L(this.pick('penMiss', kv), 5, side, 'big');
        }
        const style = m.shooter >= 0 ? this.styleOf(m, m.shooter, 5) : null;
        const high = m.ball.pos.y > GOAL_H;
        if (style === 'chip' && high) return L(this.pick('chipOver', kv), 3, side);
        if (style === 'finesse' && !high) return L(this.pick('finesseWide', kv), 3, side);
        return L(this.pick(high ? 'over' : 'wide', kv), 3, side);
      }
      case 'block': {
        if (!e.shot) return null;
        const b = m.players[e.by];
        if (!b) return null;
        const [bn, sn] = m.shooter >= 0 ? this.two(m, b.idx, m.shooter) : [this.sn(b.def.name), shooter()];
        return L(this.pick('block', { ...v, b: bn, s: sn }), 3, b.side);
      }
      case 'foul': {
        const by = m.players[e.by];
        const on = m.players[e.on];
        if (!by || !on) return null;
        const [pn, qn] = this.two(m, by.idx, on.idx);
        const kv = { ...v, p: pn, q: qn, t: clubCall(m.teams[on.side]) };
        if (e.penalty) {
          this.penFor = on.side;
          this.penAt = Commentator.at(m);
          return L(this.pick('penalty', kv), 5, on.side, 'big');
        }
        return L(this.pick('foul', kv), 2, by.side);
      }
      case 'card': {
        const p = m.players[e.player];
        if (!p) return null;
        const left = m.players.filter((q) => q.side === p.side && !q.sentOff && q.idx !== p.idx).length;
        const kv = { ...v, p: this.sn(p.def.name), t: clubCall(m.teams[p.side]), n: left };
        if (e.color === 'red') return L(this.pick(e.second ? 'secondYellow' : 'red', kv), 5, p.side, 'red');
        return L(this.pick('yellow', kv), 4, p.side, 'yellow');
      }
      case 'restart': {
        const t = clubCall(m.teams[e.side]);
        if (e.kind === 'corner') {
          const n = m.stats.corners?.[e.side] ?? 0;
          return L(this.pick(n >= 2 && this.rand() < 0.6 ? 'cornerAgain' : 'corner', { ...v, t }), 2, e.side);
        }
        if (e.kind === 'freekick') {
          if (Commentator.at(m) - this.offsideAt < 4) return null; // the offside line covers it
          const r = m.restart;
          if (!r) return null;
          const d = Math.hypot(m.attackDir(e.side) * HALF_L - r.x, r.z);
          if (d > 30) return null;
          return L(this.pick('freeKick', { ...v, t, yd: Math.round(d * 1.094) }), 3, e.side);
        }
        return null;
      }
      case 'offside': {
        this.offsideAt = Commentator.at(m);
        return L(this.pick('offside', { ...v, p: this.name(m, e.player) }), 3, e.side);
      }
      case 'advantage':
        return L(this.pick('advantage', { ...v, t: clubCall(m.teams[e.side]) }), 3, e.side);
      case 'sub':
        return L(this.pick('sub', { ...v, t: clubCall(m.teams[e.side]), on: this.sn(e.on), off: this.sn(e.off) }), 3, e.side);
      case 'halftime': {
        const [hs, as] = m.score;
        if (hs === as) return L(this.pick(hs === 0 ? 'htGoalless' : 'htLevel', v), 5, -1, 'info', 'HT');
        const lead: Side = hs > as ? 0 : 1;
        return L(this.pick('htLead', { ...v, lt: clubCall(m.teams[lead]), lsc: `${m.score[lead]}-${m.score[other(lead)]}` }), 5, lead, 'info', 'HT');
      }
      case 'fulltime': {
        if (m.shootout) return null; // the shootout winner line says it
        const [hs, as] = m.score;
        if (hs === as) return L(this.pick('ftLevel', v), 5, -1, 'info', 'FT');
        const w: Side = hs > as ? 0 : 1;
        const kv = { ...v, wt: clubCall(m.teams[w]), wsc: `${m.score[w]}-${m.score[other(w)]}` };
        return L(this.pick(Math.abs(hs - as) >= 3 ? 'ftRout' : 'ftWin', kv), 5, w, 'info', 'FT');
      }
      case 'whistle':
        if (e.kind === 'end' && m.phase === 'shootout' && m.shootout && m.shootout.kicks[0].length + m.shootout.kicks[1].length === 0) {
          return L(this.pick('soStart', v), 5, -1, 'big', 'FT');
        }
        return null;
      case 'shootoutKick': {
        const p = m.players[e.taker];
        if (!p) return null;
        const keeper = m.keeperOf(other(e.side));
        const [pn, kn] = keeper ? this.two(m, p.idx, keeper.idx) : [this.sn(p.def.name), 'the keeper'];
        const kv = { ...v, p: pn, k: kn };
        const how = m.shootout?.last?.how ?? (e.scored ? 'goal' : 'saved');
        const cat: Cat = e.scored ? 'soScored' : how === 'post' ? 'soPost' : how === 'over' ? 'soOver' : how === 'wide' ? 'soWide' : 'soSaved';
        return L(this.pick(cat, kv), 4, e.side, e.scored ? 'goal' : 'big', 'PENS');
      }
      case 'shootoutEnd': {
        const so = m.shootout;
        const w = e.winner;
        const psc = so ? `${goalsOf(so.kicks[w])}-${goalsOf(so.kicks[other(w)])}` : '';
        return L(this.pick('soWin', { ...v, wt: clubCall(m.teams[w]), psc }), 5, w, 'goal', 'PENS');
      }
      case 'beat': {
        const p = m.players[e.by];
        const q = m.players[e.on];
        if (!p || !q) return null;
        const [pn, qn] = this.two(m, p.idx, q.idx);
        return L(this.pick('beat', { ...v, p: pn, q: qn }), 1, p.side);
      }
      case 'skill': {
        const p = m.players[e.player];
        return p ? L(this.pick('skill', { ...v, p: this.sn(p.def.name) }), 1, p.side) : null;
      }
      case 'claim': {
        const k = m.players[e.keeper];
        return k ? L(this.pick(e.caught ? 'claim' : 'punch', { ...v, k: this.sn(k.def.name) }), 1, k.side) : null;
      }
      case 'tackle': {
        if (!e.won) return null;
        const p = m.players[e.by];
        return p ? L(this.pick(e.slide ? 'tackle' : 'tackleClean', { ...v, p: this.sn(p.def.name) }), 1, p.side) : null;
      }
      case 'tackleTry': {
        if (!e.slide) return null;
        const p = m.players[e.by];
        return p ? L(this.pick('tackleTry', { ...v, p: this.sn(p.def.name) }), 1, p.side) : null;
      }
      case 'powerupSpawn':
        return null;
      case 'powerupTaken': {
        const p = m.players[e.player];
        const pv = { ...v, p: p ? this.sn(p.def.name) : 'someone', t: clubCall(m.teams[e.side]), pu: POWER_INFO[e.kind].name };
        return L(this.pick('powerTaken', pv), 2, e.side, 'big');
      }
      case 'powerupUsed': {
        const p = m.players[e.player];
        const pv = { ...v, p: p ? this.sn(p.def.name) : 'someone', t: clubCall(m.teams[e.side]), o: clubCall(m.teams[other(e.side)]) };
        const cat = e.kind === 'turbo' ? 'powerTurbo' : e.kind === 'mega' ? 'powerMega' : e.kind === 'freeze' ? 'powerFreeze' : e.kind === 'magnet' ? 'powerMagnet' : 'powerShield';
        return L(this.pick(cat, pv), 3, e.side, 'big');
      }
      case 'powerupEnd':
        return L(this.pick('powerEnd', { ...v, t: clubCall(m.teams[e.side]), pu: POWER_INFO[e.kind].name }), 1, e.side);
      case 'kick': {
        const style = e.style;
        if ((style === 'chip' || style === 'finesse') && !shootout && m.ball.lastTouch >= 0 && this.penFor < 0) {
          const p = m.players[m.ball.lastTouch];
          if (!p) return null;
          this.styled = { style, by: p.idx, at: Commentator.at(m) };
          // A chip is an event (it gets its line); a finesse curler is colour (the outcome line matters more).
          return L(this.pick(style === 'chip' ? 'chipTry' : 'finesseTry', { ...v, p: this.sn(p.def.name) }), style === 'chip' ? 2 : 1, p.side);
        }
        if (e.kind !== 'shot' || shootout || e.power < 0.6 || m.ball.lastTouch < 0) return null;
        const p = m.players[m.ball.lastTouch];
        if (!p || this.penFor >= 0) return null;
        const d = Math.hypot(m.attackDir(p.side) * HALF_L - e.x, e.z);
        return d >= 25 ? L(this.pick('longShot', { ...v, p: this.sn(p.def.name) }), 1, p.side) : null;
      }
      default:
        return null;
    }
  }
}

/** Every template, for tests and the count in docs. */
export function templateCount(): number {
  return Object.values(T).reduce((n, l) => n + l.length, 0);
}

// ------------------------------------------------------------------ speech

let voiceCache: SpeechSynthesisVoice | null | undefined;

function synth(): SpeechSynthesis | null {
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined' ? window.speechSynthesis : null;
  } catch {
    return null;
  }
}

/** Whether this browser can speak at all (the Settings toggle shows N/A otherwise). */
export function speechAvailable(): boolean {
  return synth() !== null;
}

/**
 * Say a line. `urgent` lines (goals, reds, full time) cut off whatever is being said; others are skipped
 * while the commentator is still talking, so speech never lags behind play.
 */
export function speak(text: string, urgent: boolean): void {
  const ss = synth();
  if (!ss) return;
  try {
    if (ss.speaking || ss.pending) {
      if (!urgent) return;
      ss.cancel();
    }
    // "2-1" reads as "two one"; drop the shouty capitals so GOAL isn't spelled out.
    const said = text.replace(/(\d+)-(\d+)/g, '$1 $2').replace(/\b([A-Z]{2,})\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());
    const u = new SpeechSynthesisUtterance(said);
    if (voiceCache === undefined || voiceCache === null) {
      const vs = ss.getVoices();
      if (vs.length) voiceCache = vs.find((x) => /en[-_]GB/i.test(x.lang)) ?? vs.find((x) => /^en/i.test(x.lang)) ?? null;
    }
    if (voiceCache) u.voice = voiceCache;
    u.lang = voiceCache?.lang ?? 'en-GB';
    u.rate = urgent ? 1.12 : 1.05;
    u.pitch = urgent ? 1.08 : 1;
    u.volume = 0.9;
    ss.speak(u);
  } catch {
    // Speech is a nicety: never let it break the match.
  }
}

/** Stop talking now (pause, quit, leaving the match). */
export function stopSpeech(): void {
  try {
    synth()?.cancel();
  } catch {
    // ignore
  }
}
