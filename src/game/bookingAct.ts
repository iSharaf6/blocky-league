import { PF, STATE_CODE } from './replay';
import { SCENE_STYLE } from './scenePoses';

/** A brief comic overreaction belongs to the yellow-card picture, never the player's actual injury/state. */
export const BOOKING_ACT_S = 1.8;
export function applyBookingAct(f: Float32Array, idx: number, x: number, z: number, facing: number, age: number): void {
  const o = idx * PF;
  f[o] = x; f[o + 1] = z; f[o + 2] = 0; f[o + 3] = facing;
  f[o + 4] = STATE_CODE.celebrate; f[o + 5] = Math.max(0, age);
  f[o + 6] = 0; f[o + 7] = 0;
  f[o + 8] = Math.max(0, Math.min(1, age / BOOKING_ACT_S));
  f[o + 10] = 0; f[o + 12] = 0; f[o + 13] = SCENE_STYLE.ouch; f[o + 14] = 0;
}
