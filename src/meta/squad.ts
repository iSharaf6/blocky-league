import { FORMATIONS, type Slot } from '../sim/formations';
import { overall, type FormationId, type PlayerDef, type PlayerStats, type Role } from '../sim/types';
import { KEY_STATS, STAT_CAP, trainingCost } from './career';

/**
 * The "do it for me" helpers of the squad screens (docs/UX.md section 5), as pure functions the UI calls and the tests
 * drive: AUTO PICK (the best XI for the formation, a keeper in goal, each man in the slot that suits him, a bench that
 * covers every role), TRAIN BEST (the cheapest session that lifts the team most) and SUGGESTED SUBS (tired or booked
 * starters off for the best fresh bench player in that role).
 */

/** Matchday substitutes: squad indices 11..17 travel (career.ts clubTeam); everyone after them is a reserve. */
export const BENCH_SIZE = 7;

const ROLE_ORDER: Record<Role, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };

/** How good `p` would be in `role`: his own overall there, else his overall computed as if he played it. */
export function ratingAs(p: PlayerDef, role: Role): number {
  return p.role === role ? overall(p) : overall({ ...p, role });
}

type Weights = Partial<Record<keyof PlayerStats, number>>;

/** Wide slots (LB, RWB, LM, RW...) start with L or R; the rest (GK, CB, DM, CM, AM, ST) sit centrally. */
const isWide = (label: string): boolean => label.startsWith('L') || label.startsWith('R');

/** What a slot asks of its man, beyond his role: pace out wide, defending at centre back, shooting up top. */
function slotWeights(slot: Slot): Weights {
  const wide = isWide(slot.label);
  switch (slot.role) {
    case 'GK': return { keeping: 3, passing: 0.5 };
    case 'DF': return wide ? { pace: 2, stamina: 1, defending: 1 } : { defending: 2, passing: 0.5, pace: 0.5 };
    case 'MF':
      if (wide) return { pace: 1.5, dribbling: 1, stamina: 1 };
      if (slot.label === 'DM') return { defending: 1.5, passing: 1 };
      if (slot.label === 'AM') return { passing: 1, dribbling: 1, shooting: 1 };
      return { passing: 1.5, stamina: 1, dribbling: 0.5 };
    case 'FW': return wide ? { pace: 1.5, dribbling: 1.5, shooting: 0.5 } : { shooting: 2, pace: 0.5, dribbling: 0.5 };
  }
}

/** How well `p` suits this exact slot (a weighted average of the stats it asks for). */
export function slotScore(p: PlayerDef, slot: Slot): number {
  const w = slotWeights(slot);
  let sum = 0;
  let total = 0;
  for (const k of Object.keys(w) as (keyof PlayerStats)[]) {
    sum += p.stats[k] * (w[k] ?? 0);
    total += w[k] ?? 0;
  }
  return total > 0 ? sum / total : 0;
}

/** Every ordering of `n` items, the identity first (n is a line of the formation: five at most, so 120 at worst). */
function permutations(n: number): number[][] {
  if (n <= 1) return [Array.from({ length: n }, (_, i) => i)];
  const out: number[][] = [];
  for (const rest of permutations(n - 1)) {
    for (let at = rest.length; at >= 0; at--) out.push([...rest.slice(0, at), n - 1, ...rest.slice(at)]);
  }
  return out;
}

const byOverall = (a: PlayerDef, b: PlayerDef): number => overall(b) - overall(a);
const byRole = (a: PlayerDef, b: PlayerDef): number => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || byOverall(a, b);

/**
 * AUTO PICK: the squad reordered as [XI in formation slot order, bench (BENCH_SIZE), reserves].
 * - Each role's slots go to that role's best players by overall; a role short of men is filled by the best of the
 *   rest at it (ratingAs), never by a keeper while an outfielder is left; with no keeper at all, the best hands go in.
 * - Inside a role the men are placed so the slots fit them best (slotScore): the quick full-backs out wide, the
 *   best defender at centre back, the finisher up front.
 * - The bench carries a spare keeper and the best spare of each outfield role, then the best of the rest; bench and
 *   reserves are sorted by role, then overall.
 */
export function autoLineup(squad: readonly PlayerDef[], formation: FormationId): PlayerDef[] {
  const slots = FORMATIONS[formation] ?? FORMATIONS['4-4-2'];
  const pool = [...squad];
  const take = (p: PlayerDef) => pool.splice(pool.indexOf(p), 1)[0];
  const slotsOf = (r: Role) => slots.map((s, i) => (s.role === r ? i : -1)).filter((i) => i >= 0);
  const group = new Map<Role, PlayerDef[]>();
  const fill = (r: Role) => {
    const men = group.get(r)!;
    while (men.length < slotsOf(r).length && pool.length) {
      const fit = r === 'GK' ? pool : pool.filter((p) => p.role !== 'GK');
      const from = fit.length ? fit : pool;
      const pick = [...from].sort((a, b) => ratingAs(b, r) - ratingAs(a, r) || byOverall(a, b))[0];
      men.push(take(pick));
    }
  };
  // Naturals first, role by role; the keeper's gap at once (the best hands in the squad, before they start outfield).
  for (const r of ['GK', 'DF', 'MF', 'FW'] as Role[]) {
    const best = pool.filter((p) => p.role === r).sort(byOverall).slice(0, slotsOf(r).length);
    best.forEach(take);
    group.set(r, best);
    if (r === 'GK') fill(r);
  }
  // Outfield gaps: whoever plays the role best.
  for (const r of ['DF', 'MF', 'FW'] as Role[]) fill(r);
  // Then trade men between lines and the rest while that helps: a natural stays in his role (a big bonus, so AUTO
  // PICK never leaves anyone out of position it could avoid), a keeper only plays outfield if there is nobody else,
  // and among those rules the best player at each role plays it (a tough-tackling spare midfielder fills a gap at
  // the back ahead of a playmaker).
  const score = (p: PlayerDef, r: Role) => ratingAs(p, r) + (p.role === r ? 1000 : 0) - (p.role === 'GK' && r !== 'GK' ? 2000 : 0);
  const lines = (['GK', 'DF', 'MF', 'FW'] as Role[]).flatMap((r) => group.get(r)!.map((p) => ({ p, r })));
  const bestFor = (r: Role) => pool.reduce<PlayerDef | null>((m, q) => (!m || score(q, r) > score(m, r) ? q : m), null);
  for (let pass = 0; pass < 20; pass++) {
    let better = false;
    for (const a of lines) {
      // A man from the rest who plays this role better.
      const q = bestFor(a.r);
      if (q && score(q, a.r) > score(a.p, a.r) + 1e-9) {
        pool[pool.indexOf(q)] = a.p;
        a.p = q;
        better = true;
      }
      for (const b of lines) {
        if (a.r === b.r) continue;
        const now = score(a.p, a.r) + score(b.p, b.r);
        // Two starters trade roles.
        if (score(b.p, a.r) + score(a.p, b.r) > now + 1e-9) {
          [a.p, b.p] = [b.p, a.p];
          better = true;
          continue;
        }
        // a takes b's role, b drops out, and the best of the rest takes a's.
        const sub = bestFor(a.r);
        if (sub && score(a.p, b.r) + score(sub, a.r) > now + 1e-9) {
          pool[pool.indexOf(sub)] = b.p;
          b.p = a.p;
          a.p = sub;
          better = true;
        }
      }
    }
    if (!better) break;
  }
  for (const r of ['GK', 'DF', 'MF', 'FW'] as Role[]) group.set(r, lines.filter((l) => l.r === r).map((l) => l.p).sort(byOverall));
  // Each line: the arrangement whose slots suit their men best (ties keep the stronger man in the earlier slot).
  const xi: (PlayerDef | undefined)[] = new Array(slots.length);
  for (const r of ['GK', 'DF', 'MF', 'FW'] as Role[]) {
    const idx = slotsOf(r);
    const men = group.get(r)!;
    let best: number[] = men.map((_, i) => i);
    let bestScore = -Infinity;
    if (men.length === idx.length && men.length > 1) {
      for (const perm of permutations(men.length)) {
        let s = 0;
        for (let j = 0; j < idx.length; j++) s += slotScore(men[perm[j]], slots[idx[j]]);
        if (s > bestScore + 1e-9) {
          bestScore = s;
          best = perm;
        }
      }
    }
    idx.forEach((slot, j) => {
      if (best[j] !== undefined) xi[slot] = men[best[j]];
    });
  }
  const starters = xi.filter((p): p is PlayerDef => !!p);
  // The bench: cover, then quality.
  const bench: PlayerDef[] = [];
  const add = (p: PlayerDef | undefined) => {
    if (p && bench.length < BENCH_SIZE) bench.push(take(p));
  };
  for (const r of ['GK', 'DF', 'MF', 'FW'] as Role[]) add(pool.filter((p) => p.role === r).sort(byOverall)[0]);
  for (const p of [...pool].sort(byOverall)) {
    if (bench.length >= BENCH_SIZE) break;
    // A third keeper only if there is nobody else to sit there.
    if (p.role === 'GK' && pool.some((q) => q.role !== 'GK')) continue;
    add(p);
  }
  bench.sort(byRole);
  pool.sort(byRole);
  return [...starters, ...bench, ...pool];
}

/** The stat a session on `p` should go into: the one his overall leans on most that still has room (or none). */
export function bestStat(p: PlayerDef): keyof PlayerStats | null {
  let best: keyof PlayerStats | null = null;
  let bestW = 0;
  const base = overall(p);
  // His role's key stats first (they are what the TRAIN tab highlights), each weighed by what it adds to his overall.
  const keys = [...KEY_STATS[p.role], ...(Object.keys(p.stats) as (keyof PlayerStats)[])];
  for (const k of keys) {
    if (p.stats[k] >= STAT_CAP) continue;
    const w = overall({ ...p, stats: { ...p.stats, [k]: p.stats[k] + 100 } }) - base;
    if (w > bestW) {
      bestW = w;
      best = k;
    }
  }
  return best;
}

export interface TrainPick {
  /** Squad index of the player and the stat to train. */
  index: number;
  stat: keyof PlayerStats;
  cost: number;
}

/**
 * TRAIN BEST: the weakest starter (the cheapest session, since a session costs 40 + 3 x OVR, and the one that lifts
 * the team's rating most for the coins) in the stat his overall leans on most. Starters before the bench; null when
 * everyone is maxed out.
 */
export function trainBest(squad: readonly PlayerDef[]): TrainPick | null {
  const order = squad.map((p, i) => ({ p, i }));
  const pick = (list: { p: PlayerDef; i: number }[]) => {
    const ok = list
      .map((o) => ({ ...o, stat: bestStat(o.p) }))
      .filter((o): o is { p: PlayerDef; i: number; stat: keyof PlayerStats } => o.stat !== null)
      .sort((a, b) => overall(a.p) - overall(b.p) || trainingCost(a.p) - trainingCost(b.p) || a.i - b.i);
    const o = ok[0];
    return o ? { index: o.i, stat: o.stat, cost: trainingCost(o.p) } : null;
  };
  return pick(order.slice(0, 11)) ?? pick(order.slice(11));
}

/** Starters under this stamina are offered a rest in SUGGESTED SUBS (the pitch chips turn amber at 60 and red at 35). */
export const SUB_TIRED = 0.5;

/** A man on the pitch, as the in-match tactics screen sees him. */
export interface OnPitch {
  slot: number;
  /** The slot's role (what his replacement has to play). */
  role: Role;
  stamina: number;
  booked: boolean;
  sentOff: boolean;
  keeper: boolean;
  /** He came on as a sub already (never taken off again by a suggestion). */
  cameOn?: boolean;
}

export interface SubPlan {
  slot: number;
  /** The bench player to send on (by id: the bench reorders as changes are made). */
  onId: string;
  reason: 'tired' | 'booked';
}

/**
 * SUGGESTED SUBS: tired outfielders (most tired first), then booked ones, each for the best unused bench player in
 * his role (else the best outfielder at it), never a keeper for an outfielder; at most `subsLeft` changes.
 */
export function suggestSubs(team: readonly OnPitch[], bench: readonly PlayerDef[], subsLeft: number, tired = SUB_TIRED): SubPlan[] {
  const out: SubPlan[] = [];
  if (subsLeft <= 0) return out;
  const live = team.filter((p) => !p.sentOff && !p.keeper && !p.cameOn);
  const worn = live.filter((p) => p.stamina < tired).sort((a, b) => a.stamina - b.stamina || a.slot - b.slot);
  const carded = live.filter((p) => p.booked && p.stamina >= tired).sort((a, b) => a.stamina - b.stamina || a.slot - b.slot);
  const used = new Set<string>();
  for (const [list, reason] of [[worn, 'tired'], [carded, 'booked']] as const) {
    for (const p of list) {
      if (out.length >= subsLeft) return out;
      const free = bench.filter((d) => !used.has(d.id) && d.role !== 'GK');
      const same = free.filter((d) => d.role === p.role).sort(byOverall);
      const on = same[0] ?? [...free].sort((a, b) => ratingAs(b, p.role) - ratingAs(a, p.role))[0];
      if (!on) continue;
      used.add(on.id);
      out.push({ slot: p.slot, onId: on.id, reason });
    }
  }
  return out;
}
