/**
 * The MOMENTS screen: Football Moments as a vertical list of cards (icon, title, one-line brief, best stars,
 * NEW / LOCKED / DONE), a pre-play card (brief, star rule, controls reminder, PLAY) and the match request that
 * runs one (AppContext.startMatch with `scenario`). The catalogue and the rules are in meta/moments.ts; the
 * best stars live in save.moments ({ [id]: stars }, written by main.ts's full-time hand-off through
 * core/save.ts recordMoment; this screen only reads them). Chunky style: the meta-screen panel (ui/club.ts
 * mountMeta) plus a few rules of its own below; fits 375×667 and 667×375 (one column, the panel scrolls).
 */
import type { AppContext, MatchRequest } from '../app';
import { fillKeys } from '../core/input';
import { momentStars, momentXp, type SaveData } from '../core/save';
import { makeTeam, PRESET_CLUBS, resolveKitClash } from '../meta/data';
import { MOMENT_XP_PER_STAR, MOMENTS, firstOpenMoment, momentStarTotals, momentUnlocked, nextMoment, starRules, type Moment } from '../meta/moments';
import { closeMeta, esc, mountMeta, topBar, type MetaScreen } from './club';
import { sep } from './text';

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
  const scr = mountMeta(app, 'mo-screen');
  const back = (): void => {
    closeMeta();
    onBack();
  };
  const hl = highlight && MOMENTS.some((m) => m.id === highlight) ? highlight : firstOpenMoment(bestStars(app.save)).id;
  listScreen(app, scr, hl, back);
}

// ------------------------------------------------------------------ the list

function starsHtml(n: number, label = true): string {
  let s = `<span class="mo-stars" ${label ? `aria-label="${n} of 3 stars"` : 'aria-hidden="true"'}>`;
  for (let i = 0; i < 3; i++) s += `<i class="${i < n ? 'on' : ''}">★</i>`;
  return s + '</span>';
}

function listScreen(app: AppContext, scr: MetaScreen, hl: string, back: () => void): void {
  const best = bestStars(app.save);
  const tot = momentStarTotals(best);
  const cards = MOMENTS.map((mo, i) => {
    const got = momentStars(app.save, mo.id);
    const open = momentUnlocked(mo.id, best);
    const isNew = open && got === 0;
    const chip = !open
      ? `<em class="mo-chip lock">LOCKED${sep()}STAR ${esc(MOMENTS[i - 1].title)}</em>`
      : isNew
        ? '<em class="mo-chip new">NEW</em>'
        : got === 3
          ? '<em class="mo-chip done">DONE</em>'
          : '';
    return `<button class="mo-card ${open ? '' : 'locked'} ${mo.id === hl ? 'hl' : ''}" data-a="pick" data-id="${mo.id}" ${open ? '' : 'disabled'} aria-label="${esc(mo.title)}: ${esc(mo.brief)}">
        <i class="mo-icon" aria-hidden="true">${mo.icon}</i>
        <span class="mo-body"><b>${i + 1}. ${esc(mo.title)}</b><small>${esc(mo.brief)}</small>${chip}</span>
        ${starsHtml(got)}
      </button>`;
  }).join('');
  scr.render(
    `${topBar('MENU', 'MOMENTS', `SHORT CHALLENGES${sep()}${tot.got}/${tot.of} STARS`, app.save.coins)}
    <p class="mc-hint">15–90 seconds of play each. Three stars a moment: +${momentXp(0)} XP a try, +${MOMENT_XP_PER_STAR} XP a star. Retry as often as you like.</p>
    <div class="mo-list">${cards}</div>`,
    {
      back,
      pick: (el) => {
        const mo = MOMENTS.find((m) => m.id === el.dataset.id);
        if (mo && momentUnlocked(mo.id, best)) preplayScreen(app, scr, mo, back);
      },
    },
  );
  scr.panel.querySelector<HTMLElement>('.mo-card.hl')?.scrollIntoView({ block: 'nearest' });
}

// ------------------------------------------------------------------ the pre-play card

const DIFF = ['EASY', 'NORMAL', 'HARD', 'LEGEND'];

function preplayScreen(app: AppContext, scr: MetaScreen, mo: Moment, back: () => void): void {
  const got = momentStars(app.save, mo.id);
  const rules = starRules(mo.spec);
  const clubs = mo.home !== undefined && mo.away !== undefined
    ? `<span class="mc-chip div">${esc(PRESET_CLUBS[mo.home].name.toUpperCase())} v ${esc(PRESET_CLUBS[mo.away].name.toUpperCase())}</span>`
    : '';
  const hs = mo.spec.humanSide;
  const facts = [
    `${mo.spec.seconds} SECONDS`,
    DIFF[mo.spec.difficulty ?? mo.difficulty] ?? 'NORMAL',
    mo.spec.mode === 'blitz' ? 'BLITZ' : '',
    mo.spec.score[0] || mo.spec.score[1] ? `FROM ${mo.spec.score[hs]}–${mo.spec.score[hs === 0 ? 1 : 0]}` : '',
  ].filter(Boolean);
  scr.render(
    `${topBar('MOMENTS', esc(mo.title), `MOMENT ${MOMENTS.indexOf(mo) + 1} OF ${MOMENTS.length}`, app.save.coins)}
    <div class="mo-pre">
      <div class="mo-prehead"><i class="mo-icon big" aria-hidden="true">${mo.icon}</i><div><p class="mo-brief">${esc(mo.brief)}</p><p class="mo-facts">${facts.map(esc).join(sep())}</p>${clubs}</div></div>
      <ul class="mo-rules" aria-label="Star rules">
        ${rules.map((r, i) => `<li class="${got > i ? 'got' : ''}">${starsHtml(i + 1, false)}<span>${esc(r.charAt(0).toUpperCase() + r.slice(1))}</span></li>`).join('')}
      </ul>
      <p class="mo-tip"><b>HOW</b> ${esc(fillKeys(mo.tip))}</p>
      <div class="mo-best">${got ? `BEST ${starsHtml(got)}` : 'NOT YET PLAYED'}${sep()}${esc(mo.xpNote)}</div>
    </div>
    <div class="btn-row no-stick">
      <button class="btn btn-white" data-a="back">◀ BACK</button>
      <button class="btn btn-go btn-lg mo-play pulse" data-a="play">PLAY</button>
    </div>`,
    {
      back: () => listScreen(app, scr, mo.id, back),
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
}

// ------------------------------------------------------------------ style (only what the meta panel doesn't have)

let cssDone = false;
function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'mo-css';
  s.textContent = `
.mo-list { display: grid; gap: 10px; }
.mo-card { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; text-align: left; font: inherit; color: var(--ink); background: #fff; border: 3px solid var(--ink); box-shadow: 0 5px 0 var(--cream-2); cursor: pointer; }
.mo-card:active { transform: translateY(3px); box-shadow: 0 2px 0 var(--cream-2); }
.mo-card:focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
.mo-card.hl { border-color: var(--blue); box-shadow: 0 5px 0 var(--blue-d); }
.mo-card.locked { opacity: 0.55; cursor: default; }
.mo-card.locked:active { transform: none; box-shadow: 0 5px 0 var(--cream-2); }
.mo-icon { display: grid; place-items: center; width: 48px; height: 48px; font: 400 26px/1 var(--round); font-style: normal; background: var(--cream-2); border: 3px solid var(--ink); }
.mo-icon.big { width: 64px; height: 64px; font-size: 34px; }
.mo-body { display: grid; gap: 3px; min-width: 0; }
.mo-body b { font: 700 15px var(--px); letter-spacing: 0.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mo-body small { font: 400 14px/1.25 var(--round); color: var(--ink-2); }
.mo-chip { justify-self: start; font: 400 12px var(--round); font-style: normal; letter-spacing: 1px; padding: 2px 6px 1px; color: #fff; background: var(--blue-d); }
.mo-chip.new { background: var(--go-d); }
.mo-chip.done { background: var(--yellow-d); }
.mo-chip.lock { background: var(--ink-2); }
.mo-stars { display: inline-flex; gap: 1px; font: 400 20px/1 var(--round); color: var(--cream-2); text-shadow: 0 2px 0 rgba(0,0,0,0.12); white-space: nowrap; }
.mo-stars i { font-style: normal; }
.mo-stars i.on { color: var(--yellow); text-shadow: 0 2px 0 var(--yellow-d); }
.mo-pre { display: grid; gap: 12px; background: #fff; border: 3px solid var(--ink); box-shadow: 0 5px 0 var(--cream-2); padding: 12px; }
.mo-prehead { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 12px; align-items: center; }
.mo-prehead > div { display: grid; gap: 6px; min-width: 0; justify-items: start; }
.mo-brief { margin: 0; font: 400 18px/1.25 var(--round); }
.mo-facts { margin: 0; font: 400 14px var(--round); letter-spacing: 1px; color: var(--ink-2); }
.mo-rules { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.mo-rules li { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; font: 400 15px/1.25 var(--round); padding: 4px 8px; background: var(--cream); border: 2px solid var(--cream-2); }
.mo-rules li.got { border-color: var(--yellow); }
.mo-rules .mo-stars { font-size: 16px; }
.mo-tip { margin: 0; font: 400 14px/1.35 var(--round); color: var(--ink-2); }
.mo-tip b { color: var(--blue-d); letter-spacing: 1px; margin-right: 4px; }
.mo-best { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font: 400 14px var(--round); letter-spacing: 1px; color: var(--ink-2); }
.mo-best .mo-stars { font-size: 16px; }
.mo-play { flex: 1 1 auto; }
.mo-screen .btn-row { display: flex; gap: 10px; }
@media (max-width: 420px) {
  .mo-card { grid-template-columns: 40px minmax(0, 1fr); }
  .mo-icon { width: 40px; height: 40px; font-size: 22px; }
  .mo-card .mo-stars { grid-column: 2; justify-self: start; font-size: 16px; }
}
@media (max-height: 420px) {
  .mo-prehead { grid-template-columns: 48px minmax(0, 1fr); }
  .mo-icon.big { width: 48px; height: 48px; font-size: 26px; }
  .mo-rules { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .mo-rules li { grid-template-columns: 1fr; gap: 2px; font-size: 13px; }
}
`;
  document.head.appendChild(s);
}
