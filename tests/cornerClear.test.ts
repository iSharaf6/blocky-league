import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';

// The owner (2026-09-30): "the corners for the opposition when its there corner and im trying to clear with header
// it is very hard to clear there should be where u can just celar the ball". Their corners, the AI taking them for
// real, our human doing nothing, one tap as it's struck, one late tap, or mashing: who gets to it first?
type Mode = 'none' | 'tap' | 'late' | 'mash';
interface CornerTrial { first: 'us' | 'them' | 'nobody'; goal: boolean; shot: boolean; human: boolean }
declare const process: { env: Record<string, string | undefined>; getBuiltinModule(id: string): { writeFileSync(path: string, data: string): void } };

function corner(seed: number, mode: Mode, left: boolean): CornerTrial {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[seed % 8]), away: makeTeam(PRESET_CLUBS[(seed + 3) % 8]), halfLength: 900, difficulty: 1.8, humanSide: 0, seed });
  const ad = m.attackDir(0);
  // Ten seconds of play first, so everybody is somewhere real; then their corner at our end.
  for (let i = 0; i < 600; i++) m.step(DT, EMPTY_PAD);
  (m as unknown as { goOut(k: string, s: number, x: number, z: number): void }).goOut('corner', 1, -ad * HALF_L, (left ? -1 : 1) * HALF_W);
  m.drainEvents();
  let struck = -1;
  let tapped = false;
  const res: CornerTrial = { first: 'nobody', goal: false, shot: false, human: false };
  for (let i = 0; i < 60 * 14; i++) {
    const since = struck >= 0 ? (i - struck) * DT : -1;
    const pad: Pad = { ...EMPTY_PAD };
    if (since >= 0) {
      if (mode === 'tap' && !tapped && since >= 0.05) pad.pass = tapped = true;
      else if (mode === 'late' && !tapped && since >= 0.45) pad.pass = tapped = true;
      else if (mode === 'mash') pad.shoot = Math.floor(since / 0.12) % 2 === 0;
    }
    const lastBefore = m.ball.lastTouch;
    m.step(DT, pad);
    for (const e of m.drainEvents()) {
      if (e.type === 'kick' && struck < 0 && m.ball.lastTouchSide === 1) struck = i;
      else if (e.type === 'kick' && struck >= 0 && (e.kind === 'shot' || e.kind === 'header') && m.ball.lastTouchSide === 1) res.shot = true;
      if (e.type === 'goal' && e.side === 1) res.goal = true;
    }
    if (struck >= 0 && i > struck && res.first === 'nobody') {
      const lt = m.ball.lastTouch;
      if (lt >= 0 && lt !== lastBefore) {
        res.first = m.players[lt].side === 0 ? 'us' : 'them';
        res.human = lt === m.active;
      } else if (m.ball.owner >= 0) {
        res.first = m.players[m.ball.owner].side === 0 ? 'us' : 'them';
        res.human = m.ball.owner === m.active;
      }
    }
    if (struck >= 0 && (i - struck) * DT > 4) break;
    if (m.phase === 'goal') break;
  }
  return res;
}

describe("their corners: 'just clear it'", () => {
  it('one press as it comes in clears it far more often than doing nothing', { timeout: 300_000 }, () => {
    const out: Record<string, string> = {};
    const rate: Record<Mode, number> = { none: 0, tap: 0, late: 0, mash: 0 };
    for (const mode of ['none', 'tap', 'late', 'mash'] as Mode[]) {
      const list: CornerTrial[] = [];
      for (let s = 1; s <= 30; s++) for (const left of [false, true]) list.push(corner(s, mode, left));
      const n = list.length;
      const us = list.filter((t) => t.first === 'us').length;
      rate[mode] = us / n;
      out[mode] = `n=${n} ours first ${us} (${Math.round((100 * us) / n)}%), by our man ${list.filter((t) => t.human).length}, their shots ${list.filter((t) => t.shot).length}, goals against ${list.filter((t) => t.goal).length}`;
    }
    const dir = process.env.CORNER_OUT;
    if (dir) process.getBuiltinModule('node:fs').writeFileSync(`${dir}/corners.json`, JSON.stringify(out, null, 1));
    // A press (early, late or mashed) is our ball first well over half the time, and never worse than doing nothing.
    for (const mode of ['tap', 'late', 'mash'] as Mode[]) {
      expect(rate[mode], mode).toBeGreaterThan(0.55);
      expect(rate[mode], mode).toBeGreaterThanOrEqual(rate.none);
    }
  });
});
