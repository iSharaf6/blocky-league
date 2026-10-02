/**
 * ROAD TO GLORY's "how it works" panel: shown once, the first time the mode is opened (save.settings.roadIntroSeen),
 * and again from the hub's HOW IT WORKS button. It says the whole idea in three lines (start at the bottom, build the
 * club up, climb to the top) over the real ladder of divisions from meta/career.ts, so the copy can't drift from the
 * rules. Chunky house style on the shared meta-screen kit (ui/club.ts).
 */
import type { AppContext } from '../app';
import { BOTTOM_DIVISION, DIVISION_NAMES, TOP_DIVISION } from '../meta/career';
import { mountMeta, topBar } from './club';
import { pixelIcon } from './pixelIcons';

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "SUNDAY LEAGUE" as it reads inside a sentence: "Sunday League". */
const title = (s: string): string => s.toLowerCase().replace(/(^|\s)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());

/** The divisions top to bottom as a staircase (the bottom step, where you start, sits lowest and furthest left). */
function ladderHtml(): string {
  const rows: string[] = [];
  for (let d = TOP_DIVISION; d <= BOTTOM_DIVISION; d++) {
    const k = BOTTOM_DIVISION - d;
    const tag = d === BOTTOM_DIVISION ? '<em>YOU START HERE</em>' : d === TOP_DIVISION ? pixelIcon('trophy', 'currentColor', 1.8) : '';
    rows.push(
      `<li class="${d === BOTTOM_DIVISION ? 'start' : d === TOP_DIVISION ? 'top' : ''}" style="--k:${k}"><span>DIV ${d}</span><b>${DIVISION_NAMES[d]}</b>${tag}</li>`,
    );
  }
  return `<ol class="rg-ladder" aria-label="The ${WORDS[BOTTOM_DIVISION - TOP_DIVISION + 1]} divisions, ${title(DIVISION_NAMES[BOTTOM_DIVISION])} at the bottom to ${title(DIVISION_NAMES[TOP_DIVISION])} at the top">${rows.join('')}</ol>`;
}

export interface RoadIntroOptions {
  /** True the first time (MENU back, LET'S GO); false from the hub's HOW IT WORKS (BACK, GOT IT). */
  first: boolean;
  onGo: () => void;
  onBack: () => void;
}

export function roadIntro(app: AppContext, o: RoadIntroOptions): void {
  const scr = mountMeta(app, 'mc-road-screen');
  const n = WORDS[BOTTOM_DIVISION - TOP_DIVISION + 1];
  const points: [string, string, string][] = [
    ['shirt', 'START AT THE BOTTOM', `Found your club with a scrappy squad in the ${title(DIVISION_NAMES[BOTTOM_DIVISION])}.`],
    ['gear', 'BUILD IT UP', 'Win matches for coins. Sign players, train your squad and upgrade your ground.'],
    ['trophy', 'CLIMB TO THE TOP', `Finish in the top two to go up. ${n[0].toUpperCase()}${n.slice(1)} divisions stand between you and the ${title(DIVISION_NAMES[TOP_DIVISION])}.`],
  ];
  scr.render(
    `${topBar(o.first ? 'MENU' : 'BACK', 'ROAD TO GLORY', 'BUILD YOUR CLUB FROM THE BOTTOM UP', app.save.coins)}
    <div class="rg">
      ${ladderHtml()}
      <ul class="rg-points">${points.map(([ic, h, t]) => `<li><i class="rg-ic" aria-hidden="true">${pixelIcon(ic, 'currentColor', 3)}</i><span><b>${h}</b>${t}</span></li>`).join('')}</ul>
    </div>
    <div class="btn-row"><button class="btn btn-go btn-lg" data-a="go">${o.first ? "LET'S GO" : 'GOT IT'}</button></div>`,
    { back: o.onBack, go: o.onGo },
  );
}
