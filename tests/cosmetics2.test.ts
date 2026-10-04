import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  DECOR_IDS, DECOR_SLOT_OF, KIT_IDS, LOOK_IDS, LOOK_SLOT_OF, PASS_IDS, defaultSave, normalizeSettings, normalizeShop, type SaveData,
} from '../src/core/save';
import { readColor, readKit } from '../src/game/kitContrast';
import { PRESET_CLUBS, grassLike, makeTeam } from '../src/meta/data';
import {
  BUNDLES, BUNDLE_OFF, buyBundle, bundleMissing, bundlePrice, bundleValue, equipItem, equippedIn, equippedSlots, featuredShelf, grantItem,
  isEquipped, owns, setsInProgress, shopItem, shopItems, unequipItem, weekOf,
} from '../src/meta/shop';
import { captainOf, decorOf, styleMatch } from '../src/meta/style';
import { Footballer, VU } from '../src/render/characters';
import { FxKit } from '../src/render/fx/kit';
import { DRAGON_BREATH, KICKOFF_SHOWS } from '../src/render/fx/stadiumFx';
import { bootStep } from '../src/render/fx/trails';
import { KIT_DESIGNS, designKit, designOf, kitDesign, paintTorso, type StyledKit } from '../src/render/kitDesigns';
import { HAIR_LOOKS, armbandCell, bootCell, gloveCell, headgearGeometry, isHeadgear, paintHair, shadesGeometry } from '../src/render/looks';
import { nameBitmap } from '../src/render/stadiumStyle';
import { VoxelGrid } from '../src/render/voxel';
import type { Kit } from '../src/sim/types';

/**
 * COSMETICS 2.0 (the owner: "the store cosmetics is not unqiue at all, every other thing looks like a different
 * colour"): premium kits, player looks, stadium style and themed sets. Every kit is its own design (not a recolour),
 * every look builds, nothing changes play, the kits stay readable (never grass green, never the referee's charcoal,
 * the clash fixed on the other side), and the sets are honest (their price is the parts you lack, at a fixed discount).
 */

const RED: Kit = { shirt: 0xe8443a, shirt2: 0xfbfbf4, pattern: 'plain', shorts: 0xfbfbf4, socks: 0xe8443a, gk: 0x2a2a30 };

function rich(coins = 1_000_000): SaveData {
  const s = defaultSave();
  s.coins = coins;
  return s;
}

describe('premium kits', () => {
  const ids = KIT_IDS.filter((id) => id !== 'club');

  it('every kit id has a design (Big Crest from your own colours), every one is in the shop', () => {
    for (const id of ids) {
      expect(kitDesign(id, RED), id).not.toBeNull();
      expect(shopItem('kit', id), id).toBeDefined();
    }
    expect(kitDesign('club', RED)).toBeNull();
    expect(kitDesign('nope', RED)).toBeNull();
    expect(kitDesign('crest', RED)!.shirt).toBe(RED.shirt);
  });

  it('is its own design, not a recolour: no two kits paint the same pattern in other colours', () => {
    // The torso's pattern with the colours replaced by the order they first appear: two recolours match exactly.
    const sig = (id: string): string => {
      const g = new VoxelGrid(5, 7, 8);
      paintTorso(g, kitDesign(id, RED)!, 2);
      const seen = new Map<number, number>();
      let out = '';
      for (let i = 0; i < g.data.length; i++) {
        const c = g.data[i] & 0xffffff;
        if (!seen.has(c)) seen.set(c, seen.size);
        out += `${seen.get(c)},${(g.data[i] >>> 25) & 7};`;
      }
      return out;
    };
    const sigs = new Map<string, string>();
    for (const id of ids) {
      const s = sig(id);
      expect(sigs.get(s), `${id} paints like ${sigs.get(s)}`).toBeUndefined();
      sigs.set(s, id);
    }
  });

  it('stays readable: never grass green, never the referee (dark and colourless), clashes fixed on the other side', () => {
    const ref = readColor(0x2a2a30);
    const GREEN: Kit = { shirt: 0x3cc15a, shirt2: 0xfbfbf4, pattern: 'stripes', shorts: 0x3cc15a, socks: 0x3cc15a, gk: 0xff8a2b };
    // (Big Crest is made from your own colours: a green club's is still never green on green.)
    expect(grassLike(designKit('crest', GREEN).shirt)).toBe(false);
    expect(designOf(designKit('crest', GREEN))?.id).toBe('crest');
    for (const id of ids) {
      const k = designKit(id, RED);
      expect(grassLike(k.shirt), id).toBe(false);
      const r = readKit(k);
      // Clearly lighter than the referee's charcoal, or clearly coloured.
      expect(r.l - ref.l > 0.12 || r.sat > 0.45, id).toBe(true);
    }
  });

  it('the dearest have a material (gold foil, glow, iridescent) as per-voxel fx; the classic kit stays plain geometry', () => {
    for (const id of ['goldfoil', 'pinstripe', 'neonglow', 'galaxy', 'holo', 'iceking', 'inferno', 'bolt']) {
      const g = new VoxelGrid(5, 7, 8);
      paintTorso(g, kitDesign(id, RED)!, 2);
      let fx = 0;
      for (let i = 0; i < g.data.length; i++) if ((g.data[i] >>> 25) & 7) fx++;
      expect(fx, id).toBeGreaterThan(0);
    }
    const team = makeTeam(PRESET_CLUBS[0]);
    const plain = new Footballer(team.players[5], team.kit, false);
    plain.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) expect(m.geometry.getAttribute('aFx')).toBeUndefined();
    });
    const gold = new Footballer(team.players[5], designKit('goldfoil', team.kit), false);
    let withFx = 0;
    gold.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry?.getAttribute('aFx')) withFx++;
    });
    expect(withFx).toBeGreaterThan(0);
  });

  it('a kit the match had to change (a clash fix on the human side) falls back to the classic drawing', () => {
    const k = designKit('galaxy', RED);
    expect(designOf(k)?.id).toBe('galaxy');
    expect(designOf({ ...k, shirt: 0xfbfbf4 })).toBeNull();
  });
});

describe('the match wears them (meta/style.ts)', () => {
  const team = makeTeam(PRESET_CLUBS[0]);
  const other = makeTeam(PRESET_CLUBS[1]);

  it('your side plays in your kit and looks, home or away; the other side changes if it would clash', () => {
    const s = rich();
    grantItem(s, 'kit', 'inferno');
    equipItem(s, 'kit', 'inferno');
    grantItem(s, 'look', 'crown');
    equipItem(s, 'look', 'crown');
    const clash: Kit = { ...RED, shirt: 0x8a1424, shirt2: 0xff8a1a };
    for (const side of [0, 1] as const) {
      const kits = side === 0 ? [team.kit, clash] as [Kit, Kit] : [clash, team.kit] as [Kit, Kit];
      const out = styleMatch(s, kits, side === 0 ? [team, other] : [other, team], side);
      const mine = out[side] as StyledKit;
      expect(mine.design).toBe('inferno');
      expect(mine.looks?.head).toBe('crown');
      expect(mine.captain).toBe(captainOf(team));
      // The AI side no longer looks like the inferno kit.
      expect(Math.abs(readKit(out[1 - side]).l - readKit(mine).l)).toBeGreaterThanOrEqual(0.38);
    }
    // Nothing equipped: the kits are passed through untouched.
    const plain = styleMatch(rich(), [team.kit, other.kit], [team, other], 0);
    expect(plain[0]).toBe(team.kit);
  });

  it('the captain is your best outfield player', () => {
    const cap = team.players.find((p) => p.id === captainOf(team))!;
    expect(cap.role).not.toBe('GK');
  });

  it('stadium style only once something is worn, in your club colours and short name', () => {
    const s = rich();
    expect(decorOf(s, RED, 'red')).toBeNull();
    grantItem(s, 'decor', 'mowchecks');
    equipItem(s, 'decor', 'mowchecks');
    const d = decorOf(s, RED, 'redtown')!;
    expect(d.slots).toEqual({ pitch: 'mowchecks' });
    expect(d.short).toBe('REDT');
    expect(d.shirt).toBe(RED.shirt);
  });
});

describe('player looks', () => {
  it('every look has a slot and builds: hair painted, headgear and shades meshes, boots, gloves and armbands', () => {
    for (const id of LOOK_IDS) {
      const slot = LOOK_SLOT_OF[id];
      expect(shopItem('look', id)?.slot, id).toBe(slot);
      if (slot === 'hair') {
        let n = 0;
        expect(paintHair(id, () => n++, 0x4a2a16), id).toBe(true);
        expect(n, id).toBeGreaterThan(20);
        expect(HAIR_LOOKS).toContain(id);
      } else if (slot === 'head') {
        expect(isHeadgear(id), id).toBe(true);
        expect(headgearGeometry(id, VU)!.getAttribute('position').count, id).toBeGreaterThan(0);
      } else if (slot === 'shades') expect(shadesGeometry(id, VU), id).not.toBeNull();
      else if (slot === 'boots') expect(bootCell(id, 0, 0), id).not.toBeNull();
      else if (slot === 'gloves') expect(gloveCell(id, 0, 0, 0), id).not.toBeNull();
      else expect(armbandCell(id, 0, 0), id).not.toBeNull();
    }
  });

  it('the captain wears hair, headgear and the armband; everyone the boots; shades only while celebrating', () => {
    const team = makeTeam(PRESET_CLUBS[2]);
    const kit: StyledKit = { ...team.kit, looks: { hair: 'mohawk', head: 'crown', arm: 'armgold', boots: 'bootgold', shades: 'shades' }, captain: team.players[9].id };
    const cap = new Footballer(team.players[9], kit, false);
    const mate = new Footballer(team.players[8], kit, false);
    expect(cap.isCaptain).toBe(true);
    expect(cap.hasHeadgear).toBe(true);
    expect(mate.isCaptain).toBe(false);
    expect(mate.hasHeadgear).toBe(false);
    const count = (f: Footballer) => {
      let n = 0;
      f.group.traverse((o) => ((o as THREE.Mesh).isMesh ? n++ : 0));
      return n;
    };
    // Six body parts, plus headgear and shades on the captain, plus shades on a team-mate.
    expect(count(cap)).toBe(8);
    expect(count(mate)).toBe(7);
  });

  it('light up boots read from the gantry: every step leaves a glowing print and a flash, pooled, gone in about a second', () => {
    const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 400);
    camera.position.set(0, 24, 40);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const kit = new FxKit();
    for (let i = 0; i < 40; i++) bootStep(kit, i * 0.85, 0, 1, 0, i % 2 ? 1 : -1, 1.13);
    expect(kit.live).toBe(80);
    for (let t = 0; t < 2.4; t += 1 / 30) kit.update(1 / 30, camera);
    expect(kit.live).toBe(0);
    kit.dispose();
  });

  it('one look per slot: wearing another in a slot replaces it, TAKE OFF empties it, a junk save is cleaned', () => {
    const s = rich();
    for (const id of ['mohawk', 'afro', 'crown'] as const) grantItem(s, 'look', id);
    expect(equipItem(s, 'look', 'mohawk')).toBe(true);
    expect(equipItem(s, 'look', 'afro')).toBe(true);
    expect(equipItem(s, 'look', 'crown')).toBe(true);
    expect(equippedSlots(s, 'look')).toEqual({ hair: 'afro', head: 'crown' });
    expect(isEquipped(s, 'look', 'mohawk')).toBe(false);
    expect(unequipItem(s, 'look', 'afro')).toBe(true);
    expect(equippedIn(s, 'look', 'hair')).toBe('');
    // Not owned: can't be worn.
    expect(equipItem(s, 'look', 'spikes')).toBe(false);
    const n = normalizeSettings({ looks: { hair: 'crown', head: 'crown', boots: 'nope' }, decor: { pitch: 'mowdiag', net: 'mowdiag' }, kit: 'nope' });
    expect(n.looks).toEqual({ head: 'crown' });
    expect(n.decor).toEqual({ pitch: 'mowdiag' });
    expect(n.kit).toBeUndefined();
  });
});

describe('stadium style', () => {
  it('every item has its slot; the seats spell the name in 3 x 5 letters', () => {
    for (const id of DECOR_IDS) expect(shopItem('decor', id)?.slot, id).toBe(DECOR_SLOT_OF[id]);
    const bits = nameBitmap('BLK');
    expect(bits).toHaveLength(5);
    expect(bits[0]).toHaveLength(3 * 3 + 2);
  });

  it('the walkout shows and the dragon\'s breath run clean and leave nothing behind', () => {
    const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 400);
    camera.position.set(0, 24, 60);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    for (const def of [...Object.values(KICKOFF_SHOWS), DRAGON_BREATH]) {
      const kit = new FxKit();
      kit.play(def.run, def.dur, 0, 0, 0, 1, 0, def.k, [0xff0000, 0xffffff], 0);
      let peak = 0;
      for (let t = 0; t < def.dur + 6; t += 1 / 30) {
        kit.update(1 / 30, camera);
        peak = Math.max(peak, kit.live);
      }
      expect(peak).toBeGreaterThan(20);
      expect(kit.live).toBe(0);
      expect(kit.running).toBe(0);
      kit.dispose();
    }
    expect(Object.keys(KICKOFF_SHOWS).sort()).toEqual(DECOR_IDS.filter((id) => DECOR_SLOT_OF[id] === 'kickoff').sort());
  });
});

describe('themed sets (bundles)', () => {
  it('six parts each, every part on sale alone, a kit, a ball, a trail and a goal explosion in every one', () => {
    for (const b of BUNDLES) {
      expect(b.parts).toHaveLength(6);
      for (const p of b.parts) {
        const it = shopItem(p.cat, p.id);
        expect(it, `${b.id} ${p.cat}:${p.id}`).toBeDefined();
        expect(it!.pass).toBeUndefined();
        expect(it!.price).toBeGreaterThan(0);
      }
      for (const cat of ['kit', 'ball', 'trail', 'goalfx'] as const) expect(b.parts.some((p) => p.cat === cat), `${b.id} ${cat}`).toBe(true);
    }
    expect(BUNDLES.map((b) => b.id)).toEqual(expect.arrayContaining(['inferno', 'iceking', 'galaxy', 'retro']));
  });

  it('honest price: the parts you lack at BUNDLE_OFF % off; completing it never charges for what you own', () => {
    const s = rich(0);
    s.progress.xp = 0;
    const b = BUNDLES.find((x) => x.id === 'inferno')!;
    const full = bundleValue(b);
    expect(bundlePrice(s, b)).toBe(Math.floor((full * (100 - BUNDLE_OFF)) / 100 / 50) * 50);
    expect(bundlePrice(s, b)).toBeLessThan(full);
    // Short of coins: nothing changes.
    expect(buyBundle(s, 'inferno')).toMatchObject({ ok: false, reason: 'no-coins' });
    expect(bundleMissing(s, b)).toHaveLength(6);
    // Own two parts: the set is now "in progress", priced on the four left.
    grantItem(s, 'kit', 'inferno');
    grantItem(s, 'trail', 'fire');
    const missing = bundleMissing(s, b);
    expect(missing).toHaveLength(4);
    expect(bundlePrice(s, b)).toBe(Math.floor((bundleValue(b, missing) * (100 - BUNDLE_OFF)) / 100 / 50) * 50);
    expect(setsInProgress(s).map((x) => x.bundle.id)).toContain('inferno');
    s.coins = 100_000;
    const before = s.coins;
    const r = buyBundle(s, 'inferno');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(before - s.coins).toBe(r.price);
      expect(r.items.map((i) => i.id).sort()).toEqual(missing.map((i) => i.id).sort());
    }
    for (const p of b.parts) expect(owns(s, p.cat, p.id)).toBe(true);
    expect(buyBundle(s, 'inferno')).toMatchObject({ ok: false, reason: 'owned' });
  });

  it('the featured shelf: the same all week (no timer), new on Monday, only looks that are always on sale', () => {
    expect(weekOf('2026-10-07')).toBe('2026-10-05');
    expect(weekOf('2026-10-11')).toBe('2026-10-05');
    expect(weekOf('2026-10-12')).toBe('2026-10-12');
    const a = featuredShelf('2026-10-06');
    expect(featuredShelf('2026-10-11')).toEqual(a);
    const weeks = new Set<string>();
    for (let d = 1; d <= 28; d += 7) weeks.add(JSON.stringify(featuredShelf(`2026-11-${String(d).padStart(2, '0')}`).items.map((i) => i.id)));
    expect(weeks.size).toBeGreaterThan(1);
    for (const it of a.items) {
      expect(it.pass).toBeUndefined();
      expect(it.price).toBeGreaterThan(0);
    }
    expect(a.items.map((i) => i.cat).slice(0, 3)).toEqual(['kit', 'look', 'decor']);
  });
});

describe('the Club Pass and old saves', () => {
  it('every month has its own kit and player look, never on sale for coins', () => {
    for (const id of PASS_IDS) {
      for (const cat of ['kit', 'look'] as const) {
        const it = shopItem(cat, id)!;
        expect(it.pass, `${cat}:${id}`).toBe(true);
        expect(it.price).toBe(0);
      }
      expect(KIT_DESIGNS[id]).toBeDefined();
    }
    expect(shopItems('look').filter((i) => i.pass)).toHaveLength(12);
  });

  it('owned keys for the new categories survive a reload, and a big collection is not cut off', () => {
    const keys = [...KIT_IDS.map((id) => `kit:${id}`), ...LOOK_IDS.map((id) => `look:${id}`), ...DECOR_IDS.map((id) => `decor:${id}`)];
    const shop = normalizeShop({ owned: [...keys, 'bad key'] });
    expect(shop.owned).toEqual(keys);
  });
});
