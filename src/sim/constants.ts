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

// Players
export const PLAYER_R = 0.42;
export const JOG_SPEED = 5.6;
export const SPRINT_SPEED = 8.0;
export const ACCEL = 17;
export const DECEL = 22;
export const DRIBBLE_MULT = 0.9;
export const CONTROL_R = 0.78;
export const KICK_WINDUP = 0.11;
export const STRIDE = 1.05; // metres per full run cycle / 2

export const PLAYERS_PER_TEAM = 11;
