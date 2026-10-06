/**
 * Transfer market (docs/UX.md): one screen on the app shell. BUY / SELL / SHORTLIST tabs; on the left the list (one
 * row of position chips and the sort chip above it, scrolling inside its own pane), on the right the selected player
 * with his action pinned at the bottom of that pane. BUY starts sorted FOR YOU (meta/forYou.ts: the biggest upgrade
 * you can afford, the weakest position first) with the top player selected, so a signing is two taps: pick, then
 * OFFER (a confirm sheet only when it would spend more than half your coins). The window, squad and wage bill ride in
 * the header; the news is a badge that opens a sheet. Rules live in meta/market.ts; this file only renders them.
 */
import type { AppContext } from '../app';
import { sfx } from '../audio/sfx';
import { BOTTOM_DIVISION, KEY_STATS, ROLES, SQUAD_MAX, STAT_SHORT, newSeason, refreshMarket, sellPlayer, sellValue, type CareerState, type ClubState } from '../meta/career';
import { canAfford, forYouSort, transferBudget, upgradeOf, type TransferBudget } from '../meta/forYou';
import {
  MORALE_DIP, RESALE_STARTS, SCOUT_COST, SHORTLIST_MAX, YOUNG_AGE,
  acceptCounter, acceptOffer, bidFor, canBid, contractOf, filterListings, listPlayer, listingById, markNewsSeen, marketSummary, marketUnread, newsStrip,
  placeBid, playerAge, playerPotential, playerValue, rejectOffer, resaleCap, resaleOfferAmount, saleFor, scoutListing, shortlisted, sortListings, toggleShortlist,
  townOf, unlistPlayer, wageOf, withdrawBid, type Listing, type MarketFail, type MetaPlayer, type NewsItem,
} from '../meta/market';
import { buzz } from '../platform/haptics';
import { overall, type Kit, type PlayerDef, type Role } from '../sim/types';
import { careerState, closeMeta, esc, failText, fmt, mountMeta, onMetaClose, openClub, ovrBadge, roleBadge, topBar, type Handlers, type InputHandlers } from './club';
import { PaneScroll, revealInPane } from './panes';
import { seasonStripHtml } from './playerCard';
import { pixelIcon } from './pixelIcons';
import { faceHtml, hydrateFaces } from './preview';
import { sep } from './text';
import { transfersTiming } from './hubInfo';
import './market.css';

export type MarketTab = 'buy' | 'sell' | 'shortlist';
type SortKey = 'foryou' | 'price' | 'ovr' | 'age';
type Pos = Role | 'ALL';

export interface MarketOpts {
  tab?: MarketTab;
  /** Where BACK goes (defaults to the main menu). */
  onBack?: () => void;
  backLabel?: string;
}

const SORTS: [SortKey, string][] = [['foryou', 'FOR YOU'], ['price', 'PRICE'], ['ovr', 'OVR'], ['age', 'AGE']];

/** An offer above this share of your coins asks once more before it goes (docs/UX.md: confirm only when it's expensive). */
const CONFIRM_SHARE = 0.5;

/** The session's market memory (docs/UX.md section 8): the tab, each tab's filter and selection, the sort, list scroll. */
const scrolls = new PaneScroll();
const memo = {
  tab: 'buy' as MarketTab,
  pos: { buy: 'ALL', sell: 'ALL', shortlist: 'ALL' } as Record<MarketTab, Pos>,
  sort: 'foryou' as SortKey,
  sel: { buy: '', sell: '', shortlist: '' } as Record<MarketTab, string>,
  idx: { buy: 0, sell: 0, shortlist: 0 } as Record<MarketTab, number>,
};

/**
 * Open the transfer market. Needs a club (otherwise it sends you to found one). A club with no season yet gets
 * its first one started here, exactly as ROAD TO GLORY would on its first visit (the market lives in the league:
 * listings come from its clubs), so the market works from MY CLUB and the SHOP before ROAD TO GLORY is ever opened.
 * Between seasons (the summary is up) it waits for ROAD TO GLORY to start the next one.
 */
export function openMarket(app: AppContext, opts: MarketOpts = {}): void {
  const st = careerState(app);
  const back =
    opts.onBack ??
    (() => {
      closeMeta();
      app.mainMenu();
    });
  const backLabel = opts.backLabel ?? 'MENU';
  if (!st.club) {
    openClub(app, { tab: 'market', onBack: opts.onBack, backLabel });
    return;
  }
  if (!st.season && !st.summary) {
    newSeason(st, BOTTOM_DIVISION, 1);
    app.persist();
  }
  if (!st.season || st.summary) {
    const scr = mountMeta(app, 'mk-screen shell');
    scr.render(
      `${topBar(backLabel, 'TRANSFERS', 'SEASON OVER', app.save.coins)}
      <div class="mc-body mk-off"><div class="mk-empty"><b>MARKET CLOSED</b><span>START THE NEXT SEASON IN ROAD TO GLORY</span></div></div>`,
      { back },
    );
    return;
  }
  // Answers to last week's offers land here too (refunds settle straight into the wallet).
  refreshMarket(st, app.save);
  // Keep unread answers until the player actually opens NEWS, rather than clearing them just by browsing players.
  const fresh = new Set<NewsItem>(st.tm.news.filter((n) => n.own && !n.seen));
  app.persist();
  if (opts.tab) memo.tab = opts.tab;
  marketScreen(app, st, st.club, back, backLabel, fresh);
}

// ------------------------------------------------------------------ bits

/** The shared fact divider (ui/text.ts): an element, never a middle-dot glyph the pixel font can't draw. */
const dot = sep();

/** Dated, escaped cards keep your own deals separate from league gossip without hiding the actual news text. */
export function marketNewsHtml(items: readonly NewsItem[], fresh: ReadonlySet<NewsItem> = new Set()): string {
  if (!items.length) return '<li class="mk-newsitem info"><p>No transfer news yet. New reports arrive after league matchdays.</p></li>';
  return items.map((n) => {
    const category = n.story ? 'CLUB STORY' : n.own ? 'YOUR CLUB' : 'LEAGUE';
    const date = `${n.season > 0 ? `SEASON ${n.season}` : 'CLUB NEWS'} / ${n.week > 0 ? `AFTER MATCHDAY ${n.week}` : 'PRE SEASON'}`;
    return `<li class="mk-newsitem ${n.kind}${n.own ? ' own' : ''}">
      <div class="mk-newsmeta"><b>${category}</b><span>${date}</span>${fresh.has(n) ? tag('new', 'NEW') : ''}</div>
      <p>${esc(n.text)}</p>
    </li>`;
  }).join('');
}

function stars(n: number): string {
  let s = `<span class="mk-stars" aria-label="${n} of 5">`;
  for (let i = 0; i < 5; i++) s += `<i class="${i < n ? 'on' : ''}"></i>`;
  return s + '</span>';
}

/** His three key stats for the role, one row of cells: the number over a bar. */
function keyStats(p: PlayerDef): string {
  return `<div class="mk-stats">${KEY_STATS[p.role]
    .map((k) => `<div class="mk-stat"><small>${STAT_SHORT[k]}</small><b>${p.stats[k]}</b><i><i style="width:${p.stats[k]}%"></i></i></div>`)
    .join('')}</div>`;
}

function tag(cls: string, text: string): string {
  return `<i class="mk-tag ${cls}">${text}</i>`;
}

function fact(label: string, value: string | number, word = false): string {
  return `<div class="mk-fact"><small>${label}</small><b${word ? ' class="word"' : ''}>${value}</b></div>`;
}

function bigOvr(n: number): string {
  return `<div class="mk-big"><small>OVR</small><b>${n}</b></div>`;
}

// ------------------------------------------------------------------ screen

function marketScreen(app: AppContext, st: CareerState, club: ClubState, back: () => void, backLabel: string, fresh: Set<NewsItem>): void {
  const scr = mountMeta(app, 'mk-screen shell');
  /** Offer slider, % of asking (per listing, so it survives re-renders). */
  const pct = new Map<string, number>();
  /** The player whose SELL NOW is armed (a second tap sells). */
  let armed = '';
  let newsBadge = fresh.size;
  /** Scroll the selected row into view after the next draw (a new tab, filter or sort, or an automatic pick). */
  let showSel = true;
  /** A new filter or sort: the list starts from its top (then the selection is brought into view). */
  let resetList = false;

  const rivalKit = (l: Listing): Kit => st.season?.rivals.find((r) => r.id === l.club)?.kit ?? club.kit;
  const say = (r: { ok: false; reason: MarketFail }) => scr.toast(failText(r.reason), 'bad');
  const coins = () => app.save.coins;
  const offerOf = (l: Listing) => Math.round((l.asking * (pct.get(l.id) ?? 100)) / 100 / 10) * 10;
  const listKey = () => `mk-list-${memo.tab}`;

  // ---- lists

  const buyList = (budget: TransferBudget): Listing[] => {
    const list = filterListings(st.tm.listings, memo.pos.buy);
    return memo.sort === 'foryou' ? forYouSort(list, club, budget) : sortListings(list, memo.sort);
  };
  const sellList = (): PlayerDef[] => (memo.pos.sell === 'ALL' ? club.squad : club.squad.filter((p) => p.role === memo.pos.sell));

  /** Keep the tab's selection while it is in the list; otherwise the row now at its place (the next one after a signing). */
  const pick = (ids: string[]): string => {
    const tab = memo.tab;
    const at = ids.indexOf(memo.sel[tab]);
    if (at >= 0) {
      memo.idx[tab] = at;
      return memo.sel[tab];
    }
    if (!ids.length) return (memo.sel[tab] = '');
    const i = Math.max(0, Math.min(memo.idx[tab], ids.length - 1));
    memo.idx[tab] = i;
    showSel = true;
    return (memo.sel[tab] = ids[i]);
  };

  // ---- header: the window, the squad, the wage bill

  const subHtml = () => {
    const s = marketSummary(st);
    const w = s.window;
    return `<b class="mk-win ${w.open ? 'open' : 'shut'}" title="${esc(transfersTiming(st)?.window ?? w.label)}"><i>WINDOW </i>${w.open ? 'OPEN' : 'SHUT'}</b>${dot}<span class="${
      s.squad >= SQUAD_MAX ? 'mk-full' : ''
    }">SQUAD ${s.squad}/${SQUAD_MAX}${s.pending ? ` +${s.pending}` : ''}</span>${dot}<span class="mk-wage${s.drain > 0 ? ' over' : ''}">WAGES ${fmt(s.wages)}/${fmt(s.budget)}</span>`;
  };

  // ---- rows

  const listingRow = (l: Listing, on: boolean, budget: TransferBudget) => {
    const p = l.player;
    const bid = bidFor(st, l.id);
    const gain = upgradeOf(club, p).gain;
    const from = l.club ? townOf(l.clubName).toUpperCase() : 'FREE';
    const t = bid
      ? tag(bid.status === 'countered' ? 'counter' : 'bid', bid.status === 'countered' ? 'COUNTER' : 'OFFER SENT')
      : l.youth
        ? tag('youth', 'YOUTH')
        : l.hot
          ? tag('hot', 'HOT')
          : '';
    const star = st.tm.shortlist.includes(l.id) ? pixelIcon('star', 'currentColor', 1.3, 'mk-starred') : '';
    return `<button class="mk-row${on ? ' sel' : ''}" data-a="sel" data-id="${esc(l.id)}" aria-pressed="${on}" aria-label="${esc(p.name)}, ${p.role}, overall ${overall(p)}, asking ${fmt(l.asking)}">
      ${faceHtml(p, rivalKit(l), 'sm')}
      ${roleBadge(p.role)}
      <span class="mk-nm"><b>${esc(p.name)}${star}</b><small>${esc(from)}${dot}${l.age}Y${t}</small></span>
      ${gain > 0 ? `<i class="mk-gain">+${gain}</i>` : '<i></i>'}
      ${ovrBadge(overall(p))}
      <b class="mk-price${canAfford(l, budget) ? '' : ' poor'}">${fmt(l.asking)}</b>
    </button>`;
  };

  const playerRow = (p: PlayerDef, on: boolean) => {
    const i = club.squad.indexOf(p);
    const sale = saleFor(st, p.id);
    const t = sale ? tag('bid', sale.offers.length ? `${sale.offers.length} OFFER${sale.offers.length > 1 ? 'S' : ''}` : 'LISTED') : '';
    return `<button class="mk-row${on ? ' sel' : ''}" data-a="sel" data-id="${esc(p.id)}" aria-pressed="${on}" aria-label="${esc(p.name)}, ${p.role}, overall ${overall(p)}, value ${fmt(playerValue(p))}">
      ${faceHtml(p, club.kit, 'sm')}
      ${roleBadge(p.role)}
      <span class="mk-nm"><b>${esc(p.name)}</b><small>${i < 11 ? 'STARTER' : 'BENCH'}${dot}${playerAge(p)}Y${t}</small></span>
      <i></i>
      ${ovrBadge(overall(p))}
      <b class="mk-price">${fmt(playerValue(p))}</b>
    </button>`;
  };

  // ---- the selected player (right pane)

  const listingDetail = (l: Listing): string => {
    const p = l.player;
    const id = esc(l.id);
    const w = marketSummary(st).window;
    const bid = bidFor(st, l.id);
    const up = upgradeOf(club, p);
    const onList = st.tm.shortlist.includes(l.id);
    const from = l.club ? esc(townOf(l.clubName).toUpperCase()) : 'FREE AGENT';
    const young = l.age <= YOUNG_AGE;
    const cmp = up.starter
      ? `<p class="mk-cmp ${up.gain > 0 ? 'up' : up.gain < 0 ? 'down' : ''}"><b>${up.gain > 0 ? '+' : up.gain < 0 ? '&minus;' : ''}${Math.abs(up.gain)} OVR</b><span>VS ${esc(up.starter.name)} ${overall(up.starter)}</span></p>`
      : `<p class="mk-cmp up"><b>NEW ${p.role}</b><span>NOBODY STARTS THERE</span></p>`;
    const starBtn = `<button class="btn btn-white mk-ic${onList ? ' on' : ''}" data-a="star" data-id="${id}" aria-pressed="${onList}" aria-label="${
      onList ? 'Take off your shortlist' : 'Add to your shortlist'
    }">${pixelIcon('star', 'currentColor', 2.2)}</button>`;
    // Potential: a young player's stars once scouted (the cell itself is the SCOUT button until then); older players peaked.
    const pot = !young
      ? fact('POT', 'PEAKED', true)
      : l.scouted
        ? fact('POT', stars(l.potential))
        : `<button class="mk-fact mk-scout" data-a="scout" data-id="${id}" aria-label="Scout his potential for ${SCOUT_COST} coins"><small>POT</small><b>SCOUT ${SCOUT_COST}</b></button>`;
    let deal: string;
    let act: string;
    if (bid?.status === 'countered') {
      deal = `<p class="mk-deal counter"><b>THEY WANT ${fmt(bid.counter)}</b><span>YOU OFFERED ${fmt(bid.amount)}</span></p>`;
      act = `<button class="btn btn-white" data-a="withdraw" data-id="${esc(bid.id)}">DECLINE</button><button class="btn btn-go mk-go" data-a="accept" data-id="${esc(bid.id)}">ACCEPT ${fmt(bid.counter)}</button>`;
    } else if (bid) {
      deal = `<p class="mk-deal"><b>OFFER SENT ${fmt(bid.amount)}</b><span>ANSWER AFTER THE NEXT LEAGUE MATCHDAY</span></p>`;
      act = `${starBtn}<button class="btn btn-white mk-go" data-a="withdraw" data-id="${esc(bid.id)}">WITHDRAW</button>`;
    } else if (!w.open) {
      deal = `<p class="mk-deal shut"><b>WINDOW SHUT</b><span>${esc((transfersTiming(st)?.window ?? w.label).replace(/^WINDOW /, ''))}</span></p>`;
      act = `${starBtn}<button class="btn btn-go mk-go" disabled>WINDOW SHUT</button>`;
    } else {
      const cur = pct.get(l.id) ?? 100;
      const amt = offerOf(l);
      const verb = !l.club && cur >= 100 ? 'SIGN' : 'OFFER';
      deal = `<label class="mk-haggle"><span>OFFER</span><input type="range" min="60" max="110" step="1" value="${cur}" data-in="bid" data-id="${id}" aria-label="Offer as a share of the asking price"><b data-pct>${cur}%</b></label>
        <p class="mk-hint" data-hint>${hintFor(l, cur)}</p>`;
      act = `${starBtn}<button class="btn btn-go mk-go${coins() < amt ? ' poor' : ''}" data-a="go" data-id="${id}"><span data-verb>${verb}</span> <span data-amt>${fmt(amt)}</span></button>`;
    }
    return `<div class="mk-dh">${faceHtml(p, rivalKit(l), 'md')}<div class="mk-did"><b>${esc(p.name)}</b><span>${roleBadge(p.role)}<em>${from}</em>${
      l.youth ? tag('youth', 'YOUTH') : l.hot ? tag('hot', 'HOT') : ''
    }</span></div>${bigOvr(overall(p))}</div>
      <div class="mk-dbody pane-scroll" data-scroll-key="mk-d-${id}">
        ${cmp}
        ${keyStats(p)}
        <div class="mk-facts">${fact('AGE', l.age)}${fact('YEARS', l.contract)}${fact('WAGE', fmt(l.wage))}${pot}</div>
        ${deal}
      </div>
      <div class="mk-dact">${act}</div>`;
  };

  /** The one hint line under the offer slider. */
  const hintFor = (l: Listing, cur: number): string =>
    !l.club && cur >= 100 ? 'HE SIGNS AT ONCE' : l.hot && cur < 100 ? 'RIVALS ARE IN: A LOW OFFER MAY LOSE HIM' : 'THEY ANSWER AFTER THE NEXT LEAGUE MATCHDAY';

  const playerDetail = (p: PlayerDef): string => {
    const id = esc(p.id);
    const sale = saleFor(st, p.id);
    const age = playerAge(p);
    const quick = sellValue(p);
    const cap = resaleCap(st, p);
    const m = p as MetaPlayer;
    const w = marketSummary(st).window;
    const starter = club.squad.indexOf(p) < 11;
    const offers = sale?.offers.length
      ? `<div class="mk-offers">${sale.offers
          .map(
            (o) => `<div class="mk-offer"><b>${esc(townOf(o.clubName).toUpperCase())}</b><span>${fmt(resaleOfferAmount(st, p, o.amount))}</span>
            <button class="btn btn-white" data-a="refuse" data-id="${id}" data-o="${esc(o.id)}">NO</button>
            <button class="btn btn-go" data-a="take" data-id="${id}" data-o="${esc(o.id)}">ACCEPT</button></div>`,
          )
          .join('')}</div>`
      : '';
    // One hint at most: the resale cap, then what listing costs, then when offers come.
    const hint =
      cap !== null
        ? `CLUBS PAY AT MOST ${fmt(cap)} UNTIL ${RESALE_STARTS} STARTS (${m.starts ?? 0} SO FAR)`
        : sale
          ? sale.offers.length
            ? `LISTED: ${MORALE_DIP} DOWN IN MATCHES`
            : w.open
              ? 'OFFERS COME AFTER LEAGUE MATCHDAYS'
              : 'NO OFFERS WHILE THE WINDOW IS SHUT'
          : `A LISTED PLAYER PLAYS ${MORALE_DIP} DOWN`;
    return `<div class="mk-dh">${faceHtml(p, club.kit, 'md')}<div class="mk-did"><b>${esc(p.name)}</b><span>${roleBadge(p.role)}<em>${starter ? 'STARTER' : 'BENCH'}${dot}${contractOf(p)} YR LEFT</em>${sale ? tag('bid', 'LISTED') : ''}</span></div>${bigOvr(overall(p))}</div>
      <div class="mk-dbody pane-scroll" data-scroll-key="mk-d-${id}">
        ${keyStats(p)}
        <div class="mk-facts">${fact('AGE', age)}${fact('WAGE', fmt(wageOf(p)))}${fact('VALUE', fmt(playerValue(p)))}${fact('POT', age > YOUNG_AGE ? 'PEAKED' : stars(playerPotential(p)), age > YOUNG_AGE)}</div>
        ${seasonStripHtml(st, p)}
        ${offers}
        <p class="mk-hint">${hint}</p>
      </div>
      <div class="mk-dact">
        <button class="btn ${sale ? 'btn-white' : 'btn-blue'}" data-a="${sale ? 'unlist' : 'list'}" data-id="${id}">${sale ? 'UNLIST' : 'LIST'}</button>
        <button class="btn ${armed === p.id ? 'btn-yellow' : 'btn-red'} mk-go" data-a="quick" data-id="${id}">${armed === p.id ? `SURE? +${fmt(quick)}` : `SELL NOW +${fmt(quick)}`}</button>
      </div>`;
  };

  const emptyPane = (head: string, line: string) => `<div class="mk-empty"><b>${head}</b><span>${line}</span></div>`;

  // ---- sheets (the expensive-offer confirm and the news): on the screen root, so panel re-renders leave them be

  let sheetEl: HTMLDivElement | null = null;
  const onSheetKey = (e: KeyboardEvent) => {
    if ((e.key !== 'Escape' && e.code !== 'Escape') || !sheetEl) return;
    e.stopPropagation();
    e.preventDefault();
    closeSheet();
  };
  const closeSheet = () => {
    if (sheetEl) window.removeEventListener('keydown', onSheetKey, true);
    sheetEl?.remove();
    sheetEl = null;
  };
  onMetaClose(closeSheet);
  const openSheet = (html: string, on: Handlers, cls = '') => {
    closeSheet();
    const el = document.createElement('div');
    el.className = 'mk-modal';
    el.innerHTML = `<div class="mk-sheet${cls ? ` ${cls}` : ''}" role="dialog" aria-modal="true">${html}</div>`;
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('button:not(:disabled)')) sfx.click();
    });
    el.addEventListener('click', (e) => {
      if (e.target === el) {
        closeSheet();
        return;
      }
      const b = (e.target as Element).closest<HTMLElement>('[data-a]');
      if (b && !(b as HTMLButtonElement).disabled) on[b.dataset.a ?? '']?.(b);
    });
    window.addEventListener('keydown', onSheetKey, true);
    scr.root.appendChild(el);
    sheetEl = el;
    hydrateFaces(el);
    el.querySelector<HTMLElement>('[data-a=ok], [data-a=close]')?.focus({ preventScroll: true });
  };

  const confirmOffer = (l: Listing, amount: number, instant: boolean) => {
    const verb = instant ? 'SIGN' : 'OFFER';
    openSheet(
      `<div class="mk-dh">${faceHtml(l.player, rivalKit(l), 'md')}<div class="mk-did"><b>${esc(l.player.name)}</b><span>${roleBadge(l.player.role)}<em>${
        l.club ? esc(townOf(l.clubName).toUpperCase()) : 'FREE AGENT'
      }</em></span></div>${bigOvr(overall(l.player))}</div>
      <p class="mk-cfq"><b>${verb} ${fmt(amount)}?</b><span>LEAVES ${fmt(Math.max(0, coins() - amount))} COINS</span></p>
      <div class="mk-dact"><button class="btn btn-white" data-a="close">CANCEL</button><button class="btn btn-go mk-go" data-a="ok">${verb} ${fmt(amount)}</button></div>`,
      {
        close: closeSheet,
        ok: () => {
          closeSheet();
          offer(l.id, amount);
        },
      },
    );
  };

  const openNews = () => {
    const timing = transfersTiming(st)!;
    const items = newsStrip(st, 8, fresh);
    markNewsSeen(st);
    app.persist();
    newsBadge = 0;
    draw();
    openSheet(
      `<header class="mk-newsh"><b>TRANSFER NEWS</b><button class="btn btn-white" data-a="close">DONE</button></header>
      <div class="mk-newscalendar"><b>${esc(timing.window)}</b><span>${esc(timing.next)}</span><small>${esc(timing.note)}</small></div>
      <ul class="mk-newsl">${marketNewsHtml(items, fresh)}</ul>`,
      { close: closeSheet },
      'mk-news-sheet',
    );
  };

  // ---- actions

  const done = (msg: string, kind: 'good' | 'bad' | 'info' = 'good') => {
    for (const n of st.tm.news) if (n.own && !n.seen) fresh.add(n);
    newsBadge = marketUnread(st);
    app.persist();
    draw();
    scr.toast(msg, kind);
  };

  const offer = (id: string, amount: number) => {
    const r = placeBid(st, app.save, id, amount);
    if (!r.ok) {
      say(r);
      return;
    }
    sfx.coin();
    if (r.instant && r.player) done(`SIGNED ${r.player.name.toUpperCase()} #${r.player.number}`);
    else done(`OFFER SENT ${fmt(amount)}`, 'info');
  };

  const handlers: Handlers = {
    back,
    tab: (el) => {
      memo.tab = el.dataset.v as MarketTab;
      armed = '';
      showSel = true;
      draw();
    },
    pos: (el) => {
      memo.pos[memo.tab] = el.dataset.v as Pos;
      memo.idx[memo.tab] = 0;
      scrolls.forget(listKey());
      resetList = true;
      showSel = true;
      draw();
    },
    sort: () => {
      const i = SORTS.findIndex(([k]) => k === memo.sort);
      memo.sort = SORTS[(i + 1) % SORTS.length][0];
      scrolls.forget(listKey());
      resetList = true;
      showSel = true;
      draw();
    },
    sel: (el) => {
      const id = el.dataset.id ?? '';
      if (memo.sel[memo.tab] === id) return;
      memo.sel[memo.tab] = id;
      armed = '';
      buzz('tap');
      draw();
    },
    news: openNews,
    go: (el) => {
      const l = listingById(st, el.dataset.id ?? '');
      if (!l) return;
      const amount = offerOf(l);
      const check = canBid(st, coins(), l.id, amount);
      if (!check.ok) {
        say(check);
        return;
      }
      if (amount > coins() * CONFIRM_SHARE) confirmOffer(l, amount, check.instant);
      else offer(l.id, amount);
    },
    withdraw: (el) => {
      const r = withdrawBid(st, app.save, el.dataset.id ?? '');
      if (!r.ok) {
        say(r);
        return;
      }
      done('OFFER WITHDRAWN, COINS BACK', 'info');
    },
    accept: (el) => {
      const r = acceptCounter(st, app.save, el.dataset.id ?? '');
      if (!r.ok) {
        say(r);
        return;
      }
      sfx.coin();
      done(`SIGNED ${r.player.name.toUpperCase()} #${r.player.number}`);
    },
    scout: (el) => {
      const r = scoutListing(st, app.save, el.dataset.id ?? '');
      if (!r.ok) {
        say(r);
        return;
      }
      sfx.coin();
      done(r.potential ? `POTENTIAL ${r.potential}/5` : 'NO GROWTH LEFT', 'info');
    },
    star: (el) => {
      const r = toggleShortlist(st, el.dataset.id ?? '');
      if (!r.ok) {
        say(r);
        return;
      }
      done(r.on ? 'ON YOUR SHORTLIST' : 'OFF YOUR SHORTLIST', 'info');
    },
    list: (el) => {
      const r = listPlayer(st, el.dataset.id ?? '');
      if (!r.ok) {
        say(r);
        return;
      }
      done('LISTED: OFFERS AFTER LEAGUE MATCHDAYS', 'info');
    },
    unlist: (el) => {
      const r = unlistPlayer(st, el.dataset.id ?? '');
      if (!r.ok) {
        say(r);
        return;
      }
      done('TAKEN OFF THE MARKET', 'info');
    },
    take: (el) => {
      const r = acceptOffer(st, app.save, el.dataset.id ?? '', el.dataset.o ?? '');
      if (!r.ok) {
        say(r);
        return;
      }
      sfx.coin();
      done(`SOLD ${r.player.name.toUpperCase()} +${fmt(r.delta)}`);
    },
    refuse: (el) => {
      const r = rejectOffer(st, el.dataset.id ?? '', el.dataset.o ?? '');
      if (!r.ok) {
        say(r);
        return;
      }
      done('OFFER REFUSED', 'info');
    },
    quick: (el) => {
      const id = el.dataset.id ?? '';
      if (armed !== id) {
        armed = id;
        draw();
        return;
      }
      armed = '';
      const p = club.squad.find((x) => x.id === id);
      const r = sellPlayer(st, app.save, id);
      if (!r.ok) {
        scr.toast(failText(r.reason), 'bad');
        draw();
        return;
      }
      sfx.coin();
      done(`SOLD ${p ? p.name.toUpperCase() : 'PLAYER'} +${fmt(r.delta)}`);
    },
    findplayers: () => {
      memo.tab = 'buy';
      showSel = true;
      draw();
    },
  };

  const inputs: InputHandlers = {
    // The slider updates its own row and the button in place (no re-render mid drag).
    bid: (el) => {
      const l = listingById(st, el.dataset.id ?? '');
      if (!l) return;
      const v = Math.max(60, Math.min(110, Number(el.value) || 100));
      pct.set(l.id, v);
      const pane = el.closest('.mk-detail');
      const amt = offerOf(l);
      pane?.querySelectorAll('[data-amt]').forEach((n) => (n.textContent = fmt(amt)));
      const pc = pane?.querySelector('[data-pct]');
      if (pc) pc.textContent = `${v}%`;
      const verb = pane?.querySelector('[data-verb]');
      if (verb) verb.textContent = !l.club && v >= 100 ? 'SIGN' : 'OFFER';
      const hint = pane?.querySelector('[data-hint]');
      if (hint) hint.textContent = hintFor(l, v);
      pane?.querySelector('.mk-go')?.classList.toggle('poor', coins() < amt);
    },
  };

  // ---- draw

  const chipsHtml = () => {
    const pos = memo.pos[memo.tab];
    const roles: Pos[] = ['ALL', ...ROLES];
    const sortLabel = SORTS.find(([k]) => k === memo.sort)?.[1] ?? '';
    const sortChip =
      memo.tab === 'buy'
        ? `<button class="mk-sort" data-a="sort" aria-label="Sorted by ${sortLabel}: tap for the next sort">${pixelIcon('swap', 'currentColor', 1.2, 'mk-sorticon')}${sortLabel}</button>`
        : '';
    return `<div class="chips mk-chips">${roles
      .map((v) => `<button class="${v === pos ? 'on' : ''}" data-a="pos" data-v="${v}" aria-pressed="${v === pos}">${v}</button>`)
      .join('')}${sortChip}</div>`;
  };

  const draw = () => {
    const tab = memo.tab;
    const budget = transferBudget(st, coins());
    let rows = '';
    let detail = '';
    let empty = '';
    if (tab === 'sell') {
      const list = sellList();
      const id = pick(list.map((p) => p.id));
      rows = list.map((p) => playerRow(p, p.id === id)).join('');
      const p = list.find((x) => x.id === id);
      detail = p ? playerDetail(p) : emptyPane('NOBODY THERE', 'TRY ANOTHER POSITION');
      if (!list.length) empty = emptyPane('NOBODY THERE', 'TRY ANOTHER POSITION');
    } else {
      const list = tab === 'buy' ? buyList(budget) : shortlisted(st);
      const id = pick(list.map((l) => l.id));
      rows = list.map((l) => listingRow(l, l.id === id, budget)).join('');
      const l = list.find((x) => x.id === id);
      detail = l ? listingDetail(l) : emptyPane('NOBODY HERE', 'NEW NAMES AFTER LEAGUE MATCHDAYS');
      if (!list.length) empty = emptyPane('NOBODY HERE', 'NEW NAMES AFTER LEAGUE MATCHDAYS');
    }
    const s = marketSummary(st);
    const warn = s.drain > 0 ? `<p class="mk-warn" role="status">OVER THE WAGE BUDGET${dot}&minus;${fmt(s.drain)} A MATCH</p>` : '';
    const head = tab === 'shortlist' ? `<div class="pane-h">WATCHING ${st.tm.shortlist.length}/${SHORTLIST_MAX}</div>` : chipsHtml();
    const n = st.tm.shortlist.length;
    const tabs: [MarketTab, string][] = [['buy', 'BUY'], ['sell', 'SELL'], ['shortlist', `SHORTLIST${n ? ` ${n}` : ''}`]];
    const timing = transfersTiming(st)!;
    const body =
      tab === 'shortlist' && !n
        ? `<div class="mc-body mk-off">${emptyPane('NOBODY ON YOUR SHORTLIST', 'TAP THE STAR ON A PLAYER TO WATCH HIM')}<button class="btn btn-go" data-a="findplayers">FIND PLAYERS</button></div>`
        : `<div class="mc-body mk-body">
          <section class="pane mk-listpane">${warn}${head}<div class="pane-scroll mk-list" data-scroll-key="${listKey()}">${empty || rows}</div><p class="mk-update" title="${esc(timing.note)}">${esc(timing.next)}</p></section>
          <section class="pane mk-detail">${detail}</section>
        </div>`;
    // Lists keep their place through every re-render (and per tab for the session).
    scrolls.save(scr.panel);
    scr.render(
      `${topBar(backLabel, 'TRANSFERS', subHtml(), coins())}
      <nav class="mc-tabs mk-tabs"><div class="seg">${tabs
        .map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-a="tab" data-v="${k}" aria-pressed="${k === tab}">${l}</button>`)
        .join('')}</div><button class="mk-newsbtn" data-a="news" aria-label="News${newsBadge ? `, ${newsBadge} new` : ''}">NEWS${newsBadge ? `<b>${newsBadge}</b>` : ''}</button></nav>
      ${body}`,
      handlers,
      inputs,
    );
    scrolls.restore(scr.panel);
    if (resetList) {
      resetList = false;
      const list = scr.panel.querySelector<HTMLElement>('.mk-list');
      if (list) list.scrollTop = 0;
    }
    hydrateFaces(scr.panel);
    if (showSel) {
      showSel = false;
      revealInPane(scr.panel.querySelector('.mk-row.sel'));
    }
  };

  // Up / down walk the list from a focused row (the selection follows, the focus stays on the list).
  scr.panel.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const row = (e.target as Element).closest?.<HTMLElement>('.mk-row');
    if (!row) return;
    e.preventDefault();
    const rows = [...scr.panel.querySelectorAll<HTMLElement>('.mk-row')];
    const next = rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    memo.sel[memo.tab] = next.dataset.id ?? '';
    armed = '';
    draw();
    const now = scr.panel.querySelector<HTMLElement>('.mk-row.sel');
    now?.focus({ preventScroll: true });
    revealInPane(now);
  });

  draw();
}
