import '@fontsource/lilita-one/400.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import './style.css';
import { Vector3 } from 'three';
import type { AppContext, MatchRequest } from './app';
import { sfx } from './audio/sfx';
import { Input } from './core/input';
import { CONTROL_DEFAULTS, controlsOf, loadSave, writeSave, type CamZoom, type ControlSettings } from './core/save';
import { MatchSession, type MatchResult } from './game/matchSession';
import { PRESET_CLUBS, makeTeam, resolveKitClash } from './meta/data';
import { ads } from './platform/ads';
import { PITCH_Y } from './render/stadium';
import { World, type TimeOfDay } from './render/world';
import type { Match } from './sim/match';
import type { FormationId, Side } from './sim/types';
import { DIFF_LEVEL, Menus, type MainInfo } from './ui/menus';
import { DIVISION_NAMES, clubRating, migrateCareer, nextMatch } from './meta/career';
import { ROUND_NAMES, clubRating as presetRating, migrateCup } from './meta/cup';
import { overall } from './sim/types';
import { openCareer } from './ui/career';
import { openCup } from './ui/cup';
import { openClub } from './ui/club';
import { stopSpeech } from './ui/commentary';
import type { Projector } from './ui/hud';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const world = new World(canvas);
const input = new Input();
const menus = new Menus();
const save = loadSave();
let session: MatchSession | null = null;
let demo: MatchSession | null = null;

function persist(): void {
  writeSave(save);
}

/** The match camera distance from Settings (older saves: normal). */
function camZoom(): CamZoom {
  return save.settings.camZoom ?? 'normal';
}

/** Live camera-distance change (Settings opened from the pause menu). Optional: older sessions lack it. */
function applyCamZoom(s: MatchSession | null): void {
  (s as { setCamZoom?: (z: CamZoom) => void } | null)?.setCamZoom?.(camZoom());
}

/**
 * Settings > Controls onto a match: pass assistance (ground / through), auto switch, switch move assist and
 * timed finishing. The sim reads them every tick, so a change from the pause menu applies at once.
 */
function applyControls(m: Match, c: ControlSettings = controlsOf(save.settings)): void {
  m.groundAssist = c.groundAssist;
  m.throughAssist = c.throughAssist;
  m.autoSwitch = c.autoSwitch;
  m.moveAssist = c.moveAssist;
  m.timedFinish = c.timedFinish;
  m.trainer = c.trainer;
  m.quickPass = c.quickPass;
}

/**
 * Per-frame control feedback for the match UI: the touch PASS / THROUGH buttons fill up while the pass is
 * charged (PASS: the sim's passCharge, 0..1 while held with the ball; THROUGH: its hold time against the
 * 0.8 s full-power lob), and the HUD drops a set-piece hint the moment an action button is pressed.
 */
function syncControlsUi(s: MatchSession | null): void {
  if (!s) return;
  const m = s.match;
  if (s.touch) {
    const pass = typeof m.passCharge === 'number' ? m.passCharge : -1;
    const lofting = m.passMode === 'through' || m.passMode === 'lob' || m.phase === 'restart';
    const through = lofting && m.throughCharge > 0 ? Math.min(1, m.throughCharge / 0.8) : -1;
    s.touch.setCharge(pass, through);
  }
  if (s.hud && !s.paused) {
    const c = input.read();
    s.hud.buttons(c.pass || c.shoot || c.through);
  }
}

function applySettings(): void {
  const s = save.settings;
  sfx.sfxOn = s.sfx;
  sfx.crowdOn = s.crowd;
  sfx.setMusic(s.music);
  if (s.music && !session) sfx.startMusic();
  world.setQuality(s.quality);
  if (session) {
    applyControls(session.match);
    session.hud?.setCommentary(s.commentary, s.commentaryVoice);
    applyCamZoom(session);
  }
  persist();
}

/** World point -> viewport CSS px through the match camera (the HUD keeps its captions off the ball). */
const projV = new Vector3();
/** The canvas box, read once a frame (and on resize): the HUD projects dozens of points a frame. */
let canvasRect = canvas.getBoundingClientRect();
const project: Projector = (x, y, z) => {
  projV.set(x, y + PITCH_Y, z).project(world.camera);
  if (!Number.isFinite(projV.x) || projV.z > 1) return null;
  const r = canvasRect;
  return { x: r.left + ((projV.x + 1) / 2) * r.width, y: r.top + ((1 - projV.y) / 2) * r.height };
};

function startDemo(): void {
  demo?.dispose();
  const a = Math.floor(Math.random() * PRESET_CLUBS.length);
  let b = Math.floor(Math.random() * PRESET_CLUBS.length);
  if (b === a) b = (a + 3) % PRESET_CLUBS.length;
  const home = makeTeam(PRESET_CLUBS[a]);
  const away = makeTeam(PRESET_CLUBS[b]);
  demo = new MatchSession(world, input, {
    home, away, halfLength: 600, difficulty: 3, humanSide: -1, seed: Math.floor(Math.random() * 1e9),
    kits: [home.kit, resolveKitClash(home.kit, away.kit)], attendance: 0.8, demo: true, timeOfDay: 'day',
    camZoom: camZoom(),
  });
  // Nobody plays the menu demo: it stays on the default controls whatever the player picked.
  applyControls(demo.match, CONTROL_DEFAULTS);
}

const app: AppContext = {
  save,
  menus,
  persist,
  startMatch: (req) => void startMatch(req),
  mainMenu: () => mainMenu(),
};

function localDay(offset = 0): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today's gift if not yet claimed: 100 coins on day 1, +50 per consecutive day up to day 7. */
function giftToday(): { amount: number; streak: number } | null {
  const g = save.gift;
  const today = localDay();
  if (g?.last === today) return null;
  const streak = g && g.last === localDay(-1) ? (g.streak % 7) + 1 : 1;
  return { amount: 100 + 50 * (streak - 1), streak };
}

function mainInfo(): MainInfo {
  const info: MainInfo = {};
  const q = PRESET_CLUBS[save.clubIdx];
  const o = PRESET_CLUBS[save.opponentIdx];
  if (q && o) info.quick = `${q.short} v ${o.short}`;
  try {
    const career = save.career ? migrateCareer(save.career, 1) : null;
    const club = career?.club ?? null;
    if (club && career) {
      const nm = nextMatch(career);
      const div = career.season ? DIVISION_NAMES[career.season.division] ?? '' : '';
      // Opponent first: on small tiles the subtitle is cut with an ellipsis, and the next match matters most.
      info.career = nm ? `v ${nm.rival.short} · ${div}` : div || 'SEASON DONE';
      info.club = `OVR ${clubRating(club)}`;
      const star = [...club.squad.slice(0, 11)].sort((a, b) => overall(b) - overall(a))[0];
      if (star) info.captain = { def: star, kit: club.kit, club: club.name.toUpperCase(), ovr: clubRating(club) };
    } else {
      info.career = 'START YOUR CLUB';
      info.club = 'KIT · SQUAD';
    }
    const cup = migrateCup(save.cup);
    info.cup = cup && cup.status === 'active' ? `NEXT: ${ROUND_NAMES[Math.min(cup.round, 2)]}` : 'WIN THE TROPHY';
  } catch {
    // A damaged career blob must never break the menu.
  }
  if (!info.captain && q) {
    const team = makeTeam(q);
    info.captain = { def: team.players[9], kit: q.kit, club: q.name.toUpperCase(), ovr: presetRating(save.clubIdx) };
  }
  const gift = giftToday();
  if (gift) info.gift = gift;
  return info;
}

function mainMenu(): void {
  if (!demo) startDemo();
  if (save.settings.music) sfx.startMusic();
  const info = mainInfo();
  menus.main(save, {
    gift: () => {
      const g = giftToday();
      if (!g) return mainMenu();
      menus.gift(g.amount, g.streak, ads.rewardedAvailable, {
        claim: async (double) => {
          let amount = g.amount;
          if (double && (await ads.rewarded())) amount *= 2;
          save.coins += amount;
          save.gift = { last: localDay(), streak: g.streak };
          persist();
          return true;
        },
        back: mainMenu,
      });
    },
    quick: quickMatch,
    career: () => openCareer(app),
    cup: () => openCup(app),
    club: () => openClub(app),
    settings: () => menus.settings(save, applySettings, mainMenu),
    howto: () => menus.howTo(mainMenu, input.lastDevice),
  }, info);
}

/** Standard coin payout, scaled by difficulty. */
export function standardReward(r: MatchResult, difficulty: number): { coins: number; label: string } {
  const hs: Side = r.humanSide === 1 ? 1 : 0;
  const my = r.score[hs];
  const their = r.score[hs === 0 ? 1 : 0];
  const mult = [0.8, 1, 1.35, 1.7][difficulty] ?? 1;
  const base = my > their ? 150 : my === their ? 70 : 30;
  return { coins: Math.round((base + my * 20) * mult), label: my > their ? 'WIN BONUS' : 'MATCH FEE' };
}

function quickMatch(): void {
  menus.quickMatch(save, mainMenu, (h, a) => {
    save.clubIdx = h;
    save.opponentIdx = a;
    persist();
    const home = makeTeam(PRESET_CLUBS[h]);
    const away = makeTeam(PRESET_CLUBS[a]);
    const difficulty = save.settings.difficulty;
    startMatch({
      home, away,
      kits: [home.kit, resolveKitClash(home.kit, away.kit)],
      humanSide: 0,
      difficulty,
      halfMinutes: save.settings.halfMinutes,
      attendance: 0.9,
      stadiumLevel: 5,
      reward: (r) => standardReward(r, difficulty),
      onDone: () => mainMenu(),
      onQuit: () => mainMenu(),
    });
  });
}

function pickTime(): TimeOfDay {
  const t = save.settings.timeOfDay;
  if (t !== 'random') return t;
  const r = Math.random();
  return r < 0.5 ? 'day' : r < 0.75 ? 'sunset' : 'night';
}

function pickWeather(): 'clear' | 'rain' | 'snow' {
  const w = save.settings.weather;
  if (w !== 'random') return w;
  const r = Math.random();
  return r < 0.72 ? 'clear' : r < 0.9 ? 'rain' : 'snow';
}

function recordResult(r: MatchResult): void {
  const hs: Side = r.humanSide === 1 ? 1 : 0;
  const my = r.score[hs];
  const their = r.score[hs === 0 ? 1 : 0];
  const rec = save.record;
  rec.played++;
  rec.goalsFor += my;
  rec.goalsAgainst += their;
  if (my > their) {
    rec.won++;
    if (my - their >= 3) ads.happyTime();
  } else if (my === their) rec.drawn++;
  else rec.lost++;
}

let matchesPlayed = 0;

async function startMatch(req: MatchRequest): Promise<void> {
  menus.close();
  sfx.stopMusic();
  // Portal interstitial at the natural break before a new kick-off (never on the first match).
  if (matchesPlayed > 0) await ads.midgame();
  demo?.dispose();
  demo = null;
  const { kits, humanSide } = req;
  session = new MatchSession(world, input, {
    home: req.home,
    away: req.away,
    kits,
    halfLength: req.halfMinutes * 60,
    difficulty: DIFF_LEVEL[req.difficulty] ?? 1.8,
    humanSide,
    attendance: req.attendance,
    seed: Math.floor(Math.random() * 1e9),
    timeOfDay: req.timeOfDay ?? pickTime(),
    weather: req.weather ?? pickWeather(),
    knockout: req.knockout,
    stadiumLevel: Math.max(0, Math.min(5, Math.round(req.stadiumLevel ?? 5))),
    tutorial: !save.seenTutorial,
    camZoom: camZoom(),
  });
  applyControls(session.match);
  session.hud?.setCommentary(save.settings.commentary, save.settings.commentaryVoice);
  session.hud?.setProjector(project);
  const s = session;
  ads.gameplayStart();
  const tacticsMenu = (back: () => void) =>
    menus.tactics(s.match, humanSide, kits, {
      setMentality: (v) => s.setMentality(humanSide, v),
      substitute: (slot, benchIdx) => s.substitute(humanSide, slot, benchIdx),
      // Match.setFormation is new in the sim; the optional call keeps older builds working (picker is a no-op).
      setFormation: (id) => (s.match as Match & { setFormation?: (side: Side, f: FormationId) => unknown }).setFormation?.(humanSide, id),
      back,
    });
  s.onPause = () => {
    ads.gameplayStop();
    stopSpeech();
    const pauseMenu = (): void =>
      menus.pause({
        quitNote: req.quitNote ?? "This match won't count and you won't earn any coins.",
        tactics: () => tacticsMenu(pauseMenu),
        resume: () => {
          menus.close();
          s.resume();
          ads.gameplayStart();
        },
        howto: () => menus.howTo(pauseMenu, input.lastDevice),
        // Mid-match, the options that matter are the controls: open on that tab.
        settings: () => menus.settings(save, applySettings, pauseMenu, 'controls'),
        quit: () => {
          menus.close();
          endMatch();
          (req.onQuit ?? mainMenu)();
        },
      });
    pauseMenu();
  };
  s.onHalftime = () => {
    ads.gameplayStop();
    const ht = (): void =>
      menus.halftime(s.match, kits, () => {
        menus.close();
        s.continueSecondHalf();
        ads.gameplayStart();
      }, () => tacticsMenu(ht));
    ht();
  };
  s.onFinish = (r) => {
    ads.gameplayStop();
    matchesPlayed++;
    recordResult(r);
    save.seenTutorial = true;
    const reward = req.reward(r);
    let earned = reward.coins;
    save.coins += reward.coins;
    persist();
    let doubled = false;
    menus.fulltime(r.match, kits, humanSide, reward, ads.rewardedAvailable && reward.coins > 0, {
      nextLabel: req.nextLabel,
      double: async () => {
        if (doubled) return false;
        const ok = await ads.rewarded();
        if (ok) {
          doubled = true;
          save.coins += reward.coins;
          earned += reward.coins;
          persist();
        }
        return ok;
      },
      next: () => {
        menus.close();
        endMatch();
        req.onDone(r, earned);
      },
    }, r.ratings);
  };
  window.addEventListener('keydown', pauseKey);
}

function pauseKey(e: KeyboardEvent): void {
  if ((e.code === 'Escape' || e.code === 'KeyP') && session && !session.paused && !menus.open) session.requestPause();
}

function endMatch(): void {
  window.removeEventListener('keydown', pauseKey);
  stopSpeech();
  session?.dispose();
  session = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && session && !session.paused && !menus.open) session.requestPause();
});
window.addEventListener('resize', () => {
  world.resize();
  canvasRect = canvas.getBoundingClientRect();
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // (Our own work this frame, for the dynamic resolution: a CPU-bound hitch is no reason to drop pixels.)
  const t0 = performance.now();
  canvasRect = canvas.getBoundingClientRect();
  (session ?? demo)?.update(dt);
  syncControlsUi(session);
  world.render();
  world.adapt(dt, (performance.now() - t0) / 1000);
  requestAnimationFrame(frame);
}

async function boot(): Promise<void> {
  world.setQuality(save.settings.quality);
  ads.onMute = (m) => sfx.setMuted(m);
  // Never let a slow or blocked portal SDK hold the title screen hostage.
  await Promise.all([Promise.race([ads.init(), new Promise<void>((r) => setTimeout(r, 3000))]), document.fonts?.ready]);
  startDemo();
  requestAnimationFrame(frame);
  document.getElementById('boot')?.classList.add('gone');
  ads.loadingDone();
  const params = new URLSearchParams(location.search);
  if (import.meta.env.DEV && params.has('quick')) {
    const home = makeTeam(PRESET_CLUBS[save.clubIdx]);
    const away = makeTeam(PRESET_CLUBS[save.opponentIdx]);
    startMatch({
      home, away, kits: [home.kit, resolveKitClash(home.kit, away.kit)], humanSide: 0,
      difficulty: save.settings.difficulty, halfMinutes: save.settings.halfMinutes, attendance: 0.9, stadiumLevel: 5,
      reward: (r) => standardReward(r, save.settings.difficulty), onDone: () => mainMenu(),
    });
    return;
  }
  menus.title(() => {
    sfx.unlock();
    applySettings();
    mainMenu();
  });
}

if (import.meta.env.DEV) {
  (window as unknown as { __bl: unknown }).__bl = {
    get session() {
      return session;
    },
    get demo() {
      return demo;
    },
    world,
    input,
    save,
    app,
    /** Advance the game by n frames even when the pane is hidden (rAF paused). */
    step(n: number, dt = 1 / 60) {
      for (let i = 0; i < n; i++) (session ?? demo)?.update(dt);
      syncControlsUi(session);
      world.render();
    },
    key(code: string, down: boolean) {
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    },
  };
}

void boot();
