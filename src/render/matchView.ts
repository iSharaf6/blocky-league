import * as THREE from 'three';
import { lerp, wrapAngle } from '../core/math';
import { BALL_OFS, FRAME_LEN, PF, SENT_OFF_CODE } from '../game/replay';
import { BALL_R } from '../sim/constants';
import type { Kit, PlayerDef, TeamDef } from '../sim/types';
import { CHAR_H, Footballer, PSTATE, buildBallGeometry, charMaterial, screenCharK, setCharacterFill, setCharacterHemiFill, type PoseInput } from './characters';
import { FLOODLIGHT_TOWERS } from './stadium';
import { BoxBuilder } from './voxel';

/**
 * 'full': ring + bobbing arrow + name tag; 'ring': just the ground ring (low set-piece / shootout cameras);
 * 'off': nothing (the card close-up).
 */
export type MarkerMode = 'full' | 'ring' | 'off';

/** Referee signals: arm raised (foul / offside), advantage (both arms forward), a card held high. */
export type RefSignal = 'arm' | 'advantage' | 'card';

export const CARD_YELLOW = 0xffd43b;
export const CARD_RED = 0xe03131;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Outfield players (every index but the two keepers, 0 and 11): the ones that get a team ring. */
const RING_IDX = Array.from({ length: 22 }, (_, i) => i).filter((i) => i !== 0 && i !== 11);

/** Night: camera-side fill light on the footballers (light units; see characters.setCharacterFill). */
const NIGHT_CHAR_FILL = 0.6;
/** Sunset: neutral sky fill on the footballers, so kits and skin stay true under the orange key. */
const SUNSET_CHAR_HEMI = 0.35;
/** Team ring under every outfield player: radii (m, before the draw scale) and opacity. */
const TEAM_RING_IN = 0.4;
const TEAM_RING_OUT = 0.56;
const TEAM_RING_ALPHA = 0.45;
/** The referee's card (the chunky 1.4x mesh), scaled down so the close-up reads as a card, not a sign. */
const CARD_SCALE = 0.35;
/** ...and turned this far (rad, about the raised arm) from facing the offender towards the lens side. */
const CARD_TURN = -1.3;

/** Everything that draws a match: 22 voxel footballers, the ball, and the control marker. */
export class MatchView {
  readonly group = new THREE.Group();
  readonly players: Footballer[] = [];
  readonly ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private marker: THREE.Group;
  private markerRing: THREE.Mesh;
  private arrow: THREE.Mesh;
  private powerBar: THREE.Group;
  private nameTag: THREE.Sprite;
  private nameCanvas: HTMLCanvasElement;
  private nameTex: THREE.CanvasTexture;
  private nameFor = -1;
  private targetRing: THREE.Mesh;
  private aim: THREE.Mesh;
  private names: string[] = [];
  private referee: Footballer;
  private ref = { x: -8, z: -10, vx: 0, vz: 0, facing: 0, phase: 0, signal: 0, kind: 'arm' as RefSignal, hold: 0, faceX: 0, faceZ: 0 };
  /** The card in the referee's raised hand (yellow / red), shown only while he books someone. */
  private cards: { yellow: THREE.Mesh; red: THREE.Mesh };
  /** Draw scale on top of CHAR_SCALE (bigger on phones); refreshed every frame. */
  private charK = 1;
  private powerFill: THREE.Mesh;
  private markerMode: MarkerMode = 'full';
  private charging = false;
  /** Night: four faint floodlight shadows per player, one away from each tower. */
  private floodShadows: THREE.InstancedMesh | null = null;
  /** Team-coloured ground ring under each outfield player (instance k: outfield player RING_IDX[k]). */
  private teamRings: THREE.InstancedMesh;
  private ringsOn = true;
  /** Power bar at the shooter's feet (over-the-shoulder set-piece lens) rather than over his head. */
  private powerLow = false;
  private powerAt = new THREE.Vector3();
  private towers: readonly { x: number; z: number; h: number }[] = FLOODLIGHT_TOWERS;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v3 = new THREE.Vector3();
  private s3 = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private ballQuat = new THREE.Quaternion();
  private tmpQ = new THREE.Quaternion();
  private axis = new THREE.Vector3();
  private pose: PoseInput = {
    state: 0, stateT: 0, speed: 0, runPhase: 0, kickT: 0, kickLeg: 1, lean: 0, diveDir: 0, headerT: 0,
    celebrate: 0, y: 0, keeper: false, hasBall: false, look: 0, turn: 0,
  };
  private lastFacing = new Float32Array(22);
  /**
   * Players held on a mark for a close-up (the booked player facing the referee, the man he brought down
   * standing off to one side), render only.
   */
  private pinned: { i: number; x: number; z: number; facing: number }[] = [];
  /** The ball kept out of a low close-up it would sit right in front of (the card shot). */
  private ballHidden = false;
  /** Players faded out of a latched close-up (see fadeNearLens). */
  private fadeLatch = new Set<number>();
  private turnRate = new Float32Array(22);
  /** Interpolated frame the renderer last drew (read by camera, HUD). */
  readonly frame: Float32Array;

  constructor(teams: [TeamDef, TeamDef], kits: [Kit, Kit], humanSide: number) {
    for (let s = 0; s < 2; s++) {
      teams[s].players.forEach((def, i) => {
        const f = new Footballer(def, kits[s], i === 0);
        this.players.push(f);
        this.group.add(f.group);
      });
    }
    this.frame = new Float32Array(FRAME_LEN);
    const refKit: Kit = { shirt: 0x2a2a30, shirt2: 0xffd23a, pattern: 'plain', shorts: 0x2a2a30, socks: 0x2a2a30, gk: 0x2a2a30 };
    const refDef: PlayerDef = {
      id: 'ref', name: 'Referee', number: -1, role: 'MF',
      stats: { pace: 70, shooting: 1, passing: 1, dribbling: 1, defending: 1, keeping: 1, stamina: 90 },
      look: { skin: 2, hair: 1, hairColor: 6, beard: 0, boots: 0x2a2a30 },
    };
    this.referee = new Footballer(refDef, refKit, false);
    this.group.add(this.referee.group);
    const card = (color: number) => {
      const b = new BoxBuilder();
      // A chunky card held up past the fingertips (the arms are short), face on to the offender (model +x),
      // thick enough to read from the side too; 1.4x life size so it reads in the close-up.
      b.box(0.03, -0.42, 0, 0.14, 0.84, 0.56, color);
      // Unlit: held up in the referee's own shadow it would otherwise read olive / maroon, not yellow / red.
      const m = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
      m.castShadow = true;
      m.visible = false;
      m.scale.setScalar(CARD_SCALE);
      // Turned part way from the offender towards the close-up lens (which films from the card-hand side),
      // so the card reads as a card, not a coloured sliver seen edge-on.
      m.rotation.y = CARD_TURN;
      this.referee.holdInHand(m, true);
      return m;
    };
    this.cards = { yellow: card(CARD_YELLOW), red: card(CARD_RED) };
    // The ball shares the footballers' material: it gets their night fill too.
    this.ball = new THREE.Mesh(buildBallGeometry(BALL_R * 1.25), charMaterial);
    this.ball.castShadow = true;
    this.group.add(this.ball);
    // A soft blob keeps the ball readable when high in the air.
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x1e3312, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    blob.position.y = 0.02;
    this.ballShadow = blob;
    this.group.add(blob);

    // Team rings: a flat, see-through ring in the shirt colour under every outfield player, so the two sides
    // read at a glance (one instanced draw; lifted off the lawn and polygon-offset, so no z-fighting).
    const ringGeo = new THREE.RingGeometry(TEAM_RING_IN, TEAM_RING_OUT, 20).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: TEAM_RING_ALPHA, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.teamRings = new THREE.InstancedMesh(ringGeo, ringMat, RING_IDX.length);
    this.teamRings.frustumCulled = false;
    this.teamRings.renderOrder = 2;
    const rc = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    RING_IDX.forEach((i, k) => {
      // Dark shirts (navy, black) would vanish into the lawn at 45%: their ring is the same hue, lifted.
      rc.setHex(kits[i < 11 ? 0 : 1].shirt).getHSL(hsl);
      if (hsl.l < 0.5) rc.setHSL(hsl.h, hsl.s, 0.5);
      this.teamRings.setColorAt(k, rc);
    });
    if (this.teamRings.instanceColor) this.teamRings.instanceColor.needsUpdate = true;
    this.group.add(this.teamRings);

    // Control marker: a chunky square ring + bobbing arrow in the human's colour.
    const markColor = humanSide >= 0 ? 0xffd23a : 0xffffff;
    this.marker = new THREE.Group();
    const rb = new BoxBuilder();
    const r = 0.62, t = 0.12;
    rb.box(0, 0, -r, r * 2 + t, 0.03, t, markColor);
    rb.box(0, 0, r, r * 2 + t, 0.03, t, markColor);
    rb.box(-r, 0, 0, t, 0.03, r * 2, markColor);
    rb.box(r, 0, 0, t, 0.03, r * 2, markColor);
    rb.box(r + 0.28, 0, 0, 0.3, 0.03, 0.26, markColor);
    this.markerRing = new THREE.Mesh(rb.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.markerRing.position.y = 0.04;
    this.marker.add(this.markerRing);
    const ab = new BoxBuilder();
    ab.box(0, 0.36, 0, 0.44, 0.12, 0.44, markColor);
    ab.box(0, 0.24, 0, 0.3, 0.12, 0.3, markColor);
    ab.box(0, 0.12, 0, 0.16, 0.12, 0.16, markColor);
    this.arrow = new THREE.Mesh(ab.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.marker.add(this.arrow);
    // Surname tag floating over the controlled player, broadcast style.
    this.nameCanvas = document.createElement('canvas');
    this.nameCanvas.width = 256;
    this.nameCanvas.height = 48;
    this.nameTex = new THREE.CanvasTexture(this.nameCanvas);
    this.nameTex.colorSpace = THREE.SRGBColorSpace;
    this.nameTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.nameTex, depthTest: false, transparent: true }));
    this.nameTag.scale.set(2.4, 0.45, 1);
    this.nameTag.renderOrder = 10;
    this.marker.add(this.nameTag);
    for (let s = 0; s < 2; s++) for (const p of teams[s].players) this.names.push(p.name.split('. ').pop()!.toUpperCase());
    this.group.add(this.marker);
    this.marker.visible = humanSide >= 0;

    // Ring on the intended receiver of a pass.
    const tb = new BoxBuilder();
    const tr = 0.55, tt = 0.08;
    tb.box(0, 0, -tr, tr * 2 + tt, 0.02, tt, 0xffffff);
    tb.box(0, 0, tr, tr * 2 + tt, 0.02, tt, 0xffffff);
    tb.box(-tr, 0, 0, tt, 0.02, tr * 2, 0xffffff);
    tb.box(tr, 0, 0, tt, 0.02, tr * 2, 0xffffff);
    this.targetRing = new THREE.Mesh(tb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
    this.targetRing.position.y = 0.05;
    this.targetRing.visible = false;
    this.group.add(this.targetRing);

    // Set-piece aim: a dashed chunky arrow along the taker's facing.
    const ab2 = new BoxBuilder();
    for (let i = 0; i < 6; i++) ab2.box(1.0 + i * 0.9, 0, 0, 0.55, 0.02, 0.22, 0xffd23a);
    ab2.box(6.6, 0, 0, 0.3, 0.02, 0.9, 0xffd23a);
    ab2.box(6.9, 0, 0, 0.3, 0.02, 0.55, 0xffd23a);
    ab2.box(7.2, 0, 0, 0.3, 0.02, 0.22, 0xffd23a);
    // Drawn over everything (depthTest off, late render order): a wall or a team-mate standing on the line
    // never hides where the kick is going.
    this.aim = new THREE.Mesh(
      ab2.build(),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, fog: false }),
    );
    this.aim.renderOrder = 9;
    this.aim.position.y = 0.06;
    this.aim.visible = false;
    this.group.add(this.aim);

    // Shot power: a chunky billboard bar over the shooter (outline, track, fill, 60% / 85% ticks).
    this.powerBar = new THREE.Group();
    const flat = (w: number, h: number, color: number, order: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, fog: false }),
      );
      m.renderOrder = order;
      return m;
    };
    const BAR_W = 2.2;
    const BAR_H = 0.28;
    const edge = flat(BAR_W + 0.1, BAR_H + 0.1, 0xfbfbf4, 11);
    const track = flat(BAR_W, BAR_H, 0x26262e, 12);
    this.powerFill = flat(BAR_W - 0.08, BAR_H - 0.08, 0x3aff9e, 13);
    this.powerFill.geometry.translate((BAR_W - 0.08) / 2, 0, 0);
    this.powerFill.position.x = -(BAR_W - 0.08) / 2;
    this.powerBar.add(edge, track, this.powerFill);
    for (const k of [0.6, 0.85]) {
      const tick = flat(0.04, BAR_H - 0.02, 0xfbfbf4, 14);
      tick.position.x = -(BAR_W - 0.08) / 2 + (BAR_W - 0.08) * k;
      this.powerBar.add(tick);
    }
    this.powerBar.visible = false;
    this.group.add(this.powerBar);
  }

  /** Blend frames a→b and pose everything. */
  apply(a: Float32Array, b: Float32Array, alpha: number, time: number, dt: number): void {
    const f = this.frame;
    for (let i = 0; i < a.length; i++) f[i] = a[i];
    for (let i = 0; i < 22; i++) {
      const o = i * PF;
      // Only blend continuous channels; discrete ones take the newer frame.
      f[o] = lerp(a[o], b[o], alpha);
      f[o + 1] = lerp(a[o + 1], b[o + 1], alpha);
      f[o + 2] = lerp(a[o + 2], b[o + 2], alpha);
      f[o + 3] = a[o + 3] + wrapAngle(b[o + 3] - a[o + 3]) * alpha;
      for (const k of [4, 9, 11, 13, 14]) f[o + k] = b[o + k];
      f[o + 5] = b[o + 4] === a[o + 4] ? lerp(a[o + 5], b[o + 5], alpha) : b[o + 5];
      const dp = b[o + 6] - a[o + 6];
      f[o + 6] = a[o + 6] + (dp < -0.5 ? dp + 1 : dp) * alpha;
      f[o + 7] = lerp(a[o + 7], b[o + 7], alpha);
      f[o + 8] = lerp(a[o + 8], b[o + 8], alpha);
      f[o + 10] = lerp(a[o + 10], b[o + 10], alpha);
      f[o + 12] = lerp(a[o + 12], b[o + 12], alpha);
    }
    for (let k = 0; k < 6; k++) f[BALL_OFS + k] = lerp(a[BALL_OFS + k], b[BALL_OFS + k], alpha);
    for (let k = 6; k < 11; k++) f[BALL_OFS + k] = b[BALL_OFS + k];
    for (const pin of this.pinned) {
      // Stood still on his mark, facing the referee (the sim is already walking him to the free kick).
      const o = pin.i * PF;
      f[o] = pin.x;
      f[o + 1] = pin.z;
      f[o + 2] = 0;
      f[o + 3] = pin.facing;
      f[o + 7] = 0;
      if (f[o + 4] !== SENT_OFF_CODE && f[o + 4] !== PSTATE.dejected) f[o + 4] = PSTATE.move;
    }

    const pose = this.pose;
    this.charK = screenCharK();
    for (let i = 0; i < 22; i++) {
      const o = i * PF;
      const fb = this.players[i];
      fb.scaleK = this.charK;
      fb.group.position.set(f[o], 0, f[o + 1]);
      fb.group.rotation.y = -f[o + 3];
      pose.y = f[o + 2];
      // Sent off: the sim parks him beside his dugout; he just stands there, hands on head.
      pose.state = f[o + 4] === SENT_OFF_CODE ? PSTATE.dejected : f[o + 4];
      pose.stateT = f[o + 5];
      pose.runPhase = f[o + 6];
      pose.speed = f[o + 7];
      pose.kickT = f[o + 8];
      pose.kickLeg = f[o + 9];
      pose.lean = f[o + 10];
      pose.diveDir = f[o + 11];
      pose.headerT = f[o + 12];
      pose.celebrate = f[o + 13];
      pose.hasBall = f[o + 14] > 0.5;
      pose.keeper = i === 0 || i === 11;
      const bearing = Math.atan2(f[BALL_OFS + 2] - f[o + 1], f[BALL_OFS] - f[o]);
      // Model left is -z; our facing angle grows towards +z, so negate for "left positive". Someone held on a
      // mark for a close-up looks where he faces (at the referee), not at the ball.
      pose.look = this.pinned.length && this.pinned.some((p) => p.i === i) ? 0 : -wrapAngle(bearing - f[o + 3]);
      if (dt > 0) {
        const dF = wrapAngle(f[o + 3] - this.lastFacing[i]) / dt;
        this.turnRate[i] += (Math.max(-12, Math.min(12, -dF)) - this.turnRate[i]) * Math.min(1, dt * 8);
      }
      this.lastFacing[i] = f[o + 3];
      pose.turn = this.turnRate[i];
      fb.pose(pose, time + i * 0.37);
    }
    if (this.teamRings.visible) this.updateTeamRings();

    // Ball: position plus rolling rotation integrated from its velocity.
    const bx = f[BALL_OFS], by = f[BALL_OFS + 1], bz = f[BALL_OFS + 2];
    const vx = f[BALL_OFS + 3], vy = f[BALL_OFS + 4], vz = f[BALL_OFS + 5];
    this.ball.position.set(bx, by, bz);
    const sp = Math.hypot(vx, vz);
    if (sp > 0.05 && f[BALL_OFS + 6] < 0.5) {
      this.axis.set(vz, 0, -vx).normalize();
      this.tmpQ.setFromAxisAngle(this.axis, (sp / (BALL_R * 1.25)) * dt);
      this.ballQuat.premultiply(this.tmpQ);
      this.ball.quaternion.copy(this.ballQuat);
    }
    void vy;
    this.ball.visible = !this.ballHidden;
    this.ballShadow.position.set(bx, 0.02, bz);
    // Contact shadow straight under the ball: shrinks and fades with height so you can read it.
    const hs = Math.max(0.4, 1 - by * 0.1);
    this.ballShadow.scale.set(hs, hs, hs);
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = 0.3 * Math.max(0.35, 1 - by * 0.08);
    this.ballShadow.visible = f[BALL_OFS + 6] < 0.5 && !this.ballHidden;

    // Marker on the human-controlled player.
    const active = f[BALL_OFS + 8];
    if (this.marker.visible !== false && active >= 0) {
      const o = active * PF;
      this.marker.position.set(f[o], 0, f[o + 1]);
      this.markerRing.rotation.y = -f[o + 3];
      const top = this.headTop;
      this.arrow.position.y = top + 0.5 + f[o + 2] + Math.abs(Math.sin(time * 5)) * 0.18;
      this.nameTag.position.y = top + 1.3 + f[o + 2];
      if (active !== this.nameFor) this.drawName(active);
    }
    const full = this.markerMode === 'full';
    this.arrow.visible = full && !this.charging;
    this.nameTag.visible = full;
    this.markerRing.visible = this.markerMode !== 'off';
    if (this.floodShadows?.visible) this.updateFloodShadows();
    const pt = f[BALL_OFS + 10];
    const human = active >= 0 ? (active < 11 ? 0 : 1) : -1;
    if (this.marker.visible && pt >= 0 && pt !== active && (pt < 11 ? 0 : 1) === human) {
      this.targetRing.visible = true;
      this.targetRing.position.x = f[pt * PF];
      this.targetRing.position.z = f[pt * PF + 1];
      const pulse = 1 + Math.sin(time * 10) * 0.08;
      this.targetRing.scale.set(pulse, 1, pulse);
    } else {
      this.targetRing.visible = false;
    }
  }

  /** The referee jogs a diagonal about 10 m from the ball and signals fouls. */
  updateReferee(dt: number, time: number, visible: boolean): void {
    const g = this.referee.group;
    g.visible = visible;
    if (!visible || dt <= 0) return;
    const f = this.frame;
    const bx = f[BALL_OFS];
    const bz = f[BALL_OFS + 2];
    const r = this.ref;
    r.hold = Math.max(0, r.hold - dt);
    const tx = Math.max(-44, Math.min(44, bx - 7));
    const tz = Math.max(-26, Math.min(26, bz > 0 ? bz - 11 : bz + 11));
    const dx = tx - r.x;
    const dz = tz - r.z;
    const d = Math.hypot(dx, dz);
    // Booking someone: he stands his ground, facing the offender, until the card goes away.
    const want = r.hold > 0 || d < 1.2 ? 0 : Math.min(7, d * 1.2);
    const k = Math.min(1, dt * 3);
    r.vx += ((d > 0 ? (dx / d) * want : 0) - r.vx) * k;
    r.vz += ((d > 0 ? (dz / d) * want : 0) - r.vz) * k;
    r.x += r.vx * dt;
    r.z += r.vz * dt;
    const sp = Math.hypot(r.vx, r.vz);
    const faceTo = r.hold > 0 ? Math.atan2(r.faceZ - r.z, r.faceX - r.x) : sp > 1.2 ? Math.atan2(r.vz, r.vx) : Math.atan2(bz - r.z, bx - r.x);
    r.facing += wrapAngle(faceTo - r.facing) * Math.min(1, dt * 6);
    r.phase = (r.phase + (sp * dt) / 2.1) % 1;
    r.signal = Math.max(0, r.signal - dt);
    g.position.set(r.x, 0, r.z);
    g.rotation.y = -r.facing;
    this.referee.scaleK = this.charK;
    const booking = r.signal > 0 && r.kind === 'card';
    this.cards.yellow.visible = booking && this.cardColor === 'yellow';
    this.cards.red.visible = booking && this.cardColor === 'red';
    const pose = this.pose;
    pose.state = 0; pose.stateT = 0; pose.speed = sp; pose.runPhase = r.phase; pose.kickT = 0; pose.kickLeg = 1;
    pose.lean = Math.min(0.3, sp * 0.03); pose.diveDir = 0; pose.headerT = 0; pose.celebrate = 0; pose.y = 0;
    pose.keeper = false; pose.hasBall = false; pose.turn = 0;
    pose.look = -wrapAngle(Math.atan2(bz - r.z, bx - r.x) - r.facing);
    pose.signal = r.signal > 0;
    pose.signalKind = r.kind === 'advantage' ? 1 : r.kind === 'card' ? 2 : 0;
    this.referee.pose(pose, time);
    pose.signal = false;
    pose.signalKind = 0;
  }

  private cardColor: 'yellow' | 'red' = 'yellow';

  /** Arm signal for a foul / offside (or advantage: both arms forward) for `seconds`. */
  refSignal(seconds: number, kind: RefSignal = 'arm'): void {
    // A card being shown outranks a quick arm signal.
    if (this.ref.kind === 'card' && this.ref.signal > 0 && kind !== 'card') return;
    this.ref.signal = seconds;
    this.ref.kind = kind;
  }

  /**
   * Book a player: the referee stands ~2.4 m from the offence (x, z), faces it and holds the card up for
   * `seconds`. He is moved there directly: this is only called as the camera cuts to the close-up.
   */
  showCard(color: 'yellow' | 'red', x: number, z: number, seconds: number, jump = true): void {
    const r = this.ref;
    this.cardColor = color;
    this.refSignal(seconds, 'card');
    r.hold = seconds;
    r.faceX = x;
    r.faceZ = z;
    if (jump) {
      let dx = r.x - x;
      let dz = r.z - z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      r.x = Math.max(-51, Math.min(51, x + dx * 2.4));
      r.z = Math.max(-33, Math.min(33, z + dz * 2.4));
      r.vx = r.vz = 0;
      r.facing = Math.atan2(z - r.z, x - r.x);
    }
  }

  /**
   * Hold player `i` on (x, z) facing the referee for a close-up (render only: the camera cuts away before he
   * is let go, so the jump to where the sim has walked him is never seen). null lets him go.
   */
  pinPlayer(i: number | null, x = 0, z = 0): void {
    if (i === null || i < 0) {
      this.pinned = [];
      return;
    }
    const r = this.ref;
    this.pinned = this.pinned.filter((p) => p.i !== i);
    this.pinned.push({ i, x, z, facing: Math.atan2(r.z - z, r.x - x) });
  }

  /** Keep the ball out of shot (a low close-up it would sit right in front of), or show it again. */
  setBallHidden(hidden: boolean): void {
    this.ballHidden = hidden;
    this.ball.visible = !hidden;
    if (hidden) this.ballShadow.visible = false;
  }

  /** Where the referee stands and whom he faces (card close-ups). */
  get refState(): { x: number; z: number; faceX: number; faceZ: number; booking: boolean } {
    const r = this.ref;
    return { x: r.x, z: r.z, faceX: r.faceX, faceZ: r.faceZ, booking: r.kind === 'card' && r.signal > 0 };
  }

  /**
   * Low lenses: players within `radius` (ground metres) of the lens at (cx, cz), or standing within `sightW`
   * of the sight line from it to any of `sight`, fade to `alpha` (back to solid over the next metre / half
   * metre); `keep` (the taker, the offender) never fade. `latch` (a short, static close-up): anyone who
   * starts to fade goes all the way and stays gone until clearFades(), so no ghost lingers at the edge.
   * Fading right out (`alpha` 0) is all or nothing, eased over ~0.15 s of `dt` (at once when `snap`: the
   * camera has just cut), so nobody stands about half see-through at the edge of the zone.
   */
  fadeNearLens(
    cx: number, cz: number, radius: number, alpha: number, keep: number[], sight: { x: number; z: number }[], sightW = 0.85, latch = false,
    dt = 0, snap = true,
  ): void {
    const f = this.frame;
    const set = (fb: Footballer, a: number) => {
      if (alpha > 0 || snap) fb.setOpacity(a);
      else if (dt > 0) fb.setOpacity(fb.opacity + (a - fb.opacity) * Math.min(1, dt * 7));
    };
    for (let i = 0; i < 22; i++) {
      const fb = this.players[i];
      if (keep.includes(i)) {
        set(fb, 1);
        continue;
      }
      if (latch && this.fadeLatch.has(i)) {
        set(fb, alpha);
        continue;
      }
      const x = f[i * PF];
      const z = f[i * PF + 1];
      const dc = Math.hypot(x - cx, z - cz);
      // Full fade inside the radius, back to solid over the next metre; right at the lens nearly gone.
      let k = dc <= radius ? 0 : Math.min(1, (dc - radius) / 1);
      if (dc < radius * 0.5) {
        if (latch) this.fadeLatch.add(i);
        // (`alpha` is the floor: a replay's goal-line lens never takes anyone below it.)
        set(fb, alpha);
        continue;
      }
      for (const t of sight) {
        const lx = t.x - cx;
        const lz = t.z - cz;
        const l2 = lx * lx + lz * lz || 1;
        const u = ((x - cx) * lx + (z - cz) * lz) / l2;
        if (u < 0.02 || u > 0.97) continue;
        const d = Math.hypot(x - (cx + lx * u), z - (cz + lz * u));
        k = Math.min(k, clamp01((d - sightW) / 0.5));
      }
      if (latch && k < 0.999) {
        this.fadeLatch.add(i);
        k = 0;
      }
      set(fb, alpha > 0 ? alpha + (1 - alpha) * k : k < 0.5 ? 0 : 1);
    }
  }

  /** Everyone solid again (the low camera has cut away). */
  clearFades(): void {
    this.fadeLatch.clear();
    for (const fb of this.players) if (fb.opacity < 1) fb.setOpacity(1);
  }

  /** Top of a standing player's head (m) at the current draw scale. */
  get headTop(): number {
    return CHAR_H * this.charK;
  }

  /** Swap the model for a substitute coming on (a no-op if that player is already drawn). */
  replacePlayer(i: number, def: PlayerDef, kit: Kit): void {
    const old = this.players[i];
    if (!old || old.def === def) return;
    const f = new Footballer(def, kit, i === 0 || i === 11);
    f.group.position.copy(old.group.position);
    f.group.rotation.copy(old.group.rotation);
    old.dispose();
    this.players[i] = f;
    this.group.add(f.group);
    this.names[i] = def.name.split('. ').pop()!.toUpperCase();
    if (this.nameFor === i) this.nameFor = -1;
  }

  /** Show the set-piece aim arrow from (x, z) along `angle` (radians, world facing). */
  setAim(on: boolean, x = 0, z = 0, angle = 0, length = 1): void {
    this.aim.visible = on;
    if (!on) return;
    this.aim.position.x = x;
    this.aim.position.z = z;
    this.aim.rotation.y = -angle;
    this.aim.scale.x = length;
  }

  setMarkerVisible(v: boolean): void {
    this.marker.visible = v;
    if (!v) this.targetRing.visible = false;
  }

  /**
   * Low cameras (behind-the-ball set pieces, shootout) keep only the ground ring: no tag or arrow over the
   * goal; the card close-up shows no marker at all.
   */
  setMarkerMode(mode: MarkerMode): void {
    this.markerMode = mode;
    this.arrow.visible = mode === 'full' && !this.charging;
    this.nameTag.visible = mode === 'full';
    this.markerRing.visible = mode !== 'off';
  }

  /** Team rings under the outfield players: on for the broadcast shot, off for close-ups and replays. */
  setTeamRings(on: boolean): void {
    if (on === this.ringsOn) return;
    this.ringsOn = on;
    this.teamRings.visible = on;
    if (on) this.updateTeamRings();
  }

  private updateTeamRings(): void {
    const im = this.teamRings;
    const f = this.frame;
    const k = this.charK;
    this.q.identity();
    RING_IDX.forEach((i, n) => {
      const o = i * PF;
      // Shrinks away under a jump; gone for a player sent off (parked by his dugout) or faded out of a lens.
      const s = f[o + 4] === SENT_OFF_CODE || this.players[i].opacity < 0.5 ? 0 : k * Math.max(0.5, 1 - f[o + 2] * 0.5);
      this.m4.compose(this.v3.set(f[o], 0.03, f[o + 1]), this.q, this.s3.set(s, 1, s));
      im.setMatrixAt(n, this.m4);
    });
    im.instanceMatrix.needsUpdate = true;
  }

  /**
   * Night adds faint floodlight shadows (one per light tower: the corner masts, or a small ground's portable
   * lamps; all of them together darken the grass under a player by ~25% at most) and a camera-side fill on
   * the players, so they read as lit figures on the bright floodlit lawn rather than dark silhouettes.
   */
  setTimeOfDay(t: 'day' | 'sunset' | 'night', towers: readonly { x: number; z: number; h: number }[] = FLOODLIGHT_TOWERS): void {
    const night = t === 'night';
    this.towers = towers;
    setCharacterFill(night ? NIGHT_CHAR_FILL : 0);
    setCharacterHemiFill(t === 'sunset' ? SUNSET_CHAR_HEMI : 0);
    if (night && !this.floodShadows) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(c);
      const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x0c1428, alphaMap: tex, transparent: true, opacity: 0.25 / Math.max(1, towers.length), depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      this.floodShadows = new THREE.InstancedMesh(geo, mat, 22 * towers.length);
      this.floodShadows.frustumCulled = false;
      this.floodShadows.renderOrder = 1;
      this.group.add(this.floodShadows);
    }
    if (this.floodShadows) this.floodShadows.visible = night;
  }

  private updateFloodShadows(): void {
    const im = this.floodShadows!;
    const f = this.frame;
    let n = 0;
    for (let i = 0; i < 22; i++) {
      const o = i * PF;
      const x = f[o];
      const z = f[o + 1];
      const lift = Math.max(0, 1 - f[o + 2] * 0.6);
      for (const t of this.towers) {
        const dx = x - t.x;
        const dz = z - t.z;
        const d = Math.hypot(dx, dz) || 1;
        // A 2 m player under a ~28 m mast: long, soft, faint shadows pointing away from each tower.
        const len = Math.min(2.8, Math.max(1.2, (1.6 * d) / t.h));
        const ux = dx / d;
        const uz = dz / d;
        this.q.setFromAxisAngle(this.up, Math.atan2(-uz, ux));
        const s = lift;
        this.m4.compose(
          this.v3.set(x + ux * len * 0.45, 0.03, z + uz * len * 0.45),
          this.q,
          this.s3.set(len * s, 1, 0.62 * s),
        );
        im.setMatrixAt(n++, this.m4);
      }
    }
    im.instanceMatrix.needsUpdate = true;
  }

  private drawName(idx: number): void {
    this.nameFor = idx;
    const c = this.nameCanvas;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const name = this.names[idx] ?? '';
    g.font = '400 30px "Lilita One", "Arial Rounded MT Bold", sans-serif';
    const w = Math.min(c.width - 8, g.measureText(name).width + 22);
    const x = (c.width - w) / 2;
    g.fillStyle = 'rgba(38,38,46,0.82)';
    g.fillRect(x, 6, w, 36);
    g.fillStyle = '#ffd23a';
    g.fillRect(x, 38, w, 4);
    g.fillStyle = '#fbfbf4';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, c.width / 2, 25);
    this.nameTex.needsUpdate = true;
  }

  /**
   * Shot power bar for the shooter at (x, z) (height y), or hidden (null). Normally just over his head,
   * where the (hidden) arrow bobs; `low` (the over-the-shoulder set-piece lens, where over his head is the
   * goal mouth) puts it at his feet instead, a little smaller and on the lens side of his boots.
   */
  setPower(p: number | null, x: number, z: number, y = 0, low = false): void {
    if (p === null || p <= 0) {
      this.powerBar.visible = false;
      this.charging = false;
      return;
    }
    this.charging = true;
    this.powerBar.visible = true;
    this.powerLow = low;
    this.powerAt.set(x, low ? 0.12 : this.headTop + 0.5 + y, z);
    this.powerBar.position.copy(this.powerAt);
    this.powerBar.scale.setScalar(low ? 0.7 : 1);
    this.powerFill.scale.x = Math.max(0.02, p);
    const m = this.powerFill.material as THREE.MeshBasicMaterial;
    m.color.setHex(p < 0.6 ? 0x3aff9e : p < 0.85 ? 0xffd23a : 0xff4a3a);
  }

  faceCamera(cam: THREE.Camera): void {
    this.powerBar.quaternion.copy(cam.quaternion);
    if (this.powerLow && this.powerBar.visible) {
      // At his feet: stepped 0.9 m towards the lens along the ground, so it sits just under his boots on
      // screen rather than across them.
      const dx = cam.position.x - this.powerAt.x;
      const dz = cam.position.z - this.powerAt.z;
      const d = Math.hypot(dx, dz) || 1;
      this.powerBar.position.set(this.powerAt.x + (dx / d) * 0.9, this.powerAt.y, this.powerAt.z + (dz / d) * 0.9);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
