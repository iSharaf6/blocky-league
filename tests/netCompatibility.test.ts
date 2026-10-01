import { describe, expect, it } from 'vitest';
import { stateHash } from '../src/net/hash';
import { OnlineLink, type PeerInfo } from '../src/net/link';
import { cleanControls, NET_VERSION } from '../src/net/setup';
import type { NetData, Transport } from '../src/net/transport';
import { BALL_R, DT, HALF_L } from '../src/sim/constants';
import { EMPTY_PAD, Match, type Pad } from '../src/sim/match';
import type { KickOrder } from '../src/sim/player';
import type { Side } from '../src/sim/types';
import { netConfig } from './netHarness';
import { testSetup } from './netSim';

describe('loose-strike desync detection', () => {
  const pair = () => [0, 1].map((humanSide) => new Match(netConfig({
    seed: 47, humanSide: humanSide as 0 | 1, humanSides: [true, true],
  })));
  const queued = (): KickOrder => ({
    kind: 'shot', dirX: 0, dirZ: 0, power: 0.9, target: -1, expires: 1.5,
    firstTime: true, looseStrike: 12,
  });
  const active = (m: Match) => m.players[m.ctl[0].active];

  it('hashes the same queue identically from either local side', () => {
    const [a, b] = pair();
    active(a).order = queued();
    active(b).order = queued();
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it('detects a missing queue before either peer moves or touches the ball', () => {
    const [a, b] = pair();
    expect(stateHash(a)).toBe(stateHash(b));
    active(a).order = queued();
    expect(stateHash(a)).not.toBe(stateHash(b));
  });

  it.each<Partial<KickOrder>>([
    { looseStrike: 13 }, { expires: 1.6 }, { power: 0.8 }, { dirX: 1 }, { dirZ: -1 },
    { firstTime: false }, { kind: 'lob' }, { aimX: 5 }, { aimZ: 2 }, { finish: 0.4 },
  ])('detects future-contact differences %j', (change) => {
    const [a, b] = pair();
    active(a).order = queued();
    active(b).order = { ...queued(), ...change };
    expect(stateHash(a)).not.toBe(stateHash(b));
  });

  it('keeps older unbound-order state hashes unchanged', () => {
    const [a, b] = pair();
    const { looseStrike: _flight, ...order } = queued();
    active(a).order = order;
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it.each<Side>([0, 1])('queues and strikes side %i\'s rebound identically from both local views', (side) => {
    const [a, b] = pair();
    let striker = -1;
    for (const m of [a, b]) {
      const p = m.players.find((q) => q.side === side && !q.isKeeper)!;
      striker = p.idx;
      for (const q of m.players) {
        q.sentOff = q !== p;
        q.order = null;
        q.setState('move');
        q.pos.x = 0;
        q.pos.z = 25;
        q.vel.x = q.vel.z = 0;
      }
      m.phase = 'play';
      m.restart = null;
      m.ctl[side].active = p.idx;
      m.ctl[side].timedFinish = false;
      const ad = m.attackDir(side);
      p.pos.x = ad * (HALF_L - 12);
      p.pos.z = 0;
      p.facing = ad > 0 ? 0 : Math.PI;
      Object.assign(m.ball.pos, { x: ad * (HALF_L - 6), y: BALL_R + 0.02, z: 0 });
      Object.assign(m.ball.vel, { x: -ad * 9, y: 0, z: 0 });
      Object.assign(m.ball, { owner: -1, held: false, lastTouch: m.players.find((q) => q.side !== side && q.isKeeper)!.idx, lastTouchSide: 1 - side });
      m.kickId = m.shotKick = 17;
      m.shotSide = side;
      m.shotClock = 0.2;
      m.passTarget = -1;
    }
    let struck = false;
    for (let tick = 0; tick < 120 && !struck; tick++) {
      // The local HUD may poll more often than the remote peer renders. Hints must never alter the sim.
      const local = side === 0 ? a : b;
      for (let poll = 0; poll < 5; poll++) local.canStrikeLoose();
      const pads: [Pad, Pad] = [{ ...EMPTY_PAD }, { ...EMPTY_PAD }];
      pads[side].shoot = tick === 0;
      a.step(DT, pads);
      b.step(DT, pads);
      expect(stateHash(a), `side ${side}, tick ${tick}`).toBe(stateHash(b));
      const ae = a.drainEvents();
      expect(b.drainEvents()).toEqual(ae);
      if (tick === 0) {
        expect(a.players[striker].order).toMatchObject({ looseStrike: 17, firstTime: true, power: 0.9 });
        expect(b.players[striker].order).toEqual(a.players[striker].order);
      }
      struck = ae.some((e) => e.type === 'kick' && e.kind === 'shot' && e.player === striker && e.firstTime && e.power === 0.9);
    }
    expect(struck).toBe(true);
  });
});

describe('online physics compatibility', () => {
  class TestTransport implements Transport {
    readonly kind = 'loopback' as const;
    readonly open = true;
    onMessage: ((data: NetData) => void) | null = null;
    onClose: ((reason: string) => void) | null = null;
    sent: NetData[] = [];
    send(data: NetData): void { this.sent.push(data); }
    close(): void { this.onClose?.('closed'); }
    receive(data: unknown): void { this.onMessage?.(JSON.stringify(data)); }
  }
  const me = (club: number): PeerInfo => ({ name: 'PLAYER', club, controls: cleanControls(undefined), ready: true });

  it('announces and accepts the current physics version', () => {
    const tx = new TestTransport();
    const link = new OnlineLink(tx, 'host', me(5), '1.0.0');
    expect(JSON.parse(tx.sent[0] as string)).toMatchObject({ t: 'hello', v: NET_VERSION });
    tx.receive({ t: 'hello', v: NET_VERSION, app: '1.0.0', me: me(6) });
    expect(link.error).toBeNull();
    expect(link.canStart).toBe(true);
  });

  it('refuses the old pre-rebound physics build', () => {
    expect(NET_VERSION).toBeGreaterThan(1);
    const tx = new TestTransport();
    const link = new OnlineLink(tx, 'host', me(5), '1.0.0');
    tx.receive({ t: 'hello', v: 1, app: '1.0.0', me: me(6) });
    expect(link.error).toContain('different versions');
    expect(link.gone).toBe(true);
    expect(link.canStart).toBe(false);
  });

  it('cannot start from delayed lobby packets after rejecting a version', () => {
    const tx = new TestTransport();
    const link = new OnlineLink(tx, 'guest', me(6), '1.0.0');
    let started = false;
    link.onStart = () => { started = true; };
    tx.receive({ t: 'hello', v: NET_VERSION - 1, app: '1.0.0', me: me(5) });
    tx.receive({ t: 'me', me: me(5) });
    tx.receive({ t: 'start', setup: testSetup() });
    expect(started).toBe(false);
    expect(link.setup).toBeNull();
    expect(link.peer).toBeNull();
  });
});
