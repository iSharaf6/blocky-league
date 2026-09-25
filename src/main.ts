import '@fontsource/lilita-one/400.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import './style.css';
import type { AppContext, MatchRequest } from './app';
import { sfx } from './audio/sfx';
import { Input } from './core/input';
import { loadSave, writeSave } from './core/save';
import { MatchSession, type MatchResult } from './game/matchSession';
import { PRESET_CLUBS, makeTeam, resolveKitClash } from './meta/data';
import { ads } from './platform/ads';
import { World, type TimeOfDay } from './render/world';
import type { Side } from './sim/types';
import { DIFF_LEVEL, Menus } from './ui/menus';
import { openCareer } from './ui/career';
import { openCup } from './ui/cup';
import { openClub } from './ui/club';

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

function applySettings(): void {
  const s = save.settings;
  sfx.sfxOn = s.sfx;
  sfx.crowdOn = s.crowd;
  sfx.setMusic(s.music);
  if (s.music && !session) sfx.startMusic();
  world.setQuality(s.quality);
  if (session) session.match.autoSwitch = s.autoSwitch;
  persist();
}

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
  });
}

const app: AppContext = {
  save,
  menus,
  persist,
  startMatch: (req) => void startMatch(req),
  mainMenu: () => mainMenu(),
};

function mainMenu(): void {
  if (!demo) startDemo();
  if (save.settings.music) sfx.startMusic();
  menus.main(save, {
    quick: quickMatch,
    career: () => openCareer(app),
    cup: () => openCup(app),
    club: () => openClub(app),
    settings: () => menus.settings(save, applySettings, mainMenu),
    howto: () => menus.howTo(mainMenu),
  });
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
    tutorial: !save.seenTutorial,
  });
  session.match.autoSwitch = save.settings.autoSwitch;
  const s = session;
  ads.gameplayStart();
  const tacticsMenu = (back: () => void) =>
    menus.tactics(s.match, humanSide, kits, {
      setMentality: (v) => s.setMentality(humanSide, v),
      substitute: (slot, benchIdx) => s.substitute(humanSide, slot, benchIdx),
      back,
    });
  s.onPause = () => {
    ads.gameplayStop();
    const pauseMenu = (): void =>
      menus.pause({
        tactics: () => tacticsMenu(pauseMenu),
        resume: () => {
          menus.close();
          s.resume();
          ads.gameplayStart();
        },
        howto: () => menus.howTo(pauseMenu),
        settings: () => menus.settings(save, applySettings, pauseMenu),
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
  session?.dispose();
  session = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && session && !session.paused && !menus.open) session.requestPause();
});
window.addEventListener('resize', () => world.resize());

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  (session ?? demo)?.update(dt);
  world.render();
  world.adapt(dt);
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
      difficulty: save.settings.difficulty, halfMinutes: save.settings.halfMinutes, attendance: 0.9,
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
      world.render();
    },
    key(code: string, down: boolean) {
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    },
  };
}

void boot();
