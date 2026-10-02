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
};

/** The speed-line colours for a trail id (an unknown id, or none: the chalk white). */
export function trailColors(id: string | undefined): readonly number[] {
  return (TRAIL_COLORS as { readonly [k: string]: readonly number[] | undefined })[id ?? ''] ?? TRAIL_COLORS.white;
}
