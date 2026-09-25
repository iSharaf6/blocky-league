export type Side = 0 | 1;
export type Role = 'GK' | 'DF' | 'MF' | 'FW';
export type KitPattern = 'plain' | 'stripes' | 'hoops' | 'halves' | 'sash' | 'sleeves';
export type FormationId = '4-4-2' | '4-3-3' | '4-2-3-1' | '3-5-2' | '5-3-2';

export interface PlayerStats {
  pace: number; // 1..99
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  keeping: number;
  stamina: number;
}

export interface Look {
  skin: number; // index into palette.SKIN
  hair: number; // hair style index
  hairColor: number; // index into palette.HAIR
  beard: number; // 0 none
  boots: number; // hex colour
}

export interface PlayerDef {
  id: string;
  name: string;
  number: number;
  role: Role;
  stats: PlayerStats;
  look: Look;
}

export interface Kit {
  shirt: number;
  shirt2: number;
  pattern: KitPattern;
  shorts: number;
  socks: number;
  gk: number;
}

export interface TeamDef {
  id: string;
  name: string;
  short: string;
  kit: Kit;
  formation: FormationId;
  /** Starting XI in formation slot order (slot 0 is the keeper). */
  players: PlayerDef[];
  /** Substitutes available on the bench. */
  bench?: PlayerDef[];
}

export function overall(p: PlayerDef): number {
  const s = p.stats;
  switch (p.role) {
    case 'GK':
      return Math.round(s.keeping * 0.75 + s.pace * 0.05 + s.passing * 0.1 + s.defending * 0.1);
    case 'DF':
      return Math.round(s.defending * 0.45 + s.pace * 0.2 + s.passing * 0.15 + s.stamina * 0.1 + s.dribbling * 0.1);
    case 'MF':
      return Math.round(s.passing * 0.35 + s.dribbling * 0.2 + s.stamina * 0.15 + s.shooting * 0.1 + s.defending * 0.1 + s.pace * 0.1);
    case 'FW':
      return Math.round(s.shooting * 0.4 + s.pace * 0.25 + s.dribbling * 0.2 + s.passing * 0.1 + s.stamina * 0.05);
  }
}

export function teamRating(t: TeamDef): number {
  let sum = 0;
  for (const p of t.players) sum += overall(p);
  return Math.round(sum / t.players.length);
}

export type MatchEvent =
  | { type: 'kick'; power: number; x: number; y: number; z: number; kind: KickKind }
  | { type: 'goal'; side: Side; scorer: number; own: boolean }
  | { type: 'whistle'; kind: 'short' | 'long' | 'end' }
  | { type: 'post'; x: number; y: number; z: number; speed: number }
  | { type: 'save'; keeper: number; caught: boolean }
  | { type: 'tackle'; by: number; won: boolean; slide: boolean }
  | { type: 'bounce'; speed: number }
  | { type: 'net'; x: number; y: number; z: number; speed: number }
  | { type: 'ooh' }
  | { type: 'control'; player: number }
  | { type: 'halftime' }
  | { type: 'fulltime' }
  | { type: 'kickoffReady'; side: Side }
  | { type: 'foul'; by: number; on: number; penalty: boolean }
  | { type: 'sub'; side: Side; slot: number; on: string; off: string }
  /**
   * A booking. `red` sends the player off for the rest of the match (Player.sentOff); `second` marks a
   * red that came from a second yellow (show both cards).
   */
  | { type: 'card'; player: number; color: 'yellow' | 'red'; second?: boolean }
  | { type: 'skill'; player: number }
  | { type: 'setpiece'; kind: RestartKind; side: Side }
  | { type: 'restart'; kind: RestartKind; side: Side }
  /** A pass or shot cannoned off a defender. */
  | { type: 'block'; by: number; shot: boolean; x: number; z: number }
  /** Keeper came for a cross: caught it or punched it clear. */
  | { type: 'claim'; keeper: number; caught: boolean }
  /** A dribbler wrong-footed a defender. */
  | { type: 'beat'; by: number; on: number }
  /** One penalty of a shootout has been settled. */
  | { type: 'shootoutKick'; side: Side; taker: number; scored: boolean }
  /** The shootout (and the tie) is over. */
  | { type: 'shootoutEnd'; winner: Side }
  /**
   * Flag up: `player` (of the attacking `side`) was offside when the ball was played to him and
   * was first to it. An indirect free kick to the other side follows (a 'restart' freekick).
   */
  | { type: 'offside'; side: Side; player: number }
  /**
   * The referee plays advantage after a foul on `side` (the fouled team kept or won the ball back
   * in their attacking half): no free kick; any card for the foul is shown straight away.
   */
  | { type: 'advantage'; side: Side };

export type KickKind = 'pass' | 'through' | 'lob' | 'shot' | 'clear' | 'header' | 'throw' | 'keeper';
export type RestartKind = 'kickoff' | 'throwin' | 'corner' | 'goalkick' | 'freekick' | 'penalty';
