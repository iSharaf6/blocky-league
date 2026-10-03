import type { GoalFxId, TrailId } from '../core/save';

/**
 * The SHOP's match cosmetics (src/meta/shop.ts sells them; core/save.ts lists the ids). Each goal explosion and
 * trail is its own effect, scripted in render/fx/goals.ts and render/fx/trails.ts; these are the palettes they
 * draw in (tintable props: balloons, confetti, lasers, hearts...), also used for the shop's purchase burst and
 * its flat tiles where there is no WebGL. The match (game/matchSession.ts) and the shop's showcase
 * (ui/shopStage.ts) draw the same effects with the same colours.
 */

/** Goal explosion palettes ('club' is the scorer's kit colours: goalFxColors). */
export const GOAL_FX_COLORS: { readonly [k in Exclude<GoalFxId, 'club'>]: readonly number[] } = {
  // Gold Rush: coins and glints.
  gold: [0xffd23a, 0xffb300, 0xfff0b0, 0xfbfbf4],
  // Inferno: flame jets.
  fire: [0xffe45c, 0xff9a1f, 0xff4a1a, 0xd8241a],
  // Frostbite: the ice wall.
  ice: [0xe6f7ff, 0xa8e4ff, 0x5cc8f5, 0x2f7be8],
  // Disco: lasers and dance floor.
  neon: [0xb8ff3c, 0xff3cf0, 0x3cf7ff, 0xfff23c],
  // Rainbow: the arch's bands, outside in.
  rainbow: [0xec4a3e, 0xff8a2a, 0xffd23a, 0x3cc15a, 0x2f7be8, 0x8a5cf6],
  // Black Hole: the vortex and its stars.
  galaxy: [0x8a5cf6, 0x2230d6, 0xff3cf0, 0xfbfbf4, 0x5cc8f5],
  // Legendary (meta/shop.ts LEGENDARY prices).
  diamond: [0xffffff, 0xe0f9ff, 0xa8ecff, 0x6fd4ff, 0xfbfbf4],
  supernova: [0xffffff, 0xfff6a8, 0xffd23a, 0xff5cf0, 0x8a5cf6, 0x2230d6],
  shockwave: [0xfbfbf4, 0x8fe3ff, 0x5cc8f5],
  balloons: [0xec4a3e, 0xffd23a, 0x2f7be8, 0x3cc15a, 0xff7ad9, 0xff8a2b, 0x8a5cf6],
  confetti: [0xff3c9e, 0xffd23a, 0x3cf7ff, 0x7ae05a, 0xff8a2b, 0xb08cff],
  popcorn: [0xfffaf0, 0xec4a3e, 0xffd23a, 0xf6e2b0],
  pinata: [0xff5c9e, 0xffd23a, 0x3cf7ff, 0x7ae05a, 0xff8a2b, 0xb08cff],
  fireworks: [0xff3c5c, 0xffd23a, 0x3cc8ff, 0x7ae05a, 0xff7ad9, 0xffffff],
  volcano: [0xff9a1f, 0xff4a1a, 0xffd23a, 0x4a2a1e],
  lightning: [0x8fe3ff, 0xfff23c, 0xffffff],
  meteor: [0xff7a1a, 0xffd23a, 0xff4a1a, 0x5a4a44],
  // Club Pass, one per season theme (January first: core/save.ts PASS_IDS, meta/season.ts SEASON_THEMES).
  pass01: [0xffffff, 0xd6f3ff, 0x5cc8f5, 0x2f7be8],
  pass02: [0xc98a5a, 0x8a5a36, 0x5a3a20, 0xf4e1c6],
  pass03: [0xff8ad0, 0xffd23a, 0xfbfbf4, 0xb08cff, 0x7ae05a],
  pass04: [0xd6e6ff, 0x5c9cff, 0x2f7be8, 0x1b3fa8],
  pass05: [0xfff0b0, 0xffd23a, 0xe0b23a, 0xfbfbf4],
  pass06: [0xffe0b8, 0xffb35c, 0xff8a2b, 0xffd23a],
  pass07: [0xffd2a8, 0xff6a3c, 0xec4a3e, 0xffd23a],
  pass08: [0xc2fff6, 0x4fe0cc, 0x1fb3a6, 0xfbfbf4],
  pass09: [0xfff0b0, 0xe8c23a, 0xc7970f, 0x8a5a36],
  pass10: [0xe6d6ff, 0xb08cff, 0x8a55d8, 0xfff6a8],
  pass11: [0xffe45c, 0xff9a1f, 0xe8443a, 0xfff0b0],
  pass12: [0xec4a3e, 0x3cc15a, 0xffd23a, 0x5c7ad8, 0xffffff],
};

/**
 * The colours a goal of yours explodes in: the theme's, or (no theme, 'club' or an id this build doesn't know)
 * `club`, the scorer's kit colours.
 */
export function goalFxColors(id: string | undefined, club: readonly number[]): readonly number[] {
  return (GOAL_FX_COLORS as { readonly [k: string]: readonly number[] | undefined })[id ?? ''] ?? club;
}

/** Trail palettes ('white' is the match's own chalk speed lines). */
export const TRAIL_COLORS: { readonly [k in TrailId]: readonly number[] } = {
  white: [0xf4f4ea],
  fire: [0xffe45c, 0xff9a1f, 0xff4a1a],
  ice: [0xe6f7ff, 0x8fe3ff, 0x5cc8f5],
  lime: [0x7ae05a, 0xb8ff3c, 0x3cc15a, 0x4bff6a],
  pink: [0xff7ad9, 0xff3c9e, 0xffc2ee, 0xb8e8ff],
  gold: [0xffd23a, 0xfff0b0, 0xffb300],
  rainbow: [0xec4a3e, 0xff8a2a, 0xffd23a, 0x3cc15a, 0x2f7be8, 0x8a5cf6],
  // Legendary.
  lightning: [0x8fe3ff, 0xfff23c, 0xffffff],
  comet: [0xffffff, 0xffd23a, 0xff9a1f, 0x8a5cf6, 0x2230d6],
  toon: [0x26262e, 0xffd23a, 0xff3c5c],
  hearts: [0xff3c5c, 0xff7ad9, 0xec4a3e, 0xffc2ee],
  popcorn: [0xfffaf0, 0xffd23a, 0xec4a3e],
  notes: [0xff3c9e, 0x3cc8ff, 0xffd23a, 0x7ae05a, 0xb08cff],
  glitch: [0x3cf7ff, 0xff3cf0, 0xfff23c, 0xffffff],
  // Club Pass, one per season theme (as GOAL_FX_COLORS).
  pass01: [0xffffff, 0x8fe3ff, 0x5cc8f5],
  pass02: [0xc98a5a, 0x8a5a36, 0xf4e1c6],
  pass03: [0xff8ad0, 0xffd23a, 0xfbfbf4, 0xb08cff],
  pass04: [0xd6e6ff, 0x5c9cff, 0x2f7be8],
  pass05: [0xfff0b0, 0xffd23a, 0xe0b23a],
  pass06: [0xffe0b8, 0xff8a2b, 0xffd23a],
  pass07: [0xffd2a8, 0xec4a3e, 0xff6a3c],
  pass08: [0xc2fff6, 0x1fb3a6, 0x4fe0cc],
  pass09: [0xfff0b0, 0xc7970f, 0xe8c23a],
  pass10: [0xe6d6ff, 0x8a55d8, 0xb08cff],
  pass11: [0xffe45c, 0xff9a1f, 0xe8443a],
  pass12: [0xec4a3e, 0x3cc15a, 0xffd23a, 0x5c7ad8],
};

/** The palette for a trail id (an unknown id, or none: the chalk white). */
export function trailColors(id: string | undefined): readonly number[] {
  return (TRAIL_COLORS as { readonly [k: string]: readonly number[] | undefined })[id ?? ''] ?? TRAIL_COLORS.white;
}
