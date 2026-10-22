/**
 * A player's name as every surface shows it: one spelling, in plain letters ("J. Zając" shows as J. Zajac, ZAJAC in
 * capitals). The pixel face (the HUD's player chip, the overhead tags, the cards and the drills' callouts) has no
 * accented capitals, so ZAJĄC there beside J. Zając in the commentary and ZAJAC in a callout read as three players
 * (CrazyGames' QA, 22 October). Render time only: the squad data and the simulation keep the stored name untouched.
 * Casing is the caller's: capitals on pixel surfaces, sentence case in the commentary's lines.
 */
export function plainName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/ø/g, 'o').replace(/Ø/g, 'O').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/ß/g, 'ss').normalize('NFC');
}
