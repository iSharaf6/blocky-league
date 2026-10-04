/**
 * The sound's dev panel, window.__blaudio (dev builds only: main.ts imports this inside its DEV block).
 *
 *   __blaudio.state()            what the sound and the match director are doing now
 *   __blaudio.unlock()           build the audio context (a click in the page does it too)
 *   __blaudio.cue(name)          fire one cue now: a song (menu halftime win draw loss), a sting (kickoff goal trophy
 *                                promotion), a chant (claps ohs name drum horn ole comeon hey callname stomp lala
 *                                letsgo whoa), a reaction (roarHome roarAway ooh
 *                                groan applause whistles boo ole surge fulltimeWin fulltimeDraw), a hook (superShot
 *                                objective coins finalOn finalOff), or stop
 *   __blaudio.toHalftime()       end the first half now (the match on screen; __bl.step(n) to run it on)
 *   __blaudio.toFulltime()       end the match now
 *   __blaudio.measure()          render each scene offline and score it: peak, RMS and the loudest 400 ms (dBFS)
 *
 * The cues play on the game's own sfx; the measurements on a fresh Sfx on an OfflineAudioContext each.
 */
import type { Match } from '../sim/match';
import { matchAudio } from './director';
import type { StingId, TrackId } from './music';
import { CHANT_KINDS, Sfx, sfx, type ChantKind, type Stand } from './sfx';

interface DevSession {
  match: Match;
}

const SONGS: readonly TrackId[] = ['menu', 'halftime', 'win', 'draw', 'loss'];
const STING_IDS: readonly StingId[] = ['kickoff', 'goal', 'trophy', 'promotion'];
const CHANTS: readonly ChantKind[] = CHANT_KINDS;

function session(): DevSession | null {
  return (window as unknown as { __bl?: { session?: DevSession | null } }).__bl?.session ?? null;
}

/** Fire cue `name` on the game's sfx (see the file's comment for the names). */
function cue(name: string, stand: Stand = 0): string {
  const s = sfx;
  if ((SONGS as readonly string[]).includes(name)) s.playTrack(name as TrackId);
  else if ((STING_IDS as readonly string[]).includes(name)) s.sting(name as StingId);
  else if ((CHANTS as readonly string[]).includes(name)) s.chant(name as ChantKind, stand);
  else {
    switch (name) {
      case 'stop': s.stopMusic(1); break;
      case 'roarHome': s.goal(0); break;
      case 'roarAway': s.goal(1); break;
      case 'ooh': s.ooh(); break;
      case 'groan': s.groan(1, stand); break;
      case 'applause': s.applause(0.8, stand); break;
      case 'whistles': s.crowdWhistles(0.8, stand); break;
      case 'boo': s.crowdWhistles(0.8, stand, true); break;
      case 'ole': s.oleChain(6, stand); break;
      case 'surge':
        if (s.ready) (s as unknown as { surge(end: number, heat: number): void }).surge(stand, 0.8);
        break;
      case 'fulltimeWin': s.fullTimeCrowd(stand); break;
      case 'fulltimeDraw': s.fullTimeCrowd(-1); break;
      case 'superShot': s.superShot(); break;
      case 'objective': s.objectiveDone(); break;
      case 'coins': s.coinsBurst(60); break;
      case 'finalOn': s.setTension(0.9); s.finalMinute(true); break;
      case 'finalOff': s.finalMinute(false); s.setTension(0); break;
      default: return `unknown cue ${name}`;
    }
  }
  return name;
}

/** End the current half of the match on screen now (the sim's own end: whistle, events, phase). */
function endHalf(full: boolean): string {
  const m = session()?.match;
  if (!m) return 'no match';
  if (full) m.half = 2;
  (m as unknown as { endHalf(): void }).endHalf();
  return m.phase;
}

// ------------------------------------------------------------------ the mix, measured offline

export interface MixScore {
  peakDb: number;
  rmsDb: number;
  /** The loudest 400 ms window's RMS (a short-term loudness). */
  loudDb: number;
}

type Step = (s: Sfx) => void;

/**
 * Render `secs` of a fresh Sfx on an OfflineAudioContext: `at` runs at audio time 0 and at each listed time, and
 * `every` (if any) every `dt` s (the music's scheduler, the crowd's tick). Scored over the whole render.
 */
async function render(secs: number, at: readonly (readonly [number, Step])[], every?: { dt: number; fn: Step }): Promise<MixScore> {
  const sr = 44100;
  const off = new OfflineAudioContext(2, Math.round(sr * secs), sr);
  const s = new Sfx();
  s.attachOffline(off);
  const q = 128 / sr;
  const jobs = new Map<number, Step[]>();
  const add = (t: number, fn: Step): void => {
    const k = Math.round(t / q);
    const list = jobs.get(k);
    if (list) list.push(fn);
    else jobs.set(k, [fn]);
  };
  for (const [t, fn] of at) add(t, fn);
  if (every) for (let t = every.dt; t < secs - 0.05; t += every.dt) add(t, every.fn);
  for (const [k, fns] of jobs) {
    if (k === 0) {
      for (const f of fns) f(s);
      continue;
    }
    off.suspend(k * q).then(() => {
      try {
        for (const f of fns) f(s);
      } finally {
        void off.resume();
      }
    }, () => {});
  }
  const buf = await off.startRendering();
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const win = Math.round(sr * 0.4);
  let peak = 0;
  let sum = 0;
  let ws = 0;
  let loud = 0;
  for (let i = 0; i < L.length; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (a > peak) peak = a;
    const p = (L[i] * L[i] + R[i] * R[i]) / 2;
    sum += p;
    ws += p;
    if (i % win === win - 1) {
      loud = Math.max(loud, ws / win);
      ws = 0;
    }
  }
  const db = (x: number): number => +(20 * Math.log10(Math.max(1e-9, x))).toFixed(1);
  return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / L.length)), loudDb: db(Math.sqrt(loud)) };
}

const sched: Step = (s) => (s as unknown as { schedule(): void }).schedule();
const live = (level: number, fill: number): Step => (s) => {
  s.setStadium(level, fill);
  s.setAmbienceActive(true);
  s.setExcitement(0.3);
  s.setEnds(0.3, 0.3);
};

/** Every scene of the mix, scored (the ones named in `only`, if given). */
export async function measureMix(only?: readonly string[]): Promise<Record<string, MixScore>> {
  const scenes: Record<string, () => Promise<MixScore>> = {
    menuMusic: () => render(16, [[0, (s) => s.playTrack('menu')]], { dt: 0.03, fn: sched }),
    halftime: () => render(12, [[0, (s) => s.playTrack('halftime')]], { dt: 0.03, fn: sched }),
    win: () => render(14, [[0, (s) => s.result('win')]], { dt: 0.03, fn: sched }),
    winFinal: () => render(10, [[0, (s) => s.result('win', 2)]], { dt: 0.03, fn: sched }),
    draw: () => render(12, [[0, (s) => s.result('draw')]], { dt: 0.03, fn: sched }),
    loss: () => render(12, [[0, (s) => s.result('loss')]], { dt: 0.03, fn: sched }),
    kickoffSting: () => render(3, [[0.1, (s) => s.sting('kickoff')]]),
    trophy: () => render(5, [[0.1, (s) => s.fanfare('trophy')]]),
    crowdL0: () => render(40, [[0, live(0, 0.19)]], { dt: 0.05, fn: (s) => s.tick(0.05) }),
    crowdL5: () => render(40, [[0, live(5, 0.95)]], { dt: 0.05, fn: (s) => s.tick(0.05) }),
    chantNameL0: () => render(8, [[0, live(0, 0.19)], [0.1, (s) => s.chant('name')]]),
    chantOhsL5: () => render(8, [[0, live(5, 0.95)], [0.1, (s) => s.chant('ohs')]]),
    // Every chant at a mid-size ground (the names sung: Cube City), one scene each: chant<Kind>.
    ...Object.fromEntries(CHANT_KINDS.map((k) => [
      `chant${k[0].toUpperCase()}${k.slice(1)}`,
      () => render(9, [[0, (s: Sfx) => { live(3, 0.8)(s); s.setClubNames('Cube City', 'Mossvale Rovers'); }], [0.1, (s: Sfx) => s.chant(k)]]),
    ])),
    goalL0: () => render(8, [[0, live(0, 0.19)], [1, (s) => { s.goal(0); s.sting('goal'); }]]),
    goalL5: () => render(8, [[0, live(5, 0.95)], [1, (s) => { s.goal(0); s.sting('goal'); }]]),
    goalAwayL5: () => render(8, [[0, live(5, 0.95)], [1, (s) => s.goal(1)]]),
    shot: () => render(3, [[0, live(3, 0.8)], [0.5, (s) => s.shot(1, true)]]),
    superShot: () => render(3, [[0, live(3, 0.8)], [0.5, (s) => s.superShot()]]),
    finalMinute: () => render(8, [[0, live(3, 0.8)], [0.1, (s) => { s.setTension(1); s.finalMinute(true); }]], { dt: 0.05, fn: (s) => s.tick(0.05) }),
    fullTimeWin: () => render(8, [[0, live(3, 0.8)], [0.2, (s) => s.fullTimeCrowd(0)]], { dt: 0.05, fn: (s) => s.tick(0.05) }),
  };
  const out: Record<string, MixScore> = {};
  for (const [name, run] of Object.entries(scenes)) {
    if (only && !only.includes(name)) continue;
    out[name] = await run();
  }
  return out;
}

export function installAudioDev(): void {
  (window as unknown as { __blaudio: unknown }).__blaudio = {
    state: () => ({ sfx: sfx.debugState(), director: matchAudio.state }),
    unlock: () => sfx.unlock(),
    cue,
    toHalftime: () => endHalf(false),
    toFulltime: () => endHalf(true),
    measure: (only?: string[]) => measureMix(only),
  };
}
