# Match presentation

Ordinary solo matches use short, skippable scenes built from the actual eligible players and equipped kits. Staged poses modify the drawn frame only. They never add injuries, cards, score, stamina changes or random simulation draws.

Every goal in an ordinary local match automatically gets the TV replay, including close-range finishes and opposition goals. The replay starts after the celebration's signature moment and shows the recorded build-up and finish. A deliberate tap during the celebration skips through to kick-off; a fresh tap or gameplay button during the replay skips that replay. Held controls are consumed at kick-off. Demos, online matches, Football Moments and an already-scored goal restored from a checkpoint omit the replay. Reopening resumes the match without requiring historical video frames to be saved.

Offsides, fouls, yellow and red cards, penalty awards and settled penalty results also receive recorded recaps in ordinary local matches. A foul, its card and penalty award share one clip. A compact corner badge names the replay and one caption line under it says who did it ("FOUL BY 5 CINDER", "OFFSIDE 9 VOSS", "SAVED BY 1 PINTO"), without covering the players. An in-match penalty goal uses the normal goal replay; a parry or post remains live until the ball is controlled or the referee stops play. Live advantage is uninterrupted, with any recap waiting for the next stoppage.

### A foul, in order

A whistled foul reads live before anything is replayed, and every step is presentation only:

| Step | When | What is shown |
| --- | --- | --- |
| Contact | 0 s | The match keeps running through its dead-ball beat, so the man brought down really goes to the floor (the sim's own `fallen` state) and everyone eases up. Thump, flash, hit-stop for a slide. |
| Decision | 0 s | Whistle, and a banner in the lower third that names it: "FOUL" or "PENALTY!" with one reason line ("TRIPPED BY 5 CINDER" for a slide, "CLIPPED BY 5 CINDER" for a standing tackle). The referee raises his arm; for a penalty he stops, turns and points to the spot. A skill call still on screen ("SKINNED HIM") is cleared for it. |
| Hold | 0.55 s | The match holds just before the sim would place the taker (`DEAD_HOLD_S`), so nobody is seen jumping to the restart. |
| Card | 1.0 s (`FOUL_BEAT_S`) | The card close-up, if any (1.8 s). It never arrives over the decision banner. A tap after the beat ends the close-up early. |
| Replay | after the card, or at 1.0 s | The foul clip (below). A tap skips it. |
| Restart | after the replay | The held restart resumes untouched. |

A foul held for advantage shows only its "FOUL!" flag while play runs on. If it is whistled back, the same banner and reason line appear at that whistle, before its card. Where nothing holds the match for the decision (online, a Football Moment, the demo) the beat stays at the sim's own 0.6 s (`FOUL_BEAT_LIVE_S`) and there is no recap.

### Clip windows

| Clip | Opens | Runs to | Slow motion (half speed; match speed elsewhere) |
| --- | --- | --- | --- |
| Foul, card, penalty award | 1.8 s before the contact | 0.9 s after it | from 0.3 s before the contact to 0.4 s after |
| Taken penalty (in match and shootout) | 1.75 s before the strike, so the run-up is in it | 0.5 s after the outcome is final | from the strike to 0.2 s after the outcome |
| Offside | 1 s before the pass (at least 3 s of footage) | the flag | none: the picture stops on the pass for 1.5 s instead |

The contact frame is always inside a foul clip, never its last frame. When the whistle goes at once, the 0.55 s up to the hold are recorded frames; the remaining 0.35 s of the tail continues the same motion draw-only (`continueFrames`: positions eased on, pose clocks running) because the sim's dead-ball beat is over by then. A foul played on for advantage has a fully recorded tail.

A taken penalty is replayed only once its outcome is final: in the net (the normal goal replay), held by the keeper for half a second, or out of play with the ball gone dead. A shootout kick is likewise seen into the net, the gloves or the crowd for half a second before its recap. After a miss the live ball is kept out of the picture for the last frames of the dead-ball beat, so it is never seen flying on after the replay; the restart places it. A rebound nobody settles within 6 s is live play again and its recap is dropped.

### What the foul clip looks like

The foul clip has its own fixed lens, 10.5 m from the contact and 4.4 m up, picked from the recorded contact frame: the bearing that looks across the challenge (two men end-on hide the contact) with the fewest other bodies between it and the pair, inside the boards, ties going to the main stand's side. It pans with the two men and tightens from a 34 to a 25 degree lens as the challenge comes in. A red ring marks the man who committed the foul and a gold one the man brought down. Everyone else within 6 m of them is dimmed, and anyone standing between the lens and the pair is taken out of the picture.

### Offside

The offside clip stops on the frame the pass was released. A gold line is drawn across the pitch where the sim judged it (level with the second-last defender, the ball or halfway, read off that recorded frame with the sim's own rule), with a faint band on the offside side. The attacker is ringed red and the second-last defender gold, and the lens comes round in line with the line from the main stand's side so he is seen beyond it. After 1.5 s the clip runs on to the flag from the wide shot.

Incident playback holds the exact live match state, then restores its camera and resumes the existing restart or settled possession. A fresh tap or gameplay-button edge skips the clip; held inputs cannot take the next restart. Incident recaps do not run the goal lifecycle, advance shootout results or pay match rewards. Restored checkpoints discard unfinished recap footage, marks and lens, and resume the saved match state.

### After a goal

Only the scoring side celebrates. The conceding players are drawn beaten: head down and arms down while they walk back (hands on hips or shoulders slumped), bent double with hands on knees when they stop, and the keeper on his knees slapping the turf when he is still. This is the draw pose for the sim's `dejected` state, so it is the same live, in the wide shot and in the goal replay. The old pose put both hands on the head, which at match size read as two arms in the air. A man sent off keeps hands on head.

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

The tunnel, trophy, presenter and temporary hooks are removed when the session ends. Restoring a match clears scene poses, card pins and award props rather than replaying completed presentation. Focused tests cover the choreography, actual geometry disposal, sequential skips, callback counts, draw-only state and recovery; `tests/incidentReplays.test.ts` holds the clip windows (the contact inside every foul and penalty-award clip, a missed penalty replayed only once dead), the foul order and the offside line, and `tests/incidentCamera.test.ts` the foul lens, the caption and the conceding side's poses. Browser/device visual verification is separate from these automated checks.

## Substitution music

Every substitution scene plays the half-time loop under it (`MatchAudio.subScene` in `src/audio/director.ts`, called from the session's `startSubCut` and `endSubCut`). In a match the loop starts from its top with the scene and fades over 1.2 s (`SUB_FADE_S`) when the scene ends or is skipped. For changes made at half time the loop that is already playing is not stopped at the restart: it carries on over the 3 s walk back out and through the scene, then fades. If a queued change is never shown (the queue is dropped, or 8 s pass, `SUB_WAIT_S`), the loop fades as it did before. The MUSIC setting still governs it.

History: this music was never a cue of its own. Before the second-half return scene existed, changes made at half time were shown at the kick-off while the half-time loop was still fading out, which is what was heard. The return scene then sat between the two and the loop had gone by the time the substitution played. `tests/crowdMusic.test.ts` and `tests/presentation.test.ts` hold the cue.

## Side shows

Short comic scenes on their own small stage (`src/game/sideShow.ts` decides what plays and where everyone is, `src/render/sideStage.ts` draws it, `src/ui/sideFrame.ts` is the frame). They are drawn as a picture in the corner under the camera and pause buttons, after the match's own frame, so they take no time from the match. They never write to the sim or its frames, and their figures are separate from the 22 in the match. Solo matches against the AI only: the demo, online, shared-human play, the basics and Football Moments leave them out. Settings key `sideShows` (default on) turns them all off; `MatchSession.setSideShows` applies it mid-match.

| Side show | When | Length | Cap |
| --- | --- | --- | --- |
| Commentary box (corner) | A goal's replay. Two commentators watch at their desk and react when the replayed ball goes in: six celebrations for your goals (leap, one goes over backwards in his chair, a headset thrown, papers up, a high five, a spin on the chair) and three groans for theirs (facepalm, head on the desk, sinking behind it). The wall screen shows the score and the scorer. | The replay | 5 a match, never two replays running; every reaction is used before one repeats |
| Commentary box (full screen) | Before the replay of a big goal of yours: a hat trick, a SUPER SHOT, a goal after 80% of the second half that levels or leads, or taking the lead in the second half of a knockout tie. A headline names it. | 2.4 s | 2 a match, 45 s apart; the replay after it has no corner picture |
| Fan cam | A goal's replay. Yours: the stand is up and the popcorn goes everywhere, then its owner notices. Theirs: hands on heads and the bucket goes on his. | The replay | 2 a match |
| Dugout cam | A goal's replay, with the real bench. Yours: the manager runs the touchline. Theirs: he kicks his water bottle past the ducking substitutes. | The replay | 2 a match |
| Coin toss | The pre-match fly-in, with the two real captains and a referee: a handshake, the toss, and either your captain wins it or the coin lands on the referee's head. | 3 s | 70% of matches, first kick-off only |
| Keeper cam | While a penalty waits to be taken, after the award's recap: the real taker places the ball and walks back, the real keeper bounces and wobbles on his line. | Until the kick or the aiming view from behind the taker, 3.4 s at most | 1 a match, not in a shootout |
| Early bath | After a red card's close-up and recap: the sent-off player walks past his manager, who has plenty to say, and the bench. | 3 s | 1 a match |
| Match ball | During the full-time sportsmanship beat, for a scorer of three or more: he lifts the ball, kisses it and tucks it under his arm while two teammates applaud. | 3 s | 1 a match |

A goal's replay gets at most one picture, the first goal always the commentary box, and one replay in five keeps the whole screen. The only dead time added is the 2.4 s full-screen cut. A tap during it skips to the kick-off like any tap in a goal celebration, and a tap during a replay ends the replay and its picture together. Corner pictures need no skip: they end with the replay, the kick, their own clock, or when another scene or recap takes the screen. While the quick-sub card is offered the corner picture is hidden, and the chant caption moves below the picture.

Sound uses the existing cues: a cheer or a groan for the reaction, a flop for the chair, a slap for a high five and a facepalm, the coin's ring, whistles for a penalty and a red card, and one new sting (`studio`) for the full-screen cut.

Everything is built once per match and shares materials; nothing is allocated per frame, the stage is drawn only while a picture is up, and it is disposed with the session. `tests/sideShow.test.ts` holds the caps, the triggers, the timings and the poses.
