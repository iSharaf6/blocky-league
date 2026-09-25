/**
 * Blocky Cup screens: entry (club + difficulty), the bracket hub with your next tie, and the trophy lift.
 * Rules live in meta/cup.ts; this file renders them and wires the ties through AppContext.
 */
import type { AppContext } from '../app';
import { sfx } from '../audio/sfx';
import type { MatchResult } from '../game/matchSession';
import {
  DIFF_MULT, ROUND_NAMES, ROUND_PRIZE, ROUND_SHORT, ROUND_TIES, TROPHY_PRIZE, champion, clubRating, cupPrize, exitRound, migrateCup,
  newCup, recordUserTie, userTie, type CupState, type CupTie, type TieOutcome,
} from '../meta/cup';
import { PRESET_CLUBS, makeTeam, resolveKitClash } from '../meta/data';
import { cssHex } from '../render/palette';
import { goalsOf } from '../sim/shootout';
import { closeMeta, esc, fmt, mountMeta, topBar, type ToastKind } from './club';
import { DIFFICULTIES, pixelIcon, shirtArt, stars } from './menus';

interface Flash {
  msg: string;
  kind: ToastKind;
}

const live = new WeakSet<object>();

/** The live cup inside app.save (validated once per object), or null when there isn't one. */
function cupState(app: AppContext): CupState | null {
  const raw = app.save.cup;
  if (typeof raw === 'object' && raw !== null && live.has(raw)) return raw as CupState;
  const st = migrateCup(raw);
  app.save.cup = st;
  if (st) live.add(st);
  return st;
}

function setCup(app: AppContext, st: CupState | null): void {
  app.save.cup = st;
  if (st) live.add(st);
  app.persist();
}

function toMenu(app: AppContext): void {
  closeMeta();
  app.mainMenu();
}

/** Entry point from the main menu (and the return point after every cup tie). */
export function openCup(app: AppContext, flash?: Flash): void {
  const st = cupState(app);
  if (!st) cupEntry(app);
  else if (st.status === 'won' && !st.celebrated) trophyScreen(app, st);
  else cupHub(app, st, flash);
}

function kitDot(club: number): string {
  const k = PRESET_CLUBS[club].kit;
  return `<i class="mc-kd" style="background:${cssHex(k.shirt)};--kd2:${cssHex(k.shirt2)}"></i>`;
}

// ------------------------------------------------------------------ entry

function cupEntry(app: AppContext): void {
  const scr = mountMeta(app, 'cup-screen');
  const n = PRESET_CLUBS.length;
  let club = Math.max(0, Math.min(n - 1, app.save.clubIdx | 0));
  let diff = Math.max(0, Math.min(3, app.save.settings.difficulty | 0));
  const draw = () => {
    const c = PRESET_CLUBS[club];
    const mult = DIFF_MULT[diff];
    const total = ROUND_PRIZE.reduce((a, b) => a + Math.round(b * mult), 0) + Math.round(TROPHY_PRIZE * mult);
    const lines = ROUND_SHORT.map((r, i) => `<div><span>WIN THE ${r}</span><b><i></i>+${fmt(ROUND_PRIZE[i] * mult)}</b></div>`).join('');
    scr.render(
      `${topBar('MENU', 'BLOCKY CUP', 'KNOCKOUT · 8 CLUBS · 3 ROUNDS', app.save.coins)}
      <section class="cup-hero">
        <div class="cup-hero-icon">${pixelIcon('trophy', '#ffd23a', 8)}</div>
        <p>Win three ties to lift the cup. Level after full time? Straight to penalties.</p>
      </section>
      <div class="team-pick cup-pick">
        <span class="tp-label">YOUR CLUB</span>
        <div class="tp-body">
          <button class="arrow" data-a="prev" aria-label="Previous club">◀</button>
          <div class="tp-kit">${shirtArt(c.kit, 8)}</div>
          <button class="arrow" data-a="next" aria-label="Next club">▶</button>
        </div>
        <b class="tp-name">${esc(c.name)}</b>
        <span class="tp-stars">${stars(clubRating(club))}</span>
        <span class="tp-meta">OVR ${clubRating(club)} · ${c.formation}</span>
      </div>
      <div class="opt-row"><label>DIFFICULTY</label><div class="seg">${DIFFICULTIES.map(
        (l, i) => `<button class="${i === diff ? 'on' : ''}" data-a="diff" data-i="${i}">${l}</button>`,
      ).join('')}</div></div>
      <p class="mc-hint">Harder cups draw stronger rivals and pay more.</p>
      <div class="mc-prize">${lines}
        <div><span>LIFT THE TROPHY</span><b><i></i>+${fmt(TROPHY_PRIZE * mult)}</b></div>
        <div class="total"><span>UP FOR GRABS</span><b><i></i>${fmt(total)}</b></div>
      </div>
      <div class="btn-row"><button class="btn btn-go btn-lg cup-go" data-a="start">ENTER THE CUP</button></div>`,
      {
        back: () => toMenu(app),
        prev: () => {
          club = (club - 1 + n) % n;
          draw();
        },
        next: () => {
          club = (club + 1) % n;
          draw();
        },
        diff: (el) => {
          diff = Math.max(0, Math.min(3, Number(el.dataset.i) | 0));
          draw();
        },
        start: () => {
          const st = newCup((Math.random() * 2 ** 32) >>> 0, club, diff);
          setCup(app, st);
          sfx.coin();
          cupHub(app, st, { msg: 'THE DRAW IS MADE!', kind: 'good' });
        },
      },
    );
  };
  draw();
}

// ------------------------------------------------------------------ bracket hub

function tieHtml(st: CupState, t: CupTie): string {
  const you = t.home === st.user || t.away === st.user;
  const played = t.winner >= 0;
  const row = (slot: number, goals: number | null, pens: number | null) => {
    if (slot < 0) return '<div class="ct-row tbd"><i class="mc-kd"></i><span>TBD</span><b></b></div>';
    const club = st.clubs[slot];
    const cls = `${slot === st.user ? 'me' : ''} ${played ? (t.winner === slot ? 'win' : 'lose') : ''}`;
    return `<div class="ct-row ${cls}">${kitDot(club)}<span>${esc(PRESET_CLUBS[club].short)}</span><b>${goals ?? ''}${
      pens !== null ? `<small>(${pens})</small>` : ''
    }</b></div>`;
  };
  const next = !played && you && st.status === 'active';
  return `<div class="cup-tie${you ? ' you' : ''}${next ? ' next' : ''}">
    ${row(t.home, t.hg, t.pens ? t.pens[0] : null)}${row(t.away, t.ag, t.pens ? t.pens[1] : null)}
  </div>`;
}

function bracketHtml(st: CupState): string {
  const col = (round: number) =>
    `<div class="cup-col"><h3 class="cup-rh">${ROUND_SHORT[round]}</h3><div class="cup-ties">${ROUND_TIES[round]
      .map((i) => tieHtml(st, st.ties[i]))
      .join('')}</div></div>`;
  const ch = champion(st);
  const winner = `<div class="cup-col"><h3 class="cup-rh">WINNER</h3><div class="cup-ties">
      <div class="cup-winner${ch >= 0 && ch === st.user ? ' you' : ''}${ch >= 0 ? ' crowned' : ''}">
        ${pixelIcon('trophy', ch >= 0 ? '#26262e' : '#b9b5aa', 5)}<b>${ch >= 0 ? esc(PRESET_CLUBS[st.clubs[ch]].short) : '?'}</b>
      </div></div></div>`;
  return `<div class="cup-bracket">${col(0)}${col(1)}${col(2)}${winner}</div>`;
}

function cupHub(app: AppContext, st: CupState, flash?: Flash): void {
  const scr = mountMeta(app, 'cup-screen');
  let confirmQuit = false;
  const draw = () => {
    const ut = userTie(st);
    const sub = st.status === 'won' ? 'CHAMPIONS' : st.status === 'out' ? 'KNOCKED OUT' : `${DIFFICULTIES[st.difficulty]} · ${ROUND_NAMES[st.round]}`;
    let card: string;
    if (ut) {
      const side = (club: number) => {
        const c = PRESET_CLUBS[club];
        return `<div class="mc-side">${shirtArt(c.kit, 6)}<b>${esc(c.short)}</b><small>${esc(c.name)}</small><em>OVR ${clubRating(club)}</em></div>`;
      };
      card = `<section class="mc-next cup-next">
        <div class="mc-nexttop">
          <span class="mc-chip div">${ROUND_NAMES[st.round]}</span>
          <span class="mc-chip home">WIN +${fmt(cupPrize(st.round, true, st.difficulty))}</span>
        </div>
        <div class="mc-vs">${side(st.clubs[st.user])}<div class="mc-vsx">VS</div>${side(st.clubs[ut.rival])}</div>
        <button class="btn btn-go btn-lg mc-play" data-a="play">PLAY ${ROUND_NAMES[st.round]}</button>
        <p class="mc-pay">LEVEL AT FULL TIME = PENALTIES · LOSE AND YOU'RE OUT</p>
      </section>`;
    } else if (st.status === 'won') {
      card = `<div class="mc-result champ cup-result">${pixelIcon('trophy', '#26262e', 7)}<b>CHAMPIONS!</b>
        <span>${esc(PRESET_CLUBS[st.clubs[st.user]].name.toUpperCase())} LIFTED THE BLOCKY CUP</span><em>+${fmt(st.earned)} COINS WON</em></div>`;
    } else {
      const ch = champion(st);
      card = `<div class="mc-result down cup-result"><b>KNOCKED OUT</b><span>OUT IN THE ${ROUND_NAMES[exitRound(st)]}</span>${
        ch >= 0 ? `<em>${esc(PRESET_CLUBS[st.clubs[ch]].name.toUpperCase())} WON THE CUP</em>` : ''
      }</div>`;
    }
    const foot =
      st.status === 'active'
        ? `<button class="btn ${confirmQuit ? 'btn-red' : 'btn-white'}" data-a="abandon">${confirmQuit ? 'SURE? ABANDON CUP' : 'ABANDON CUP'}</button>`
        : '<button class="btn btn-go btn-lg" data-a="again">NEW CUP</button>';
    scr.render(
      `${topBar('MENU', 'BLOCKY CUP', sub, app.save.coins)}
      ${card}
      <h3 class="mc-h">THE DRAW</h3>
      ${bracketHtml(st)}
      <p class="mc-hint">${st.earned > 0 ? `+${fmt(st.earned)} coins won in this cup so far.` : 'Every round you win pays out. Lift the trophy for the big one.'}</p>
      <div class="btn-row${st.status === 'active' ? ' no-stick' : ''}">${foot}</div>`,
      {
        back: () => toMenu(app),
        play: () => playTie(app, st),
        abandon: () => {
          if (!confirmQuit) {
            confirmQuit = true;
            draw();
            return;
          }
          setCup(app, null);
          cupEntry(app);
        },
        again: () => {
          setCup(app, null);
          cupEntry(app);
        },
      },
    );
  };
  draw();
  if (flash) scr.toast(flash.msg, flash.kind);
}

// ------------------------------------------------------------------ playing a tie

/** Apply a finished match to the cup (the user is always the home side in the match). */
function settle(st: CupState, r: MatchResult): TieOutcome | null {
  const [my, their] = r.score;
  const won = r.winner !== undefined ? r.winner === 0 : my > their;
  const so = r.match.shootout;
  const pens: [number, number] | null = so && so.winner >= 0 ? [goalsOf(so.kicks[0]), goalsOf(so.kicks[1])] : null;
  return recordUserTie(st, my, their, won, pens);
}

function returnToCup(app: AppContext, flash?: Flash): void {
  // mainMenu() brings back the 3D backdrop and music; the cup screen replaces it in the same task.
  app.mainMenu();
  openCup(app, flash);
}

function playTie(app: AppContext, st: CupState): void {
  const ut = userTie(st);
  if (!ut) return;
  const round = st.round;
  const seed = st.seed;
  const rival = PRESET_CLUBS[st.clubs[ut.rival]];
  const home = makeTeam(PRESET_CLUBS[st.clubs[st.user]]);
  const away = makeTeam(rival);
  let outcome: TieOutcome | null = null;
  // Only ever apply a result to the cup and round it was played in.
  const current = () => {
    const cur = cupState(app);
    return cur && cur.seed === seed && cur.round === round && cur.status === 'active' ? cur : null;
  };
  closeMeta();
  app.startMatch({
    home,
    away,
    kits: [home.kit, resolveKitClash(home.kit, away.kit)],
    humanSide: 0,
    difficulty: st.difficulty,
    halfMinutes: app.save.settings.halfMinutes,
    attendance: [0.75, 0.9, 1][round] ?? 1,
    knockout: true,
    nextLabel: 'BACK TO THE CUP',
    // Called once at full time: the cup is updated here so the result is saved with the coins.
    reward: (r) => {
      const cur = current();
      outcome = cur ? settle(cur, r) : null;
      if (!outcome) return { coins: 0, label: 'CUP TIE' };
      const label = outcome.trophy ? 'CUP WINNERS!' : outcome.won ? `${ROUND_SHORT[round]} WIN BONUS` : 'KNOCKED OUT';
      return { coins: outcome.coins, label };
    },
    onDone: () => {
      const o = outcome as TieOutcome | null;
      let flash: Flash | undefined;
      if (o && !o.trophy) {
        flash = o.won
          ? { msg: `THROUGH TO THE ${ROUND_NAMES[Math.min(2, round + 1)]}!`, kind: 'good' }
          : { msg: `KNOCKED OUT BY ${rival.short}`, kind: 'bad' };
      }
      returnToCup(app, flash);
    },
    onQuit: () => {
      const cur = current();
      if (cur) {
        recordUserTie(cur, 0, 3, false);
        app.persist();
      }
      returnToCup(app, { msg: 'WALKING OFF COUNTS AS A 3-0 DEFEAT', kind: 'bad' });
    },
  });
}

// ------------------------------------------------------------------ trophy lift

function trophyScreen(app: AppContext, st: CupState): void {
  const scr = mountMeta(app, 'cup-screen cup-trophy-screen');
  st.celebrated = true;
  app.persist();
  const c = PRESET_CLUBS[st.clubs[st.user]];
  const mult = DIFF_MULT[st.difficulty];
  const lines =
    ROUND_SHORT.map((r, i) => `<div><span>${r} WIN</span><b><i></i>+${fmt(ROUND_PRIZE[i] * mult)}</b></div>`).join('') +
    `<div><span>TROPHY BONUS</span><b><i></i>+${fmt(TROPHY_PRIZE * mult)}</b></div>`;
  scr.render(
    `<div class="cup-lift">
      <div class="cup-rays" aria-hidden="true"></div>
      <div class="cup-big">${pixelIcon('trophy', '#ffd23a', 18)}</div>
      <h2 class="cup-champ-title">CHAMPIONS!</h2>
      <p class="cup-champ-sub">${esc(c.name.toUpperCase())} WIN THE BLOCKY CUP</p>
    </div>
    <div class="mc-prize">${lines}<div class="total"><span>CUP EARNINGS</span><b><i></i>+${fmt(st.earned)}</b></div></div>
    <div class="btn-row"><button class="btn btn-go btn-lg" data-a="next">CONTINUE</button></div>`,
    { next: () => cupHub(app, st) },
  );
  const cols = [c.kit.shirt, c.kit.shirt2, 0xffd23a, 0xfbfbf4, 0x3cc15a, 0x2f7be8, 0xec4a3e];
  let bits = '';
  for (let i = 0; i < 72; i++) {
    const x = (Math.random() * 100).toFixed(1);
    const delay = (Math.random() * 2.6).toFixed(2);
    const dur = (2.6 + Math.random() * 2.4).toFixed(2);
    const spin = Math.floor(Math.random() * 900 - 450);
    const drift = Math.floor(Math.random() * 160 - 80);
    bits += `<i style="--x:${x}%;--d:${delay}s;--t:${dur}s;--r:${spin}deg;--dx:${drift}px;background:${cssHex(cols[i % cols.length])}"></i>`;
  }
  const conf = document.createElement('div');
  conf.className = 'cup-confetti';
  conf.setAttribute('aria-hidden', 'true');
  conf.innerHTML = bits;
  scr.root.appendChild(conf);
  sfx.goal();
  sfx.coin();
}
