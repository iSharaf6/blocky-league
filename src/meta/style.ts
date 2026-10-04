import type { SaveData } from '../core/save';
import { contrastAwayKit } from '../game/kitContrast';
import { designKit, type LookSet, type StyledKit } from '../render/kitDesigns';
import { overall, type Kit, type TeamDef } from '../sim/types';
import { grassSafeKit, resolveKitClash } from './data';
import { equippedId, equippedSlots } from './shop';

/**
 * COSMETICS 2.0 in a match: the human's side wears its premium kit, its player looks and (at home) its stadium style.
 * Pure: main.ts dresses the match request with it, ui/shopStage.ts the TRY IT ON line-up.
 *
 * Readability first. The kits that clash are fixed on the OTHER side (the AI's change strip, as before), so the kit you
 * bought is the kit you play in, and the two sides still read apart from the gantry (game/kitContrast.ts); the fixed
 * blue and red rings and the colour-blind shapes under the players are untouched. Online friendlies never get any of
 * it (both screens must show the same strips), and nothing here changes play.
 */

/** Your captain: the best outfield player in the XI (he wears the hair, headgear and armband looks). */
export function captainOf(team: Pick<TeamDef, 'players'>): string | undefined {
  let best: TeamDef['players'][number] | undefined;
  for (const p of team.players.slice(0, 11)) if (p.role !== 'GK' && (!best || overall(p) > overall(best))) best = p;
  return best?.id;
}

/** The looks worn (owned and equipped), as the renderer reads them; undefined when none. */
export function looksOf(save: Pick<SaveData, 'shop' | 'progress' | 'settings'>): LookSet | undefined {
  const l = equippedSlots(save, 'look');
  return Object.keys(l).length ? (l as LookSet) : undefined;
}

/** A side's kit dressed in the save's premium kit and looks (`kitId` / `looks` override what is equipped: the shop's try on). */
export function styleSide(
  save: Pick<SaveData, 'shop' | 'progress' | 'settings'>, kit: Kit, team: Pick<TeamDef, 'players'>,
  kitId: string = equippedId(save, 'kit'), looks: LookSet | undefined = looksOf(save),
): StyledKit {
  const k = designKit(kitId, kit);
  if (looks) {
    k.looks = { ...looks };
    k.captain = captainOf(team);
  }
  return k;
}

/**
 * The kits for a match the save's player plays on `humanSide`: his side styled, the other side's strip changed if it
 * would clash with it (grass first, then the colour clash, then lightness: the same checks the session runs, so it
 * finds nothing left to change on the human's side).
 */
export function styleMatch(
  save: Pick<SaveData, 'shop' | 'progress' | 'settings'>, kits: readonly [Kit, Kit], teams: readonly [Pick<TeamDef, 'players'>, Pick<TeamDef, 'players'>], humanSide: number,
): [Kit, Kit] {
  if (humanSide !== 0 && humanSide !== 1) return [kits[0], kits[1]];
  const me = styleSide(save, kits[humanSide], teams[humanSide]);
  const plain = !me.design && !me.looks;
  if (plain) return [kits[0], kits[1]];
  const ai = contrastAwayKit(me, resolveKitClash(me, grassSafeKit(kits[1 - humanSide])));
  return humanSide === 0 ? [me, ai] : [ai, me];
}

/** Stadium style for a home match: the decor slots worn and what they're drawn in (render/stadiumStyle.ts). */
export interface DecorStyle {
  slots: { [slot: string]: string };
  /** The club's colours (nets, flags, tifo, lights) and short name (the seats). */
  shirt: number;
  shirt2: number;
  short: string;
}

/** The save's stadium style for its club (`kit`, `short`), or null when nothing is worn. */
export function decorOf(save: Pick<SaveData, 'shop' | 'progress' | 'settings'>, kit: Kit, short: string): DecorStyle | null {
  const slots = equippedSlots(save, 'decor');
  if (!Object.keys(slots).length) return null;
  const two = kit.shirt2 === kit.shirt ? (kit.shirt === 0xfbfbf4 ? 0x26262e : 0xfbfbf4) : kit.shirt2;
  return { slots, shirt: kit.shirt, shirt2: two, short: (short || 'BLK').toUpperCase().slice(0, 4) };
}
