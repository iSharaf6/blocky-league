/**
 * Transfer market screen: BUY (listings with filters and an offer sheet), SELL (your squad: list for offers or
 * quick-sell), SHORTLIST, plus a news strip and the window / squad / wage status. Rules live in
 * meta/market.ts; this file only renders and wires them to AppContext. Reached from the club hub's MARKET tab
 * (openClub(app, { tab: 'market' })).
 */
import type { AppContext } from '../app';
import { sfx } from '../audio/sfx';
import {
  BOTTOM_DIVISION, KEY_STATS, MATCHDAYS, ROLES, SQUAD_MAX, SQUAD_MIN, STAT_SHORT, newSeason, refreshMarket, sellPlayer, sellValue, type CareerState, type ClubState,
} from '../meta/career';
import {
  MORALE_DIP, RESALE_STARTS, SCOUT_COST, SHORTLIST_MAX, WAGE_DIP, YOUNG_AGE,
  acceptCounter, acceptOffer, bidFor, bidRange, contractOf, filterListings, listPlayer, listingById, markNewsSeen, marketSummary, newsStrip,
  placeBid, playerAge, playerPotential, playerValue, rejectOffer, resaleCap, saleFor, scoutListing, shortlisted, sortListings, toggleShortlist,
  townOf, unlistPlayer, wageOf, withdrawBid, type Listing, type MarketFail, type MetaPlayer, type NewsItem,
} from '../meta/market';
import { overall, type Kit, type PlayerDef, type Role } from '../sim/types';
import { careerState, closeMeta, esc, failText, fmt, mountMeta, onMetaClose, openClub, ovrBadge, roleBadge, topBar, type Handlers, type InputHandlers } from './club';
import { faceHtml, hydrateFaces } from './preview';
import { sep } from './text';

export type MarketTab = 'buy' | 'sell' | 'shortlist';
type SortKey = 'price' | 'ovr' | 'age';

export interface MarketOpts {
  tab?: MarketTab;
  /** Where BACK goes (defaults to the main menu). */
  onBack?: () => void;
  backLabel?: string;
}

/**
 * Open the transfer market. Needs a club (otherwise it sends you to found one). A club with no season yet gets
 * its first one started here, exactly as CAREER would on its first visit (the market lives in the league:
 * listings come from its clubs), so the market works from MY CLUB and the SHOP before CAREER is ever opened.
 * Between seasons (the summary is up) it waits for CAREER to start the next one.
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
  ensureCss();
  if (!st.season && !st.summary) {
    newSeason(st, BOTTOM_DIVISION, 1);
    app.persist();
  }
  if (!st.season || st.summary) {
    const scr = mountMeta(app, 'mk-screen');
    scr.render(
      `${topBar(backLabel, 'TRANSFER MARKET', 'BETWEEN SEASONS', app.save.coins)}
      <p class="mc-empty">The season is over. Start the next one in CAREER and the market reopens with the new league. Scout packs in the SHOP work any time.</p>`,
      { back },
    );
    return;
  }
  // Answers to last week's offers land here too (refunds settle straight into the wallet).
  refreshMarket(st, app.save);
  // What you had not read yet keeps a NEW tag on this visit; opening the screen clears the hub's unread badge.
  const fresh = new Set<NewsItem>(st.tm.news.filter((n) => n.own && !n.seen));
  markNewsSeen(st);
  app.persist();
  marketScreen(app, st, st.club, opts.tab ?? 'buy', back, backLabel, fresh);
}

// ------------------------------------------------------------------ bits

/** The shared fact divider (ui/text.ts): an element, never a middle-dot glyph the pixel font can't draw. */
const dot = sep();

function stars(n: number): string {
  let s = '<span class="mk-stars" aria-label="' + n + ' of 5">';
  for (let i = 0; i < 5; i++) s += `<i class="${i < n ? 'on' : ''}"></i>`;
  return s + '</span>';
}

function formText(form: number): string {
  return form > 1 ? 'GREAT' : form > 0 ? 'GOOD' : form < -1 ? 'POOR' : form < 0 ? 'SHAKY' : 'STEADY';
}

function keyBars(p: PlayerDef): string {
  return KEY_STATS[p.role]
    .map((k) => `<div class="mc-bar"><span>${STAT_SHORT[k]}</span><div><i style="width:${p.stats[k]}%"></i></div><b>${p.stats[k]}</b></div>`)
    .join('');
}

function tag(cls: string, text: string): string {
  return `<i class="mk-tag ${cls}">${text}</i>`;
}

// ------------------------------------------------------------------ screen

function marketScreen(app: AppContext, st: CareerState, club: ClubState, tab0: MarketTab, back: () => void, backLabel: string, fresh: Set<NewsItem>): void {
  const scr = mountMeta(app, 'mk-screen');
  let tab = tab0;
  let pos: Role | 'ALL' = 'ALL';
  let sort: SortKey = 'price';
  /** Offer slider, % of asking (per listing so it survives re-renders). */
  const pct = new Map<string, number>();
  let confirm = '';
  let sheet: { kind: 'listing' | 'player'; id: string } | null = null;

  const rivalKit = (l: Listing): Kit => st.season?.rivals.find((r) => r.id === l.club)?.kit ?? club.kit;
  const say = (r: { ok: false; reason: MarketFail }) => scr.toast(failText(r.reason), 'bad');

  // ---- header: window / squad / wages + news

  const statusHtml = () => {
    const s = marketSummary(st);
    const w = s.window;
    const wagePct = Math.min(100, Math.round((s.wages / Math.max(1, s.budget)) * 100));
    const over = s.drain > 0;
    // Your own answers and offers first (this week and last, or still unread), then the league's gossip.
    const news = newsStrip(st, 4, fresh);
    const wageTitle = over
      ? `Wages over budget: ${fmt(s.drain)} coins leave after every match and the squad plays ${WAGE_DIP} point down. Sell players or upgrade your stadium to get under budget.`
      : 'Weekly wages against your budget (a signing must fit under it)';
    return `<div class="mk-status">
        <span class="mc-chip ${w.open ? 'home' : 'away'}">${w.open ? 'WINDOW OPEN' : 'WINDOW CLOSED'}</span>
        <span class="mc-count ${s.squad >= SQUAD_MAX ? 'full' : ''}">SQUAD ${s.squad}/${SQUAD_MAX}${s.pending ? ` +${s.pending}` : ''}</span>
        <div class="mk-wages ${over ? 'over' : ''}" title="${esc(wageTitle)}"><small>WAGES</small><div class="mc-meter"><i style="width:${wagePct}%"></i></div><b>${fmt(s.wages)} / ${fmt(s.budget)}</b>${
          over ? `<em class="mk-drain" role="status">OVER BUDGET${dot}&minus;${fmt(s.drain)} A MATCH</em>` : ''
        }</div>
      </div>
      <div class="mk-news" aria-live="polite"><b>NEWS</b><ul>
        <li class="info">${w.label.charAt(0) + w.label.slice(1).toLowerCase()}</li>
        ${news.map((n) => `<li class="${n.kind} ${n.own ? 'own' : ''}">${fresh.has(n) ? '<i class="mk-tag new">NEW</i>' : ''}${esc(n.text)}</li>`).join('')}
      </ul></div>`;
  };

  // ---- BUY

  const listingRow = (l: Listing) => {
    const p = l.player;
    const bid = bidFor(st, l.id);
    const club_ = l.club ? townOf(l.clubName).toUpperCase() : 'FREE AGENT';
    const tags =
      (bid ? tag(bid.status === 'countered' ? 'counter' : 'bid', bid.status === 'countered' ? 'COUNTER' : 'OFFER SENT') : '') +
      (l.youth ? tag('youth', 'YOUTH') : l.hot ? tag('hot', 'HOT') : '') +
      (st.tm.shortlist.includes(l.id) ? tag('star', 'LISTED') : '');
    return `<button class="mc-pl mk-row" data-a="open" data-id="${esc(l.id)}" aria-label="${esc(p.name)}, ${p.role}, overall ${overall(p)}, asking ${fmt(l.asking)}">
      ${faceHtml(p, rivalKit(l))}
      ${roleBadge(p.role)}
      <span class="mc-pname"><b>${esc(p.name)}</b><small>${club_}</small><small>${l.age}Y${dot}${l.contract}YR${dot}${fmt(l.wage)}/WK</small></span>
      ${ovrBadge(overall(p))}
      <span class="mk-price"><b>${fmt(l.asking)}</b>${tags}</span>
    </button>`;
  };

  const buyHtml = () => {
    const w = marketSummary(st).window;
    const rows = sortListings(filterListings(st.tm.listings, pos), sort).map(listingRow).join('');
    const seg = (cls: string, action: string, cur: string, items: [string, string][]) =>
      `<div class="seg ${cls}">${items.map(([v, l]) => `<button class="${v === cur ? 'on' : ''}" data-a="${action}" data-v="${v}">${l}</button>`).join('')}</div>`;
    return `<div class="mk-filters">
        ${seg('mk-pos', 'pos', pos, [['ALL', 'ALL'], ...ROLES.map((r): [string, string] => [r, r])])}
        ${seg('mk-sort', 'sort', sort, [['price', 'PRICE'], ['ovr', 'OVR'], ['age', 'AGE']])}
      </div>
      <p class="mc-hint">${
        w.open
          ? 'Tap a player to make an offer (60% to 110% of asking). Clubs answer after your next CAREER match; free agents sign at once at their price.'
          : 'The window is shut: scout and shortlist now, make offers when it opens.'
      }</p>
      ${rows ? `<div class="mc-list">${rows}</div>` : '<p class="mc-empty">Nobody here for that position right now. New names arrive after every match.</p>'}`;
  };

  // ---- SELL

  const playerRow = (p: PlayerDef, i: number) => {
    const sale = saleFor(st, p.id);
    const tags = sale ? tag('bid', sale.offers.length ? `${sale.offers.length} OFFER${sale.offers.length > 1 ? 'S' : ''}` : 'LISTED') : '';
    return `<button class="mc-pl mk-row" data-a="openp" data-id="${esc(p.id)}" aria-label="${esc(p.name)}, ${p.role}, overall ${overall(p)}, value ${fmt(playerValue(p))}">
      ${faceHtml(p, club.kit)}
      ${roleBadge(p.role)}
      <span class="mc-pname"><b>${esc(p.name)}</b><small>${i < 11 ? 'STARTER' : 'BENCH'}</small><small>${playerAge(p)}Y${dot}${contractOf(p)}YR${dot}${fmt(wageOf(p))}/WK</small></span>
      ${ovrBadge(overall(p))}
      <span class="mk-price"><b>${fmt(playerValue(p))}</b>${tags}</span>
    </button>`;
  };

  const sellHtml = () =>
    `<p class="mc-hint">Tap a player to list him: clubs bid after each match while the window is open (70 to 95% of his value), or quick-sell for 45% now. Keep ${SQUAD_MIN} players and a keeper. Someone you signed this season fetches at most 110% of what you paid until he has made ${RESALE_STARTS} starts.</p>
    <div class="mc-list">${club.squad.map(playerRow).join('')}</div>`;

  // ---- SHORTLIST

  const shortlistHtml = () => {
    const rows = shortlisted(st).map(listingRow).join('');
    return `<p class="mc-hint">Up to ${SHORTLIST_MAX} players you are watching. Scouting (${SCOUT_COST} coins) reveals a young player's potential.</p>
      ${rows ? `<div class="mc-list">${rows}</div>` : '<p class="mc-empty">Your shortlist is empty. Open a player on the BUY tab and tap SHORTLIST.</p>'}`;
  };

  // ---- offer sheet (listing)

  const listingSheet = (l: Listing): string => {
    const p = l.player;
    const w = marketSummary(st).window;
    const bid = bidFor(st, l.id);
    const [lo, hi] = bidRange(l);
    const cur = pct.get(l.id) ?? 100;
    const amount = Math.round((l.asking * cur) / 100 / 10) * 10;
    const onList = st.tm.shortlist.includes(l.id);
    const from = l.club ? esc(townOf(l.clubName).toUpperCase()) : 'FREE AGENT';
    let deal: string;
    if (bid?.status === 'countered') {
      deal = `<div class="mk-deal counter"><b>${from} WANT ${fmt(bid.counter)}</b><span>You offered ${fmt(bid.amount)}. Take it now or it lapses at the next match.</span>
        <div class="btn-row no-stick"><button class="btn btn-go" data-a="accept" data-id="${esc(bid.id)}">ACCEPT ${fmt(bid.counter)}</button><button class="btn btn-red" data-a="withdraw" data-id="${esc(bid.id)}">DECLINE</button></div></div>`;
    } else if (bid) {
      deal = `<div class="mk-deal"><b>OFFER SENT: ${fmt(bid.amount)}</b><span>${l.club ? `${from} answer after your next match.` : 'His agent answers after your next match.'}</span>
        <div class="btn-row no-stick"><button class="btn btn-white" data-a="withdraw" data-id="${esc(bid.id)}">WITHDRAW OFFER</button></div></div>`;
    } else if (!w.open) {
      deal = `<div class="mk-deal shut"><b>WINDOW CLOSED</b><span>${w.label.charAt(0) + w.label.slice(1).toLowerCase()}. Scout him or add him to your shortlist for now.</span></div>`;
    } else {
      const instant = !l.club && cur >= 100;
      deal = `<div class="mk-bid">
          <label for="mk-range"><span>YOUR OFFER</span><b data-amt>${fmt(amount)}</b><small data-pct>${cur}% OF ASKING</small></label>
          <input id="mk-range" type="range" min="60" max="110" step="1" value="${cur}" data-in="bid" data-id="${esc(l.id)}" aria-label="Offer as a percentage of the asking price">
          <div class="mk-range"><span>${fmt(lo)}</span><span>ASKING ${fmt(l.asking)}</span><span>${fmt(hi)}</span></div>
          <button class="btn btn-go btn-lg mk-go" data-a="bid" data-id="${esc(l.id)}">${instant ? 'SIGN NOW' : 'MAKE OFFER'} <span data-amt>${fmt(amount)}</span></button>
        </div>`;
    }
    return `<header class="mk-sh">
        ${faceHtml(p, rivalKit(l), 'lg')}
        <div class="mk-shid"><b>${esc(p.name)}</b><span>${roleBadge(p.role)}${ovrBadge(overall(p))}<em>${from}</em>${l.youth ? tag('youth', 'YOUTH') : l.hot ? tag('hot', 'HOT') : ''}</span></div>
        <button class="btn btn-white mk-x" data-a="close" aria-label="Close">✕</button>
      </header>
      <div class="mk-facts">
        <div class="mc-kv"><span>AGE</span><b>${l.age}</b></div>
        <div class="mc-kv"><span>CONTRACT</span><b>${l.contract} YR</b></div>
        <div class="mc-kv"><span>WAGE</span><b>${fmt(l.wage)}/WK</b></div>
        <div class="mc-kv"><span>FORM</span><b>${formText(l.form)}</b></div>
        <div class="mc-kv"><span>POTENTIAL</span><b>${l.scouted ? (l.age > YOUNG_AGE ? 'PEAKED' : stars(l.potential)) : 'UNKNOWN'}</b></div>
        <div class="mc-kv"><span>ASKING</span><b>${fmt(l.asking)}</b></div>
      </div>
      <div class="mc-bars">${keyBars(p)}</div>
      ${l.hot ? '<p class="mc-hint warn">Other clubs are in for him: a low offer may lose him.</p>' : ''}
      ${l.youth ? `<p class="mc-hint">Cheap because he is raw: he grows every season. No flipping, though: clubs offer at most 110% of what you pay until he has made ${RESALE_STARTS} starts for you.</p>` : ''}
      ${deal}
      <div class="mk-actions">
        <button class="btn btn-white" data-a="scout" data-id="${esc(l.id)}" ${l.scouted ? 'disabled' : ''}>${l.scouted ? 'SCOUTED' : `SCOUT ${SCOUT_COST}`}</button>
        <button class="btn ${onList ? 'btn-yellow' : 'btn-white'}" data-a="star" data-id="${esc(l.id)}">${onList ? 'ON SHORTLIST' : 'SHORTLIST'}</button>
      </div>`;
  };

  // ---- sale sheet (own player)

  const playerSheet = (p: PlayerDef): string => {
    const sale = saleFor(st, p.id);
    const age = playerAge(p);
    const quick = sellValue(p);
    const armed = confirm === `quick${p.id}`;
    const w = marketSummary(st).window;
    const cap = resaleCap(st, p);
    const m = p as MetaPlayer;
    const offers = sale?.offers.length
      ? `<div class="mk-offers">${sale.offers
          .map(
            (o) => `<div class="mk-offer"><b>${esc(townOf(o.clubName).toUpperCase())}</b><span>${fmt(o.amount)}</span>
            <button class="btn btn-go" data-a="take" data-id="${esc(p.id)}" data-o="${esc(o.id)}">ACCEPT</button>
            <button class="btn btn-white" data-a="refuse" data-id="${esc(p.id)}" data-o="${esc(o.id)}">NO</button></div>`,
          )
          .join('')}</div>`
      : sale
        ? `<p class="mc-hint">No offers yet. ${
            w.open ? 'Clubs bid after each match while the window is open.' : `${w.label.charAt(0) + w.label.slice(1).toLowerCase()}: clubs only bid while it is open.`
          }</p>`
        : '';
    const capNote =
      cap !== null
        ? `<p class="mc-hint warn">Signed this season for ${fmt(m.paid ?? 0)}: clubs offer at most ${fmt(cap)} until he has made ${RESALE_STARTS} starts for you (${m.starts ?? 0} so far) or the season ends.</p>`
        : '';
    return `<header class="mk-sh">
        ${faceHtml(p, club.kit, 'lg')}
        <div class="mk-shid"><b>${esc(p.name)}</b><span>${roleBadge(p.role)}${ovrBadge(overall(p))}<em>#${p.number}</em>${sale ? tag('bid', 'LISTED') : ''}</span></div>
        <button class="btn btn-white mk-x" data-a="close" aria-label="Close">✕</button>
      </header>
      <div class="mk-facts">
        <div class="mc-kv"><span>AGE</span><b>${age}</b></div>
        <div class="mc-kv"><span>CONTRACT</span><b>${contractOf(p)} YR</b></div>
        <div class="mc-kv"><span>WAGE</span><b>${fmt(wageOf(p))}/WK</b></div>
        <div class="mc-kv"><span>POTENTIAL</span><b>${age > YOUNG_AGE ? 'PEAKED' : stars(playerPotential(p))}</b></div>
        <div class="mc-kv"><span>VALUE</span><b>${fmt(playerValue(p))}</b></div>
        <div class="mc-kv"><span>QUICK SALE</span><b>${fmt(quick)}</b></div>
      </div>
      <div class="mc-bars">${keyBars(p)}</div>
      ${offers}
      ${capNote}
      <p class="mc-hint">A listed player has his mind elsewhere: ${MORALE_DIP} points off every stat in matches until he is unlisted or sold.</p>
      <div class="mk-actions">
        <button class="btn ${sale ? 'btn-white' : 'btn-blue'}" data-a="${sale ? 'unlist' : 'list'}" data-id="${esc(p.id)}">${sale ? 'UNLIST' : 'LIST FOR SALE'}</button>
        <button class="btn ${armed ? 'btn-yellow' : 'btn-red'}" data-a="quick" data-id="${esc(p.id)}">${armed ? `SURE? +${fmt(quick)}` : `QUICK SALE +${fmt(quick)}`}</button>
      </div>`;
  };

  // ---- sheet plumbing (lives on the screen root, so panel re-renders leave it alone)

  let sheetEl: HTMLDivElement | null = null;
  // Escape closes the sheet and nothing else, wherever focus is (captured before the match / menu listeners).
  const onKey = (e: KeyboardEvent) => {
    if ((e.key !== 'Escape' && e.code !== 'Escape') || !sheetEl) return;
    e.stopPropagation();
    e.preventDefault();
    closeSheet();
  };
  const closeSheet = () => {
    if (sheetEl) window.removeEventListener('keydown', onKey, true);
    sheetEl?.remove();
    sheetEl = null;
    sheet = null;
    confirm = '';
  };
  onMetaClose(closeSheet);
  const drawSheet = () => {
    if (!sheet) {
      closeSheet();
      return;
    }
    let html = '';
    if (sheet.kind === 'listing') {
      const l = listingById(st, sheet.id);
      if (!l) {
        closeSheet();
        scr.toast('HE HAS LEFT THE MARKET', 'info');
        draw();
        return;
      }
      html = listingSheet(l);
    } else {
      const p = club.squad.find((x) => x.id === sheet!.id);
      if (!p) {
        closeSheet();
        return;
      }
      html = playerSheet(p);
    }
    if (!sheetEl) {
      sheetEl = document.createElement('div');
      sheetEl.className = 'mk-modal';
      sheetEl.innerHTML = '<div class="mk-sheet" role="dialog" aria-modal="true"></div>';
      sheetEl.addEventListener('pointerdown', (e) => {
        if ((e.target as Element).closest('button:not(:disabled)')) sfx.click();
      });
      sheetEl.addEventListener('click', (e) => {
        if (e.target === sheetEl) {
          closeSheet();
          return;
        }
        const el = (e.target as Element).closest<HTMLElement>('[data-a]');
        if (!el || (el as HTMLButtonElement).disabled) return;
        handlers[el.dataset.a ?? '']?.(el);
      });
      sheetEl.addEventListener('input', (e) => {
        const el = e.target as HTMLInputElement;
        if (el.dataset.in) inputs[el.dataset.in]?.(el);
      });
      sheetEl.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') closeSheet();
      });
      window.addEventListener('keydown', onKey, true);
      scr.root.appendChild(sheetEl);
    }
    const box = sheetEl.firstElementChild as HTMLDivElement;
    const top = box.scrollTop;
    box.innerHTML = html;
    box.scrollTop = top;
    hydrateFaces(box);
    if (!box.contains(document.activeElement)) box.querySelector<HTMLElement>('input, button:not([disabled])')?.focus({ preventScroll: true });
  };

  const done = (msg: string, kind: 'good' | 'bad' | 'info' = 'good') => {
    app.persist();
    draw();
    drawSheet();
    scr.toast(msg, kind);
  };

  const handlers: Handlers = {
    // BACK with a sheet open only closes the sheet; the screen itself goes on the next BACK.
    back: () => {
      if (sheetEl) {
        closeSheet();
        return;
      }
      back();
    },
    tab: (el) => {
      tab = el.dataset.v as MarketTab;
      scr.panel.scrollTop = 0;
      draw();
    },
    pos: (el) => {
      pos = el.dataset.v as Role | 'ALL';
      draw();
    },
    sort: (el) => {
      sort = el.dataset.v as SortKey;
      draw();
    },
    open: (el) => {
      sheet = { kind: 'listing', id: el.dataset.id ?? '' };
      drawSheet();
    },
    openp: (el) => {
      sheet = { kind: 'player', id: el.dataset.id ?? '' };
      drawSheet();
    },
    close: closeSheet,
    bid: (el) => {
      const id = el.dataset.id ?? '';
      const l = listingById(st, id);
      if (!l) return;
      const amount = Math.round((l.asking * (pct.get(id) ?? 100)) / 100 / 10) * 10;
      const r = placeBid(st, app.save, id, amount);
      if (!r.ok) {
        say(r);
        return;
      }
      sfx.coin();
      if (r.instant && r.player) {
        closeSheet();
        done(`SIGNED ${r.player.name.toUpperCase()} #${r.player.number}`);
      } else done(`OFFER SENT: ${fmt(amount)}. ANSWER AFTER THE NEXT MATCH`, 'info');
    },
    withdraw: (el) => {
      const r = withdrawBid(st, app.save, el.dataset.id ?? '');
      if (!r.ok) {
        say(r);
        return;
      }
      done('OFFER WITHDRAWN, COINS RETURNED', 'info');
    },
    accept: (el) => {
      const r = acceptCounter(st, app.save, el.dataset.id ?? '');
      if (!r.ok) {
        say(r);
        return;
      }
      sfx.coin();
      closeSheet();
      done(`SIGNED ${r.player.name.toUpperCase()} #${r.player.number}`);
    },
    scout: (el) => {
      const r = scoutListing(st, app.save, el.dataset.id ?? '');
      if (!r.ok) {
        say(r);
        return;
      }
      sfx.coin();
      done(r.potential ? `POTENTIAL ${r.potential}/5` : 'SCOUTED: NO GROWTH LEFT', 'info');
    },
    star: (el) => {
      const r = toggleShortlist(st, el.dataset.id ?? '');
      if (!r.ok) {
        say(r);
        return;
      }
      done(r.on ? 'ADDED TO YOUR SHORTLIST' : 'OFF THE SHORTLIST', 'info');
    },
    list: (el) => {
      const r = listPlayer(st, el.dataset.id ?? '');
      if (!r.ok) {
        say(r);
        return;
      }
      done('LISTED. OFFERS COME AFTER EACH MATCH', 'info');
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
      closeSheet();
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
      if (confirm !== `quick${id}`) {
        confirm = `quick${id}`;
        drawSheet();
        return;
      }
      confirm = '';
      const p = club.squad.find((x) => x.id === id);
      const r = sellPlayer(st, app.save, id);
      if (!r.ok) {
        scr.toast(failText(r.reason), 'bad');
        return;
      }
      sfx.coin();
      closeSheet();
      done(`SOLD ${p ? p.name.toUpperCase() : 'PLAYER'} +${fmt(r.delta)}`);
    },
  };

  const inputs: InputHandlers = {
    bid: (el) => {
      const id = el.dataset.id ?? '';
      const l = listingById(st, id);
      if (!l) return;
      const v = Math.max(60, Math.min(110, Number(el.value) || 100));
      pct.set(id, v);
      const amount = Math.round((l.asking * v) / 100 / 10) * 10;
      const box = el.closest('.mk-bid');
      box?.querySelectorAll('[data-amt]').forEach((n) => (n.textContent = fmt(amount)));
      const pc = box?.querySelector('[data-pct]');
      if (pc) pc.textContent = `${v}% OF ASKING`;
      const go = box?.querySelector<HTMLElement>('.mk-go');
      if (go) go.firstChild!.textContent = `${!l.club && v >= 100 ? 'SIGN NOW' : 'MAKE OFFER'} `;
    },
  };

  const TABS: [MarketTab, string][] = [['buy', 'BUY'], ['sell', 'SELL'], ['shortlist', `SHORTLIST${st.tm.shortlist.length ? ` ${st.tm.shortlist.length}` : ''}`]];

  const draw = () => {
    const body = tab === 'buy' ? buyHtml() : tab === 'sell' ? sellHtml() : shortlistHtml();
    const sub = `WEEK ${(st.season?.matchday ?? 0) + 1} OF ${MATCHDAYS}`;
    TABS[2][1] = `SHORTLIST${st.tm.shortlist.length ? ` ${st.tm.shortlist.length}` : ''}`;
    scr.render(
      `${topBar(backLabel, 'TRANSFER MARKET', sub, app.save.coins)}
      ${statusHtml()}
      <div class="seg mc-tabs mk-tabs">${TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-a="tab" data-v="${k}">${l}</button>`).join('')}</div>
      ${body}`,
      handlers,
      inputs,
    );
    hydrateFaces(scr.panel);
  };
  draw();
}

// ------------------------------------------------------------------ styles (scoped to this screen; style.css is shared)

let cssDone = false;

function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'mk-css';
  s.textContent = `
.mk-status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.mk-wages { display: grid; grid-template-columns: auto minmax(60px, 1fr) auto; align-items: center; gap: 8px; flex: 1 1 200px; font: 400 14px var(--round); }
.mk-wages small { font-size: 13px; letter-spacing: 1px; }
.mk-wages b { white-space: nowrap; }
.mk-wages .mc-meter i { background: var(--go); }
.mk-wages.over .mc-meter i { background: var(--red); }
.mk-wages.over b { color: var(--red-d); }
.mk-drain { grid-column: 1 / -1; font: 700 13px var(--px); letter-spacing: 1px; color: #fff; background: var(--red); padding: 4px 7px 2px; justify-self: start; }
.mk-news li.own { color: var(--ink); font-weight: 700; }
.mk-news li.own.good { color: var(--go-d); }
.mk-news li.own.bad { color: var(--red-d); }
.mk-tag.new { background: var(--yellow); color: var(--ink); margin-right: 6px; vertical-align: 1px; }
.mk-news { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: start; padding: 8px 10px; background: #fff; border: 3px solid var(--ink); box-shadow: 0 4px 0 var(--cream-2); }
.mk-news > b { font: 700 13px var(--px); letter-spacing: 1px; background: var(--ink); color: var(--yellow); padding: 5px 6px 3px; }
.mk-news ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; min-width: 0; }
.mk-news li { font: 400 14px/1.25 var(--round); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mk-news li.good { color: var(--go-d); }
.mk-news li.bad { color: var(--red-d); }
.mk-news li.info { color: var(--ink-2); }
.mk-filters { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 8px; }
.mk-filters .seg button { min-height: 40px; padding: 8px 2px 7px; font-size: 14px; }
.mc-pl.mk-row { grid-template-columns: 44px auto minmax(0, 1fr) auto auto; }
.mc-pl.mk-row .face { --fs: 44px; grid-column: auto; grid-row: auto; }
.mc-pl.mk-row .mc-pname { gap: 1px; }
.mc-pl.mk-row .mc-pname small { font-size: 13px; line-height: 1.15; }
.mk-price { display: grid; justify-items: end; gap: 3px; min-width: 64px; }
.mk-price b { font: 700 15px var(--px); color: var(--ink); }
.mk-tag { display: inline-block; font: 400 11px/1 var(--round); letter-spacing: 0.6px; padding: 3px 5px 2px; background: var(--cream-2); color: var(--ink); }
.mk-tag.hot { background: var(--red); color: #fff; }
.mk-tag.youth { background: var(--go); color: #fff; }
.mk-tag.bid { background: var(--blue); color: #fff; }
.mk-tag.counter { background: var(--yellow); color: var(--ink); }
.mk-tag.star { background: var(--ink); color: var(--yellow); }
.mk-shid .mk-tag { margin-left: 6px; }
.mk-stars { display: inline-flex; gap: 3px; vertical-align: middle; }
.mk-stars i { width: 11px; height: 11px; background: var(--cream-2); border: 2px solid var(--ink); }
.mk-stars i.on { background: var(--yellow); }
.mk-modal { position: absolute; inset: 0; z-index: 5; display: flex; align-items: flex-end; justify-content: center; padding: 12px; background: rgba(38, 38, 46, 0.55); animation: fade 0.18s ease-out; }
.mk-sheet { width: min(560px, 100%); max-height: min(92%, 100vh - 24px); overflow-y: auto; overscroll-behavior: contain; display: grid; gap: 12px; padding: 14px; background: var(--cream); border: 4px solid var(--ink); box-shadow: 0 8px 0 var(--ink), 0 18px 30px rgba(0, 0, 0, 0.3); animation: pop 0.22s cubic-bezier(0.2, 1.4, 0.4, 1); }
.mk-sheet .btn-white { --c: #fff; --d: var(--ink-2); box-shadow: inset 0 0 0 3px var(--ink), 0 6px 0 var(--ink-2), 0 10px 0 rgba(38, 38, 46, 0.25); }
.mk-sheet .btn-white:active { box-shadow: inset 0 0 0 3px var(--ink), 0 1px 0 var(--ink-2), 0 3px 0 rgba(38, 38, 46, 0.25); }
.mk-sheet .btn:disabled { opacity: 0.55; cursor: default; }
.mk-sh { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; }
.mk-shid { display: grid; gap: 6px; min-width: 0; }
.mk-shid b { font: 400 20px var(--round); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mk-shid span { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font: 400 14px var(--round); }
.mk-shid em { font-style: normal; color: var(--ink-2); letter-spacing: 0.5px; }
.btn.mk-x { min-height: 40px; padding: 8px 12px 6px; font-size: 16px; }
.mk-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 14px; }
.mk-facts .mc-kv { padding: 5px 0; }
.mk-bid { display: grid; gap: 8px; padding: 12px; background: #fff; border: 3px solid var(--ink); box-shadow: 0 4px 0 var(--cream-2); }
.mk-bid label { display: flex; align-items: baseline; gap: 8px; font: 400 14px var(--round); letter-spacing: 1px; }
.mk-bid label b { font: 700 20px var(--px); margin-left: auto; }
.mk-bid label small { font-size: 12px; color: var(--ink-2); }
.mk-bid input[type=range] { width: 100%; height: 36px; margin: 0; accent-color: var(--blue); cursor: pointer; }
.mk-range { display: flex; justify-content: space-between; font: 400 13px var(--round); color: var(--ink-2); letter-spacing: 0.5px; }
.btn.mk-go { width: 100%; }
.mk-deal { display: grid; gap: 6px; padding: 12px; background: #fff; border: 3px solid var(--blue); font: 400 14px var(--round); }
.mk-deal.counter { border-color: var(--yellow-d); background: #fff5c4; }
.mk-deal.shut { border-color: var(--cream-2); }
.mk-deal b { font: 400 18px var(--round); }
.mk-deal .btn-row { margin: 4px 0 0; padding: 0; }
.mk-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mk-actions .btn { padding-left: 6px; padding-right: 6px; white-space: normal; }
.mk-offers { display: grid; gap: 6px; }
.mk-offer { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; align-items: center; gap: 8px; padding: 6px 8px; background: #fff; border: 2px solid var(--ink); font: 400 15px var(--round); }
.mk-offer span { font: 700 15px var(--px); }
.mk-offer .btn { min-height: 40px; padding: 8px 10px 6px; font-size: 14px; }
@media (max-width: 640px) {
  .mk-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mc-pl.mk-row { grid-template-columns: 40px auto minmax(0, 1fr) auto auto; gap: 6px; }
  .mc-pl.mk-row .face { --fs: 40px; }
  .mk-price { min-width: 56px; }
  .mk-filters { grid-template-columns: 1fr; }
  .mk-news li { white-space: normal; }
  .mk-modal { padding: 8px; }
  .mk-sheet { padding: 12px; gap: 10px; }
}
@media (max-height: 480px) {
  .mk-modal { align-items: center; }
  .mk-sheet { max-height: calc(100vh - 16px); gap: 8px; padding: 10px 12px; }
  .mk-facts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .mk-bid { gap: 4px; padding: 8px 10px; }
  .mk-bid input[type=range] { height: 28px; }
}
`;
  document.head.appendChild(s);
}
