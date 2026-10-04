/**
 * The SHOP's rules (no DOM: ui/shop.ts draws it):
 *
 * - Cosmetics: goal celebrations and ball looks (the level ladder's items: bought with coins OR earned free at
 *   their level, whichever comes first), goal explosion themes and sprint trails (coins only). Owned, equipped
 *   into Settings, drawn in every match (render/cosmetics.ts, game/matchSession.ts).
 * - SCOUT PACKS: earned-only Scout Tokens open a random player card for MY CLUB (meta/career.ts ClubState, the club
 *   PLAY NOW and CAREER field), with the odds on show. A card signs into the squad (squad limit and all) or is sold on.
 *
 * Where coins come from: playing (matches, challenges, the daily gift), rewarded ads on the web portals (FREE
 * COINS below: a few a day) and, in the iOS and Android apps only, store purchases (platform/iap.ts). Cosmetics
 * are looks, and ONLINE friendlies use the preset clubs, so nothing bought here wins a match against a friend.
 * Coins and gems never buy Scout Tokens or random cards; every pack's odds are still always on show.
 * Everything persists in SaveData.shop and SaveData.iap (core/save.ts normalizeShop / normalizeIap) and Settings.
 */
import { Rng, hashString } from '../core/rng';
import {
  BALL_SKIN_IDS, BALL_SKIN_LEVEL, BALL_SKIN_NAMES, CELEBRATION_IDS, CELEBRATION_LEVEL, CELEBRATION_NAMES, DECOR_IDS, DECOR_SLOT_OF, GOAL_FX_IDS, KIT_IDS,
  LOOK_IDS, LOOK_SLOT_OF, PASS_IDS, TRAIL_IDS, levelOf, normalizeIap, normalizeShop,
  type DecorId, type DecorSlot, type IapState, type LookId, type LookSlot, type PassId, type SaveData, type ShopState,
} from '../core/save';
import { SEASON_THEMES } from './season';
import { FORMATIONS } from '../sim/formations';
import { overall, type PlayerDef, type Role } from '../sim/types';
import { SQUAD_MAX, SQUAD_MIN, clonePlayer, clubRating, freeNumber, sellPlayer, swapPlayers, tuneToOverall, type CareerState, type ClubState, type Wallet } from './career';
import { makePlayer, surnameOf } from './data';
import { pinMeta, quickSaleValue, type MetaPlayer } from './market';

// ------------------------------------------------------------------ catalogue

export type ShopCat = 'celebration' | 'ball' | 'goalfx' | 'trail' | 'kit' | 'look' | 'decor';
export const SHOP_CATS: readonly ShopCat[] = ['celebration', 'ball', 'goalfx', 'trail', 'kit', 'look', 'decor'];
/** Categories worn one per SLOT (player looks: hair, headgear...; stadium style: pitch, nets...), not one in all. */
export type SlotCat = 'look' | 'decor';
export const isSlotCat = (cat: ShopCat): cat is SlotCat => cat === 'look' || cat === 'decor';

export interface ShopItem {
  cat: ShopCat;
  id: string;
  /** Player looks and stadium style: the slot it fills (one look per slot is worn at once). */
  slot?: LookSlot | DecorSlot;
  /** Shown name (no hyphens: the pixel font draws them badly). */
  name: string;
  /** Coins; 0 = everyone has it from the start. */
  price: number;
  /** The level that earns it free (the unlock ladder: celebrations and balls); undefined = coins only. */
  level?: number;
  /** One line for the showcase. */
  blurb: string;
  /** A Club Pass look: earned on its month's pass track only, never sold for coins (core/save.ts PASS_IDS). */
  pass?: true;
}

/**
 * Prices, tuned to what a match pays (main.ts standardReward: a win on Normal ~170-210, a draw ~90, a loss ~50,
 * x1.1 a win in a row up to x2) plus the daily gift (100-400) and challenges (100-220 each). The ladder (docs/ECONOMY.md):
 * COMMON something new every two to four matches early on (250-450); RARE and EPIC a few days to a week of play
 * (500-2800); LEGENDARY a few weeks for a free player (4500-7500), the looks to aim at and the reason a coin pack is
 * ever worth it. Club Pass looks are never on sale for coins.
 */
const CELEB_PRICE: { readonly [k in (typeof CELEBRATION_IDS)[number]]: number } = {
  classic: 0, knee: 300, shush: 450, plane: 600, robot: 800, backflip: 1200, pile: 1800,
};
const CELEB_BLURB: { readonly [k in (typeof CELEBRATION_IDS)[number]]: string } = {
  classic: 'Arms up and mobbed by your mates.',
  knee: 'Sprint away and slide in on your knees.',
  shush: 'Finger to the lips. Silence the away end.',
  plane: 'Arms out, banking round the pitch.',
  robot: 'Stiff, snappy and a little bit silly.',
  backflip: 'A full backflip. Stick the landing.',
  pile: 'Hit the deck and the whole team piles on.',
};
// Every look is its own thing, not a recolour: shapes and patterns for the balls (render/characters.ts BALL_LOOK),
// a scripted show for each goal explosion (render/fx/goals.ts) and an emitter for each trail (render/fx/trails.ts).
// The rarer it is, the bigger the show: LEGENDARY is the most spectacular in each category.
const BALL_PRICE: { readonly [k in (typeof BALL_SKIN_IDS)[number]]: number } = {
  classic: 0, retro: 250, beach: 400, melon: 450, blaze: 600, hoops: 700, eight: 800, ice: 900, neon: 1000, moon: 1200, disco: 1800,
  gold: 2500, planet: 4500, diamond: 7500,
};
const BALL_BLURB: { readonly [k in (typeof BALL_SKIN_IDS)[number]]: string } = {
  classic: 'The match ball.',
  retro: 'Old brown leather, stitched panels and laces.',
  beach: 'Six bright stripes, straight off the beach.',
  melon: 'A striped watermelon, stalk and all.',
  blaze: 'Cracked rock with lava glowing through.',
  hoops: 'A basketball that thinks it is a football.',
  eight: 'Black and glossy with the 8 on it.',
  ice: 'Frozen solid, icicles sticking out.',
  neon: 'A black ball with glowing grid lines.',
  moon: 'Grey, cratered and out of this world.',
  disco: 'Mirror tiles that catch the floodlights.',
  gold: 'Polished gold. For legends only.',
  planet: 'A tiny world with oceans and a ring round it.',
  diamond: 'A cut gem. The rarest ball in the game.',
};
type Look = { name: string; price: number; blurb: string };
const GOAL_FX: { readonly [k in Exclude<(typeof GOAL_FX_IDS)[number], PassId>]: Look } = {
  club: { name: 'Club Colours', price: 0, blurb: 'A burst and confetti in your kit colours.' },
  shockwave: { name: 'Shockwave', price: 300, blurb: 'A ring of force rolls out over the grass.' },
  balloons: { name: 'Balloon Party', price: 350, blurb: 'A bunch of balloons floats up out of the net.' },
  confetti: { name: 'Confetti Cannons', price: 450, blurb: 'Two cannons pop up and blast the box with confetti.' },
  popcorn: { name: 'Popcorn', price: 600, blurb: 'A bucket pops up and the kernels go everywhere.' },
  gold: { name: 'Gold Rush', price: 700, blurb: 'A geyser of gold coins out of the net.' },
  ice: { name: 'Frostbite', price: 800, blurb: 'The goal freezes solid, then shatters.' },
  pinata: { name: 'Pinata', price: 900, blurb: 'Whack, whack! It bursts into sweets.' },
  fire: { name: 'Inferno', price: 1200, blurb: 'Flame jets go off along the goal line.' },
  rainbow: { name: 'Rainbow', price: 1400, blurb: 'A voxel rainbow arches out of the goal.' },
  neon: { name: 'Neon Disco', price: 1800, blurb: 'A mirror ball, lasers and a dance floor.' },
  fireworks: { name: 'Fireworks', price: 2200, blurb: 'Rockets launch from behind the net and burst in the sky.' },
  volcano: { name: 'Volcano', price: 2500, blurb: 'A volcano bursts out of the box and erupts.' },
  lightning: { name: 'Thunderbolt', price: 2800, blurb: 'Lightning strikes the goal mouth three times.' },
  galaxy: { name: 'Black Hole', price: 4500, blurb: 'A vortex swallows the stars, then bursts.' },
  meteor: { name: 'Meteor Strike', price: 5000, blurb: 'A flaming meteor craters the goal mouth.' },
  diamond: { name: 'Diamond Rain', price: 6000, blurb: 'A giant diamond shatters and it rains gems.' },
  supernova: { name: 'Supernova', price: 7500, blurb: 'A star gathers light over the box, then goes off.' },
};
const TRAILS: { readonly [k in Exclude<(typeof TRAIL_IDS)[number], PassId>]: Look } = {
  white: { name: 'Chalk', price: 0, blurb: 'Clean white speed lines.' },
  toon: { name: 'Toon Dash', price: 300, blurb: 'Cartoon dust puffs and inky speed lines.' },
  hearts: { name: 'Hearts', price: 350, blurb: 'Little hearts float up behind you.' },
  pink: { name: 'Bubblegum', price: 400, blurb: 'Bubbles drift up behind you and pop.' },
  popcorn: { name: 'Popcorn', price: 450, blurb: 'Kernels pop off your heels and bounce.' },
  notes: { name: 'Music Notes', price: 600, blurb: 'Notes bob up behind you in a wavy line.' },
  lime: { name: 'Slime', price: 650, blurb: 'Goo drips off your boots and splats.' },
  ice: { name: 'Ice Trail', price: 750, blurb: 'Frozen boot prints and falling snow.' },
  fire: { name: 'Afterburner', price: 900, blurb: 'Pixel flames lick off your heels.' },
  gold: { name: 'Golden Boots', price: 1200, blurb: 'Gold coins spill off your heels.' },
  glitch: { name: 'Glitch', price: 1500, blurb: 'You break up into flickering pixels.' },
  rainbow: { name: 'Rainbow Ribbon', price: 2000, blurb: 'A rainbow ribbon streams out behind you.' },
  lightning: { name: 'Lightning', price: 4500, blurb: 'Bolts crackle off your heels and arc round you.' },
  comet: { name: 'Comet Tail', price: 6000, blurb: 'A blazing tail of stardust and stars.' },
};

/**
 * PREMIUM KITS: each its own design painted voxel by voxel (render/kitDesigns.ts): a pattern, its own collar, cuffs,
 * socks and shorts, and the dearest a material too (gold foil that catches the light, trim that glows at night, a
 * sheen that shifts colour). Your club plays in it; 'club' is the club's own kit.
 */
const KITS: { readonly [k in Exclude<(typeof KIT_IDS)[number], PassId>]: Look } = {
  club: { name: 'Club Kit', price: 0, blurb: 'Your club\'s own colours and pattern.' },
  zigzag: { name: 'Zigzag', price: 300, blurb: 'Tangerine with a navy zigzag across the chest.' },
  checker: { name: 'Checkerboard', price: 400, blurb: 'Bold red and white checks, top to socks.' },
  camo: { name: 'Arctic Camo', price: 600, blurb: 'Snow camo in white, ice and slate.' },
  tiger: { name: 'Tiger', price: 700, blurb: 'Orange with black tiger stripes. Roar.' },
  fade: { name: 'Sunset Fade', price: 850, blurb: 'Pink to orange to gold, like a summer sky.' },
  retro: { name: 'Retro 80s', price: 1100, blurb: 'White with teal, pink and yellow shapes. Totally rad.' },
  crest: { name: 'Big Crest', price: 1300, blurb: 'Your club colours with a giant crest across the chest.' },
  inferno: { name: 'Inferno', price: 1600, blurb: 'Pixel flames lick up the shirt. They glow at night.' },
  bolt: { name: 'Thunder', price: 1900, blurb: 'Electric blue, a lightning bolt and glowing trim.' },
  iceking: { name: 'Ice King', price: 2200, blurb: 'Frost crystals with a sheen that shifts like ice.' },
  holo: { name: 'Hologram', price: 2600, blurb: 'Pearl white that shimmers every colour as you run.' },
  galaxy: { name: 'Galaxy', price: 4500, blurb: 'Deep space and twinkling stars. They glow at night.' },
  pinstripe: { name: 'Gold Pinstripe', price: 5000, blurb: 'Navy pinstripes, gold foil trim that catches the light.' },
  neonglow: { name: 'Glow In The Dark', price: 6000, blurb: 'Neon lines that light up under the floodlights.' },
  goldfoil: { name: 'Gold Foil', price: 7500, blurb: 'Solid gold, head to toe. The champion\'s kit.' },
};

/** PLAYER LOOKS (render/looks.ts): your captain's hair and headgear, the team's boots, your keepers' gloves. */
const LOOKS: { readonly [k in Exclude<LookId, PassId>]: Look } = {
  bun: { name: 'Top Bun', price: 350, blurb: 'Your captain ties it all up on top.' },
  tips: { name: 'Frosted Tips', price: 450, blurb: 'Spiky hair with icy dyed tips.' },
  mohawk: { name: 'Mohawk', price: 600, blurb: 'A tall red mohawk. Everyone sees you coming.' },
  afro: { name: 'Big Afro', price: 750, blurb: 'The biggest hair on the pitch.' },
  spikes: { name: 'Super Spikes', price: 1600, blurb: 'Golden spiky hair that shines in the light.' },
  flamehair: { name: 'Flame Hair', price: 2600, blurb: 'Hair made of fire. It glows at night.' },
  headband: { name: 'Headband', price: 300, blurb: 'A neon headband with tails that flap as you run.' },
  sweatband: { name: 'Sweatbands', price: 400, blurb: 'Retro striped head and wrist bands.' },
  halo: { name: 'Halo', price: 2000, blurb: 'A glowing golden ring floats over your head.' },
  icecrown: { name: 'Ice Crown', price: 2400, blurb: 'A crown of ice crystals that shimmers.' },
  crown: { name: 'Crown', price: 6000, blurb: 'A gold crown set with gems. Royalty.' },
  armband: { name: 'Captain Armband', price: 250, blurb: 'The classic C on your captain\'s arm.' },
  armrainbow: { name: 'Rainbow Armband', price: 650, blurb: 'Every colour on your captain\'s arm.' },
  armgold: { name: 'Gold Armband', price: 1400, blurb: 'A gold armband that catches the light.' },
  bootneon: { name: 'Neon Boots', price: 500, blurb: 'Hot pink and cyan boots for the whole team.' },
  bootgold: { name: 'Gold Boots', price: 2400, blurb: 'Shining gold boots for the whole team.' },
  bootlight: { name: 'Light Up Boots', price: 4800, blurb: 'Boots that glow and flash with every step.' },
  glovepro: { name: 'Pro Gloves', price: 300, blurb: 'Big white and black keeper gloves.' },
  glovefire: { name: 'Fire Gloves', price: 800, blurb: 'Keeper gloves with flames on the palms.' },
  glovegold: { name: 'Gold Gloves', price: 1800, blurb: 'Golden gloves for a golden keeper.' },
  shades: { name: 'Shades', price: 500, blurb: 'Cool black shades go on to celebrate.' },
  shadestar: { name: 'Star Shades', price: 900, blurb: 'Pink star glasses for the party.' },
  shadegold: { name: 'Gold Shades', price: 1500, blurb: 'Mirrored gold shades for every goal.' },
};

/** STADIUM STYLE (render/stadiumStyle.ts): your home ground dressed up, every home match. */
const DECOR: { readonly [k in DecorId]: Look } = {
  mowchecks: { name: 'Mown Checks', price: 300, blurb: 'The lawn mown in a big chessboard.' },
  mowdiag: { name: 'Diagonal Stripes', price: 450, blurb: 'Sharp diagonal mowing stripes.' },
  mowcircle: { name: 'Mown Circles', price: 800, blurb: 'Rings mown out from the centre spot.' },
  mowcrest: { name: 'Centre Crest', price: 1500, blurb: 'Your own crest mown into the centre circle.' },
  netclub: { name: 'Club Nets', price: 300, blurb: 'Goal nets striped in your club colours.' },
  nethex: { name: 'Hex Nets', price: 600, blurb: 'Honeycomb nets like the big stadiums.' },
  netrainbow: { name: 'Rainbow Nets', price: 900, blurb: 'Every goal hits a rainbow.' },
  netglow: { name: 'Neon Nets', price: 2000, blurb: 'Nets that glow under the floodlights.' },
  flagclub: { name: 'Club Flags', price: 250, blurb: 'Corner flags in your club colours.' },
  flagcheck: { name: 'Chequered Flags', price: 400, blurb: 'Racing chequered corner flags.' },
  flagfire: { name: 'Flame Flags', price: 700, blurb: 'Corner flags that flicker like fire.' },
  seatname: { name: 'Name In The Seats', price: 1200, blurb: 'Your club\'s name spelt out in the seats.' },
  tifoflags: { name: 'Flag Wave', price: 600, blurb: 'Fans wave your colours and a giant flag surfs over the home end.' },
  tifobig: { name: 'Giant Tifo', price: 1800, blurb: 'A giant banner of your crest, and a card mosaic in the top tier.' },
  kickconfetti: { name: 'Confetti Cannons', price: 600, blurb: 'Confetti cannons at kick off and behind the goal when you score.' },
  kickfire: { name: 'Fireworks Show', price: 2000, blurb: 'Fireworks off the roof at kick off, on your goals and when you win.' },
  kickpyro: { name: 'Pyro Show', price: 4500, blurb: 'Flame jets behind the boards, and a ring of fire round the goal when you score.' },
  lightclub: { name: 'Club Floodlights', price: 700, blurb: 'An LED strip round the pitch and searchlights in your colours.' },
  lightshow: { name: 'Light Show', price: 2500, blurb: 'Spotlights sweep the stands in every colour, and GOAL on the big screen.' },
  mascotbear: { name: 'Bear Mascot', price: 1500, blurb: 'A big bear by your dugout who drums for the crowd.' },
  mascotrobot: { name: 'Robo Mascot', price: 2500, blurb: 'A robot by your dugout that does the robot when you score.' },
  mascotdragon: { name: 'Dragon Mascot', price: 5000, blurb: 'A dragon by your dugout that breathes fire into the air.' },
};

/** Club Pass kits and looks by month (January first), on top of the month's goal explosion and trail. */
const PASS_KIT_BLURB = [
  'A white knit with snowflakes and frosty trim.', 'Mud splatted all over. Proper football.', 'Pink blossom over spring white.',
  'Raindrops on stormy blue.', 'White and gold, with a trophy on the chest.', 'Beach stripes in sunset colours.',
  'A heat haze from red to gold.', 'A teal training bib over the shirt.', 'A cosy harvest plaid in gold and brown.',
  'Purple with lines that glow at night.', 'Embers and sparks that glow at night.', 'A festive knit, red and white.',
];
const PASS_LOOK: readonly { name: string; blurb: string }[] = [
  { name: 'Bobble Hat', blurb: 'A woolly hat with a big pom pom.' },
  { name: 'Mud Stompers', blurb: 'Brown boots with gold studs for the whole team.' },
  { name: 'Flower Crown', blurb: 'A ring of spring flowers.' },
  { name: 'Rainbow Shades', blurb: 'Rainbow glasses for every goal.' },
  { name: 'Trophy Armband', blurb: 'A gold armband with a little trophy.' },
  { name: 'Surf Shades', blurb: 'Orange mirrored shades for the party.' },
  { name: 'Sun Visor', blurb: 'A bright red visor for the heatwave.' },
  { name: 'Camp Gloves', blurb: 'Teal keeper gloves from training camp.' },
  { name: 'Harvest Curls', blurb: 'Big ginger curls for your captain.' },
  { name: 'Floodlight Boots', blurb: 'Purple boots that glow at night.' },
  { name: 'Sparkler Gloves', blurb: 'Keeper gloves that fizz and glow.' },
  { name: 'Winter Hat', blurb: 'A red festive hat with a white bobble.' },
];

/** What each month's Club Pass looks do (January first): its own goal explosion and trail, not a colourway. */
const PASS_BLURB: { readonly [k in 'goalfx' | 'trail']: readonly string[] } = {
  goalfx: [
    'A snow tornado spins up out of the goal.', 'A giant ball of mud splats the whole box.', 'Flowers burst up all over the box.',
    'Rain clouds roll in and it pours.', 'A giant trophy rises out of the goal.', 'A big wave crashes out of the net.',
    'A grinning sun rises over the goal.', 'Footballs pour out of the net.', 'A gust of autumn leaves and pumpkins.',
    'Searchlights sweep the night sky.', 'Catherine wheels spin on the posts.', 'A big present bursts open into gifts.',
  ],
  trail: [
    'A flurry of snowflakes whirls off you.', 'Muddy boot prints and flying mud.', 'Flowers spring up in your footsteps.',
    'Your own little rain cloud follows you.', 'Gold stars and ticker tape.', 'Every step splashes.',
    'Little suns spin up off you.', 'Training cones pop up in a slalom.', 'Autumn leaves kicked up behind you.',
    'A neon light line painted behind you.', 'A sparkler fizzing off you.', 'Tiny presents bounce out behind you.',
  ],
};

/** A Club Pass look of the season theme at index `m` (January 0): its goal explosion, trail, kit or player look. */
const passLook = (cat: 'goalfx' | 'trail' | 'kit' | 'look', m: number): Look => ({
  name: cat === 'look' ? PASS_LOOK[m].name : SEASON_THEMES[m].name,
  price: 0,
  blurb: `Club Pass only: ${cat === 'kit' ? PASS_KIT_BLURB[m] : cat === 'look' ? PASS_LOOK[m].blurb : PASS_BLURB[cat][m]}`,
});
const isPass = (id: string): id is PassId => (PASS_IDS as readonly string[]).includes(id);

/** Shop order within a category: the free one, then cheapest first, the Club Pass looks last (by month). */
const byPrice = (list: ShopItem[]): ShopItem[] => list.sort((a, b) => (a.pass ? 1 : 0) - (b.pass ? 1 : 0) || a.price - b.price);

/** Slot order for the slot categories (the shop lists a slot's looks together, cheapest first). */
const LOOK_ORDER: readonly LookSlot[] = ['hair', 'head', 'arm', 'boots', 'gloves', 'shades'];
const DECOR_ORDER: readonly DecorSlot[] = ['pitch', 'net', 'flags', 'seats', 'tifo', 'kickoff', 'lights', 'mascot'];
const bySlot = <S extends string>(order: readonly S[]) => (list: ShopItem[]): ShopItem[] =>
  list.sort((a, b) => (a.pass ? 1 : 0) - (b.pass ? 1 : 0) || order.indexOf(a.slot as S) - order.indexOf(b.slot as S) || a.price - b.price);

const ITEMS: readonly ShopItem[] = [
  ...CELEBRATION_IDS.map((id): ShopItem => ({
    cat: 'celebration', id, name: CELEBRATION_NAMES[id].replace(/-/g, ' '), price: CELEB_PRICE[id], level: CELEBRATION_LEVEL[id], blurb: CELEB_BLURB[id],
  })),
  ...byPrice(BALL_SKIN_IDS.map((id): ShopItem => ({
    cat: 'ball', id, name: BALL_SKIN_NAMES[id], price: BALL_PRICE[id], level: BALL_SKIN_LEVEL[id], blurb: BALL_BLURB[id],
  }))),
  ...byPrice(GOAL_FX_IDS.map((id): ShopItem => (isPass(id) ? { cat: 'goalfx', id, ...passLook('goalfx', PASS_IDS.indexOf(id)), pass: true } : { cat: 'goalfx', id, ...GOAL_FX[id] }))),
  ...byPrice(TRAIL_IDS.map((id): ShopItem => (isPass(id) ? { cat: 'trail', id, ...passLook('trail', PASS_IDS.indexOf(id)), pass: true } : { cat: 'trail', id, ...TRAILS[id] }))),
  ...byPrice(KIT_IDS.map((id): ShopItem => (isPass(id) ? { cat: 'kit', id, ...passLook('kit', PASS_IDS.indexOf(id)), pass: true } : { cat: 'kit', id, ...KITS[id] }))),
  ...bySlot(LOOK_ORDER)(LOOK_IDS.map((id): ShopItem => ({
    cat: 'look', id, slot: LOOK_SLOT_OF[id], ...(isPass(id) ? { ...passLook('look', PASS_IDS.indexOf(id)), pass: true as const } : LOOKS[id]),
  }))),
  ...bySlot(DECOR_ORDER)(DECOR_IDS.map((id): ShopItem => ({ cat: 'decor', id, slot: DECOR_SLOT_OF[id], ...DECOR[id] }))),
].map((it) => (it.price === 0 ? { ...it, level: undefined } : it));

/** The Club Pass looks of season `id` ("2026-10"): its goal explosion, trail, premium kit and player look. */
export function seasonPassItems(id: string): { goalfx: ShopItem; trail: ShopItem; kit: ShopItem; look: ShopItem } {
  const m = Math.max(0, Math.min(11, (Number(id.slice(5, 7)) || 1) - 1));
  return {
    goalfx: shopItem('goalfx', PASS_IDS[m])!, trail: shopItem('trail', PASS_IDS[m])!, kit: shopItem('kit', PASS_IDS[m])!, look: shopItem('look', PASS_IDS[m])!,
  };
}

// ------------------------------------------------------------------ rarity (status: shown on every tile)

export type ItemTier = 'common' | 'rare' | 'epic' | 'legendary' | 'season';
export const ITEM_TIER_NAMES: { readonly [k in ItemTier]: string } = {
  common: 'COMMON', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY', season: 'CLUB PASS',
};

/** An item's rarity, by price (the free starters are common); Club Pass looks are their own tier. */
export function itemTier(it: Pick<ShopItem, 'price' | 'pass'>): ItemTier {
  if (it.pass) return 'season';
  return it.price >= 3000 ? 'legendary' : it.price >= 1000 ? 'epic' : it.price >= 500 ? 'rare' : 'common';
}

/** Every item in a category (all of them without one), in shop order (cheapest first after the free one). */
export function shopItems(cat?: ShopCat): readonly ShopItem[] {
  return cat ? ITEMS.filter((it) => it.cat === cat) : ITEMS;
}

export function shopItem(cat: ShopCat, id: string): ShopItem | undefined {
  return ITEMS.find((it) => it.cat === cat && it.id === id);
}

/** The key an item is stored under in ShopState.owned / seen (and the unlock ladder's: 'ball:retro'). */
export const itemKey = (cat: ShopCat, id: string): string => `${cat}:${id}`;

/** What each category is, in a line ("NOW IN REACH: BACKFLIP goal celebration"). */
export const CAT_LABEL: { readonly [k in ShopCat]: string } = {
  celebration: 'goal celebration', ball: 'ball look', goalfx: 'goal explosion', trail: 'sprint trail', kit: 'premium kit', look: 'player look',
  decor: 'stadium style',
};

/** What each slot is, in a word or two (the shop's slot chips and the detail line). */
export const SLOT_LABEL: { readonly [k in LookSlot | DecorSlot]: string } = {
  hair: 'hair', head: 'headgear', arm: 'armband', boots: 'boots', gloves: 'keeper gloves', shades: 'shades',
  pitch: 'pitch', net: 'nets', flags: 'corner flags', seats: 'seats', tifo: 'crowd', kickoff: 'shows', lights: 'floodlights', mascot: 'mascot',
};

/** Who wears a player look in a match (the detail pane says so in a line). */
export const LOOK_WHO: { readonly [k in LookSlot]: string } = {
  hair: 'YOUR CAPTAIN', head: 'YOUR CAPTAIN AND THE MAN YOU CONTROL', arm: 'YOUR CAPTAIN', boots: 'THE WHOLE TEAM', gloves: 'YOUR KEEPERS',
  shades: 'EVERYONE WHO CELEBRATES',
};

/**
 * The item everyone owns from the start in each category (what "nothing equipped" means). The slot categories have
 * none: an empty slot simply wears nothing extra.
 */
export const DEFAULT_ID: { readonly [k in ShopCat]: string } = { celebration: 'classic', ball: 'classic', goalfx: 'club', trail: 'white', kit: 'club', look: '', decor: '' };

/** Which Settings field each one-of-a-kind category equips into (the slot categories go by slot: see equipItem). */
const SETTING: { readonly [k in Exclude<ShopCat, SlotCat>]: 'celebration' | 'ballSkin' | 'goalFx' | 'trail' | 'kit' } = {
  celebration: 'celebration', ball: 'ballSkin', goalfx: 'goalFx', trail: 'trail', kit: 'kit',
};

/** The slot map a slot category equips into (Settings.looks / Settings.decor), made whole first. */
function slotMap(save: Pick<SaveData, 'settings'>, cat: SlotCat): { [slot: string]: string | undefined } {
  if (cat === 'look') return (save.settings.looks ??= {}) as { [slot: string]: string | undefined };
  return (save.settings.decor ??= {}) as { [slot: string]: string | undefined };
}

// ------------------------------------------------------------------ owning, buying, equipping

/** The save's shop state, made whole in place first if it isn't (a save from any path: storage, a file, the cloud). */
export function shopOf(save: Pick<SaveData, 'shop'>): ShopState {
  const s = save.shop;
  if (!s || !Array.isArray(s.owned) || !Array.isArray(s.seen) || typeof s.freePack !== 'string' || !Number.isFinite(s.packs) || s.pending === undefined) {
    save.shop = normalizeShop(s);
  }
  return save.shop!;
}

/** The save's store-purchase state, made whole in place first if it isn't (like shopOf). */
export function iapOf(save: Pick<SaveData, 'iap'>): IapState {
  const s = save.iap;
  if (!s || !Array.isArray(s.owned) || !Array.isArray(s.applied) || !s.freeAds || typeof s.freeAds.day !== 'string' || !Number.isFinite(s.freeAds.count)) {
    save.iap = normalizeIap(s);
  }
  return save.iap!;
}

/** Whole coins in the wallet (a damaged number counts as none). */
function wallet(save: Pick<SaveData, 'coins'>): number {
  return Number.isFinite(save.coins) ? Math.max(0, Math.floor(save.coins)) : 0;
}

/** Bought in the shop (not counting level unlocks or the free items). */
export function bought(save: Pick<SaveData, 'shop'>, cat: ShopCat, id: string): boolean {
  return shopOf(save).owned.includes(itemKey(cat, id));
}

/** Yours to equip: free from the start, earned by level (the ladder) or bought. */
export function owns(save: Pick<SaveData, 'shop' | 'progress'>, cat: ShopCat, id: string): boolean {
  const it = shopItem(cat, id);
  if (!it) return false;
  // (A Club Pass look is free of coins but never a starter: owned only once its pass track hands it over.)
  if (it.pass) return bought(save, cat, id);
  if (it.price === 0) return true;
  if (it.level !== undefined && levelOf(save.progress.xp).level >= it.level) return true;
  return bought(save, cat, id);
}

// ------------------------------------------------------------------ today's deal

/** Today's deal: one look a day at this much off (honest: it rotates daily, and every look comes round again). */
export const DEAL_OFF = 25;

/**
 * Today's deal for this save on local `day`: a look it doesn't own yet (never a Club Pass one), at DEAL_OFF % off.
 * Picked once per day and kept in the save, so buying it (or anything else) doesn't swap it for another; null when
 * there is nothing left to sell.
 */
export function dailyDeal(save: Pick<SaveData, 'shop' | 'progress'>, day: string): { item: ShopItem; price: number } | null {
  const shop = shopOf(save);
  if (shop.deal?.day !== day) {
    const pool = ITEMS.filter((it) => it.price > 0 && !it.pass && !owns(save, it.cat, it.id));
    const pick = pool.length ? pool[hashString(`deal|${day}`) % pool.length] : null;
    shop.deal = pick ? { day, key: itemKey(pick.cat, pick.id) } : null;
  }
  if (!shop.deal) return null;
  const [cat, id] = shop.deal.key.split(':') as [ShopCat, string];
  const item = shopItem(cat, id);
  if (!item || item.pass || item.price <= 0) return null;
  return { item, price: Math.round((item.price * (100 - DEAL_OFF)) / 100 / 10) * 10 };
}

/**
 * The exact next deal, without changing the save. A gem-spend confirmation must show this item's name and coin
 * price before charging: a paid refresh buys a known discount, never an undisclosed draw. Null when none remain.
 */
export function nextDeal(save: Pick<SaveData, 'shop' | 'progress'>, day: string): { item: ShopItem; price: number } | null {
  // Preview on a copy: rendering a gem-spend confirmation must not advance or create today's saved deal.
  const preview = { progress: save.progress, shop: normalizeShop(save.shop) };
  const cur = dailyDeal(preview, day);
  const pool = ITEMS.filter((it) => it.price > 0 && !it.pass && !owns(preview, it.cat, it.id) && !(cur && it.cat === cur.item.cat && it.id === cur.item.id));
  if (!pool.length) return null;
  const pick = pool[hashString(`deal|${day}|again|${preview.shop.deal?.key ?? ''}`) % pool.length];
  return { item: pick, price: Math.round((pick.price * (100 - DEAL_OFF)) / 100 / 10) * 10 };
}

/** Replace today's deal with the exact item shown by `nextDeal`; null leaves it unchanged when none remains. */
export function rerollDeal(save: Pick<SaveData, 'shop' | 'progress'>, day: string): { item: ShopItem; price: number } | null {
  const next = nextDeal(save, day);
  if (!next) return null;
  shopOf(save).deal = { day, key: itemKey(next.item.cat, next.item.id) };
  return next;
}

/** What `it` costs on `day` (today's deal price for the deal look, else its price). */
export function priceOn(save: Pick<SaveData, 'shop' | 'progress'>, it: ShopItem, day?: string): number {
  if (!day) return it.price;
  const deal = dailyDeal(save, day);
  return deal && deal.item.cat === it.cat && deal.item.id === it.id ? deal.price : it.price;
}

// ------------------------------------------------------------------ sets (bundles) and the featured shelf

/**
 * THEMED SETS: a kit, a ball, a trail, a goal explosion, a celebration or player look and a stadium touch that belong
 * together, sold at BUNDLE_OFF % off what the parts cost on their own. Honest by construction: every part is also
 * sold alone at its shown price, the set's price is worked out from the parts you don't own yet (so COMPLETE THE SET
 * never charges for what you have), and there is no timer.
 */
export interface Bundle {
  id: string;
  name: string;
  blurb: string;
  /** Hero card colours (CSS hex): its background and its accent. */
  bg: string;
  accent: string;
  parts: readonly { cat: ShopCat; id: string }[];
}

export const BUNDLE_OFF = 40;

export const BUNDLES: readonly Bundle[] = [
  {
    id: 'retro', name: 'Retro Set', blurb: 'Rad 80s kit, leather ball, toon trail, confetti, the robot and checks.', bg: '#2bb5a8', accent: '#ff5cb0',
    parts: [{ cat: 'kit', id: 'retro' }, { cat: 'ball', id: 'retro' }, { cat: 'trail', id: 'toon' }, { cat: 'goalfx', id: 'confetti' }, { cat: 'celebration', id: 'robot' }, { cat: 'decor', id: 'mowchecks' }],
  },
  {
    id: 'inferno', name: 'Inferno Set', blurb: 'Flame kit, magma ball, afterburner, flame jets, a backflip and fire flags.', bg: '#c4261a', accent: '#ffd23a',
    parts: [{ cat: 'kit', id: 'inferno' }, { cat: 'ball', id: 'blaze' }, { cat: 'trail', id: 'fire' }, { cat: 'goalfx', id: 'fire' }, { cat: 'celebration', id: 'backflip' }, { cat: 'decor', id: 'flagfire' }],
  },
  {
    id: 'iceking', name: 'Ice King Set', blurb: 'Frost kit, ice ball, ice trail, Frostbite, an ice crown and mown circles.', bg: '#2f7be8', accent: '#d6f3ff',
    parts: [{ cat: 'kit', id: 'iceking' }, { cat: 'ball', id: 'ice' }, { cat: 'trail', id: 'ice' }, { cat: 'goalfx', id: 'ice' }, { cat: 'look', id: 'icecrown' }, { cat: 'decor', id: 'mowcircle' }],
  },
  {
    id: 'neon', name: 'Neon Nights Set', blurb: 'Glow kit, neon ball, glitch trail, the disco, light up boots and neon nets.', bg: '#3a1f7a', accent: '#3cf7ff',
    parts: [{ cat: 'kit', id: 'neonglow' }, { cat: 'ball', id: 'neon' }, { cat: 'trail', id: 'glitch' }, { cat: 'goalfx', id: 'neon' }, { cat: 'look', id: 'bootlight' }, { cat: 'decor', id: 'netglow' }],
  },
  {
    id: 'galaxy', name: 'Galaxy Set', blurb: 'Starfield kit, planet ball, comet tail, the black hole, a halo and a light show.', bg: '#24124f', accent: '#ff5cf0',
    parts: [{ cat: 'kit', id: 'galaxy' }, { cat: 'ball', id: 'planet' }, { cat: 'trail', id: 'comet' }, { cat: 'goalfx', id: 'galaxy' }, { cat: 'look', id: 'halo' }, { cat: 'decor', id: 'lightshow' }],
  },
  {
    id: 'champion', name: 'Champion Set', blurb: 'Gold foil kit, gold ball, golden boots, gold rush, the crown and fireworks.', bg: '#a8740c', accent: '#fff0b0',
    parts: [{ cat: 'kit', id: 'goldfoil' }, { cat: 'ball', id: 'gold' }, { cat: 'trail', id: 'gold' }, { cat: 'goalfx', id: 'gold' }, { cat: 'look', id: 'crown' }, { cat: 'decor', id: 'kickfire' }],
  },
];

export function bundleOf(id: string): Bundle | undefined {
  return BUNDLES.find((b) => b.id === id);
}

/** A set's parts as shop items. */
export function bundleItems(b: Bundle): ShopItem[] {
  return b.parts.map((p) => shopItem(p.cat, p.id)).filter((x): x is ShopItem => !!x);
}

/** What the parts cost on their own (the struck-through number on the card). */
export function bundleValue(b: Bundle, items: readonly ShopItem[] = bundleItems(b)): number {
  return items.reduce((n, it) => n + it.price, 0);
}

/** The parts you don't own yet. */
export function bundleMissing(save: Pick<SaveData, 'shop' | 'progress'>, b: Bundle): ShopItem[] {
  return bundleItems(b).filter((it) => !owns(save, it.cat, it.id));
}

/** The set's price for this save: the missing parts at BUNDLE_OFF % off, down to a round 50 (0 = you own it all). */
export function bundlePrice(save: Pick<SaveData, 'shop' | 'progress'>, b: Bundle): number {
  const full = bundleValue(b, bundleMissing(save, b));
  return Math.floor((full * (100 - BUNDLE_OFF)) / 100 / 50) * 50;
}

export type BundleResult = { ok: true; bundle: Bundle; items: ShopItem[]; price: number; coins: number } | { ok: false; reason: 'unknown' | 'owned' | 'no-coins'; short: number };

/** Buy a set: what you don't own yet, at the set price. Owned for good; nothing is equipped (the shop does that). */
export function buyBundle(save: Pick<SaveData, 'shop' | 'progress' | 'coins'>, id: string): BundleResult {
  const b = bundleOf(id);
  if (!b) return { ok: false, reason: 'unknown', short: 0 };
  const missing = bundleMissing(save, b);
  if (!missing.length) return { ok: false, reason: 'owned', short: 0 };
  const price = bundlePrice(save, b);
  const coins = wallet(save);
  if (coins < price) return { ok: false, reason: 'no-coins', short: price - coins };
  save.coins = coins - price;
  for (const it of missing) grantItem(save, it.cat, it.id);
  return { ok: true, bundle: b, items: missing, price, coins: save.coins };
}

/** Sets you have started (some parts owned, not all), the closest to done first: COMPLETE THE SET. */
export function setsInProgress(save: Pick<SaveData, 'shop' | 'progress'>): { bundle: Bundle; owned: number; total: number; price: number }[] {
  return BUNDLES.map((b) => {
    const total = b.parts.length;
    const owned = total - bundleMissing(save, b).length;
    return { bundle: b, owned, total, price: bundlePrice(save, b) };
  }).filter((x) => x.owned > 0 && x.owned < x.total).sort((a, b) => b.owned / b.total - a.owned / a.total || a.price - b.price);
}

/** The Monday (YYYY-MM-DD) of the week `day` is in: the featured shelf changes on Mondays. */
export function weekOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(y || 2026, (m || 1) - 1, d || 1, 12);
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/**
 * This week's FEATURED shelf (the same for everyone, new every Monday): one set as the hero and four looks, a kit, a
 * player look, a stadium style and an effect. Honest rotation: everything on it is in its own tab all the time, at
 * the same price, so the shelf is a showcase, never a countdown.
 */
export function featuredShelf(day: string): { week: string; bundle: Bundle; items: ShopItem[] } {
  const week = weekOf(day);
  const h = hashString(`featured|${week}`);
  const pick = (list: readonly ShopItem[], salt: number) => list[(h >>> salt) % list.length];
  const sold = (cat: ShopCat) => ITEMS.filter((it) => it.cat === cat && it.price > 0 && !it.pass);
  const fx = [...sold('goalfx'), ...sold('trail')];
  return {
    week,
    bundle: BUNDLES[h % BUNDLES.length],
    items: [pick(sold('kit'), 3), pick(sold('look'), 7), pick(sold('decor'), 11), pick(fx, 15)],
  };
}

export type BuyResult = { ok: true; item: ShopItem; coins: number } | { ok: false; reason: 'unknown' | 'owned' | 'no-coins' | 'pass'; short: number };

/**
 * Buy an item: the price comes out of the wallet (never below zero: short of it, nothing changes and `short`
 * says by how much), it is owned for good and marked seen. Equipping is separate (equipItem). With `day`, today's
 * deal price applies to the deal look. Club Pass looks aren't for sale.
 */
export function buyItem(save: Pick<SaveData, 'shop' | 'progress' | 'coins'>, cat: ShopCat, id: string, day?: string): BuyResult {
  const it = shopItem(cat, id);
  if (!it) return { ok: false, reason: 'unknown', short: 0 };
  if (owns(save, cat, id)) return { ok: false, reason: 'owned', short: 0 };
  if (it.pass) return { ok: false, reason: 'pass', short: 0 };
  const price = priceOn(save, it, day);
  const coins = wallet(save);
  if (coins < price) return { ok: false, reason: 'no-coins', short: price - coins };
  save.coins = coins - price;
  const shop = shopOf(save);
  const key = itemKey(cat, id);
  shop.owned.push(key);
  if (!shop.seen.includes(key)) shop.seen.push(key);
  return { ok: true, item: it, coins: save.coins };
}

/** Coins into the wallet (never a negative or damaged amount); the new total. */
export function creditCoins(save: Pick<SaveData, 'coins'>, amount: number): number {
  save.coins = wallet(save) + (Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0);
  return save.coins;
}

/**
 * An item handed over without coins (a store purchase's bundle, e.g. the Starter Pack's Gold ball): owned for
 * good and marked seen. False, and nothing changes, when it is already in the bought list or isn't an item.
 */
export function grantItem(save: Pick<SaveData, 'shop'>, cat: ShopCat, id: string): boolean {
  if (!shopItem(cat, id)) return false;
  const shop = shopOf(save);
  const key = itemKey(cat, id);
  if (shop.owned.includes(key)) return false;
  shop.owned.push(key);
  if (!shop.seen.includes(key)) shop.seen.push(key);
  return true;
}

/**
 * Put an owned item on (into Settings, where the match reads it): a player look or stadium style goes into its
 * slot, replacing what was there. False, and nothing changes, when it isn't yours.
 */
export function equipItem(save: Pick<SaveData, 'shop' | 'progress' | 'settings'>, cat: ShopCat, id: string): boolean {
  if (!owns(save, cat, id)) return false;
  if (isSlotCat(cat)) {
    const it = shopItem(cat, id)!;
    slotMap(save, cat)[it.slot!] = id;
    return true;
  }
  save.settings[SETTING[cat]] = id;
  return true;
}

/** Take a player look or stadium style off (its slot goes empty). False when it wasn't on. */
export function unequipItem(save: Pick<SaveData, 'settings'>, cat: ShopCat, id: string): boolean {
  if (!isSlotCat(cat)) return false;
  const it = shopItem(cat, id);
  const map = slotMap(save, cat);
  if (!it?.slot || map[it.slot] !== id) return false;
  delete map[it.slot];
  return true;
}

/** What is on in a category: the Settings choice while it is still yours, else the free default ('' for a slot category). */
export function equippedId(save: Pick<SaveData, 'shop' | 'progress' | 'settings'>, cat: ShopCat): string {
  if (isSlotCat(cat)) return '';
  const id = save.settings[SETTING[cat]];
  return id && owns(save, cat, id) ? id : DEFAULT_ID[cat];
}

/** What is worn in one slot of a slot category ('' = nothing), while it is still yours. */
export function equippedIn(save: Pick<SaveData, 'shop' | 'progress' | 'settings'>, cat: SlotCat, slot: string): string {
  const id = slotMap(save, cat)[slot];
  return id && owns(save, cat, id) ? id : '';
}

/** Is this item on (equipped in its category, or worn in its slot)? */
export function isEquipped(save: Pick<SaveData, 'shop' | 'progress' | 'settings'>, cat: ShopCat, id: string): boolean {
  if (isSlotCat(cat)) {
    const it = shopItem(cat, id);
    return !!it?.slot && equippedIn(save, cat, it.slot) === id;
  }
  return equippedId(save, cat) === id;
}

/** Everything worn in a slot category, slot by slot (owned only): what the match reads (meta/style.ts). */
export function equippedSlots(save: Pick<SaveData, 'shop' | 'progress' | 'settings'>, cat: SlotCat): { [slot: string]: string } {
  const out: { [slot: string]: string } = {};
  for (const [slot, id] of Object.entries(slotMap(save, cat))) if (id && owns(save, cat, id)) out[slot] = id;
  return out;
}

// ------------------------------------------------------------------ nudges (sparing: see newInShop / inReach)

/** Items you don't own yet that the wallet covers, dearest first. */
export function affordable(save: Pick<SaveData, 'shop' | 'progress' | 'coins'>): ShopItem[] {
  const coins = wallet(save);
  return ITEMS.filter((it) => it.price > 0 && it.price <= coins && !owns(save, it.cat, it.id)).sort((a, b) => b.price - a.price);
}

/** The free daily scout pack is waiting (one a local day, YYYY-MM-DD). */
export function freePackReady(save: Pick<SaveData, 'shop'>, day: string): boolean {
  return shopOf(save).freePack !== day;
}

/**
 * The count on the menu's SHOP button: affordable items the shop hasn't shown you since they became affordable,
 * plus the free pack when it is waiting. 0 = no badge.
 */
export function newInShop(save: Pick<SaveData, 'shop' | 'progress' | 'coins'>, day: string): number {
  const seen = shopOf(save).seen;
  return affordable(save).filter((it) => !seen.includes(itemKey(it.cat, it.id))).length + (freePackReady(save, day) ? 1 : 0);
}

/** The shop showed a category: what you could buy there (or own) is no longer NEW. */
export function markSeen(save: Pick<SaveData, 'shop' | 'progress' | 'coins'>, cat: ShopCat): void {
  const shop = shopOf(save);
  const coins = wallet(save);
  for (const it of shopItems(cat)) {
    const key = itemKey(it.cat, it.id);
    if ((it.price <= coins || owns(save, it.cat, it.id)) && !shop.seen.includes(key)) shop.seen.push(key);
  }
}

/**
 * The dearest item this match's coins brought into reach (`before` < its price <= `after`), for one line at full
 * time; null when nothing crossed the line (so it shows only when there is news).
 */
export function inReach(save: Pick<SaveData, 'shop' | 'progress'>, before: number, after: number): ShopItem | null {
  const hit = ITEMS.filter((it) => it.price > before && it.price <= after && !owns(save, it.cat, it.id)).sort((a, b) => b.price - a.price);
  return hit[0] ?? null;
}

// ------------------------------------------------------------------ free coins (rewarded ads, web portals)

/** Coins a watched rewarded ad pays in the shop's FREE COINS card, and how many a local day can be watched. */
export const FREE_AD_COINS = 75;
export const FREE_AD_DAILY_CAP = 5;

/** Free-coin ads still open today (`day` = localDay(); a new day starts the count again). */
export function freeAdsLeft(save: Pick<SaveData, 'iap'>, day: string): number {
  const f = iapOf(save).freeAds;
  return f.day === day ? Math.max(0, FREE_AD_DAILY_CAP - f.count) : FREE_AD_DAILY_CAP;
}

export type FreeAdResult = { ok: true; coins: number; left: number } | { ok: false; reason: 'cap' };

/**
 * One watched ad's coins into the wallet, counted against today's cap. Call it only once the ad was watched
 * through (platform/ads.ts rewarded() resolved true); a sixth ad in a day pays nothing.
 */
export function claimFreeAd(save: Pick<SaveData, 'iap' | 'coins'>, day: string): FreeAdResult {
  if (freeAdsLeft(save, day) <= 0) return { ok: false, reason: 'cap' };
  const f = iapOf(save).freeAds;
  if (f.day !== day) {
    f.day = day;
    f.count = 0;
  }
  f.count++;
  return { ok: true, coins: creditCoins(save, FREE_AD_COINS), left: FREE_AD_DAILY_CAP - f.count };
}

// ------------------------------------------------------------------ scout packs

export type PackKind = 'scout' | 'elite';

/**
 * What each pack costs in Scout Tokens (core/save.ts ShopState.tokens). Tokens are earned only, one for every daily
 * challenge done, and never sold: coins (which the app's store sells) can't buy a random card. Apple and PEGI
 * treat paid random items as loot boxes (age ratings, and bans for minors in some countries): this keeps the game
 * 4+ and fair for kids, while the free daily pack and the transfer market's chosen signings stay as they were.
 */
export const PACK_TOKENS: { readonly [k in PackKind]: number } = { scout: 1, elite: 3 };

/** Scout Tokens in hand. */
export function scoutTokens(save: Pick<SaveData, 'shop'>): number {
  return shopOf(save).tokens;
}

/** Add earned Scout Tokens (a daily challenge done); the new count. */
export function earnTokens(save: Pick<SaveData, 'shop'>, n: number): number {
  const shop = shopOf(save);
  shop.tokens = Math.min(999, shop.tokens + Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));
  return shop.tokens;
}
export type Rarity = 'common' | 'rare' | 'epic' | 'legend';
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legend'];

/** The packs on sale: base price (for a club rated PACK_BASE) and the odds of each rarity, in %, as shown. */
export const PACKS: { readonly [k in PackKind]: { name: string; price: number; odds: readonly [number, number, number, number] } } = {
  scout: { name: 'SCOUT PACK', price: 350, odds: [62, 28, 8, 2] },
  elite: { name: 'ELITE PACK', price: 1200, odds: [0, 55, 35, 10] },
};

/** A card's overall against your XI's average, by rarity (inclusive): a common is squad depth, a legend a star. */
export const RARITY_OVR: { readonly [k in Rarity]: readonly [number, number] } = {
  common: [-3, 1], rare: [2, 5], epic: [6, 10], legend: [11, 16],
};
export const PACK_OVR_CAP = 95;
/** The club rating the base prices hold up to (a new club is ~51); a stronger club's scouts cost more (packPrice). */
export const PACK_BASE = 52;

const ROLE_WEIGHTS: readonly [Role, number][] = [['GK', 10], ['DF', 30], ['MF', 30], ['FW', 30]];

/**
 * What a pack costs a club rated `rating`: the base price up to PACK_BASE, then with the square of the rating
 * (the scale player values follow, meta/career.ts playerPrice), so a card never resells for more than the pack.
 */
export function packPrice(kind: PackKind, rating: number): number {
  const k = Math.max(1, Math.min(4, (Math.max(0, rating) / PACK_BASE) ** 2));
  return Math.round((PACKS[kind].price * k) / 10) * 10;
}

export interface PackCard {
  player: MetaPlayer;
  rarity: Rarity;
  ovr: number;
}

/**
 * One card from a `kind` pack for a club whose XI averages `base`: pure, so the same seed always draws the same
 * card. Surnames in `avoid` (the squad's) are never drawn.
 */
export function rollPack(kind: PackKind, base: number, seed: number, avoid: Iterable<string> = []): PackCard {
  const rng = new Rng(hashString(`pack|${kind}|${seed >>> 0}`));
  const odds = PACKS[kind].odds;
  let roll = rng.next() * 100;
  let ri = 0;
  while (ri < 3 && roll >= odds[ri]) roll -= odds[ri++];
  const rarity = RARITIES[ri];
  const [lo, hi] = RARITY_OVR[rarity];
  const target = Math.max(30, Math.min(PACK_OVR_CAP, Math.round(base) + lo + rng.int(hi - lo + 1)));
  let w = rng.next() * 100;
  let role: Role = 'FW';
  for (const [r, p] of ROLE_WEIGHTS) {
    if (w < p) {
      role = r;
      break;
    }
    w -= p;
  }
  const names = new Set<string>([...avoid].map(surnameOf));
  const p = makePlayer(rng, role, target - 4, 0, `pack${seed >>> 0}`, names);
  tuneToOverall(p, target);
  // The better the card, the more likely he is in his prime; a young common one may still grow. Scouted players
  // sign one-year deals (the lowest resale value: a pack is never a way to print coins, see packPrice).
  const age = rarity === 'common' ? 18 + rng.int(15) : rarity === 'rare' ? 20 + rng.int(12) : 23 + rng.int(8);
  const potential = age <= 23 ? 1 + rng.int(rarity === 'common' ? 3 : 5) : 0;
  const player = pinMeta(p, { age, potential, contract: 1 });
  return { player, rarity, ovr: overall(player) };
}

export type PackResult = { ok: true; card: PackCard; price: number; free: boolean } | { ok: false; reason: 'no-club' | 'no-tokens' | 'free-used'; short: number };

/**
 * Open a pack for `club`: its Scout Tokens (PACK_TOKENS, or nothing for the day's free scout pack) are spent,
 * never below zero; `price` is the card's coin value (packPrice at the club's rating), and the card is drawn from the save's own pack count (so a reload draws
 * the same card again: no rerolling). The card is not signed yet: see signCard / sellCard.
 */
export function openPack(
  save: Pick<SaveData, 'shop' | 'coins'>, club: ClubState | null, kind: PackKind, day: string, free = false,
): PackResult {
  if (!club) return { ok: false, reason: 'no-club', short: 0 };
  const shop = shopOf(save);
  const rating = clubRating(club);
  let price = 0;
  if (free) {
    if (kind !== 'scout' || !freePackReady(save, day)) return { ok: false, reason: 'free-used', short: 0 };
    shop.freePack = day;
  } else {
    const cost = PACK_TOKENS[kind];
    if (shop.tokens < cost) return { ok: false, reason: 'no-tokens', short: cost - shop.tokens };
    shop.tokens -= cost;
    // (Its coin value, kept with the card: what a sale may fetch and the resale cap go by it, as before.)
    price = packPrice(kind, rating);
  }
  const seed = hashString(`${club.short}|${club.name}|${shop.packs}`);
  shop.packs++;
  // Kept until the card is signed or sold (settlePack): a closed tab mid-reveal brings the same card back.
  shop.pending = { kind, seed, base: rating, price };
  return { ok: true, card: rollPack(kind, rating, seed, club.squad.map((p) => p.name)), price, free };
}

/** The card of a pack opened but not yet signed or sold (pendingPack in the save), drawn again; null when none. */
export function pendingCard(save: Pick<SaveData, 'shop'>, club: ClubState | null): { card: PackCard; price: number } | null {
  const p = shopOf(save).pending;
  if (!p || !club) return null;
  return { card: rollPack(p.kind, p.base, p.seed, club.squad.map((q) => q.name)), price: p.price };
}

/** The open pack's card has been signed or sold: nothing is waiting any more. */
export function settlePack(save: Pick<SaveData, 'shop'>): void {
  shopOf(save).pending = null;
}

export type SignResult =
  | { ok: true; player: MetaPlayer; starter: boolean; replaced?: PlayerDef; ovrFrom: number; ovrTo: number }
  | { ok: false; reason: 'squad-full' };

/**
 * Sign a card into the squad (never past SQUAD_MAX): a fresh squad id and a free shirt number; straight into the
 * XI when he beats the weakest starter in a slot of his role (that man drops to the bench), else on the bench.
 * `paid` / `season` are what the career market's resale cap reads (meta/market.ts resaleCap: no flipping).
 */
export function signCard(club: ClubState, card: PackCard, paid = 0, season = 1): SignResult {
  if (club.squad.length >= SQUAD_MAX) return { ok: false, reason: 'squad-full' };
  const ovrFrom = clubRating(club);
  const src = card.player;
  const p = pinMeta({ ...clonePlayer(src), id: `c${club.nextId++}`, number: freeNumber(club.squad, src.role) }, {
    age: src.age, potential: src.potential, contract: src.contract,
  });
  p.paid = paid;
  p.boughtSeason = season;
  p.starts = 0;
  club.squad.push(p);
  const slots = FORMATIONS[club.formation];
  let worst = -1;
  for (let i = 0; i < Math.min(11, club.squad.length - 1); i++) {
    if (slots[i]?.role !== p.role) continue;
    if (worst < 0 || overall(club.squad[i]) < overall(club.squad[worst])) worst = i;
  }
  let replaced: PlayerDef | undefined;
  if (worst >= 0 && overall(club.squad[worst]) < overall(p)) {
    replaced = club.squad[worst];
    swapPlayers(club, worst, club.squad.length - 1);
  }
  return { ok: true, player: p, starter: !!replaced, replaced, ovrFrom, ovrTo: clubRating(club) };
}

/** Sell a card on instead of signing him: his quick-sale value (45% of his value, like any quick sale). */
export function sellCard(save: Pick<SaveData, 'coins'>, card: PackCard): number {
  const v = quickSaleValue(card.player);
  save.coins = wallet(save) + v;
  return v;
}

/**
 * Who goes when the squad is full and a card wants his place: the weakest bench player, never the last keeper
 * (and never below SQUAD_MIN). Index into the squad, or -1 when nobody can go.
 */
export function releaseCandidate(club: ClubState): number {
  if (club.squad.length <= SQUAD_MIN) return -1;
  const keepers = club.squad.filter((p) => p.role === 'GK').length;
  let best = -1;
  for (let i = 11; i < club.squad.length; i++) {
    const p = club.squad[i];
    if (p.role === 'GK' && keepers <= 1) continue;
    if (best < 0 || overall(p) < overall(club.squad[best])) best = i;
  }
  return best;
}

/** Let the release candidate go for his quick-sale value (career.ts sellPlayer: the career's own rules). */
export function makeRoom(state: CareerState, save: Wallet): { ok: true; player: PlayerDef; coins: number } | { ok: false } {
  const club = state.club;
  if (!club) return { ok: false };
  const i = releaseCandidate(club);
  const p = club.squad[i];
  if (!p) return { ok: false };
  const r = sellPlayer(state, save, p.id);
  return r.ok ? { ok: true, player: p, coins: r.delta } : { ok: false };
}
