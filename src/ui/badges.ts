/**
 * The BADGES screen, three tabs:
 * - BADGES: the five mastery tracks (meta/mastery.ts) with a progress bar, the five tiers lit, the next tier's
 *   reward and a CLAIM button for tiers reached but not paid.
 * - SEASON: this month's 30-tier track (meta/season.ts): theme, days left, the XP bar, and a grid of tiers to
 *   CLAIM (every 5th a bigger prize and a season title), plus last season's unclaimed coins if any.
 * - TITLES: every title earned (badge tiers, Club Run milestones, season tiers); tap one to wear it.
 * Everything here is earned by playing. Chunky style: the meta panel (ui/club.ts mountMeta) plus the rules below,
 * injected once (never style.css). Fits 375×667, 667×375 and desktop.
 */
import type { AppContext } from '../app';
import { sfx } from '../audio/sfx';
import { levelOf, levelTitle } from '../core/save';
import {
  MASTERY_TIERS, MASTERY_TRACKS, TIER_NAMES, TRACK_INFO, badgePending, claimAll, claimMastery, masteryOf,
  earnedTitles, tierReward, trackProgress, wearTitle, wornTitle, type MasteryState, type MasteryTrack,
} from '../meta/mastery';
import {
  SEASON_TIERS, claimCarry, claimSeasonTier, rollSeason, seasonOf, seasonDaysLeft, seasonName, seasonProgress,
  seasonReward, seasonTheme, seasonTier, type SeasonState,
} from '../meta/season';
import { gameCenterReady, showGameCenterAchievements } from '../platform/gameCenter';
import { closeMeta, esc, fmt, mountMeta, topBar, type MetaScreen } from './club';
import { pixelIcon } from './menus';
import { maskIcon } from './run';

export type BadgesTab = 'badges' | 'season' | 'titles';

const TRACK_ICON: { [k in MasteryTrack]: string } = {
  finisher: 'target', playmaker: 'pass', wall: 'wall', magician: 'spark', keeper: 'glove',
};

function mastery(app: AppContext): MasteryState {
  return masteryOf(app.save);
}

function season(app: AppContext): SeasonState {
  return seasonOf(app.save);
}

/** The BADGES screen (mastery badges, the season track, titles). `tab` picks the first tab shown. */
export function openBadges(app: AppContext, onBack: () => void, tab: BadgesTab = 'badges'): void {
  ensureCss();
  const scr = mountMeta(app, 'bd-screen');
  const back = (): void => {
    closeMeta();
    onBack();
  };
  // A month that ended while the game was open rolls over here (its unclaimed coins carry into `carry`).
  if (rollSeason(season(app))) app.persist();
  render(app, scr, back, tab);
}

function render(app: AppContext, scr: MetaScreen, back: () => void, tab: BadgesTab): void {
  const pending = badgePending(app.save);
  const m = mastery(app);
  const tiers = MASTERY_TRACKS.reduce((n, k) => n + trackProgress(m, k).tier, 0);
  const sub = pending ? `${pending} TO CLAIM` : `${tiers} OF ${MASTERY_TRACKS.length * MASTERY_TIERS} BADGE TIERS`;
  const tabs: [BadgesTab, string][] = [['badges', 'BADGES'], ['season', 'SEASON'], ['titles', 'TITLES']];
  const dot = (k: BadgesTab): string => {
    const n = k === 'badges' ? MASTERY_TRACKS.reduce((x, t) => x + trackProgress(m, t).claimable, 0) : k === 'season' ? badgePending(app.save) - MASTERY_TRACKS.reduce((x, t) => x + trackProgress(m, t).claimable, 0) : 0;
    return n > 0 ? `<i class="bd-dot" aria-label="${n} to claim">${n}</i>` : '';
  };
  const body = tab === 'season' ? seasonHtml(app) : tab === 'titles' ? titlesHtml(app) : badgesHtml(app);
  scr.render(
    `${topBar('MENU', 'BADGES', sub, app.save.coins)}
    <div class="seg mc-tabs bd-tabs">${tabs.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-a="tab" data-v="${k}">${l}${dot(k)}</button>`).join('')}</div>
    ${body}
    ${tab === 'badges' && gameCenterReady() ? '<div class="btn-row no-stick"><button class="btn btn-white" data-a="gc">GAME CENTER ACHIEVEMENTS</button></div>' : ''}
    ${pending ? `<div class="btn-row"><button class="btn btn-yellow btn-lg pulse bd-all" data-a="all">CLAIM ALL (${pending})</button></div>` : ''}`,
    {
      back,
      gc: () => void showGameCenterAchievements(),
      tab: (el) => render(app, scr, back, (el.dataset.v as BadgesTab) ?? 'badges'),
      claimTrack: (el) => {
        const k = el.dataset.k as MasteryTrack;
        const got = claimMastery(m, k);
        if (got.coins > 0) paid(app, scr, got.coins, got.tiers.length === 1 ? `${TRACK_INFO[k].name} ${TIER_NAMES[got.tiers[0].tier - 1]}` : `${got.tiers.length} TIERS`);
        render(app, scr, back, tab);
      },
      tier: (el) => {
        const t = Number(el.dataset.t);
        const s = season(app);
        const coins = claimSeasonTier(s, t);
        if (coins > 0) {
          const title = seasonReward(t, s.id).title;
          paid(app, scr, coins, title ? `TITLE: ${title.toUpperCase()}` : `TIER ${t}`);
          render(app, scr, back, tab);
        } else {
          const rw = seasonReward(t, s.id);
          const state = s.claimed.includes(t) ? 'CLAIMED' : `REACH IT FOR ${fmt(rw.coins)} COINS`;
          scr.toast(`TIER ${t}: ${rw.title ? `${rw.title.toUpperCase()}, ` : ''}${state}`);
        }
      },
      carry: () => {
        const coins = claimCarry(season(app));
        if (coins > 0) paid(app, scr, coins, 'LAST SEASON');
        render(app, scr, back, tab);
      },
      all: () => {
        const coins = claimAll(app.save);
        if (coins > 0) {
          app.persist();
          sfx.coin();
          scr.toast(`+${fmt(coins)} COINS`, 'good');
        }
        render(app, scr, back, tab);
      },
      wear: (el) => {
        if (wearTitle(app.save, el.dataset.v ?? '')) {
          app.persist();
          scr.toast(el.dataset.v ? `WEARING: ${el.dataset.v.toUpperCase()}` : 'WEARING YOUR LEVEL TITLE', 'good');
        }
        render(app, scr, back, tab);
      },
    },
  );
}

/** Coins claimed: bank them, save, and say so. */
function paid(app: AppContext, scr: MetaScreen, coins: number, what: string): void {
  app.save.coins += coins;
  app.persist();
  sfx.coin();
  scr.toast(`+${fmt(coins)} COINS${what ? `  ${what}` : ''}`, 'good');
}

// ------------------------------------------------------------------ badges

function badgesHtml(app: AppContext): string {
  const m = mastery(app);
  const cards = MASTERY_TRACKS.map((k) => {
    const info = TRACK_INFO[k];
    const p = trackProgress(m, k);
    const pips = TIER_NAMES.map((n, i) => `<i class="${i < p.tier ? 'on' : ''} ${i < m.claimed[k] ? 'paid' : ''}" title="Tier ${n}">${n}</i>`).join('');
    const nextRw = p.next !== null ? tierReward(k, p.tier + 1) : null;
    const next = nextRw
      ? `<p class="bd-next"><span>TIER ${TIER_NAMES[p.tier]}</span><em><i class="bd-coin"></i>${fmt(nextRw.coins)}</em><em>${esc(nextRw.title.toUpperCase())}</em></p>`
      : '<p class="bd-next done"><span>MAXED</span> EVERY TIER EARNED</p>';
    const claim = p.claimable
      ? `<button class="btn btn-yellow bd-claim pulse" data-a="claimTrack" data-k="${k}">CLAIM ${fmt(claimCoins(k, m))}</button>`
      : '';
    const count = p.next !== null ? `${fmt(p.count)} / ${fmt(p.next)} ${info.unit}` : `${fmt(p.count)} ${info.unit}`;
    return `<div class="bd-track ${p.claimable ? 'ready' : ''}" style="--c:${info.color}">
      <span class="bd-ic">${maskIcon(TRACK_ICON[k], '#fff', 3)}</span>
      <div class="bd-body">
        <div class="bd-head"><b>${info.name}</b><span class="bd-pips" aria-label="Tier ${p.tier} of ${MASTERY_TIERS}">${pips}</span></div>
        <small>${esc(info.how)}</small>
        <div class="bd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.frac * 100)}"><i style="width:${(p.frac * 100).toFixed(1)}%"></i><span>${count}</span></div>
        ${next}
      </div>
      ${claim}
    </div>`;
  }).join('');
  return `<p class="mc-hint">Every match you play counts. Each tier pays coins and a title you can wear.</p>
    <div class="bd-list">${cards}</div>`;
}

function claimCoins(k: MasteryTrack, m: MasteryState): number {
  const p = trackProgress(m, k);
  let c = 0;
  for (let t = m.claimed[k] + 1; t <= p.tier; t++) c += tierReward(k, t).coins;
  return c;
}

// ------------------------------------------------------------------ season

function seasonHtml(app: AppContext): string {
  const s = season(app);
  const th = seasonTheme(s.id);
  const p = seasonProgress(s);
  const days = seasonDaysLeft();
  const reached = seasonTier(s.xp);
  const tiles: string[] = [];
  for (let t = 1; t <= SEASON_TIERS; t++) {
    const rw = seasonReward(t, s.id);
    const got = s.claimed.includes(t);
    const ready = !got && t <= reached;
    const cls = ['bd-tile', got ? 'got' : ready ? 'ready' : 'lock', rw.title ? 'big' : ''].join(' ');
    const label = `Tier ${t}: ${rw.coins} coins${rw.title ? ` and the title ${rw.title}` : ''}${got ? ', claimed' : ready ? ', ready to claim' : ''}`;
    tiles.push(`<button class="${cls}" data-a="tier" data-t="${t}" aria-label="${esc(label)}">
      <b>${t}</b>
      ${rw.title ? `<span class="bd-star">${pixelIcon('star', got ? '#26262e' : '#c7970f', 1.6)}</span>` : ''}
      <span class="bd-coins">${got ? maskIcon('tick', '#238a3b', 1.6) : `<i class="bd-coin"></i>${rw.coins}`}</span>
      ${ready ? '<em>CLAIM</em>' : ''}
    </button>`);
  }
  const bar = p.need
    ? `<div class="bd-bar big"><i style="width:${((p.into / p.need) * 100).toFixed(1)}%"></i><span>${fmt(p.into)} / ${fmt(p.need)} XP TO TIER ${p.tier + 1}</span></div>`
    : '<div class="bd-bar big"><i style="width:100%"></i><span>ALL 30 TIERS REACHED</span></div>';
  const carry = s.carry
    ? `<div class="mc-notice bd-carry"><p><b>${esc(seasonName(s.carry.id))}</b> left ${fmt(s.carry.coins)} coins unclaimed.</p><button class="btn btn-go" data-a="carry">CLAIM</button></div>`
    : '';
  const ranks = [5, 10, 15, 20, 25, 30].map((t) => seasonReward(t, s.id).title ?? '').map((x) => esc(x.split(' ').pop() ?? '')).join(', ');
  return `<div class="bd-season" style="--c:${th.color}">
      <div class="bd-shead"><b>${esc(th.name.toUpperCase())}</b><small>${seasonName(s.id)}</small><small class="bd-days">${days === 1 ? 'LAST DAY' : `${days} DAYS LEFT`}</small></div>
      <div class="bd-stier"><span>TIER</span><b>${p.tier}</b><small>OF ${SEASON_TIERS}</small></div>
      ${bar}
    </div>
    <p class="mc-hint">All the XP you earn counts. A new season starts on the 1st: nothing you reached is lost.</p>
    ${carry}
    <div class="bd-grid">${tiles.join('')}</div>
    <p class="bd-legend">${pixelIcon('star', '#c7970f', 1.6)} Every 5th tier: a bigger prize and a season title (${esc(th.name)} ${ranks}).</p>`;
}

// ------------------------------------------------------------------ titles

function titlesHtml(app: AppContext): string {
  const list = earnedTitles(app.save);
  const worn = wornTitle(app.save);
  const lvl = levelTitle(levelOf(app.save.progress.xp).level);
  const seen = new Set<string>();
  const items = list.filter((e) => (seen.has(e.title) ? false : (seen.add(e.title), true))).map((e) => `<button class="bd-title ${e.title === worn ? 'on' : ''}" data-a="wear" data-v="${esc(e.title)}" aria-pressed="${e.title === worn}">
      <b>${esc(e.title)}</b><small>${esc(e.from)}</small>
    </button>`).join('');
  return `<p class="mc-hint">${list.length ? 'Tap a title to wear it.' : 'No titles yet.'} Titles come from badge tiers, Club Run milestones and every 5th season tier.</p>
    <div class="bd-titles">
      <button class="bd-title lvl ${worn ? '' : 'on'}" data-a="wear" data-v="" aria-pressed="${!worn}"><b>${esc(lvl)}</b><small>LEVEL TITLE</small></button>
      ${items}
    </div>`;
}

// ------------------------------------------------------------------ style (only what the meta panel doesn't have)

let cssDone = false;
function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'bd-css';
  s.textContent = `
.bd-screen .panel.mc { gap: 12px; }
.bd-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.bd-tabs button { position: relative; }
.bd-dot { position: absolute; top: -6px; right: -4px; display: grid; place-items: center; min-width: 22px; height: 22px; padding: 0 5px; font: 700 12px var(--px); font-style: normal; color: #fff; background: var(--red); border: 2px solid var(--ink); }
.bd-list { display: grid; gap: 10px; }
@media (min-width: 820px) {
  .bd-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .bd-grid { grid-template-columns: repeat(10, minmax(0, 1fr)); }
}
.bd-track { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: center; gap: 12px; padding: 10px 12px; background: #fff; border: 3px solid var(--ink); box-shadow: 0 5px 0 var(--cream-2); }
.bd-track.ready { box-shadow: 0 5px 0 var(--yellow-d); border-color: var(--ink); background: #fffbe8; }
.bd-ic { display: grid; place-items: center; width: 52px; height: 52px; background: var(--c); border: 3px solid var(--ink); box-shadow: inset -4px -4px 0 rgba(0,0,0,0.2), inset 4px 4px 0 rgba(255,255,255,0.22); }
.bd-body { display: grid; gap: 4px; min-width: 0; }
.bd-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.bd-head b { font: 700 15px var(--px); letter-spacing: 1px; }
.bd-body > small { font: 400 14px/1.25 var(--round); color: var(--ink-2); }
.bd-pips { display: inline-flex; gap: 3px; }
.bd-pips i { display: grid; place-items: center; min-width: 26px; height: 20px; padding: 0 3px; font: 700 10px var(--px); font-style: normal; color: #b9b5aa; background: var(--cream); border: 2px solid var(--cream-2); }
.bd-pips i.on { color: #fff; background: var(--c); border-color: var(--ink); }
.bd-bar { position: relative; height: 22px; background: var(--cream-2); border: 2px solid var(--ink); overflow: hidden; }
.bd-bar i { position: absolute; inset: 0 auto 0 0; background: var(--c); box-shadow: inset 0 -4px 0 rgba(0,0,0,0.18); }
.bd-bar span { position: relative; display: block; text-align: center; font: 400 13px/18px var(--round); letter-spacing: 1px; color: var(--ink); text-shadow: 0 0 3px #fff, 0 0 2px #fff, 0 1px 0 #fff; }
.bd-bar.big { height: 28px; }
.bd-bar.big span { font-size: 14px; line-height: 24px; }
.bd-next { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; font: 400 13px var(--round); letter-spacing: 0.5px; color: var(--ink-2); }
.bd-next span { font-size: 11px; letter-spacing: 1px; color: #fff; background: var(--ink-2); padding: 2px 6px 1px; }
.bd-next em { display: inline-flex; align-items: center; gap: 4px; font-style: normal; font-size: 13px; color: var(--ink); background: var(--cream); border: 2px solid var(--cream-2); padding: 1px 6px 0; }
.bd-next.done span { background: var(--go-d); }
.panel .bd-claim { grid-column: 1 / -1; padding: 10px 14px 8px; font-size: 14px; min-height: 42px; }
.bd-season { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px 14px; align-items: center; padding: 12px; color: #fff; background: var(--c); border: 3px solid var(--ink); box-shadow: 0 5px 0 rgba(38,38,46,0.35), inset 0 -6px 0 rgba(0,0,0,0.16); }
.bd-shead { display: grid; gap: 4px; min-width: 0; }
.bd-shead b { font: 700 clamp(18px, 3vw, 28px) var(--px); letter-spacing: 1.5px; text-shadow: 0 3px 0 rgba(0,0,0,0.3); }
.bd-shead small { font: 400 14px var(--round); letter-spacing: 1px; }
.bd-shead .bd-days { justify-self: start; color: var(--ink); background: #fff; padding: 2px 7px 1px; border: 2px solid var(--ink); }
.bd-stier { display: grid; justify-items: center; padding: 6px 12px; background: rgba(0,0,0,0.22); border: 2px solid rgba(0,0,0,0.35); }
.bd-stier span, .bd-stier small { font: 400 11px var(--round); letter-spacing: 1px; }
.bd-stier b { font: 700 28px/1 var(--px); }
.bd-season .bd-bar { grid-column: 1 / -1; --c: var(--yellow); background: rgba(255,255,255,0.85); }
.bd-carry { gap: 10px; }
.bd-carry p { font-size: 15px; }
.bd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); gap: 8px; }
.bd-tile { position: relative; display: grid; justify-items: center; align-content: center; gap: 2px; min-height: 64px; padding: 6px 2px 5px; font: inherit; color: var(--ink); background: #fff; border: 3px solid var(--ink); box-shadow: 0 4px 0 var(--cream-2); cursor: pointer; }
.bd-tile b { font: 700 14px var(--px); }
.bd-tile.lock { opacity: 0.6; background: var(--cream); }
.bd-tile.big { border-color: var(--yellow-d); }
.bd-tile.big.lock { opacity: 0.8; }
.bd-tile.ready { background: var(--yellow); box-shadow: 0 4px 0 var(--yellow-d); animation: bd-bob 1.1s ease-in-out infinite; }
.bd-tile.got { background: #e6f6e9; border-color: var(--go-d); box-shadow: 0 4px 0 rgba(35,138,59,0.3); }
.bd-tile em { font: 700 9px var(--px); font-style: normal; letter-spacing: 0.5px; color: #fff; background: var(--ink); padding: 1px 4px 0; }
.bd-tile:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--cream-2); }
.bd-tile:focus-visible, .bd-title:focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
.bd-star { position: absolute; top: 3px; right: 3px; line-height: 0; }
.bd-coins { display: inline-flex; align-items: center; gap: 3px; font: 400 13px var(--round); line-height: 1; }
.bd-coin { display: inline-block; width: 11px; height: 11px; background: var(--yellow); box-shadow: inset -2px -2px 0 var(--yellow-d), inset 2px 2px 0 #fff3b0; border: 1px solid var(--ink); }
@keyframes bd-bob { 50% { transform: translateY(-2px); } }
.bd-legend { margin: 0; display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; font: 400 14px/1.3 var(--round); color: var(--ink-2); text-align: center; }
.bd-titles { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.bd-title { display: grid; gap: 2px; text-align: left; padding: 10px 12px; font: inherit; color: var(--ink); background: #fff; border: 3px solid var(--ink); box-shadow: 0 4px 0 var(--cream-2); cursor: pointer; min-width: 0; }
.bd-title b { font: 400 17px var(--round); letter-spacing: 0.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bd-title small { font: 400 12px var(--round); letter-spacing: 1px; color: var(--ink-2); }
.bd-title.on { background: var(--blue); color: #fff; border-color: var(--blue-d); box-shadow: 0 4px 0 var(--blue-d); }
.bd-title.on small { color: #dbe8ff; }
.bd-screen .btn-row { display: flex; }
.bd-screen .btn-row .bd-all { flex: 1 1 auto; }
@media (max-width: 520px) {
  .bd-track { grid-template-columns: 44px minmax(0, 1fr); gap: 10px; padding: 10px; }
  .bd-ic { width: 44px; height: 44px; }
  .bd-ic svg { width: 26px; height: 26px; }
  .bd-pips i { min-width: 22px; }
  .bd-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
  .bd-tile { min-height: 58px; }
  .bd-titles { grid-template-columns: minmax(0, 1fr); }
}
@media (max-height: 460px) {
  .bd-grid { grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 6px; }
  .bd-tile { min-height: 54px; }
  .bd-season { padding: 8px 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .bd-tile.ready { animation: none; }
}
`;
  document.head.appendChild(s);
}
