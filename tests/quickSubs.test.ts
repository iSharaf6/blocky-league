import { describe, expect, it, vi } from 'vitest';
import { defaultSave, normalizeSettings } from '../src/core/save';
import { MatchSession } from '../src/game/matchSession';
import {
  QS_BOARD_S, QS_GAP_S, QS_QUIET_S, QS_SHOW_S, QS_SNOOZE_S, QS_TIRED, QuickSubs, quickSubStoppage, quickSubsAllowed,
} from '../src/game/quickSub';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { BASICS, MOMENTS } from '../src/meta/moments';
import { cleanControls, netConfig } from '../src/net/setup';
import { DT } from '../src/sim/constants';
import { Match } from '../src/sim/match';
import type { MatchEvent, RestartKind, Side } from '../src/sim/types';

function match(seed = 3, humanSide: Side | -1 = 0): Match {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[4]),
    away: makeTeam(PRESET_CLUBS[5]),
    halfLength: 120,
    difficulty: 2,
    humanSide,
    seed,
  });
  m.phase = 'play';
  m.restart = null;
  m.drainEvents();
  return m;
}

/** The ball goes out (the sim's own stoppage: whistle, restart picked, AI benches look). */
function goOut(m: Match, kind: RestartKind = 'throwin', side: Side = 1): void {
  (m as unknown as { goOut: (k: RestartKind, s: Side, x: number, z: number) => void }).goOut(kind, side, 0, 30);
}

/** Run the card's rules for `s` seconds of frames. */
function run(qs: QuickSubs, s: number, shown = true, ready = true): void {
  for (let t = 0; t < s; t += DT) qs.update(DT, shown, ready);
}

describe('quick subs', () => {
  it('offers the most tired outfielder, with the bench player the AI would bring on for him', () => {
    const m = match();
    const qs = new QuickSubs(m, 0);
    // Fresh legs everywhere: nothing to offer.
    run(qs, 1);
    expect(qs.mode).toBe('idle');
    const tired = m.teamPlayers(0)[7];
    const worse = m.teamPlayers(0)[3];
    tired.stamina = QS_TIRED - 0.05;
    worse.stamina = QS_TIRED - 0.15;
    // Never while the card can't be seen (a replay, a celebration, the pause menu...).
    run(qs, 1, false);
    expect(qs.mode).toBe('idle');
    qs.update(DT, true, true);
    expect(qs.mode).toBe('offer');
    const o = qs.offer!;
    expect(o.idx).toBe(worse.idx);
    expect(o.reason).toBe('tired');
    // The sim's own pick: like for like from the bench, fresh, never a keeper for an outfielder.
    expect(o.on).toBe(m.bench[0][m.subPick(0, worse.slot)]);
    expect(o.on.role).toBe(worse.role);
    expect(o.on.role).not.toBe('GK');
    // A keeper is never offered, however spent.
    const k = new QuickSubs(match(4), 0);
    for (const p of k.match.teamPlayers(0)) if (p.isKeeper) p.stamina = 0.15;
    run(k, 1);
    expect(k.mode).toBe('idle');
  });

  it('queues on the button and makes the change only once play stops', () => {
    const m = match();
    const p = m.teamPlayers(0)[7];
    p.stamina = 0.2;
    const qs = new QuickSubs(m, 0);
    qs.update(DT, true, true);
    expect(qs.accept()).toBe(true);
    expect(qs.mode).toBe('queued');
    const on = qs.offer!.on;
    // Live play: it waits, however long (no time-out on a queued change, even off screen).
    run(qs, QS_SHOW_S * 2);
    run(qs, 2, false);
    expect(qs.mode).toBe('queued');
    expect(m.subsUsed[0]).toBe(0);
    // A penalty given is no stoppage for a change (the AI benches wait too).
    goOut(m, 'penalty', 0);
    expect(quickSubStoppage(m, p.idx)).toBe(false);
    run(qs, 0.5);
    expect(m.subsUsed[0]).toBe(0);
    // The ball out for a throw, but the picture isn't free yet (a card close-up): still waiting.
    m.phase = 'play';
    m.restart = null;
    goOut(m);
    m.drainEvents();
    expect(quickSubStoppage(m, p.idx)).toBe(true);
    run(qs, 0.5, true, false);
    expect(m.subsUsed[0]).toBe(0);
    // Free: made at once, through the same substitute path as the tactics screen.
    qs.update(DT, true, true);
    expect(m.subsUsed[0]).toBe(1);
    expect(m.teamPlayers(0)[7].def).toBe(on);
    expect(p.stamina).toBe(1);
    expect(qs.mode).toBe('board');
    expect(qs.done?.on).toBe(on);
    // Its 'sub' event is the board's (the session shows no toast as well), once.
    const sub = m.drainEvents().find((e): e is Extract<MatchEvent, { type: 'sub' }> => e.type === 'sub')!;
    expect(sub.on).toBe(on.name);
    expect(qs.claims(sub)).toBe(true);
    expect(qs.claims(sub)).toBe(false);
    // The board goes after its beat, and the fresh man isn't offered.
    run(qs, QS_BOARD_S + QS_GAP_S + 0.5);
    expect(qs.mode).toBe('idle');
  });

  it('never pulls off the man taking the restart, or holding the ball for it', () => {
    const m = match();
    goOut(m, 'throwin', 0);
    const taker = m.restart!.taker;
    expect(quickSubStoppage(m, taker)).toBe(true); // ball still dead: he hasn't picked it up
    m.phase = 'restart';
    expect(quickSubStoppage(m, taker)).toBe(false);
    const other = m.teamPlayers(0).find((q) => q.idx !== taker && !q.isKeeper)!;
    expect(quickSubStoppage(m, other.idx)).toBe(true);
    m.phase = 'play';
    expect(quickSubStoppage(m, other.idx)).toBe(false);
    m.phase = 'halftime';
    expect(quickSubStoppage(m, taker)).toBe(true);
  });

  it('can be undone, ignored or dismissed, and the same man is left alone for a while', () => {
    // Undo: nothing is made at the stoppage, and after a breather the next man is offered, not him.
    const m = match();
    const a = m.teamPlayers(0)[7];
    const b = m.teamPlayers(0)[9];
    a.stamina = 0.2;
    b.stamina = 0.35;
    const qs = new QuickSubs(m, 0);
    qs.update(DT, true, true);
    expect(qs.offer!.idx).toBe(a.idx);
    qs.accept();
    qs.cancel();
    expect(qs.mode).toBe('idle');
    goOut(m);
    run(qs, 1);
    expect(m.subsUsed[0]).toBe(0);
    expect(qs.mode).toBe('idle');
    m.phase = 'play';
    run(qs, QS_GAP_S);
    expect(qs.offer?.idx).toBe(b.idx);

    // Ignored: time off screen doesn't count; QS_SHOW_S on screen and it goes, and he isn't back for QS_SNOOZE_S.
    const m2 = match(6);
    const c = m2.teamPlayers(0)[8];
    c.stamina = 0.25;
    const q2 = new QuickSubs(m2, 0);
    q2.update(DT, true, true);
    expect(q2.offer?.idx).toBe(c.idx);
    run(q2, QS_SHOW_S, false);
    expect(q2.mode).toBe('offer');
    run(q2, QS_SHOW_S + 0.1);
    expect(q2.mode).toBe('idle');
    run(q2, QS_SNOOZE_S - 1);
    expect(q2.mode).toBe('idle');
    run(q2, 2);
    expect(q2.offer?.idx).toBe(c.idx);

    // Dismissed (×): nothing at all for QS_QUIET_S, then the other man (him: longer still).
    q2.dismiss();
    const d = m2.teamPlayers(0)[4];
    d.stamina = 0.3;
    run(q2, QS_QUIET_S - 1);
    expect(q2.mode).toBe('idle');
    run(q2, 2);
    expect(q2.offer?.idx).toBe(d.idx);

    // Settings > QUICK SUBS off: the card goes and nothing more is offered.
    q2.enabled = false;
    run(q2, QS_SNOOZE_S * 3);
    expect(q2.mode).toBe('idle');
  });

  it('respects the five-change limit and players sent off', () => {
    const m = match();
    const p = m.teamPlayers(0)[7];
    p.stamina = 0.2;
    // No changes left: nothing offered.
    m.subsUsed[0] = m.maxSubs;
    const full = new QuickSubs(m, 0);
    run(full, 1);
    expect(full.mode).toBe('idle');
    m.subsUsed[0] = 0;
    // Sent off: never offered.
    p.sentOff = true;
    const red = new QuickSubs(m, 0);
    run(red, 1);
    expect(red.mode).toBe('idle');
    p.sentOff = false;
    // Queued, then sent off before the ball goes out: the change is dropped, nobody comes on.
    const q1 = new QuickSubs(m, 0);
    q1.update(DT, true, true);
    q1.accept();
    p.sentOff = true;
    goOut(m);
    run(q1, 1);
    expect(q1.mode).toBe('idle');
    expect(m.subsUsed[0]).toBe(0);
    p.sentOff = false;
    m.phase = 'play';
    // Queued, then the last changes used up in the tactics screen: dropped.
    const q2 = new QuickSubs(m, 0);
    q2.update(DT, true, true);
    q2.accept();
    m.subsUsed[0] = m.maxSubs;
    goOut(m);
    run(q2, 1);
    expect(q2.mode).toBe('idle');
    expect(m.teamPlayers(0)[7].def.id).toBe(p.def.id);
    m.subsUsed[0] = 0;
    m.phase = 'play';
    // Queued, and the tactics screen sent on the man offered for someone else: the next best comes on instead.
    const q3 = new QuickSubs(m, 0);
    q3.update(DT, true, true);
    q3.accept();
    const offered = q3.offer!.on;
    const other = m.teamPlayers(0).find((x) => !x.isKeeper && x.slot !== 7)!;
    expect(m.substitute(0, other.slot, m.bench[0].indexOf(offered))).toBe(true);
    goOut(m);
    run(q3, 0.2);
    expect(q3.mode).toBe('board');
    expect(q3.done!.on).not.toBe(offered);
    expect(m.teamPlayers(0)[7].def).toBe(q3.done!.on);
    expect(m.subsUsed[0]).toBe(2);
    // Queued, and the tactics screen took that very man off already: dropped (nobody else is pulled off).
    m.phase = 'play';
    const q = m.teamPlayers(0)[9];
    q.stamina = 0.2;
    const q4 = new QuickSubs(m, 0);
    q4.update(DT, true, true);
    expect(q4.offer!.idx).toBe(q.idx);
    q4.accept();
    expect(m.substitute(0, q.slot, m.subPick(0, q.slot))).toBe(true);
    goOut(m);
    run(q4, 1);
    expect(q4.mode).toBe('idle');
    expect(m.subsUsed[0]).toBe(3);
  });

  it('offers a man on a yellow too, after the tired ones and only once', () => {
    const m = match();
    const p = m.teamPlayers(0)[6];
    m.booked.add(p.idx);
    const qs = new QuickSubs(m, 0);
    qs.update(DT, true, true);
    expect(qs.offer?.idx).toBe(p.idx);
    expect(qs.offer?.reason).toBe('booked');
    run(qs, QS_SHOW_S + 0.1);
    expect(qs.mode).toBe('idle');
    // Long after: still on his yellow, not offered again for it.
    run(qs, QS_SNOOZE_S * 3);
    expect(qs.mode).toBe('idle');
    // A tired man comes first.
    const m2 = match(5);
    m2.booked.add(m2.teamPlayers(0)[6].idx);
    m2.teamPlayers(0)[8].stamina = 0.3;
    const q2 = new QuickSubs(m2, 0);
    q2.update(DT, true, true);
    expect(q2.offer?.idx).toBe(m2.teamPlayers(0)[8].idx);
  });

  it('is only for an ordinary match against the AI: never online, in a Football Moment or a LEARN THE BASICS step', () => {
    expect(quickSubsAllowed({ humanSide: 0 })).toBe(true);
    expect(quickSubsAllowed({ humanSide: 1 })).toBe(true);
    // Online: both sides human, no substitutions at all.
    const setup = {
      epoch: 0, seed: 7, home: 5, away: 6, mode: 'classic' as const, halfMinutes: 2, timeOfDay: 'day' as const, weather: 'clear' as const,
      controls: [cleanControls(undefined), cleanControls(undefined)] as [ReturnType<typeof cleanControls>, ReturnType<typeof cleanControls>], delay: 2,
    };
    expect(quickSubsAllowed(netConfig(setup, 0))).toBe(false);
    expect(quickSubsAllowed(netConfig(setup, 1))).toBe(false);
    for (const mo of MOMENTS) expect(quickSubsAllowed({ humanSide: mo.spec.humanSide, scenario: mo.spec })).toBe(false);
    for (const b of BASICS) expect(quickSubsAllowed({ humanSide: b.spec.humanSide, scenario: b.spec })).toBe(false);
    // The menu's demo and AI v AI.
    expect(quickSubsAllowed({ humanSide: 0, demo: true })).toBe(false);
    expect(quickSubsAllowed({ humanSide: -1 })).toBe(false);
    // Nor once a knockout tie goes to penalties.
    const m = match();
    m.teamPlayers(0)[7].stamina = 0.2;
    const qs = new QuickSubs(m, 0);
    m.phase = 'shootout';
    run(qs, 1);
    expect(qs.mode).toBe('idle');
  });

  it('Settings > QUICK SUBS: on for new and old saves, an off kept, junk back to on', () => {
    expect(defaultSave().settings.quickSubs).toBe(true);
    const old = { ...defaultSave().settings } as Record<string, unknown>;
    delete old.quickSubs;
    expect(normalizeSettings(old).quickSubs).toBe(true);
    expect(normalizeSettings({ ...old, quickSubs: false }).quickSubs).toBe(false);
    expect(normalizeSettings({ ...old, quickSubs: 'off' }).quickSubs).toBe(true);
  });

  it('in the session: hidden and held over a card close-up, the pause menu or an online driver; no toast for its own change', () => {
    const m = match();
    const p = m.teamPlayers(0)[7];
    p.stamina = 0.2;
    const qs = new QuickSubs(m, 0);
    const card = { qs, update: vi.fn((dt: number, shown: boolean, ready: boolean) => qs.update(dt, shown, ready)) };
    const cam = { mode: 'broadcast', behindActive: false };
    const session = Object.create(MatchSession.prototype) as MatchSession;
    const hud = { commentary: vi.fn(), toastMsg: vi.fn() };
    Object.assign(session, {
      match: m, quick: card, cam, hud, paused: false, driver: null, replay: null, introLeft: 0, holdFirst: false, cineHud: false,
      cardT: 0, foulPresentation: { waiting: false }, moment: null,
      view: { replacePlayer: vi.fn() }, tally: { sub: vi.fn() }, lastPasser: [-1, -1], opt: { kits: [m.teams[0].kit, m.teams[1].kit] },
    });
    const tick = () => (session as unknown as { updateQuickSub(dt: number): void }).updateQuickSub(DT);
    tick();
    expect(card.update).toHaveBeenLastCalledWith(DT, true, true);
    expect(qs.accept()).toBe(true);
    goOut(m);
    m.drainEvents();
    // The referee's card close-up (and the HUD gone cinematic): not shown, not made.
    cam.mode = 'card';
    Object.assign(session, { cardT: 1.5, cineHud: true });
    tick();
    expect(card.update).toHaveBeenLastCalledWith(DT, false, false);
    expect(m.subsUsed[0]).toBe(0);
    // Paused: frozen (no time passes).
    cam.mode = 'broadcast';
    Object.assign(session, { cardT: 0, cineHud: false, paused: true });
    tick();
    expect(card.update).toHaveBeenLastCalledWith(0, false, false);
    expect(m.subsUsed[0]).toBe(0);
    // An online driver never gets one made.
    Object.assign(session, { paused: false, driver: {} });
    tick();
    expect(m.subsUsed[0]).toBe(0);
    // Back to a free picture at the stoppage: made, and its event shows the board, not the "SUB" flag.
    Object.assign(session, { driver: null });
    tick();
    expect(m.subsUsed[0]).toBe(1);
    const events = (list: MatchEvent[]) => (session as unknown as { handleEvents(e: MatchEvent[]): void }).handleEvents(list);
    events(m.drainEvents());
    expect(hud.toastMsg).not.toHaveBeenCalled();
    // Any other change (the tactics screen, an AI bench) keeps its flag.
    const q = m.teamPlayers(0)[9];
    expect(m.substitute(0, q.slot, m.subPick(0, q.slot))).toBe(true);
    events(m.drainEvents());
    expect(hud.toastMsg).toHaveBeenCalledTimes(1);
  });
});
