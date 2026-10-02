/**
 * The player's local calendar day as YYYY-MM-DD (the daily gift's streak, the day's challenges, the shop's day).
 *
 * `offset` days from `now` by the calendar, not by 24-hour steps: a day can be 23 or 25 hours long where clocks
 * change, and "now minus 24 h" just after midnight following a 23-hour day lands two days back (or, late on a
 * 25-hour day, on the same day), which broke the gift streak there.
 */
export function localDay(offset = 0, now: Date = new Date()): string {
  // Noon of the wanted day: well clear of any clock change, whichever way it goes.
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
