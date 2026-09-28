// World units are metres and seconds. +x runs along the pitch length, +z across it
// (towards the broadcast camera), +y is up.

export const DT = 1 / 60;

// Pitch — a little shorter than regulation so the chunky voxel squads feel busy.
export const PITCH_L = 96;
export const PITCH_W = 60;
export const HALF_L = PITCH_L / 2;
export const HALF_W = PITCH_W / 2;
export const GOAL_W = 7.6;
export const GOAL_H = 2.6;
export const GOAL_DEPTH = 2.2;
export const BOX_DEPTH = 15;
export const BOX_W = 36;
export const SIX_DEPTH = 5;
export const SIX_W = 17;
export const PEN_SPOT = 10;
export const CENTER_R = 8.4;
export const POST_R = 0.09;

// Ball
export const BALL_R = 0.22;
export const GRAVITY = 11.5;
export const AIR_DRAG = 0.0105; // quadratic: a = k * |v| * v
export const ROLL_A = 2.3; // constant rolling deceleration
export const ROLL_B = 0.3; // speed-proportional rolling deceleration
export const BOUNCE = 0.56;
export const MAGNUS = 0.022;
export const SPIN_DECAY = 0.7;

/**
 * Arcade tempo (round 9, the owner: "the gameplay is very very slow"). Everything that sets the pace of a
 * match scales by it: the players' jog / sprint / acceleration and how fast they turn (player.ts), the pace
 * of ground passes (actions.ts), the AI's think times and how long it holds the ball (ai.ts), the dead-ball
 * waits and the keeper's hold (match.ts). 1 is the round-8 game; the human's relative edge (HUMAN_ACCEL,
 * HUMAN_TURN in player.ts) rides on top of it. Tune it here; the AI-vs-AI bands in tests/metrics.test.ts
 * are retuned to it.
 */
export const TEMPO = 1.15;
/** Shots scale by less than the players (the keeper's reaction isn't scaled): half the tempo's step. */
export const SHOT_TEMPO = 1 + (TEMPO - 1) * 0.5;

// Players
export const PLAYER_R = 0.42;
/** Body separation between opponents (the voxel models are ~1 m across) and between teammates. */
export const SEP_OPP = 1.05;
export const SEP_MATE = 0.9;
/** Wall distance for free kicks (ten yards). */
export const WALL_DIST = 9.15;
export const JOG_SPEED = 5.6 * TEMPO;
export const SPRINT_SPEED = 8.0 * TEMPO;
export const ACCEL = 17 * TEMPO;
export const DECEL = 22 * TEMPO;
export const DRIBBLE_MULT = 0.9;
export const CONTROL_R = 0.78;
export const KICK_WINDUP = 0.11;
export const STRIDE = 1.05; // metres per full run cycle / 2

export const PLAYERS_PER_TEAM = 11;

/**
 * Dynamic difficulty (MatchConfig.assist, 0..1; Match.assistEase): at full assist the AI's press and chase slides on the
 * human's carrier are DDA_PRESS less keen, its tackles on him DDA_TACKLE less sure and its finishing at his goal
 * DDA_FINISH wilder (0.5 is about a menu notch easier). Against the human side only; AI v AI never.
 */
export const DDA_PRESS = 0.6;
export const DDA_TACKLE = 0.45;
export const DDA_FINISH = 0.7;
/** Club Run's sharper keeper (MatchConfig.keeperBoost, 0..1): this much on his keeperBonus (reach, reactions) at 1. */
export const KEEPER_BOOST = 0.06;
