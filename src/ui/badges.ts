/**
 * The SEASON and BADGES screen (the hub's SEASON tile), three tabs:
 * - SEASON: this month's 30-tier track (meta/season.ts) in purple and gold: theme, TIER n OF 30, the XP bar, days
 *   left, what is waiting; the CLUB PASS offer where the app sells it (its price on the button); then the tiers in
 *   bands of ten, the FREE row over the PASS row (every 5th a bigger prize and a season title), plus last season's
 *   unclaimed coins and looks if any.
 * - BADGES: the five mastery tracks (meta/mastery.ts) with a progress bar, the five tiers lit, the next tier's
 *   reward and a CLAIM button for tiers reached but not paid.
 * - TITLES: every title earned (badge tiers, Club Run milestones, season tiers); tap one to wear it.
 * The free track, badges and titles are earned by playing; the pass track needs the Club Pass. Chunky style: the meta panel (ui/club.ts mountMeta) plus the rules below,
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
  PASS_BIG_COINS, SEASON_TIERS, claimCarry, claimSeasonTier, passReward, rollSeason, seasonOf, seasonDaysLeft, seasonName, seasonPending,
  seasonProgress, seasonReward, seasonTheme, seasonTier, type SeasonState,
} from '../meta/season';
import { claimAllPass, claimCarryItems, claimPassTier, passTotals } from '../meta/pass';
import { gameCenterReady, showGameCenterAchievements, showGameCenterLeaderboards } from '../platform/gameCenter';
import { buzz } from '../platform/haptics';
import { PRODUCT_PASS, iap } from '../platform/iap';
import { closeMeta, esc, fmt, mountMeta, topBar, type MetaScreen } from './club';
import { pixelIcon } from './menus';
import { maskIcon } from './run';
import { STORE_NOT_READY } from './shop';

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
  const sub = pending
    ? `${pending} ${pending === 1 ? 'REWARD' : 'REWARDS'} TO CLAIM`
    : tab === 'season' ? `TIER ${seasonTier(season(app).xp)} OF ${SEASON_TIERS}` : `${tiers} OF ${MASTERY_TRACKS.length * MASTERY_TIERS} BADGE TIERS`;
  // SEASON first: the hub's SEASON tile opens here.
  const tabs: [BadgesTab, string][] = [['season', 'SEASON'], ['badges', 'BADGES'], ['titles', 'TITLES']];
  const title = tab === 'season' ? 'SEASON' : tab === 'titles' ? 'TITLES' : 'BADGES';
  const dot = (k: BadgesTab): string => {
    const n = k === 'badges' ? MASTERY_TRACKS.reduce((x, t) => x + trackProgress(m, t).claimable, 0) : k === 'season' ? badgePending(app.save) - MASTERY_TRACKS.reduce((x, t) => x + trackProgress(m, t).claimable, 0) : 0;
    return n > 0 ? `<i class="bd-dot" aria-label="${n} to claim">${n}</i>` : '';
  };
  const body = tab === 'season' ? seasonHtml(app) : tab === 'titles' ? titlesHtml(app) : badgesHtml(app);
  scr.render(
    `${topBar('MENU', title, sub, app.save.coins)}
    <div class="seg mc-tabs bd-tabs">${tabs.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-a="tab" data-v="${k}">${l}${dot(k)}</button>`).join('')}</div>
    ${body}
    ${tab === 'badges' && gameCenterReady() ? '<div class="btn-row no-stick"><button class="btn btn-white" data-a="gc">GAME CENTER ACHIEVEMENTS</button><button class="btn btn-white" data-a="gcBoards">LEADERBOARDS</button></div>' : ''}
    ${pending ? `<div class="btn-row"><button class="btn btn-yellow btn-lg pulse bd-all" data-a="all">CLAIM ALL (${pending})</button></div>` : ''}`,
    {
      back,
      gc: () => void showGameCenterAchievements(),
      gcBoards: () => void showGameCenterLeaderboards(),
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
      ptier: (el) => {
        const t = Number(el.dataset.t);
        const s = season(app);
        if (!s.pass) {
          scr.toast(iap.storefront ? 'GET THE CLUB PASS TO CLAIM THIS TIER' : 'THE CLUB PASS IS IN THE IPHONE AND IPAD APP', 'info');
          return;
        }
        const got = claimPassTier(app.save, t);
        if (got.coins > 0) paid(app, scr, got.coins, `PASS TIER ${t}`);
        if (got.items.length) {
          app.persist();
          sfx.coin();
          buzz('success');
          scr.toast('NEW LOOK: EQUIP IT IN THE SHOP', 'good');
        }
        if (!got.coins && !got.items.length) scr.toast(t > seasonTier(s.xp) ? `REACH TIER ${t} TO CLAIM IT` : `PASS TIER ${t} CLAIMED`, 'info');
        render(app, scr, back, tab);
      },
      // The Club Pass, bought here: the store's own sheet confirms it; a store not ready yet says so (nothing charged).
      passBuy: async (el) => {
        if (!iap.canSell(PRODUCT_PASS)) {
          scr.toast(STORE_NOT_READY, 'info');
          return;
        }
        (el as HTMLButtonElement).disabled = true;
        const r = await iap.buy(PRODUCT_PASS);
        if (r === 'ok') {
          sfx.coin();
          buzz('success');
          scr.toast('CLUB PASS ON: CLAIM YOUR PASS TIERS', 'good');
        } else if (r === 'pending') scr.toast('WAITING FOR THE STORE. THE PASS SWITCHES ON WHEN IT CONFIRMS', 'info');
        else if (r === 'failed') scr.toast('THAT DID NOT GO THROUGH. TRY AGAIN IN A MOMENT', 'bad');
        render(app, scr, back, 'season');
      },
      pcarry: () => {
        const items = claimCarryItems(app.save);
        if (items.length) {
          app.persist();
          sfx.coin();
          buzz('success');
          scr.toast(items.length === 1 ? 'NEW LOOK: EQUIP IT IN THE SHOP' : `${items.length} NEW LOOKS: EQUIP THEM IN THE SHOP`, 'good');
        }
        render(app, scr, back, tab);
      },
      carry: () => {
        const coins = claimCarry(season(app));
        if (coins > 0) paid(app, scr, coins, 'LAST SEASON');
        render(app, scr, back, tab);
      },
      all: () => {
        // (claimAll pays its own coins into the wallet; the pass's are returned, so they're paid here.)
        const pass = claimAllPass(app.save);
        app.save.coins += pass.coins;
        const coins = claimAll(app.save) + pass.coins;
        if (coins > 0 || pass.items.length) {
          app.persist();
          sfx.coin();
          buzz('success');
          scr.toast(`+${fmt(coins)} COINS${pass.items.length ? ' AND NEW LOOKS: EQUIP THEM IN THE SHOP' : ''}`, 'good');
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
  buzz('success');
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

/**
 * The SEASON tab: a purple and gold header (this month's theme, TIER n OF 30, the XP bar, days left, what is
 * waiting), the CLUB PASS offer where this build sells it (the app; the price on the button buys it at once),
 * then the track in bands of ten tiers: the tier numbers, the FREE row and the PASS row under it (locked until
 * the pass is on). A reached tier waiting to be claimed glows gold and says CLAIM.
 */
function seasonHtml(app: AppContext): string {
  const s = season(app);
  const th = seasonTheme(s.id);
  const p = seasonProgress(s);
  const days = seasonDaysLeft();
  const waiting = seasonPending(s);
  const sells = iap.storefront;
  const bar = p.need
    ? `<div class="bd-bar big" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((p.into / p.need) * 100)}"><i style="width:${((p.into / p.need) * 100).toFixed(1)}%"></i><span>${fmt(p.into)} / ${fmt(p.need)} XP TO TIER ${p.tier + 1}</span></div>`
    : '<div class="bd-bar big"><i style="width:100%"></i><span>ALL 30 TIERS REACHED</span></div>';
  const carry = s.carry
    ? `<div class="mc-notice bd-carry"><p><b>${esc(seasonName(s.carry.id))}</b> left ${fmt(s.carry.coins)} coins unclaimed.</p><button class="btn btn-go" data-a="carry">CLAIM</button></div>`
    : '';
  const carried = s.carryItems.length
    ? `<div class="mc-notice bd-carry"><p>Last month's Club Pass left ${s.carryItems.length === 1 ? 'a look' : `${s.carryItems.length} looks`} unclaimed.</p><button class="btn btn-go" data-a="pcarry">CLAIM</button></div>`
    : '';
  const ranks = [5, 10, 15, 20, 25, 30].map((t) => seasonReward(t, s.id).title ?? '').map((x) => esc(x.split(' ').pop() ?? '')).join(', ');
  return `<div class="bd-season" style="--c:${th.color}">
      <div class="bd-shead">
        <small class="bd-month">${seasonName(s.id)}</small>
        <b>${esc(th.name.toUpperCase())}</b>
        <span class="bd-chips">
          <small class="bd-days">${days === 1 ? 'LAST DAY' : `${days} DAYS LEFT`}</small>
          ${s.pass ? '<small class="bd-passon">CLUB PASS ON</small>' : ''}
          ${waiting ? `<small class="bd-waiting">${waiting} TO CLAIM</small>` : ''}
        </span>
      </div>
      <div class="bd-stier"><span>TIER</span><b>${p.tier}</b><small>OF ${SEASON_TIERS}</small></div>
      ${bar}
    </div>
    ${sells && !s.pass ? passOfferHtml(app) : ''}
    ${carry}
    ${carried}
    ${trackHtml(app, s.pass || sells)}
    <p class="bd-legend">${pixelIcon('star', '#c7970f', 1.6)} Every 5th tier: a bigger prize and a season title (${esc(th.name)} ${ranks}).</p>
    <p class="mc-hint">All the XP you earn counts. A new season starts on the 1st: nothing you reached is lost.</p>`;
}

/** The CLUB PASS offer: what it adds, with real numbers, and its price on the button (the store's own sheet confirms). */
function passOfferHtml(app: AppContext): string {
  const s = season(app);
  const th = seasonTheme(s.id);
  const totals = passTotals(s.id);
  const price = iap.shelf().find((x) => x.id === PRODUCT_PASS)?.price ?? '';
  return `<div class="bd-passoffer">
      <span class="bd-po-ic" aria-hidden="true">${pixelIcon('crown', '#ffd23a', 4)}</span>
      <div class="bd-po-txt"><b>CLUB PASS</b><span>${fmt(totals.coins)} more coins and the ${esc(th.name)} trail and goal explosion, only in the pass. Tiers you have already reached unlock at once.</span></div>
      <button class="btn btn-yellow bd-po-buy" data-a="passBuy" aria-label="Get the Club Pass${price ? `, ${esc(price)}` : ''}">${price ? `GET IT ${esc(price)}` : 'GET THE PASS'}</button>
    </div>`;
}

/** The track in bands of ten tiers: tier numbers, the FREE row and (where the pass exists) the PASS row. */
function trackHtml(app: AppContext, withPass: boolean): string {
  const s = season(app);
  const th = seasonTheme(s.id);
  const reached = seasonTier(s.xp);
  const bands: string[] = [];
  for (let from = 1; from <= SEASON_TIERS; from += 10) {
    const nums: string[] = [];
    const free: string[] = [];
    const pass: string[] = [];
    for (let t = from; t < from + 10 && t <= SEASON_TIERS; t++) {
      nums.push(`<b class="bd-tn ${t <= reached ? 'on' : ''} ${t === reached + 1 ? 'next' : ''}">${t}</b>`);
      const rw = seasonReward(t, s.id);
      const got = s.claimed.includes(t);
      const ready = !got && t <= reached;
      const label = `Tier ${t}: ${rw.coins} coins${rw.title ? ` and the title ${rw.title}` : ''}${got ? ', claimed' : ready ? ', ready to claim' : ''}`;
      free.push(`<button class="bd-tile ${got ? 'got' : ready ? 'ready' : 'lock'} ${rw.title ? 'big' : ''}" data-a="tier" data-t="${t}" aria-label="${esc(label)}">
          ${rw.title ? `<span class="bd-star">${pixelIcon('star', got ? '#26262e' : '#c7970f', 1.4)}</span>` : ''}
          <span class="bd-coins">${got ? maskIcon('tick', '#238a3b', 1.6) : `<i class="bd-coin"></i>${rw.coins}`}</span>
          ${ready ? '<em>CLAIM</em>' : ''}
        </button>`);
      if (!withPass) continue;
      const pr = passReward(t, s.id);
      const pGot = s.passClaimed.includes(t);
      const pReady = s.pass && !pGot && t <= reached;
      const what = pr.item ? `the ${th.name} ${pr.item.cat === 'trail' ? 'sprint trail' : 'goal explosion'}` : `${pr.coins} coins`;
      const pLabel = `Club Pass tier ${t}: ${what}${pGot ? ', claimed' : pReady ? ', ready to claim' : s.pass ? '' : ', with the pass'}`;
      const prize = pr.item
        ? `<span class="bd-coins bd-item">${pr.item.cat === 'trail' ? 'TRAIL' : 'GOAL FX'}</span>`
        : `<span class="bd-coins">${pGot ? maskIcon('tick', '#238a3b', 1.6) : `<i class="bd-coin"></i>${pr.coins}`}</span>`;
      pass.push(`<button class="bd-tile ptile ${pGot ? 'got' : pReady ? 'ready' : 'lock'} ${pr.item || PASS_BIG_COINS[t] ? 'big' : ''}" data-a="ptier" data-t="${t}" aria-label="${esc(pLabel)}">
          ${pr.item ? `<span class="bd-star">${pixelIcon(pr.item.cat === 'trail' ? 'bolt' : 'star', pGot ? '#26262e' : '#ffd23a', 1.4)}</span>` : ''}
          ${s.pass ? '' : `<span class="bd-plock">${pixelIcon('lock', '#fff', 1.4)}</span>`}
          ${prize}
          ${pReady ? '<em>CLAIM</em>' : ''}
        </button>`);
    }
    bands.push(`<div class="bd-band ${withPass ? 'with-pass' : ''} ${s.pass ? 'pass-on' : ''}">
        <span class="bd-lab num">TIER</span>${nums.join('')}
        <span class="bd-lab free">FREE</span>${free.join('')}
        ${withPass ? `<span class="bd-lab pass">PASS</span>${pass.join('')}` : ''}
      </div>`);
  }
  return `<div class="bd-track2">${bands.join('')}</div>`;
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
.mc-tabs.bd-tabs button[data-v='season']:not(.on) { color: #fff; background: #5b2bc4; box-shadow: 0 3px 0 #3a1f78; }
.bd-dot { position: absolute; top: -6px; right: -4px; display: grid; place-items: center; min-width: 22px; height: 22px; padding: 0 5px; font: 400 13px var(--round); font-style: normal; color: #fff; background: var(--red); border: 2px solid var(--ink); }
.bd-list { display: grid; gap: 10px; }
@media (min-width: 820px) {
  .bd-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.bd-track { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: center; gap: 12px; padding: 10px 12px; background: #fff; border: 3px solid var(--ink); box-shadow: 0 5px 0 var(--cream-2); }
.bd-track.ready { box-shadow: 0 5px 0 var(--yellow-d); border-color: var(--ink); background: #fffbe8; }
.bd-ic { display: grid; place-items: center; width: 52px; height: 52px; background: var(--c); border: 3px solid var(--ink); box-shadow: inset -4px -4px 0 rgba(0,0,0,0.2), inset 4px 4px 0 rgba(255,255,255,0.22); }
.bd-body { display: grid; gap: 4px; min-width: 0; }
.bd-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.bd-head b { font: 400 17px var(--round); letter-spacing: 1px; }
.bd-body > small { font: 400 14px/1.25 var(--round); color: var(--ink-2); }
.bd-pips { display: inline-flex; gap: 3px; }
.bd-pips i { display: grid; place-items: center; min-width: 26px; height: 20px; padding: 0 3px; font: 400 11px var(--round); font-style: normal; color: #b9b5aa; background: var(--cream); border: 2px solid var(--cream-2); }
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

/* SEASON: purple and gold, the month's own colour down the left edge. */
.bd-season { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px 14px; align-items: center; padding: 12px 14px 14px; color: #fff; background: linear-gradient(120deg, #3a1f78, #5b2bc4 55%, #8a5cf6); border: 3px solid var(--ink); border-left: 10px solid var(--c); box-shadow: 0 5px 0 rgba(38,38,46,0.35), inset 0 -6px 0 rgba(0,0,0,0.18); }
.bd-shead { display: grid; gap: 4px; min-width: 0; justify-items: start; }
.bd-month { font: 400 13px var(--round); letter-spacing: 2px; color: #d9c8ff; }
.bd-shead b { font: 400 clamp(22px, 3.4vw, 34px) / 1 var(--round); letter-spacing: 1px; color: var(--yellow); text-shadow: 0 3px 0 rgba(0,0,0,0.35); }
.bd-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.bd-chips small { font: 400 13px var(--round); letter-spacing: 1px; padding: 3px 8px 2px; border: 2px solid var(--ink); }
.bd-days { color: var(--ink); background: #fff; }
.bd-passon { color: var(--ink); background: var(--yellow); }
.bd-waiting { color: #fff; background: var(--red); }
.bd-stier { display: grid; justify-items: center; padding: 8px 16px 6px; color: var(--ink); background: var(--yellow); border: 3px solid var(--ink); box-shadow: 0 4px 0 var(--yellow-d); }
.bd-stier span, .bd-stier small { font: 400 12px var(--round); letter-spacing: 1px; }
.bd-stier b { font: 400 36px/1 var(--round); }
.bd-season .bd-bar { grid-column: 1 / -1; --c: var(--yellow); background: rgba(255,255,255,0.9); }
.bd-carry { gap: 10px; }
.bd-carry p { font-size: 15px; }

/* The Club Pass offer: the price on the button. */
.bd-passoffer { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 12px; color: #fff; background: linear-gradient(120deg, #5b2bc4, #8a5cf6 60%, #b07cff); border: 3px solid #3a1f78; box-shadow: 0 5px 0 #3a1f78; }
.bd-po-ic { display: grid; place-items: center; width: 50px; height: 50px; background: #3a1f78; border: 3px solid var(--ink); }
.bd-po-txt { display: grid; gap: 2px; min-width: 0; }
.bd-po-txt b { font: 400 21px var(--round); letter-spacing: 1px; color: var(--yellow); text-shadow: 0 2px 0 rgba(0,0,0,0.3); }
.bd-po-txt span { font: 400 14px/1.3 var(--round); color: #f1eaff; }
.panel .bd-po-buy { min-height: 46px; padding: 11px 16px 9px; font-size: 16px; }

/* The track, in bands of ten tiers: the numbers, FREE, then PASS. */
.bd-track2 { display: grid; gap: 12px; }
.bd-band { display: grid; grid-template-columns: 52px repeat(10, minmax(0, 1fr)); gap: 5px; align-items: stretch; }
.bd-lab { display: grid; place-items: center; font: 400 12px var(--round); letter-spacing: 1px; color: var(--ink-2); }
.bd-lab.free { color: var(--ink); background: var(--cream-2); border: 2px solid var(--ink); }
.bd-lab.pass { color: var(--yellow); background: #5b2bc4; border: 2px solid var(--ink); }
.bd-tn { display: grid; place-items: center; height: 22px; font: 400 13px var(--round); color: var(--ink-2); background: var(--cream); border-bottom: 3px solid var(--cream-2); }
.bd-tn.on { color: #fff; background: #8a5cf6; border-bottom-color: #5b2bc4; }
.bd-tn.next { color: var(--ink); background: var(--yellow); border-bottom-color: var(--yellow-d); }
.bd-tile { position: relative; display: grid; justify-items: center; align-content: center; gap: 2px; min-height: 54px; padding: 5px 2px 4px; font: inherit; color: var(--ink); background: #fff; border: 3px solid var(--ink); box-shadow: 0 3px 0 var(--cream-2); cursor: pointer; min-width: 0; }
.bd-tile.lock { background: var(--cream); color: var(--ink-2); }
.bd-tile.big { border-color: var(--yellow-d); }
.bd-tile.ready { background: var(--yellow); box-shadow: 0 3px 0 var(--yellow-d); animation: bd-bob 1.1s ease-in-out infinite; }
.bd-tile.got { background: #e6f6e9; border-color: var(--go-d); box-shadow: 0 3px 0 rgba(35,138,59,0.3); }
.bd-tile.ptile { background: #f1eaff; border-color: #3a1f78; }
.bd-tile.ptile.big { background: #e2d3ff; }
.bd-tile.ptile.ready { background: var(--yellow); }
.bd-tile.ptile.got { background: #e6f6e9; border-color: var(--go-d); }
.bd-band:not(.pass-on) .bd-tile.ptile { background: #ddd2f5; }
.bd-plock { position: absolute; top: 3px; left: 3px; display: grid; place-items: center; width: 15px; height: 15px; background: #3a1f78; line-height: 0; }
.bd-tile em { font: 400 10px var(--round); font-style: normal; letter-spacing: 0.5px; color: #fff; background: var(--ink); padding: 1px 4px 0; }
.bd-tile:active { transform: translateY(3px); box-shadow: 0 0 0 var(--cream-2); }
.bd-tile:focus-visible, .bd-title:focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
.bd-star { position: absolute; top: 2px; right: 2px; line-height: 0; }
.bd-coins { display: inline-flex; align-items: center; gap: 3px; font: 400 13px var(--round); line-height: 1; }
.bd-item { font-size: 11px; letter-spacing: 0.5px; color: #3a1f78; }
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
  .bd-band { grid-template-columns: 40px repeat(10, minmax(34px, 1fr)); overflow-x: auto; padding-bottom: 4px; }
  .bd-passoffer { grid-template-columns: auto minmax(0, 1fr); }
  .panel .bd-po-buy { grid-column: 1 / -1; }
  .bd-titles { grid-template-columns: minmax(0, 1fr); }
}
@media (max-height: 460px) {
  .bd-tile { min-height: 46px; }
  .bd-season { padding: 8px 12px 10px; }
  .bd-stier b { font-size: 28px; }
  .bd-po-ic { width: 42px; height: 42px; }
  .bd-po-txt span { font-size: 13px; }
}
@media (prefers-reduced-motion: reduce) {
  .bd-tile.ready { animation: none; }
}
`;
  document.head.appendChild(s);
}
