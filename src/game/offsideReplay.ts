/** Advance recorded footage through one offside decision hold, preserving unused time at either boundary. */
export function advanceOffsideReplay(frame: number, dt: number, release: number, froze: boolean, remaining: number, hold: number) {
  let entered = false;
  let resumed = false;
  let moving = dt;
  if (!froze) {
    const beforeRelease = Math.max(0, (release - frame) / 60);
    if (dt < beforeRelease) return { frame: frame + dt * 60, froze, remaining: 0, entered, resumed, frozen: false, moving: dt };
    frame = release;
    froze = true;
    remaining = hold;
    moving = dt - beforeRelease;
    entered = true;
  }
  if (remaining > 0) {
    const held = Math.min(remaining, moving);
    remaining = Math.max(0, remaining - held);
    moving -= held;
    if (remaining <= 1e-9) {
      remaining = 0;
      resumed = true;
    }
  }
  const frozen = remaining > 0;
  return { frame: frozen ? release : frame + moving * 60, froze, remaining, entered, resumed, frozen, moving };
}
