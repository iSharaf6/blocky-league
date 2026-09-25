export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential approach. `rate` is 1/seconds. */
export function damp(a: number, b: number, rate: number, dt: number): number {
  return b + (a - b) * Math.exp(-rate * dt);
}

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function angleDiff(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** Rotate `from` toward `to` by at most `maxStep` radians. */
export function turnToward(from: number, to: number, maxStep: number): number {
  const d = angleDiff(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return wrapAngle(from + Math.sign(d) * maxStep);
}

export function dampAngle(a: number, b: number, rate: number, dt: number): number {
  return wrapAngle(a + angleDiff(a, b) * (1 - Math.exp(-rate * dt)));
}

export function len2(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Distance from point P to segment AB on the ground plane, plus the projection t in [0,1]. */
export function pointSegDist(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
): { d: number; t: number } {
  const abx = bx - ax;
  const abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 1e-9 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return { d: dist2(px, pz, cx, cz), t };
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
