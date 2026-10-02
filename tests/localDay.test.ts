import { describe, expect, it } from 'vitest';
import { localDay } from '../src/core/day';

declare const process: { env: Record<string, string | undefined> };

// A zone with clock changes (the owner's: Sydney, AEST/AEDT). Node reads TZ when it changes.
process.env.TZ = 'Australia/Sydney';

/** The old main.ts version: now minus 24-hour steps. */
const oldLocalDay = (offset: number, now: Date): string => {
  const d = new Date(now.getTime() + offset * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('localDay: calendar days, not 24-hour steps', () => {
  it('runs in a zone with clock changes (the 4 Oct 2026 change is 23 hours long there)', () => {
    expect(new Date(2026, 9, 3, 12).getTimezoneOffset()).toBe(-600);
    expect(new Date(2026, 9, 5, 12).getTimezoneOffset()).toBe(-660);
  });

  it('just after midnight following a 23-hour day, yesterday is that day (the old way said two days back)', () => {
    const now = new Date(2026, 9, 5, 0, 30);
    expect(localDay(0, now)).toBe('2026-10-05');
    expect(localDay(-1, now)).toBe('2026-10-04');
    expect(oldLocalDay(-1, now)).toBe('2026-10-03');
  });

  it('late on a 25-hour day, yesterday is the day before (the old way said today)', () => {
    const now = new Date(2026, 3, 5, 23, 30);
    expect(localDay(0, now)).toBe('2026-04-05');
    expect(localDay(-1, now)).toBe('2026-04-04');
    expect(oldLocalDay(-1, now)).toBe('2026-04-05');
  });

  it('crosses months and years, both ways, and defaults to today', () => {
    expect(localDay(-1, new Date(2026, 0, 1, 0, 10))).toBe('2025-12-31');
    expect(localDay(1, new Date(2026, 11, 31, 23, 50))).toBe('2027-01-01');
    expect(localDay(-1, new Date(2028, 2, 1, 9))).toBe('2028-02-29');
    expect(localDay(-7, new Date(2026, 9, 2, 8))).toBe('2026-09-25');
    const t = new Date();
    expect(localDay()).toBe(localDay(0, t));
  });
});
