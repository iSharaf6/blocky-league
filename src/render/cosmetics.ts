import type { GoalFxId, TrailId } from '../core/save';

/**
 * How the SHOP's match cosmetics look (src/meta/shop.ts sells them; core/save.ts lists the ids). Pure palettes,
 * read by the match session (game/matchSession.ts: the goal burst and confetti, the sprint speed lines) and by
 * the shop's own previews, so what the shop shows is exactly what the match draws.
 */

/** Goal explosion themes: the burst out of the goal mouth and the confetti, for your side's goals. */
export const GOAL_FX_COLORS: { readonly [k in Exclude<GoalFxId, 'club'>]: readonly number[] } = {
  gold: [0xffd23a, 0xffb300, 0xfff0b0, 0xfbfbf4],
  fire: [0xffe45c, 0xff9a1f, 0xff4a1a, 0xd8241a],
  ice: [0xe6f7ff, 0xa8e4ff, 0x5cc8f5, 0x2f7be8],
  neon: [0xb8ff3c, 0xff3cf0, 0x3cf7ff, 0xfff23c],
  rainbow: [0xec4a3e, 0xff8a2a, 0xffd23a, 0x3cc15a, 0x2f7be8, 0x8a5cf6],
  galaxy: [0x8a5cf6, 0x2230d6, 0xff3cf0, 0xfbfbf4, 0x5cc8f5],
  // Legendary (meta/shop.ts LEGENDARY prices).
  diamond: [0xffffff, 0xe0f9ff, 0xa8ecff, 0x6fd4ff, 0xfbfbf4],
  supernova: [0xffffff, 0xfff6a8, 0xffd23a, 0xff5cf0, 0x8a5cf6, 0x2230d6],
  // Club Pass, one per season theme (January first: core/save.ts PASS_IDS, meta/season.ts SEASON_THEMES).
  pass01: [0xffffff, 0xd6f3ff, 0x5cc8f5, 0x2f7be8],
  pass02: [0xc98a5a, 0x8a5a36, 0x5a3a20, 0xf4e1c6],
  pass03: [0xd9ffb8, 0x7ae05a, 0x3cc15a, 0xfbfbf4],
  pass04: [0xd6e6ff, 0x5c9cff, 0x2f7be8, 0x1b3fa8],
  pass05: [0xfff0b0, 0xffd23a, 0xe0b23a, 0xfbfbf4],
  pass06: [0xffe0b8, 0xffb35c, 0xff8a2b, 0xffd23a],
  pass07: [0xffd2a8, 0xff6a3c, 0xec4a3e, 0xb8241a],
  pass08: [0xc2fff6, 0x4fe0cc, 0x1fb3a6, 0xfbfbf4],
  pass09: [0xfff0b0, 0xe8c23a, 0xc7970f, 0x8a5a36],
  pass10: [0xe6d6ff, 0xb08cff, 0x8a55d8, 0xfff6a8],
  pass11: [0xffe45c, 0xff9a1f, 0xe8443a, 0x26262e],
  pass12: [0xffffff, 0xc8d6ff, 0x5c7ad8, 0x223a78],
};

/**
 * The colours a goal of yours explodes in: the theme's, or (no theme, 'club' or an id this build doesn't know)
 * `club`, the scorer's kit colours.
 */
export function goalFxColors(id: string | undefined, club: readonly number[]): readonly number[] {
  return (GOAL_FX_COLORS as { readonly [k: string]: readonly number[] | undefined })[id ?? ''] ?? club;
}

/** Sprint speed lines for your side's players ('white' is the match's own chalk streak). */
export const TRAIL_COLORS: { readonly [k in TrailId]: readonly number[] } = {
  white: [0xf4f4ea],
  fire: [0xffe45c, 0xff9a1f, 0xff4a1a],
  ice: [0xe6f7ff, 0x8fe3ff, 0x5cc8f5],
  lime: [0xb8ff3c, 0x4bff6a],
  pink: [0xff7ad9, 0xff3c9e, 0xffc2ee],
  gold: [0xffd23a, 0xfff0b0, 0xffb300],
  rainbow: [0xec4a3e, 0xff8a2a, 0xffd23a, 0x3cc15a, 0x2f7be8, 0x8a5cf6],
  // Legendary.
  lightning: [0xffffff, 0xfff23c, 0x8fe3ff, 0xfff23c],
  comet: [0xffffff, 0xffd23a, 0xff9a1f, 0x8a5cf6, 0x2230d6],
  // Club Pass, one per season theme (as GOAL_FX_COLORS).
  pass01: [0xffffff, 0x8fe3ff, 0x5cc8f5],
  pass02: [0xc98a5a, 0x8a5a36, 0xf4e1c6],
  pass03: [0xd9ffb8, 0x3cc15a, 0x7ae05a],
  pass04: [0xd6e6ff, 0x5c9cff, 0x2f7be8],
  pass05: [0xfff0b0, 0xffd23a, 0xe0b23a],
  pass06: [0xffe0b8, 0xff8a2b, 0xffd23a],
  pass07: [0xffd2a8, 0xec4a3e, 0xff6a3c],
  pass08: [0xc2fff6, 0x1fb3a6, 0x4fe0cc],
  pass09: [0xfff0b0, 0xc7970f, 0xe8c23a],
  pass10: [0xe6d6ff, 0x8a55d8, 0xb08cff],
  pass11: [0xffe45c, 0xff9a1f, 0xe8443a],
  pass12: [0xffffff, 0x5c7ad8, 0xc8d6ff],
};

/** The speed-line colours for a trail id (an unknown id, or none: the chalk white). */
export function trailColors(id: string | undefined): readonly number[] {
  return (TRAIL_COLORS as { readonly [k: string]: readonly number[] | undefined })[id ?? ''] ?? TRAIL_COLORS.white;
}
