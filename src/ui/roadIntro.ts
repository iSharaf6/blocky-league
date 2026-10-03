/**
 * ROAD TO GLORY's "how it works" screen: shown once, the first time the mode is opened (save.settings.roadIntroSeen),
 * and again from the hub's ? button. One screen on the app shell, its button pinned in view: the whole idea in three
 * short lines (start at the bottom, build the club up, climb to the top) beside the real ladder of divisions from
 * meta/career.ts, so the copy can't drift from the rules.
 */
import type { AppContext } from '../app';
import { BOTTOM_DIVISION, DIVISION_NAMES, TOP_DIVISION } from '../meta/career';
import { mountMeta, topBar } from './club';
import { pixelIcon } from './pixelIcons';
import './career.css';

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
  const scr = mountMeta(app, 'mc-road-screen shell');
  // Three short lines: a label and a few words each (docs/UX.md: less to read).
  const points: [string, string, string][] = [
    ['shirt', 'START AT THE BOTTOM', `${title(DIVISION_NAMES[BOTTOM_DIVISION])}, a scrappy squad.`],
    ['gear', 'BUILD IT UP', 'Win coins. Sign, train, upgrade.'],
    ['trophy', 'CLIMB TO THE TOP', 'Top two go up. A cup every season.'],
  ];
  scr.render(
    `${topBar(o.first ? 'MENU' : 'BACK', 'ROAD TO GLORY', `${BOTTOM_DIVISION - TOP_DIVISION + 1} DIVISIONS TO THE TOP`, app.save.coins)}
    <div class="mc-body rg">
      ${ladderHtml()}
      <ul class="rg-points">${points.map(([ic, h, t]) => `<li><i class="rg-ic" aria-hidden="true">${pixelIcon(ic, 'currentColor', 3)}</i><span><b>${h}</b>${t}</span></li>`).join('')}</ul>
    </div>
    <div class="mc-actions"><button class="btn btn-go btn-lg" data-a="go">${o.first ? "LET'S GO" : 'GOT IT'}</button></div>`,
    { back: o.onBack, go: o.onGo },
  );
}
