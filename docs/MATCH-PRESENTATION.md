# Match presentation

Ordinary solo matches use short, skippable scenes built from the actual eligible players and equipped kits. Staged poses modify the drawn frame only. They never add injuries, cards, score, stamina changes or random simulation draws.

Every goal in an ordinary local match automatically gets the TV replay, including close-range finishes and opposition goals. The replay starts after the celebration's signature moment and shows the recorded build-up and finish. A deliberate tap during the celebration skips through to kick-off; a fresh tap or gameplay button during the replay skips that replay. Held controls are consumed at kick-off. Demos, online matches, Football Moments and an already-scored goal restored from a checkpoint omit the replay. Reopening resumes the match without requiring historical video frames to be saved.

Offsides, fouls, yellow and red cards, penalty awards and settled penalty results also receive recorded recaps in ordinary local matches. A foul, its card and penalty award share one clip. The contact and referee decision read first; a compact corner badge names the replay without covering the players. Offside footage retains the original pass release and briefly slows that moment, then shows the receiver's involvement. Shootouts replay scored, saved and missed kicks. An in-match penalty goal uses the normal goal replay; a parry or post remains live until the ball is controlled or the referee stops play. Live advantage is uninterrupted, with any recap waiting for the next stoppage.

Incident playback holds the exact live match state, then restores its camera and resumes the existing restart or settled possession. A fresh tap or gameplay-button edge skips the clip; held inputs cannot take the next restart. Incident recaps do not run the goal lifecycle, advance shootout results or pay match rewards. Restored checkpoints discard unfinished recap footage and resume the saved match state.

Match time and possession statistics count only while the ball is live. Fouls, balls out, penalty preparation, other restarts and kick-off waits pause those clocks, while restart timers and animations keep running. Time resumes on the actual strike. Advantage and penalty flight count as live play. Paused breaks do not also increase added time: the existing one-minute minimum board and protection for an ongoing chance or awarded penalty remain.

| Beat | Duration | Action |
| --- | --- | --- |
| Lineup | 3 s | Camera follows the XI to their captain; a worn club title appears beside the captain and in the fixture subtitle. |
| Halftime | 4 s | Both teams walk toward the dressing-room tunnel. The leading side chats and waves; a level game lets both sides chat. The trailing side stays composed. |
| Second-half return | 3 s | Teams emerge from the passage and return to the pitch. |
| Win | 4.2 s | The captain and four teammates gather, celebrate and applaud the fans. |
| Loss | 4.6 s | Two frustrated teammates gesture at one another; the captain steps between them and calms the exchange. |
| Sportsmanship | 3 s | Opposing captains and teammates greet each other, pass and applaud. |
| Man of the match | 4.2 s | A presenter hands the rated winner a visible trophy while three teammates applaud. The winner lifts it; after a loss the lift stays modest. |

Fulltime proceeds from the outcome beat to sportsmanship to the award, then calls `MatchSession.onFinish` once. A draw omits the win/loss beat. A shootout uses its existing winners' celebration. Halftime calls `onHalftime` only after the tunnel scene ends or is skipped. The application waits until those callbacks for menus; ads do not interrupt these scenes.

A fresh tap or gameplay-button edge skips the current beat after a 0.3 s opening grace. A held skip is consumed before another scene or kick-off can read it. Online/shared-human play, attract demos and Football Moments omit these timed solo scenes.

At a close yellow-card presentation, the tackle victim briefly clutches a shin and rolls theatrically, then stands up. This is a comic draw pose, not an injury. A red card keeps its serious presentation. The act clears when the shot ends, the restart changes, either player is replaced or a checkpoint is restored.

The tunnel, trophy, presenter and temporary hooks are removed when the session ends. Restoring a match clears scene poses, card pins and award props rather than replaying completed presentation. Focused tests cover the choreography, actual geometry disposal, sequential skips, callback counts, draw-only state and recovery. Browser/device visual verification is separate from these automated checks.
