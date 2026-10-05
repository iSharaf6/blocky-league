import { APP_VERSION, CONTACT_EMAIL, STUDIO } from './brand';
import { escHtml } from './text';
import './developerAbout.css';

/** This portrait loads only when the developer page opens, keeping the hub light. */
export function developerAboutHtml(): string {
  const portrait = `${import.meta.env.BASE_URL}developer/islam-blocky.png`;
  return `<div class="panel-wrap dim shell">
    <section class="panel mc shell developer-panel" aria-labelledby="developer-heading">
      <header class="mc-top">
        <button class="btn btn-white mc-back" data-a="back" aria-label="Back to settings">←<span>BACK</span></button>
        <div class="mc-title"><h2 id="developer-heading">ABOUT THE DEVELOPER</h2></div>
        <span class="mc-top-gap" aria-hidden="true"></span>
      </header>
      <div class="mc-body developer-body">
        <div class="developer-portrait">
          <img src="${escHtml(portrait)}" width="1254" height="1254" decoding="async" alt="A smiling blocky portrait of Islam Sharaf, with curly black hair and a black sweater" />
          <span>FOOTBALL, BLOCK BY BLOCK.</span>
        </div>
        <div class="developer-copy">
          <p class="developer-kicker">THE PERSON BEHIND THE BLOCKS</p>
          <h3>Islam Sharaf</h3>
          <p>Developer of Blocky League at ${escHtml(STUDIO)}.</p>
          <p>Thanks for playing, testing and helping this little football world grow. Your goals, stories and feedback help shape the game.</p>
          <a class="btn btn-white developer-contact" href="mailto:${escHtml(CONTACT_EMAIL)}">SEND FEEDBACK</a>
          <p class="developer-version">Blocky League v${escHtml(APP_VERSION)}</p>
        </div>
      </div>
    </section>
  </div>`;
}
