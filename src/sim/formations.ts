import type { FormationId, Role } from './types';

/**
 * Formation slots in a normalised frame for a team attacking +x:
 * x ∈ [-1 own goal line, +1 opponent goal line], z ∈ [-1 left touchline, +1 right].
 * Slot 0 is always the keeper.
 */
export interface Slot {
  x: number;
  z: number;
  role: Role;
  label: string;
}

const S = (x: number, z: number, role: Role, label: string): Slot => ({ x, z, role, label });

export const FORMATIONS: Record<FormationId, Slot[]> = {
  '4-4-2': [
    S(-0.96, 0, 'GK', 'GK'),
    S(-0.62, -0.66, 'DF', 'LB'), S(-0.7, -0.22, 'DF', 'CB'), S(-0.7, 0.22, 'DF', 'CB'), S(-0.62, 0.66, 'DF', 'RB'),
    S(-0.22, -0.68, 'MF', 'LM'), S(-0.3, -0.2, 'MF', 'CM'), S(-0.3, 0.2, 'MF', 'CM'), S(-0.22, 0.68, 'MF', 'RM'),
    S(0.12, -0.18, 'FW', 'ST'), S(0.12, 0.18, 'FW', 'ST'),
  ],
  '4-3-3': [
    S(-0.96, 0, 'GK', 'GK'),
    S(-0.62, -0.66, 'DF', 'LB'), S(-0.7, -0.22, 'DF', 'CB'), S(-0.7, 0.22, 'DF', 'CB'), S(-0.62, 0.66, 'DF', 'RB'),
    S(-0.36, 0, 'MF', 'DM'), S(-0.2, -0.34, 'MF', 'CM'), S(-0.2, 0.34, 'MF', 'CM'),
    S(0.1, -0.62, 'FW', 'LW'), S(0.18, 0, 'FW', 'ST'), S(0.1, 0.62, 'FW', 'RW'),
  ],
  '4-2-3-1': [
    S(-0.96, 0, 'GK', 'GK'),
    S(-0.62, -0.66, 'DF', 'LB'), S(-0.7, -0.22, 'DF', 'CB'), S(-0.7, 0.22, 'DF', 'CB'), S(-0.62, 0.66, 'DF', 'RB'),
    S(-0.38, -0.2, 'MF', 'DM'), S(-0.38, 0.2, 'MF', 'DM'),
    S(-0.08, -0.6, 'MF', 'LM'), S(-0.04, 0, 'MF', 'AM'), S(-0.08, 0.6, 'MF', 'RM'),
    S(0.2, 0, 'FW', 'ST'),
  ],
  '3-5-2': [
    S(-0.96, 0, 'GK', 'GK'),
    S(-0.7, -0.36, 'DF', 'CB'), S(-0.74, 0, 'DF', 'CB'), S(-0.7, 0.36, 'DF', 'CB'),
    S(-0.3, -0.76, 'MF', 'LWB'), S(-0.38, -0.2, 'MF', 'CM'), S(-0.24, 0, 'MF', 'AM'), S(-0.38, 0.2, 'MF', 'CM'), S(-0.3, 0.76, 'MF', 'RWB'),
    S(0.12, -0.18, 'FW', 'ST'), S(0.12, 0.18, 'FW', 'ST'),
  ],
  '5-3-2': [
    S(-0.96, 0, 'GK', 'GK'),
    S(-0.56, -0.74, 'DF', 'LWB'), S(-0.72, -0.34, 'DF', 'CB'), S(-0.76, 0, 'DF', 'CB'), S(-0.72, 0.34, 'DF', 'CB'), S(-0.56, 0.74, 'DF', 'RWB'),
    S(-0.34, -0.36, 'MF', 'CM'), S(-0.38, 0, 'MF', 'CM'), S(-0.34, 0.36, 'MF', 'CM'),
    S(0.1, -0.2, 'FW', 'ST'), S(0.1, 0.2, 'FW', 'ST'),
  ],
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

/** Kick-off shape: everyone in their own half, kicking team's strikers on the spot. */
export function kickoffSlot(slot: Slot, kicking: boolean): { x: number; z: number } {
  let x = slot.x * 0.5 - 0.06;
  if (slot.role === 'GK') x = -0.95;
  if (slot.role === 'FW') x = kicking ? -0.02 : -0.24;
  x = Math.min(x, -0.02);
  let z = slot.z * 0.9;
  if (slot.role === 'FW' && kicking) z = slot.z > 0 ? 0.03 : slot.z < 0 ? -0.03 : 0;
  return { x, z };
}
