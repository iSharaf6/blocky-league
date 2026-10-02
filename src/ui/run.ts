/**
 * The CLUB RUN screens: the start card (your club, difficulty, best run, next milestone), the run hub (the
 * seven-crest ladder with the current round lit, perks in force, the next opponent, ABANDON / PLAY), the perk
 * pick after a win (three big cards) and the run-over card (how far you got, what it paid, ONE MORE RUN).
 * Rules and state live in meta/run.ts (save.run); this file renders them and launches the matches through
 * AppContext.startMatch. Chunky style: the meta panel (ui/club.ts mountMeta) plus the rules below, injected
 * once (never style.css). Fits 375×667, 667×375 and desktop: one column that scrolls, the action row pinned.
 */
import type { AppContext, MatchRequest } from '../app';
import { sfx } from '../audio/sfx';
import type { MatchResult } from '../game/matchSession';
import { PRESET_CLUBS, makeTeam, resolveKitClash } from '../meta/data';
import {
  PERK_INFO, RUN_MILESTONES, RUN_ROUNDS, abandonRun, activePerks, bestText, clubWord, currentOpponent,
  nextMilestone, pickPerk, presetOvr, resolveStaleMatch, runMatchConfig, runOf, runOutcome, runXpBonus, settleRunMatch,
  startRun, type RunMatchConfig, type RunPerkId, type RunState, type RunStep,
} from '../meta/run';
import { goalsOf } from '../sim/shootout';
import { closeMeta, esc, fmt, mountMeta, topBar, type MetaScreen, type ToastKind } from './club';
import { crestSvg } from './crest';
import { difficultyLabels, playableDifficulty } from './difficulty';
import { DIFFICULTIES, DIFF_LEVEL, pixelIcon } from './menus';
import { scoreHtml, sep } from './text';

/** The perk fields a run match sets beyond today's MatchRequest (MatchConfig names; see the report / app.ts). */
type RunMatchFields = Pick<RunMatchConfig, 'startScore' | 'keeperBoost' | 'goldenFirst' | 'startPower' | 'sideDifficulty'>;

interface Flash {
  step?: RunStep | null;
  bonusXp?: number;
  msg?: string;
  kind?: ToastKind;
}

/** The live run inside app.save (a fresh save from before Club Run gets one). */
function runState(app: AppContext): RunState {
  return runOf(app.save);
}

/** The Club Run screen. */
export function openRun(app: AppContext, onBack: () => void): void {
  showRun(app, onBack);
}

function showRun(app: AppContext, onBack: () => void, flash?: Flash): void {
  ensureCss();
  const scr = mountMeta(app, 'rn-screen');
  const back = (): void => {
    closeMeta();
    onBack();
  };
  const st = runState(app);
  // A run match that never reported (the game closed mid-match) ends the run, like walking off.
  const stale = resolveStaleMatch(st);
  if (stale) {
    app.persist();
    flash = { step: stale };
  }
  route(app, scr, back, onBack, flash);
}

function route(app: AppContext, scr: MetaScreen, back: () => void, onBack: () => void, flash?: Flash): void {
  const st = runState(app);
  if (st.active && st.offer.length) pickScreen(app, scr, back, onBack, flash);
  else if (st.active) hubScreen(app, scr, back, onBack, flash);
  else if (flash?.step?.ended) overScreen(app, scr, back, onBack, flash);
  else startScreen(app, scr, back, onBack, flash);
}

// ------------------------------------------------------------------ pieces

const PERK_COLOR: { [k in RunPerkId]: string } = {
  powerStart: '#8a55d8',
  headStart: '#3cc15a',
  weakerNext: '#2f7be8',
  goldenFirst: '#e0b23a',
  xpBoost: '#ff8a2b',
  keeperBoost: '#1fb3a6',
};

/** 10×10 pixel masks for the perks that the shared icon set lacks. */
const MASKS: Record<string, string[]> = {
  bolt: ['......XX..', '.....XX...', '....XX....', '...XXXXX..', '..XXXXX...', '.....XX...', '....XX....', '...XX.....', '..XX......', '..X.......'],
  up: ['....XX....', '...XXXX...', '..XXXXXX..', '.XXXXXXXX.', 'XXX.XX.XXX', '....XX....', '....XX....', '....XX....', '....XX....', '....XX....'],
  down: ['....XX....', '....XX....', '....XX....', '....XX....', '....XX....', 'XXX.XX.XXX', '.XXXXXXXX.', '..XXXXXX..', '...XXXX...', '....XX....'],
  glove: ['..X.X.X...', '.XX.X.X.X.', '.XX.X.X.X.', '.XXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.', '.XXXXXXXX.', '..XXXXXX..', '..XXXXXX..', '..XXXXXX..'],
  cross: ['XX......XX', 'XXX....XXX', '.XXX..XXX.', '..XXXXXX..', '...XXXX...', '...XXXX...', '..XXXXXX..', '.XXX..XXX.', 'XXX....XXX', 'XX......XX'],
  tick: ['..........', '........XX', '.......XXX', '......XXX.', 'XX...XXX..', 'XXX.XXX...', '.XXXXX....', '..XXX.....', '...X......', '..........'],

  target: ['..XXXXXX..', '.X......X.', 'X..XXXX..X', 'X.X....X.X', 'X.X.XX.X.X', 'X.X.XX.X.X', 'X.X....X.X', 'X..XXXX..X', '.X......X.', '..XXXXXX..'],
  pass: ['XX........', 'XX........', '..X.......', '...X...X..', '....X..XX.', '.....XXXXX', '.......XX.', '.......X..', '........XX', '........XX'],
  wall: ['XXXX.XXXXX', 'XXXX.XXXXX', '..........', 'XX.XXXX.XX', 'XX.XXXX.XX', '..........', 'XXXX.XXXXX', 'XXXX.XXXXX', '..........', 'XX.XXXX.XX'],
  spark: ['....XX....', '....XX....', '...XXXX...', '..XXXXXX..', 'XXXXXXXXXX', 'XXXXXXXXXX', '..XXXXXX..', '...XXXX...', '....XX....', '....XX....'],
};

/** A 10×10 pixel icon: one of MASKS, else one of the shared set (ui/menus.ts pixelIcon: ball, trophy, star...). */
export function maskIcon(name: string, color: string, px = 4): string {
  const rows = MASKS[name];
  if (!rows) return pixelIcon(name, color, px);
  let rects = '';
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === 'X') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }));
  return `<svg class="picon" width="${10 * px}" height="${10 * px}" viewBox="0 0 10 10" shape-rendering="crispEdges" fill="${color}" aria-hidden="true">${rects}</svg>`;
}

const PERK_ICON: { [k in RunPerkId]: string } = {
  powerStart: 'bolt', headStart: 'up', weakerNext: 'down', goldenFirst: 'ball', xpBoost: 'star', keeperBoost: 'glove',
};

function perkIcon(id: RunPerkId, px = 4): string {
  return maskIcon(PERK_ICON[id], '#fff', px);
}

function perkChip(id: RunPerkId): string {
  return `<span class="rn-pchip" style="--c:${PERK_COLOR[id]}" title="${esc(PERK_INFO[id].text)}"><i>${perkIcon(id, 2)}</i><b>${PERK_INFO[id].name}</b></span>`;
}

function crest(i: number, px = 3): string {
  const c = PRESET_CLUBS[i];
  return c ? crestSvg(c.name, c.short, c.kit, px) : '';
}

/** The seven rungs: won, the one being played (or where the run ended), and the rest (hidden before a run). */
function ladderHtml(st: RunState, mode: 'preview' | 'live' | 'over'): string {
  const lostAt = mode === 'over' && st.last && !st.last.won ? st.last.round : 0;
  const rungs: string[] = [];
  for (let i = 0; i < RUN_ROUNDS; i++) {
    const r = i + 1;
    const club = st.ladder[i];
    const known = mode !== 'preview' && club !== undefined;
    const won = mode !== 'preview' && r <= st.round;
    const now = mode === 'live' && r === st.round + 1;
    const lost = r === lostAt;
    const ms = RUN_MILESTONES.find((m) => m.round === r);
    const cls = ['rn-rung', won ? 'won' : '', now ? 'now' : '', lost ? 'lost' : '', !known ? 'mystery' : '', ms ? 'ms' : ''].join(' ');
    const badge = won ? `<em class="rn-badge ok">${maskIcon('tick', '#fff', 2)}</em>` : lost ? `<em class="rn-badge no">${maskIcon('cross', '#fff', 2)}</em>` : '';
    const flag = ms
      ? `<span class="rn-ms ${st.milestones.includes(r) ? 'got' : ''}" aria-hidden="true">${pixelIcon('trophy', st.milestones.includes(r) ? '#c7970f' : '#b9b5aa', 1.4)}</span>`
      : '<span class="rn-ms" aria-hidden="true"></span>';
    const label = known ? `Round ${r}: ${PRESET_CLUBS[club].name}${won ? ', won' : now ? ', next' : lost ? ', lost' : ''}` : `Round ${r}`;
    rungs.push(`<li class="${cls}" style="--i:${i}" aria-label="${esc(label)}">
      <span class="rn-crest">${known ? crest(club) : '<i class="rn-q">?</i>'}${badge}</span>
      <b>${r}</b>${flag}
    </li>`);
  }
  return `<ol class="rn-ladder">${rungs.join('')}</ol>`;
}

function milestoneHtml(st: RunState): string {
  const m = nextMilestone(st);
  if (!m) {
    return `<div class="rn-mile done">${pixelIcon('trophy', '#c7970f', 3)}<div><b>EVERY MILESTONE EARNED</b><small>${st.cleared} FULL ${st.cleared === 1 ? 'CLEAR' : 'CLEARS'}. Go again for the coins and the best run.</small></div></div>`;
  }
  const win = m.round === RUN_ROUNDS ? `WIN ALL ${RUN_ROUNDS}` : `WIN ROUND ${m.round}`;
  return `<div class="rn-mile">${pixelIcon('trophy', '#c7970f', 3)}<div><b>NEXT MILESTONE: ${win}</b>
    <span class="rn-rw"><em><i class="rn-coin"></i>${fmt(m.coins)}</em><em>${m.xp} XP</em><em>TITLE: ${esc(m.title.toUpperCase())}</em></span></div></div>`;
}

function statsHtml(st: RunState): string {
  const best = st.cleared > 0
    ? `<b>ALL ${RUN_ROUNDS} WON</b><small>BEST RUN</small>`
    : st.best > 0 && st.bestVs >= 0
      ? `<b>ROUND ${st.best}</b><small>BEST RUN v ${esc(clubWord(st.bestVs))}</small>`
      : '<b>NONE YET</b><small>BEST RUN</small>';
  return `<div class="rn-stats">
    <span>${best}</span>
    <span><b>${st.runs}</b><small>RUNS</small></span>
    <span><b>${st.cleared}</b><small>ALL 7 WON</small></span>
  </div>`;
}

/** What happened in the last match (or ABANDON), one line of HTML. */
function lastLine(st: RunState): string {
  const l = st.last;
  if (!l) return '';
  const who = esc(clubWord(l.vs));
  const sc = scoreHtml(l.score[0], l.score[1]);
  if (l.how === 'abandoned') return `ABANDONED BEFORE ROUND ${l.round}`;
  if (l.how === 'quit') return `WALKED OFF IN ROUND ${l.round} v ${who}`;
  if (l.how === 'left') return `LEFT MID MATCH IN ROUND ${l.round} v ${who}`;
  if (l.pens) return `${l.won ? 'WON' : 'LOST'} ON PENALTIES v ${who} <span class="rn-sc">${scoreHtml(l.pens[0], l.pens[1])}</span>`;
  return `${l.won ? 'BEAT' : 'LOST TO'} ${who} <span class="rn-sc">${sc}</span>`;
}

function milestoneToast(scr: MetaScreen, f?: Flash): void {
  const m = f?.step?.milestone;
  if (m) {
    sfx.coin();
    scr.toast(`MILESTONE: ${m.title.toUpperCase()}! +${fmt(m.coins)} COINS +${m.xp} XP`, 'good');
  } else if (f?.msg) scr.toast(f.msg, f.kind ?? 'info');
}

// ------------------------------------------------------------------ start

function startScreen(app: AppContext, scr: MetaScreen, back: () => void, onBack: () => void, flash?: Flash): void {
  const st = runState(app);
  const club = PRESET_CLUBS[app.save.clubIdx] ? app.save.clubIdx : 0;
  // (LEGEND is earned by match stars, as in Quick Match: ui/difficulty.ts.)
  const progress = app.save.progress;
  let diff = playableDifficulty(st.runs ? st.difficulty : app.save.settings.difficulty, progress);
  const render = (): void => {
    const c = PRESET_CLUBS[club];
    const chips = difficultyLabels(DIFFICULTIES, progress).map((d, i) => `<button class="rn-diff ${i === diff ? 'on' : ''}" data-a="diff" data-i="${i}" aria-pressed="${i === diff}">${d}</button>`).join('');
    const last = st.last ? `<p class="rn-last"><span>LAST RUN</span> ${lastLine(st)}</p>` : '';
    scr.render(
      `${topBar('MENU', 'CLUB RUN', `${RUN_ROUNDS} WINS${sep()}ONE LIFE`, app.save.coins)}
      ${ladderHtml(st, 'preview')}
      <div class="rn-cols">
        <div class="rn-col">
          <div class="rn-card rn-intro">
            <p><b>Win ${RUN_ROUNDS} knockout matches in a row</b> against stronger and stronger clubs. Lose once and the run is over.</p>
            <p>After every win, pick a perk for the rest of the run. Matches have 1 minute halves, and a draw goes to penalties.</p>
          </div>
          ${statsHtml(st)}
          ${last}
        </div>
        <div class="rn-col">
          <div class="rn-card rn-setup">
            <div class="rn-you">${crest(club, 2)}<div><small>YOUR CLUB</small><b>${esc(c.name.toUpperCase())}</b><span class="rn-tags"><em>OVR ${presetOvr(club)}</em><small>Change it in Quick Match.</small></span></div></div>
            <div class="rn-diffs" role="group" aria-label="Difficulty">${chips}</div>
          </div>
          ${milestoneHtml(st)}
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-go btn-lg pulse rn-go" data-a="start">START RUN</button>
      </div>`,
      {
        back,
        diff: (el) => {
          const i = Number(el.dataset.i) || 0;
          if (playableDifficulty(i, progress) !== i) return;
          diff = i;
          render();
        },
        start: () => {
          const seed = (Date.now() ^ Math.imul(st.runs + 1, 0x9e3779b1)) >>> 0;
          if (startRun(st, { seed, club, difficulty: diff })) {
            app.persist();
            sfx.whistle('short');
            hubScreen(app, scr, back, onBack, { msg: `ROUND 1 v ${clubWord(currentOpponent(st))}`, kind: 'info' }, true);
          }
        },
      },
    );
  };
  render();
  milestoneToast(scr, flash);
}

// ------------------------------------------------------------------ the hub

function hubScreen(app: AppContext, scr: MetaScreen, back: () => void, onBack: () => void, flash?: Flash, reveal = false): void {
  const st = runState(app);
  const opp = currentOpponent(st);
  const c = PRESET_CLUBS[opp];
  const perks = activePerks(st);
  const r = st.round + 1;
  const render = (confirm: boolean): void => {
    const perkRow = perks.length
      ? `<div class="rn-perks">${perks.map(perkChip).join('')}</div>`
      : '<p class="rn-none">No perks yet: win this one to pick your first.</p>';
    const final = r === RUN_ROUNDS;
    const body = confirm
      ? `<div class="mc-notice rn-confirm"><p><b>ABANDON THIS RUN?</b></p><p>It ends before round ${r}. Your best run and milestones stay.</p></div>
         <div class="btn-row">
           <button class="btn btn-white" data-a="keep">KEEP GOING</button>
           <button class="btn btn-red" data-a="abandonYes">ABANDON</button>
         </div>`
      : `<div class="btn-row">
           <button class="btn btn-white rn-ab" data-a="abandon">ABANDON</button>
           <button class="btn btn-go btn-lg pulse rn-go" data-a="play">${final ? 'PLAY THE FINAL' : `PLAY ROUND ${r}`}</button>
         </div>`;
    scr.render(
      `${topBar('MENU', 'CLUB RUN', `ROUND ${r} OF ${RUN_ROUNDS}${sep()}${DIFFICULTIES[st.difficulty] ?? 'NORMAL'}`, app.save.coins)}
      <div class="${reveal ? 'rn-reveal' : ''}">${ladderHtml(st, 'live')}</div>
      <div class="rn-cols">
        <div class="rn-col">
          <div class="rn-card rn-next">
            <div class="rn-nextcrest">${crest(opp, 4)}</div>
            <div class="rn-nextbody">
              <small>${final ? 'THE FINAL' : `ROUND ${r}`}${sep()}KNOCKOUT</small>
              <b>${esc(c?.name.toUpperCase() ?? '')}</b>
              <span class="rn-tags"><em>OVR ${presetOvr(opp)}</em><em class="you">YOU ${presetOvr(st.club)}</em><small>A draw goes to penalties.</small></span>
            </div>
          </div>
          ${st.last && st.last.won ? `<p class="rn-last"><span>LAST</span> ${lastLine(st)}</p>` : ''}
        </div>
        <div class="rn-col">
          <h3 class="mc-h">PERKS IN FORCE</h3>
          ${perkRow}
          ${milestoneHtml(st)}
        </div>
      </div>
      ${body}`,
      {
        back,
        play: () => playRound(app, onBack),
        abandon: () => render(true),
        keep: () => render(false),
        abandonYes: () => {
          if (abandonRun(st)) {
            app.persist();
            overScreen(app, scr, back, onBack, { step: null });
          }
        },
      },
    );
  };
  render(false);
  milestoneToast(scr, flash);
}

// ------------------------------------------------------------------ perk pick

function pickScreen(app: AppContext, scr: MetaScreen, back: () => void, onBack: () => void, flash?: Flash): void {
  const st = runState(app);
  const l = st.last;
  const won = l && l.won ? lastLine(st) : `ROUND ${st.round} WON`;
  const nextOpp = currentOpponent(st);
  const bonus = flash?.bonusXp ? `<p class="rn-bonus">XP BOOST: +${flash.bonusXp} XP</p>` : '';
  const cards = st.offer.map((id) => `<button class="rn-perk" data-a="pick" data-id="${id}" style="--c:${PERK_COLOR[id]}" aria-label="${esc(PERK_INFO[id].name)}: ${esc(PERK_INFO[id].text)}">
      <span class="rn-pic">${perkIcon(id, 5)}</span>
      <b>${PERK_INFO[id].name}</b>
      <small>${esc(PERK_INFO[id].text)}</small>
      <em>${PERK_INFO[id].once ? 'NEXT MATCH' : 'REST OF THE RUN'}</em>
    </button>`).join('');
  scr.render(
    `${topBar('MENU', 'PICK A PERK', `ROUND ${st.round} WON`, app.save.coins)}
    <div class="rn-won"><p>${won}</p>${bonus}<p class="rn-up"><span>NEXT</span> ROUND ${st.round + 1} v ${esc(clubWord(nextOpp))}</p></div>
    <div class="rn-offer n${st.offer.length}">${cards}</div>
    ${activePerks(st).length ? `<div class="rn-perks small"><span>HELD</span>${activePerks(st).map(perkChip).join('')}</div>` : ''}`,
    {
      back,
      pick: (el) => {
        const id = el.dataset.id as RunPerkId;
        if (pickPerk(st, id)) {
          app.persist();
          sfx.powerup();
          hubScreen(app, scr, back, onBack, { msg: `${PERK_INFO[id].name}!`, kind: 'good' });
        }
      },
    },
  );
  milestoneToast(scr, flash);
}

// ------------------------------------------------------------------ run over

function overScreen(app: AppContext, scr: MetaScreen, back: () => void, onBack: () => void, flash?: Flash): void {
  const st = runState(app);
  const step = flash?.step ?? null;
  const cleared = !!step?.cleared;
  const l = st.last;
  const reached = cleared ? RUN_ROUNDS : l?.round ?? st.round + 1;
  const headline = cleared ? `ALL ${RUN_ROUNDS} WON!` : l?.how === 'abandoned' ? 'RUN ABANDONED' : `OUT IN ROUND ${reached}`;
  const newBest = step?.newBest || (cleared && st.cleared === 1);
  const perksUsed = [...new Set(st.perks)];
  const bonus = flash?.bonusXp ? `<em>XP BOOST +${flash.bonusXp} XP</em>` : '';
  scr.render(
    `${topBar('MENU', cleared ? 'INVINCIBLE!' : 'RUN OVER', `ROUND ${reached} OF ${RUN_ROUNDS}`, app.save.coins)}
    <div class="rn-over ${cleared ? 'win' : ''}">
      ${cleared ? pixelIcon('trophy', '#ffd23a', 7) : ''}
      <h3>${headline}</h3>
      ${l && !cleared ? `<p>${lastLine(st)}</p>` : ''}
      ${newBest ? '<em class="rn-new">NEW BEST RUN</em>' : `<em class="rn-bestis">${esc(bestText(st))}</em>`}
    </div>
    ${ladderHtml(st, 'over')}
    <div class="rn-card rn-take"><span>THIS RUN PAID</span><span class="rn-rw"><em><i class="rn-coin"></i>${fmt(st.coins)}</em><em>${fmt(st.xp)} BONUS XP</em>${bonus}</span></div>
    ${perksUsed.length ? `<div class="rn-perks small"><span>PERKS</span>${perksUsed.map(perkChip).join('')}</div>` : ''}
    ${milestoneHtml(st)}
    <div class="btn-row">
      <button class="btn btn-white" data-a="back">MENU</button>
      <button class="btn btn-go btn-lg pulse rn-go" data-a="again">ONE MORE RUN</button>
    </div>`,
    {
      back,
      again: () => startScreen(app, scr, back, onBack),
    },
  );
  if (cleared) sfx.cheer(1);
  milestoneToast(scr, flash);
}

// ------------------------------------------------------------------ playing a round

/** A finished match as a run outcome: the user is always the home side (0). */
function outcomeOf(r: MatchResult) {
  const so = r.match.shootout;
  const pens: [number, number] | null = so && so.winner >= 0 ? [goalsOf(so.kicks[0]), goalsOf(so.kicks[1])] : null;
  return runOutcome(r.score, r.winner, pens);
}

function returnToRun(app: AppContext, onBack: () => void, flash: Flash): void {
  // mainMenu() brings back the 3D backdrop and music; the run screen replaces it in the same task.
  app.mainMenu();
  showRun(app, onBack, flash);
}

function playRound(app: AppContext, onBack: () => void): void {
  const st = runState(app);
  const cfg = runMatchConfig(st, DIFF_LEVEL[st.difficulty] ?? 1.8);
  if (!cfg) return;
  const home = makeTeam(PRESET_CLUBS[cfg.club]);
  const away = makeTeam(PRESET_CLUBS[cfg.opponent]);
  const seed = st.seed;
  const round = st.round;
  // Only ever apply a result to the run and round it was played in.
  const current = (): RunState | null => {
    const s = runState(app);
    return s.active && s.inMatch && s.seed === seed && s.round === round ? s : null;
  };
  let step: RunStep | null = null;
  const xpAtStart = app.save.progress.xp;
  st.inMatch = true;
  app.persist();
  closeMeta();
  const req: MatchRequest & RunMatchFields = {
    home,
    away,
    kits: [home.kit, resolveKitClash(home.kit, away.kit)],
    humanSide: 0,
    difficulty: cfg.difficulty,
    halfMinutes: cfg.halfMinutes,
    attendance: cfg.attendance,
    stadiumLevel: cfg.stadiumLevel,
    knockout: true,
    mode: cfg.mode,
    startScore: cfg.startScore,
    keeperBoost: cfg.keeperBoost,
    goldenFirst: cfg.goldenFirst,
    startPower: cfg.startPower,
    sideDifficulty: cfg.sideDifficulty,
    skipIntro: true,
    nextLabel: 'CONTINUE RUN',
    quitNote: `Walking off counts as a defeat: your run ends in round ${cfg.round}.`,
    // Called once at full time: the run moves on here, so the result is saved with the match's coins.
    reward: (r) => {
      if (!current()) return { coins: 0, label: 'CLUB RUN' };
      step = settleRunMatch(app.save, outcomeOf(r));
      if (!step) return { coins: 0, label: 'CLUB RUN' };
      const label = step.cleared ? 'INVINCIBLE!' : step.won ? `ROUND ${step.round} WON` : 'RUN OVER';
      return { coins: step.coins, label };
    },
    onDone: (_r, earned) => {
      const s = runState(app);
      if (step) s.coins += earned;
      // XP BOOST: the match's own XP (what main.ts added after this function's milestone XP) and 20% again.
      const matchXp = app.save.progress.xp - xpAtStart - (step?.milestone?.xp ?? 0);
      const bonusXp = step ? runXpBonus(app.save, matchXp) : 0;
      app.persist();
      returnToRun(app, onBack, { step, bonusXp });
    },
    onQuit: () => {
      const q = current() ? settleRunMatch(app.save, { won: false, score: [0, 0], how: 'quit' }) : null;
      app.persist();
      returnToRun(app, onBack, { step: q });
    },
  };
  app.startMatch(req);
}

// ------------------------------------------------------------------ style (only what the meta panel doesn't have)

let cssDone = false;
function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'rn-css';
  s.textContent = `
.rn-screen .panel.mc { gap: 12px; }
.rn-ladder { list-style: none; margin: 0; padding: 10px 6px 6px; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; background: #fff; border: 3px solid var(--ink); box-shadow: 0 5px 0 var(--cream-2); position: relative; }
.rn-ladder::before { content: ''; position: absolute; left: 7%; right: 7%; top: 34px; height: 6px; background: var(--cream-2); z-index: 0; }
.rn-rung { position: relative; z-index: 1; display: grid; grid-template-rows: auto auto 16px; justify-items: center; align-content: start; gap: 4px; min-width: 0; }
.rn-crest { position: relative; display: grid; place-items: center; width: 100%; max-width: 50px; aspect-ratio: 13 / 15; }
.rn-crest svg { width: 100%; height: auto; filter: drop-shadow(0 3px 0 rgba(0,0,0,0.18)); }
.rn-q { display: grid; place-items: center; width: 80%; aspect-ratio: 13 / 15; font: 700 18px var(--px); font-style: normal; color: #b9b5aa; background: var(--cream); border: 3px dashed #cfcabd; }
.rn-rung b { font: 700 13px var(--px); color: var(--ink-2); }
.rn-rung.won .rn-crest svg { opacity: 0.55; }
.rn-rung.won b { color: var(--go-d); }
.rn-rung.now .rn-crest { transform: translateY(-3px) scale(1.06); }
.rn-rung.now .rn-crest::after { content: ''; position: absolute; inset: -3px; border: 3px solid var(--yellow); box-shadow: 0 0 0 3px var(--ink); animation: rn-glow 1.1s ease-in-out infinite; }
.rn-rung.now b { color: var(--ink); background: var(--yellow); padding: 1px 6px 0; }
.rn-rung.lost .rn-crest svg { opacity: 0.8; }
.rn-rung.lost b { color: var(--red-d); }
.rn-badge { position: absolute; right: -4px; bottom: -2px; display: grid; place-items: center; width: 22px; height: 22px; border: 2px solid var(--ink); }
.rn-badge.ok { background: var(--go); }
.rn-badge.no { background: var(--red); }
.rn-ms { line-height: 0; opacity: 0.8; }
.rn-ms.got { opacity: 1; }
.rn-reveal .rn-rung { animation: rn-pop 0.35s cubic-bezier(.2,1.6,.4,1) both; animation-delay: calc(var(--i) * 70ms); }
@keyframes rn-pop { from { transform: translateY(14px) scale(0.6); opacity: 0; } }
@keyframes rn-glow { 50% { transform: scale(1.06); } }
.rn-cols { display: grid; gap: 12px; }
.rn-col { display: grid; gap: 12px; align-content: start; min-width: 0; }
.panel.mc .rn-col .mc-h { margin: 0 0 -4px; }
@media (min-width: 600px) { .rn-cols { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; } }
.rn-card { background: #fff; border: 3px solid var(--ink); box-shadow: 0 5px 0 var(--cream-2); padding: 12px; }
.rn-intro { display: grid; gap: 6px; }
.rn-intro p { margin: 0; font: 400 16px/1.3 var(--round); color: var(--ink-2); }
.rn-intro b { color: var(--ink); font-weight: 400; }
.rn-stats { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.rn-stats span { display: grid; gap: 2px; justify-items: center; text-align: center; padding: 8px 6px; background: var(--cream); border: 3px solid var(--cream-2); min-width: 0; }
.rn-stats b { font: 700 15px var(--px); letter-spacing: 0.5px; color: var(--ink); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rn-stats small { font: 400 12px var(--round); letter-spacing: 1px; color: var(--ink-2); }
.rn-mile { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; padding: 10px 12px; background: #fff7d6; border: 3px solid var(--yellow-d); box-shadow: 0 5px 0 rgba(199, 151, 15, 0.35); }
.rn-mile div { display: grid; gap: 3px; min-width: 0; }
.rn-mile b { font: 700 14px var(--px); letter-spacing: 0.5px; color: var(--ink); }
.rn-rw { display: flex; flex-wrap: wrap; gap: 5px; }
.rn-rw em { display: inline-flex; align-items: center; gap: 5px; font: 400 14px var(--round); font-style: normal; letter-spacing: 0.5px; color: var(--ink); background: #fff; border: 2px solid var(--yellow-d); padding: 2px 7px 1px; }
.rn-coin { display: inline-block; width: 12px; height: 12px; background: var(--yellow); border: 1px solid var(--ink); box-shadow: inset -2px -2px 0 var(--yellow-d), inset 2px 2px 0 #fff3b0; }
.rn-last { margin: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; font: 400 15px var(--round); letter-spacing: 0.5px; color: var(--ink-2); text-align: center; }
.rn-last > span:first-child { font: 400 12px var(--round); letter-spacing: 1px; color: #fff; background: var(--ink-2); padding: 2px 6px 1px; }
.rn-sc { font: 700 15px var(--px); color: var(--ink); }
.rn-setup { display: grid; gap: 10px; }
.rn-you { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: center; }
.rn-you div { display: grid; gap: 2px; min-width: 0; }
.rn-you b { font: 700 16px var(--px); letter-spacing: 0.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rn-you small { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; font: 400 13px var(--round); letter-spacing: 1px; color: var(--ink-2); }
.rn-diffs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.rn-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
.rn-tags em { font: 700 12px var(--px); font-style: normal; letter-spacing: 0.5px; color: #fff; background: var(--ink-2); padding: 3px 6px 2px; }
.rn-tags em.you { background: var(--blue-d); }
.rn-tags small { font: 400 13px var(--round); letter-spacing: 0.5px; color: var(--ink-2); }
.rn-diff { font: 700 13px var(--px); letter-spacing: 0.5px; min-height: 44px; padding: 8px 2px; min-width: 0; overflow: hidden; color: var(--ink); background: var(--cream); border: 3px solid var(--cream-2); cursor: pointer; }
.rn-diff.on { background: var(--blue); color: #fff; border-color: var(--blue-d); box-shadow: 0 4px 0 var(--blue-d); }
.rn-diff:focus-visible, .rn-perk:focus-visible { outline: 3px solid var(--yellow); outline-offset: 2px; }
.rn-next { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; align-items: center; border-color: var(--ink); }
.rn-nextcrest svg { display: block; width: 52px; height: auto; }
.rn-nextbody { display: grid; gap: 3px; min-width: 0; }
.rn-nextbody b { font: 700 clamp(16px, 2.4vw, 22px)/1.15 var(--px); letter-spacing: 0.5px; overflow-wrap: anywhere; }
.rn-nextbody small { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; font: 400 13px var(--round); letter-spacing: 1px; color: var(--ink-2); }
.rn-perks { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.rn-perks.small > span:first-child { font: 400 12px var(--round); letter-spacing: 1px; color: var(--ink-2); margin-right: 2px; }
.rn-pchip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 3px 4px; color: #fff; background: var(--c); border: 2px solid var(--ink); box-shadow: 0 3px 0 rgba(0,0,0,0.2); }
.rn-pchip i { display: grid; place-items: center; width: 24px; height: 24px; background: rgba(0,0,0,0.18); }
.rn-pchip b { font: 700 12px var(--px); letter-spacing: 0.5px; white-space: nowrap; text-shadow: 0 1px 0 rgba(0,0,0,0.3); }
.rn-none { margin: 0; font: 400 15px var(--round); color: var(--ink-2); }
.rn-won { text-align: center; display: grid; gap: 4px; }
.rn-won p { margin: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; font: 400 17px var(--round); letter-spacing: 0.5px; }
.rn-won .rn-bonus { font-size: 14px; color: var(--go-d); }
.rn-won .rn-up { font-size: 14px; color: var(--ink-2); }
.rn-up span { font: 400 12px var(--round); letter-spacing: 1px; color: #fff; background: var(--ink-2); padding: 2px 6px 1px; }
.rn-offer { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.rn-offer.n2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.rn-offer.n1 { grid-template-columns: minmax(0, 1fr); max-width: 320px; margin: 0 auto; width: 100%; }
.rn-perk { display: grid; justify-items: center; align-content: start; gap: 8px; padding: 16px 12px 14px; text-align: center; font: inherit; color: var(--ink); background: #fff; border: 4px solid var(--ink); box-shadow: 0 7px 0 var(--c), 0 11px 0 rgba(38,38,46,0.2); cursor: pointer; transition: transform 0.08s, box-shadow 0.08s; animation: rn-deal 0.4s cubic-bezier(.2,1.5,.4,1) both; }
.rn-perk:nth-child(2) { animation-delay: 80ms; }
.rn-perk:nth-child(3) { animation-delay: 160ms; }
@keyframes rn-deal { from { transform: translateY(30px) rotate(-4deg); opacity: 0; } }
.rn-perk:hover { transform: translateY(-3px); }
.rn-perk:active { transform: translateY(5px); box-shadow: 0 2px 0 var(--c), 0 4px 0 rgba(38,38,46,0.2); }
.rn-pic { display: grid; place-items: center; width: 76px; height: 76px; background: var(--c); border: 3px solid var(--ink); box-shadow: inset -5px -5px 0 rgba(0,0,0,0.18), inset 5px 5px 0 rgba(255,255,255,0.25); }
.rn-perk b { font: 700 17px var(--px); letter-spacing: 1px; }
.rn-perk small { font: 400 15px/1.3 var(--round); color: var(--ink-2); }
.rn-perk em { font: 400 12px var(--round); font-style: normal; letter-spacing: 1px; color: #fff; background: var(--ink-2); padding: 2px 7px 1px; }
.rn-over { text-align: center; display: grid; justify-items: center; gap: 6px; padding: 8px 0 2px; }
.panel.mc .rn-over h3 { margin: 0; font: 700 clamp(24px, 4vw, 38px) var(--px); letter-spacing: 1.5px; color: var(--ink); }
.panel.mc .rn-over.win h3 { color: var(--yellow-d); text-shadow: 0 3px 0 var(--ink); }
.rn-over p { margin: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; font: 400 16px var(--round); color: var(--ink-2); }
.rn-new { font: 700 13px var(--px); font-style: normal; letter-spacing: 1px; color: var(--ink); background: var(--yellow); padding: 4px 10px 3px; border: 2px solid var(--ink); animation: rn-glow 1.1s ease-in-out infinite; }
.rn-bestis { font: 400 14px var(--round); font-style: normal; letter-spacing: 1px; color: var(--ink-2); }
.rn-take { display: grid; gap: 4px; justify-items: center; text-align: center; }
.rn-take span { font: 400 12px var(--round); letter-spacing: 1px; color: var(--ink-2); }
.rn-take .rn-rw { justify-content: center; }
.rn-take .rn-rw em { font-size: 15px; }
.rn-confirm { display: grid; gap: 4px; }
.rn-confirm p { margin: 0; }
.rn-screen .btn-row { display: flex; gap: 10px; flex-wrap: nowrap; }
.rn-screen .btn-row .btn { min-width: 0; }
.rn-screen .btn-row .rn-go { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
.rn-screen .btn-row .rn-ab { flex: 0 0 auto; }
@media (max-width: 520px) {
  .rn-offer, .rn-offer.n2 { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .rn-perk { grid-template-columns: 60px minmax(0, 1fr); justify-items: start; text-align: left; align-items: center; column-gap: 12px; row-gap: 2px; padding: 10px 12px; }
  .rn-pic { grid-row: 1 / span 3; width: 60px; height: 60px; }
  .rn-pic svg { width: 40px; height: 40px; }
  .rn-perk b { font-size: 15px; }
  .rn-perk small { font-size: 14px; }
  .rn-ladder { padding: 8px 4px 4px; gap: 2px; }
  .rn-ladder::before { top: 28px; }
  .rn-badge { width: 18px; height: 18px; right: -3px; }
  .rn-badge svg { width: 14px; height: 14px; }
  .rn-stats b { font-size: 13px; }
  .rn-diff { font-size: 11px; letter-spacing: 0; }
  .rn-screen .btn-row .btn-lg { padding: 16px 10px 14px; font-size: 16px; letter-spacing: 1px; }
  .rn-screen .btn-row .rn-ab { padding: 15px 10px 13px; font-size: 13px; letter-spacing: 0.5px; }
}
@media (max-height: 460px) {
  .rn-screen .panel.mc { gap: 10px; }
  .rn-ladder { padding: 6px 6px 4px; }
  .rn-crest { max-width: 34px; }
  .rn-ladder::before { top: 22px; }
  .rn-offer { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .rn-offer.n2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rn-perk { display: grid; grid-template-columns: 1fr; justify-items: center; text-align: center; padding: 10px 8px; gap: 4px; }
  .rn-pic { grid-row: auto; width: 48px; height: 48px; }
  .rn-pic svg { width: 32px; height: 32px; }
  .rn-perk b { font-size: 14px; }
  .rn-perk small { font-size: 13px; }
  .rn-intro p { font-size: 15px; }
}
@media (prefers-reduced-motion: reduce) {
  .rn-reveal .rn-rung, .rn-perk, .rn-rung.now .rn-crest::after, .rn-new { animation: none; }
}
`;
  document.head.appendChild(s);
}
