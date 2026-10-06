/**
 * The MOMENTS screen: Football Moments as a vertical list of cards (icon, title, one-line brief, best stars,
 * NEW / LOCKED / DONE), a pre-play card (brief, star rule, controls reminder, PLAY) and the match request that
 * runs one (AppContext.startMatch with `scenario`). The catalogue and the rules are in meta/moments.ts; the
 * best stars live in save.moments ({ [id]: stars }, written by main.ts's full-time hand-off through
 * core/save.ts recordMoment; this screen only reads them). One screen on the app shell (docs/UX.md): the moments
 * as a grid that scrolls in its own pane (the next one to beat selected and in view), the selected one's card
 * beside it with PLAY pinned at its foot. A tap selects; nothing navigates away.
 */
import type { AppContext, MatchRequest } from '../app';
import { currentDevice, fillKeys } from '../core/input';
import { momentStars, momentXp, type SaveData } from '../core/save';
import { makeTeam, PRESET_CLUBS, resolveKitClash } from '../meta/data';
import { MOMENTS, firstOpenMoment, momentStarTotals, momentUnlocked, nextMoment, starRules, type Moment } from '../meta/moments';
import { closeMeta, esc, mountMeta, topBar, type MetaScreen } from './club';
import { coachText } from './coach';
import { revealInPane } from './panes';
import { pixelIcon } from './pixelIcons';
import { scoreHtml, sep } from './text';

/** Best stars by moment id (a save from before moments existed reads as none). */
export function bestStars(save: SaveData): Readonly<Record<string, number>> {
  return save.moments ?? {};
}

/**
 * A moment's match request: the teams (your club against its usual rival, or the pairing the moment pins), the
 * scenario, no intro, and the hand-off back to the list. main.ts's full-time keeps the best stars and pays the
 * XP before calling `onDone` (NEXT MOMENT) or running the same request again (RETRY).
 */
export function momentRequest(app: AppContext, mo: Moment, h: { onDone: (won: boolean, stars: number) => void; onQuit: () => void }): MatchRequest {
  const homeIdx = mo.home ?? (PRESET_CLUBS[app.save.clubIdx] ? app.save.clubIdx : 0);
  let awayIdx = mo.away ?? app.save.opponentIdx;
  if (!PRESET_CLUBS[awayIdx] || awayIdx === homeIdx) awayIdx = (homeIdx + 1) % PRESET_CLUBS.length;
  const home = makeTeam(PRESET_CLUBS[homeIdx]);
  const away = makeTeam(PRESET_CLUBS[awayIdx]);
  return {
    home,
    away,
    kits: [home.kit, resolveKitClash(home.kit, away.kit)],
    humanSide: mo.spec.humanSide,
    kind: 'moment',
    difficulty: mo.spec.difficulty ?? mo.difficulty,
    // Never reached: the judge ends the moment (the sim's own half-time must not get there first).
    halfMinutes: 10,
    attendance: 0.7,
    stadiumLevel: 4,
    mode: mo.spec.mode ?? 'classic',
    scenario: mo.spec,
    skipIntro: true,
    firstMatch: false,
    nextLabel: mo.next ? 'NEXT MOMENT' : 'MOMENTS',
    quitNote: "This moment won't count.",
    // Moments pay in XP, not coins (main.ts).
    reward: () => ({ coins: 0, label: 'MOMENT' }),
    onDone: (r) => h.onDone(!!r.scenarioOutcome?.won, r.scenarioOutcome?.stars ?? 0),
    onQuit: h.onQuit,
  };
}

/** The Football Moments screen. `highlight`: the card to mark and scroll to (default: the first one still to be starred). */
export function openMoments(app: AppContext, onBack: () => void, highlight?: string): void {
  ensureCss();
  const scr = mountMeta(app, 'mo-screen shell');
  const back = (): void => {
    closeMeta();
    onBack();
  };
  const best = bestStars(app.save);
  const hl = highlight && MOMENTS.some((m) => m.id === highlight) && momentUnlocked(highlight, best) ? highlight : firstOpenMoment(best).id;
  listScreen(app, scr, hl, back);
}

// ------------------------------------------------------------------ the list

function starsHtml(n: number, label = true): string {
  let s = `<span class="mo-stars" ${label ? `aria-label="${n} of 3 stars"` : 'aria-hidden="true"'}>`;
  for (let i = 0; i < 3; i++) s += `<i class="${i < n ? 'on' : ''}">★</i>`;
  return s + '</span>';
}

function listScreen(app: AppContext, scr: MetaScreen, sel: string, back: () => void): void {
  const best = bestStars(app.save);
  const tot = momentStarTotals(best);
  const mo = MOMENTS.find((m) => m.id === sel) ?? MOMENTS[0];
  const cards = MOMENTS.map((m, i) => {
    const got = momentStars(app.save, m.id);
    const open = momentUnlocked(m.id, best);
    const chip = !open ? '<em class="mo-chip lock">LOCKED</em>' : got === 0 ? '<em class="mo-chip new">NEW</em>' : got === 3 ? '<em class="mo-chip done">DONE</em>' : '';
    const lockWhy = open ? '' : `, locked: star ${esc(MOMENTS[i - 1].title)} first`;
    return `<button class="mo-card ${open ? '' : 'locked'} ${m.id === mo.id ? 'sel' : ''}" data-a="pick" data-id="${m.id}" ${open ? '' : 'disabled'} aria-pressed="${m.id === mo.id}" aria-label="${esc(m.title)}${lockWhy}">
        <i class="mo-icon" aria-hidden="true">${pixelIcon(m.icon, 'currentColor', 3)}</i>
        <b>${i + 1}. ${esc(m.title)}</b>
        <span class="mo-meta">${starsHtml(got)}${chip}</span>
      </button>`;
  }).join('');
  scr.render(
    `${topBar('MENU', 'MOMENTS', `SHORT CHALLENGES${sep()}${tot.got}/${tot.of} STARS`, app.save.coins)}
    <div class="mc-body split mo-body">
      <div class="pane">
        <div class="pane-scroll mo-list" data-scroll-key="mo-list">${cards}</div>
      </div>
      <div class="pane mo-detail">${detailHtml(app, mo)}</div>
    </div>`,
    {
      back,
      pick: (el) => {
        const id = el.dataset.id ?? '';
        if (momentUnlocked(id, best) && id !== mo.id) listScreen(app, scr, id, back);
      },
      play: () => {
        closeMeta();
        app.startMatch(momentRequest(app, mo, {
          // Back to the list with the next one up (or this one, to try for more stars / again).
          onDone: (won) => openMoments(app, back, won ? nextMoment(mo.id)?.id ?? mo.id : mo.id),
          onQuit: () => openMoments(app, back, mo.id),
        }));
      },
    },
  );
  revealInPane(scr.panel.querySelector('.mo-card.sel'));
}

// ------------------------------------------------------------------ the selected moment

const DIFF = ['EASY', 'NORMAL', 'HARD', 'LEGEND'];

/** The selected moment: what to do, the three star rules, how, your best, and PLAY pinned at the foot. */
function detailHtml(app: AppContext, mo: Moment): string {
  const got = momentStars(app.save, mo.id);
  const rules = starRules(mo.spec);
  const hs = mo.spec.humanSide;
  const facts = [
    `${mo.spec.seconds} SECONDS`,
    DIFF[mo.spec.difficulty ?? mo.difficulty] ?? 'NORMAL',
    mo.spec.mode === 'blitz' ? 'BLITZ' : '',
    mo.home !== undefined && mo.away !== undefined ? `${esc(PRESET_CLUBS[mo.home].short)} v ${esc(PRESET_CLUBS[mo.away].short)}` : '',
  ].filter(Boolean).map((f) => (f.includes('<') ? f : esc(f)));
  // A start from a score other than 0 0: the score with the score divider (never a dash).
  if (mo.spec.score[0] || mo.spec.score[1]) facts.push(`FROM ${scoreHtml(mo.spec.score[hs], mo.spec.score[hs === 0 ? 1 : 0])}`);
  return `<div class="mo-dhead"><i class="mo-icon big" aria-hidden="true">${pixelIcon(mo.icon, 'currentColor', 4)}</i><div><h3>${esc(mo.title)}</h3><p class="mo-facts">${facts.join(sep())}</p></div></div>
    <div class="pane-scroll mo-dscroll">
      <p class="mo-brief">${esc(mo.brief)}</p>
      <ul class="mo-rules" aria-label="Star rules">
        ${rules.map((r, i) => `<li class="${got > i ? 'got' : ''}">${starsHtml(i + 1, false)}<span>${esc(r.charAt(0).toUpperCase() + r.slice(1))}</span></li>`).join('')}
      </ul>
      <p class="mo-tip"><b>HOW</b> ${esc(fillKeys(coachText(mo.tip, currentDevice())))}</p>
      <div class="mo-best">${got ? `BEST ${starsHtml(got)}` : 'NO STARS YET'}${sep()}+${momentXp(0)} XP FIRST TRY${sep()}${esc(mo.xpNote)}</div>
    </div>
    <div class="mc-actions"><button class="btn btn-go btn-lg mo-play pulse" data-a="play">PLAY</button></div>`;
}

// ------------------------------------------------------------------ style (only what the meta panel doesn't have)

let cssDone = false;
function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'mo-css';
  s.textContent = `
.mo-screen .mo-body { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); }
.mo-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; align-content: start; padding: 3px 6px 8px 3px; }
.mo-card { display: grid; grid-template-columns: 38px minmax(0, 1fr); grid-template-rows: auto auto; column-gap: 8px; row-gap: 4px; align-items: center; min-width: 0; min-height: 60px; padding: 6px 8px; text-align: left; font: inherit; color: var(--ink); background: #fff; border: 3px solid var(--ink); box-shadow: 0 4px 0 var(--cream-2); cursor: pointer; transition: transform 0.06s; }
.mo-card:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--cream-2); }
.mo-card:focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
.mo-card.sel { border-color: var(--blue-d); background: #eaf2ff; box-shadow: 0 4px 0 var(--blue-d), inset 0 0 0 2px var(--blue); transform: translateY(-2px); }
.mo-card.locked { opacity: 0.55; cursor: default; }
.mo-card.locked:active { transform: none; box-shadow: 0 4px 0 var(--cream-2); }
.mo-card > b { min-width: 0; font: 700 13px / 1.15 var(--px); letter-spacing: 0.5px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.mo-card .mo-icon { grid-row: 1 / span 2; }
.mo-meta { display: flex; align-items: center; gap: 6px; min-width: 0; }
.mo-icon { display: grid; place-items: center; width: 38px; height: 38px; font-style: normal; color: var(--ink); background: var(--cream-2); border: 3px solid var(--ink); }
.mo-icon .picon { width: 24px; height: 24px; filter: none; }
.mo-icon.big { width: 48px; height: 48px; }
.mo-icon.big .picon { width: 32px; height: 32px; }
.mo-chip { font: 400 11px / 1 var(--round); font-style: normal; letter-spacing: 1px; padding: 3px 5px 2px; color: #fff; background: var(--blue-d); }
.mo-chip.new { background: var(--go-d); }
.mo-chip.done { background: var(--yellow-d); }
.mo-chip.lock { background: var(--ink-2); }
.mo-stars { display: inline-flex; gap: 1px; font: 400 16px/1 var(--round); color: var(--cream-2); text-shadow: 0 2px 0 rgba(0,0,0,0.12); white-space: nowrap; }
.mo-stars i { font-style: normal; }
.mo-stars i.on { color: var(--yellow); text-shadow: 0 2px 0 var(--yellow-d); }
.mo-detail { gap: 8px; padding: 10px; background: #fff; border: 3px solid var(--ink); box-shadow: 0 5px 0 var(--cream-2); }
.mo-dhead { flex: none; display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 10px; align-items: center; }
.mo-dhead > div { display: grid; gap: 4px; min-width: 0; }
.panel.mc .mo-dhead h3 { margin: 0; font: 700 clamp(15px, 2vw, 20px) / 1.1 var(--px); letter-spacing: 0.5px; color: var(--ink); }
.mo-facts { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; font: 400 13px var(--round); letter-spacing: 1px; color: var(--ink-2); }
.mo-dscroll { display: grid; gap: 8px; align-content: start; padding-right: 4px; }
.mo-brief { margin: 0; font: 400 16px/1.25 var(--round); }
.mo-rules { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.mo-rules li { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; font: 400 14px/1.2 var(--round); padding: 3px 8px; background: var(--cream); border: 2px solid var(--cream-2); }
.mo-rules li.got { border-color: var(--yellow); }
.mo-rules .mo-stars { font-size: 14px; }
.mo-tip { margin: 0; font: 400 14px/1.3 var(--round); color: var(--ink-2); }
.mo-tip b { color: var(--blue-d); letter-spacing: 1px; margin-right: 4px; font-weight: 400; }
.mo-best { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font: 400 13px var(--round); letter-spacing: 1px; color: var(--ink-2); }
.mo-best .mo-stars { font-size: 14px; }
.mo-detail .mc-actions { justify-content: stretch; }
.mo-detail .mo-play { flex: 1 1 auto; min-width: 0; }
@media (max-height: 560px) {
  .mo-brief { font-size: 14px; }
  .mo-dhead { grid-template-columns: 40px minmax(0, 1fr); gap: 8px; }
  .mo-icon.big { width: 40px; height: 40px; }
  .mo-icon.big .picon { width: 26px; height: 26px; }
  .mo-detail { padding: 8px; gap: 6px; }
}
@media (max-aspect-ratio: 1/1) {
  .mo-screen .mo-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1.1fr); }
}
`;
  document.head.appendChild(s);
}
