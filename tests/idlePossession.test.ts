import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { createClub, migrateCareer, newSeason, nextMatch } from '../src/meta/career';
import { DT } from '../src/sim/constants';
import { STALL_S } from '../src/sim/dribble';
import { EMPTY_PAD, Match, type MatchConfig } from '../src/sim/match';
import type { Side } from '../src/sim/types';

/** Real kick-off input and receipt: no manual carrier assignment, tackle calls or defender relocation. */
function kickoff(seed: number, difficulty: number, rival: number, side: Side = 0, firstMatch = false, assist = 0): Match {
  const ours = makeTeam(PRESET_CLUBS[5]);
  const theirs = makeTeam(PRESET_CLUBS[rival]);
  const m = new Match({ home: side === 0 ? ours : theirs, away: side === 1 ? ours : theirs, difficulty,
    halfLength: 150, humanSide: side, seed, firstMatch, assist });
  return receiveKickoff(m, side);
}

function receiveKickoff(m: Match, side: Side): Match {
  if (m.restart?.side !== side) m.setupKickoff(side);
  m.drainEvents();
  for (let tick = 0; tick < 600; tick++) {
    m.step(DT, { ...EMPTY_PAD, pass: m.phase === 'kickoff' && tick % 60 === 50 });
    const received = m.drainEvents().some((e) => e.type === 'control' && m.players[e.player].side === side && m.phase === 'play');
    if (received && m.ball.owner >= 0 && m.players[m.ball.owner].side === side) {
      expect(m.koGuard).toBeNull();
      return m;
    }
  }
  throw new Error(`Kick-off not received: ${m.cfg.seed}/${m.cfg.difficulty}/${side}`);
}

type ShippingMode = 'first-match' | 'new-career' | 'max-assisted-career' | 'normal-quick' | 'blitz';

/** The same generated Career fixture and session flags used by PLAY NOW, Quick Match and ROAD TO GLORY. */
function shippingKickoff(mode: ShippingMode, seed: number): Match {
  let home = makeTeam(PRESET_CLUBS[5]), away = makeTeam(PRESET_CLUBS[seed % PRESET_CLUBS.length]);
  let side = (seed % 2) as Side;
  if (mode.endsWith('career')) {
    const career = migrateCareer(null, seed);
    career.club = createClub({ name: 'Test FC', short: 'TST', kit: home.kit, formation: '4-4-2' }, seed);
    newSeason(career, 8, 1);
    const fixture = nextMatch(career)!;
    home = fixture.home;
    away = fixture.away;
    side = fixture.userHome ? 0 : 1;
  }
  const cfg: MatchConfig = { home, away, humanSide: side, halfLength: 90, seed,
    difficulty: mode === 'normal-quick' ? 1.8 : 0.6, coach: true,
    hype: mode !== 'blitz', mode: mode === 'blitz' ? 'blitz' : 'classic',
    firstMatch: mode === 'first-match',
    assist: mode === 'first-match' || mode === 'new-career' ? 0.5 : mode === 'max-assisted-career' ? 1 : 0 };
  return receiveKickoff(new Match(cfg), side);
}

function unattended(m: Match, side: Side) {
  const carrier = m.ball.owner;
  let firstControl = -1;
  let run = 0;
  let held = 0;
  let won = false;
  let idleAttempts = 0;
  let instantRecapture = 0;
  let winsWithControl = 0;
  let looseWins = 0;
  let elapsed = 0;
  for (; elapsed < 30 && m.phase === 'play'; elapsed += DT) {
    const active = m.activeOf(side);
    m.step(DT, EMPTY_PAD);
    for (const e of m.drainEvents()) {
      if (e.type === 'tackle' && e.by === active) idleAttempts++;
      if (e.type === 'tackle' && e.won && m.players[e.by].side !== side) {
        won = true;
        // WON means the challenge took the ball off its carrier. Some pokes/slides create a loose-ball
        // contest; actual control is separately emitted and must survive the subsequent simulation frames.
        if (m.ball.owner === carrier) instantRecapture++;
        if (m.ball.owner < 0) looseWins++;
        else if (m.players[m.ball.owner].side !== side) winsWithControl++;
      }
      if (e.type === 'control' && m.players[e.player].side !== side && firstControl < 0) firstControl = elapsed;
    }
    // Ownership must survive actual simulation frames, including an opponent's pass, rather than merely emit WON.
    const possession = m.ball.owner >= 0 ? m.players[m.ball.owner].side : m.ball.lastTouchSide;
    run = firstControl >= 0 && possession !== side ? run + DT : 0;
    held = Math.max(held, run);
    if (held >= 1.5) break;
  }
  return { firstControl, held, won, idleAttempts, instantRecapture, winsWithControl, looseWins,
    elapsed, carrier, owner: m.ball.owner, phase: m.phase };
}

describe('unattended possession through normal match controls', () => {
  for (const [difficulty, name, minimum] of [[0.6, 'Easy', 20], [1.8, 'Normal', 23]] as const) {
    it(`${name} defenders take and keep the ball across low blocks, counters and possession sides`, () => {
      const rows = [];
      for (const rival of [0, 4, 6, 8]) for (const seed of [1, 2, 3, 4, 5, 6]) {
        const r = unattended(kickoff(seed, difficulty, rival), 0);
        expect(r.idleAttempts, `${name}/${rival}/${seed}: neutral input must never auto-tackle it back`).toBe(0);
        expect(r.instantRecapture, `${name}/${rival}/${seed}: successful challenge cannot instantly return to the idle carrier`).toBe(0);
        expect(r.phase !== 'play' || r.owner !== r.carrier, `${name}/${rival}/${seed}: still owns it after 30s`).toBe(true);
        rows.push(r);
      }
      const kept = rows.filter((r) => r.won && r.held >= 1.5).length;
      // Fouls and one-frame WON events do not count. Easy still allows more misses and time to react.
      expect(kept).toBeGreaterThanOrEqual(minimum);
      const controls = rows.filter((r) => r.firstControl >= 0);
      console.log(`${name}: ${kept}/24 idle receivers cleanly dispossessed for at least 1.5s; average first control ${
        (controls.reduce((n, r) => n + r.firstControl, 0) / controls.length).toFixed(2)}s`);
    });
  }

  it('both human sides remain challengeable during first-match easing and maximum loss-streak assistance', () => {
    for (const side of [0, 1] as const) for (const difficulty of [0.6, 1.8]) {
      let controlled = 0;
      for (const rival of [0, 4, 6, 8]) for (const seed of [7, 8, 9]) {
        const r = unattended(kickoff(seed, difficulty, rival, side, true, 1), side);
        expect(r.idleAttempts).toBe(0);
        expect(r.phase !== 'play' || r.owner !== r.carrier, `${side}/${difficulty}/${rival}/${seed}: idle safe haven`).toBe(true);
        if (r.won && r.held >= 1.5) controlled++;
      }
      expect(controlled, `${side}/${difficulty}: easing must retain actual counterplay`).toBeGreaterThanOrEqual(8);
    }
  });

  for (const [mode, minimum] of [['first-match', 20], ['new-career', 20], ['max-assisted-career', 18],
    ['normal-quick', 22], ['blitz', 15]] as const) {
    it(`${mode}: shipping coach, HYPE and generated low-rated squads do not restore stationary immunity`, () => {
      let clean = 0;
      for (let seed = 1; seed <= 24; seed++) {
        const m = shippingKickoff(mode, seed);
        const r = unattended(m, m.cfg.humanSide as Side);
        expect(r.idleAttempts, `${mode}/${seed}: neutral input cannot tackle a won ball straight back`).toBe(0);
        expect(r.instantRecapture, `${mode}/${seed}: successful challenge must strip the original carrier`).toBe(0);
        expect(r.phase !== 'play' || r.owner !== r.carrier, `${mode}/${seed}: unattended carrier still owns it`).toBe(true);
        if (r.won && r.held >= 1.5) clean++;
      }
      // A foul, throw-in or one-frame WON never counts as actual opponent possession.
      expect(clean).toBeGreaterThanOrEqual(minimum);
      console.log(`${mode}: ${clean}/24 actual tackle wins held for at least 1.5s`);
    });
  }

  it('Normal shipping AI challenges an automatic straight sprint before it reaches the keeper', () => {
    let controlled = 0;
    let deep = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const m = shippingKickoff('normal-quick', seed);
      const side = m.cfg.humanSide as Side;
      const carrier = m.ball.owner;
      let furthest = 0;
      for (let tick = 0; tick < 25 * 60 && m.phase === 'play'; tick++) {
        m.step(DT, { ...EMPTY_PAD, mx: m.attackDir(side), autoSprint: true });
        m.drainEvents();
        if (m.ball.owner === carrier) furthest = Math.max(furthest, m.players[carrier].pos.x * m.attackDir(side));
        if (m.ball.owner >= 0 && m.players[m.ball.owner].side !== side) {
          controlled++;
          break;
        }
      }
      if (furthest > 40) deep++;
    }
    expect(controlled).toBeGreaterThanOrEqual(20);
    expect(deep).toBe(0);
  });

  it('the initial receiving grace still gives time to look up before the stationary read', () => {
    for (const side of [0, 1] as const) for (const difficulty of [0.6, 1.8]) {
      const m = kickoff(3, difficulty, 4, side);
      const carrier = m.ball.owner;
      for (let tick = 0; tick < 2 * 60; tick++) {
        m.step(DT, EMPTY_PAD);
        expect(m.drainEvents().some((e) => e.type === 'tackle' && e.won && m.players[e.by].side !== side)).toBe(false);
        expect(m.ball.owner).toBe(carrier);
      }
    }
  });

  for (const difficulty of [0.6, 1.8]) {
    it(`timing SKILL still beats the stationary challenge at difficulty ${difficulty}`, () => {
      const m = kickoff(2, difficulty, 4);
      const carrier = m.ball.owner;
      let warned = false;
      for (let tick = 0; tick < 12 * 60 && m.ball.owner === carrier && m.phase === 'play'; tick++) {
        m.step(DT, EMPTY_PAD);
        const events = m.drainEvents();
        if (tick * DT < STALL_S || !events.some((e) => e.type === 'skillTell' && e.on === carrier)) continue;
        warned = true;
        m.step(DT, { ...EMPTY_PAD, skill: true });
        expect(m.drainEvents().some((e) => e.type === 'skillMove' && e.player === carrier && e.grade === 'perfect')).toBe(true);
        for (let next = 0; next < 15; next++) {
          m.step(DT, EMPTY_PAD);
          m.drainEvents();
          expect(m.ball.owner).toBe(carrier);
        }
        break;
      }
      expect(warned).toBe(true);
    });
  }
});
