import { Rng } from '../core/rng';
import { BALL_R, HALF_L } from './constants';
import type { Match } from './match';

export const WEATHER_KINDS = ['clear', 'overcast', 'drizzle', 'rain', 'snow', 'blizzard'] as const;
export type WeatherKind = typeof WEATHER_KINDS[number];
export function isWeather(v: unknown): v is WeatherKind { return WEATHER_KINDS.includes(v as WeatherKind); }
export const wetWeather = (v: WeatherKind | undefined): boolean => v === 'rain' || v === 'drizzle';
export const snowyWeather = (v: WeatherKind | undefined): boolean => v === 'snow' || v === 'blizzard';

export interface WetPatch { x: number; z: number; rx: number; rz: number }
/** Visible puddles, mirrored between halves and kept out of penalty areas. The separate seed never advances match RNG. */
export function wetPatches(kind: WeatherKind | undefined, seed = 12345): WetPatch[] {
  if (!wetWeather(kind)) return [];
  const rng = new Rng((seed ^ 0x574554) >>> 0);
  const patches: WetPatch[] = [];
  for (let i = 0; i < (kind === 'drizzle' ? 2 : 3); i++) {
    const x = 7 + rng.next() * (HALF_L - 27);
    const z = (i - 1) * 10 + (rng.next() - 0.5) * 3;
    const p = { x, z, rx: 2.1 + rng.next() * 0.7, rz: 1.3 + rng.next() * 0.5 };
    patches.push(p, { ...p, x: -x, z: -z });
  }
  return patches;
}
export function inWetPatch(patches: readonly WetPatch[], x: number, z: number): boolean {
  return patches.some((p) => ((x - p.x) / p.rx) ** 2 + ((z - p.z) / p.rz) ** 2 < 1);
}
/** Only a hard sprint reversal on a marked puddle slips. Jogging, straight runs, skills and ball strikes stay dependable. */
export function weatherStep(m: Match, dt: number): void {
  if (!wetWeather(m.cfg.weather)) return;
  for (const p of m.players) {
    p.wetSlipT = Math.max(0, p.wetSlipT - dt);
    if (m.phase !== 'play' || p.isKeeper || p.sentOff || p.state !== 'move' || p.order || p.protectT > 0 || p.wetSlipT > 0 || !p.sprint) continue;
    const move = m.ctl[p.side].skill.move;
    if (move?.player === p.idx && move.t < move.dur) continue;
    const speed = p.speed(), intent = Math.hypot(p.wantX, p.wantZ);
    if (speed < 6.5 || intent < 0.5 || (p.vel.x * p.wantX + p.vel.z * p.wantZ) / (speed * intent) > -0.15) continue;
    if (!inWetPatch(m.wetPatches, p.pos.x, p.pos.z)) continue;
    p.wetSlipT = 9;
    p.setState('fallen');
    p.stateT = 0.72; // A quick skid and get-up, not the long recovery from being scythed down.
    p.order = null;
    p.kickCooldown = Math.max(p.kickCooldown, 0.6);
    p.vel.x *= 0.55;
    p.vel.z *= 0.55;
    if (m.ball.owner === p.idx && !m.ball.held) {
      m.ball.owner = -1;
      m.ball.pos.y = BALL_R;
      m.ball.vel.x = p.vel.x;
      m.ball.vel.z = p.vel.z;
      m.ball.vel.y = 0.35;
      m.passTarget = -1;
    }
    m.events.push({ type: 'slip', player: p.idx });
  }
}
