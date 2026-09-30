import { describe, expect, it } from 'vitest';
import { NEAR_M, runPassTrials, summarise, type Hold, type PassTrial } from './passTrials';

// Real open-play pass trials (tests/passTrials.ts): passes to team-mates on the move, a key held after the tap.
const SEEDS = [1, 2, 3, 4, 5, 6];
const HOLDS: Hold[] = ['keep', 'run', 'none', 'back'];
// (Node's fs and env, typed loosely: the project's types are the browser's.)
declare const process: { env: Record<string, string | undefined>; getBuiltinModule(id: string): { writeFileSync(path: string, data: string): void } };

describe('passing to a man on the move, in real matches', () => {
  for (const hold of HOLDS) {
    it(`holding '${hold}' after the pass`, { timeout: 180_000 }, () => {
      const list: PassTrial[] = SEEDS.flatMap((s) => runPassTrials(s, hold));
      const out = process.env.PASS_TRIALS_OUT;
      if (out) process.getBuiltinModule('node:fs').writeFileSync(`${out}/${hold}.json`, JSON.stringify(list));
      console.log(`${hold.padEnd(5)} ${summarise(list)}`);
      expect(list.length).toBeGreaterThan(20);
      // The frustrating one: the ball right there (within NEAR_M of him, on the ground) and not his: it rolled
      // on past him, or it came straight off him with nobody near (not an offside flag, not a tackle, not a
      // defender who got there first). Before the 2026-09-30 fix: up to 6% of passes, 11 of them behind him.
      const lostByTackle = (t: PassTrial) => t.outcome === 'dropped' && /last=(1[1-9]|2[01])\b/.test(t.diag ?? '');
      const near = list.filter((t) => (t.outcome === 'dead' || (t.outcome === 'dropped' && !lostByTackle(t))) && t.closest < NEAR_M);
      expect(near.length / list.length).toBeLessThan(0.01);
      // Taken and still his 0.4 s later, most of the time (the rest: interceptions, tackles, offside).
      expect(list.filter((t) => t.outcome === 'got').length / list.length).toBeGreaterThan(0.8);
    });
  }
});
