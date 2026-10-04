import { describe, expect, it, vi } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_W } from '../src/sim/constants';
import { humanTackle } from '../src/sim/dribble';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import { trainerCue } from '../src/ui/trainer';

const pad = (extra: Partial<Pad> = {}): Pad => ({ ...EMPTY_PAD, ...extra });
function place(p: Player, x: number, z: number): void {
  p.pos.x = x; p.pos.z = z; p.vel.x = p.vel.z = 0;
  p.setState('move'); p.order = null; p.facing = 0;
}
function setup(seed = 72): { m: Match; p: Player; mate: Player } {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 1.8, humanSide: 0, seed });
  m.phase = 'play'; m.restart = null; m.clock = 20;
  for (const [i, p] of m.players.entries()) place(p, -40 + i * 3.6, -HALF_W + 1);
  const p = m.players[6], mate = m.players[8];
  place(p, 0, 0); place(mate, 14, 0);
  m.active = p.idx; m.ball.reset(p.footX(), p.footZ()); m.ball.owner = p.idx;
  m.ball.lastTouch = p.idx; m.ball.lastTouchSide = 0;
  m.updateBallPath(); m.drainEvents();
  return { m, p, mate };
}

describe('arcade control loop', () => {
  it('the default pass leaves within 34 ms of pressing, including backwards, without waiting for release', () => {
    for (const angle of [0, Math.PI / 2, Math.PI]) {
      const { m, p, mate } = setup();
      place(mate, Math.cos(angle) * 14, Math.sin(angle) * 14);
      const input = pad({ mx: Math.cos(angle), mz: Math.sin(angle), pass: true });
      let kicked = false;
      for (let i = 0; i < 3; i++) {
        m.step(DT, input);
        if (m.drainEvents().some(e => e.type === 'kick' && e.kind === 'pass')) { kicked = true; break; }
      }
      expect(kicked).toBe(true);
      expect(m.passTarget).toBe(mate.idx);
      expect(m.ball.lastTouch).toBe(p.idx);
      expect(m.ball.owner).toBe(-1);
    }
  });

  it('holding PASS through reception does not accidentally play a second pass', () => {
    const { m, mate } = setup();
    let passes = 0, received = false;
    for (let i = 0; i < 75; i++) {
      m.step(DT, pad({ mx: 1, pass: true }));
      for (const e of m.drainEvents()) {
        if (e.type === 'kick' && e.kind === 'pass') passes++;
        if (e.type === 'control' && e.player === mate.idx) received = true;
      }
      received ||= m.ball.owner === mate.idx;
    }
    expect(received).toBe(true);
    expect(passes).toBe(1);
  });

  it('a standing tackle can be followed immediately by a pass during its poke animation', () => {
    const { m, p } = setup();
    p.setState('kick'); p.poke = true; p.stateT = 0.09;
    m.step(DT, pad({ mx: 1, pass: true }));
    m.step(DT, pad({ mx: 1, pass: true }));
    expect(m.drainEvents().some(e => e.type === 'kick' && e.kind === 'pass')).toBe(true);
  });

  it('winning possession while holding TACKLE does not turn its release into an unwanted shot', () => {
    const { m, p } = setup();
    const c = m.players[19];
    place(c, 20, 0);
    m.ball.owner = c.idx; m.ball.pos.x = c.footX();
    m.step(DT, pad({ shoot: true }));
    // A teammate's challenge or our own tackle gives us the ball during the same hold.
    m.ball.reset(p.footX(), p.footZ()); m.ball.owner = p.idx; m.active = p.idx;
    for (let i = 0; i < 12; i++) m.step(DT, pad({ shoot: true }));
    expect(m.shootCharge).toBe(0);
    m.step(DT, EMPTY_PAD);
    for (let i = 0; i < 15; i++) m.step(DT, EMPTY_PAD);
    expect(m.stats.shots[0]).toBe(0);
    m.step(DT, pad({ shoot: true }));
    m.step(DT, EMPTY_PAD);
    for (let i = 0; i < 15; i++) m.step(DT, EMPTY_PAD);
    expect(m.stats.shots[0]).toBe(1);
  });

  it('sprint + pass sends the passer forward and he recovers his movement after contact', () => {
    const { m, p, mate } = setup();
    const ad = m.attackDir(0);
    place(mate, 0, 12);
    m.step(DT, pad({ mz: 1, sprint: true, pass: true }));
    m.step(DT, pad({ mz: 1, sprint: true, pass: true }));
    expect(p.giveGoT).toBeGreaterThan(2);
    for (let i = 0; i < 65; i++) m.step(DT, EMPTY_PAD);
    expect(p.pos.x * ad).toBeGreaterThan(3);
    expect(p.state).toBe('move');
  });

  it('a shot tapped while an incoming pass is more than four metres away is remembered', () => {
    const { m, p } = setup();
    const ad = m.attackDir(0);
    place(p, ad * 30, 0);
    m.ball.reset(p.pos.x - ad * 8, 0);
    m.ball.vel.x = ad * 20;
    m.ball.owner = -1;
    m.ball.lastTouch = m.players[8].idx;
    m.passTarget = p.idx; m.kickKind = 'pass'; m.kickSide = 0;
    m.updateBallPath();
    m.step(DT, pad({ shoot: true }));
    expect(p.order?.kind).toBe('shot');
    let shot = false;
    for (let i = 0; i < 90; i++) {
      m.step(DT, EMPTY_PAD);
      shot ||= m.drainEvents().some(e => e.type === 'kick' && (e.kind === 'shot' || e.kind === 'header'));
    }
    expect(shot).toBe(true);
  });

  it('movement gets up to speed quickly and responds to a reversal without a long drift', () => {
    const { p } = setup();
    p.quickLegs = true; p.wantX = 1;
    for (let i = 0; i < 8; i++) p.step(DT, true, true);
    expect(p.vel.x).toBeGreaterThan(3.5);
    p.wantX = -1;
    for (let i = 0; i < 8; i++) p.step(DT, true, true);
    expect(p.vel.x).toBeLessThan(0);
    p.wantX = 0;
    for (let i = 0; i < 8; i++) p.step(DT, true, true);
    expect(p.speed()).toBeLessThan(0.05);
  });

  it('holding after a missed standing tackle still commits a slide; switching cancels a pending tackle', () => {
    const { m, p } = setup();
    const c = m.players[19];
    place(c, 1.7, 0); c.facing = Math.PI;
    m.ball.owner = c.idx; m.ball.pos.x = c.footX(); m.ball.pos.z = c.footZ();
    const chance = vi.spyOn(m.rng, 'chance').mockReturnValue(false);
    humanTackle(m, p, pad({ shoot: true }), true, 0, DT);
    expect(m.assist.tackle).not.toBeNull();
    for (let i = 0; i < 18; i++) humanTackle(m, p, pad({ shoot: true }), false, 0, DT);
    expect(p.state).toBe('slide');
    chance.mockRestore();
    const next = setup();
    place(next.m.players[19], 5, 0);
    next.m.ball.owner = 19; next.m.ball.pos.x = 5;
    humanTackle(next.m, next.p, pad({ shoot: true }), true, 0, DT);
    expect(next.m.assist.tackle).not.toBeNull();
    humanTackle(next.m, next.mate, pad({ shoot: true }), false, 0, DT);
    expect(next.m.assist.tackle).toBeNull();
  });
});

describe('persistent contextual trainer', () => {
  it('describes attack, charging, first-time receiving and defensive controls for the active input device', () => {
    const { m, p } = setup();
    expect(trainerCue(m, 'keyboard').actions[0]).toEqual(['SPACE', 'Pass']);
    expect(trainerCue(m, 'gamepad').actions[0][0]).toBe('A');
    m.shootCharge = 0.2;
    expect(trainerCue(m, 'keyboard').actions).toContainEqual(['K', 'Let go to shoot']);
    m.shootCharge = 0; m.throughCharge = 0.4; m.passMode = 'lob';
    expect(trainerCue(m, 'keyboard').title).toBe('CROSS READY');
    m.throughCharge = 0; m.ball.owner = -1; m.passTarget = p.idx;
    expect(trainerCue(m, 'keyboard').title).toBe('MEET THE PASS');
    m.ball.owner = 19;
    expect(trainerCue(m, 'touch').actions).toContainEqual(['PRESS', 'Hold to press']);
    expect(trainerCue(m, 'touch').detail).toContain('TACKLE');
  });

  it('does not advertise a cross for a defensive press that just won possession', () => {
    const { m } = setup();
    m.throughCharge = 0.5;
    expect(trainerCue(m, 'keyboard').title).toBe('ON THE BALL');
    m.ball.held = true;
    expect(trainerCue(m, 'keyboard').title).toBe("KEEPER'S BALL");
    // (His keeper is his with the ball: he walks it about his box, throws it or kicks it long.)
    expect(trainerCue(m, 'keyboard').actions).toContainEqual(['SPACE', 'Throw']);
    expect(trainerCue(m, 'keyboard').actions).toContainEqual(['WASD', 'Walk it']);
  });
});
