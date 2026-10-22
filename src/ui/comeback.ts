/**
 * COMING BACK, on screen (rules: meta/comeback.ts and meta/clubIncome.ts):
 *
 * - the hub's strip under the top bar: TODAY'S GIFT or TOMORROW, the PLAY STREAK, TRY TODAY, CLUB INCOME (one tap
 *   collects) and the MATCH OF THE DAY (one tap plays), with TOMORROW's list a tap away;
 * - the gift sheet's welcome parts (ui/menus.ts gift() asks for them): WELCOME BACK and the day, the welcome week's
 *   looks on their days with their own art and name, the streak day, today's free try and what the club earned;
 * - full time: what the streak paid, the look that was tried with KEEP IT at its price, and a TOMORROW strip;
 * - the moment result's MATCH OF THE DAY line.
 *
 * One object (`comebackUi`), made once in main.ts and handed to Menus (`menus.comeback`): menus.ts only asks it for
 * markup and lets it wire its own buttons, so the shared menu file carries a few lines and no rules.
 * One screen, no page scroll (docs/UX.md): everything here is a fixed strip, a chip or a row; nothing grows a panel.
 */
import type { AppContext } from '../app';
import { sfx } from '../audio/sfx';
import { comebackOf } from '../core/comebackState';
import { localDay } from '../core/day';
import {
  accrueIncome, collectIncome, fullInText, incomeCap, incomeRate, incomeSource, incomeView, type IncomeView,
} from '../meta/clubIncome';
import {
  MOTD_REWARD, claimMotd, dayAfter, giftView, keepPrice, markWelcomed, motdOf, nextStreakItem, noteFirstDay, startStreakDay, streakPrize,
  streakToday, streakWords, syncWelcomeWeek, tomorrowOf, tryToday, useTry, welcomeDue, welcomePrize,
  type ItemPrize, type StreakPaid, type TomorrowView, type WelcomePaid,
} from '../meta/comeback';
import { CALENDAR, calendarToday } from '../meta/loops';
import { buyItem, equipItem, isSlotCat, owns, type ShopItem } from '../meta/shop';
import { buzz } from '../platform/haptics';
import { GOAL_FX_COLORS, TRAIL_COLORS } from '../render/cosmetics';
import { KIT_DESIGNS } from '../render/kitDesigns';
import { cssHex } from '../render/palette';
import { gemArt } from './gemUi';
import { careerOf } from './hubInfo';
import { momentRequest } from './moments';
import { pixelIcon } from './pixelIcons';
import { openShop } from './shop';
import { escHtml } from './text';
import './comeback.css';

/** What main.ts lends this module (its own rules: the campaign, the online gate). */
export interface ComebackHost {
  /** The first session's campaign is behind the player: a match played, or the first goal scored. */
  started(): boolean;
  /** MOMENTS is open (the first goal). */
  momentsOpen(): boolean;
  /** Run `go` when progression screens may open (connected and signed in where that is the rule), else say so. */
  gate(go: () => void): void;
}

/** The gift sheet's welcome parts (ui/menus.ts gift()). */
export interface GiftParts {
  /** WELCOME BACK on a later day than the first, else DAILY GIFT; and the calendar day beside it. */
  title: string;
  /** What calendar cell `i` (0..6) shows under its coins: null leaves the calendar's own. */
  day(i: number): string | null;
  /** Today's extras in the reward row: gems, a Scout Ticket, the look with its art and name. */
  reward: string;
  /** The streak, today's free try and the club's earnings, as one row of chips. */
  rows: string;
  /** The sheet's one hint line. */
  note: string;
}

export interface ComebackUi {
  /** The hub is about to draw: hand over what is owed, bank the office, and say whether WELCOME BACK is due. */
  hubOpening(): boolean;
  /** The hub is drawn: open the gift sheet as WELCOME BACK (the hub's own GIFT button), and say what was handed over. */
  hubOpened(welcome: boolean): void;
  /** The hub's strip ('' while the first session's campaign leads the hub). */
  hubHtml(): string;
  /** Wire whatever this module drew under `root`. */
  wire(root: HTMLElement): void;
  gift(step: number): GiftParts;
  /** The look to wear free in the match about to start (null: none today, or it was used). */
  tryFor(): ShopItem | null;
  /** A real match has just ended (`tried`: the free look it wore): the streak's day and the try are settled. */
  matchDone(tried: ShopItem | null): void;
  /** Full time: the rows for the list of extras, and the TOMORROW strip under the XP bar. */
  ftLines(): string;
  ftTomorrow(): string;
  /** A moment has just ended: today's featured one, completed, pays its reward. */
  momentDone(id: string, won: boolean): void;
  momentHtml(): string;
}

/** The office holds coins from a real absence once this long has passed since it was last looked at. */
const AWAY_MS = 30 * 60_000;
/** The hub banks the office's clock no more often than this (the card itself always reads the live clock). */
const BANK_EVERY_MS = 5 * 60_000;

const n = (v: number): string => Math.round(v).toLocaleString('en-US');

// ------------------------------------------------------------------ art (flat pixel art in each look's own colours)

const BALL_ART: { readonly [id: string]: readonly [string, string] } = {
  classic: ['#fbfbf4', '#26262e'], retro: ['#a5642f', '#5e3516'], beach: ['#ff5c5c', '#3cb4ff'], melon: ['#46b450', '#e8475b'], blaze: ['#3a2a26', '#ff7a2f'],
  hoops: ['#f08a2e', '#26262e'], eight: ['#26262e', '#fbfbf4'], ice: ['#8fe3ff', '#e8fbff'], neon: ['#26262e', '#b8ff3c'], moon: ['#b9bcc4', '#7d8088'],
  disco: ['#dfe6f2', '#8aa0c8'], gold: ['#ffd23a', '#c7970f'], planet: ['#3c8ff0', '#3cc15a'], diamond: ['#7fe0ff', '#e8fbff'],
};

function svg(w: number, h: number, rects: string, cls = ''): string {
  return `<svg class="cb-art${cls ? ` ${cls}` : ''}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

function ballArt(id: string): string {
  const [a, b] = BALL_ART[id] ?? BALL_ART.classic;
  const rows = ['..XXXX..', '.XXooXX.', 'XXoXXoXX', 'XoXXXXoX', 'XoXXXXoX', 'XXoXXoXX', '.XXooXX.', '..XXXX..'];
  let r = '';
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '.') r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c === 'X' ? a : b}"/>`;
  }));
  return svg(8, 8, r);
}

function burstArt(colors: readonly number[]): string {
  const rows = ['...X.X...', '.X..X..X.', '..X.X.X..', 'X..XXX..X', '.XXXXXXX.', 'X..XXX..X', '..X.X.X..', '.X..X..X.', '...X.X...'];
  let r = '';
  let k = 0;
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === 'X') r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${cssHex(colors[k++ % colors.length])}"/>`;
  }));
  return svg(9, 9, r);
}

function trailArt(colors: readonly number[]): string {
  const lines: [number, number, number][] = [[1, 2, 5], [0, 4, 6], [2, 6, 4], [1, 8, 5]];
  let r = '';
  lines.forEach(([x, y, w], i) => {
    r += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${cssHex(colors[i % colors.length])}"/>`;
  });
  r += '<rect x="7" y="3" width="3" height="3" fill="#fbfbf4"/><rect x="8" y="4" width="1" height="1" fill="#26262e"/>';
  return svg(11, 11, r);
}

function kitArt(id: string): string {
  const d = KIT_DESIGNS[id];
  const a = d ? d.shirt : 0xfbfbf4;
  const b = d ? d.shirt2 : 0x26262e;
  const rows = ['.XX..XX.', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '.XXXXXX.', '.XXXXXX.', '.XXXXXX.'];
  let r = '';
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== 'X') return;
    const sleeve = y >= 1 && y <= 2 && (x < 1 || x > 6);
    const p = d?.pattern;
    const two = p === 'stripes' ? x % 2 === 1 && !sleeve : p === 'hoops' ? y % 2 === 0 && !sleeve : p === 'halves' ? x < 4 : p === 'sash' ? Math.abs(x - y - 1) <= 1 && !sleeve : p === 'sleeves' ? sleeve : false;
    r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${cssHex(two ? b : a)}"/>`;
  }));
  return svg(8, 7, r);
}

const LOOK_ICON: { readonly [slot: string]: string } = { hair: 'happy', head: 'crown', arm: 'shield', boots: 'run', gloves: 'shield', shades: 'star' };

/** A look as the shop's own flat art draws it: its colours, its kind. */
export function itemArt(it: ShopItem): string {
  if (it.cat === 'ball') return ballArt(it.id);
  if (it.cat === 'goalfx') return burstArt(GOAL_FX_COLORS[it.id as keyof typeof GOAL_FX_COLORS] ?? [0xffd23a, 0xfbfbf4]);
  if (it.cat === 'trail') return trailArt(TRAIL_COLORS[it.id as keyof typeof TRAIL_COLORS] ?? [0xfbfbf4]);
  if (it.cat === 'kit') return kitArt(it.id);
  if (it.cat === 'look') return pixelIcon(LOOK_ICON[it.slot ?? ''] ?? 'crown', '#ffd23a', 2, 'cb-art');
  return pixelIcon(it.cat === 'celebration' ? 'trophy' : 'flag', '#ffd23a', 2, 'cb-art');
}

const KIND: { readonly [cat: string]: string } = { ball: 'BALL', kit: 'KIT', trail: 'TRAIL', goalfx: 'GOAL', celebration: 'CELEBRATION' };

/** A look's name as a prize reads: "MELON BALL", "TIGER KIT", "MUSIC NOTES TRAIL", "BIG AFRO". */
export function itemName(it: ShopItem): string {
  const name = it.name.toUpperCase();
  const kind = KIND[it.cat];
  return !kind || name.split(' ').includes(kind) ? name : `${name} ${kind}`;
}

const coinDot = '<i class="cb-coin" aria-hidden="true"></i>';
const gemBit = (g: number): string => (g > 0 ? `<i class="cb-gem">${gemArt(1.4)}${g}</i>` : '');
const ticketBit = (t: number): string => (t > 0 ? `<i class="cb-tk">${pixelIcon('scout', '#3cc15a', 1.2)}+${t}</i>` : '');
const artBit = (p: ItemPrize | undefined): string => (p ? `<i class="cb-it">${itemArt(p.item)}</i>` : '');

/** A prize in plain words (aria labels, toasts). */
function prizeWords(p: { coins?: number; gems?: number; tokens?: number; item?: ItemPrize }): string {
  const out: string[] = [];
  if (p.coins) out.push(`${n(p.coins)} COINS`);
  if (p.gems) out.push(`${p.gems} GEMS`);
  if (p.tokens) out.push(p.tokens === 1 ? 'A SCOUT TICKET' : `${p.tokens} SCOUT TICKETS`);
  if (p.item) out.push(p.item.owned ? `${n(p.item.coins)} COINS FOR ${itemName(p.item.item)}, WHICH YOU OWN` : itemName(p.item.item));
  return out.join(' AND ');
}

export function comebackUi(app: AppContext, host: ComebackHost): ComebackUi {
  const { save } = app;
  /** The next gift sheet is the one that opened by itself. */
  let welcomeNow = false;
  /** Coins the welcome sheet said the club earned: collected with its one CLAIM. */
  let sheetIncome = 0;
  /** The office holds coins from a real absence: the hub says so until they are collected. */
  let away = false;
  let toasts: string[] = [];
  let ft: { streak: StreakPaid | null; tried: ShopItem | null; fresh: boolean } = { streak: null, tried: null, fresh: false };
  let mo: { featured: boolean; won: boolean; paid: { coins: number; gems: number } | null; was: boolean; fresh: boolean } | null = null;

  const rateNow = (): number => {
    try {
      return incomeRate(incomeSource(careerOf(save), save));
    } catch {
      return incomeRate({ level: 0, store: false, commercial: 0, atmosphere: 0 });
    }
  };
  const office = (): IncomeView => incomeView(save, Date.now(), rateNow());

  const say = (text: string): void => {
    toasts.push(text);
  };
  /** One message at a time, after whatever the menu itself has just said. */
  const flush = (): void => {
    if (!toasts.length) return;
    const next = (): void => {
      const t = toasts.shift();
      if (!t) return;
      app.menus.toast(t);
      if (toasts.length) setTimeout(next, 2700);
    };
    // (A message the menu put up in the same breath, an achievement's gems say, has its time first.)
    const busy = (): boolean => typeof document !== 'undefined' && !!document.querySelector('.menu-toast');
    setTimeout(() => (busy() ? setTimeout(next, 2700) : next()), 0);
  };

  const welcomeToast = (p: WelcomePaid): string => {
    const extras = [p.gems ? `+${p.gems} GEMS` : '', p.tokens ? `+${p.tokens} SCOUT ${p.tokens === 1 ? 'TICKET' : 'TICKETS'}` : ''].filter(Boolean).join(' AND ');
    if (!p.item) return `DAY ${p.step}: ${extras}`;
    const lead = extras ? `${extras}. ` : '';
    const name = itemName(p.item.item);
    // (A look owned already is paid in coins instead, and the game says so. A kit is handed over, never put on unasked.)
    if (p.item.owned) return `DAY ${p.step}: ${lead}YOU OWN ${name}, SO +${n(p.item.coins)} COINS`;
    return `DAY ${p.step}: ${lead}${name} IS YOURS${p.worn ? ' AND ON' : '. PUT IT ON IN THE SHOP'}`;
  };

  function hubOpening(): boolean {
    const day = localDay();
    const now = Date.now();
    const before = JSON.stringify(save.comeback);
    const coins = save.coins;
    noteFirstDay(save, day);
    const paid = syncWelcomeWeek(save);
    if (paid) say(welcomeToast(paid));
    const rate = rateNow();
    // The welcome sheet's one CLAIM takes what the club earned too.
    if (sheetIncome > 0 && !calendarToday(save, day)) {
      // (The gift's 2X ad doubles the gift's coins only. Doubling these too was tried on 2026-10-14 and taken out the
      // same day: the model put that one ad at 1.8 match wins in a player's first week, and the bar is one.)
      const got = collectIncome(save, now, rate);
      if (got > 0) say(`YOUR CLUB EARNED ${n(got)} COINS WHILE YOU WERE AWAY`);
      away = false;
    }
    sheetIncome = 0;
    // The office is banked (and so the save written) when it first opens and then at most every few minutes: the
    // card reads the clock itself, so a hub that is drawn often does not write the save each time.
    const mark = comebackOf(save).income.at;
    if (!mark || now - mark >= BANK_EVERY_MS) accrueIncome(save, now, rate);
    if (mark && now - mark >= AWAY_MS && incomeView(save, now, rate).coins >= 1) away = true;
    if (host.momentsOpen()) motdOf(save, day);
    const due = welcomeDue(save, day, host.started());
    if (due) {
      markWelcomed(save, day);
      welcomeNow = true;
    }
    if (JSON.stringify(save.comeback) !== before || save.coins !== coins) app.persist();
    return due;
  }

  function hubOpened(welcome: boolean): void {
    if (welcome && typeof document !== 'undefined') document.querySelector<HTMLElement>('.hub-screen [data-a=gift]')?.click();
    flush();
  }

  // ---------------------------------------------------------------- the hub's strip

  const card = (cls: string, a: string, icon: string, label: string, value: string, aria: string, extra = ''): string =>
    `<button class="cb-card ${cls}" data-a="${a}" aria-label="${escHtml(aria)}"><i class="cb-ic">${icon}</i><span class="cb-t"><small>${label}</small><b>${value}</b></span>${extra}</button>`;

  function incomeCard(): string {
    const v = office();
    const full = fullInText(v.fullInMs);
    const ready = v.coins >= 1 && (away || v.full);
    const label = away && v.coins >= 1 ? 'YOUR CLUB EARNED' : `CLUB INCOME ${v.rate} AN HOUR`;
    // What a tap collects, then COLLECT once it is full or waiting from an absence, else how long until it is full;
    // the fill level is the bar along the card's foot.
    const value = v.coins < 1 ? `<span class="cb-dim">${full}</span>`
      : `${coinDot}<span>+${n(v.coins)}</span>${ready ? '<u>COLLECT</u>' : `<span class="cb-dim">${full}</span>`}`;
    const aria = away && v.coins >= 1 ? `Your club earned ${v.coins} coins while you were away. Collect`
      : `Club income, ${v.rate} coins an hour. ${v.coins} to collect. ${v.full ? 'Full' : full.toLowerCase()}`;
    const fill = `<i class="cb-fill" aria-hidden="true"><u style="width:${Math.round(v.fill * 100)}%"></u></i>`;
    return card(`cb-inc ${ready ? 'ready' : ''}`, 'cb-inc', pixelIcon('coin', ready ? '#26262e' : '#ffd23a', 2), label, value, aria, fill);
  }

  function giftCard(day: string, tm: TomorrowView): string {
    const today = giftView(save, day);
    const g = today ?? tm.gift;
    const bits = `${coinDot}<span>+${n(g.coins)}</span>${gemBit(g.gems)}${ticketBit(g.tokens)}${artBit(g.item)}`;
    if (today) {
      return card('cb-tm ready', 'cb-gift', pixelIcon('gift', '#26262e', 2), `TODAY DAY ${g.step}`, bits, `Today's gift, day ${g.step}: ${prizeWords(g).toLowerCase()}. Claim`);
    }
    return card('cb-tm', 'cb-tm', pixelIcon('gift', '#ffd23a', 2), `TOMORROW DAY ${g.step}`, bits, `Tomorrow's gift, day ${g.step}: ${prizeWords(g).toLowerCase()}. Everything tomorrow brings`);
  }

  function streakCard(day: string): string {
    const st = streakToday(save, day);
    const p = streakPrize(save, st.days);
    const value = st.playedToday
      ? `<span>DAY ${st.days}</span><u>DONE</u>`
      : `<span>DAY ${st.days}</span>${coinDot}<span>+${p.coins}</span>${gemBit(p.gems)}${artBit(p.item)}`;
    const aria = st.playedToday ? `Play streak, day ${st.days}, done today` : `Play streak. Your first match today makes day ${st.days}: ${prizeWords(p).toLowerCase()}`;
    return card(`cb-st ${st.playedToday ? 'done' : ''}`, 'cb-tm', pixelIcon('fire', '#ff9a3a', 2), 'PLAY STREAK', value, aria);
  }

  function tryCard(day: string): string {
    const t = tryToday(save, day);
    if (!t.item) return '';
    const name = escHtml(itemName(t.item));
    if (t.used && owns(save, t.item.cat, t.item.id)) return '';
    return t.used
      ? card('cb-try', 'cb-try', itemArt(t.item), `YOU TRIED IT, KEEP ${n(keepPrice(save, t.item, day))}`, `<span>${name}</span>`, `You tried ${itemName(t.item)}. Keep it for ${keepPrice(save, t.item, day)} coins`)
      : card('cb-try', 'cb-try', itemArt(t.item), 'TRY TODAY<span class="cb-more">, FREE NEXT MATCH</span>', `<span>${name}</span>`, `Try today: ${itemName(t.item)}, free in your next match`);
  }

  function motdCard(day: string): string {
    if (!host.momentsOpen()) return '';
    const v = motdOf(save, day);
    if (!v) return '';
    const title = escHtml(v.moment.title);
    return v.done
      ? card('cb-motd done', 'cb-motd', pixelIcon(v.moment.icon, '#cfcab8', 2), 'MATCH OF THE DAY DONE', `<span>${title}</span><u>TOMORROW</u>`, `Match of the day, ${v.moment.title}, done. A new one tomorrow`)
      // (Its name gets the card's whole line; the reward stands beside it, coins over gems, so neither is cut short.)
      : card('cb-motd', 'cb-motd', pixelIcon(v.moment.icon, '#ffd23a', 2), 'MATCH OF THE DAY', `<span>${title}</span>`,
        `Match of the day: ${v.moment.title}. ${MOTD_REWARD.coins} coins and ${MOTD_REWARD.gems} gems for completing it. Play`,
        `<span class="cb-rw" aria-hidden="true"><b>${coinDot}+${MOTD_REWARD.coins}</b>${gemBit(MOTD_REWARD.gems)}</span>`);
  }

  /** TOMORROW, the whole list (a tap on the card): the gift, the streak, the free try, the office, the match, the challenges. */
  function tomorrowList(tm: TomorrowView): string {
    const row = (icon: string, what: string, value: string): string => `<li><i class="cb-ic">${icon}</i><span>${what}</span><b>${value}</b></li>`;
    const g = tm.gift;
    const s = tm.streak;
    const cap = incomeCap(rateNow());
    const reserved = nextStreakItem(save, s.day + 1);
    return `<ul class="cb-pop" id="cb-pop" hidden>
        <li class="cb-pop-h">TOMORROW</li>
        ${row(pixelIcon('gift', '#ffd23a', 2), `GIFT DAY ${g.step}`, `${coinDot}+${n(g.coins)}${gemBit(g.gems)}${ticketBit(g.tokens)}${g.item ? `${artBit(g.item)}<u>${escHtml(itemName(g.item.item))}</u>` : ''}`)}
        ${row(pixelIcon('fire', '#ff9a3a', 2), `PLAY STREAK DAY ${s.day}`, `${coinDot}+${s.coins}${gemBit(s.gems)}${s.item ? `${artBit(s.item)}<u>${escHtml(itemName(s.item.item))}</u>` : ''}`)}
        ${tm.tryItem ? row(itemArt(tm.tryItem), 'FREE TRY', `<u>${escHtml(itemName(tm.tryItem))}</u>`) : ''}
        ${row(pixelIcon('coin', '#ffd23a', 2), 'CLUB INCOME', `${coinDot}UP TO +${n(cap)}`)}
        ${host.momentsOpen() ? row(pixelIcon('star', '#ffd23a', 2), 'A NEW MATCH OF THE DAY', `${coinDot}+${MOTD_REWARD.coins}${gemBit(MOTD_REWARD.gems)}`) : ''}
        ${row(pixelIcon('bolt', '#ffd23a', 2), '3 NEW DAILY CHALLENGES', '')}
        ${reserved ? row(itemArt(reserved.item.item), `STREAK DAY ${reserved.day}`, `<u>${escHtml(itemName(reserved.item.item))}</u>`) : ''}
      </ul>`;
  }

  function hubHtml(): string {
    if (!host.started()) return '';
    const day = localDay();
    const tm = tomorrowOf(save, day);
    return `<div class="hub-cb" role="group" aria-label="Today and tomorrow">
        ${giftCard(day, tm)}${streakCard(day)}${tryCard(day)}${incomeCard()}${motdCard(day)}
        ${tomorrowList(tm)}
      </div>`;
  }

  // ---------------------------------------------------------------- taps

  function collect(): void {
    const wasAway = away;
    const got = collectIncome(save, Date.now(), rateNow());
    if (got <= 0) {
      app.menus.toast(`NOTHING TO COLLECT YET. ${fullInText(office().fullInMs)}`);
      return;
    }
    away = false;
    app.persist();
    sfx.coin();
    buzz('success');
    say(wasAway ? `YOUR CLUB EARNED ${n(got)} COINS WHILE YOU WERE AWAY` : `+${n(got)} COINS FROM THE TICKET OFFICE`);
    app.mainMenu();
  }

  function playMotd(): void {
    const v = motdOf(save, localDay());
    if (!v) return;
    if (v.done) {
      app.menus.toast('MATCH OF THE DAY IS DONE. A NEW ONE TOMORROW');
      return;
    }
    host.gate(() => app.startMatch({
      ...momentRequest(app, v.moment, { onDone: () => app.mainMenu(), onQuit: () => app.mainMenu() }),
      nextLabel: 'CONTINUE',
    }));
  }

  function seeTry(): void {
    const t = tryToday(save, localDay());
    if (!t.item) return;
    const it = t.item;
    host.gate(() => openShop(app, { tab: it.cat, pick: it.id }));
  }

  function keep(btn: HTMLButtonElement): void {
    const it = ft.tried;
    if (!it || owns(save, it.cat, it.id)) return;
    const day = localDay();
    const r = buyItem(save, it.cat, it.id, day);
    if (!r.ok) {
      if (r.reason === 'no-coins') app.menus.toast(`${n(r.short)} MORE COINS TO KEEP IT`);
      return;
    }
    // Put on where it is a one of a kind look (a ball, a trail, a goal explosion, a celebration: what a try can be).
    if (!isSlotCat(it.cat)) equipItem(save, it.cat, it.id);
    app.persist();
    sfx.coin();
    buzz('success');
    btn.disabled = true;
    btn.textContent = 'YOURS AND ON';
  }

  function wire(root: HTMLElement): void {
    const pop = root.querySelector<HTMLElement>('.cb-pop');
    const on = (a: string, fn: (el: HTMLButtonElement) => void): void =>
      root.querySelectorAll<HTMLButtonElement>(`[data-a=${a}]`).forEach((el) => el.addEventListener('click', (e) => {
        e.stopPropagation();
        fn(el);
      }));
    on('cb-gift', () => root.querySelector<HTMLElement>('.hub-top [data-a=gift]')?.click());
    on('cb-tm', () => {
      if (!pop) return;
      pop.hidden = !pop.hidden;
      // (aria-controls names the list it opens: a screen reader follows it, and the fit audit knows it for an opened list.)
      root.querySelectorAll('[data-a=cb-tm]').forEach((b) => {
        b.setAttribute('aria-expanded', String(!pop.hidden));
        b.setAttribute('aria-controls', pop.id);
      });
    });
    on('cb-inc', collect);
    on('cb-motd', playMotd);
    on('cb-try', seeTry);
    on('cb-keep', keep);
    if (pop) root.addEventListener('click', () => (pop.hidden = true));
    // The office fills while the hub is up: its card keeps time (until the hub is replaced).
    const inc = root.querySelector<HTMLElement>('.cb-inc');
    if (inc) {
      const tick = setInterval(() => {
        const live = root.querySelector<HTMLElement>('.cb-inc');
        if (!root.isConnected || !live) return clearInterval(tick);
        const box = document.createElement('div');
        box.innerHTML = incomeCard();
        const fresh = box.firstElementChild;
        if (fresh) {
          live.className = fresh.className;
          live.innerHTML = fresh.innerHTML;
          live.setAttribute('aria-label', fresh.getAttribute('aria-label') ?? '');
        }
      }, 20_000);
    }
  }

  // ---------------------------------------------------------------- the gift sheet

  function gift(step: number): GiftParts {
    const day = localDay();
    const c = comebackOf(save);
    const back = !!c.first && c.first < day;
    const welcome = welcomeNow;
    welcomeNow = false;
    const today = giftView(save, day);
    const st = streakToday(save, day);
    const sp = streakPrize(save, st.days);
    const how = st.saved || st.halved ? streakWords(st) : '';
    const t = tryToday(save, day);
    const v = office();
    const chip = (icon: string, label: string, value: string): string =>
      `<div class="cb-row"><i class="cb-ic">${icon}</i><span><small>${label}</small><b>${value}</b></span></div>`;
    const chips = [
      chip(pixelIcon('fire', '#ff9a3a', 2), st.playedToday ? `PLAY STREAK DAY ${st.days} DONE` : `PLAY STREAK DAY ${st.days}`,
        st.playedToday ? 'SEE YOU TOMORROW' : how ? escHtml(how) : `${coinDot}+${sp.coins}${gemBit(sp.gems)}${artBit(sp.item)}<u>FIRST MATCH</u>`),
      t.item && !t.used ? chip(itemArt(t.item), 'TRY TODAY, FREE', `<u>${escHtml(itemName(t.item))}</u>`) : '',
    ];
    // What the club earned while away is on the sheet when it opened by itself, and the one CLAIM takes it.
    if ((welcome || away) && v.coins >= 1) {
      sheetIncome = v.coins;
      chips.push(chip(pixelIcon('coin', '#c7970f', 2), 'YOUR CLUB EARNED', `${coinDot}+${n(v.coins)}<u>WHILE AWAY</u>`));
    } else sheetIncome = 0;
    const item = today?.item;
    return {
      title: `${back ? 'WELCOME BACK' : 'DAILY GIFT'}<small>DAY ${step}</small>`,
      day: (i) => {
        // (Days already taken this lap keep the calendar's own line.)
        if (i + 1 < step) return null;
        const w = welcomePrize(save, i + 1);
        if (!w) return null;
        const cal = CALENDAR[i];
        return `<em class="gd-x">${gemBit(cal.gems + w.gems)}${ticketBit(cal.tokens + w.tokens)}${artBit(w.item)}</em>`;
      },
      reward: today
        ? `${today.gems ? `<span class="rw-gem">${gemArt(3)}+${today.gems}</span>` : ''}${today.tokens ? `<span class="rw-tok">+${today.tokens} SCOUT ${today.tokens === 1 ? 'TICKET' : 'TICKETS'}</span>` : ''}${
          item ? `<span class="rw-item">${artBit(item)}<b>${escHtml(itemName(item.item))}</b>${item.owned ? `<small>YOU OWN IT: +${n(item.coins)} COINS</small>` : ''}</span>` : ''}`
        : '',
      rows: `<div class="cb-rows">${chips.join('')}</div>`,
      note: 'MISS A DAY, KEEP YOUR PLACE',
    };
  }

  // ---------------------------------------------------------------- full time

  function tryFor(): ShopItem | null {
    const t = tryToday(save, localDay());
    return t.used ? null : t.item;
  }

  function matchDone(tried: ShopItem | null): void {
    const day = localDay();
    noteFirstDay(save, day, true);
    const streak = startStreakDay(save, day);
    ft = { streak, tried: tried ? useTry(save, day, tried) : null, fresh: true };
  }

  function ftLines(): string {
    if (!ft.fresh) return '';
    ft.fresh = false;
    const out: string[] = [];
    const s = ft.streak;
    if (s) {
      const how = s.saved || s.halved ? `<small>${escHtml(streakWords(s))}</small>` : '';
      const it = s.prize.item;
      const got = it ? `<small>${artBit(it)}${escHtml(it.owned ? `YOU OWN ${itemName(it.item)}: +${n(it.coins)} COINS` : `${itemName(it.item)} IS YOURS`)}</small>` : '';
      out.push(`<div class="cb-ft-line">${pixelIcon('fire', '#ff9a3a', 2, 'inl')}<span>PLAY STREAK DAY ${s.days}${how}${got}</span><b>${coinDot}+${s.prize.coins}${gemBit(s.prize.gems)}</b></div>`);
    }
    const it = ft.tried;
    if (it && !owns(save, it.cat, it.id)) {
      out.push(`<div class="cb-ft-line try"><i class="cb-ic">${itemArt(it)}</i><span>YOU TRIED ${escHtml(itemName(it))}</span><button class="btn btn-yellow cb-keep" data-a="cb-keep" aria-label="Keep it for ${keepPrice(save, it, localDay())} coins">KEEP IT ${coinDot}${n(keepPrice(save, it, localDay()))}</button></div>`);
    }
    return out.join('');
  }

  function ftTomorrow(): string {
    const day = localDay();
    const tm = tomorrowOf(save, day);
    const g = tm.gift;
    const s = tm.streak;
    const chip = (label: string, value: string): string => `<span class="cb-chip"><small>${label}</small><em>${value}</em></span>`;
    const words = `Tomorrow. Gift day ${g.step}: ${prizeWords(g).toLowerCase()}. Play streak day ${s.day}: ${prizeWords(s).toLowerCase()}${tm.tryItem ? `. Free try: ${itemName(tm.tryItem).toLowerCase()}` : ''}`;
    return `<div class="cb-ft-tm" role="note" aria-label="${escHtml(words)}">
        <b>TOMORROW</b>
        ${chip(`GIFT DAY ${g.step}`, `${coinDot}+${n(g.coins)}${gemBit(g.gems)}${ticketBit(g.tokens)}${artBit(g.item)}`)}
        ${chip(`STREAK DAY ${s.day}`, `${coinDot}+${s.coins}${gemBit(s.gems)}${artBit(s.item)}`)}
        ${tm.tryItem ? chip('FREE TRY', `${artBit({ item: tm.tryItem, owned: false, coins: 0 })}<u>${escHtml(itemName(tm.tryItem))}</u>`) : ''}
      </div>`;
  }

  // ---------------------------------------------------------------- the moment result

  function momentDone(id: string, won: boolean): void {
    const day = localDay();
    const v = host.momentsOpen() ? motdOf(save, day) : null;
    const featured = !!v && v.moment.id === id;
    mo = { featured, won, was: !!v?.done, paid: featured ? claimMotd(save, day, id, won) : null, fresh: true };
  }

  function momentHtml(): string {
    if (!mo?.fresh) return '';
    mo.fresh = false;
    if (!mo.featured) return '';
    if (mo.paid) return `<p class="cb-mo won">MATCH OF THE DAY <b>${coinDot}+${mo.paid.coins}</b>${gemBit(mo.paid.gems)}</p>`;
    if (mo.was) return '<p class="cb-mo">MATCH OF THE DAY DONE. A NEW ONE TOMORROW</p>';
    return `<p class="cb-mo">MATCH OF THE DAY: COMPLETE IT TODAY FOR <b>${coinDot}+${MOTD_REWARD.coins}</b>${gemBit(MOTD_REWARD.gems)}</p>`;
  }

  return { hubOpening, hubOpened, hubHtml, wire, gift, tryFor, matchDone, ftLines, ftTomorrow, momentDone, momentHtml };
}

// ------------------------------------------------------------------ dev (import.meta.env.DEV only: main.ts __bl.comeback)

/**
 * Console helpers for checking the come-back features without waiting a night. They move the SAVE's date marks back
 * (never the clock), so every daily system sees a later day: `dayLater()`, `hoursLater(8)`, `state()`, `measure()`.
 */
export function comebackDev(app: AppContext): { dayLater(days?: number): void; hoursLater(hours?: number): void; state(): unknown; measure(): unknown } {
  const { save } = app;
  const back = (d: string | undefined, by: number): string => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? dayAfter(d, -by) : d ?? '');
  return {
    /** As if `days` nights had passed: every stored day moves back, and the office's clock with them. */
    dayLater(days = 1) {
      const by = Math.max(1, Math.floor(days));
      const c = comebackOf(save);
      for (const k of ['first', 'greeted', 'seen', 'tryOn'] as const) c[k] = back(c[k], by);
      c.streak.playedOn = back(c.streak.playedOn, by);
      c.streak.freeOn = back(c.streak.freeOn, by);
      c.motd.day = back(c.motd.day, by);
      if (c.income.at) c.income.at -= by * 86_400_000;
      if (save.gift) save.gift.last = back(save.gift.last, by);
      save.progress.daily.day = back(save.progress.daily.day, by);
      if (save.loops) {
        save.loops.ads.day = back(save.loops.ads.day, by);
        save.loops.sweep = back(save.loops.sweep, by);
      }
      if (save.shop) {
        save.shop.freePack = back(save.shop.freePack, by);
        if (save.shop.deal) save.shop.deal.day = back(save.shop.deal.day, by);
      }
      if (save.iap) save.iap.freeAds.day = back(save.iap.freeAds.day, by);
      app.persist();
      app.mainMenu();
    },
    /** As if `hours` had passed for the ticket office only. */
    hoursLater(hours = 8) {
      const c = comebackOf(save);
      if (c.income.at) c.income.at -= Math.max(0, hours) * 3_600_000;
      app.persist();
      app.mainMenu();
    },
    state() {
      const day = localDay();
      return { day, comeback: comebackOf(save), gift: giftView(save, day), tomorrow: tomorrowOf(save, day), streak: streakToday(save, day), tryToday: tryToday(save, day) };
    },
    /** The one screen rule: every panel on screen, and the hub, with its scroll height against its own height. */
    measure() {
      return [...document.querySelectorAll<HTMLElement>('.screen .panel, .screen .hub, .hub-hero, .hub-tile, .hub-cb, .cb-card, .ft-gain, .cb-ft-tm')].map((el) => ({
        el: el.className.split(' ').slice(0, 3).join('.'), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, fits: el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1,
      }));
    },
  };
}
