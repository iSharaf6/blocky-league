import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANT_KINDS, Sfx, chantCaption, chantWords, type ChantKind } from '../src/audio/sfx';
import { MatchSession, PRESENTATION } from '../src/game/matchSession';
import { PF, STATE_CODE } from '../src/game/replay';
import {
  LINEUP_INTRO_FROM, LINEUP_S, MOTM_S, SUB_MAX_SHOWN, SUB_MEET, SUB_MIN_S, SUB_S, SUB_TOTAL_S, applyLineup, applyMotm, lineupOrder, lineupShot, lineupSpot,
  motmShot, motmSpot, newSubStage, subBeatS, subCaption, subSpotX, subStage,
} from '../src/game/showcase';
import { GAP_MS, HAPTIC_FEEL, HapticGate, hapticForEvent, type HapticKind } from '../src/platform/haptics';
import { boardCells } from '../src/render/subScene';
import { HALF_L, HALF_W } from '../src/sim/constants';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { Match } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { PlayerDef } from '../src/sim/types';

/**
 * MATCH PRESENTATION (the owner, after playing on his iPhone): "i cant quit the game during half time ... theres no
 * settings button ... or no controls button"; "have a substitiution cutscene of the players ... dont overcomplicate
 * it"; "have more chants but make it obvious that it is chants because it kind of isnt"; "i cant fel the vibration in
 * full"; "cosmetics is boring and doesnt drive players to spend money".
 */

// This game typechecks against browser types; the menu checks read the source with Node 22+.
declare const process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, enc: 'utf8'): string } };
const { readFileSync } = process.getBuiltinModule('node:fs');

const between = (src: string, from: string, to: string): string => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  expect(a, from).toBeGreaterThanOrEqual(0);
  expect(b, to).toBeGreaterThan(a);
  return src.slice(a, b);
};

describe('half time offers what the pause menu offers', () => {
  const menus = readFileSync('src/ui/menus.ts', 'utf8');
  const main = readFileSync('src/main.ts', 'utf8');
  const half = between(menus, '  halftime(m: Match', '  fulltime(\n');
  const pause = between(menus, '  pause(h: {', '  statsTable(');

  it('has SECOND HALF, TACTICS & SUBS, CONTROLS, SETTINGS and QUIT (FORFEIT), and the pause menu the same set', () => {
    for (const a of ['go', 'tactics', 'howto', 'settings', 'quit']) expect(half, a).toContain(`data-a="${a}"`);
    for (const label of ['SECOND HALF', 'TACTICS &amp; SUBS', 'CONTROLS', 'SETTINGS', 'FORFEIT', 'QUIT']) expect(half, label).toContain(label);
    for (const a of ['resume', 'tactics', 'howto', 'settings', 'quit']) expect(pause, a).toContain(`data-a="${a}"`);
    for (const label of ['RESUME', 'TACTICS &amp; SUBS', 'CONTROLS', 'SETTINGS', 'FORFEIT', 'QUIT MATCH']) expect(pause, label).toContain(label);
  });

  it('the main action is the big button, and nothing else is', () => {
    expect(half).toMatch(/btn btn-go btn-lg" data-a="go"/);
    expect((half.match(/btn-lg/g) ?? []).length).toBe(2); // SECOND HALF, and KEEP PLAYING in the question.
    expect(half).toMatch(/btn btn-go btn-lg" data-a="stay"/);
  });

  it('QUIT asks first and says what it costs; a forfeit is called a forfeit', () => {
    for (const src of [half, pause]) {
      expect(src).toContain('quitNote');
      expect(src).toContain('data-a="really"');
      expect(src).toContain('KEEP PLAYING');
      expect(src).toContain('YES, FORFEIT');
      expect(src).toContain('FORFEIT MATCH?');
    }
    // main.ts: one quit for both menus, the request's own note (a 3:0 defeat in the league, out of the cup ...).
    const wiring = between(main, '  const quitNote = req.quitNote', '  s.onFinish = (r) => {');
    expect(wiring).toContain('/defeat/i.test(quitNote)');
    expect((wiring.match(/quit: quitMatch/g) ?? []).length).toBe(2);
    expect((wiring.match(/\bforfeit,/g) ?? []).length).toBe(2);
    const ht = between(wiring, 'menus.halftime(', '});');
    for (const k of ['howto:', 'settings:', 'quit:', 'quitNote', 'forfeit']) expect(ht, k).toContain(k);
  });
});

describe('the substitution on the touchline', () => {
  it('each change gets about 2.5 s, several share about 6 s between them', () => {
    expect(subBeatS(1)).toBe(SUB_S);
    expect(subBeatS(2)).toBe(SUB_S);
    expect(SUB_S).toBeLessThanOrEqual(2.5);
    for (let n = 3; n <= SUB_MAX_SHOWN; n++) {
      expect(n * subBeatS(n), `${n} changes`).toBeLessThanOrEqual(Math.max(SUB_TOTAL_S, n * SUB_MIN_S) + 1e-9);
      expect(subBeatS(n)).toBeGreaterThanOrEqual(SUB_MIN_S);
    }
    expect(subBeatS(5)).toBeLessThan(subBeatS(2));
    expect(PRESENTATION.subS).toBe(SUB_S);
    expect(SUB_MAX_SHOWN).toBeGreaterThanOrEqual(10);
  });

  it('keeps each player in two changes to the same slot before play resumes', () => {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[0]), away: makeTeam(PRESET_CLUBS[1]), halfLength: 150, difficulty: 1.8, humanSide: 0, seed: 27 });
    const first = m.teamPlayers(0)[9].def;
    const subQueue: { off: PlayerDef; on: PlayerDef }[] = [];
    const session = Object.assign(Object.create(MatchSession.prototype), {
      match: m, opt: { kits: [m.teams[0].kit, m.teams[1].kit] }, wearing: m.players.map((p) => p.def),
      view: { replacePlayer: vi.fn() }, hud: {}, subQueue,
    }) as MatchSession;
    const bench1 = m.bench[0].findIndex((p) => p.role !== 'GK');
    const second = m.bench[0][bench1];
    expect(session.substitute(0, 9, bench1)).toBe(true);
    const bench2 = m.bench[0].findIndex((p) => p.role !== 'GK');
    const third = m.bench[0][bench2];
    expect(session.substitute(0, 9, bench2)).toBe(true);
    expect(subQueue).toHaveLength(2);
    expect(subQueue[0]).toMatchObject({ off: first, on: second });
    expect(subQueue[1]).toMatchObject({ off: second, on: third });
  });

  it('the man coming off jogs to the line, they meet palms, the new man runs on and the old one goes to the bench', () => {
    for (const side of [0, 1] as const) {
      const st = newSubStage();
      const ex = subSpotX(side);
      // By his own dugout (home's is on the -x side of halfway), on the near touchline.
      expect(Math.sign(ex)).toBe(side === 0 ? -1 : 1);
      subStage(0, side, st);
      expect(st.off.z).toBeLessThan(HALF_W - 3);
      expect(st.on.z).toBeGreaterThan(HALF_W);
      expect(st.off.speed).toBeGreaterThan(0);
      expect(st.met).toBe(false);
      expect(st.off.arm || st.on.arm).toBe(false);
      // The high five: within reach of each other at the line, hands up.
      subStage(SUB_MEET, side, st);
      expect(st.met).toBe(true);
      expect(st.off.arm && st.on.arm).toBe(true);
      expect(Math.hypot(st.off.x - st.on.x, st.off.z - st.on.z)).toBeLessThan(1.4);
      expect(Math.abs(st.off.z - HALF_W)).toBeLessThan(1);
      // The end: one on the grass, one off it.
      subStage(1, side, st);
      expect(st.on.z).toBeLessThan(HALF_W - 2);
      expect(st.off.z).toBeGreaterThan(HALF_W + 1);
      expect(st.off.arm || st.on.arm).toBe(false);
      // The lens stands on the pitch looking out at the touchline, the official and his board in the frame beside them.
      for (const k of [0, 0.5, 1]) {
        subStage(k, side, st);
        expect(st.shot.pz).toBeLessThan(HALF_W - 4);
        expect(st.shot.tz).toBeGreaterThan(HALF_W);
        expect(Math.abs(st.official.x - ex)).toBeGreaterThan(2);
        expect(Math.abs(st.official.x - ex)).toBeLessThan(4.5);
        expect(st.board.y).toBeGreaterThan(2);
        expect(Math.abs(st.board.x - st.official.x)).toBeLessThan(0.8);
      }
    }
  });

  it('never runs backwards: both men only ever get nearer where they are going', () => {
    const st = newSubStage();
    let offZ = -Infinity;
    let onZ = Infinity;
    for (let i = 0; i <= 100; i++) {
      subStage(i / 100, 0, st);
      expect(st.off.z).toBeGreaterThanOrEqual(offZ - 1e-9);
      expect(st.on.z).toBeLessThanOrEqual(onZ + 1e-9);
      offZ = st.off.z;
      onZ = st.on.z;
    }
  });

  it('the caption reads OFF 9 CINDER, ON 14 TUFFET, and the board shows both numbers, red on the left', () => {
    const c = subCaption({ number: 9, name: 'A. Cinder' }, { number: 14, name: 'Bo Tuffet' });
    expect(c.text).toBe('OFF 9 CINDER, ON 14 TUFFET');
    expect(c.off).toBe('OFF 9 CINDER');
    expect(c.on).toBe('ON 14 TUFFET');
    // The board's LEDs: a 1 is 8 cells of the 3x5 font, an 8 is 13; two digits sit either side of the number's centre.
    expect(boardCells(1, 0)).toHaveLength(8);
    expect(boardCells(8, 0)).toHaveLength(13);
    const off = boardCells(19, -0.4);
    const on = boardCells(14, 0.4);
    expect(Math.max(...off.map((p) => p[0]))).toBeLessThan(Math.min(...on.map((p) => p[0])));
    const us = boardCells(88, 0).map((p) => p[0]);
    expect((Math.min(...us) + Math.max(...us)) / 2).toBeCloseTo(0, 6);
    // (A number off the board's range still draws: 0 to 99.)
    expect(boardCells(123, 0).length).toBe(boardCells(99, 0).length);
  });
});

describe('showcase shots: the line-up and the man of the match', () => {
  it('the line-up is 3 s, your XI in a row facing the lens, the captain last where the dolly ends', () => {
    expect(LINEUP_S).toBeLessThanOrEqual(3);
    expect(PRESENTATION.lineupS).toBe(LINEUP_S);
    // The fly-in after it is cut short: the two together stay well under the old fly-in twice over.
    expect(LINEUP_INTRO_FROM).toBeGreaterThan(0.2);
    expect(LINEUP_S + PRESENTATION.introS * (1 - LINEUP_INTRO_FROM)).toBeLessThanOrEqual(4.5);
    const idxs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const order = lineupOrder(idxs, 7);
    expect(order).toHaveLength(11);
    expect(order[10]).toBe(7);
    expect([...order].sort((a, b) => a - b)).toEqual(idxs);
    // (No captain known: the XI as it is.)
    expect(lineupOrder(idxs, -1)).toEqual(idxs);
    const f = new Float32Array(22 * PF + 11);
    applyLineup(f, order, 0.5, 4);
    const xs = order.map((i) => f[i * PF]);
    for (let i = 1; i < xs.length; i++) expect(xs[i - 1] - xs[i]).toBeGreaterThan(1.1);
    for (const i of order) {
      expect(f[i * PF + 1]).toBe(f[order[0] * PF + 1]);
      expect(f[i * PF + 3]).toBeCloseTo(Math.PI / 2, 6);
      expect([STATE_CODE.move, STATE_CODE.celebrate]).toContain(f[i * PF + 4]);
    }
    // By the far touchline, on the grass.
    expect(f[order[0] * PF + 1]).toBeLessThan(-(HALF_W - 8));
    expect(f[order[0] * PF + 1]).toBeGreaterThan(-HALF_W);
    // Someone greets the lens as it passes; at the end it is the captain.
    expect(order.some((i) => f[i * PF + 4] === STATE_CODE.celebrate)).toBe(true);
    applyLineup(f, order, 1, 6);
    expect(f[7 * PF + 4]).toBe(STATE_CODE.celebrate);
    // The other side is left where it stands.
    expect(f[15 * PF]).toBe(0);
    // The dolly: from the first man to the captain, on the pitch side of the row, never backwards.
    const shot = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: 0 };
    let last = Infinity;
    for (let i = 0; i <= 20; i++) {
      lineupShot(i / 20, 11, shot, 2.1);
      expect(shot.tx).toBeLessThanOrEqual(last + 1e-9);
      last = shot.tx;
      expect(shot.pz).toBeGreaterThan(shot.tz + 5);
      expect(shot.py).toBeLessThan(1.6);
    }
    const cap = lineupSpot(10, 11);
    expect(Math.abs(shot.tx - cap.x)).toBeLessThan(1.5);
    expect(Math.abs(lineupShot(0, 11, shot, 2.1).tx - lineupSpot(0, 11).x)).toBeLessThan(3);
  });

  it('the man of the match has time to receive and lift an award, modest after defeat, with the lens over grass', () => {
    expect(MOTM_S).toBeGreaterThanOrEqual(4);
    expect(MOTM_S).toBeLessThanOrEqual(4.5);
    expect(PRESENTATION.motmS).toBe(MOTM_S);
    const f = new Float32Array(22 * PF + 11);
    applyMotm(f, 9, 10, -5, false, 3);
    expect(f[9 * PF]).toBe(10);
    expect(f[9 * PF + 1]).toBe(-5);
    expect(f[9 * PF + 4]).toBe(STATE_CODE.celebrate);
    const won = f[9 * PF + 13];
    applyMotm(f, 9, 10, -5, true, 3);
    expect(f[9 * PF + 13]).not.toBe(won);
    // Facing the main stand's side, where the lens is.
    expect(Math.sin(f[9 * PF + 3])).toBeGreaterThan(0.9);
    // By the near touchline or in a goal: pulled on to the pitch, so the lens in front of him is over grass.
    const shot = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: 0 };
    for (const [x, z] of [[0, HALF_W], [HALF_L, 0], [-HALF_L, -HALF_W], [3, 4]]) {
      const s = motmSpot(x, z);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(HALF_L - 4);
      motmShot(0, s.x, s.z, 2.15, shot);
      expect(shot.pz).toBeLessThan(HALF_W);
      expect(shot.pz).toBeGreaterThan(s.z + 4);
      // It pushes in.
      const far = shot.pz - s.z;
      motmShot(1, s.x, s.z, 2.15, shot);
      expect(shot.pz - s.z).toBeLessThan(far);
    }
  });
});

// ------------------------------------------------------------------ chants

/** A WebAudio stand-in on a hand-moved clock: counts the nodes made (as tests/crowdMusic.test.ts). */
function fakeAudio() {
  const ctx = { clock: 0, nodes: 0, oscillators: 0 };
  const param = () => ({
    value: 1,
    setValueAtTime() { return this; },
    setTargetAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    cancelScheduledValues() { return this; },
  });
  class FakeCtx {
    state = 'running';
    sampleRate = 4000;
    destination = this.node();
    get currentTime() { return ctx.clock; }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    node() {
      ctx.nodes++;
      return {
        connect: (d: unknown) => d, disconnect() {}, start() {}, stop() {}, setPeriodicWave(_wave: unknown) {},
        gain: param(), frequency: param(), Q: param(), pan: param(), playbackRate: param(), threshold: param(), ratio: param(),
        knee: param(), attack: param(), release: param(), type: '', buffer: null as unknown, loop: false, normalize: true,
      };
    }
    createGain() { return this.node(); }
    createDynamicsCompressor() { return this.node(); }
    createBiquadFilter() { return this.node(); }
    createOscillator() { ctx.oscillators++; return this.node(); }
    createPeriodicWave(_real: Float32Array, _imag: Float32Array) { return {}; }
    createBufferSource() { return this.node(); }
    createConvolver() { return this.node(); }
    createStereoPanner() { return this.node(); }
    createBuffer(ch: number, len: number) {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { length: len, getChannelData: (i: number) => data[i] };
    }
  }
  return { ctx, FakeCtx };
}

describe('chants that are obviously chants', () => {
  let audio: ReturnType<typeof fakeAudio>;
  beforeEach(() => {
    vi.useFakeTimers();
    audio = fakeAudio();
    vi.stubGlobal('window', {
      AudioContext: audio.FakeCtx,
      addEventListener() {},
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    });
    vi.stubGlobal('document', { addEventListener() {}, visibilityState: 'visible' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('there are at least seventeen, each with its own short caption: plain capitals, the claps and drums in brackets', () => {
    expect(CHANT_KINDS.length).toBeGreaterThanOrEqual(17);
    expect(new Set(CHANT_KINDS).size).toBe(CHANT_KINDS.length);
    const words = chantWords('Cube City');
    expect(words).toEqual(['CUBE', 'CITY']);
    const caps = CHANT_KINDS.map((k) => chantCaption(k, words));
    expect(new Set(caps).size).toBe(CHANT_KINDS.length);
    expect(chantCaption('ole', words)).toBe('OLE, OLE OLE OLE!');
    expect(chantCaption('name', words)).toBe('CUBE CITY! (CLAP CLAP CLAP)');
    expect(chantCaption('callname', words)).toBe('CUBE! (CLAP CLAP CLAP) CITY!');
    expect(chantCaption('allez', words)).toBe('ALLEZ ALLEZ CUBE! (DRUMS)');
    expect(chantCaption('herewego', words)).toBe('HERE WE GO! HERE WE GO! (CLAP CLAP)');
    expect(chantCaption('standup', words)).toBe('STAND UP FOR CUBE! (CLAP CLAP)');
    expect(chantCaption('weare', words)).toBe('WE ARE CUBE CITY! OH OH!');
    for (const name of ['Cube City', 'Foxhollow Athletic', 'Supercalifragilistic Wanderers', '', 'Rovers']) {
      const w = chantWords(name);
      expect(w.length).toBeGreaterThan(0);
      expect(w.join(' ').length).toBeLessThanOrEqual(30);
      for (const k of CHANT_KINDS) {
        const c = chantCaption(k, w);
        expect(c.length, `${k} ${name}`).toBeGreaterThan(5);
        // The owner's taste: no dots, bullets or dashes; capitals; nothing a pixel face lacks.
        expect(c, `${k} ${name}`).toMatch(/^[A-Z0-9 ,!'()]+$/);
        expect(c).not.toMatch(/-/);
      }
    }
    // A club's name is its first two words; a very long pair keeps the first.
    expect(chantWords('Mossvale Rovers FC')).toEqual(['MOSSVALE', 'ROVERS']);
    expect(chantWords('Supercalifragilistic Wanderers')).toEqual(['SUPERCALIFRAGILISTIC']);
    expect(chantWords('')).toEqual(['BLOCKY', 'LEAGUE']);
  });

  it('every one is sung: voices, claps or a drum, a few seconds long, and the screen is told its words', () => {
    for (const kind of CHANT_KINDS) {
      const s = new Sfx();
      s.unlock();
      s.setClubNames('Cube City', 'Mossvale Rovers');
      s.setStadium(3, 0.8);
      s.setAmbienceActive(true);
      const said: { kind: ChantKind; stand: number; caption: string; seconds: number }[] = [];
      s.onChant = (c) => said.push(c);
      audio.ctx.clock = 10;
      const n0 = audio.ctx.nodes;
      const o0 = audio.ctx.oscillators;
      s.chant(kind);
      expect(audio.ctx.nodes - n0, kind).toBeGreaterThan(20);
      // (All but the plain drum march and the claps open with voices; every one of them has some.)
      expect(audio.ctx.oscillators - o0, kind).toBeGreaterThan(4);
      expect(said, kind).toHaveLength(1);
      expect(said[0].kind).toBe(kind);
      expect(said[0].stand).toBe(0);
      expect(said[0].caption).toBe(chantCaption(kind, ['CUBE', 'CITY']));
      expect(said[0].seconds, kind).toBeGreaterThan(2.5);
      expect(said[0].seconds, kind).toBeLessThan(8.5);
      expect(s.debugState().lastChant).toBe(kind);
      // One at a time per stand: a second one over it is not sung.
      s.chant(kind === 'ole' ? 'hey' : 'ole');
      expect(said).toHaveLength(1);
      // The away fans sing their own name.
      audio.ctx.clock = 30;
      s.chant('name', 1);
      expect(said[1].caption).toBe('MOSSVALE ROVERS! (CLAP CLAP CLAP)');
      expect(said[1].stand).toBe(1);
    }
  });

  it('each scoring end sings a different celebration song after repeated goals, waiting for the roar first', () => {
    const s = new Sfx();
    s.unlock();
    s.setClubNames('Cube City', 'Mossvale Rovers');
    s.setStadium(3, 0.8);
    s.setAmbienceActive(true);
    // No random songs or away replies between the deliberately staged goals.
    s.setChantGate(false);
    const said: { kind: ChantKind; stand: number }[] = [];
    s.onChant = (c) => said.push(c);
    for (const stand of [0, 1] as const) {
      const kinds: ChantKind[] = [];
      for (let goal = 0; goal < 4; goal++) {
        audio.ctx.clock += 30;
        const start = audio.ctx.clock;
        s.goal(stand);
        const before = said.length;
        audio.ctx.clock = start + 2;
        s.tick(2);
        expect(said).toHaveLength(before);
        audio.ctx.clock = start + 6.1;
        s.tick(4.1);
        expect(said).toHaveLength(before + 1);
        expect(said.at(-1)?.stand).toBe(stand);
        kinds.push(said.at(-1)!.kind);
      }
      expect(new Set(kinds).size).toBe(4);
      expect(kinds[0]).toBe(stand === 0 ? 'ohs' : 'name');
    }
    // Starting a new ground/match puts the first-goal song back at its opening anthem.
    s.setStadium(3, 0.8);
    audio.ctx.clock += 30;
    s.goal(0);
    audio.ctx.clock += 6.1;
    s.tick(6.1);
    expect(said.at(-1)?.kind).toBe('ohs');
  });

  it('nothing is sung or said with the crowd off, and the menus never hear of a chant', () => {
    const s = new Sfx();
    s.unlock();
    s.setStadium(3, 0.8);
    s.setAmbienceActive(true);
    const said: string[] = [];
    s.onChant = (c) => said.push(c.caption);
    s.crowdOn = false;
    const n0 = audio.ctx.nodes;
    s.chant('ole');
    expect(audio.ctx.nodes).toBe(n0);
    expect(said).toHaveLength(0);
    s.crowdOn = true;
    s.onChant = null;
    expect(() => s.chant('ole')).not.toThrow();
  });
});

// ------------------------------------------------------------------ haptics

describe('haptics you can feel in full', () => {
  const kinds = Object.keys(HAPTIC_FEEL) as HapticKind[];

  it('feels a human pass after that strike transfers control to its recipient', () => {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[0]), away: makeTeam(PRESET_CLUBS[1]), halfLength: 150, difficulty: 1.8, humanSide: 0, seed: 27 });
    m.phase = 'play';
    m.restart = null;
    const p = m.players[9];
    const receiver = m.players[7];
    m.active = p.idx;
    m.ball.owner = p.idx;
    p.facing = Math.atan2(receiver.pos.z - p.pos.z, receiver.pos.x - p.pos.x);
    p.order = { kind: 'pass', target: receiver.idx, power: 0.5,
      dirX: Math.cos(p.facing), dirZ: Math.sin(p.facing), expires: 1, firstTime: false };
    m.drainEvents();
    const before = m.activeOf(0);
    (m as unknown as { execute(p: Player): void }).execute(p);
    expect(m.activeOf(0)).toBe(receiver.idx);
    const kick = m.drainEvents().find((e) => e.type === 'kick');
    expect(kick).toBeDefined();
    expect(hapticForEvent(kick!, m, 0, p.idx, before)).toBe('pass');
    // An AI teammate's pass is still silent even when the human controls its receiver.
    expect(hapticForEvent(kick!, m, 0, p.idx, receiver.idx)).toBe(null);
  });

  it('a shot, a tackle and a save are short continuous buzzes (40 to 120 ms), not lone taps', () => {
    for (const k of ['shot', 'tackle', 'save'] as const) {
      const ms = HAPTIC_FEEL[k].buzzMs ?? 0;
      expect(ms, k).toBeGreaterThanOrEqual(40);
      expect(ms, k).toBeLessThanOrEqual(120);
      expect(HAPTIC_FEEL[k].intensity, k).toBeGreaterThanOrEqual(0.9);
    }
    for (const k of kinds) {
      const ms = HAPTIC_FEEL[k].buzzMs;
      if (ms !== undefined) {
        expect(ms, k).toBeGreaterThanOrEqual(40);
        expect(ms, k).toBeLessThanOrEqual(120);
      }
      // Nothing is faint any more.
      expect(HAPTIC_FEEL[k].intensity, k).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('the goal, the super shot, the post, the whistle and a substitution each have a pattern of their own', () => {
    const named = (['goal', 'super', 'post', 'whistle', 'sub'] as const).map((k) => HAPTIC_FEEL[k].pattern);
    for (const p of named) expect(p).toBeTruthy();
    expect(new Set(named).size).toBe(named.length);
    expect(HAPTIC_FEEL.goal.pattern).toBe('goal');
    expect(HAPTIC_FEEL.sub.pattern).toBe('sub');
    // The native side plays every one of them (ios/App/App/GameCenterPlugin.swift HapticsPlugin.beats).
    const swift = readFileSync('ios/App/App/GameCenterPlugin.swift', 'utf8');
    const plugin = between(swift, '@objc(HapticsPlugin)', '@objc(AppReviewPlugin)');
    for (const k of kinds) {
      const p = HAPTIC_FEEL[k].pattern;
      if (p) expect(plugin, p).toContain(`case "${p}":`);
    }
    expect(plugin).toContain('CAPPluginMethod(name: "pattern"');
    expect(plugin).toContain('.hapticContinuous');
    // The goal: about 0.6 s of rumble under a crescendo.
    const goal = between(plugin, 'case "goal":', 'case "win":');
    expect(goal).toMatch(/\.buzz\(0, 0\.6\d?, 1,/);
    const ramp = [...goal.matchAll(/\(([\d.]+), ([\d.]+)\)/g)].map((m) => Number(m[2]));
    expect(ramp.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeGreaterThanOrEqual(ramp[i - 1]);
    expect(ramp[0]).toBeLessThan(ramp[ramp.length - 1]);
  });

  it('UI taps tick quickly one after another, and OFF / LIGHT / FULL and the throttle still hold', () => {
    expect(HAPTIC_FEEL.tap.gap).toBeLessThanOrEqual(GAP_MS);
    const g = new HapticGate();
    expect(g.allow('tap', 0)).toBe(true);
    expect(g.allow('tap', 30)).toBe(false);
    expect(g.allow('tap', GAP_MS + 5)).toBe(true);
    // A substitution's double tap is not one of the big moments LIGHT keeps; a goal is; OFF is off.
    expect(new HapticGate().allow('sub', 0, 'full')).toBe(true);
    expect(new HapticGate().allow('sub', 0, 'light')).toBe(false);
    expect(new HapticGate().allow('goal', 0, 'light')).toBe(true);
    for (const k of kinds) expect(new HapticGate().allow(k, 0, 'off'), k).toBe(false);
    // A tackle's thud never holds a goal's rumble back.
    const h = new HapticGate();
    expect(h.allow('tackle', 0)).toBe(true);
    expect(h.allow('goal', 100)).toBe(true);
    const src = readFileSync('src/platform/haptics.ts', 'utf8');
    const ui = between(src, 'const UI_TICK', 'export function installUiHaptics');
    for (const sel of ['button', '.btn', '[role="tab"]']) expect(ui).toContain(sel);
    expect(between(src, 'export function installUiHaptics', '\n}\n')).toContain("closest('.touch')");
  });
});
