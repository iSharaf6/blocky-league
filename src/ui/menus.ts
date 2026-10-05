import { sfx } from '../audio/sfx';
import { WEATHER_KINDS } from '../sim/weather';
import { logoSvg } from './gameLogo';
import {
  ASSIST_LEVELS, CAM_ZOOMS, controlsOf, levelOf, levelTitle, type AssistLevel, type Challenge, type ControlSettings, type SaveData, BALL_SKIN_IDS,
  BALL_SKIN_LEVEL, BALL_SKIN_NAMES, LEGEND_STARS, legendUnlocked, nextUnlock, skinUnlocked, type BallSkinId, CELEBRATION_IDS, CELEBRATION_LEVEL,
  CELEBRATION_NAMES, celebrationUnlocked, type CelebrationId, exportSave, importSave, unlockLadder, xpAt } from '../core/save';
import { APP_VERSION, CONTACT_EMAIL, STUDIO, STUDIO_BLUE, creditHtml, lynxSvg } from './brand';
import { SCORE_SEP_HTML, escHtml, scoreHtml, sep, seps, sepText } from './text';
import { pixelIcon } from './pixelIcons';
import { gemArt } from './gemUi';
import './menus.css';
import './rewards.css';
import { buzz, hapticsAvailable, type HapticLevel } from '../platform/haptics';
import { coachText } from './coach';
import { clubRating as presetRating } from '../meta/cup';
import { PRESET_CLUBS, makeTeam, type ClubSeed } from '../meta/data';
import { owns, shopOf } from '../meta/shop';
import { KitPreview, faceHtml, hydrateFaces } from './preview';
import { crestSvg } from './crest';
import type { CaptainCard, RoadCard, SeasonCard } from './hubInfo';
import { TEXT_SIZE_LABEL, nextTextSize } from './textSize';
import {
  DEFAULT_KEYS, DEFAULT_PAD, Input, KEY_ACTIONS, KEY_SLOTS, PAD_ACTIONS, PAD_SLOTS, actionKey, bindKey, bindPad, currentDevice, isKey, keyLabel, moveKeys, normCode,
  normalizeKeyMap, normalizePadMap, padLabel, unbindKey, unbindPad, type KeyAction, type KeyMap, type PadAction, type PadMap,
} from '../core/input';
import type { LockedFeature } from '../core/onboarding';
import { cssHex, shade } from '../render/palette';
import { FORMATIONS, FORMATION_IDS, type Slot } from '../sim/formations';
import type { Match } from '../sim/match';
import type { ScenarioOutcome } from '../sim/scenario';
import { overall, type FormationId, type Kit, type MatchMode, type PlayerDef, type ScenarioSpec } from '../sim/types';
import { suggestSubs, type SubPlan } from '../meta/squad';
import { bindDragSwap } from './dragSwap';
import { developerAboutHtml } from './developerAbout';

export { pixelIcon };

export const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD', 'LEGEND'];

/** Icon tint for each ball look on the unlock ladder (the real skins are voxel textures: render/characters). */
const BALL_TINT: Partial<Record<BallSkinId, string>> = { classic: '#fbfbf4', retro: '#f2c14e', blaze: '#ff7a2f', ice: '#8fe3ff', neon: '#b8ff3c', gold: '#ffd23a' };
export const DIFF_LEVEL = [0.6, 1.8, 3, 4];
export const HALF_OPTIONS = [1.5, 2, 3, 4];

const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

/** Settings > Controls: one row per option, with a plain-English line for each value (keep them short: one line on a phone). */
type ControlRow = {
  k: keyof ControlSettings; kind: 'level' | 'switch'; label: string; why: Record<string, string>;
  /** A level row's own values (else the pass assist's ASSISTED / SEMI / MANUAL), and a row only the app shows. */
  opts?: [string, string][];
  appOnly?: boolean;
};
const CONTROL_ROWS: ControlRow[] = [
  {
    k: 'trainer', kind: 'switch', label: 'PITCH TRAINER',
    why: { true: `Controls over your player${sep()}passing guide on the pitch`, false: 'Hide the trainer; keep teammate markers' },
  },
  {
    k: 'quickPass', kind: 'switch', label: 'INSTANT PASS',
    why: { true: `Press PASS to play it immediately${sep()}automatic weight`, false: `Release PASS to play${sep()}hold for more power` },
  },
  {
    k: 'groundAssist', kind: 'level', label: 'GROUND PASS',
    why: {
      assisted: 'Fixes aim and weight to the mate you point at',
      semi: 'Fixes a slightly-off aim; the weight is up to you',
      manual: 'Goes exactly where you aim, as hard as you hold',
    },
  },
  {
    k: 'throughAssist', kind: 'level', label: 'THROUGH BALL',
    why: {
      assisted: 'Leads the runner you point at into space',
      semi: 'Nudges it into his path when your aim is close',
      manual: 'Goes exactly where you aim, as hard as you hold',
    },
  },
  {
    k: 'autoSwitch', kind: 'switch', label: 'AUTO SWITCH',
    why: { true: 'Hands you the man best placed to win it back', false: 'You switch yourself: PASS / SWITCH' },
  },
  {
    k: 'moveAssist', kind: 'switch', label: 'SWITCH MOVE ASSIST',
    why: { true: 'Your new man keeps his run until you steer', false: 'Your new man waits for the stick' },
  },
  {
    k: 'timedFinish', kind: 'switch', label: 'TIMED FINISHING',
    why: { true: '{Tap} SHOOT again as you strike: a perfect finish', false: 'Just hold and let go: no second press' },
  },
  {
    k: 'autoSprint', kind: 'switch', label: 'AUTO SPRINT',
    why: { true: `Push to sprint${sep()}a light push jogs`, false: 'Hold SPRINT to sprint' },
  },
  {
    // (The app only: the web and the portals have nothing to feel. platform/haptics.ts says what fires where.)
    k: 'vibration', kind: 'level', label: 'VIBRATION', appOnly: true, opts: [['off', 'OFF'], ['light', 'LIGHT'], ['full', 'FULL']],
    why: { off: 'No vibration', light: `Only the big moments${sep()}goals, wins, rewards`, full: `Passes, tackles, skills, goals${sep()}and every reward` },
  },
];

/** Live info for the main menu (the hub): ui/hubInfo.ts works most of it out from the save. */
export interface MainInfo {
  /** The player on the left, in YOUR club's kit (MY CLUB once founded, else the Quick Match club). */
  captain?: CaptainCard;
  /** What PLAY NOW starts ("ARS v CHE · NORMAL"). Plain " · " here: the menu draws the dividers. */
  playNow?: string;
  /** The ROAD TO GLORY hero card: CREATE YOUR CLUB, the next fixture, or the season's end. */
  road?: RoadCard;
  /** The SEASON tile: tier of 30, rewards waiting, the Club Pass. */
  season?: SeasonCard;
  /** REMOVE ADS in the top bar (the app, until NO ADS is bought), with its price. */
  noAds?: { price: string };
  /** Unread news about your own transfers (a count on TRANSFERS). */
  transfers?: number;
  /** Today's calendar day, unclaimed (meta/loops.ts CALENDAR): coins, and on some days gems or a Scout Token. */
  gift?: { amount: number; streak: number; gems?: number; tokens?: number };
  /** Gems in the wallet, beside the coins (meta/gems.ts). */
  gems?: number;
  /** Tomorrow's calendar day, once today's is claimed: the reason to come back, in the top bar. */
  tomorrow?: { coins: number; gems: number; tokens: number };
  /** This week's three objectives (meta/loops.ts), under today's challenges: coins and gems each. */
  weekly?: { list: readonly { text: string; goal: number; coins: number }[]; progress: readonly number[]; claimed: readonly boolean[]; gems: number };
  /** Level badge: level, title and progress into the level. */
  level?: { level: number; title: string; into: number; need: number };
  /** Today's challenges card. */
  daily?: { list: readonly Challenge[]; progress: readonly number[]; claimed: readonly boolean[]; fresh: boolean };
  /** Current win streak (shown on the level badge from 2). */
  streak?: number;
  /** The next thing XP earns, for the badge (null: everything earned). */
  unlock?: { name: string; level: number; xpLeft: number } | null;
  /** Signed-in name for the ACCOUNT button (cloud saves), if any. */
  account?: string;
  /** MOMENTS card subtitle on EVENTS ("SHORT CHALLENGES · ★ 4"). Plain " · ": the menu draws the dividers. */
  moments?: string;
  /** CLUB RUN card subtitle on EVENTS ("BEST: ROUND 3"). */
  run?: string;
  /**
   * The big first tile when it isn't PLAY NOW: LEARN THE BASICS (step n of 3) or FIRST MATCH (the campaign,
   * core/onboarding.ts). Its subtitle is `playNow`.
   */
  hero?: { title: string; kind: 'basics' | 'first' | 'play' };
  /** Modes still waiting for the first goal: drawn locked ("SCORE YOUR FIRST GOAL"). */
  locked?: readonly LockedFeature[];
  /** SHOP news (meta/shop.ts newInShop: affordable items not yet seen, the free daily pack): a count on the coins. */
  shopNew?: number;
  /** NEXT GOAL under the hero (meta/goal.ts): the one thing to go for now; a tap goes there (`h.goal`). */
  goal?: { text: string; go: string; icon: string };
}

/** What the full-time screen shows for progression (stars, XP, streak, challenges done this match). */
export interface FtProgress {
  /** Stars this match / moment earned (0 only for a failed moment). */
  stars: 0 | 1 | 2 | 3;
  /** Total XP before and after this match. */
  xpFrom: number;
  xpTo: number;
  /** Win streak after this match (0 = none) and the coins multiplier it gave. */
  streak: number;
  mult: number;
  /** Challenges completed by this match (their coins are already in the total). */
  done: readonly { text: string; coins: number }[];
  /** SHOP purchases (ShopState.owned): the NEXT UNLOCK line skips what is already bought. */
  owned?: readonly string[];
}

export const MODE_WHY: Record<MatchMode, string> = {
  classic: 'Pure football: no pickups, just you and the ball.',
  blitz: 'Grab power-ups on the pitch: turbo, mega shot, freeze, magnet, shield.',
};

/** Pixel-art shirt drawn as a CSS grid, so kit previews match the voxel look. */
export function shirtArt(kit: Kit, size = 8): string {
  const W = 12;
  const H = 11;
  const mask = [
    '...XX..XX...',
    '.XXXX..XXXX.',
    'XXXXXXXXXXXX',
    'XXXXXXXXXXXX',
    'XXXXXXXXXXXX',
    '..XXXXXXXX..',
    '..XXXXXXXX..',
    '..XXXXXXXX..',
    '..XXXXXXXX..',
    '..XXXXXXXX..',
    '..XXXXXXXX..',
  ];
  let cells = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y][x] !== 'X') {
        cells += '<i></i>';
        continue;
      }
      let c = kit.shirt;
      const sleeve = y >= 1 && y <= 4 && (x < 2 || x > 9);
      if (kit.pattern === 'stripes' && x % 2 === 1 && !sleeve) c = kit.shirt2;
      if (kit.pattern === 'hoops' && y % 2 === 0 && !sleeve) c = kit.shirt2;
      if (kit.pattern === 'halves' && x < 6) c = kit.shirt2;
      if (kit.pattern === 'sash' && Math.abs(x - (y + 1)) <= 1 && !sleeve) c = kit.shirt2;
      if (kit.pattern === 'sleeves' && sleeve) c = kit.shirt2;
      if (y === 1 && (x === 4 || x === 7)) c = shade(kit.shirt2, 0.9);
      if (y === H - 1) c = shade(c, 0.82);
      cells += `<i style="background:${cssHex(c)}"></i>`;
    }
  }
  return `<div class="shirt" style="--px:${size}px;grid-template-columns:repeat(${W},var(--px))">${cells}</div>`;
}

/** 1-5 stars from a squad OVR (the same teamRating number shown everywhere else). */
export function starCount(ovr: number): number {
  return Math.max(1, Math.min(5, Math.round((ovr - 40) / 10)));
}

export function stars(ovr: number): string {
  const n = starCount(ovr);
  return `<span class="stars" aria-label="${n} of 5 stars">${'★'.repeat(n)}<s>${'★'.repeat(5 - n)}</s></span>`;
}

function lum(hex: number): number {
  return (0.299 * ((hex >> 16) & 255) + 0.587 * ((hex >> 8) & 255) + 0.114 * (hex & 255)) / 255;
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

/**
 * Where each formation slot sits on the vertical team-sheet pitch (own goal at the bottom), as
 * [left %, top %, room %]: room is the horizontal space the token may use (its name tag) without meeting a neighbour.
 * Slots are grouped into lines (same role, split where a role spans two bands, e.g. 4-2-3-1's DMs and AMs);
 * lines are evenly spaced top to bottom and each line is spread wide enough that tokens never overlap, while
 * keeping a hint of the real shape (a deeper DM, wing-backs pushed on).
 */
export function pitchLayout(slots: Slot[]): [number, number, number][] {
  const out: [number, number, number][] = slots.map(() => [50, 50, 30]);
  const order = slots.map((s, i) => ({ s, i })).sort((a, b) => a.s.x - b.s.x);
  const lines: { s: Slot; i: number }[][] = [];
  for (const o of order) {
    const line = lines[lines.length - 1];
    const prev = line?.[line.length - 1];
    if (line && prev && prev.s.role === o.s.role && o.s.x - prev.s.x <= 0.2) line.push(o);
    else lines.push([o]);
  }
  const n = lines.length;
  const bottom = 87;
  const top = 8;
  lines.forEach((line, li) => {
    const y = n > 1 ? bottom - (li / (n - 1)) * (bottom - top) : 50;
    const mx = line.reduce((a, o) => a + o.s.x, 0) / line.length;
    const byZ = [...line].sort((a, b) => a.s.z - b.s.z);
    const zs = byZ.map((o) => o.s.z);
    const k = byZ.length;
    const centre = k > 1 ? (zs[0] + zs[k - 1]) / 2 : zs[0];
    // At least half a unit between neighbours, but a line never spills past ±0.92 (a back five is 0.46 apart).
    const gap = k > 1 ? Math.min(Math.max((zs[k - 1] - zs[0]) / (k - 1), 0.5), 1.84 / (k - 1)) : 0;
    const half = (gap * (k - 1)) / 2;
    const c = Math.max(-0.92 + half, Math.min(0.92 - half, centre));
    const room = k > 1 ? Math.round(gap * 43 - 1) : 40;
    byZ.forEach((o, j) => {
      const z = k > 1 ? c - half + j * gap : c;
      const nudge = Math.max(-4, Math.min(4, (o.s.x - mx) * 60));
      const t = Math.max(top, Math.min(bottom, y - nudge));
      out[o.i] = [Math.round((50 + z * 43) * 10) / 10, Math.round(t * 10) / 10, room];
    });
  });
  return out;
}

/** Touch screens get the touch controls first (a coarse pointer, i.e. a phone or tablet). */
export function defaultDevice(): 'keyboard' | 'touch' {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard';
  } catch {
    return 'keyboard';
  }
}

/** A key cap for an action's first binding (keyboard or gamepad), escaped for markup. */
const kc = (a: PadAction, dev: 'keyboard' | 'gamepad' | 'touch') => `<kbd>${escHtml(actionKey(a, dev))}</kbd>`;

/** The app shell's header (docs/UX.md, ui/shell.css): BACK at the top left, the title and its one line, a right slot. */
function shellTop(title: string, sub = '', right = '', back = 'BACK'): string {
  const gap = '<span class="mc-top-gap" aria-hidden="true"></span>';
  const b = back ? `<button class="btn btn-white mc-back" data-a="back" aria-label="${escHtml(back)}">←<span>${escHtml(back)}</span></button>` : gap;
  return `<header class="mc-top">${b}<div class="mc-title"><h2>${title}</h2>${sub ? `<span>${sub}</span>` : ''}</div>${right || gap}</header>`;
}

const coinChip = (n: number) => `<div class="coins mc-coins"><i></i><span>${n.toLocaleString()}</span></div>`;

type SettingsTab = 'general' | 'controls' | 'keys' | 'more';
type HtDev = 'keyboard' | 'touch' | 'gamepad';
type HtTab = 'attack' | 'defend' | 'skills' | 'crosses' | 'blitz';

/** Session memory (docs/UX.md 8): the last tab or fold per screen, until the game closes. */
const mem: { qmMore: boolean; setTab: SettingsTab | null; htTab: HtTab } = { qmMore: false, setTab: null, htTab: 'attack' };

const HT_TABS: [HtTab, string][] = [['attack', 'ATTACK'], ['defend', 'DEFEND'], ['skills', 'SKILLS'], ['crosses', 'CROSSES'], ['blitz', 'BLITZ']];

/** One of the in-match touch buttons, drawn small (same colours, rim and base as the real ones). */
const touchBtn = (cls: string, label: string) => `<i class="ht-tb ${cls}"><span>${label}</span></i>`;
const dot = (cls: string) => `<i class="ht-dot ${cls}"></i>`;

/** A slice of the match screen: grass, the stick and the button cluster (defending: PRESS under the thumb, SWITCH on top). */
const htPad = (defend: boolean) => `<div class="ht-pad" aria-hidden="true">
    <div class="ht-stick"><i></i></div>
    <span class="ht-pad-l">DRAG TO MOVE</span>
    <div class="ht-cluster">${defend ? touchBtn('keeper', 'KEEPER') : touchBtn('skill', 'SKILL')}${defend ? touchBtn('through dsw', 'SWITCH') : touchBtn('through', 'THROUGH')}${touchBtn('shoot', defend ? 'TACKLE' : 'SHOOT')}${defend ? touchBtn('pass dp', 'PRESS') : touchBtn('pass', 'PASS')}</div>
  </div>`;

/** One HOW TO PLAY row: the control (the touch button's colour, or the player's own key), its name and a few words. */
const htRow = (cap: string, name: string, what: string) =>
  `<li class="ht-row"><span class="ht-cap">${cap}</span><b>${name}</b><span class="ht-what">${what}</span></li>`;

/**
 * HOW TO PLAY, one topic for one device, as short rows that fit a phone on its side. Every key named is the player's
 * own binding (Settings > KEYS); the touch rows show the button's colour as it is on the pitch.
 */
function howtoBody(tab: HtTab, dev: HtDev): string {
  const touch = dev === 'touch';
  const cap = (a: PadAction, colour: string) => (touch ? dot(colour) : kc(a, dev));
  const stick = touch ? dot('stick')
    : dev === 'gamepad' ? '<kbd>L STICK</kbd>'
      : moveKeys('keyboard').split(' / ').map((m) => `<kbd>${escHtml(m === 'ARROWS' ? '←↑→↓' : m)}</kbd>`).join('');
  const tap = (t: string) => coachText(t, dev);
  const list = (rows: string[], cls = '') => `<ul class="ht-list ${cls}">${rows.join('')}</ul>`;
  const withPad = (rows: string[], defend: boolean) => (touch ? `<div class="ht-split">${htPad(defend)}${list(rows)}</div>` : list(rows));
  if (tab === 'defend') {
    return withPad([
      htRow(touch ? dot('def') : kc('pass', dev), 'SWITCH', 'Change player'),
      htRow(cap('shoot', 'shoot'), 'TACKLE', `${tap('{Tap} in reach to win it')}${sep()}hold to slide`),
      htRow(touch ? dot('through') : kc('through', dev), 'PRESS', `Hold${sep()}he closes down and a mate helps`),
      htRow(touch ? dot('keeper') : kc('skill', dev), 'KEEPER', `Hold near your goal${sep()}he comes out for it`),
      htRow(touch ? '<kbd>II</kbd>' : kc('pause', dev), 'PAUSE', touch ? `Top of the screen${sep()}tap to skip a replay` : 'Pause the match'),
    ], true);
  }
  if (tab === 'skills') {
    return `${list([htRow(cap('skill', 'skill'), 'SKILL', tap('{Tap} as a defender lunges (the ! over him): PERFECT'))])}
      <p class="ht-h">THE STICK PICKS THE MOVE</p>
      ${list([
        htRow('', 'AHEAD', 'Rainbow flick (squared up: nutmeg)'),
        htRow('', 'HALF ACROSS', 'Elastico'),
        htRow('', 'ACROSS', 'Roulette (slow: la croqueta)'),
        htRow('', 'HALF BACK', 'Heel chop'),
        htRow('', 'BACK', 'Drag back'),
        htRow('', 'NONE', 'Stepover (standing: ball roll)'),
      ], 'two')}
      ${list([
        htRow(stick, 'CUT', 'Turn sharply while dribbling to beat a man'),
        htRow(cap('shoot', 'shoot'), 'CURL', 'A soft diagonal shot curls'),
      ])}`;
  }
  if (tab === 'crosses') {
    return `<div class="ht-cols">
        <div><p class="ht-h">CROSSES</p>${list([
          htRow(cap('through', 'through'), 'CROSS', 'Hold THROUGH, then let go'),
          htRow(stick, 'CONTROL', 'Keep moving as it arrives'),
          htRow(stick, 'HEADER', touch ? 'Let go of the stick' : 'Stand still as it arrives'),
          htRow(cap('shoot', 'shoot'), 'AT GOAL', 'SHOOT as it arrives'),
        ])}</div>
        <div><p class="ht-h">SET PIECES</p>${list([
          htRow(cap('pass', 'pass'), 'SHORT', 'PASS it short'),
          htRow(cap('through', 'through'), 'CROSS', 'Hold to whip it in'),
          htRow(cap('shoot', 'shoot'), 'SHOT', 'Hold to shoot (at a corner: a driven cross)'),
        ])}</div>
      </div>`;
  }
  if (tab === 'blitz') {
    const use = touch ? `<b class="inl-ic">${pixelIcon('bolt', '#8a5cf6', 2)}</b>` : kc('power', dev);
    return `${list([htRow(use, 'USE', `Run over a glowing pickup${sep()}then use it`)])}
      ${list([
        htRow(pixelIcon('bolt', '#1fb36b', 2), 'TURBO', 'A burst of pace'),
        htRow(pixelIcon('burst', '#e2501a', 2), 'MEGA SHOT', 'Your next shot is a rocket'),
        htRow(pixelIcon('freeze', '#2a8fd0', 2), 'FREEZE', 'They slow for a few seconds'),
        htRow(pixelIcon('magnet', '#d99a00', 2), 'MAGNET', 'The ball sticks to your feet'),
        htRow(pixelIcon('shield', '#8a5cf6', 2), 'SHIELD', 'Nobody can tackle you'),
      ], 'two')}
      <p class="ht-h">QUICK MATCH${sep()}MODE${sep()}BLITZ</p>`;
  }
  return withPad([
    htRow(stick, 'MOVE', touch ? '<span class="ht-stick-float">Drag anywhere on the left half</span><span class="ht-stick-fixed">Thumb on the stick, bottom left</span>' : 'Run'),
    htRow(cap('pass', 'pass'), 'PASS', `To the ringed mate${sep()}aim to pick another`),
    htRow(cap('through', 'through'), 'THROUGH', `Into space${sep()}hold, let go to cross`),
    htRow(cap('shoot', 'shoot'), 'SHOOT', `Hold, aim, let go${sep()}longer lifts it`),
    htRow(cap('shoot', 'shoot'), 'FINISH', tap('{Tap} SHOOT again as you strike')),
    htRow(cap('shoot', 'shoot'), 'FIRST TIME', 'SHOOT just before it reaches you'),
    htRow(cap('shoot', 'shoot'), 'CHIP', tap('Hold SHOOT, {tap} THROUGH')),
    touch ? htRow(stick, 'SPRINT', `Push the stick${sep()}a light push jogs`) : htRow(cap('sprint', 'sprint'), 'SPRINT', `Automatic${sep()}press twice to knock it on`),
  ], false);
}

/** A shopping bag in the pixel icons' style (ui/pixelIcons.ts: a 10 by 10 grid), for the hub's SHOP tile. */
function bagIcon(color: string, px: number): string {
  const rows = ['...XXXX...', '..XX..XX..', '..X....X..', 'XXXXXXXXXX', 'XXXXXXXXXX', 'XXX.XX.XXX', 'XXXXXXXXXX', 'XXXXXXXXXX', 'XXXXXXXXXX', '.XXXXXXXX.'];
  let rects = '';
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === 'X') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }));
  return `<svg class="picon" width="${10 * px}" height="${10 * px}" viewBox="0 0 10 10" shape-rendering="crispEdges" fill="${color}" aria-hidden="true">${rects}</svg>`;
}

/** Settings > KEYS: what each bindable action is called on screen. */
const KEY_ACTION_NAMES: Record<KeyAction, string> = {
  up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', pass: 'PASS', shoot: 'SHOOT', through: 'THROUGH', sprint: 'SPRINT', skill: 'SKILL', power: 'POWER', pause: 'PAUSE',
};

/** What half time offers beside TACTICS & SUBS and SECOND HALF: the pause menu's set (Menus.halftime). */
export interface HalftimeMore {
  settings?: () => void;
  howto?: () => void;
  quit?: () => void;
  /** What walking off costs, said before he does (a forfeit defeat in the career and the cup; a friendly doesn't count). */
  quitNote?: string;
  /** Walking off is a defeat: the button and the question say FORFEIT. */
  forfeit?: boolean;
  /** The ratings so far, best first (the session's): the best player of the half has a line of his own. */
  ratings?: { idx: number; name: string; side: number; rating: number; goals: number; assists: number }[];
}

/** A finished match's goal clip (the session's clip API, when the browser can record one). */
export interface ClipSource {
  clip: () => { blob: Blob; name: string } | null;
  poster?: () => Blob | null;
}

/** Extra full-time lines: badge / season tier-ups, the "Try EASY?" hint, and the goal clip. */
export interface FtExtras {
  tierUps?: readonly string[];
  /** Quick match, three defeats in a row above Easy: offer EASY (sets the Quick Match difficulty). */
  tryEasy?: () => void;
  clip?: ClipSource;
  /** The very first match: no rewarded-ad offer on it. */
  noAds?: boolean;
  /** Something in the SHOP this match's coins brought into reach (meta/shop.ts inReach): its name and kind. */
  shopReach?: { name: string; kind: string };
  /**
   * SHOWTIME (game/funLayer.ts): this match's style grade and points, the mode's best before it (null: none yet),
   * whether this one is the new best, and the coins bonus the grade added (0.1 = +10%).
   */
  showtime?: { grade: string; score: number; best: string | null; newBest: boolean; bonus: number };
}

export class Menus {
  readonly root: HTMLElement;
  private screen: HTMLDivElement | null = null;
  private preview: KitPreview | null = null;
  private cleanups: (() => void)[] = [];
  private keyListeners = new Map<(e: KeyboardEvent) => void, (e: KeyboardEvent) => void>();
  /** The touch stick style (Settings), so HOW TO PLAY describes the one in use. */
  stick: 'floating' | 'fixed' = 'floating';
  /** Save and share a goal clip (main.ts wires ui/clips.ts; hidden when absent). */
  clipActions: { save: (c: { blob: Blob; name: string }) => void; share: (c: { blob: Blob; name: string }) => Promise<'shared' | 'saved' | 'cancelled'> } | null = null;

  constructor() {
    this.root = document.getElementById('ui')!;
  }

  private mount(html: string, cls = ''): HTMLDivElement {
    this.close();
    const d = document.createElement('div');
    d.className = `screen ${cls}`;
    d.innerHTML = html;
    this.root.appendChild(d);
    this.screen = d;
    d.querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', () => sfx.click()));
    return d;
  }

  close(): void {
    const cleanups = this.cleanups;
    this.cleanups = [];
    cleanups.forEach((cleanup) => cleanup());
    this.screen?.remove();
    this.screen = null;
    this.preview?.dispose();
    this.preview = null;
  }

  /** Keyboard shortcuts belong to one screen; replacing it must retire its shortcuts too. */
  private listenKey(fn: (e: KeyboardEvent) => void): void {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.repeat || el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName ?? '')) return;
      fn(e);
    };
    window.addEventListener('keydown', key);
    this.keyListeners.set(fn, key);
    this.cleanups.push(() => this.stopKey(fn));
  }

  private stopKey(fn: (e: KeyboardEvent) => void): void {
    const key = this.keyListeners.get(fn);
    if (key) window.removeEventListener('keydown', key);
    this.keyListeners.delete(fn);
  }

  get open(): boolean {
    return this.screen !== null;
  }

  title(onStart: () => void): void {
    const d = this.mount(`
      <div class="title-wrap">
        <h1 class="logo lockup">${logoSvg('stacked', 320, {}, 'bl-logo lock-s', { markWidth: 0.5, markOutline: 0.25 })}${logoSvg('horizontal', 120, {}, 'bl-logo lock-h', { markOutline: 0.25 })}</h1>
        ${creditHtml()}
        <button class="btn btn-go btn-xl pulse" data-a="start">TAP TO PLAY</button>
        <p class="fine">Keyboard${sep()}Gamepad${sep()}Touch</p>
      </div>`, 'title');
    const go = () => {
      this.stopKey(key);
      onStart();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') go();
    };
    this.listenKey(key);
    $(d, '[data-a=start]').addEventListener('click', go);
  }

  /**
   * The main menu, a hub with your club first (as in Dream League Soccer). Left: your captain in YOUR club's kit
   * (tap: MY CLUB). The hero card is ROAD TO GLORY: your club against its next opponent and PLAY (CREATE YOUR CLUB
   * before there is one); until the first goal opens it, PLAY NOW (LEARN THE BASICS, FIRST MATCH) leads instead,
   * ROAD TO GLORY locked under it. Beside the hero: MY CLUB, TRANSFERS, SHOP and SEASON. Under it, smaller: QUICK
   * MATCH, EVENTS (MOMENTS, CLUB RUN, BLITZ, ONLINE) and today's challenges, compact (a tap lists all three). The
   * top bar: the level (tap: the unlock ladder), DAILY GIFT, ACCOUNT, REMOVE ADS (the app, until bought), the coins
   * (tap: the shop's coins), HOW TO PLAY and the SETTINGS gear. Layout: src/style.css "round 15: the hub".
   */
  main(
    save: SaveData,
    h: {
      quick: () => void; career: () => void; club: () => void; settings: () => void; howto: () => void;
      transfers?: () => void; shop?: () => void; season?: () => void; events?: () => void;
      gift?: () => void; playNow?: () => void; account?: () => void; invite?: () => void; unlocks?: () => void;
      /** The coins in the top bar: the shop's COINS tab where coins can be topped up (absent: the shop). */
      coins?: () => void;
      /** The gems in the top bar: the shop's STORE tab. */
      gems?: () => void;
      /** REMOVE ADS in the top bar (drawn with `info.noAds`). */
      removeAds?: () => void;
      locked?: (f: LockedFeature) => void;
      /** NEXT GOAL tapped: where it points (meta/goal.ts GoalTarget). */
      goal?: (go: string) => void;
    },
    info?: MainInfo,
  ): void {
    const lv = info?.level;
    const locked = new Set(info?.locked ?? []);
    // The first session: PLAY NOW (LEARN THE BASICS, FIRST MATCH) leads until the first goal opens ROAD TO GLORY.
    const campaign = !!h.playNow && locked.has('career');
    const crest = (c: { name: string; short: string; kit: Kit }, px = 3) => crestSvg(c.name, c.short, c.kit, px);
    const play = (t: string) => `<span class="hh-play">${escHtml(t)}<i class="hh-tri" aria-hidden="true"></i></span>`;
    const head = (meta = '') => `<span class="hh-head"><b class="hh-title">ROAD TO GLORY</b>${meta ? `<em class="hh-meta">${escHtml(meta)}</em>` : ''}</span>`;
    const side = (c: { name: string; short: string; kit: Kit; ovr: number }, full = false) =>
      `<span class="hh-side">${crest(c, full ? 4 : 3)}<b>${escHtml(full ? c.name : c.short)}</b><small>OVR ${c.ovr}</small></span>`;
    const road: RoadCard = info?.road ?? { kind: 'create' };
    let hero: string;
    if (campaign) {
      const title = info?.hero?.title ?? 'PLAY NOW';
      hero = `<button class="hub-hero now" data-a="playnow" aria-label="${escHtml(title)}">
          <span class="hh-head"><b class="hh-title">${escHtml(title)}</b></span>
          <span class="hh-art">${pixelIcon('ball', '#fff', 6)}</span>
          ${info?.playNow ? `<span class="hh-sub" title="${escHtml(sepText(info.playNow))}">${seps(escHtml(info.playNow))}</span>` : ''}
          ${play('PLAY')}
        </button>
        <button class="hub-lockroad" data-locked="career" aria-disabled="true">${pixelIcon('lock', '#f1efe8', 3)}<b>ROAD TO GLORY</b><small>SCORE YOUR FIRST GOAL TO OPEN IT</small></button>`;
    } else if (road.kind === 'next') {
      const me = side(road.club);
      const them = side(road.rival);
      // (A BLOCKY CUP tie inside the season says so: "BLOCKY CUP QUARTER FINAL".)
      const what = road.label ?? `MATCHDAY ${road.md} OF ${road.of}`;
      const venue = road.neutral ? 'NEUTRAL GROUND' : road.home ? 'HOME' : 'AWAY';
      // THIS SEASON: the board's three objectives, ticked off as they are met (meta/board.ts).
      const pips = road.board?.length
        ? `<span class="hh-obj" aria-label="This season">${road.board
          .map((b) => `<i class="hh-pip ${b.state}"><u aria-hidden="true">${b.state === 'done' ? '✓' : ''}</u>${escHtml(b.short)}</i>`)
          .join('')}</span>`
        : '';
      hero = `<button class="hub-hero road ${road.cup ? 'cup' : ''} ${road.comp ? 'comp' : ''}" data-a="career" aria-label="Road to Glory. ${escHtml(road.club.name)} against ${escHtml(road.rival.name)}, ${escHtml(what.toLowerCase())}. Play">
          ${head(road.cup ? road.comp ?? 'BLOCKY CUP' : road.division)}
          <span class="hh-fix">${road.home || road.neutral ? me : them}<span class="hh-vs">${road.cup ? pixelIcon('trophy', '#ffd23a', 2) : ''}VS</span>${road.home || road.neutral ? them : me}</span>
          <span class="hh-sub">SEASON ${road.season}${sep()}${escHtml(what)}${sep()}${venue}</span>
          ${pips}
          ${play('PLAY')}
          ${road.waiting ? `<em class="hub-badge" aria-label="${road.waiting} waiting for you">${road.waiting > 9 ? '9+' : road.waiting}</em>` : ''}
        </button>`;
    } else if (road.kind === 'create') {
      hero = `<button class="hub-hero road create" data-a="career" aria-label="Road to Glory. Create your club">
          ${head()}
          <span class="hh-art">${pixelIcon('shirt', '#ffd23a', 6)}</span>
          <span class="hh-big">BUILD YOUR OWN CLUB</span>
          <span class="hh-sub">YOUR NAME, YOUR KIT, EIGHT DIVISIONS TO CLIMB</span>
          ${play('CREATE YOUR CLUB')}
        </button>`;
    } else {
      // A club with no season yet (the first starts on the way in), or a finished season (its summary waits there).
      hero = `<button class="hub-hero road" data-a="career" aria-label="Road to Glory. ${escHtml(road.club.name)}">
          ${head(road.division)}
          <span class="hh-fix solo">${side(road.club, true)}</span>
          <span class="hh-sub">${road.kind === 'over' ? `SEASON ${road.season} IS OVER` : 'YOUR FIRST SEASON STARTS HERE'}</span>
          ${play(road.kind === 'over' ? 'SEE THE RESULTS' : 'KICK OFF')}
        </button>`;
    }

    // Second tier: MY CLUB, TRANSFERS, SHOP and SEASON (a count where something is new or waiting).
    const count = (n: number | undefined, what: string) => (n ? `<em class="hub-badge" aria-label="${n} ${what}">${n > 9 ? '9+' : n}</em>` : '');
    const tile = (a: string, cls: string, icon: string, title: string, sub: string, extra = '') =>
      `<button class="hub-tile ${cls}" data-a="${a}"><i class="ht-ic">${icon}</i><b class="ht-t">${title}</b><small class="ht-s">${sub}</small>${extra}</button>`;
    const sc = info?.season;
    const seasonTile = sc
      ? `<button class="hub-tile t-season ${sc.pending ? 'ready' : ''} ${sc.offer ? 'offer' : ''}" data-a="season" aria-label="Club Journey ${escHtml(sc.name)}: tier ${sc.tier} of ${sc.tiers}${sc.pending ? `, ${sc.pending} rewards to claim` : ''}${sc.offer ? '. Club Pass' : ''}">
          <i class="ht-ic">${pixelIcon('crown', '#ffd23a', 4)}</i>
          <b class="ht-t">JOURNEYS</b>
          <span class="hs-tier">TIER <em>${sc.tier}</em>/${sc.tiers}</span>
          <span class="hs-bar"><u style="width:${Math.round(sc.frac * 100)}%"></u></span>
          ${sc.offer ? '<em class="hs-pass">CLUB PASS</em>' : `<small class="ht-s">${sc.pending ? 'REWARDS TO CLAIM' : sc.pass ? 'CLUB PASS ON' : 'NO EXPIRY'}</small>`}
          ${count(sc.pending, 'rewards to claim')}
        </button>`
      : '';
    const tier2 = `<div class="hub-t2">
        ${tile('club', 't-club', pixelIcon('shirt', '#26262e', 4), 'MY CLUB', 'SQUAD, KIT, STADIUM')}
        ${h.transfers ? tile('transfers', 't-transfers', pixelIcon('swap', '#fff', 4), 'TRANSFERS', 'BUY AND SELL PLAYERS', count(info?.transfers, 'new')) : ''}
        ${h.shop ? tile('shoptile', 't-shop', bagIcon('#fff', 4), 'SHOP', 'LOOKS, PACKS, COINS', count(info?.shopNew, 'new')) : ''}
        ${h.season ? seasonTile : ''}
      </div>`;

    // Today's challenges, compact: the next one to do and its bar; a tap lists all three.
    const dl = info?.daily;
    let daily = '';
    if (dl) {
      const list = dl.list.slice(0, 3);
      const done = dl.claimed.filter(Boolean).length;
      const pct = (c: Challenge, i: number) => Math.round((Math.min(c.goal, dl.progress[i] ?? 0) / c.goal) * 100);
      const i = list.findIndex((_, k) => !dl.claimed[k]);
      const next = i >= 0
        ? `<span class="hd-text">${list[i].text}</span><span class="hd-bar"><i style="width:${pct(list[i], i)}%"></i></span><em class="hd-coins">+${list[i].coins}</em>`
        : '<span class="hd-text"><span>ALL DONE</span><small class="hd-next">MORE TOMORROW</small></span>';
      const rows = list.map((c, k) => {
        const p = Math.min(c.goal, dl.progress[k] ?? 0);
        const ok = !!dl.claimed[k];
        return `<li class="${ok ? 'done' : ''}"><span class="dc-text">${c.text}</span><span class="dc-bar"><i style="width:${pct(c, k)}%"></i></span><b class="dc-n">${ok ? '✓' : `${p}/${c.goal}`}</b><em class="dc-coins">+${c.coins}</em></li>`;
      }).join('');
      // THIS WEEK, under today's three: the weekly objectives (coins and gems each; they last all week).
      const wk = info?.weekly;
      const wkRows = wk
        ? `<li class="dc-h">THIS WEEK</li>${wk.list.slice(0, 3).map((c, k) => {
          const p = Math.min(c.goal, wk.progress[k] ?? 0);
          const ok = !!wk.claimed[k];
          return `<li class="wk ${ok ? 'done' : ''}"><span class="dc-text">${c.text}</span><span class="dc-bar"><i style="width:${Math.round((p / c.goal) * 100)}%"></i></span><b class="dc-n">${ok ? '✓' : `${p}/${c.goal}`}</b><em class="dc-coins">+${c.coins}<u class="dc-gems">${gemArt(1.4)}${wk.gems}</u></em></li>`;
        }).join('')}`
        : '';
      daily = `<div class="hub-daily-wrap">
          <button class="hub-daily ${i < 0 ? 'done' : ''} ${dl.fresh ? 'fresh' : ''}" data-a="daily" aria-expanded="false" aria-controls="hub-dl" aria-label="Daily challenges, ${done} of 3 done${i < 0 ? '. New ones tomorrow' : ''}${wk ? '. Weekly objectives' : ''}">
            <span class="hd-h"><b>DAILY</b><em>${done}/3</em></span>${next}
          </button>
          <ul class="hub-dl" id="hub-dl" hidden>${rows}${wkRows}</ul>
        </div>`;
    }
    const foot = `<div class="hub-foot${h.invite ? ' with-invite' : ''}">
        <button class="hub-mini t-quick" data-a="quick" aria-label="Quick match">${pixelIcon('ball', '#26262e', 3)}<b><span class="hf-full">QUICK MATCH</span><span class="hf-short" aria-hidden="true">QUICK</span></b></button>
        ${h.events ? `<button class="hub-mini t-events" data-a="events">${pixelIcon('bolt', '#ffd23a', 3)}<b>EVENTS</b></button>` : ''}
        ${h.invite ? `<button class="hub-mini t-invite" data-a="invite" aria-label="Invite friends">${pixelIcon('duo', '#26262e', 3)}<b><span class="hf-full">INVITE FRIENDS</span><span class="hf-short" aria-hidden="true">INVITE</span></b></button>` : ''}
        ${daily}
      </div>`;

    // The top bar.
    const streak = info?.streak && info.streak >= 2 ? `<span class="hl-fire">${pixelIcon('fire', '#ff9a3a', 1.5, 'inl')}${info.streak}</span>` : '';
    const lvTag = h.unlocks ? 'button' : 'div';
    const lvChip = lv
      ? `<${lvTag} class="hub-lv" ${h.unlocks ? 'data-a="unlocks"' : ''} aria-label="Level ${lv.level}, ${escHtml(lv.title)}. ${lv.into} of ${lv.need} XP to the next level${h.unlocks ? '. Every unlock' : ''}">
          <b class="hl-n"><small>LV</small>${lv.level}</b>
          <span class="hl-txt"><b>${escHtml(lv.title.toUpperCase())}${streak}</b><i class="hl-bar"><u style="width:${Math.round((lv.into / lv.need) * 100)}%"></u></i>${info?.unlock ? `<small class="hl-next">NEXT: ${escHtml(info.unlock.name.toUpperCase())}${sep()}${info.unlock.xpLeft} XP</small>` : ''}</span>
        </${lvTag}>`
      : '<span></span>';
    const coins = save.coins.toLocaleString();
    const wallet = h.coins || h.shop
      ? `<button class="coins shop-btn hub-coins" data-a="coins" aria-label="${coins} coins. ${h.coins ? 'Get coins' : 'Shop'}"><i></i><span>${coins}</span><b class="shop-tag">${h.coins ? '+' : 'SHOP'}</b></button>`
      : `<div class="coins hub-coins"><i></i><span>${coins}</span></div>`;
    // Gems, the premium currency, beside the coins (a tap: the shop's STORE).
    const gemN = info?.gems;
    const gemChip = gemN === undefined ? ''
      : h.gems ? `<button class="gems hub-gems" data-a="gems" aria-label="${gemN.toLocaleString()} gems. Store">${gemArt(2)}<span>${gemN.toLocaleString()}</span></button>`
        : `<div class="gems hub-gems" aria-label="${gemN.toLocaleString()} gems">${gemArt(2)}<span>${gemN.toLocaleString()}</span></div>`;
    // The reason to come back: today's gift until it is claimed, then what tomorrow's pays (no timer, no penalty).
    const gf = info?.gift;
    const giftExtra = gf?.gems ? `<i class="hg-gem">${gemArt(1.6)}${gf.gems}</i>` : '';
    const tm = info?.tomorrow;
    const tomorrow = !gf && tm
      ? `<span class="hub-tomorrow" aria-label="Tomorrow's gift: ${tm.coins} coins${tm.gems ? ` and ${tm.gems} gems` : ''}${tm.tokens ? ' and a scout ticket' : ''}"><small>TOMORROW</small><b>+${tm.coins}</b>${tm.gems ? `<i>${gemArt(1.4)}${tm.gems}</i>` : ''}</span>`
      : '';
    const top = `<header class="hub-top">
        <div class="hub-progress">
          ${lvChip}
          ${h.gift && info?.gift ? `<button class="btn btn-yellow hub-gift" data-a="gift" aria-label="Daily gift, ${info.gift.amount} coins${info.gift.gems ? ` and ${info.gift.gems} gems` : ''}">${pixelIcon('gift', '#26262e', 2, 'inl')}<span class="hg-w">GIFT</span><b>+${info.gift.amount}</b>${giftExtra}</button>` : tomorrow}
        </div>
        <div class="hub-acts">
          ${h.account ? `<button class="btn btn-white hub-acct" data-a="account" aria-label="Account and cloud saves. Google or Apple sign-in"><b class="ha-full">${info?.account ? escHtml(info.account.toUpperCase()) : 'SAVE PROGRESS'}</b><b class="ha-short" aria-hidden="true">${info?.account ? 'ACCOUNT' : 'SAVE'}</b><b class="ha-mini" aria-hidden="true">${info?.account ? 'CLOUD' : 'SAVE'}</b><small>GOOGLE / APPLE</small></button>` : ''}
          ${h.removeAds && info?.noAds ? `<button class="btn btn-red hub-noads" data-a="noads" aria-label="Remove ads, ${escHtml(info.noAds.price)}">${pixelIcon('film', '#fff', 2, 'inl')}<span class="hn-full">REMOVE ADS</span><span class="hn-short" aria-hidden="true">AD FREE</span><b class="hn-p">${escHtml(info.noAds.price)}</b></button>` : ''}
          ${gemChip}
          ${wallet}
          <button class="hub-ico" data-a="howto" aria-label="How to play"><b>?</b></button>
          <button class="hub-ico" data-a="settings" aria-label="Settings">${pixelIcon('gear', '#fbfbf4', 3)}</button>
        </div>
      </header>`;

    // NEXT GOAL under the hero: always one clear thing to go for (a tap goes there).
    const g = !campaign && h.goal ? info?.goal : undefined;
    const goal = g
      ? `<button class="hub-goal" data-a="goal" aria-label="Next goal: ${escHtml(g.text.toLowerCase())}">${pixelIcon(g.icon, '#ffd23a', 2)}<b>NEXT GOAL</b><span>${escHtml(g.text)}</span><i class="hh-tri" aria-hidden="true"></i></button>`
      : '';

    // Left: your captain in your club's kit.
    const cap = info?.captain;
    const captain = cap
      ? `<button class="hub-cap ${cap.own ? 'own' : ''}" data-a="captain" aria-label="${cap.own ? `My club, ${escHtml(cap.club)}` : 'Create your club'}">
          <canvas class="hub-cap3d" aria-hidden="true"></canvas>
          <span class="hub-captag">
            <b>${crest({ name: cap.club, short: cap.short, kit: cap.kit }, 2)}<span>${escHtml(cap.club)}</span></b>
            <span class="hc-meta">OVR ${cap.ovr}</span>
            ${cap.division ? `<span class="hc-div">${escHtml(cap.division)}</span>` : ''}
            ${cap.own ? '' : '<em class="hc-cta">CREATE YOUR CLUB</em>'}
          </span>
        </button>`
      : '';

    const d = this.mount(`
      <div class="hub ${campaign ? 'campaign' : ''} ${cap ? 'with-cap' : ''}">
        ${top}
        ${captain}
        <div class="hub-body">
          <div class="hub-main">${hero}${goal}</div>
          ${tier2}
        </div>
        ${foot}
      </div>`, 'hub-screen');
    const cv = d.querySelector<HTMLCanvasElement>('.hub-cap3d');
    if (cv && cap) {
      this.preview = new KitPreview();
      if (this.preview.ok) this.preview.set(0, cv, cap.def, cap.kit);
      else cv.remove();
    }
    this.wireLocked(d, h.locked);
    const on = (a: string, fn?: () => void) => d.querySelector(`[data-a=${a}]`)?.addEventListener('click', () => fn?.());
    on('playnow', h.playNow);
    on('career', h.career);
    on('captain', h.club);
    on('club', h.club);
    on('transfers', h.transfers);
    on('shoptile', h.shop);
    on('season', h.season);
    on('quick', h.quick);
    on('events', h.events);
    on('gift', h.gift);
    on('account', h.account);
    on('invite', h.invite);
    on('noads', h.removeAds);
    on('coins', h.coins ?? h.shop);
    on('gems', h.gems);
    on('unlocks', h.unlocks);
    on('howto', h.howto);
    on('settings', h.settings);
    if (g) on('goal', () => h.goal?.(g.go));
    const dBtn = d.querySelector<HTMLButtonElement>('[data-a=daily]');
    const dList = d.querySelector<HTMLElement>('.hub-dl');
    if (dBtn && dList) {
      dBtn.addEventListener('click', () => {
        dList.hidden = !dList.hidden;
        dBtn.setAttribute('aria-expanded', String(!dList.hidden));
      });
    }
  }

  /** A locked tile or card says what opens it instead of opening (capture: before its own handler), with a little shake. */
  private wireLocked(d: HTMLElement, onLocked?: (f: LockedFeature) => void): void {
    d.querySelectorAll<HTMLElement>('[data-locked]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        el.classList.remove('nope');
        void el.offsetWidth;
        el.classList.add('nope');
        onLocked?.(el.dataset.locked as LockedFeature);
      }, true),
    );
  }

  /**
   * EVENTS (from the hub): the quick modes between ROAD TO GLORY matches. MOMENTS, CLUB RUN and BLITZ, each locked
   * until the first goal and saying so, and ONLINE where the build has it (the web).
   */
  events(
    h: { back: () => void; moments?: () => void; run?: () => void; blitz?: () => void; online?: () => void; locked?: (f: LockedFeature) => void },
    info?: Pick<MainInfo, 'moments' | 'run' | 'locked'>,
  ): void {
    const locked = new Set(info?.locked ?? []);
    const card = (a: string, f: LockedFeature | null, cls: string, icon: string, title: string, line: string, sub: string) => {
      const lock = !!f && locked.has(f);
      return `<button class="ev-card ${cls} ${lock ? 'locked' : ''}" data-a="${a}" ${lock ? `data-locked="${f}" aria-disabled="true"` : ''}>
          <i class="ev-ic">${lock ? pixelIcon('lock', '#f1efe8', 5) : icon}</i>
          <b>${title}</b>
          <span>${line}</span>
          <small>${lock ? 'SCORE YOUR FIRST GOAL' : sub}</small>
        </button>`;
    };
    const cards = [
      h.moments ? card('moments', 'moments', 'ev-mom', pixelIcon('star', '#ffd23a', 5), 'MOMENTS', 'Short challenges for stars', seps(escHtml(info?.moments ?? 'SHORT CHALLENGES'))) : '',
      h.run ? card('run', 'run', 'ev-run', pixelIcon('trophy', '#fff', 5), 'CLUB RUN', 'Seven wins in a row, one life', seps(escHtml(info?.run ?? 'ONE MORE RUN'))) : '',
      h.blitz ? card('blitz', 'blitz', 'ev-blitz', pixelIcon('bolt', '#ffd23a', 5), 'BLITZ', 'Football with power ups', 'TURBO, MEGA SHOT, FREEZE') : '',
      h.online ? card('online', null, 'ev-online', pixelIcon('duo', '#fff', 5), 'ONLINE', 'Play a friend on another device', 'SHARE A CODE') : '',
    ].filter(Boolean);
    // One screen (docs/UX.md): the modes as big tiles that share the body, BACK at the top left.
    const d = this.mount(`
      <div class="panel-wrap dim shell">
        <div class="panel mc shell ev-panel">
          ${shellTop('EVENTS', 'QUICK MODES')}
          <div class="mc-body ev-grid n${cards.length}">${cards.join('')}</div>
        </div>
      </div>`, 'events-screen');
    this.wireLocked(d, h.locked);
    for (const k of ['moments', 'run', 'blitz', 'online'] as const) d.querySelector(`[data-a=${k}]`)?.addEventListener('click', () => h[k]?.());
    $(d, '[data-a=back]').addEventListener('click', h.back);
    this.listenKey((e) => {
      if (e.code === 'Escape') h.back();
    });
  }

  /**
   * QUICK MATCH, one screen (docs/UX.md): the two clubs across the top (tap the arrows), the options two by two under
   * them (MODE and DIFFICULTY, HALF and MORE; MORE folds away KICK OFF and WEATHER), the mode's line and KICK OFF pinned
   * at the bottom. The last setup comes back: the clubs and every option live in the save (BACK keeps them too).
   */
  quickMatch(
    save: SaveData, onBack: () => void, onKickOff: (home: number, away: number, mode: MatchMode) => void, mode?: MatchMode, blitzLocked = false,
  ): void {
    let home = save.clubIdx;
    let away = save.opponentIdx === home ? (home + 1) % PRESET_CLUBS.length : save.opponentIdx;
    const modes: MatchMode[] = ['classic', 'blitz'];
    let cur: MatchMode = blitzLocked ? 'classic' : mode ?? (save.settings.lastMode === 'blitz' ? 'blitz' : 'classic');
    const d = this.mount(`
      <div class="panel-wrap shell">
        <div class="panel mc shell qm">
          ${shellTop('QUICK MATCH', '', coinChip(save.coins))}
          <div class="mc-body qm-body">
            <div class="vs-row qm-teams">
              <div class="team-pick" data-side="home"></div>
              <div class="vs">VS</div>
              <div class="team-pick" data-side="away"></div>
            </div>
            <div class="qm-opts ${mem.qmMore ? 'more' : ''}">
              <div class="qm-row"><label>MODE</label><div class="seg qm-seg seg-mode" data-o="mode"></div></div>
              <div class="qm-row"><label>DIFFICULTY</label><div class="seg qm-seg" data-o="diff"></div></div>
              <div class="qm-row"><label>HALF</label><div class="seg qm-seg" data-o="len"></div></div>
              <button class="qm-more" data-a="more" aria-expanded="${mem.qmMore}"></button>
              <div class="qm-row qm-x"><label>KICK OFF</label><div class="seg qm-seg" data-o="tod"></div></div>
              <div class="qm-row qm-x"><label>WEATHER</label><div class="seg qm-seg" data-o="wx"></div><small class="qm-weather-note" aria-live="polite" hidden></small></div>
            </div>
          </div>
          <div class="mc-actions">
            <p class="qm-why mc-hint1" aria-live="polite"></p>
            <button class="btn btn-go btn-lg qm-go" data-a="go">KICK OFF</button>
          </div>
        </div>
      </div>`, 'qm-screen');
    this.preview = new KitPreview();
    const preview = this.preview;
    const render = (side: 'home' | 'away') => {
      const idx = side === 'home' ? home : away;
      const c: ClubSeed = PRESET_CLUBS[idx];
      const ovr = presetRating(idx);
      const el = $(d, `[data-side=${side}]`);
      el.innerHTML = `
        <button class="arrow" data-d="-1" aria-label="Previous club">←</button>
        <div class="tp-kit">${preview.ok ? '<canvas class="tp-3d"></canvas>' : shirtArt(c.kit, 6)}</div>
        <div class="tp-info">
          <span class="tp-label">${side === 'home' ? 'YOU' : 'RIVAL'}</span>
          <b class="tp-name">${crestSvg(c.name, c.short, c.kit, 2)}<span>${c.name}</span></b>
          <span class="tp-stars">${stars(ovr)}</span>
          <span class="tp-meta">OVR ${ovr}${sep()}<span class="fm">${c.formation}</span></span>
        </div>
        <button class="arrow" data-d="1" aria-label="Next club">→</button>`;
      const cv = el.querySelector<HTMLCanvasElement>('.tp-3d');
      if (cv) {
        const team = makeTeam(c);
        preview.set(side === 'home' ? 0 : 1, cv, team.players[9], c.kit);
      }
      el.querySelectorAll<HTMLButtonElement>('.arrow').forEach((b) =>
        b.addEventListener('click', () => {
          sfx.click();
          const dlt = Number(b.dataset.d);
          const n = PRESET_CLUBS.length;
          if (side === 'home') {
            home = (home + dlt + n) % n;
            if (home === away) home = (home + dlt + n) % n;
          } else {
            away = (away + dlt + n) % n;
            if (away === home) away = (away + dlt + n) % n;
          }
          // The last setup comes back next time (BACK saves it).
          save.clubIdx = home;
          save.opponentIdx = away;
          render(side);
        }),
      );
    };
    render('home');
    render('away');
    const seg = (key: 'mode' | 'diff' | 'len' | 'tod' | 'wx', labels: string[], get: () => number, set: (i: number) => void) => {
      const el = $(d, `[data-o=${key}]`);
      const draw = () => {
        el.innerHTML = labels.map((l, i) => `<button class="${i === get() ? 'on' : ''}" data-i="${i}" aria-pressed="${i === get()}">${l}</button>`).join('');
        el.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
          b.addEventListener('click', () => {
            sfx.click();
            set(Number(b.dataset.i));
            draw();
            drawMore();
          }),
        );
      };
      draw();
    };
    const why = $(d, '.qm-why');
    const drawWhy = (nope = false) => {
      why.textContent = nope ? 'BLITZ opens with your first goal.' : MODE_WHY[cur];
      d.classList.toggle('blitz', cur === 'blitz');
    };
    // MORE: the kick-off time and the weather, folded; the row says what they are set to.
    const tods = ['day', 'sunset', 'night', 'random'] as const;
    const todLabels = ['DAY', 'SUNSET', 'NIGHT', 'RANDOM'];
    const wxs = [...WEATHER_KINDS, 'random'] as const;
    const wxLabels = ['CLEAR', 'OVERCAST', 'DRIZZLE', 'RAIN', 'SNOW', 'BLIZZARD', 'RANDOM'];
    const tod = () => Math.max(0, tods.indexOf(save.settings.timeOfDay));
    const wx = () => Math.max(0, wxs.indexOf(save.settings.weather));
    const opts = $(d, '.qm-opts');
    const more = $<HTMLButtonElement>(d, '[data-a=more]');
    const wxNote = $(d, '.qm-weather-note');
    function drawMore(): void {
      const weather = wxs[wx()];
      wxNote.hidden = weather !== 'rain' && weather !== 'drizzle';
      wxNote.textContent = wxNote.hidden ? '' : 'Puddles: ease off before sharp sprint turns.';
      more.innerHTML = mem.qmMore
        ? '<b>LESS</b><small></small><i></i>'
        : `<b>MORE</b><small>${todLabels[tod()]}${sep()}${wxLabels[wx()]}</small><i></i>`;
      more.setAttribute('aria-expanded', String(mem.qmMore));
      more.setAttribute('aria-label', mem.qmMore ? 'Fewer options' : `More options: kick off ${todLabels[tod()]}, weather ${wxLabels[wx()]}`);
    }
    more.addEventListener('click', () => {
      sfx.click();
      mem.qmMore = !mem.qmMore;
      opts.classList.toggle('more', mem.qmMore);
      drawMore();
    });
    seg('mode', ['CLASSIC', `BLITZ ${pixelIcon(blitzLocked ? 'lock' : 'bolt', 'currentColor', 1.6, 'inl')}`], () => modes.indexOf(cur), (i) => {
      if (blitzLocked && modes[i] === 'blitz') return drawWhy(true);
      cur = modes[i];
      save.settings.lastMode = cur;
      drawWhy();
    });
    drawWhy();
    // LEGEND is earned: LEGEND_STARS match stars open it (an old save sitting on it drops to HARD until then).
    const legendOk = legendUnlocked(save.progress);
    if (!legendOk && save.settings.difficulty === 3) save.settings.difficulty = 2;
    seg('diff', DIFFICULTIES.map((l, i) => (i === 3 && !legendOk ? `${l} ${pixelIcon('lock', 'currentColor', 1.6, 'inl')} ${LEGEND_STARS}★` : l)), () => save.settings.difficulty, (i) => {
      if (i === 3 && !legendOk) return;
      save.settings.difficulty = i;
    });
    seg('len', HALF_OPTIONS.map((m) => `${m} MIN`), () => Math.max(0, HALF_OPTIONS.indexOf(save.settings.halfMinutes)), (i) => (save.settings.halfMinutes = HALF_OPTIONS[i]));
    seg('tod', todLabels, tod, (i) => (save.settings.timeOfDay = tods[i]));
    seg('wx', wxLabels, wx, (i) => (save.settings.weather = wxs[i]));
    drawMore();
    const go = () => onKickOff(home, away, cur);
    $(d, '[data-a=back]').addEventListener('click', onBack);
    $(d, '[data-a=go]').addEventListener('click', go);
    // Keyboard: ENTER kicks off, ESC goes back.
    this.listenKey((e) => {
      if (e.code === 'Escape') onBack();
      else if (e.code === 'Enter' && !(e.target as HTMLElement | null)?.closest?.('button')) go();
    });
  }

  /**
   * Pause menu. QUIT MATCH asks first: `quitNote` says what walking off costs (a forfeit defeat in the
   * career and the cup; a friendly just doesn't count).
   */
  pause(h: {
    resume: () => void; howto: () => void; quit: () => void; settings: () => void; tactics?: () => void; quitNote?: string;
    /** The last goal's clip (SAVE CLIP / SHARE), when there is one. */
    clip?: ClipSource;
    /** LEARN THE BASICS: skip the rest of them. */
    skip?: () => void;
    /** The quit button's words (default QUIT MATCH). */
    quitLabel?: string;
    /** Walking off is a defeat (the career, the cup, a run): the button and the question say FORFEIT. */
    forfeit?: boolean;
  }): void {
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow">
          <h2>PAUSED</h2>
          <div class="menu-col">
            <button class="btn btn-go btn-lg" data-a="resume">RESUME</button>
            ${h.tactics ? '<button class="btn btn-blue" data-a="tactics">TACTICS &amp; SUBS</button>' : ''}
            <button class="btn btn-white" data-a="howto">CONTROLS</button>
            <button class="btn btn-white" data-a="settings">SETTINGS</button>
            ${this.clipRow(h.clip)}
            ${h.skip ? '<button class="btn btn-white" data-a="skip">SKIP THE BASICS</button>' : ''}
            <button class="btn btn-red" data-a="quit">${escHtml(h.quitLabel ?? (h.forfeit ? 'FORFEIT' : 'QUIT MATCH'))}</button>
          </div>
          <div class="quit-ask" hidden>
            <p class="fine big">${h.quitNote ?? "This match won't count."}</p>
            <div class="menu-col">
              <button class="btn btn-go btn-lg" data-a="stay">KEEP PLAYING</button>
              <button class="btn btn-red" data-a="really">${h.forfeit ? 'YES, FORFEIT' : 'YES, QUIT'}</button>
            </div>
          </div>
        </div>
      </div>`, 'pause');
    const main = $(d, '.panel > .menu-col');
    const ask = $(d, '.quit-ask');
    const title = $(d, 'h2');
    const asking = (on: boolean) => {
      main.hidden = on;
      ask.hidden = !on;
      title.textContent = on ? (h.forfeit ? 'FORFEIT MATCH?' : 'QUIT MATCH?') : 'PAUSED';
      $<HTMLButtonElement>(d, on ? '[data-a=stay]' : '[data-a=quit]').focus();
    };
    $(d, '[data-a=stay]').addEventListener('click', () => asking(false));
    $(d, '[data-a=really]').addEventListener('click', () => {
      this.stopKey(key);
      h.quit();
    });
    $(d, '[data-a=resume]').addEventListener('click', h.resume);
    d.querySelector('[data-a=tactics]')?.addEventListener('click', () => {
      this.stopKey(key);
      h.tactics?.();
    });
    $(d, '[data-a=howto]').addEventListener('click', h.howto);
    $(d, '[data-a=settings]').addEventListener('click', h.settings);
    $(d, '[data-a=quit]').addEventListener('click', () => asking(true));
    d.querySelector('[data-a=skip]')?.addEventListener('click', () => {
      this.stopKey(key);
      h.skip?.();
    });
    this.wireClip(d, h.clip);
    const key = (e: KeyboardEvent) => {
      if (isKey('pause', e.code)) {
        this.stopKey(key);
        h.resume();
      }
    };
    this.listenKey(key);
  }

  statsTable(m: Match, kits?: [Kit, Kit]): string {
    const s = m.stats;
    const total = s.possession[0] + s.possession[1] || 1;
    const poss = [Math.round((s.possession[0] / total) * 100), 0];
    poss[1] = 100 - poss[0];
    const row = (label: string, a: number, b: number, pct = false) => {
      const t = a + b || 1;
      const ca = kits ? `;background:${cssHex(kits[0].shirt)}` : '';
      const cb = kits ? `;background:${cssHex(kits[1].shirt)}` : '';
      return `<div class="st-row"><b>${a}${pct ? '%' : ''}</b><div class="st-bar"><i style="width:${(a / t) * 100}%${ca}"></i></div><span>${label}</span><div class="st-bar r"><i style="width:${(b / t) * 100}%${cb}"></i></div><b>${b}${pct ? '%' : ''}</b></div>`;
    };
    // Bookings: players in the referee's book (a second yellow stays counted) and players sent off.
    const yellows: [number, number] = [0, 0];
    const reds: [number, number] = [0, 0];
    for (const i of m.booked) {
      const p = m.players[i];
      if (p) yellows[p.side]++;
    }
    for (const p of m.players) if (p.sentOff) reds[p.side]++;
    return `<div class="stats">
      ${row('POSSESSION', poss[0], poss[1], true)}
      ${row('SHOTS', s.shots[0], s.shots[1])}
      ${row('ON TARGET', s.onTarget[0], s.onTarget[1])}
      ${row('PASSES', s.passes[0], s.passes[1])}
      ${row('TACKLES', s.tackles[0], s.tackles[1])}
      ${row('SAVES', s.saves[0], s.saves[1])}
      ${row('CORNERS', s.corners?.[0] ?? 0, s.corners?.[1] ?? 0)}
      ${row('FOULS', s.fouls?.[0] ?? 0, s.fouls?.[1] ?? 0)}
      ${row('<i class="st-card"></i>YELLOW CARDS', yellows[0], yellows[1])}
      ${row('<i class="st-card red"></i>RED CARDS', reds[0], reds[1])}
    </div>`;
  }

  /**
   * Half time's four key numbers as two-sided bars: each side's share in its shirt colour, the numbers at the ends
   * (possession, shots, on target, passes). Level at nothing is an even bar.
   */
  private halfStats(m: Match, kits: [Kit, Kit]): string {
    const s = m.stats;
    const total = s.possession[0] + s.possession[1] || 1;
    const p0 = s.possession[0] + s.possession[1] ? Math.round((s.possession[0] / total) * 100) : 50;
    const row = (label: string, a: number, b: number, pct = false) => {
      const t = a + b;
      const w = t > 0 ? (a / t) * 100 : 50;
      const lead = a === b ? '' : a > b ? ' l' : ' r';
      return `<div class="hs-row${lead}">
        <span class="hs-k">${label}</span>
        <b class="hs-n a">${a}${pct ? '%' : ''}</b>
        <div class="hs-bar" role="img" aria-label="${label}: ${a}${pct ? '%' : ''} to ${b}${pct ? '%' : ''}"><i style="width:${w}%;background:${cssHex(kits[0].shirt)}"></i><i style="width:${100 - w}%;background:${cssHex(kits[1].shirt)}"></i></div>
        <b class="hs-n b">${b}${pct ? '%' : ''}</b>
      </div>`;
    };
    return `<div class="hs-card">
      ${row('POSSESSION', p0, 100 - p0, true)}
      ${row('SHOTS', s.shots[0], s.shots[1])}
      ${row('ON TARGET', s.onTarget[0], s.onTarget[1])}
      ${row('PASSES', s.passes[0], s.passes[1])}
    </div>`;
  }

  private scoreHeader(m: Match, kits: [Kit, Kit]): string {
    const scorers = (side: 0 | 1) =>
      m.goals.filter((g) => g.side === side).map((g) => `<li>${g.name}${g.own ? ' (OG)' : ''} ${g.minute}'</li>`).join('');
    return `<div class="final">
      <div class="f-team">${crestSvg(m.teams[0].name, m.teams[0].short, m.teams[0].kit, 4)}<b style="border-bottom:5px solid ${cssHex(kits[0].shirt)}">${m.teams[0].short}</b><ul>${scorers(0)}</ul></div>
      <div class="f-score">${scoreHtml(m.score[0], m.score[1])}</div>
      <div class="f-team">${crestSvg(m.teams[1].name, m.teams[1].short, m.teams[1].kit, 4)}<b style="border-bottom:5px solid ${cssHex(kits[1].shirt)}">${m.teams[1].short}</b><ul>${scorers(1)}</ul></div>
    </div>`;
  }

  /**
   * In-match TACTICS & SUBS for the human side, on the app shell (docs/UX.md): one screen, nothing scrolls but the
   * bench list. Left: the formation rail and the XI on the pitch (OVR, stamina and cards on every shirt). Right: the
   * mentality, SUGGESTED SUBS (tired or booked starters off for the best fresh man in the role: one tap each, or SUB
   * ALL) and the bench. A sub is two taps (a starter then a sub, either order) or one drag. RESUME (SECOND HALF at the
   * break) is always on screen, top right; BACK returns to the pause or half-time screen.
   */
  tactics(
    m: Match, side: 0 | 1, kits: [Kit, Kit],
    h: {
      setMentality: (v: number) => void;
      substitute: (slot: number, benchIdx: number) => boolean;
      setFormation?: (id: FormationId) => void;
      back: () => void;
      /** Straight back to the match (the button reads `resumeLabel`, RESUME by default); without it, DONE = back. */
      resume?: () => void;
      resumeLabel?: string;
    },
  ): void {
    const kit = kits[side];
    const light = lum(kit.shirt) > 0.62;
    const d = this.mount(`
      <div class="panel-wrap dim shell">
        <div class="panel shell tactics tx">
          <header class="mc-top">
            <button class="btn btn-white mc-back" data-a="back" aria-label="Back">←<span>BACK</span></button>
            <div class="mc-title"><h2>TACTICS</h2><span class="tx-left"></span></div>
            <button class="btn btn-go tx-resume" data-a="resume">${escHtml(h.resume ? h.resumeLabel ?? 'RESUME' : 'DONE')}</button>
          </header>
          <div class="mc-body sq-body tx-body">
            <div class="pane sq-pitchpane">
              <div class="sq-rail tx-forms" role="group" aria-label="Formation"></div>
              <div class="tx-pitch" style="--shirt:${cssHex(kit.shirt)};--trim:${cssHex(kit.shirt2)};--gk:${cssHex(kit.gk)};--dot-t:${light ? 'var(--ink)' : '#fff'}"></div>
            </div>
            <div class="pane sq-benchpane tx-benchpane">
              <div class="seg tx-ment" role="group" aria-label="Mentality"></div>
              <div class="pane-h"><span class="sq-ph">BENCH</span><span class="grow tx-hint"></span><button class="btn btn-yellow tx-all" data-a="all" hidden>SUB ALL</button></div>
              <div class="pane-scroll sq-list" data-scroll-key="tx-bench">
                <div class="tx-sugg"></div>
                <ul class="sq-grid tx-subs"></ul>
              </div>
            </div>
          </div>
        </div>
      </div>`, 'tactics-screen');
    /** Current pick: a starter (slot) or a bench player waiting for the other half of the swap. */
    let picked: { k: 'x' | 'b'; i: number } | null = null;
    let chosen: FormationId | null = null;
    let fresh = -1;
    const panel = $(d, '.panel.tx');
    const pitch = $(d, '.tx-pitch');
    const bench = $(d, '.tx-subs');
    const sugg = $(d, '.tx-sugg');
    const allBtn = $(d, '[data-a=all]') as HTMLButtonElement;
    let plans: SubPlan[] = [];

    const formation = (): FormationId => {
      const cur = m.slots[side];
      const same = (a: Slot[], b: Slot[]) => a.length === b.length && a.every((s, i) => s.x === b[i].x && s.z === b[i].z && s.role === b[i].role);
      const live = (m as Match & { formation?: FormationId[] }).formation?.[side];
      return FORMATION_IDS.find((id) => FORMATIONS[id] === cur) ?? FORMATION_IDS.find((id) => same(FORMATIONS[id], cur)) ?? live ?? chosen ?? m.teams[side].formation;
    };
    // The sim's limit, read live (it may rise, or differ per match); per-side arrays are fine too.
    const maxSubs = () => {
      const v = (m as Match & { maxSubs: number | readonly number[] }).maxSubs;
      const n = typeof v === 'number' ? v : Array.isArray(v) ? Number(v[side]) : 3;
      return Number.isFinite(n) ? n : 3;
    };
    const subsLeft = () => Math.max(0, maxSubs() - m.subsUsed[side]);
    // A starter and a bench player can swap if subs remain, the starter is still on, and keeper swaps with keeper.
    const canSwap = (slot: number, b: PlayerDef) => {
      const p = m.teamPlayers(side)[slot];
      return subsLeft() > 0 && !!p && !p.sentOff && (slot === 0) === (b.role === 'GK');
    };

    const drawPitch = () => {
      const team = m.teamPlayers(side);
      const pos = pitchLayout(m.slots[side]);
      const benchPick = picked?.k === 'b' ? m.bench[side][picked.i] : null;
      pitch.innerHTML = team
        .map((p, i) => {
          const st = Math.round(p.stamina * 100);
          const col = st > 60 ? 'var(--go)' : st > 35 ? 'var(--yellow)' : 'var(--red)';
          const slot = m.slots[side][i];
          const cls = [
            i === 0 ? 'gk' : '',
            picked?.k === 'x' && picked.i === i ? 'sel' : '',
            p.sentOff ? 'out' : '',
            benchPick && canSwap(i, benchPick) ? 'hot' : benchPick ? 'dim' : '',
            i === fresh ? 'fresh' : '',
            !p.sentOff && slot && p.def.role !== slot.role ? 'warn' : '',
          ].filter(Boolean).join(' ');
          const [l, t, room] = pos[i];
          const booked = !p.sentOff && m.booked.has(p.idx);
          return `<button class="tx-p ${cls}" data-k="x${i}" data-drag="x${i}" style="left:${l}%;top:${t}%;--room:${room}%" ${p.sentOff ? 'disabled' : ''}
            aria-label="${slot?.label ?? ''} ${escHtml(p.def.name)}, overall ${overall(p.def)}, stamina ${st}%${booked ? ', booked' : ''}${p.sentOff ? ', sent off' : ''}">
            <span class="tx-shirt"><b>${p.def.number}</b><i class="tx-ovr">${overall(p.def)}</i><s class="tx-st"><u style="width:${st}%;background:${col}"></u></s></span>
            <em class="tx-nm">${escHtml(lastName(p.def.name))}</em>${booked ? '<i class="tx-card" aria-hidden="true"></i>' : ''}
          </button>`;
        })
        .join('');
    };

    /** SUGGESTED SUBS (meta/squad.ts suggestSubs): tired, then booked, starters off for the best fresh man in the role. */
    const plan = (): SubPlan[] => {
      const onNames = new Set(m.events.flatMap((e) => (e.type === 'sub' && e.side === side ? [e.on] : [])));
      const team = m.teamPlayers(side).map((p) => ({
        slot: p.slot, role: m.slots[side][p.slot]?.role ?? p.def.role, stamina: p.stamina, booked: m.booked.has(p.idx),
        sentOff: p.sentOff, keeper: p.isKeeper, cameOn: onNames.has(p.def.name),
      }));
      return suggestSubs(team, m.bench[side], subsLeft()).filter((s) => {
        const on = m.bench[side].find((b) => b.id === s.onId);
        return !!on && canSwap(s.slot, on);
      });
    };

    const chip = (p: PlayerDef) => `<i class="sq-num">${p.number}</i><span class="sq-nm">${escHtml(lastName(p.name))}</span>`;

    const drawBench = () => {
      const list = m.bench[side];
      const x = picked?.k === 'x' ? picked.i : -1;
      bench.innerHTML = list.length
        ? list
            .map((p, i) => {
              const ok = x >= 0 ? canSwap(x, p) : subsLeft() > 0;
              const sel = picked?.k === 'b' && picked.i === i;
              return `<li><button class="sq-chip r-${p.role} ${sel ? 'sel' : ''} ${ok ? (x >= 0 ? 'hot' : '') : 'off'}" data-k="b${i}" data-drag="b${i}" ${ok ? '' : 'aria-disabled="true"'}
                aria-label="${escHtml(p.name)}, ${p.role}, overall ${overall(p)}">${chip(p)}<em class="sq-role">${p.role}</em><b class="sq-ovr">${overall(p)}</b></button></li>`;
            })
            .join('')
        : '<li class="tx-empty">Nobody left on the bench.</li>';
      const left = subsLeft();
      const team = m.teamPlayers(side);
      plans = left > 0 && !picked ? plan() : [];
      sugg.innerHTML = plans.length
        ? `<div class="sq-sub">SUGGESTED</div>${plans
            .map((s, i) => {
              const off = team[s.slot];
              const on = list.find((b) => b.id === s.onId)!;
              const st = Math.round(off.stamina * 100);
              const mark = s.reason === 'booked'
                ? '<i class="tx-sg-yc" aria-hidden="true"></i>'
                : `<s class="tx-sg-st" aria-hidden="true"><u style="width:${st}%;background:${st > 35 ? 'var(--yellow)' : 'var(--red)'}"></u></s>`;
              return `<button class="tx-sg" data-sg="${i}" aria-label="Sub ${escHtml(off.def.name)} (${s.reason === 'booked' ? 'booked' : `stamina ${st}%`}) off for ${escHtml(on.name)}">
                <span class="tx-sg-off r-${off.def.role}">${chip(off.def)}${mark}</span><i class="tx-sg-arrow" aria-hidden="true">→</i><span class="tx-sg-on r-${on.role}">${chip(on)}</span><b class="tx-sg-go">SUB</b>
              </button>`;
            })
            .join('')}${list.length ? '<div class="sq-sub">BENCH</div>' : ''}`
        : '';
      allBtn.hidden = plans.length < 2;
      allBtn.textContent = `SUB ALL ${plans.length}`;
      $(d, '.tx-left').textContent = left > 0 ? `${left} OF ${maxSubs()} SUBS LEFT` : 'NO SUBS LEFT';
      $(d, '.tx-left').classList.toggle('none', left <= 0);
      // One hint line, until the first sub of the session.
      const hint = $(d, '.tx-hint');
      hint.innerHTML =
        left <= 0 ? '<b class="sq-hint">NO SUBS LEFT</b>'
          : picked?.k === 'x' ? `<b class="sq-hint sel">${escHtml(lastName(team[picked.i].def.name).toUpperCase())} OFF: PICK A SUB</b>`
            : picked?.k === 'b' ? `<b class="sq-hint sel">${escHtml(lastName(list[picked.i]?.name ?? '').toUpperCase())} ON: PICK WHO GOES OFF</b>`
              : Menus.subbedOnce ? '' : '<b class="sq-hint">TAP OR DRAG TO SUB</b>';
    };

    const drawForms = () => {
      const cur = formation();
      const el = $(d, '.tx-forms');
      el.innerHTML = FORMATION_IDS.map((f) => `<button class="${f === cur ? 'on' : ''}" data-f="${f}" aria-pressed="${f === cur}" ${h.setFormation ? '' : 'disabled'}>${f}</button>`).join('');
    };
    const drawMent = () => {
      const labels = ['DEFENSIVE', 'BALANCED', 'ATTACKING'];
      $(d, '.tx-ment').innerHTML = labels.map((l, i) => `<button class="${m.mentality[side] === i - 1 ? 'on' : ''}" data-i="${i}" aria-pressed="${m.mentality[side] === i - 1}">${l}</button>`).join('');
    };
    const draw = () => {
      drawPitch();
      drawBench();
      fresh = -1;
    };

    const tryPair = (slot: number, benchIdx: number) => {
      const p = m.bench[side][benchIdx];
      if (!p || !canSwap(slot, p)) return false;
      if (!h.substitute(slot, benchIdx)) return false;
      sfx.coin();
      buzz('tap');
      fresh = slot;
      Menus.subbedOnce = true;
      return true;
    };
    /** A suggestion, by the bench player's id (the bench reorders as changes are made). */
    const applyPlan = (s: SubPlan) => {
      const bi = m.bench[side].findIndex((b) => b.id === s.onId);
      return bi >= 0 && tryPair(s.slot, bi);
    };

    d.addEventListener('click', (e) => {
      const t = e.target as Element;
      const f = t.closest<HTMLButtonElement>('.tx-forms button');
      if (f && !f.disabled) {
        sfx.click();
        const id = f.dataset.f as FormationId;
        chosen = id;
        h.setFormation?.(id);
        drawForms();
        draw();
        return;
      }
      const mb = t.closest<HTMLButtonElement>('.tx-ment button');
      if (mb) {
        sfx.click();
        h.setMentality(Number(mb.dataset.i) - 1);
        drawMent();
        return;
      }
      const sg = t.closest<HTMLButtonElement>('.tx-sg');
      if (sg) {
        const s = plans[Number(sg.dataset.sg)];
        if (s && applyPlan(s)) {
          picked = null;
          draw();
        }
        return;
      }
      if (t.closest('[data-a=all]')) {
        for (const s of [...plans]) applyPlan(s);
        picked = null;
        draw();
        return;
      }
      const btn = t.closest<HTMLButtonElement>('.tx-p, .sq-chip');
      if (!btn || btn.disabled) return;
      sfx.click();
      const k = btn.dataset.k!;
      const idx = Number(k.slice(1));
      if (k[0] === 'x') {
        if (picked?.k === 'b') {
          if (tryPair(idx, picked.i)) picked = null;
          else picked = { k: 'x', i: idx };
        } else picked = picked?.k === 'x' && picked.i === idx ? null : { k: 'x', i: idx };
      } else {
        if (btn.classList.contains('off')) return;
        if (picked?.k === 'x') {
          if (tryPair(picked.i, idx)) picked = null;
        } else picked = picked?.k === 'b' && picked.i === idx ? null : { k: 'b', i: idx };
      }
      draw();
    });
    // Drag a starter onto a sub (or a sub onto a starter): the same change as the two taps (src/ui/dragSwap.ts).
    const pair = (a: string, b: string): [number, number] | null => {
      if (a[0] === b[0]) return null;
      const [x, s] = a[0] === 'x' ? [a, b] : [b, a];
      return [Number(x.slice(1)), Number(s.slice(1))];
    };
    this.cleanups.push(
      bindDragSwap(panel, {
        canDrop: (a, b) => {
          const p = pair(a, b);
          const on = p ? m.bench[side][p[1]] : undefined;
          return !!p && !!on && canSwap(p[0], on);
        },
        onDrop: (a, b) => {
          const p = pair(a, b);
          if (p && tryPair(p[0], p[1])) {
            picked = null;
            draw();
          }
        },
      }),
    );
    drawForms();
    drawMent();
    draw();
    $(d, '[data-a=back]').addEventListener('click', h.back);
    $(d, '[data-a=resume]').addEventListener('click', h.resume ?? h.back);
    // ESC goes back to the pause (or half-time) screen.
    this.listenKey((e) => {
      if (e.code === 'Escape') h.back();
    });
  }

  /** The tactics hint ("TAP OR DRAG TO SUB") shows until the first sub of the session. */
  private static subbedOnce = false;

  /**
   * Half time, the full-time screen's sibling (the owner: "i'm not happy with the half time menu, looks weird asf and
   * out of place"): the same shell and the same chunky blocks. The score with both crests and the scorers, the best
   * player so far in a dark block (as man of the match is at full time), four key numbers as two-sided bars
   * (possession, shots, on target, passes). One tidy row of quick actions at the bottom left, TACTICS & SUBS, CONTROLS,
   * SETTINGS and QUIT (FORFEIT where walking off is a defeat), and the big SECOND HALF at the bottom right. QUIT asks
   * first and says what it costs (`quitNote`).
   */
  halftime(m: Match, kits: [Kit, Kit], onContinue: () => void, onTactics?: () => void, more: HalftimeMore = {}): void {
    const quitWord = more.forfeit ? 'FORFEIT' : 'QUIT';
    const quick = [
      onTactics ? '<button class="btn btn-blue" data-a="tactics">TACTICS &amp; SUBS</button>' : '',
      more.howto ? '<button class="btn btn-white" data-a="howto">CONTROLS</button>' : '',
      more.settings ? '<button class="btn btn-white" data-a="settings">SETTINGS</button>' : '',
      more.quit ? `<button class="btn btn-red hf-quit" data-a="quit">${quitWord}</button>` : '',
    ].join('');
    const best = more.ratings?.[0];
    const def = best ? m.players[best.idx]?.def : undefined;
    const bestKit = best ? kits[best.side === 1 ? 1 : 0] : undefined;
    const bestLine = best
      ? [m.teams[best.side === 1 ? 1 : 0].short, best.goals ? `${best.goals} ${best.goals > 1 ? 'GOALS' : 'GOAL'}` : '', best.assists ? `${best.assists} ${best.assists > 1 ? 'ASSISTS' : 'ASSIST'}` : ''].filter(Boolean).join(sep())
      : '';
    const bestHtml = best && def && bestKit
      ? `<div class="ft-motm ht-best" style="--k:${cssHex(bestKit.shirt)}">${faceHtml(def, bestKit)}<span>BEST PLAYER</span><b>${escHtml(best.name)}<small>${bestLine}</small></b><em>${best.rating.toFixed(1)}</em></div>`
      : '';
    // Then two more of yours (as full time lists them), if the best player is not yours or there are more.
    const hs = m.cfg.humanSide;
    const face = (r: { idx: number; side: number }, cls = '') => {
      const pd = m.players[r.idx]?.def;
      const pk = kits[r.side === 1 ? 1 : 0];
      return pd && pk ? faceHtml(pd, pk, cls) : '';
    };
    const next = hs === 0 || hs === 1 ? (more.ratings ?? []).filter((r) => r.side === hs && r !== best).slice(0, 2) : [];
    const nextHtml = next.length
      ? `<ul class="ratings">${next.map((r) => `<li>${face(r, 'sm')}<span>${escHtml(r.name)}</span><b class="${r.rating >= 7.5 ? 'hi' : r.rating < 6 ? 'lo' : ''}">${r.rating.toFixed(1)}</b></li>`).join('')}</ul>`
      : '';
    const d = this.mount(`
      <div class="panel-wrap dim shell">
        <div class="panel mc shell ft-panel ht-panel">
          ${shellTop('<span class="verdict half">HALF TIME</span>', 'FIRST HALF', '', '').replace('class="mc-top"', 'class="mc-top hf-top"')}
          <div class="mc-body ft-body ht-body">
            <div class="pane ft-match">
              ${this.scoreHeader(m, kits)}
              ${bestHtml}${nextHtml}
            </div>
            <div class="pane ht-stats">
              ${this.halfStats(m, kits)}
            </div>
          </div>
          <div class="mc-actions hf-actions">
            <div class="hf-quick">${quick}</div>
            <button class="btn btn-go btn-lg" data-a="go">SECOND HALF</button>
          </div>
          <div class="quit-ask hf-ask" hidden>
            <p class="fine big">${escHtml(more.quitNote ?? "This match won't count.")}</p>
            <div class="hf-ask-row">
              <button class="btn btn-red" data-a="really">${more.forfeit ? 'YES, FORFEIT' : 'YES, QUIT'}</button>
              <button class="btn btn-go btn-lg" data-a="stay">KEEP PLAYING</button>
            </div>
          </div>
        </div>
      </div>`, 'ht');
    hydrateFaces(d);
    const title = $(d, '.mc-title h2');
    const titleHtml = title.innerHTML;
    const ask = $(d, '.hf-ask');
    const parts = [$(d, '.ht-body'), $(d, '.hf-actions')];
    const top = $(d, '.hf-top');
    let asking = false;
    const setAsking = (on: boolean) => {
      asking = on;
      for (const el of parts) el.hidden = on;
      // (The header's buttons keep their places, unseen: the title stays centred.)
      top.classList.toggle('asking', on);
      ask.hidden = !on;
      if (on) title.textContent = more.forfeit ? 'FORFEIT MATCH?' : 'QUIT MATCH?';
      else title.innerHTML = titleHtml;
      $<HTMLButtonElement>(d, on ? '[data-a=stay]' : '[data-a=go]').focus();
    };
    const go = () => {
      this.stopKey(key);
      onContinue();
    };
    // SPACE / ENTER start the second half (never while the quit question is up: there they keep him playing); ESC
    // closes the question.
    const key = (e: KeyboardEvent) => {
      if (asking) {
        if (e.code === 'Escape') setAsking(false);
        return;
      }
      if ((e.code === 'Space' || e.code === 'Enter') && !(e.target as HTMLElement | null)?.closest?.('button')) go();
    };
    this.listenKey(key);
    $(d, '[data-a=go]').addEventListener('click', go);
    const leave = (fn?: () => void) => () => {
      this.stopKey(key);
      fn?.();
    };
    d.querySelector('[data-a=tactics]')?.addEventListener('click', leave(onTactics));
    d.querySelector('[data-a=howto]')?.addEventListener('click', leave(more.howto));
    d.querySelector('[data-a=settings]')?.addEventListener('click', leave(more.settings));
    d.querySelector('[data-a=quit]')?.addEventListener('click', () => setAsking(true));
    $(d, '[data-a=stay]').addEventListener('click', () => setAsking(false));
    $(d, '[data-a=really]').addEventListener('click', leave(more.quit));
  }

  fulltime(
    m: Match, kits: [Kit, Kit], humanSide: number, reward: { coins: number; label: string }, canDouble: boolean,
    h: { double: () => Promise<boolean>; next: () => void; nextLabel?: string; rematch?: () => void },
    ratings?: { idx: number; name: string; side: number; rating: number; goals: number; assists: number }[],
    prog?: FtProgress,
    extra: FtExtras = {},
  ): void {
    if (extra.noAds) canDouble = false;
    const motm = ratings?.[0];
    const mine = ratings?.filter((r) => r.side === humanSide).slice(0, 3) ?? [];
    // Head shots: the player as he looked on the pitch, in the kit his side wore.
    const face = (r: { idx: number; side: number }, cls = '') => {
      const def = m.players[r.idx]?.def;
      const kit = kits[r.side === 1 ? 1 : 0];
      return def && kit ? faceHtml(def, kit, cls) : '';
    };
    const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;
    const motmLine = motm ? [motm.goals ? plural(motm.goals, 'goal') : '', motm.assists ? plural(motm.assists, 'assist') : ''].filter(Boolean).join(sep()) : '';
    const motmHtml = motm
      ? `<div class="ft-motm" style="--k:${cssHex(kits[motm.side].shirt)}">${face(motm)}<span>MAN OF THE MATCH</span><b>${motm.name}${motmLine ? `<small>${motmLine}</small>` : ''}</b><em>${motm.rating.toFixed(1)}</em></div>
        ${mine.length ? `<ul class="ratings">${mine.map((r) => `<li>${face(r, 'sm')}<span>${r.name}</span><b class="${r.rating >= 7.5 ? 'hi' : r.rating < 6 ? 'lo' : ''}">${r.rating.toFixed(1)}</b></li>`).join('')}</ul>` : ''}`
      : '';
    const my = m.score[humanSide];
    const their = m.score[humanSide === 0 ? 1 : 0];
    // A level knockout tie is settled on penalties.
    const so = m.shootout && m.shootout.winner >= 0 ? m.shootout : null;
    const res = so ? (so.winner === humanSide ? 1 : -1) : Math.sign(my - their);
    const verdict = res > 0 ? 'YOU WIN!' : res === 0 ? 'DRAW' : 'YOU LOSE';
    const cls = res > 0 ? 'win' : res === 0 ? 'draw' : 'lose';
    const pens = so
      ? `${m.teams[so.winner as 0 | 1].short} WIN ${so.kicks[so.winner as 0 | 1].filter(Boolean).length}${SCORE_SEP_HTML}${so.kicks[so.winner === 0 ? 1 : 0].filter(Boolean).length} ON PENALTIES`
      : '';
    // Progression: the stars and the XP bar (it counts up after the coins); the extras get a list of their own.
    const lv0 = prog ? levelOf(prog.xpFrom) : null;
    const nu = prog ? nextUnlock(prog.xpTo, prog.owned) : null;
    const progHtml = prog && lv0
      ? `<div class="ft-prog">
          <div class="ft-stars" role="img" aria-label="${prog.stars} of 3 stars">${[1, 2, 3].map((i) => `<i class="${i <= prog.stars ? 'lit' : ''}" style="--i:${i}">★</i>`).join('')}</div>
          <div class="ft-xp">
            <div class="ft-xp-h"><b class="ft-lv">LV ${lv0.level}</b><span class="ft-title">${levelTitle(lv0.level).toUpperCase()}</span><em class="ft-xp-n">+0 XP</em></div>
            <div class="ft-xp-bar"><i style="width:${Math.round((lv0.into / lv0.need) * 100)}%"></i></div>
            <div class="ft-levelup" aria-live="polite"></div>
            ${nu ? `<div class="ft-next">NEXT UNLOCK: <b>${nu.name.toUpperCase()}</b>${sep()}LV ${nu.level}${sep()}${nu.xpLeft} XP</div>` : ''}
          </div>
        </div>`
      : '';
    const extras = [
      extra.showtime ? this.showtimeRow(extra.showtime) : '',
      prog && prog.streak >= 1 && prog.mult > 1 ? `<div class="ft-streak">${pixelIcon('fire', '#ff9a3a', 2, 'inl')}${prog.streak} WIN STREAK <b>×${prog.mult.toFixed(1)}</b></div>` : '',
      extra.tryEasy ? '<p class="ft-easy">Tough run? <button class="btn btn-white ft-easy-btn" data-a="easy">TRY EASY</button></p>' : '',
      prog?.done.length ? `<ul class="ft-daily">${prog.done.map((c) => `<li><span>✓ ${c.text}</span><b>${c.coins ? `+${c.coins}` : ''}</b></li>`).join('')}</ul>` : '',
      extra.tierUps?.length ? `<ul class="ft-tiers">${extra.tierUps.map((t) => `<li>${escHtml(t)}</li>`).join('')}</ul>` : '',
      extra.shopReach ? `<p class="ft-shop">IN REACH IN THE SHOP: <b>${escHtml(extra.shopReach.name.toUpperCase())}</b> ${escHtml(extra.shopReach.kind.toLowerCase())}</p>` : '',
      this.clipRow(extra.clip, true),
    ].join('');
    // One screen (docs/UX.md): the match on the left (the score, then man of the match and the stats in a list of
    // their own), what you earned on the right (the coins with 2x COINS beside them, the stars and the XP bar, then
    // the extras), REMATCH and CONTINUE pinned. The verdict is the header.
    const d = this.mount(`
      <div class="panel-wrap dim shell">
        <div class="panel mc shell ft-panel">
          ${shellTop(`<span class="verdict ${cls}">${verdict}</span>`, pens || 'FULL TIME', '', '')}
          <div class="mc-body ft-body">
            <div class="pane ft-match">
              ${this.scoreHeader(m, kits)}
              <div class="pane-scroll ft-scroll">${motmHtml}${this.statsTable(m, kits)}</div>
            </div>
            <div class="pane ft-gain">
              <div class="ft-earn">
                <div class="reward"><i></i><span class="rw-n">+0</span><em>${reward.label}</em></div>
                ${canDouble ? `<button class="btn btn-yellow ft-dbl" data-a="double">${pixelIcon('film', '#26262e', 2, 'inl')}2× COINS</button>` : ''}
              </div>
              ${progHtml}
              ${extras ? `<div class="pane-scroll ft-extra">${extras}</div>` : ''}
            </div>
          </div>
          <div class="mc-actions">
            ${h.rematch ? '<button class="btn btn-white" data-a="rematch">⟳ REMATCH</button>' : ''}
            <button class="btn btn-go btn-lg" data-a="next">${h.nextLabel ?? 'CONTINUE'}</button>
          </div>
        </div>
      </div>`, 'ft');
    const n = $(d, '.rw-n');
    let shown = 0;
    const count = (to: number) => {
      const from = shown;
      const t0 = performance.now();
      const tick = () => {
        const k = Math.min(1, (performance.now() - t0) / 900);
        shown = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
        n.textContent = `+${shown}`;
        if (k < 1) requestAnimationFrame(tick);
      };
      tick();
      sfx.coin();
    };
    hydrateFaces(d);
    setTimeout(() => count(reward.coins), 350);
    if (prog) this.playProgress(d, prog);
    const dbl = d.querySelector<HTMLButtonElement>('[data-a=double]');
    const nextBtn = $<HTMLButtonElement>(d, '[data-a=next]');
    dbl?.addEventListener('click', async () => {
      dbl.disabled = true;
      nextBtn.disabled = true;
      const ok = await h.double().finally(() => (nextBtn.disabled = false));
      if (ok) {
        count(reward.coins * 2);
        dbl.textContent = 'DOUBLED!';
      } else {
        dbl.textContent = 'AD UNAVAILABLE';
      }
    });
    $(d, '[data-a=next]').addEventListener('click', h.next);
    if (h.rematch) d.querySelector('[data-a=rematch]')?.addEventListener('click', h.rematch);
    const easy = d.querySelector<HTMLButtonElement>('[data-a=easy]');
    easy?.addEventListener('click', () => {
      extra.tryEasy?.();
      easy.disabled = true;
      easy.textContent = 'EASY IS SET';
    });
    this.wireClip(d, extra.clip);
  }

  /** Full time's SHOWTIME line: the grade letter, the points, the coins it added, NEW BEST or the best to beat. */
  private showtimeRow(st: NonNullable<FtExtras['showtime']>): string {
    const g = /^[SABC]$/.test(st.grade) ? st.grade : 'C';
    const best = st.newBest ? '<small class="nb">NEW BEST</small>' : st.best ? `<small>BEST ${escHtml(st.best)}</small>` : '';
    return `<div class="ft-show" data-g="${g}" aria-label="Showtime grade ${g}, ${st.score} points">
        <b class="ft-grade">${g}</b><span>SHOWTIME <em>${Math.round(st.score).toLocaleString()}</em></span>
        ${st.bonus > 0 ? `<strong>+${Math.round(st.bonus * 100)}% COINS</strong>` : ''}${best}
      </div>`;
  }

  /**
   * SAVE CLIP / SHARE for the last goal (the session's clip API). Nothing at all when the browser can't
   * record or there is no clip yet. `big` = the full-time layout (a labelled row).
   */
  private clipRow(src?: ClipSource, big = false): string {
    const c = src?.clip();
    if (!c || !this.clipActions) return '';
    return `<div class="clip-row ${big ? 'big' : ''}">
        ${big ? '<span class="clip-l">GOAL CLIP</span>' : ''}
        <button class="btn btn-white" data-a="clip-save">SAVE CLIP</button>
        <button class="btn btn-blue" data-a="clip-share">SHARE</button>
      </div>`;
  }

  private wireClip(d: HTMLElement, src?: ClipSource): void {
    const act = this.clipActions;
    if (!src || !act) return;
    const saveBtn = d.querySelector<HTMLButtonElement>('[data-a=clip-save]');
    const shareBtn = d.querySelector<HTMLButtonElement>('[data-a=clip-share]');
    saveBtn?.addEventListener('click', () => {
      const c = src.clip();
      if (!c) return;
      act.save(c);
      saveBtn.textContent = 'SAVED';
    });
    shareBtn?.addEventListener('click', async () => {
      const c = src.clip();
      if (!c) return;
      shareBtn.disabled = true;
      const r = await act.share(c).catch(() => 'cancelled' as const);
      shareBtn.disabled = false;
      if (r !== 'cancelled') shareBtn.textContent = r === 'shared' ? 'SHARED' : 'SAVED';
    });
  }

  /** A small message over the menu (a locked tile: what opens it). Plain text; gone after a couple of seconds. */
  toast(text: string): void {
    this.root.querySelector('.menu-toast')?.remove();
    const t = document.createElement('div');
    t.className = 'menu-toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    this.root.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  /**
   * LEARN THE BASICS done: the three ticks and FIRST MATCH (straight to the kick-off) or MENU. A natural stop,
   * and still no ad (the first match isn't played yet).
   */
  basicsDone(h: { play: () => void; menu: () => void }): void {
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow basics-done">
          <h2 class="verdict win">YOU'RE READY!</h2>
          <ul class="bd-steps">
            <li><b>✓</b>PASS</li><li><b>✓</b>SHOOT</li><li><b>✓</b>CROSS</li>
          </ul>
          <p class="fine big">Score in your first match to open every mode.</p>
          <div class="btn-row">
            <button class="btn btn-white" data-a="menu">MENU</button>
            <button class="btn btn-go btn-lg pulse" data-a="play">FIRST MATCH ▸</button>
          </div>
        </div>
      </div>`, 'basics-screen');
    const go = () => {
      this.stopKey(key);
      h.play();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') go();
    };
    this.listenKey(key);
    $(d, '[data-a=play]').addEventListener('click', go);
    $(d, '[data-a=menu]').addEventListener('click', () => {
      this.stopKey(key);
      h.menu();
    });
  }

  /** The first goal opened the locked modes: shown once, over the main menu. */
  unlocked(onOk: () => void): void {
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow unlocked-panel">
          <h2 class="verdict win">UNLOCKED!</h2>
          <p class="fine big">Your first goal. The whole game is open:</p>
          <ul class="ul-new">
            <li>${pixelIcon('trophy', '#ffd23a', 3)}<b>ROAD TO GLORY</b><span>build a club, climb eight divisions</span></li>
            <li>${pixelIcon('star', '#ffd23a', 3)}<b>MOMENTS</b><span>short challenges for stars</span></li>
            <li>${pixelIcon('trophy', '#ff8a2a', 3)}<b>CLUB RUN</b><span>seven matches, one life, a perk a win</span></li>
            <li><i class="ul-bolt" aria-hidden="true">${pixelIcon('bolt', '#8a5cf6', 2.2)}</i><b>BLITZ</b><span>football with power-ups</span></li>
          </ul>
          <div class="btn-row"><button class="btn btn-go btn-lg" data-a="ok">LET'S GO</button></div>
        </div>
      </div>`, 'unlocked-screen');
    $(d, '[data-a=ok]').addEventListener('click', onOk);
  }

  /** Full time: the stars pop in one by one, then the XP bar counts up (a level-up splashes and the bar starts over). */
  private playProgress(d: HTMLElement, prog: FtProgress): void {
    const stars = d.querySelectorAll<HTMLElement>('.ft-stars i.lit');
    stars.forEach((el, i) => setTimeout(() => {
      el.classList.add('on');
      sfx.click();
    }, 600 + i * 320));
    const bar = d.querySelector<HTMLElement>('.ft-xp-bar i');
    const lvEl = d.querySelector<HTMLElement>('.ft-lv');
    const titleEl = d.querySelector<HTMLElement>('.ft-title');
    const nEl = d.querySelector<HTMLElement>('.ft-xp-n');
    const up = d.querySelector<HTMLElement>('.ft-levelup');
    if (!bar || !lvEl || !titleEl || !nEl || !up) return;
    const gain = Math.max(0, prog.xpTo - prog.xpFrom);
    let level = levelOf(prog.xpFrom).level;
    const start = 1300 + stars.length * 320;
    const dur = 900 + Math.min(900, gain * 3);
    setTimeout(() => {
      const t0 = performance.now();
      const tick = () => {
        if (!d.isConnected) return;
        const k = Math.min(1, (performance.now() - t0) / dur);
        const xp = prog.xpFrom + gain * (1 - Math.pow(1 - k, 3));
        const lv = levelOf(xp);
        nEl.textContent = `+${Math.round(xp - prog.xpFrom)} XP`;
        bar.style.width = `${Math.round((lv.into / lv.need) * 100)}%`;
        if (lv.level !== level) {
          level = lv.level;
          lvEl.textContent = `LV ${lv.level}`;
          titleEl.textContent = levelTitle(lv.level).toUpperCase();
          up.innerHTML = `<b>LEVEL UP!</b><span>LV ${lv.level}${sep()}${levelTitle(lv.level).toUpperCase()}</span>`;
          up.classList.remove('on');
          void up.offsetWidth;
          up.classList.add('on');
          sfx.coin();
          buzz('success');
        }
        if (k < 1) requestAnimationFrame(tick);
      };
      tick();
    }, start);
  }

  /**
   * The whole unlock ladder, from the level badge: every ball look and celebration with the level that earns it
   * (earned ones lit, the next one marked with the XP still needed) and LEGEND difficulty by match stars. Only
   * what the game really has (core/save unlockLadder): nothing here is a promise.
   */
  unlocks(save: SaveData, onBack: () => void, onBadges?: () => void): void {
    const xp = save.progress.xp;
    const lv = levelOf(xp);
    const ladder = unlockLadder();
    // (Bought in the SHOP counts as yours too: the level then brings nothing new.)
    const shopped = (u: { kind: string; id: string }) => shopOf(save).owned.includes(`${u.kind}:${u.id}`);
    const nextLevel = ladder.find((u) => u.level > lv.level && !shopped(u))?.level ?? 0;
    const earned = ladder.filter((u) => u.level <= lv.level || shopped(u)).length;
    // One card per unlock, left to right in level order (the ladder), the next one lit; LEGEND by stars at the end.
    const cards = ladder.map((u) => {
      const got = u.level <= lv.level || shopped(u);
      const next = u.level === nextLevel;
      const icon = u.kind === 'ball'
        ? pixelIcon('ball', got ? (u.id === 'classic' ? '#26262e' : BALL_TINT[u.id as BallSkinId] ?? '#26262e') : '#b9b5aa', 4)
        : pixelIcon('star', got ? '#ffd23a' : '#b9b5aa', 4);
      const when = u.level > lv.level && got ? 'BOUGHT' : got ? 'EARNED' : next ? `${Math.max(0, xpAt(u.level) - xp)} XP` : `LV ${u.level}`;
      const name = u.name.replace(/ (ball|celebration)$/i, '').toUpperCase();
      return `<li class="ul-card ${got ? 'got' : ''}${next ? ' next' : ''}"><i class="ul-lv">LV ${u.level}</i><span class="ul-ic">${icon}</span><b>${escHtml(name)}</b><small>${u.kind === 'ball' ? 'BALL' : 'CELEBRATION'}</small><em>${when}</em></li>`;
    }).join('');
    const stars = save.progress.stars;
    const legend = legendUnlocked(save.progress);
    const d = this.mount(`
      <div class="panel-wrap dim shell">
        <div class="panel shell ul">
          ${shellTop('UNLOCKS', `LV ${lv.level}${sep()}${escHtml(levelTitle(lv.level).toUpperCase())}`, `<span class="ul-xp">${lv.into} / ${lv.need} XP</span>`)}
          <div class="ul-xpbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((lv.into / lv.need) * 100)}" aria-label="XP to the next level"><i style="width:${Math.round((lv.into / lv.need) * 100)}%"></i></div>
          <div class="mc-body ul-body">
            <section class="pane">
              <div class="pane-h"><span>${earned}/${ladder.length} EARNED</span><span class="grow"></span><span class="ul-how">XP FROM EVERY MATCH</span></div>
              <div class="pane-scroll x ul-rail" data-scroll-key="ul">
                <ol class="ul-track" aria-label="Unlock ladder">
                  ${cards}
                  <li class="ul-card legend ${legend ? 'got' : ''} ${!legend && !nextLevel ? 'next' : ''}"><i class="ul-lv">★ ${LEGEND_STARS}</i><span class="ul-ic">${pixelIcon('trophy', legend ? '#ffd23a' : '#b9b5aa', 4)}</span><b>LEGEND</b><small>DIFFICULTY</small><em>${legend ? 'EARNED' : `${Math.min(stars, LEGEND_STARS)}/${LEGEND_STARS} ★`}</em></li>
                </ol>
              </div>
            </section>
          </div>
          ${onBadges ? '<div class="mc-actions"><button class="btn btn-blue" data-a="badges">JOURNEYS AND BADGES</button></div>' : ''}
        </div>
      </div>`, 'unlocks');
    $(d, '[data-a=back]').addEventListener('click', onBack);
    d.querySelector('[data-a=badges]')?.addEventListener('click', () => onBadges?.());
    this.listenKey((e) => {
      if (e.code === 'Escape') onBack();
    });
    // The track opens on the next unlock, one earned card still showing before it.
    const rail = d.querySelector<HTMLElement>('.ul-rail');
    const next = rail?.querySelector<HTMLElement>('.ul-card.next');
    if (rail && next) rail.scrollLeft = Math.max(0, next.offsetLeft - next.offsetWidth - 24);
  }

  /**
   * Full time of a Football Moment: MOMENT COMPLETE / FAILED, the stars popping in, the seconds left, the XP
   * earned (counted onto the level bar, a level-up splashing as on the match screen) and RETRY / NEXT MOMENT /
   * MENU. No coins: moments pay in XP only (main.ts awards it before calling this).
   */
  momentResult(
    spec: Pick<ScenarioSpec, 'id' | 'title'>, o: ScenarioOutcome, xp: { from: number; to: number; owned?: readonly string[] },
    h: { retry: () => void; next: () => void; nextLabel?: string; menu: () => void },
  ): void {
    const lv0 = levelOf(xp.from);
    const nu = nextUnlock(xp.to, xp.owned);
    const left = Math.max(0, Math.round(o.secondsLeft));
    // One screen: MENU at the top left, the verdict and the moment in the header, the stars, the time left and the XP
    // bar in the middle, RETRY and NEXT pinned (NEXT the biggest).
    const d = this.mount(`
      <div class="panel-wrap dim shell">
        <div class="panel mc shell mo-panel">
          ${shellTop(`<span class="verdict ${o.won ? 'win' : 'lose'}">${o.won ? 'MOMENT COMPLETE' : 'FAILED'}</span>`, escHtml(spec.title), '', 'MENU')}
          <div class="mc-body mo-body">
            <div class="ft-prog">
              <div class="ft-stars" role="img" aria-label="${o.stars} of 3 stars">${[1, 2, 3].map((i) => `<i class="${i <= o.stars ? 'lit' : ''}" style="--i:${i}">★</i>`).join('')}</div>
              <p class="mo-left ${o.won ? 'won' : ''}">${o.won ? `${left} SECOND${left === 1 ? '' : 'S'} LEFT` : left > 0 ? 'NOT THIS TIME' : 'TIME UP'}</p>
              <div class="ft-xp">
                <div class="ft-xp-h"><b class="ft-lv">LV ${lv0.level}</b><span class="ft-title">${levelTitle(lv0.level).toUpperCase()}</span><em class="ft-xp-n">+0 XP</em></div>
                <div class="ft-xp-bar"><i style="width:${Math.round((lv0.into / lv0.need) * 100)}%"></i></div>
                <div class="ft-levelup" aria-live="polite"></div>
                ${nu ? `<div class="ft-next">NEXT UNLOCK: <b>${nu.name.toUpperCase()}</b>${sep()}LV ${nu.level}${sep()}${nu.xpLeft} XP</div>` : ''}
              </div>
            </div>
          </div>
          <div class="mc-actions">
            <button class="btn btn-yellow" data-a="retry">⟳ RETRY</button>
            <button class="btn btn-go btn-lg" data-a="next">${escHtml(h.nextLabel ?? 'NEXT MOMENT')}</button>
          </div>
        </div>
      </div>`, 'ft moment');
    this.playProgress(d, { stars: o.stars, xpFrom: xp.from, xpTo: xp.to, streak: 0, mult: 1, done: [] });
    $(d, '[data-a=back]').addEventListener('click', h.menu);
    $(d, '[data-a=retry]').addEventListener('click', h.retry);
    $(d, '[data-a=next]').addEventListener('click', h.next);
  }

  developerAbout(onBack: () => void): void {
    const d = this.mount(developerAboutHtml(), 'developer-about');
    $(d, '[data-a=back]').addEventListener('click', onBack);
    this.listenKey((e) => {
      if (e.code === 'Escape') onBack();
    });
  }

  /**
   * Settings, one screen per tab (docs/UX.md): slim tabs, the rows two by two, each row one line (its name and its
   * value), and one hint line under them. GENERAL holds the most used first (sound, music, graphics, text size,
   * vibration in the app, camera, then crowd, commentary, colour blind, quick subs); CONTROLS the pass assistance,
   * switching, finishing and the thumbstick (the hint line says what the value just picked does); KEYS rebinds the
   * keyboard and the gamepad, each list scrolling in its own pane; MORE the ball look and celebration earned by
   * levelling up, BACKUP (`opts.backup`: the main menu offers it, the pause menu not) and FEEDBACK. REMOVE ADS sits in
   * the header on every tab where the app sells it. `tab` picks the one shown first (the pause menu opens on
   * CONTROLS; GENERAL, the main menu's, comes back to the session's last tab). Every change is saved and applied at
   * once via onChange.
   */
  settings(
    save: SaveData, onChange: () => void, onBack: () => void, tab: SettingsTab = 'general',
    opts: {
      backup?: () => void;
      account?: () => void;
      invite?: () => void;
      about?: () => void;
      /** REMOVE ADS, in the header (the app): its price, whether it is owned, and the purchase (true once bought). */
      removeAds?: { price: string; owned: boolean; buy: () => Promise<boolean> };
    } = {},
  ): void {
    const s = save.settings;
    // CONTROLS: a switch is one tappable row (its ON / OFF chip on the right); a level shows its values beside its
    // name. (VIBRATION lives in GENERAL, the app only: its lines still come from CONTROL_ROWS for the hint.)
    // (AUTO SPRINT is for keys and a gamepad: on touch there is no SPRINT button, the stick always sprints.)
    const rows = CONTROL_ROWS.filter((r) => r.k !== 'vibration' && !(r.k === 'autoSprint' && currentDevice() === 'touch'));
    const vibRow = CONTROL_ROWS.find((r) => r.k === 'vibration');
    const ctlRow = (r: ControlRow) => {
      if (r.kind === 'switch') return `<button class="set-sw" data-c="${r.k}" role="switch"><span>${r.label}</span><b></b></button>`;
      const vals: [string, string][] = r.opts ?? ASSIST_LEVELS.map((l) => [l, l.toUpperCase()] as [string, string]);
      return `<div class="set-row" data-c="${r.k}"><span id="ctl-${r.k}">${r.label}</span><div class="seg set-seg" role="radiogroup" aria-labelledby="ctl-${r.k}">${
        vals.map(([v, t]) => `<button data-v="${v}" role="radio">${t}</button>`).join('')}</div></div>`;
    };
    const STICK_WHY: Record<'floating' | 'fixed', string> = {
      floating: `The stick appears under your thumb${sep()}anywhere on the left`,
      fixed: `Anchored bottom left, always drawn${sep()}put your thumb on it`,
    };
    const keyRow = (a: KeyAction) => `<div class="kb-row" data-ka="${a}"><span class="kb-act">${KEY_ACTION_NAMES[a]}</span>${
      Array.from({ length: KEY_SLOTS }, (_, i) => `<button class="kb-slot" data-ka="${a}" data-s="${i}" aria-label="${KEY_ACTION_NAMES[a]} key ${i + 1}"></button>`).join('')}</div>`;
    const padRow = (a: PadAction) => `<div class="kb-row" data-pa="${a}"><span class="kb-act">${KEY_ACTION_NAMES[a]}</span>${
      Array.from({ length: PAD_SLOTS }, (_, i) => `<button class="kb-slot" data-pa="${a}" data-s="${i}" aria-label="${KEY_ACTION_NAMES[a]} button ${i + 1}"></button>`).join('')}</div>`;
    const ra = opts.removeAds;
    const noAdsBtn = ra
      ? `<button class="btn set-noads ${ra.owned ? 'btn-white owned' : 'btn-red'}" data-a="noads" ${ra.owned ? 'disabled' : ''} aria-label="${ra.owned ? 'No ads: on' : `Remove ads, ${escHtml(ra.price)}`}"><span>${ra.owned ? 'NO ADS' : 'REMOVE ADS'}</span><b>${ra.owned ? 'ON' : escHtml(ra.price)}</b></button>`
      : '';
    const d = this.mount(`
      <div class="panel-wrap dim shell">
        <div class="panel mc shell set-panel">
          ${shellTop('SETTINGS', '', noAdsBtn)}
          <nav class="seg mc-tabs set-nav" role="tablist">
            <button data-tab="general" role="tab">GENERAL</button>
            <button data-tab="controls" role="tab">CONTROLS</button>
            <button data-tab="keys" role="tab">KEYS</button>
            <button data-tab="more" role="tab">MORE</button>
          </nav>
          <div class="mc-body set-body">
            <div class="set-pane set-grid toggles" data-pane="general" role="tabpanel">
              <button data-k="sfx"></button>
              <button data-k="music"></button>
              <button data-k="quality"></button>
              <button data-k="textSize"></button>
              ${hapticsAvailable() ? '<button data-k="vibration"></button>' : ''}
              <button data-k="camZoom"></button>
              <button data-k="crowd"></button>
              <button data-k="commentary"></button>
              <button data-k="colorblind"></button>
              <button data-k="quickSubs"></button>
              <button data-k="sideShows"></button>
            </div>
            <div class="set-pane set-grid ctl-grid" data-pane="controls" role="tabpanel">
              ${rows.map(ctlRow).join('')}
              <div class="set-row" data-c="stick"><span id="ctl-stick">THUMBSTICK</span><div class="seg set-seg" role="radiogroup" aria-labelledby="ctl-stick"><button data-stick="floating" role="radio">FLOATING</button><button data-stick="fixed" role="radio">FIXED</button></div></div>
            </div>
            <div class="set-pane kb-pane" data-pane="keys" role="tabpanel">
              <div class="pane"><div class="pane-h"><b>KEYBOARD</b><span class="grow"></span><button class="btn btn-white kb-reset" data-reset="keys">RESET</button></div><div class="pane-scroll kb-grid">${KEY_ACTIONS.map(keyRow).join('')}</div></div>
              <div class="pane"><div class="pane-h"><b>GAMEPAD</b><span class="grow"></span><button class="btn btn-white kb-reset" data-reset="pad">RESET</button></div><div class="pane-scroll kb-grid pad">${PAD_ACTIONS.map(padRow).join('')}</div></div>
            </div>
            <div class="set-pane set-grid toggles" data-pane="more" role="tabpanel">
              <button data-k="ballSkin"></button>
              <button data-k="celebration"></button>
              ${opts.account ? '<button data-a="account" aria-label="Account and cloud saves"><span>SAVE PROGRESS</span><b class="link">GOOGLE / APPLE</b></button>' : ''}
              ${opts.invite ? '<button data-a="invite" aria-label="Invite friends"><span>INVITE FRIENDS</span><b class="link">SHARE THE GAME</b></button>' : ''}
              ${opts.about ? '<button data-a="about" aria-label="About the developer"><span>THE DEVELOPER</span><b class="link">MEET ISLAM</b></button>' : ''}
              ${opts.backup ? '<button data-a="backup" aria-label="Backup: export or import your save"><span>BACKUP</span><b class="link">EXPORT / IMPORT</b></button>' : ''}
              <button data-a="feedback" aria-label="Send feedback by email"><span>FEEDBACK</span><b class="link">EMAIL US</b></button>
            </div>
          </div>
          <p class="set-hint mc-hint1" role="status" aria-live="polite"></p>
        </div>
      </div>`, 'settings');
    // The one hint line: what the last thing tapped does (CONTROLS), the key prompt (KEYS), the studio (MORE).
    const hintEl = $(d, '.set-hint');
    const hint = (html: string, kind: 'good' | 'bad' | '' = '') => {
      hintEl.innerHTML = html;
      hintEl.className = `set-hint mc-hint1 ${kind}`;
    };
    let shown: SettingsTab = tab;
    const tabHint = () => hint(shown === 'keys' ? 'TAP A BOX, THEN PRESS THE NEW KEY OR BUTTON. ESC CANCELS'
      : shown === 'more' ? `${lynxSvg(1, STUDIO_BLUE, '#fff', 'lynx sm')}Blocky League v${APP_VERSION} by ${STUDIO}` : '');
    const showTab = (t: SettingsTab) => {
      shown = t;
      mem.setTab = t;
      d.querySelectorAll<HTMLButtonElement>('.set-nav button').forEach((b) => {
        const on = b.dataset.tab === t;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      });
      d.querySelectorAll<HTMLElement>('.set-pane').forEach((p) => (p.hidden = p.dataset.pane !== t));
      stopListening();
      tabHint();
    };
    d.querySelectorAll<HTMLButtonElement>('.set-nav button').forEach((b) =>
      b.addEventListener('click', () => showTab(b.dataset.tab as SettingsTab)),
    );
    // Controls: an ASSISTED / SEMI / MANUAL row per pass type, an ON / OFF switch for the rest. ({Tap}: "Tap" on
    // touch, "Press" on keys and pads, as the coach says it: ui/coach.ts.)
    const why = (r: ControlRow) => `<b>${r.label}</b> ${coachText(r.why[String(controlsOf(s)[r.k])] ?? '', currentDevice())}`;
    const drawControls = () => {
      const c = controlsOf(s);
      for (const r of rows) {
        const row = $(d, `[data-c=${r.k}]`);
        const v = c[r.k];
        if (r.kind === 'switch') {
          row.setAttribute('aria-checked', String(v));
          const chip = $(row, 'b');
          chip.textContent = v ? 'ON' : 'OFF';
          chip.classList.toggle('off', !v);
        } else {
          row.querySelectorAll<HTMLButtonElement>('.set-seg button').forEach((b) => {
            const on = b.dataset.v === String(v);
            b.classList.toggle('on', on);
            b.setAttribute('aria-checked', String(on));
          });
        }
      }
      const stick = s.stick === 'fixed' ? 'fixed' : 'floating';
      d.querySelectorAll<HTMLButtonElement>('[data-stick]').forEach((b) => {
        const on = b.dataset.stick === stick;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
    };
    for (const r of rows) {
      const row = $(d, `[data-c=${r.k}]`);
      if (r.kind === 'switch') {
        row.addEventListener('click', () => {
          if (r.k !== 'groundAssist' && r.k !== 'throughAssist' && r.k !== 'vibration') s[r.k] = !controlsOf(s)[r.k];
          drawControls();
          onChange();
          hint(why(r));
        });
        continue;
      }
      row.querySelectorAll<HTMLButtonElement>('.set-seg button').forEach((b) =>
        b.addEventListener('click', () => {
          const v = b.dataset.v!;
          if (r.k === 'groundAssist') s.groundAssist = v as AssistLevel;
          else if (r.k === 'throughAssist') s.throughAssist = v as AssistLevel;
          drawControls();
          onChange();
          hint(why(r));
        }),
      );
    }
    d.querySelectorAll<HTMLButtonElement>('[data-stick]').forEach((b) =>
      b.addEventListener('click', () => {
        s.stick = b.dataset.stick === 'fixed' ? 'fixed' : 'floating';
        drawControls();
        onChange();
        hint(`<b>THUMBSTICK</b> ${STICK_WHY[s.stick]}`);
      }),
    );
    drawControls();

    // KEYS: every slot shows its key; tapping one listens for the next key (or gamepad button). The hint line says
    // what happened (plain text).
    const say = (t: string, kind: 'good' | 'bad' | '' = '') => {
      if (!t) return tabHint();
      hint('', kind);
      hintEl.textContent = t;
    };
    const keysOf = (): KeyMap => normalizeKeyMap(s.keys);
    const padOf = (): PadMap => normalizePadMap(s.pad);
    const drawKeys = () => {
      const km = keysOf();
      const pm = padOf();
      d.querySelectorAll<HTMLButtonElement>('.kb-slot[data-ka]').forEach((b) => {
        const code = km[b.dataset.ka as KeyAction][Number(b.dataset.s)];
        b.textContent = code ? keyLabel(code) : '+';
        b.classList.toggle('empty', !code);
        b.classList.remove('listen');
      });
      d.querySelectorAll<HTMLButtonElement>('.kb-slot[data-pa]').forEach((b) => {
        const btn = pm[b.dataset.pa as PadAction][Number(b.dataset.s)];
        b.textContent = btn !== undefined ? padLabel(btn) : '+';
        b.classList.toggle('empty', btn === undefined);
        b.classList.remove('listen');
      });
    };
    let listening: { el: HTMLButtonElement; kind: 'key' | 'pad'; action: string; slot: number } | null = null;
    let padRaf = 0;
    let padTimer = 0;
    const stopListening = () => {
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(padRaf);
      clearTimeout(padTimer);
      listening = null;
      drawKeys();
    };
    this.cleanups.push(stopListening);
    const commitKeys = (km: KeyMap) => {
      s.keys = km;
      onChange();
    };
    const commitPad = (pm: PadMap) => {
      s.pad = pm;
      onChange();
    };
    const name = (a: string) => KEY_ACTION_NAMES[a as KeyAction] ?? a.toUpperCase();
    function onKey(e: KeyboardEvent): void {
      if (!listening) return;
      // The key goes to the binding, never to the game or the menu behind (ESC would resume the match).
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      const l = listening;
      const code = normCode(e.code);
      if (code === 'Escape') {
        say('');
        stopListening();
        return;
      }
      if (l.kind === 'pad') {
        if (code === 'Backspace' || code === 'Delete') {
          const pa = l.action as PadAction;
          const pm = padOf();
          if (pm[pa].length > 1 && pm[pa][l.slot] !== undefined) {
            commitPad(unbindPad(pm, pa, l.slot));
            say(`${name(pa)} BUTTON CLEARED`);
          } else say(`${name(pa)} NEEDS AT LEAST ONE BUTTON`, 'bad');
          stopListening();
        }
        return;
      }
      const a = l.action as KeyAction;
      if (code === 'Backspace' || code === 'Delete') {
        const km = keysOf();
        if (km[a].length > 1 && km[a][l.slot]) {
          commitKeys(unbindKey(km, a, l.slot));
          say(`${name(a)} KEY CLEARED`);
        } else say(`${name(a)} NEEDS AT LEAST ONE KEY`, 'bad');
        stopListening();
        return;
      }
      const r = bindKey(keysOf(), a, l.slot, code);
      if (r.refused === 'reserved') say(`${keyLabel(code)} IS RESERVED`, 'bad');
      else if (r.refused === 'last') say(`${keyLabel(code)} IS ${name(KEY_ACTIONS.find((x) => keysOf()[x].includes(code)) ?? '')}'S ONLY KEY`, 'bad');
      else {
        commitKeys(r.map);
        // (Plain text: the " · " becomes a divider element through the menus' divider guard, ui/text.ts.)
        say(r.swapped ? `${keyLabel(code)} IS NOW ${name(a)}. ${name(r.swapped)} TOOK ITS OLD KEY` : `${keyLabel(code)} IS NOW ${name(a)}`, 'good');
      }
      stopListening();
    }
    const listenPad = (held: Set<number>) => {
      const tick = () => {
        if (!listening || listening.kind !== 'pad') return;
        const btn = Input.padButtonDown(held);
        // A button held when listening began has to be let go first.
        for (const h of [...held]) if (!Input.padButtonsHeld().has(h)) held.delete(h);
        if (btn >= 0) {
          const a = listening.action as PadAction;
          const r = bindPad(padOf(), a, listening.slot, btn);
          if (r.refused === 'last') say(`${padLabel(btn)} IS ANOTHER ACTION'S ONLY BUTTON`, 'bad');
          else if (r.refused) say(`${padLabel(btn)} CAN'T BE BOUND`, 'bad');
          else {
            commitPad(r.map);
            say(r.swapped ? `${padLabel(btn)} IS NOW ${name(a)}. ${name(r.swapped)} TOOK ITS OLD BUTTON` : `${padLabel(btn)} IS NOW ${name(a)}`, 'good');
          }
          stopListening();
          return;
        }
        padRaf = requestAnimationFrame(tick);
      };
      padRaf = requestAnimationFrame(tick);
      padTimer = window.setTimeout(() => {
        if (listening?.kind === 'pad') {
          say('NO BUTTON PRESSED', 'bad');
          stopListening();
        }
      }, 8000);
    };
    d.querySelectorAll<HTMLButtonElement>('.kb-slot').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.click();
        const pad = b.dataset.pa !== undefined;
        stopListening();
        listening = { el: b, kind: pad ? 'pad' : 'key', action: (pad ? b.dataset.pa : b.dataset.ka)!, slot: Number(b.dataset.s) };
        b.classList.add('listen');
        b.textContent = 'PRESS';
        say(pad ? `PRESS A BUTTON FOR ${name(listening.action)}` : `PRESS A KEY FOR ${name(listening.action)}`);
        window.addEventListener('keydown', onKey, true);
        if (pad) listenPad(Input.padButtonsHeld());
      }),
    );
    d.querySelectorAll<HTMLButtonElement>('[data-reset]').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.click();
        stopListening();
        if (b.dataset.reset === 'keys') {
          commitKeys(normalizeKeyMap(DEFAULT_KEYS));
          say('KEYBOARD BACK TO THE DEFAULTS', 'good');
        } else {
          commitPad(normalizePadMap(DEFAULT_PAD));
          say('GAMEPAD BACK TO THE DEFAULTS', 'good');
        }
        drawKeys();
      }),
    );
    drawKeys();
    // (The main menu opens on GENERAL: the session's last tab comes back instead. The pause menu asks for CONTROLS.)
    showTab(tab === 'general' && mem.setTab ? mem.setTab : tab);

    const labels: Record<string, string> = {
      sfx: 'SOUND FX', crowd: 'CROWD', music: 'MUSIC', commentary: 'COMMENTARY', colorblind: 'COLOUR BLIND', quality: 'GRAPHICS',
      camZoom: 'CAMERA', ballSkin: 'BALL', celebration: 'CELEBRATION', quickSubs: 'QUICK SUBS', sideShows: 'EXTRA SCENES', textSize: 'TEXT SIZE', vibration: 'VIBRATION',
    };
    const VIB: HapticLevel[] = ['off', 'light', 'full'];
    const draw = () => {
      d.querySelectorAll<HTMLButtonElement>('.toggles button[data-k]').forEach((b) => {
        const k = b.dataset.k as keyof typeof s;
        const v = s[k];
        if (k === 'ballSkin') {
          // The ball look, and the next one still to earn (levels: see BALL_SKIN_LEVEL).
          const lvl = levelOf(save.progress.xp).level;
          const id = (s.ballSkin ?? 'classic') as BallSkinId;
          const locked = BALL_SKIN_IDS.find((x) => !skinUnlocked(x, lvl) && !owns(save, 'ball', x));
          b.innerHTML = `<span>${labels[k]}</span><b>${BALL_SKIN_NAMES[id].toUpperCase()}${locked ? `<small class="lock">${sep()}${pixelIcon('lock', 'currentColor', 1.2, 'inl')}${BALL_SKIN_NAMES[locked].toUpperCase()} LV${BALL_SKIN_LEVEL[locked]}</small>` : ''}</b>`;
          return;
        }
        if (k === 'celebration') {
          // The goal celebration, and the next one still to earn (levels: see CELEBRATION_LEVEL).
          const lvl = levelOf(save.progress.xp).level;
          const id = (s.celebration ?? 'classic') as CelebrationId;
          const locked = CELEBRATION_IDS.find((x) => !celebrationUnlocked(x, lvl) && !owns(save, 'celebration', x));
          b.innerHTML = `<span>${labels[k]}</span><b>${CELEBRATION_NAMES[id].toUpperCase()}${locked ? `<small class="lock">${sep()}${pixelIcon('lock', 'currentColor', 1.2, 'inl')}${CELEBRATION_NAMES[locked].toUpperCase()} LV${CELEBRATION_LEVEL[locked]}</small>` : ''}</b>`;
          return;
        }
        if (k === 'textSize') {
          // Menu and HUD text only (ui/textSize.ts): SMALL, MEDIUM, LARGE.
          b.innerHTML = `<span>${labels[k]}</span><b>${TEXT_SIZE_LABEL[s.textSize ?? 'medium']}</b>`;
          return;
        }
        if (k === 'vibration') {
          // The app only: OFF, LIGHT (the big moments) or FULL.
          const lv = controlsOf(s).vibration;
          b.innerHTML = `<span>${labels[k]}</span><b class="${lv === 'off' ? 'off' : ''}">${lv.toUpperCase()}</b>`;
          return;
        }
        const on = k === 'colorblind' ? v === true : k === 'quickSubs' || k === 'sideShows' ? v !== false : v;
        const val = k === 'quality' ? String(v).toUpperCase() : k === 'camZoom' ? (s.camZoom ?? 'normal').toUpperCase() : on ? 'ON' : 'OFF';
        b.innerHTML = `<span>${labels[k]}</span><b class="${on === false ? 'off' : ''}">${val}</b>`;
        if (k !== 'quality' && k !== 'camZoom') b.setAttribute('aria-pressed', String(!!on));
      });
    };
    d.querySelectorAll<HTMLButtonElement>('.toggles button[data-k]').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.disabled) return;
        sfx.click();
        const k = b.dataset.k as keyof typeof s;
        if (k === 'quality') {
          s.quality = s.quality === 'high' ? 'medium' : s.quality === 'medium' ? 'low' : 'high';
          // His own choice from now on (an unpicked quality is always HIGH: see Settings.qualityPicked).
          s.qualityPicked = true;
        }
        // Camera distance: WIDE -> NORMAL -> CLOSE -> WIDE.
        else if (k === 'camZoom') s.camZoom = CAM_ZOOMS[(CAM_ZOOMS.indexOf(s.camZoom ?? 'normal') + 1) % CAM_ZOOMS.length];
        else if (k === 'ballSkin') {
          // Cycle through the looks this level has earned or the SHOP sold.
          const open = BALL_SKIN_IDS.filter((x) => owns(save, 'ball', x));
          const cur = open.indexOf((s.ballSkin ?? 'classic') as BallSkinId);
          s.ballSkin = open[(cur + 1) % open.length];
        } else if (k === 'celebration') {
          // Cycle through the celebrations this level has earned or the SHOP sold.
          const open = CELEBRATION_IDS.filter((x) => owns(save, 'celebration', x));
          const cur = open.indexOf((s.celebration ?? 'classic') as CelebrationId);
          s.celebration = open[(cur + 1) % open.length];
        } else if (k === 'colorblind') s.colorblind = !s.colorblind;
        else if (k === 'textSize') s.textSize = nextTextSize(s.textSize);
        else if (k === 'quickSubs') s.quickSubs = s.quickSubs === false;
        else if (k === 'sideShows') s.sideShows = s.sideShows === false;
        else if (k === 'vibration') s.vibration = VIB[(VIB.indexOf(controlsOf(s).vibration) + 1) % VIB.length];
        else (s as unknown as Record<string, boolean>)[k] = !s[k];
        draw();
        onChange();
        if (k === 'vibration' && vibRow) {
          buzz('success');
          hint(why(vibRow));
        }
      }),
    );
    draw();
    // FEEDBACK: an email to the studio (the app hands mailto: to Mail), with the version for context.
    d.querySelector('[data-a=feedback]')?.addEventListener('click', () => {
      const subject = encodeURIComponent(`Blocky League feedback (v${APP_VERSION})`);
      location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}`;
    });
    d.querySelector('[data-a=backup]')?.addEventListener('click', () => {
      stopListening();
      opts.backup?.();
    });
    for (const [action, go] of [['account', opts.account], ['invite', opts.invite], ['about', opts.about]] as const) {
      d.querySelector(`[data-a=${action}]`)?.addEventListener('click', () => {
        if (!go) return;
        // Account and invitation panels mount outside Menus. Retire this screen's shortcuts before opening them.
        this.close();
        go();
      });
    }
    // REMOVE ADS: the store's own sheet confirms the purchase; once bought the row reads NO ADS: ON.
    const noAds = d.querySelector<HTMLButtonElement>('[data-a=noads]');
    noAds?.addEventListener('click', async () => {
      if (!opts.removeAds || noAds.disabled) return;
      noAds.disabled = true;
      const bought = await opts.removeAds.buy().catch(() => false);
      if (!noAds.isConnected) return;
      if (bought) {
        noAds.classList.remove('btn-red');
        noAds.classList.add('owned', 'btn-white');
        noAds.innerHTML = '<span>NO ADS</span><b>ON</b>';
      } else noAds.disabled = false;
    });
    const back = () => {
      stopListening();
      onBack();
    };
    $(d, '[data-a=back]').addEventListener('click', back);
    // ESC goes back (while a key box is listening, ESC only cancels that: it never gets here).
    this.listenKey((e) => {
      if (e.code === 'Escape') back();
    });
  }

  /**
   * Settings > BACKUP: the save as a file, so progress survives a cleared browser and can move between
   * devices. EXPORT downloads blocky-league-save.json; IMPORT reads one back, checks it really is a Blocky
   * League save (importSave), shows what it holds beside the current one and, on REPLACE, hands it to
   * `h.onImport` (main.ts swaps the running save, stores it and redraws the menu). Local only: it works the
   * same on the portal builds.
   */
  backup(save: SaveData, h: { onImport: (d: SaveData) => void; back: () => void }): void {
    const line = (d: SaveData) => {
      const lv = levelOf(d.progress.xp);
      const when = d.updatedAt ? new Date(d.updatedAt) : null;
      const date = when && !Number.isNaN(when.getTime()) ? `${sep()}${when.toLocaleDateString()}` : '';
      return `<b>LV ${lv.level}</b> ${levelTitle(lv.level).toUpperCase()}${sep()}${d.coins.toLocaleString()} COINS${sep()}${d.record.played} MATCHES${date}`;
    };
    // One screen: the save (and the file's, when importing) on the left, what to do with it on the right.
    const d = this.mount(`
      <div class="panel-wrap dim shell">
        <div class="panel mc shell bk-panel">
          ${shellTop('BACKUP', 'YOUR SAVE LIVES IN THIS BROWSER')}
          <div class="mc-body bk-body">
            <div class="pane">
              <div class="bk-card"><span>THIS SAVE</span><em>${line(save)}</em></div>
              <div class="bk-card bk-confirm" hidden><span>FROM THE FILE</span><em class="bk-in"></em></div>
            </div>
            <div class="pane">
              <div class="menu-col bk-main">
                <button class="btn btn-go" data-a="export">EXPORT SAVE</button>
                <button class="btn btn-blue" data-a="import">IMPORT SAVE</button>
                <input type="file" accept=".json,application/json" hidden aria-label="Save file">
              </div>
              <div class="menu-col bk-confirm" hidden>
                <p class="bk-ask">Replace your save with the file's? Export yours first to keep it.</p>
                <button class="btn btn-red" data-a="replace">REPLACE MY SAVE</button>
                <button class="btn btn-white" data-a="keep">KEEP MINE</button>
              </div>
              <p class="bk-msg fine" role="status" aria-live="polite"></p>
            </div>
          </div>
        </div>
      </div>`, 'backup');
    this.listenKey((e) => {
      if (e.code === 'Escape') h.back();
    });
    const msgEl = $(d, '.bk-msg');
    const msg = (text: string, kind: 'good' | 'bad' | '' = '') => {
      msgEl.textContent = text;
      msgEl.className = `bk-msg fine ${kind}`;
    };
    const main = $(d, '.bk-main');
    let pending: SaveData | null = null;
    const asking = (d2: SaveData | null) => {
      pending = d2;
      main.hidden = !!d2;
      d.querySelectorAll<HTMLElement>('.bk-confirm').forEach((el) => (el.hidden = !d2));
      if (d2) $(d, '.bk-in').innerHTML = line(d2);
    };
    $(d, '[data-a=export]').addEventListener('click', () => {
      try {
        const url = URL.createObjectURL(new Blob([exportSave(save)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'blocky-league-save.json';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        msg('SAVED AS blocky-league-save.json', 'good');
      } catch {
        msg("This browser wouldn't save the file.", 'bad');
      }
    });
    const file = $<HTMLInputElement>(d, 'input[type=file]');
    $(d, '[data-a=import]').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      f.text().then((txt) => {
        const got = importSave(txt);
        if (!got) return msg('NOT A BLOCKY LEAGUE SAVE FILE', 'bad');
        msg('');
        asking(got);
      }).catch(() => msg("Couldn't read that file.", 'bad'));
    });
    $(d, '[data-a=keep]').addEventListener('click', () => asking(null));
    $(d, '[data-a=replace]').addEventListener('click', () => {
      if (!pending) return;
      const got = pending;
      asking(null);
      sfx.coin();
      h.onImport(got);
    });
    $(d, '[data-a=back]').addEventListener('click', h.back);
  }

  /**
   * HOW TO PLAY, one screen per topic (docs/UX.md: no endless scroll): the device in hand (TOUCH, KEYS, PAD) in the
   * header, five topics as tabs (ATTACK, DEFEND, SKILLS, CROSSES, BLITZ), one short row per control. Touch draws the
   * pad beside the rows. The topic is remembered for the session.
   */
  howTo(onBack: () => void, device: HtDev = defaultDevice()): void {
    const devs: [HtDev, string][] = [['touch', 'TOUCH'], ['keyboard', 'KEYS'], ['gamepad', 'PAD']];
    const d = this.mount(`
      <div class="panel-wrap dim shell">
        <div class="panel mc shell howto-panel">
          ${shellTop('HOW TO PLAY', '<i class="ht-sub"></i>', `<div class="seg ht-dev" role="tablist" aria-label="Device">${devs.map(([k, l]) => `<button data-dev="${k}" role="tab">${l}</button>`).join('')}</div>`)}
          <nav class="seg mc-tabs ht-topics" role="tablist">${HT_TABS.map(([k, l]) => `<button data-ht="${k}" role="tab">${l}</button>`).join('')}</nav>
          <div class="mc-body ht-body" role="tabpanel"></div>
        </div>
      </div>`, 'howto-screen');
    d.classList.toggle('stick-fixed', this.stick === 'fixed');
    const body = $(d, '.ht-body');
    const sub = $(d, '.ht-sub');
    let dev = device;
    const show = () => {
      d.querySelectorAll<HTMLButtonElement>('.ht-dev button').forEach((b) => {
        const on = b.dataset.dev === dev;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      });
      d.querySelectorAll<HTMLButtonElement>('.ht-topics button').forEach((b) => {
        const on = b.dataset.ht === mem.htTab;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      });
      d.classList.toggle('dev-touch', dev === 'touch');
      // The one hint line: where to change what this screen describes.
      sub.textContent = dev === 'touch' ? 'PASS HELP IN SETTINGS' : dev === 'gamepad' ? 'CHANGE BUTTONS IN SETTINGS' : 'CHANGE KEYS IN SETTINGS';
      body.innerHTML = howtoBody(mem.htTab, dev);
      body.scrollTop = 0;
    };
    d.querySelectorAll<HTMLButtonElement>('.ht-dev button').forEach((b) =>
      b.addEventListener('click', () => {
        dev = b.dataset.dev as HtDev;
        show();
      }),
    );
    d.querySelectorAll<HTMLButtonElement>('.ht-topics button').forEach((b) =>
      b.addEventListener('click', () => {
        mem.htTab = b.dataset.ht as HtTab;
        show();
      }),
    );
    show();
    $(d, '[data-a=back]').addEventListener('click', onBack);
    this.listenKey((e) => {
      if (e.code === 'Escape') onBack();
    });
  }

  /**
   * The welcome offer, once ever, after the first win (main.ts; the app's store only): the Starter Pack with its
   * real price and worth. No timer and no pressure: it says plainly that the pack stays in the shop.
   */
  welcomeOffer(o: { price: string; coins: number; worth: number; gems?: number }, h: { see: () => void; later: () => void }): void {
    const n = (v: number) => v.toLocaleString('en-US');
    const gemItem = o.gems ? `<span class="wo-plus" aria-hidden="true">+</span><span class="wo-item">${gemArt(3)}<b>${n(o.gems)}</b><small>GEMS</small></span>` : '';
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow gift-panel wo-panel">
          <h2>FIRST WIN!</h2>
          <p class="wo-sub">STARTER PACK${sep()}ONE TIME ONLY</p>
          <div class="wo-box">
            <span class="wo-item"><i class="wo-coin" aria-hidden="true"></i><b>${n(o.coins)}</b><small>COINS</small></span>
            ${gemItem}
            <span class="wo-plus" aria-hidden="true">+</span>
            <span class="wo-item">${pixelIcon('ball', '#ffd23a', 3)}<b>GOLD BALL</b><small>LOOK</small></span>
          </div>
          <p class="wo-price">WORTH <b>${n(o.worth)}</b> COINS FOR <b>${escHtml(o.price)}</b>${sep()}STAYS IN THE SHOP</p>
          <div class="btn-row">
            <button class="btn btn-white" data-a="later">NOT NOW</button>
            <button class="btn btn-yellow btn-lg" data-a="see">SEE THE PACK</button>
          </div>
        </div>
      </div>`, 'gift-screen');
    d.querySelector('[data-a=see]')?.addEventListener('click', () => h.see());
    d.querySelector('[data-a=later]')?.addEventListener('click', () => h.later());
    this.listenKey((e) => {
      if (e.code === 'Escape') h.later();
    });
  }

  /**
   * The 7-day login calendar (meta/loops.ts CALENDAR, passed in as `cal`): each day's coins, with gems or a Scout
   * Ticket on some. It counts the days claimed, never days in a row: MISS A DAY, KEEP YOUR PLACE.
   */
  gift(
    amount: number, streak: number, canDouble: boolean, h: { claim: (double: boolean) => Promise<boolean>; back: () => void },
    cal?: readonly { coins: number; gems: number; tokens: number }[],
  ): void {
    const dayOf = (i: number) => cal?.[i] ?? { coins: 100 + 50 * i, gems: 0, tokens: 0 };
    const extra = (d: { gems: number; tokens: number }) => `${d.gems ? `<em class="gd-gem">${gemArt(1.6)}${d.gems}</em>` : ''}${d.tokens ? '<em class="gd-tok">+1 SCOUT TICKET</em>' : ''}`;
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = dayOf(i);
      const state = i < streak - 1 ? 'got' : i === streak - 1 ? 'today' : '';
      return `<li class="${state}"><span>DAY ${i + 1}</span><b>${d.coins}</b>${extra(d)}</li>`;
    }).join('');
    const today = dayOf(streak - 1);
    const next = dayOf(streak % 7);
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow gift-panel">
          <h2>DAILY GIFT</h2>
          <ul class="gift-days">${days}</ul>
          <div class="reward"><i></i><span>+${amount}</span>${today.gems ? `<span class="rw-gem">${gemArt(3)}+${today.gems}</span>` : ''}${today.tokens ? '<span class="rw-tok">+1 SCOUT TICKET</span>' : ''}<em>DAY ${streak} OF 7</em></div>
          <p class="gift-note">TOMORROW +${next.coins}${next.gems ? ` AND ${next.gems} GEMS` : ''}${next.tokens ? ' AND A SCOUT TICKET' : ''}${sep()}MISS A DAY, KEEP YOUR PLACE</p>
          <div class="btn-row">
            ${canDouble ? `<button class="btn btn-white" data-a="double">${pixelIcon('film', '#26262e', 2, 'inl')}2× GIFT</button>` : ''}
            <button class="btn btn-go btn-lg" data-a="claim">CLAIM</button>
          </div>
        </div>
      </div>`, 'gift-screen');
    const go = async (double: boolean) => {
      d.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
      await h.claim(double);
      sfx.coin();
      buzz('success');
      h.back();
    };
    $(d, '[data-a=claim]').addEventListener('click', () => void go(false));
    d.querySelector('[data-a=double]')?.addEventListener('click', () => void go(true));
  }

  /**
   * A LOST DECIDER (economy v3, main.ts): one chance to play it again before the result counts. The price is on the
   * button and the wallet beside it, so the one tap is the confirm; a rewarded ad does it once a day where there are
   * ads; NO THANKS takes the result. Short of gems it says so (and GET GEMS goes to the store, in the app).
   */
  replayOffer(
    o: { what: string; score: string; price: number; have: number; canAd: boolean },
    h: { gems: () => void; ad?: () => Promise<boolean>; no: () => void; getGems?: () => void },
  ): void {
    const short = Math.max(0, o.price - o.have);
    const main = short > 0
      ? h.getGems ? '<button class="btn btn-blue btn-lg" data-a="get">GET GEMS</button>' : ''
      : `<button class="btn btn-go btn-lg" data-a="gems">REPLAY <span class="gem-price">${gemArt(1.6)}${o.price}</span></button>`;
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow gift-panel rp-panel">
          <h2>PLAY IT AGAIN?</h2>
          <p class="wo-sub">${escHtml(o.what)}${sep()}${o.score}</p>
          <div class="gem-cost"><span><small>REPLAY</small><b>${gemArt(3)}${o.price}</b></span><span><small>YOU HAVE</small><b class="${short > 0 ? 'short' : ''}">${gemArt(3)}${o.have.toLocaleString('en-US')}</b></span></div>
          <p class="gift-note">ONE REPLAY A MATCH${sep()}THE FIRST RESULT IS WIPED${short > 0 ? `${sep()}${short} MORE ${short === 1 ? 'GEM' : 'GEMS'} NEEDED` : ''}</p>
          <div class="btn-row">
            <button class="btn btn-white" data-a="no">NO THANKS</button>
            ${o.canAd && h.ad ? `<button class="btn btn-yellow" data-a="ad">${pixelIcon('film', '#26262e', 2, 'inl')}WATCH AN AD</button>` : ''}
            ${main}
          </div>
        </div>
      </div>`, 'gift-screen');
    let busy = false;
    const all = () => d.querySelectorAll<HTMLButtonElement>('button');
    d.querySelector('[data-a=no]')?.addEventListener('click', () => {
      if (!busy) h.no();
    });
    d.querySelector('[data-a=gems]')?.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      buzz('success');
      h.gems();
    });
    d.querySelector('[data-a=get]')?.addEventListener('click', () => {
      if (!busy) h.getGems?.();
    });
    d.querySelector('[data-a=ad]')?.addEventListener('click', () => {
      if (busy || !h.ad) return;
      busy = true;
      all().forEach((b) => (b.disabled = true));
      void h.ad().then((ok) => {
        // (The ad did not finish: the offer stays, nothing was used.)
        if (ok) return;
        busy = false;
        all().forEach((b) => (b.disabled = false));
        this.toast('THE AD DID NOT FINISH. THE OFFER STAYS');
      });
    });
    this.listenKey((e) => {
      if (e.code === 'Escape' && !busy) h.no();
    });
  }

  comingSoon(title: string, text: string, onBack: () => void): void {
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow">
          <h2>${title}</h2>
          <p class="fine big">${text}</p>
          <div class="btn-row"><button class="btn btn-go" data-a="back">OK</button></div>
        </div>
      </div>`);
    $(d, '[data-a=back]').addEventListener('click', onBack);
  }
}
