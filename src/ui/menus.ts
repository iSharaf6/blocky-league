import { sfx } from '../audio/sfx';
import { logoSvg } from './gameLogo';
import {
  ASSIST_LEVELS, CAM_ZOOMS, controlsOf, levelOf, levelTitle, type AssistLevel, type Challenge, type ControlSettings, type SaveData, BALL_SKIN_IDS,
  BALL_SKIN_LEVEL, BALL_SKIN_NAMES, LEGEND_STARS, legendUnlocked, nextUnlock, skinUnlocked, type BallSkinId, CELEBRATION_IDS, CELEBRATION_LEVEL,
  CELEBRATION_NAMES, celebrationUnlocked, type CelebrationId, exportSave, importSave, unlockLadder, xpAt } from '../core/save';
import { APP_VERSION, CONTACT_EMAIL, STUDIO, STUDIO_BLUE, creditHtml, lynxSvg } from './brand';
import { SCORE_SEP_HTML, escHtml, scoreHtml, sep, seps, sepText } from './text';
import { pixelIcon } from './pixelIcons';
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
    why: { true: `Thumbstick all the way: sprint${sep()}a light push jogs`, false: 'Hold SPRINT to sprint' },
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
  gift?: { amount: number; streak: number };
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
const kc = (a: PadAction, dev: 'keyboard' | 'gamepad') => `<kbd>${escHtml(actionKey(a, dev))}</kbd>`;

/** HOW TO PLAY for the keyboard: every key named is the player's own binding (Settings > Controls > KEYS). */
function howtoKeys(): string {
  const k = (a: PadAction) => kc(a, 'keyboard');
  const mv = moveKeys('keyboard').split(' / ');
  return `
  <div class="howto">
    <div class="ht-col">
      <h3>ATTACK</h3>
      <p>${mv.map((m) => `<kbd>${escHtml(m === 'ARROWS' ? '←↑→↓' : m)}</kbd>`).join(' / ')} move</p>
      <p>${k('pass')} pass to the <b>ringed</b> teammate${sep()}aim to pick another</p>
      <p>${k('through')} through ball${sep()}hold, then let go to cross</p>
      <p>${k('shoot')} hold, aim, let go to shoot${sep()}a longer hold lifts it</p>
      <p>Press ${k('shoot')} again as you strike: <b>perfect finish</b> (mistime it and it flies)</p>
      <p>Hold ${k('shoot')}, press ${k('through')}: chip${sep()}a soft diagonal shot curls</p>
      <p>${k('sprint')} sprint${sep()}press twice to knock it past a defender</p>
      <p>${k('skill')} skill move: press it as a defender lunges (the <b>!</b> over him) for a <b>PERFECT</b></p>
      <p>Stick with ${k('skill')}: ahead = rainbow flick (a man squared up: nutmeg)${sep()}half across = elastico${sep()}across = roulette (slow: la croqueta)${sep()}half back = heel chop${sep()}back = drag back${sep()}none = stepover (standing: ball roll)</p>
      <p><b>Crosses:</b> keep moving as one arrives to bring it down${sep()}stand still to head it${sep()}${k('shoot')} to head at goal</p>
    </div>
    <div class="ht-col">
      <h3>DEFEND</h3>
      <p>${k('pass')} switch player</p>
      <p>${k('shoot')} tackle${sep()}hold, or press while sprinting, to slide</p>
      <p>${k('through')} hold to press: he stays goal-side and steals loose touches</p>
      <p>Turn sharply while dribbling to cut past a defender</p>
      <p>${k('pause')} pause</p>
    </div>
  </div>
  <p class="fine">The <b>ringed</b> teammate is who a pass goes to: aim to pick another (arrows at the screen edge show mates out of shot). First-time finish: press ${k('shoot')} just before the ball reaches you. Change any key: <b>Settings › Keys</b>. Pass help (ASSISTED / SEMI / MANUAL): <b>Settings › Controls</b>.</p>`;
}

/** HOW TO PLAY for a gamepad (the player's own button bindings). */
function howtoPad(): string {
  const k = (a: PadAction) => kc(a, 'gamepad');
  return `
  <div class="howto">
    <div class="ht-col">
      <h3>ATTACK</h3>
      <p><kbd>LEFT STICK</kbd> move</p>
      <p>${k('pass')} pass to the <b>ringed</b> teammate${sep()}aim to pick another</p>
      <p>${k('through')} through ball${sep()}hold, then let go to cross</p>
      <p>${k('shoot')} hold, aim, let go to shoot${sep()}a longer hold lifts it</p>
      <p>Press ${k('shoot')} again as you strike: <b>perfect finish</b> (mistime it and it flies)</p>
      <p>Hold ${k('shoot')}, press ${k('through')}: chip${sep()}a soft diagonal shot curls</p>
      <p>${k('sprint')} sprint${sep()}press twice to knock it past</p>
      <p>${k('skill')} skill move: press it as a defender lunges (the <b>!</b> over him) for a <b>PERFECT</b></p>
      <p>Stick with ${k('skill')}: ahead = rainbow flick (a man squared up: nutmeg)${sep()}half across = elastico${sep()}across = roulette (slow: la croqueta)${sep()}half back = heel chop${sep()}back = drag back${sep()}none = stepover (standing: ball roll)</p>
      <p><b>Crosses:</b> keep moving as one arrives to bring it down${sep()}stand still to head it${sep()}${k('shoot')} to head at goal</p>
    </div>
    <div class="ht-col">
      <h3>DEFEND</h3>
      <p>${k('pass')} switch player</p>
      <p>${k('shoot')} tackle${sep()}hold, or press while sprinting, to slide</p>
      <p>${k('through')} hold to press: he stays goal-side and steals loose touches</p>
      <p>Turn sharply while dribbling to cut past a defender</p>
      <p>${k('pause')} pause</p>
    </div>
  </div>
  <p class="fine">The <b>ringed</b> teammate is who a pass goes to: aim to pick another (arrows at the screen edge show mates out of shot). First-time finish: press ${k('shoot')} just before the ball reaches you. Change any button: <b>Settings › Keys</b>. Pass help (ASSISTED / SEMI / MANUAL): <b>Settings › Controls</b>.</p>`;
}

/** One of the in-match touch buttons, drawn small (same colours, rim and base as the real ones). */
const touchBtn = (cls: string, label: string) => `<i class="ht-tb ${cls}"><span>${label}</span></i>`;
const dot = (cls: string) => `<i class="ht-dot ${cls}"></i>`;

/** HOW TO PLAY for touch (a function: its SKILL row names the key and pad button bound to it right now). */
const howtoTouch = (): string => `
  <div class="ht-touch">
    <div class="ht-pad" aria-hidden="true">
      <div class="ht-stick"><i></i></div>
      <span class="ht-pad-l">DRAG TO MOVE</span>
      <div class="ht-cluster">
        ${touchBtn('skill', 'SKILL')}${touchBtn('sprint', 'SPRINT')}${touchBtn('through', 'THROUGH')}${touchBtn('shoot', 'SHOOT')}${touchBtn('pass', 'PASS')}
      </div>
    </div>
    <p class="ht-note"><b>MOVE</b> <span class="ht-stick-float">Put your thumb down anywhere on the left half and drag: the stick follows your thumb.</span><span class="ht-stick-fixed">Put your thumb on the stick at the bottom left and drag (FIXED stick: Settings › Controls).</span></p>
    <table class="ht-table">
      <thead><tr><th></th><th>WITH THE BALL</th><th>DEFENDING</th></tr></thead>
      <tbody>
        <tr><td>${dot('pass')}</td><td><b>PASS</b> to the ringed teammate${sep()}aim to pick another</td><td>${dot('through')}<b>PRESS</b> hold: stay goal-side, steal loose touches${sep()}or go win a loose ball</td></tr>
        <tr><td>${dot('shoot')}</td><td><b>SHOOT</b> hold, aim, let go${sep()}a longer hold lifts it</td><td><b>TACKLE</b> tap to tackle${sep()}hold to slide</td></tr>
        <tr><td>${dot('through')}</td><td><b>THROUGH</b> through ball${sep()}hold, then let go to cross</td><td>${dot('def')}<b>SWITCH</b> player</td></tr>
        <tr><td>${dot('sprint')}</td><td><b>SPRINT</b> push the stick all the way (AUTO SPRINT)${sep()}or hold SPRINT${sep()}double tap it to knock it past</td><td><b>SPRINT</b> stick all the way to chase</td></tr>
        <tr class="ht-finish"><td>${dot('skill')}</td><td colspan="2"><b>SKILL</b> (shown with the ball) tap as a defender lunges, the <b>!</b> over him, for a PERFECT${sep()}the stick picks the move: ahead = rainbow flick (a man squared up: nutmeg)${sep()}half across = elastico${sep()}across = roulette (slow: la croqueta)${sep()}half back = heel chop${sep()}back = drag back${sep()}none = stepover (standing: ball roll)${sep()}keys ${kc('skill', 'keyboard')} pad ${kc('skill', 'gamepad')}</td></tr>
        <tr class="ht-finish"><td>${dot('shoot')}</td><td colspan="2"><b>PERFECT FINISH</b> tap SHOOT again as you strike (mistime it and it flies)</td></tr>
        <tr class="ht-finish"><td>${dot('shoot')}</td><td colspan="2"><b>CHIP</b> hold SHOOT, tap THROUGH${sep()}<b>CURL</b> a soft diagonal shot</td></tr>
        <tr class="ht-finish"><td>${dot('through')}</td><td colspan="2"><b>CROSSES</b> keep the stick pushed as one arrives to bring it down${sep()}let go to head it${sep()}SHOOT to head at goal</td></tr>
      </tbody>
    </table>
    <p class="fine">The <b>ringed</b> teammate is who PASS goes to: aim to pick another (edge arrows show mates out of shot). Set pieces: <b>PASS</b> short${sep()}<b>CROSS</b> hold to whip it in${sep()}<b>SHOOT</b> hold to shoot (a driven cross at a corner). Pass help: <b>Settings › Controls</b>. Tap to skip a replay; <b>II</b> pauses.</p>
  </div>`;

/** Blitz mode, under every How to Play tab: the pickups and the button that uses them. `use` names that button. */
const howtoBlitz = (use: string) => `
  <div class="ht-blitz">
    <h3>${pixelIcon('bolt', '#8a5cf6', 2, 'inl')}BLITZ MODE</h3>
    <p>Quick Match › MODE › BLITZ. Run over the glowing pickups on the pitch, then press ${use} to use the one you hold (one at a time, and it shows by the score):</p>
    <ul class="ht-pw">
      <li><i>${pixelIcon('bolt', '#1fb36b', 2)}</i><b>TURBO</b><span>a burst of pace</span></li>
      <li><i>${pixelIcon('burst', '#e2501a', 2)}</i><b>MEGA SHOT</b><span>your next shot is a rocket</span></li>
      <li><i>${pixelIcon('freeze', '#2a8fd0', 2)}</i><b>FREEZE</b><span>the other side slows for a few seconds</span></li>
      <li><i>${pixelIcon('magnet', '#d99a00', 2)}</i><b>MAGNET</b><span>the ball sticks to your feet</span></li>
      <li><i>${pixelIcon('shield', '#8a5cf6', 2)}</i><b>SHIELD</b><span>nobody can tackle you</span></li>
    </ul>
  </div>`;

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
      gift?: () => void; playNow?: () => void; account?: () => void; unlocks?: () => void;
      /** The coins in the top bar: the shop's COINS tab where coins can be topped up (absent: the shop). */
      coins?: () => void;
      /** REMOVE ADS in the top bar (drawn with `info.noAds`). */
      removeAds?: () => void;
      locked?: (f: LockedFeature) => void;
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
      hero = `<button class="hub-hero road ${road.cup ? 'cup' : ''}" data-a="career" aria-label="Road to Glory. ${escHtml(road.club.name)} against ${escHtml(road.rival.name)}, ${escHtml(what.toLowerCase())}. Play">
          ${head(road.cup ? 'BLOCKY CUP' : road.division)}
          <span class="hh-fix">${road.home || road.neutral ? me : them}<span class="hh-vs">${road.cup ? pixelIcon('trophy', '#ffd23a', 2) : ''}VS</span>${road.home || road.neutral ? them : me}</span>
          <span class="hh-sub">SEASON ${road.season}${sep()}${escHtml(what)}${sep()}${venue}</span>
          ${play('PLAY')}
        </button>`;
    } else if (road.kind === 'create') {
      hero = `<button class="hub-hero road create" data-a="career" aria-label="Road to Glory. Create your club">
          ${head()}
          <span class="hh-art">${pixelIcon('shirt', '#ffd23a', 6)}</span>
          <span class="hh-big">BUILD YOUR OWN CLUB</span>
          <span class="hh-sub">YOUR NAME, YOUR KIT, SIX DIVISIONS TO CLIMB</span>
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
      ? `<button class="hub-tile t-season ${sc.pending ? 'ready' : ''} ${sc.offer ? 'offer' : ''}" data-a="season" aria-label="Season ${escHtml(sc.name)}: tier ${sc.tier} of ${sc.tiers}${sc.pending ? `, ${sc.pending} rewards to claim` : ''}${sc.offer ? '. Club Pass' : ''}">
          <i class="ht-ic">${pixelIcon('crown', '#ffd23a', 4)}</i>
          <b class="ht-t">SEASON</b>
          <span class="hs-tier">TIER <em>${sc.tier}</em>/${sc.tiers}</span>
          <span class="hs-bar"><u style="width:${Math.round(sc.frac * 100)}%"></u></span>
          ${sc.offer ? '<em class="hs-pass">CLUB PASS</em>' : `<small class="ht-s">${sc.pending ? 'REWARDS TO CLAIM' : sc.pass ? 'CLUB PASS ON' : `${sc.days} ${sc.days === 1 ? 'DAY' : 'DAYS'} LEFT`}</small>`}
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
        : '<span class="hd-text">ALL DONE. NEW ONES TOMORROW</span>';
      const rows = list.map((c, k) => {
        const p = Math.min(c.goal, dl.progress[k] ?? 0);
        const ok = !!dl.claimed[k];
        return `<li class="${ok ? 'done' : ''}"><span class="dc-text">${c.text}</span><span class="dc-bar"><i style="width:${pct(c, k)}%"></i></span><b class="dc-n">${ok ? '✓' : `${p}/${c.goal}`}</b><em class="dc-coins">+${c.coins}</em></li>`;
      }).join('');
      daily = `<div class="hub-daily-wrap">
          <button class="hub-daily ${dl.fresh ? 'fresh' : ''}" data-a="daily" aria-expanded="false" aria-controls="hub-dl" aria-label="Daily challenges, ${done} of 3 done">
            <span class="hd-h"><b>DAILY</b><em>${done}/3</em></span>${next}
          </button>
          <ul class="hub-dl" id="hub-dl" hidden>${rows}</ul>
        </div>`;
    }
    const foot = `<div class="hub-foot">
        <button class="hub-mini t-quick" data-a="quick">${pixelIcon('ball', '#26262e', 3)}<b>QUICK MATCH</b></button>
        ${h.events ? `<button class="hub-mini t-events" data-a="events">${pixelIcon('bolt', '#ffd23a', 3)}<b>EVENTS</b></button>` : ''}
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
    const top = `<header class="hub-top">
        ${lvChip}
        <div class="hub-acts">
          ${h.gift && info?.gift ? `<button class="btn btn-yellow hub-gift" data-a="gift" aria-label="Daily gift, ${info.gift.amount} coins">${pixelIcon('gift', '#26262e', 2, 'inl')}<span class="hg-w">GIFT</span><b>+${info.gift.amount}</b></button>` : ''}
          ${h.account ? `<button class="btn btn-white hub-acct" data-a="account" aria-label="Account and cloud saves">${info?.account ? escHtml(info.account.toUpperCase()) : 'ACCOUNT'}</button>` : ''}
          ${h.removeAds && info?.noAds ? `<button class="btn btn-red hub-noads" data-a="noads" aria-label="Remove ads, ${escHtml(info.noAds.price)}">${pixelIcon('film', '#fff', 2, 'inl')}<span>REMOVE ADS</span><b class="hn-p">${escHtml(info.noAds.price)}</b></button>` : ''}
          ${wallet}
          <button class="hub-ico" data-a="howto" aria-label="How to play"><b>?</b></button>
          <button class="hub-ico" data-a="settings" aria-label="Settings">${pixelIcon('gear', '#fbfbf4', 3)}</button>
        </div>
      </header>`;

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
          <div class="hub-main">${hero}</div>
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
    on('noads', h.removeAds);
    on('coins', h.coins ?? h.shop);
    on('unlocks', h.unlocks);
    on('howto', h.howto);
    on('settings', h.settings);
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
      h.moments ? card('moments', 'moments', 'ev-mom', pixelIcon('star', '#ffd23a', 5), 'MOMENTS', 'Short challenges, up to three stars each', seps(escHtml(info?.moments ?? 'SHORT CHALLENGES'))) : '',
      h.run ? card('run', 'run', 'ev-run', pixelIcon('trophy', '#fff', 5), 'CLUB RUN', 'Seven matches in a row: lose one and the run ends', seps(escHtml(info?.run ?? 'ONE MORE RUN'))) : '',
      h.blitz ? card('blitz', 'blitz', 'ev-blitz', pixelIcon('bolt', '#ffd23a', 5), 'BLITZ', 'Football with power ups on the pitch', 'TURBO, MEGA SHOT, FREEZE') : '',
      h.online ? card('online', null, 'ev-online', pixelIcon('duo', '#fff', 5), 'ONLINE', 'Play a friend on another device', 'SHARE A CODE') : '',
    ].join('');
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel ev-panel">
          <h2>EVENTS</h2>
          <div class="ev-grid">${cards}</div>
          <div class="btn-row"><button class="btn btn-white" data-a="back">BACK</button></div>
        </div>
      </div>`, 'events-screen');
    this.wireLocked(d, h.locked);
    for (const k of ['moments', 'run', 'blitz', 'online'] as const) d.querySelector(`[data-a=${k}]`)?.addEventListener('click', () => h[k]?.());
    $(d, '[data-a=back]').addEventListener('click', h.back);
  }

  quickMatch(
    save: SaveData, onBack: () => void, onKickOff: (home: number, away: number, mode: MatchMode) => void, mode?: MatchMode, blitzLocked = false,
  ): void {
    let home = save.clubIdx;
    let away = save.opponentIdx === home ? (home + 1) % PRESET_CLUBS.length : save.opponentIdx;
    const modes: MatchMode[] = ['classic', 'blitz'];
    let cur: MatchMode = blitzLocked ? 'classic' : mode ?? (save.settings.lastMode === 'blitz' ? 'blitz' : 'classic');
    const d = this.mount(`
      <div class="panel-wrap">
        <div class="panel qm">
          <h2>QUICK MATCH</h2>
          <div class="vs-row">
            <div class="team-pick" data-side="home"></div>
            <div class="vs">VS</div>
            <div class="team-pick" data-side="away"></div>
          </div>
          <div class="opt-row mode-row"><label>MODE</label><div class="seg seg-mode" data-o="mode"></div></div>
          <p class="qm-why" aria-live="polite"></p>
          <div class="opt-row"><label>DIFFICULTY</label><div class="seg" data-o="diff"></div></div>
          <div class="opt-row"><label>HALF LENGTH</label><div class="seg" data-o="len"></div></div>
          <div class="opt-row"><label>KICK OFF</label><div class="seg" data-o="tod"></div></div>
          <div class="opt-row"><label>WEATHER</label><div class="seg" data-o="wx"></div></div>
          <div class="btn-row">
            <button class="btn btn-white" data-a="back">BACK</button>
            <button class="btn btn-go btn-lg" data-a="go">KICK OFF</button>
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
        <span class="tp-label">${side === 'home' ? 'YOU' : 'RIVAL'}</span>
        <div class="tp-body">
          <button class="arrow" data-d="-1">←</button>
          <div class="tp-kit">${preview.ok ? '<canvas class="tp-3d"></canvas>' : shirtArt(c.kit, 9)}</div>
          <button class="arrow" data-d="1">→</button>
        </div>
        <b class="tp-name">${crestSvg(c.name, c.short, c.kit, 2)}${c.name}</b>
        <span class="tp-stars">${stars(ovr)}</span>
        <span class="tp-meta">OVR ${ovr}${sep()}<span class="fm">${c.formation}</span></span>`;
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
          render(side);
        }),
      );
    };
    render('home');
    render('away');
    const seg = (key: 'mode' | 'diff' | 'len' | 'tod' | 'wx', labels: string[], get: () => number, set: (i: number) => void) => {
      const el = $(d, `[data-o=${key}]`);
      const draw = () => {
        el.innerHTML = labels.map((l, i) => `<button class="${i === get() ? 'on' : ''}" data-i="${i}">${l}</button>`).join('');
        el.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
          b.addEventListener('click', () => {
            sfx.click();
            set(Number(b.dataset.i));
            draw();
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
    const tods = ['day', 'sunset', 'night', 'random'] as const;
    seg('tod', ['DAY', 'SUNSET', 'NIGHT', 'RANDOM'], () => Math.max(0, tods.indexOf(save.settings.timeOfDay)), (i) => (save.settings.timeOfDay = tods[i]));
    const wxs = ['clear', 'rain', 'snow', 'random'] as const;
    seg('wx', ['CLEAR', 'RAIN', 'SNOW', 'RANDOM'], () => Math.max(0, wxs.indexOf(save.settings.weather)), (i) => (save.settings.weather = wxs[i]));
    $(d, '[data-a=back]').addEventListener('click', onBack);
    $(d, '[data-a=go]').addEventListener('click', () => onKickOff(home, away, cur));
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
            <button class="btn btn-red" data-a="quit">${escHtml(h.quitLabel ?? 'QUIT MATCH')}</button>
          </div>
          <div class="quit-ask" hidden>
            <p class="fine big">${h.quitNote ?? "This match won't count."}</p>
            <div class="menu-col">
              <button class="btn btn-go btn-lg" data-a="stay">KEEP PLAYING</button>
              <button class="btn btn-red" data-a="really">YES, QUIT</button>
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
      title.textContent = on ? 'QUIT MATCH?' : 'PAUSED';
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
   * In-match tactics for the human side: formation, the XI on a pitch in formation slots (OVR + stamina on
   * every starter), bench, mentality. Tap a starter then a substitute (or the other way round) to make a sub.
   */
  tactics(
    m: Match, side: 0 | 1, kits: [Kit, Kit],
    h: {
      setMentality: (v: number) => void;
      substitute: (slot: number, benchIdx: number) => boolean;
      setFormation?: (id: FormationId) => void;
      back: () => void;
    },
  ): void {
    const kit = kits[side];
    const light = lum(kit.shirt) > 0.62;
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel tactics tx">
          <div class="tx-pitch" style="--shirt:${cssHex(kit.shirt)};--trim:${cssHex(kit.shirt2)};--gk:${cssHex(kit.gk)};--dot-t:${light ? 'var(--ink)' : '#fff'}"></div>
          <div class="tx-side">
            <div class="tx-head"><h2>TACTICS</h2><span class="tx-left"></span></div>
            <div class="tx-row tx-forms-row"><label>FORMATION</label><div class="seg tx-forms"></div></div>
            <div class="tx-row tx-ment-row"><label>MENTALITY</label><div class="seg tx-ment"></div></div>
            <div class="tx-benchbox"><div class="tx-bh"><h3>BENCH</h3><p class="tx-hint"></p></div><ul class="tx-bench"></ul></div>
          </div>
          <div class="btn-row"><button class="btn btn-go btn-lg" data-a="back">DONE</button></div>
        </div>
      </div>`, 'tactics-screen');
    /** Current pick: a starter (slot) or a bench player waiting for the other half of the swap. */
    let picked: { k: 'x' | 'b'; i: number } | null = null;
    let chosen: FormationId | null = null;
    let fresh = -1;
    const pitch = $(d, '.tx-pitch');
    const bench = $(d, '.tx-bench');

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
          return `<button class="tx-p ${cls}" data-k="x${i}" style="left:${l}%;top:${t}%;--room:${room}%" ${p.sentOff ? 'disabled' : ''}
            aria-label="${slot?.label ?? ''} ${p.def.name}, overall ${overall(p.def)}, stamina ${st}%${p.sentOff ? ', sent off' : ''}">
            <span class="tx-shirt"><b>${p.def.number}</b><i class="tx-ovr">${overall(p.def)}</i><s class="tx-st"><u style="width:${st}%;background:${col}"></u></s></span>
            <em class="tx-nm">${lastName(p.def.name)}</em>
          </button>`;
        })
        .join('');
    };

    const drawBench = () => {
      const list = m.bench[side];
      const x = picked?.k === 'x' ? picked.i : -1;
      bench.innerHTML = list.length
        ? list
            .map((p, i) => {
              const ok = x >= 0 ? canSwap(x, p) : subsLeft() > 0;
              const sel = picked?.k === 'b' && picked.i === i;
              return `<li><button class="tx-b ${sel ? 'sel' : ''} ${ok ? (x >= 0 ? 'hot' : '') : 'off'}" data-k="b${i}" ${ok ? '' : 'aria-disabled="true"'}>
                ${faceHtml(p, kit, 'sm')}<i style="background:${cssHex(kit.shirt)};color:${light ? 'var(--ink)' : '#fff'}">${p.number}</i><span>${p.name}</span><em>${p.role}</em><b>${overall(p)}</b>
              </button></li>`;
            })
            .join('')
        : '<li class="tx-empty">Nobody left on the bench.</li>';
      const left = subsLeft();
      hydrateFaces(bench);
      $(d, '.tx-left').textContent = left > 0 ? `${left} OF ${maxSubs()} SUBS LEFT` : 'NO SUBS LEFT';
      $(d, '.tx-left').classList.toggle('none', left <= 0);
      const team = m.teamPlayers(side);
      $(d, '.tx-hint').textContent =
        left <= 0 ? 'All substitutions made.'
          : picked?.k === 'x' ? `${team[picked.i].def.name} off: pick a sub.`
            : picked?.k === 'b' ? `${list[picked.i]?.name ?? ''} on: pick who comes off.`
              : 'Tap a player, then a sub.';
    };

    const drawForms = () => {
      const cur = formation();
      const el = $(d, '.tx-forms');
      el.innerHTML = FORMATION_IDS.map((f) => `<button class="${f === cur ? 'on' : ''}" data-f="${f}" ${h.setFormation ? '' : 'disabled'}>${f}</button>`).join('');
    };
    const drawMent = () => {
      const labels = ['DEFENSIVE', 'BALANCED', 'ATTACKING'];
      $(d, '.tx-ment').innerHTML = labels.map((l, i) => `<button class="${m.mentality[side] === i - 1 ? 'on' : ''}" data-i="${i}">${l}</button>`).join('');
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
      fresh = slot;
      return true;
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
      const btn = t.closest<HTMLButtonElement>('.tx-p, .tx-b');
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
    drawForms();
    drawMent();
    draw();
    $(d, '[data-a=back]').addEventListener('click', h.back);
  }

  halftime(m: Match, kits: [Kit, Kit], onContinue: () => void, onTactics?: () => void): void {
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel">
          <h2>HALF TIME</h2>
          ${this.scoreHeader(m, kits)}
          ${this.statsTable(m, kits)}
          <div class="btn-row">
            ${onTactics ? '<button class="btn btn-blue" data-a="tactics">TACTICS &amp; SUBS</button>' : ''}
            <button class="btn btn-go btn-lg" data-a="go">SECOND HALF</button>
          </div>
        </div>
      </div>`, 'ht');
    const go = () => {
      this.stopKey(key);
      onContinue();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') go();
    };
    this.listenKey(key);
    $(d, '[data-a=go]').addEventListener('click', go);
    d.querySelector('[data-a=tactics]')?.addEventListener('click', () => {
      this.stopKey(key);
      onTactics?.();
    });
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
    const motmHtml = motm
      ? `<div class="motm">
          <div class="motm-card" style="--k:${cssHex(kits[motm.side].shirt)}">${face(motm, 'xl')}<span>MAN OF THE MATCH</span><b>${motm.name}</b><em>${motm.rating.toFixed(1)}</em>
          ${motm.goals ? `<small>${motm.goals} goal${motm.goals > 1 ? 's' : ''}${motm.assists ? `${sep()}${motm.assists} assist${motm.assists > 1 ? 's' : ''}` : ''}</small>` : motm.assists ? `<small>${motm.assists} assist${motm.assists > 1 ? 's' : ''}</small>` : ''}</div>
          <ul class="ratings">${mine.map((r) => `<li>${face(r, 'sm')}<span>${r.name}</span><b class="${r.rating >= 7.5 ? 'hi' : r.rating < 6 ? 'lo' : ''}">${r.rating.toFixed(1)}</b></li>`).join('')}</ul>
        </div>`
      : '';
    const my = m.score[humanSide];
    const their = m.score[humanSide === 0 ? 1 : 0];
    // A level knockout tie is settled on penalties.
    const so = m.shootout && m.shootout.winner >= 0 ? m.shootout : null;
    const res = so ? (so.winner === humanSide ? 1 : -1) : Math.sign(my - their);
    const verdict = res > 0 ? 'YOU WIN!' : res === 0 ? 'DRAW' : 'YOU LOSE';
    const cls = res > 0 ? 'win' : res === 0 ? 'draw' : 'lose';
    const pens = so
      ? `<p class="ft-pens">${m.teams[so.winner as 0 | 1].short} WIN ${so.kicks[so.winner as 0 | 1].filter(Boolean).length}${SCORE_SEP_HTML}${so.kicks[so.winner === 0 ? 1 : 0].filter(Boolean).length} ON PENALTIES</p>`
      : '';
    // Progression: stars, the XP bar (counts up after the coins), the streak chip and any challenges done.
    const lv0 = prog ? levelOf(prog.xpFrom) : null;
    const progHtml = prog && lv0
      ? `<div class="ft-prog">
          <div class="ft-stars" role="img" aria-label="${prog.stars} of 3 stars">${[1, 2, 3].map((i) => `<i class="${i <= prog.stars ? 'lit' : ''}" style="--i:${i}">★</i>`).join('')}</div>
          <div class="ft-xp">
            <div class="ft-xp-h"><b class="ft-lv">LV ${lv0.level}</b><span class="ft-title">${levelTitle(lv0.level).toUpperCase()}</span><em class="ft-xp-n">+0 XP</em></div>
            <div class="ft-xp-bar"><i style="width:${Math.round((lv0.into / lv0.need) * 100)}%"></i></div>
            <div class="ft-levelup" aria-live="polite"></div>
            ${(() => { const nu = nextUnlock(prog.xpTo, prog.owned); return nu ? `<div class="ft-next">NEXT UNLOCK: <b>${nu.name.toUpperCase()}</b>${sep()}LV ${nu.level}${sep()}${nu.xpLeft} XP</div>` : ''; })()}
          </div>
          ${prog.streak >= 1 && prog.mult > 1 ? `<div class="ft-streak">${pixelIcon('fire', '#ff9a3a', 2, 'inl')}${prog.streak} WIN STREAK <b>×${prog.mult.toFixed(1)}</b></div>` : ''}
          ${prog.done.length ? `<ul class="ft-daily">${prog.done.map((c) => `<li><span>✓ ${c.text}</span><b>+${c.coins}</b></li>`).join('')}</ul>` : ''}
          ${extra.tierUps?.length ? `<ul class="ft-tiers">${extra.tierUps.map((t) => `<li>${escHtml(t)}</li>`).join('')}</ul>` : ''}
          ${extra.shopReach ? `<p class="ft-shop">NOW IN REACH IN THE SHOP: <b>${escHtml(extra.shopReach.name.toUpperCase())}</b> ${escHtml(extra.shopReach.kind.toLowerCase())}</p>` : ''}
        </div>`
      : '';
    const easyHtml = extra.tryEasy
      ? '<p class="ft-easy">Tough run? <button class="btn btn-white ft-easy-btn" data-a="easy">TRY EASY</button></p>'
      : '';
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel">
          <h2 class="verdict ${cls}">${verdict}</h2>
          ${this.scoreHeader(m, kits)}${pens}
          ${easyHtml}
          ${progHtml}
          ${this.clipRow(extra.clip, true)}
          ${motmHtml}
          ${this.statsTable(m, kits)}
          <div class="btn-row ft-foot">
            <div class="reward"><i></i><span class="rw-n">+0</span><em>${reward.label}</em></div>
            ${canDouble ? `<button class="btn btn-yellow" data-a="double">${pixelIcon('film', '#26262e', 2, 'inl')}2× COINS</button>` : ''}
            ${h.rematch ? '<button class="btn btn-white btn-lg" data-a="rematch">⟳ REMATCH</button>' : ''}
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
          <p class="fine big">Now your first match. Score a goal to unlock <b>ROAD TO GLORY</b>, <b>MOMENTS</b>, <b>CLUB RUN</b> and <b>BLITZ</b>.</p>
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
            <li>${pixelIcon('trophy', '#ffd23a', 3)}<b>ROAD TO GLORY</b><span>build a club, climb six divisions</span></li>
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
    const rows = ladder.map((u) => {
      const got = u.level <= lv.level || shopped(u);
      const next = u.level === nextLevel;
      const icon = u.kind === 'ball'
        ? pixelIcon('ball', got ? (u.id === 'classic' ? '#26262e' : BALL_TINT[u.id as BallSkinId] ?? '#26262e') : '#b9b5aa', 3)
        : pixelIcon('star', got ? '#ffd23a' : '#b9b5aa', 3);
      const when = u.level > lv.level && got ? 'BOUGHT' : got ? 'EARNED' : next ? `${Math.max(0, xpAt(u.level) - xp)} XP TO GO` : `LEVEL ${u.level}`;
      return `<li class="${got ? 'got' : ''}${next ? ' next' : ''}"><i class="ul-lv">LV ${u.level}</i>${icon}<span>${escHtml(u.name.toUpperCase())}<small>${u.kind === 'ball' ? 'BALL LOOK' : 'GOAL CELEBRATION'}</small></span><em>${when}</em></li>`;
    }).join('');
    const stars = save.progress.stars;
    const legend = legendUnlocked(save.progress);
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel ul">
          <h2>UNLOCKS</h2>
          <div class="ul-head"><b>LV ${lv.level}</b><span>${escHtml(levelTitle(lv.level).toUpperCase())}</span><em>${lv.into} / ${lv.need} XP</em></div>
          <div class="ft-xp-bar ul-bar"><i style="width:${Math.round((lv.into / lv.need) * 100)}%"></i></div>
          <p class="ul-sum">${earned} OF ${ladder.length} EARNED${sep()}XP COMES FROM EVERY MATCH AND MOMENT</p>
          <ul class="ul-list" aria-label="Unlock ladder">
            ${rows}
            <li class="legend ${legend ? 'got' : ''}"><i class="ul-lv">★ ${LEGEND_STARS}</i>${pixelIcon('trophy', legend ? '#ffd23a' : '#b9b5aa', 3)}<span>LEGEND DIFFICULTY<small>MATCH STARS, NOT LEVELS</small></span><em>${legend ? 'EARNED' : `${Math.min(stars, LEGEND_STARS)} / ${LEGEND_STARS} STARS`}</em></li>
          </ul>
          <div class="btn-row">
            <button class="btn btn-white btn-lg" data-a="back">BACK</button>
            ${onBadges ? '<button class="btn btn-blue btn-lg" data-a="badges">BADGES &amp; SEASON ▸</button>' : ''}
          </div>
        </div>
      </div>`, 'unlocks');
    $(d, '[data-a=back]').addEventListener('click', onBack);
    d.querySelector('[data-a=badges]')?.addEventListener('click', () => onBadges?.());
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
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel mo">
          <h2 class="verdict ${o.won ? 'win' : 'lose'}">${o.won ? 'MOMENT COMPLETE' : 'FAILED'}</h2>
          <p class="mo-title">${escHtml(spec.title)}</p>
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
          <div class="btn-row ft-foot mo-foot">
            <button class="btn btn-white" data-a="menu">MENU</button>
            <button class="btn btn-yellow btn-lg" data-a="retry">⟳ RETRY</button>
            <button class="btn btn-go btn-lg" data-a="next">${escHtml(h.nextLabel ?? 'NEXT MOMENT')}</button>
          </div>
        </div>
      </div>`, 'ft moment');
    this.playProgress(d, { stars: o.stars, xpFrom: xp.from, xpTo: xp.to, streak: 0, mult: 1, done: [] });
    $(d, '[data-a=menu]').addEventListener('click', h.menu);
    $(d, '[data-a=retry]').addEventListener('click', h.retry);
    $(d, '[data-a=next]').addEventListener('click', h.next);
  }

  /**
   * Settings, in three tabs: GENERAL (REMOVE ADS first where the app sells it (`opts.removeAds`), sound, commentary,
   * colour-blind aid, graphics, camera, TEXT SIZE (menus and HUD only: ui/textSize.ts), the ball look and
   * celebration earned by levelling up, and BACKUP when `opts.backup` is given: the main menu offers it, the
   * pause menu not), CONTROLS (pass assistance, switching, timed finishing, the touch THUMBSTICK; each option
   * says in a line what it does) and KEYS (rebind the keyboard and gamepad, with swaps on a conflict and RESET).
   * `tab` picks the one shown first (the pause menu opens on CONTROLS). Every change is saved and applied at
   * once via onChange.
   */
  settings(
    save: SaveData, onChange: () => void, onBack: () => void, tab: 'general' | 'controls' | 'keys' = 'general',
    opts: {
      backup?: () => void;
      /** REMOVE ADS, first in GENERAL (the app): its price, whether it is owned, and the purchase (true once bought). */
      removeAds?: { price: string; owned: boolean; buy: () => Promise<boolean> };
    } = {},
  ): void {
    const s = save.settings;
    // Each row carries both forms of a switch: the one-button ON / OFF toggle (portrait: label inside it) and
    // an ON | OFF segment (landscape phones: label and its line on the left, the value on the right). CSS
    // shows one; both drive the same setting.
    // (VIBRATION only where it can work: the app.)
    const rows = CONTROL_ROWS.filter((r) => !r.appOnly || hapticsAvailable());
    const ctlRow = (r: ControlRow) => {
      const opts = r.opts ?? (r.kind === 'level' ? ASSIST_LEVELS.map((l) => [l, l.toUpperCase()]) : [['true', 'ON'], ['false', 'OFF']]);
      return `<div class="ctl-row ${r.kind}" data-c="${r.k}">
          <span class="ctl-label" id="ctl-${r.k}">${r.label}</span>
          <div class="seg ctl-seg" role="radiogroup" aria-labelledby="ctl-${r.k}">
            ${opts.map(([v, t]) => `<button data-v="${v}" role="radio">${t}</button>`).join('')}
          </div>
          ${r.kind === 'switch' ? `<div class="toggles ctl-tog"><button data-t="${r.k}" role="switch"><span>${r.label}</span><b></b></button></div>` : ''}
          <p class="ctl-why" aria-live="polite"></p>
        </div>`;
    };
    const STICK_WHY: Record<'floating' | 'fixed', string> = {
      floating: `The stick appears under your thumb${sep()}anywhere on the left`,
      fixed: `Anchored bottom left, always drawn${sep()}put your thumb on it`,
    };
    const keyRow = (a: KeyAction) => `<div class="kb-row" data-ka="${a}"><span class="kb-act">${KEY_ACTION_NAMES[a]}</span>${
      Array.from({ length: KEY_SLOTS }, (_, i) => `<button class="kb-slot" data-ka="${a}" data-s="${i}" aria-label="${KEY_ACTION_NAMES[a]} key ${i + 1}"></button>`).join('')}</div>`;
    const padRow = (a: PadAction) => `<div class="kb-row" data-pa="${a}"><span class="kb-act">${KEY_ACTION_NAMES[a]}</span>${
      Array.from({ length: PAD_SLOTS }, (_, i) => `<button class="kb-slot" data-pa="${a}" data-s="${i}" aria-label="${KEY_ACTION_NAMES[a]} button ${i + 1}"></button>`).join('')}</div>`;
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow set-panel">
          <h2>SETTINGS</h2>
          <div class="seg set-tabs" role="tablist">
            <button data-tab="general" role="tab">GENERAL</button>
            <button data-tab="controls" role="tab">CONTROLS</button>
            <button data-tab="keys" role="tab">KEYS</button>
          </div>
          <div class="set-pane" data-pane="general" role="tabpanel">
            <div class="toggles">
              ${opts.removeAds ? `<button class="set-noads ${opts.removeAds.owned ? 'owned' : ''}" data-a="noads" ${opts.removeAds.owned ? 'disabled' : ''} aria-label="${opts.removeAds.owned ? 'No ads: on' : `Remove ads, ${escHtml(opts.removeAds.price)}`}"><span>${opts.removeAds.owned ? 'NO ADS' : 'REMOVE ADS'}</span><b class="${opts.removeAds.owned ? '' : 'link'}">${opts.removeAds.owned ? 'ON' : escHtml(opts.removeAds.price)}</b></button>` : ''}
              <button data-k="sfx"></button>
              <button data-k="crowd"></button>
              <button data-k="music"></button>
              <button data-k="commentary"></button>
              <button data-k="quickSubs"></button>
              <button data-k="colorblind"></button>
              <button data-k="quality"></button>
              <button data-k="camZoom"></button>
              <button data-k="textSize"></button>
              <button data-k="ballSkin"></button>
              <button data-k="celebration"></button>
              ${opts.backup ? '<button data-a="backup" aria-label="Backup: export or import your save"><span>BACKUP</span><b class="link">EXPORT / IMPORT</b></button>' : ''}
              <button data-a="feedback" aria-label="Send feedback by email"><span>FEEDBACK</span><b class="link">EMAIL US</b></button>
            </div>
            <p class="set-about">${lynxSvg(1, STUDIO_BLUE, '#fff', 'lynx sm')}<span>Blocky League v${APP_VERSION} by ${STUDIO}</span></p>
          </div>
          <div class="set-pane ctl-pane" data-pane="controls" role="tabpanel">
            ${rows.map(ctlRow).join('')}
            <div class="ctl-row level ctl-stick" data-c="stick">
              <span class="ctl-label" id="ctl-stick">THUMBSTICK</span>
              <div class="seg ctl-seg" role="radiogroup" aria-labelledby="ctl-stick">
                <button data-stick="floating" role="radio">FLOATING</button>
                <button data-stick="fixed" role="radio">FIXED</button>
              </div>
              <p class="ctl-why" aria-live="polite"></p>
            </div>
          </div>
          <div class="set-pane kb-pane" data-pane="keys" role="tabpanel">
            <p class="kb-msg" role="status" aria-live="polite"></p>
            <div class="kb-head"><b>KEYBOARD</b><button class="btn btn-white kb-reset" data-reset="keys">RESET</button></div>
            <p class="kb-hint">Tap a key box, then press the new key. A key already in use swaps over. BACKSPACE clears a spare, ESC cancels.</p>
            <div class="kb-grid">${KEY_ACTIONS.map(keyRow).join('')}</div>
            <div class="kb-head"><b>GAMEPAD</b><button class="btn btn-white kb-reset" data-reset="pad">RESET</button></div>
            <p class="kb-hint">Tap a button box, then press the button on the pad. The d-pad and left stick always move.</p>
            <div class="kb-grid pad">${PAD_ACTIONS.map(padRow).join('')}</div>
          </div>
          <div class="btn-row"><button class="btn btn-go" data-a="back">DONE</button></div>
        </div>
      </div>`, 'settings');
    const showTab = (t: 'general' | 'controls' | 'keys') => {
      d.querySelectorAll<HTMLButtonElement>('.set-tabs button').forEach((b) => {
        const on = b.dataset.tab === t;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      });
      d.querySelectorAll<HTMLElement>('.set-pane').forEach((p) => (p.hidden = p.dataset.pane !== t));
      d.querySelector('.panel')!.scrollTop = 0;
      stopListening();
    };
    d.querySelectorAll<HTMLButtonElement>('.set-tabs button').forEach((b) =>
      b.addEventListener('click', () => showTab(b.dataset.tab as 'general' | 'controls' | 'keys')),
    );
    // Controls: an ASSISTED / SEMI / MANUAL row per pass type, an ON / OFF switch for the rest.
    const drawControls = () => {
      const c = controlsOf(s);
      for (const r of rows) {
        const row = $(d, `.ctl-row[data-c=${r.k}]`);
        const v = c[r.k];
        row.querySelectorAll<HTMLButtonElement>('.ctl-seg button').forEach((b) => {
          const on = b.dataset.v === String(v);
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', String(on));
        });
        const t = row.querySelector<HTMLButtonElement>('[data-t]');
        if (t) {
          t.setAttribute('aria-checked', String(v));
          const chip = t.querySelector('b')!;
          chip.textContent = v ? 'ON' : 'OFF';
          chip.classList.toggle('off', !v);
        }
        // Static copy with divider elements in it (see CONTROL_ROWS): markup, not text. ({Tap}: "Tap" on touch,
        // "Press" on keys and pads, as the coach says it: ui/coach.ts.)
        $(row, '.ctl-why').innerHTML = coachText(r.why[String(v)] ?? '', currentDevice());
      }
      const stick = s.stick === 'fixed' ? 'fixed' : 'floating';
      const sr = $(d, '.ctl-row[data-c=stick]');
      sr.querySelectorAll<HTMLButtonElement>('[data-stick]').forEach((b) => {
        const on = b.dataset.stick === stick;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
      $(sr, '.ctl-why').innerHTML = STICK_WHY[stick];
    };
    for (const r of rows) {
      const row = $(d, `.ctl-row[data-c=${r.k}]`);
      row.querySelectorAll<HTMLButtonElement>('.ctl-seg button').forEach((b) =>
        b.addEventListener('click', () => {
          const v = b.dataset.v!;
          if (r.k === 'groundAssist') s.groundAssist = v as AssistLevel;
          else if (r.k === 'throughAssist') s.throughAssist = v as AssistLevel;
          else if (r.k === 'vibration') s.vibration = v as HapticLevel;
          else s[r.k] = v === 'true';
          drawControls();
          onChange();
        }),
      );
      row.querySelector('[data-t]')?.addEventListener('click', () => {
        if (r.kind === 'switch' && r.k !== 'groundAssist' && r.k !== 'throughAssist' && r.k !== 'vibration') s[r.k] = !controlsOf(s)[r.k];
        drawControls();
        onChange();
      });
    }
    d.querySelectorAll<HTMLButtonElement>('[data-stick]').forEach((b) =>
      b.addEventListener('click', () => {
        s.stick = b.dataset.stick === 'fixed' ? 'fixed' : 'floating';
        drawControls();
        onChange();
      }),
    );
    drawControls();

    // KEYS: every slot shows its key; tapping one listens for the next key (or gamepad button).
    const msgEl = $(d, '.kb-msg');
    const say = (t: string, kind: 'good' | 'bad' | '' = '') => {
      msgEl.textContent = t;
      msgEl.className = `kb-msg ${kind}`;
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
    showTab(tab);

    const labels: Record<string, string> = {
      sfx: 'SOUND FX', crowd: 'CROWD', music: 'MUSIC', commentary: 'COMMENTARY', colorblind: 'COLOUR BLIND', quality: 'GRAPHICS',
      camZoom: 'CAMERA', ballSkin: 'BALL', celebration: 'CELEBRATION', quickSubs: 'QUICK SUBS', textSize: 'TEXT SIZE',
    };
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
        const on = k === 'colorblind' ? v === true : k === 'quickSubs' ? v !== false : v;
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
        else (s as unknown as Record<string, boolean>)[k] = !s[k];
        draw();
        onChange();
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
    // REMOVE ADS: the store's own sheet confirms the purchase; once bought the row reads NO ADS: ON.
    const noAds = d.querySelector<HTMLButtonElement>('[data-a=noads]');
    noAds?.addEventListener('click', async () => {
      if (!opts.removeAds || noAds.disabled) return;
      noAds.disabled = true;
      const bought = await opts.removeAds.buy().catch(() => false);
      if (!noAds.isConnected) return;
      if (bought) {
        noAds.classList.add('owned');
        noAds.innerHTML = '<span>NO ADS</span><b>ON</b>';
      } else noAds.disabled = false;
    });
    $(d, '[data-a=back]').addEventListener('click', () => {
      stopListening();
      onBack();
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
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow bk-panel">
          <h2>BACKUP</h2>
          <p class="fine big">Your progress lives in this browser. Export a copy to keep it safe or carry it to another device; import one to restore it.</p>
          <div class="bk-card"><span>THIS SAVE</span><em>${line(save)}</em></div>
          <div class="menu-col bk-main">
            <button class="btn btn-go" data-a="export">EXPORT SAVE</button>
            <button class="btn btn-blue" data-a="import">IMPORT SAVE</button>
            <input type="file" accept=".json,application/json" hidden aria-label="Save file">
          </div>
          <div class="bk-confirm" hidden>
            <div class="bk-card"><span>FROM THE FILE</span><em class="bk-in"></em></div>
            <p class="fine big">Replace your save with this one? The current one is gone unless you exported it.</p>
            <div class="menu-col">
              <button class="btn btn-red" data-a="replace">REPLACE MY SAVE</button>
              <button class="btn btn-white" data-a="keep">KEEP MINE</button>
            </div>
          </div>
          <p class="bk-msg fine" role="status" aria-live="polite"></p>
          <div class="btn-row"><button class="btn btn-white" data-a="back">BACK</button></div>
        </div>
      </div>`, 'backup');
    const msgEl = $(d, '.bk-msg');
    const msg = (text: string, kind: 'good' | 'bad' | '' = '') => {
      msgEl.textContent = text;
      msgEl.className = `bk-msg fine ${kind}`;
    };
    const main = $(d, '.bk-main');
    const confirm = $(d, '.bk-confirm');
    let pending: SaveData | null = null;
    const asking = (d2: SaveData | null) => {
      pending = d2;
      main.hidden = !!d2;
      confirm.hidden = !d2;
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
   * Controls for the device in hand: the touch pad (stick + the coloured buttons and what each one does when
   * attacking / defending), keyboard, or gamepad. Tabs show the others.
   */
  howTo(onBack: () => void, device: 'keyboard' | 'touch' | 'gamepad' = defaultDevice()): void {
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel howto-panel">
          <h2>HOW TO PLAY</h2>
          <div class="seg ht-tabs" role="tablist">
            <button data-dev="touch" role="tab">TOUCH</button>
            <button data-dev="keyboard" role="tab">KEYBOARD</button>
            <button data-dev="gamepad" role="tab">GAMEPAD</button>
          </div>
          <div class="ht-body"></div>
          <div class="btn-row"><button class="btn btn-go" data-a="back">GOT IT</button></div>
        </div>
      </div>`, 'howto-screen');
    d.classList.toggle('stick-fixed', this.stick === 'fixed');
    const body = $(d, '.ht-body');
    const show = (dev: 'keyboard' | 'touch' | 'gamepad') => {
      d.querySelectorAll<HTMLButtonElement>('.ht-tabs button').forEach((b) => {
        const on = b.dataset.dev === dev;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      });
      body.innerHTML = (dev === 'touch' ? howtoTouch() : dev === 'gamepad' ? howtoPad() : howtoKeys())
        + howtoBlitz(dev === 'touch' ? `the <b class="inl-ic">${pixelIcon('bolt', '#8a5cf6', 1.6, 'inl')}</b> button` : kc('power', dev));
    };
    d.querySelectorAll<HTMLButtonElement>('.ht-tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.click();
        show(b.dataset.dev as 'keyboard' | 'touch' | 'gamepad');
      }),
    );
    show(device);
    $(d, '[data-a=back]').addEventListener('click', onBack);
  }

  /**
   * The welcome offer, once ever, after the first win (main.ts; the app's store only): the Starter Pack with its
   * real price and worth. No timer and no pressure: it says plainly that the pack stays in the shop.
   */
  welcomeOffer(o: { price: string; coins: number; worth: number }, h: { see: () => void; later: () => void }): void {
    const n = (v: number) => v.toLocaleString('en-US');
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow gift-panel">
          <h2>FIRST WIN!</h2>
          <p class="fine big">A thank you for new players: the STARTER PACK, one time only.</p>
          <div class="reward"><i></i><span>${n(o.coins)} COINS</span><em>AND THE GOLD BALL</em></div>
          <p class="fine">Worth ${n(o.worth)} coins in the shop, for ${escHtml(o.price)}. It stays in the shop if you'd rather decide later.</p>
          <div class="btn-row">
            <button class="btn btn-white" data-a="later">NOT NOW</button>
            <button class="btn btn-yellow btn-lg" data-a="see">SEE THE PACK</button>
          </div>
        </div>
      </div>`, 'gift-screen');
    d.querySelector('[data-a=see]')?.addEventListener('click', () => h.see());
    d.querySelector('[data-a=later]')?.addEventListener('click', () => h.later());
  }

  gift(amount: number, streak: number, canDouble: boolean, h: { claim: (double: boolean) => Promise<boolean>; back: () => void }): void {
    const days = Array.from({ length: 7 }, (_, i) => {
      const n = 100 + 50 * i;
      const state = i < streak - 1 ? 'got' : i === streak - 1 ? 'today' : '';
      return `<li class="${state}"><span>DAY ${i + 1}</span><b>${n}</b></li>`;
    }).join('');
    const d = this.mount(`
      <div class="panel-wrap dim">
        <div class="panel narrow gift-panel">
          <h2>DAILY GIFT</h2>
          <ul class="gift-days">${days}</ul>
          <div class="reward"><i></i><span>+${amount}</span><em>DAY ${streak} OF 7</em></div>
          <p class="fine">Spend it in the SHOP: celebrations, balls, goal effects and trails. Come back tomorrow for the next one. Miss a day and you keep your place.</p>
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
