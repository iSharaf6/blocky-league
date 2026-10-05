import { describe, expect, it } from 'vitest';
import {
  BIG_LINE, BOX_CHAIR, BOX_DESK_Y, BOX_FULL_S, BOX_GROAN, BOX_HEADSET, BOX_JOY, BOX_PAPERS, COIN_CHANCE, FAN_BUCKET, FULL_CAP, FULL_GAP_S, PROP_F, PROP_MAX,
  PUPPET_MAX, SIDE_CAPS, SIDE_CAST, SIDE_LABEL, SIDE_S, SideShow, newPose, sidePose, type SideCue, type SideFacts, type SideKind, type SideMood,
  type SideSink,
} from '../src/game/sideShow';
import type { Match } from '../src/sim/match';
import type { Kit, MatchEvent, PlayerDef } from '../src/sim/types';

/**
 * SIDE SHOWS (the owner: "we said more cutscenes", "commentators watching in their studio with the replay celebrating
 * the goal"): what plays, when, how often and for how long, and where everyone is while it does. The drawing
 * (render/sideStage.ts) is looked at in the browser.
 */

const KIT: Kit = { shirt: 0xcc2233, shirt2: 0xffffff, pattern: 'plain', shorts: 0x111111, socks: 0x111111, gk: 0x22cc55 };
const def = (i: number): PlayerDef => ({
  id: `p${i}`, name: `First Surname${i}`, number: i + 1, role: i % 11 === 0 ? 'GK' : 'MF',
  stats: { pace: 50, shooting: 50, passing: 50, dribbling: 50, defending: 50, keeping: 50, stamina: 50 },
  look: { skin: 0, hair: 0, hairColor: 0, beard: 0, boots: 0 },
});

/** Just enough of a Match: 22 players (0..10 home, a keeper first each side), benches, the clock and the score. */
function fakeMatch(): Match {
  const players = Array.from({ length: 22 }, (_, i) => ({ idx: i, side: i < 11 ? 0 : 1, def: def(i), isKeeper: i % 11 === 0, sentOff: false }));
  return {
    cfg: { humanSide: 0, halfLength: 120 }, teams: [{ short: 'MOS', name: 'Mossvale' }, { short: 'PEB', name: 'Pebbleport' }],
    players, bench: [[def(30), def(31), def(32), def(33)], [def(40), def(41), def(42)]],
    teamPlayers: (s: number) => players.filter((p) => p.side === s),
    phase: 'play', restart: null, half: 1, clock: 10, score: [0, 0],
  } as unknown as Match;
}

function rig(opt: { rng?: () => number; knockout?: boolean; enabled?: boolean } = {}) {
  const shown: SideCue[] = [];
  const log: string[] = [];
  const sounds: string[] = [];
  const picture = {
    begin: (c: SideCue) => { shown.push(c); log.push(`begin:${c.kind}${c.full ? ':full' : ''}`); },
    frame: () => {},
    end: () => { log.push('end'); },
  };
  const sink = new Proxy({}, { get: (_t, name: string) => (...a: unknown[]) => void sounds.push(a.length && name === 'sting' ? `${name}:${String(a[0])}` : name) }) as unknown as SideSink;
  const m = fakeMatch();
  const show = new SideShow(picture, {
    enabled: opt.enabled ?? true, kits: [KIT, { ...KIT, shirt: 0x2244cc }], humanSide: 0, knockout: opt.knockout, captain: (s) => (s === 0 ? 4 : 15),
    rng: opt.rng ?? (() => 0.5),
  }, sink);
  const f: SideFacts = { dt: 1 / 60, time: 0, m, goalReplay: false, replayHit: false, incident: false, busy: false, intro: false, interlude: '', goalSkipped: false };
  const run = (seconds: number, set: Partial<SideFacts> = {}): void => {
    Object.assign(f, set);
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      f.time += f.dt;
      show.frame(f);
    }
  };
  /** A goal from the whistle to the kick-off: 2.6 s of celebration, the replay (the ball in at 2 s of it, 1.8 s more), then play. */
  const goal = (side: 0 | 1, scorer: number, o: { skipReplay?: boolean } = {}): { full: boolean; kind: string; heldFor: number } => {
    const mm = m as unknown as { phase: string; score: number[] };
    mm.phase = 'goal';
    mm.score[side]++;
    show.events([{ type: 'goal', side, scorer, own: false } as MatchEvent], m);
    run(2.6);
    let heldFor = 0;
    let full = false;
    while (show.holdsReplay(m)) {
      full = true;
      run(1 / 60);
      heldFor += 1 / 60;
      if (heldFor > 10) break;
    }
    let kind = '';
    if (!o.skipReplay) {
      run(2, { goalReplay: true });
      kind = show.state.kind;
      run(1.8, { replayHit: true });
    }
    mm.phase = 'kickoff';
    run(0.5, { goalReplay: false, replayHit: false });
    mm.phase = 'play';
    return { full, kind, heldFor };
  };
  return { show, shown, log, sounds, m, f, run, goal };
}

describe('the commentary box reacts to goals', () => {
  it('has at least five ways to celebrate and three to groan, each its own picture', () => {
    expect(BOX_JOY.length).toBeGreaterThanOrEqual(5);
    expect(BOX_GROAN.length).toBeGreaterThanOrEqual(3);
    const ps = Array.from({ length: PUPPET_MAX }, newPose);
    const v = new Float32Array(PROP_MAX * PROP_F);
    const seen = new Set<string>();
    for (const [mood, list] of [['joy', BOX_JOY], ['groan', BOX_GROAN]] as [SideMood, readonly string[]][]) {
      list.forEach((_name, i) => {
        sidePose('box', mood, i, 2.9, 0.9, ps, v);
        seen.add(JSON.stringify([ps[0], ps[1]].map((p) => Object.values(p).map((n) => (typeof n === 'number' ? +n.toFixed(2) : n)))) + Array.from(v.slice(0, 70)).map((n) => n.toFixed(1)).join());
      });
    }
    expect(seen.size).toBe(BOX_JOY.length + BOX_GROAN.length);
  });

  it('they sit and watch the replay, and only go off when the ball goes in', () => {
    const ps = Array.from({ length: PUPPET_MAX }, newPose);
    const v = new Float32Array(PROP_MAX * PROP_F);
    sidePose('box', 'joy', 0, 1.2, -1, ps, v);
    expect(ps[0].sit).toBe(1);
    expect(ps[1].sit).toBe(1);
    expect(ps[0].lean).toBeLessThan(0);
    const seatedY = ps[0].y;
    sidePose('box', 'joy', 0, 2.5, 0.5, ps, v);
    expect(ps[0].sit).toBe(0);
    expect(ps[0].y).toBeGreaterThan(seatedY);
    expect(ps[0].alz).toBeGreaterThan(2);
  });

  it('one falls off his chair, a headset flies off and the papers go up and come down on the desk', () => {
    const ps = Array.from({ length: PUPPET_MAX }, newPose);
    const v = new Float32Array(PROP_MAX * PROP_F);
    const at = (name: string, h: number): void => sidePose('box', 'joy', (BOX_JOY as readonly string[]).indexOf(name), h + 2, h, ps, v);
    at('chair', 1.2);
    expect(ps[1].lean).toBeGreaterThan(2);
    expect(v[BOX_CHAIR * PROP_F + 3]).toBeLessThan(-1);
    expect(ps[0].sit).toBe(0);
    at('headset', 0.1);
    expect(v[BOX_HEADSET * PROP_F + 1]).toBe(0);
    at('headset', 0.6);
    expect(v[BOX_HEADSET * PROP_F + 1]).toBeGreaterThan(0.5);
    at('papers', 0.5);
    const up = Array.from({ length: BOX_PAPERS }, (_, j) => v[j * PROP_F + 1]);
    expect(Math.max(...up)).toBeGreaterThan(BOX_DESK_Y + 1);
    at('papers', 3);
    for (let j = 0; j < BOX_PAPERS; j++) {
      expect(v[j * PROP_F + 1]).toBeCloseTo(BOX_DESK_Y, 1);
      expect(v[j * PROP_F + 6]).toBe(1);
    }
  });

  it('comes up with a goal replay, reacts at the goal, goes with the replay, and uses every reaction before one returns', () => {
    const r = rig({ rng: () => 0.5 });
    const first = r.goal(0, 9);
    expect(first.kind).toBe('box');
    expect(first.full).toBe(false);
    expect(r.shown[0].mood).toBe('joy');
    expect(r.shown[0].screen).toEqual({ home: 'MOS', away: 'PEB', score: [1, 0], scorer: 'Surname9' });
    expect(r.log).toEqual(['begin:box', 'end']);
    expect(r.sounds).toContain('cheer');
    // A goal against: a groan.
    const r2 = rig();
    r2.goal(1, 15);
    expect(r2.shown[0].mood).toBe('groan');
    expect(r2.sounds).toContain('groan');
    // The reactions: a shuffled round of all six, then another, never the same twice running.
    const picks: number[] = [];
    let seed = 7;
    const rr = rig({ rng: () => (seed = (seed * 16807) % 2147483647) / 2147483647 });
    const next = (rr.show as unknown as { nextReaction(m: SideMood): number }).nextReaction.bind(rr.show);
    for (let i = 0; i < 24; i++) picks.push(next('joy'));
    for (let round = 0; round < 4; round++) expect(new Set(picks.slice(round * 6, round * 6 + 6)).size).toBe(6);
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
  });

  it('a goal replay never gets the same picture twice running, and each picture has its cap', () => {
    let seed = 11;
    const r = rig({ rng: () => (seed = (seed * 16807) % 2147483647) / 2147483647 });
    const kinds: string[] = [];
    for (let i = 0; i < 14; i++) kinds.push(r.goal(i % 3 === 2 ? 1 : 0, 2 + i).kind);
    expect(kinds[0]).toBe('box');
    for (let i = 1; i < kinds.length; i++) if (kinds[i]) expect(kinds[i]).not.toBe(kinds[i - 1]);
    const count = (k: string): number => kinds.filter((x) => x === k).length;
    expect(count('box')).toBeLessThanOrEqual(SIDE_CAPS.box);
    expect(count('fans')).toBeLessThanOrEqual(SIDE_CAPS.fans);
    expect(count('dugout')).toBeLessThanOrEqual(SIDE_CAPS.dugout);
    expect(count('fans') + count('dugout')).toBeGreaterThan(0);
    // (Some replays keep the whole screen: no picture plays every time.)
    expect(count('')).toBeGreaterThan(0);
    // The dugout's bench is the real one.
    const dug = r.shown.find((c) => c.kind === 'dugout');
    expect(dug?.cast.map((c) => c.def.id)).toEqual(['p30', 'p31', 'p32']);
  });

  it('a hat trick gets the whole screen for 2 to 3 s before the replay, at most twice a match and not back to back', () => {
    expect(BOX_FULL_S).toBeGreaterThanOrEqual(2);
    expect(BOX_FULL_S).toBeLessThanOrEqual(3);
    const r = rig();
    r.goal(0, 9);
    r.goal(0, 9);
    const third = r.goal(0, 9);
    expect(third.full).toBe(true);
    expect(third.heldFor).toBeGreaterThan(BOX_FULL_S - 0.1);
    expect(third.heldFor).toBeLessThan(BOX_FULL_S + 0.1);
    const cue = r.shown.find((c) => c.full)!;
    expect(cue.line).toBe(BIG_LINE.hattrick);
    expect(r.sounds).toContain('sting:studio');
    // (They have had their moment: the replay after it keeps the whole picture.)
    expect(third.kind).toBe('');
    // Another hat trick straight after: too soon. Later: the second and last.
    r.goal(0, 8);
    r.goal(0, 8);
    expect(r.goal(0, 8).full).toBe(false);
    r.run(FULL_GAP_S);
    r.goal(0, 7);
    r.goal(0, 7);
    expect(r.goal(0, 7).full).toBe(true);
    r.run(FULL_GAP_S);
    r.goal(0, 6);
    r.goal(0, 6);
    expect(r.goal(0, 6).full).toBe(false);
    expect(r.show.state.fulls).toBe(FULL_CAP);
  });

  it('late drama, a SUPER SHOT and a knockout lead are big goals too; a tap skips the cut', () => {
    const late = rig();
    Object.assign(late.m, { half: 2, clock: 110 });
    expect(late.goal(0, 9).full).toBe(true);
    expect(late.shown[0].line).toBe(BIG_LINE.late);
    const early = rig();
    Object.assign(early.m, { half: 2, clock: 30 });
    expect(early.goal(0, 9).full).toBe(false);
    const sup = rig();
    sup.show.events([{ type: 'superShot', side: 0, player: 9 } as MatchEvent], sup.m);
    expect(sup.goal(0, 9).full).toBe(true);
    const cup = rig({ knockout: true });
    Object.assign(cup.m, { half: 2, clock: 30 });
    expect(cup.goal(0, 9).full).toBe(true);
    // A goal against is never a big moment for them.
    const theirs = rig();
    Object.assign(theirs.m, { half: 2, clock: 110 });
    expect(theirs.goal(1, 15).full).toBe(false);
    // Skipped: the cut ends on that frame and the replay is free to start (or not).
    const skip = rig();
    Object.assign(skip.m, { half: 2, clock: 110, phase: 'goal' });
    (skip.m as unknown as { score: number[] }).score[0]++;
    skip.show.events([{ type: 'goal', side: 0, scorer: 9, own: false } as MatchEvent], skip.m);
    expect(skip.show.holdsReplay(skip.m)).toBe(true);
    skip.run(0.5);
    expect(skip.show.full).toBe(true);
    skip.run(1 / 60, { goalSkipped: true });
    expect(skip.show.full).toBe(false);
    expect(skip.show.holdsReplay(skip.m)).toBe(false);
  });

  it('with SIDE SHOWS off nothing plays and nothing holds the replay', () => {
    const r = rig({ enabled: false });
    Object.assign(r.m, { half: 2, clock: 110 });
    const g = r.goal(0, 9);
    expect(g.full).toBe(false);
    expect(r.shown).toHaveLength(0);
    expect(r.sounds).toHaveLength(0);
  });
});

describe('the other side shows', () => {
  it('the coin toss before the first kick-off: the two real captains and a referee, in most matches', () => {
    const r = rig({ rng: () => COIN_CHANCE - 0.01 });
    Object.assign(r.m, { phase: 'kickoff', half: 1 });
    r.run(0.5, { intro: true });
    expect(r.show.state.kind).toBe('coin');
    expect(r.shown[0].cast.map((c) => [c.def.id, c.side])).toEqual([['p4', 0], ['p15', 1]]);
    r.run(SIDE_S, { intro: false });
    expect(r.show.state.kind).toBe('');
    expect(r.sounds).toContain('coin');
    // Asked once: a second-half kick-off has no toss.
    r.run(0.5, { intro: true });
    expect(r.shown).toHaveLength(1);
    const none = rig({ rng: () => COIN_CHANCE + 0.01 });
    Object.assign(none.m, { phase: 'kickoff', half: 1 });
    none.run(0.5, { intro: true });
    expect(none.shown).toHaveLength(0);
  });

  it('keeper cam while a penalty is prepared: it starts with the wait, ends with the kick, once a match', () => {
    const r = rig();
    Object.assign(r.m, { phase: 'restart', restart: { kind: 'penalty', side: 1, taker: 16 } });
    // (Not over the award's recap.)
    r.run(0.5, { incident: true });
    expect(r.shown).toHaveLength(0);
    r.run(1, { incident: false });
    expect(r.show.state.kind).toBe('penalty');
    expect(r.shown[0].cast.map((c) => [c.def.id, c.side, c.keeper])).toEqual([['p16', 1, false], ['p0', 0, true]]);
    Object.assign(r.m, { phase: 'play', restart: null });
    r.run(1 / 60);
    expect(r.show.state.kind).toBe('');
    Object.assign(r.m, { phase: 'restart', restart: { kind: 'penalty', side: 0, taker: 9 } });
    r.run(1);
    expect(r.shown).toHaveLength(1);
  });

  it('a red card: the man walks past his manager once the card and its recap are done', () => {
    const r = rig();
    Object.assign(r.m, { phase: 'restart' });
    r.show.events([{ type: 'card', player: 7, color: 'red' } as MatchEvent, { type: 'card', player: 8, color: 'yellow' } as MatchEvent], r.m);
    r.run(1, { busy: true });
    expect(r.shown).toHaveLength(0);
    r.run(0.2, { busy: false });
    expect(r.show.state.kind).toBe('redcard');
    expect(r.shown[0].cast.at(-1)?.def.id).toBe('p7');
    expect(r.shown[0].cast).toHaveLength(4);
    r.run(SIDE_S);
    expect(r.show.state.kind).toBe('');
    // A yellow never does it.
    const y = rig();
    y.show.events([{ type: 'card', player: 8, color: 'yellow' } as MatchEvent], y.m);
    y.run(1);
    expect(y.shown).toHaveLength(0);
  });

  it('the match ball: only a hat trick scorer takes it home, at the full-time handshakes', () => {
    const r = rig();
    r.goal(0, 9);
    r.goal(0, 9);
    Object.assign(r.m, { phase: 'fulltime' });
    r.run(0.5, { busy: true, interlude: 'sportsmanship' });
    expect(r.shown.filter((c) => c.kind === 'matchball')).toHaveLength(0);
    const h = rig();
    for (let i = 0; i < 3; i++) h.goal(0, 9);
    Object.assign(h.m, { phase: 'fulltime' });
    h.run(0.5, { busy: true, interlude: 'sportsmanship' });
    expect(h.show.state.kind).toBe('matchball');
    expect(h.shown.at(-1)?.cast[0].def.id).toBe('p9');
    expect(h.shown.at(-1)?.cast).toHaveLength(3);
    h.run(1, { interlude: 'award' });
    expect(h.show.state.kind).toBe('');
  });

  it('every one is 3 s or under, has a tag with no dots, dashes or hyphens, and never puts anyone at a NaN', () => {
    expect(SIDE_S).toBeLessThanOrEqual(3);
    const ps = Array.from({ length: PUPPET_MAX }, newPose);
    const v = new Float32Array(PROP_MAX * PROP_F);
    for (const kind of Object.keys(SIDE_LABEL) as SideKind[]) {
      expect(SIDE_LABEL[kind]).toMatch(/^[A-Z ]+$/);
      expect(SIDE_CAPS[kind]).toBeGreaterThan(0);
      for (const mood of ['joy', 'groan'] as SideMood[]) {
        for (let variant = 0; variant < 6; variant++) {
          for (let t = 0; t <= 3.6; t += 0.15) {
            sidePose(kind, mood, variant, t, kind === 'box' || kind === 'fans' || kind === 'dugout' ? t - 1 : t, ps, v);
            expect(ps.filter((p) => p.on)).toHaveLength(SIDE_CAST[kind]);
            for (const p of ps) for (const n of Object.values(p)) if (typeof n === 'number') expect(Number.isFinite(n)).toBe(true);
            for (const n of v) expect(Number.isFinite(n)).toBe(true);
          }
        }
      }
    }
    for (const line of Object.values(BIG_LINE)) expect(line).toMatch(/^[A-Z ]+$/);
    // The popcorn: in his lap while he watches, in the air when they score.
    sidePose('fans', 'joy', 0, 1, -1, ps, v);
    const lap = v[FAN_BUCKET * PROP_F + 1];
    sidePose('fans', 'joy', 0, 2, 0.5, ps, v);
    expect(v[FAN_BUCKET * PROP_F + 1]).toBeGreaterThan(lap + 1);
  });
});
