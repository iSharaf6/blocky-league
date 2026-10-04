/**
 * Player-typed names (club name, short code, anything else a player can call something): the characters
 * a name may use, and a blocklist so a name can't be a slur, a swear word or a sex word — plain, in
 * leetspeak (sh1t, a$$), spaced out (f u c k), dotted, hyphenated, accented or in any case.
 *
 * Two layers:
 * - isNameAllowed: the hard filter (swearing, slurs, sex, hate, drugs, self-harm, in English and the commonest
 *   words of a dozen other languages). It is applied when a name is typed AND when a save is read (safeName), so a
 *   name it turns down never reaches a screen.
 * - isNameReserved: names a player may not take for himself: a real club's name, a competition or brand, or one that
 *   poses as the game's staff. Applied when a name is typed only (nameProblem / nameIssue): the game's own clubs and
 *   an old save are never renamed by it.
 *
 * The lists live here and nowhere else. Keep them lowercase, plain ASCII, and never print them in the UI.
 */

/** Anything that is not a letter (any script, accents included), a digit, a space, an apostrophe, a hyphen or a dot. */
export const NAME_DISALLOWED = /[^\p{L}\p{N} .'’-]/gu;

/** Longest club name; the short code is always 3. */
export const NAME_MAX = 18;

/**
 * Words blocked wherever they appear inside the name, once spaces, dots, hyphens and leetspeak are undone
 * ("sc*ntface" is out, and so is "s-c-u-n-t"). Only the worst words go here: anything that is also part of
 * an ordinary word (ass, cock, sex, cum ...) belongs in WHOLE below, or in ALLOW if it is a place or a surname.
 */
const ANYWHERE: readonly string[] = [
  'nigger', 'nigga', 'niggr', 'negro', 'chink', 'gook', 'kike', 'wetback', 'raghead', 'towelhead', 'beaner', 'darkie', 'darky',
  'muzzie', 'shemale', 'tranny', 'faggot', 'fagg', 'retard', 'spastic', 'poofter', 'battyboy', 'lesbo',
  'fuck', 'fuk', 'fck', 'phuck', 'motherf', 'cunt', 'kunt', 'shit', 'bitch', 'biatch', 'whore', 'slut', 'twat',
  'wanker', 'wanking', 'jizz', 'dildo', 'pussy', 'pusy', 'penis', 'vagina', 'vajay', 'porn', 'cocksuck', 'dickhead',
  'asshole', 'arsehole', 'bollock', 'bellend', 'knobhead', 'douche', 'dumbass', 'jackass', 'scumbag', 'goddamn', 'bastard',
  'blowjob', 'handjob', 'rimjob', 'cumshot', 'titties', 'titty', 'boobies', 'orgasm', 'hentai', 'fellatio', 'cunnilingus',
  'rapist', 'molest', 'pedophil', 'paedophil', 'paedo', 'incest', 'necrophil', 'beastiality', 'bestiality',
  'nazi', 'hitler', 'swastika', 'kkk', 'jihadi', 'terrorist', 'genocide',
  // More slurs.
  'niggah', 'chinaman', 'zipperhead', 'cameljockey', 'redskin', 'halfbreed', 'mulatto', 'polack', 'jewboy', 'kaffir', 'kafir',
  'golliwog', 'gollywog', 'jigaboo', 'porchmonkey', 'tarbaby', 'gyppo', 'pikey', 'mongoloid', 'cripple', 'midget',
  // More sex words.
  'masturbat', 'fetish', 'bondage', 'nipple', 'testicle', 'genital', 'ejaculat', 'smegma', 'butthole', 'buttplug',
  'prostitut', 'onlyfans', 'gangbang', 'threesome', 'creampie', 'bukkake', 'deepthroat', 'stripclub', 'upskirt', 'camgirl', 'nymphoman',
  // Hate, terror and violence a club must not be named for.
  'holocaust', 'auschwitz', 'gestapo', 'whitepower', 'whitepride', 'aryannation', 'thirdreich', 'siegheil', 'fuhrer', 'fuehrer',
  'mussolini', 'alqaeda', 'taliban', 'bokoharam', 'binladen', 'suicide', 'selfharm', 'killyourself', 'massacre', 'schoolshoot', 'murder',
  'lynching', 'ethniccleans', 'childabuse', 'wifebeater',
  // Drugs.
  'cocaine', 'crackhead', 'marijuana', 'cannabis', 'ketamine', 'fentanyl', 'drugdeal', 'methhead',
  // The commonest swear words of other languages (Spanish, German, French, Italian, Portuguese, Dutch, Turkish,
  // Polish, Russian, Arabic and Hindi, as they are typed in Latin letters).
  'mierda', 'pendejo', 'cabron', 'maricon', 'hijodeputa', 'scheiss', 'scheise', 'arschloch', 'fotze', 'wichser', 'schlampe', 'hurensohn',
  'putain', 'salope', 'connard', 'encule', 'cazzo', 'stronzo', 'vaffanculo', 'puttana', 'caralho', 'buceta', 'kanker', 'klootzak',
  'siktir', 'orospu', 'kurwa', 'pizda', 'blyat', 'blyad', 'sharmuta', 'sharmoota', 'kosomak',
  'chutiya', 'madarchod', 'behenchod', 'bhenchod', 'bhosdi',
];

/**
 * Words blocked only as a whole word (or when the whole name, spaces and all, spells just this word), because
 * they sit inside everyday words and names: class, assist, cockerel, Sussex, Cumbria, Arsenal, canal.
 */
const WHOLE: readonly string[] = [
  'ass', 'asses', 'arse', 'arses', 'cock', 'cocks', 'dick', 'dicks', 'sex', 'sexy', 'sexo', 'cum', 'cums', 'semen', 'anal', 'anus',
  'tit', 'tits', 'boob', 'boobs', 'boner', 'milf', 'nude', 'nudes', 'naked', 'hoe', 'hoes', 'wank', 'wanks', 'fag', 'fags',
  'spic', 'dyke', 'dykes', 'raping', 'coon', 'coons', 'paki', 'pakis', 'jap', 'japs', 'homo', 'homos', 'queef', 'pedo', 'nonce', 'rape', 'rapes',
  'damn', 'hell', 'crap', 'piss', 'pissed', 'bugger', 'prick', 'pricks', 'knob', 'knobs', 'minge', 'fanny', 'shag', 'shags', 'sod',
  'skank', 'tard', 'spaz', 'mong', 'poof', 'kys', 'wtf', 'stfu', 'isis', 'pube', 'pubes', 'scrotum', 'clit', 'gash', 'thot',
  'nig', 'nigs', 'fuc', 'fuq', 'cnut', 'sht', 'btch', 'fkn', 'fkin', 'fking',
  'niga', 'nigas', 'nigah', 'fux', 'fuks', 'tosser', 'tossers', 'slag', 'slags', 'pimp', 'pimps', 'horny', 'kinky', 'bdsm', 'sperm', 'labia',
  'vulva', 'butt', 'butts', 'booty', 'dilf', 'gilf', 'hooker', 'hookers', 'whor', 'slutty', 'perv', 'pervs', 'pervert', 'incel',
  'wop', 'wops', 'dago', 'dagos', 'kraut', 'krauts', 'honky', 'honkey', 'yid', 'yids', 'heeb', 'abo', 'abos', 'boong', 'wog', 'wogs',
  'sambo', 'injun', 'squaw', 'gimp', 'gimps', 'reich', 'heil', 'stalin', 'polpot', 'isil', 'daesh',
  'erection', 'erections', 'erotic', 'erotica', 'nympho', 'nymphos', 'pidor', 'pidar', 'pidoras', 'bliat',
  'heroin', 'meth', 'stoner', 'stoners', 'ganja', 'lsd', 'mdma', 'druggie', 'junkie', 'junkies',
  'puta', 'putas', 'puto', 'putos', 'joder', 'verga', 'culo', 'zorra', 'hure', 'merde', 'merda', 'nique', 'pute', 'putes', 'porra', 'foda',
  'viado', 'hoer', 'kut', 'amk', 'chuj', 'suka', 'cyka', 'gandu',
];

/**
 * Innocent words that contain a blocked one: taken out of the name before the ANYWHERE scan. Places, surnames
 * and ordinary words the scan would otherwise trip over.
 */
const ALLOW: readonly string[] = [
  'scunthorpe', 'penistone', 'clitheroe', 'cockermouth', 'cockfosters', 'sussex', 'essex', 'middlesex', 'wessex',
  'montenegro', 'negroni', 'ashkenazi', 'retardant', 'fukuoka', 'fukushima', 'pussycat', 'shiitake', 'shitake', 'dickens', 'dickinson', 'dickson',
  'cocker', 'cockerel', 'cockatoo', 'peacock', 'hancock', 'hitchcock', 'babcock', 'woodcock', 'alcock', 'cockburn',
  'assist', 'assistant', 'assistants', 'assists', 'class', 'classic', 'classics', 'bass', 'brass', 'grass', 'glass', 'mass', 'pass',
  'passion', 'cassidy', 'cass', 'lassie', 'lass', 'kunta', 'niggard', 'snigger',
  'analysis', 'analyst', 'canal', 'banal', 'uranus', 'janus', 'cumberland', 'cumbria', 'cummings', 'cucumber', 'document',
  'arsenal', 'hearse', 'parse', 'sparse', 'coarse', 'shell', 'hello', 'hellas', 'seashell', 'hells', 'scrap', 'scraps',
  'title', 'titan', 'titans', 'titanic', 'stitch', 'petit', 'homogeneous', 'homophone', 'japan', 'japanese', 'raccoon', 'cocoon',
  'tycoon', 'pakistan', 'sodor', 'sodium', 'spice', 'spicy', 'spick', 'hoedown', 'shoe', 'shoes', 'fagan', 'fagin', 'nudel',
  'phukets', 'phuket', 'cocktail', 'cockpit', 'cockney', 'sextant', 'sexton', 'sussexes', 'cummerbund', 'circumstance',
  'therapist', 'therapists', 'grapes', 'grape', 'drape', 'drapes', 'rapeseed', 'crape', 'scrape', 'scraper', 'trapeze',
  'anally', 'analog', 'analogue', 'analogy', 'annals',
  // (For the wider lists: places and ordinary words that contain a blocked word.)
  'kafiristan', 'murderkill', 'erectional', 'heroine', 'heroines', 'methil', 'methven', 'osterreich', 'heilbronn', 'unique', 'compute',
  'computer', 'dispute', 'reputa', 'laputa', 'butte', 'button', 'butter', 'butterfly', 'buttress', 'weatherfield', 'stalingrad',
  'peninsula', 'peninsular', 'whistler', 'whittler', 'water', 'watch', 'crest', 'nazir', 'nazim', 'nazirite', 'nazionale', 'internazionale',
  'washita', 'trappist', 'tyranny', 'winegrower', 'replenish', 'winchester', 'middlesbrough', 'middlesboro', 'borough', 'brough',
];

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '€': 'e', '£': 'l',
  '(': 'c', '<': 'c', '¢': 'c', 'ß': 'ss', '9': 'g', '8': 'b', '6': 'g', '¡': 'i', '¥': 'y', '§': 's', '#': 'h',
  // (The copyright and registered signs read as a c and an r. Written by code point: the copy test reads either
  // glyph in a string as a pictograph.)
  [String.fromCharCode(0xa9)]: 'c', [String.fromCharCode(0xae)]: 'r',
};

/**
 * Letters from other scripts that look like Latin ones (Cyrillic а е о р с у х к м т н в і ј ѕ ԁ ԛ ԝ, Greek
 * α β ε ι κ ν ο ρ τ υ χ γ η μ ...): folded to the Latin letter before the scan, so a blocked word can't be
 * spelt with look-alikes (NFKD leaves these alone). Whole names in those scripts still read as their own
 * letters where nothing looks alike.
 */
const CONFUSABLES: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', м: 'm', т: 't', н: 'h', в: 'b', і: 'i', ј: 'j',
  ѕ: 's', ԁ: 'd', ԛ: 'q', ԝ: 'w', ғ: 'f', ԍ: 'g', һ: 'h', ո: 'n', ս: 'u', ց: 'g', ӏ: 'l', ь: 'b', ъ: 'b', з: '3',
  α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', γ: 'y', η: 'n', μ: 'u',
  ϲ: 'c', ϳ: 'j', ѡ: 'w', ꞵ: 'b', ᴀ: 'a', ᴄ: 'c', ᴇ: 'e', ᴋ: 'k', ᴍ: 'm', ᴏ: 'o', ᴘ: 'p', ᴛ: 't', ᴜ: 'u', ᴠ: 'v',
  // Latin letters NFKD leaves whole, more small capitals, and a few more Cyrillic, Greek and Armenian look-alikes.
  ı: 'i', ł: 'l', ø: 'o', đ: 'd', ð: 'd', ƒ: 'f', ɑ: 'a', ɡ: 'g', ɪ: 'i', ʏ: 'y', ǀ: 'l', ꜱ: 's', ᴅ: 'd', ɴ: 'n', ʀ: 'r', ʙ: 'b',
  ɢ: 'g', ʜ: 'h', ʟ: 'l', ꜰ: 'f', ᴊ: 'j', ᴡ: 'w', ᴢ: 'z', æ: 'ae', œ: 'oe', ѵ: 'v', ҝ: 'k', ӌ: 'h', ц: 'u', и: 'n', г: 'r', п: 'n',
  σ: 'o', ς: 'c', ω: 'w', π: 'n', θ: 'o', δ: 'd', ϝ: 'f', օ: 'o', հ: 'h', յ: 'j',
};

/** Lowercase, accents stripped, look-alike letters folded, leetspeak undone, every non-letter turned into a space. */
function normalise(raw: string): string {
  const lower = raw.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  let out = '';
  for (const ch0 of lower) {
    const ch = CONFUSABLES[ch0] ?? ch0;
    const l = LEET[ch];
    if (l !== undefined) out += l;
    else if (/\p{L}/u.test(ch)) out += ch;
    else out += ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Runs of the same letter shortened: three or more to one or to two ("fuuuck", "niggger"), and every double to
 * one ("ffuucckk": doubling each letter got 98% of the list past the old scan).
 */
function squeezed(s: string): string[] {
  const one = s.replace(/(.)\1{2,}/g, '$1');
  const two = s.replace(/(.)\1{2,}/g, '$1$1');
  const single = s.replace(/(.)\1+/g, '$1');
  // Every run halved ("aassss" -> "ass": a word with a double letter of its own, then doubled letter by letter).
  const halved = s.replace(/(.)\1+/g, (run, c: string) => (run.length % 2 === 0 ? c.repeat(run.length / 2) : run));
  const out = [s];
  for (const v of [one, two, single, halved]) if (!out.includes(v)) out.push(v);
  return out;
}

const ALLOW_SORTED = [...ALLOW].sort((a, b) => b.length - a.length);
const WHOLE_SET = new Set(WHOLE);

function scanAnywhere(joined: string, light = false): boolean {
  let s = joined;
  for (const a of ALLOW_SORTED) if (s.includes(a)) s = s.split(a).join(' ');
  s = s.replace(/\s+/g, '');
  // (A sound-alike respelling is only looked up as it stands: squeezing and deleting letters on top of a respelling
  // turns "Penny Stars" into a blocked word.)
  if (light) {
    for (const w of ANYWHERE) if (s.includes(w)) return true;
    return false;
  }
  for (const v of squeezed(s)) for (const w of ANYWHERE) if (v.includes(w)) return true;
  // One stray letter pushed into a longer blocked word ("fuxcker"): each single deletion of a short name is
  // scanned too, against the words of five letters or more (four-letter ones would trip on "count" and the like).
  if (s.length <= 24) {
    for (let i = 0; i < s.length; i++) {
      const v = s.slice(0, i) + s.slice(i + 1);
      for (const w of ANYWHERE) if (w.length >= 5 && v.includes(w)) return true;
    }
  }
  return false;
}

function scanWhole(spaced: string): boolean {
  const tokens = spaced.split(' ').filter(Boolean);
  for (const t of tokens) for (const v of squeezed(t)) if (WHOLE_SET.has(v)) return true;
  // The whole name spelling one word with separators ("a.s.s", "s e x").
  const joined = tokens.join('');
  if (tokens.length > 1) for (const v of squeezed(joined)) if (WHOLE_SET.has(v)) return true;
  return false;
}

/**
 * Sound-alike spellings of the worst words ("fvck", "bytch", "azzhole", "fuxk"): the name respelt each way (and all
 * ways at once) and scanned against the ANYWHERE list only, where no ordinary word comes out blocked.
 */
const SOUND_FOLDS: readonly ((s: string) => string)[] = [
  (s) => s.replace(/v/g, 'u'),
  (s) => s.replace(/y/g, 'i'),
  (s) => s.replace(/z/g, 's'),
  (s) => s.replace(/x/g, 'ck'),
  (s) => s.replace(/v/g, 'u').replace(/y/g, 'i').replace(/z/g, 's'),
];

/** Numbers that are a sex, drug or hate reference standing on their own ("Team 69"; never part of a year). */
const BAD_NUMBERS = /(?<![0-9])(?:69|420|1488)(?![0-9])/;

/** True when the name is fine to show to other people (nothing blocked in it). Empty names are allowed. */
export function isNameAllowed(raw: string): boolean {
  if (!raw) return true;
  if (BAD_NUMBERS.test(raw)) return false;
  // Once more with a 1 read as an l ("s1ut"), and with every odd character simply dropped ("f*u*c*k").
  const forms = [raw, raw.replace(/1/g, 'l'), raw.replace(/[^\p{L}\p{N}]/gu, '')];
  const seen = new Set<string>();
  for (const f of forms) {
    const n = normalise(f);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    if (scanWhole(n) || scanAnywhere(n)) return false;
    for (const fold of SOUND_FOLDS) {
      const v = fold(n);
      if (v !== n && !seen.has(v) && scanAnywhere(v, true)) return false;
    }
  }
  return true;
}

// ------------------------------------------------------------------ reserved names (typed names only)

/**
 * Real clubs a player may not name his own after, matched as the WHOLE name once the club words are dropped
 * ("Liverpool", "Liverpool FC" and "The Liverpool Football Club" are taken; "Liverpool Blocks" is yours). A short
 * list of the best known: this is brand safety, not a register.
 */
const REAL_CLUBS: readonly string[] = [
  'manchester united', 'man united', 'man utd', 'manchester utd', 'manchester city', 'man city', 'liverpool', 'chelsea', 'arsenal',
  'tottenham', 'tottenham hotspur', 'spurs', 'newcastle united', 'aston villa', 'everton', 'west ham', 'west ham united', 'leeds united',
  'leicester city', 'nottingham forest', 'celtic', 'rangers', 'real madrid', 'barcelona', 'barca', 'atletico madrid', 'atletico de madrid',
  'sevilla', 'valencia', 'athletic bilbao', 'real sociedad', 'bayern munich', 'bayern munchen', 'bayern', 'borussia dortmund', 'dortmund',
  'rb leipzig', 'bayer leverkusen', 'juventus', 'juve', 'milan', 'inter milan', 'inter', 'internazionale', 'napoli', 'roma', 'lazio',
  'paris saint germain', 'paris sg', 'psg', 'marseille', 'olympique marseille', 'lyon', 'monaco', 'ajax', 'psv', 'psv eindhoven',
  'feyenoord', 'benfica', 'porto', 'sporting cp', 'galatasaray', 'fenerbahce', 'besiktas', 'boca juniors', 'river plate', 'flamengo',
  'corinthians', 'palmeiras', 'santos', 'la galaxy', 'inter miami', 'al nassr', 'al hilal', 'al ahly', 'zamalek', 'kaizer chiefs',
  'orlando pirates',
];
const REAL_JOINED = new Set(REAL_CLUBS.map((c) => c.replace(/ /g, '')));
/** Words dropped before a name is compared with REAL_CLUBS. */
const CLUB_WORDS = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'as', 'cd', 'ca', 'fk', 'sk', 'bk', 'club', 'football', 'futbol', 'soccer', 'the', 'de', 'team']);
/** Competitions, companies and other games: blocked wherever they appear in the name (spaces and case aside). */
const BRANDS: readonly string[] = [
  'premierleague', 'championsleague', 'europaleague', 'laliga', 'bundesliga', 'seriea', 'ligue1', 'worldcup', 'fifa', 'uefa', 'conmebol',
  'easports', 'efootball', 'proevolution', 'dreamleague', 'footballmanager', 'nike', 'adidas', 'cocacola', 'pepsi', 'redbull', 'mcdonalds',
  'disney', 'pokemon', 'minecraft', 'roblox', 'fortnite', 'lego', 'crossyroad', 'nintendo', 'playstation', 'xbox', 'youtube', 'tiktok',
  'bet365', 'pornhub',
];
/** Whole words that pose as the game or its staff. */
const STAFF = new Set(['admin', 'admins', 'administrator', 'moderator', 'moderators', 'official', 'staff', 'calynx']);
const STAFF_ANYWHERE: readonly string[] = ['blockyleague', 'calynx'];

/** Lowercase letters, digits and single spaces, accents and look-alikes folded (digits kept: "bet365", "ligue1"). */
function plain(raw: string): string {
  const lower = raw.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  let out = '';
  for (const ch0 of lower) {
    const ch = CONFUSABLES[ch0] ?? ch0;
    out += /[\p{L}\p{N}]/u.test(ch) ? ch : ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * True when a typed name is one a player may not take: a real club's name (the whole name, club words aside), a
 * competition, company or other game anywhere in it, or a word that poses as the game's staff.
 */
export function isNameReserved(raw: string): boolean {
  const p = plain(raw);
  if (!p) return false;
  const tokens = p.split(' ');
  const joined = tokens.join('');
  for (const b of BRANDS) if (joined.includes(b)) return true;
  for (const b of STAFF_ANYWHERE) if (joined.includes(b)) return true;
  for (const t of tokens) if (STAFF.has(t)) return true;
  // (Trailing years and numbers go too: "Arsenal 1886" is still the real club's name.)
  const core = tokens.filter((t) => !CLUB_WORDS.has(t) && !/^[0-9]+$/.test(t)).join(' ');
  return !!core && REAL_JOINED.has(core.replace(/ /g, ''));
}

/**
 * The name as the game would keep it: allowed characters only, whitespace collapsed, trimmed, cut to `max`.
 * The blocklist is not applied here (see isNameAllowed / safeName): a field shows what was typed while it
 * tells the player to pick another.
 */
export function cleanName(raw: string, opts: { max?: number } = {}): string {
  const max = opts.max ?? NAME_MAX;
  return raw.replace(/\s+/g, ' ').replace(/’/g, "'").replace(NAME_DISALLOWED, '').replace(/ {2,}/g, ' ').trim().slice(0, max).trim();
}

/** cleanName, or '' when the name is blocked: what goes into the save. */
export function safeName(raw: string, opts: { max?: number } = {}): string {
  const c = cleanName(raw, opts);
  return isNameAllowed(c) ? c : '';
}

/** Exactly why a typed name can't be used: too short, 'rude' (the blocklist) or 'reserved' (a real club, a brand, staff). */
export type NameIssue = '' | 'short' | 'rude' | 'reserved';

export function nameIssue(raw: string, min = 2): NameIssue {
  const c = cleanName(raw);
  if (!isNameAllowed(c) || !isNameAllowed(raw)) return 'rude';
  if (isNameReserved(c)) return 'reserved';
  return c.length < min ? 'short' : '';
}

/** Why a typed name can't be used, or '' when it can ('blocked': rude or reserved, see nameIssue). */
export function nameProblem(raw: string, min = 2): '' | 'short' | 'blocked' {
  const i = nameIssue(raw, min);
  return i === 'rude' || i === 'reserved' ? 'blocked' : i;
}

/** The friendly line under a field whose name was turned down (never the word itself, never a telling off). */
export function nameWhy(issue: NameIssue, what: 'name' | 'code' = 'name'): string {
  if (issue === 'rude') return what === 'code' ? 'Try another code' : 'Keep it friendly, try another';
  if (issue === 'reserved') return 'Taken by a real club or brand';
  return '';
}

const SUGGEST_A = ['Pixel', 'Voxel', 'Cube', 'Brick', 'Blocky', 'Square', 'Crate', 'Chunky', 'Mighty', 'Golden', 'Royal', 'Rapid', 'Thunder', 'Rocket', 'Lucky', 'Turbo'];
const SUGGEST_B = ['Park FC', 'City', 'Rovers', 'United', 'Town', 'Athletic', 'Albion', 'Wanderers', 'Stars', 'Lions', 'Wolves', 'Eagles', 'Dragons', 'Comets'];

/**
 * A name to offer instead of one that was turned down. A reserved name keeps what the player was going for where it
 * can ("Liverpool" gives "Liverpool Blocks"); otherwise a made-up club from `seed` (the same seed, the same name).
 * Always passes the filter and fits the field.
 */
export function suggestName(raw: string, seed = 0): string {
  const c = cleanName(raw);
  if (c && isNameAllowed(c) && isNameReserved(c)) {
    const word = c.split(' ').filter((w) => !CLUB_WORDS.has(w.toLowerCase()))[0] ?? '';
    for (const tail of ['Blocks', 'Bricks', 'Cubes', 'XI']) {
      const s = `${word} ${tail}`;
      if (word.length >= 3 && s.length <= NAME_MAX && nameIssue(s) === '') return s;
    }
  }
  for (let i = 0; i < SUGGEST_A.length * SUGGEST_B.length; i++) {
    const n = (seed >>> 0) + i;
    const s = `${SUGGEST_A[n % SUGGEST_A.length]} ${SUGGEST_B[Math.floor(n / SUGGEST_A.length) % SUGGEST_B.length]}`;
    if (s.length <= NAME_MAX && nameIssue(s) === '') return s;
  }
  return 'Blocky FC';
}

/**
 * A club name and its short code read together on the score bug and the table, so a blocked word split across
 * the two ("Fu" + "CK") is blocked as a pair, either way round.
 */
export function isPairAllowed(name: string, short: string): boolean {
  return isNameAllowed(name) && isNameAllowed(short) && isNameAllowed(name + short) && isNameAllowed(short + name);
}

/** Short code: up to three letters / digits, upper case, or '' when what they spell is blocked. */
export function safeShort(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  return isNameAllowed(s) ? s : '';
}

/**
 * A three-letter code from a club name that passes the filter: the first three letters, else the initials,
 * else other three-letter runs of the name, else X-padded — the first that isn't blocked.
 */
export function fallbackShort(name: string): string {
  const words = name.toUpperCase().split(/\s+/).map((w) => w.replace(/[^A-Z0-9]/g, '')).filter(Boolean);
  const letters = words.join('');
  const pad = (s: string) => (s + 'XXX').slice(0, 3);
  const first = words[0] ?? '';
  const tries: string[] = [first.length >= 3 ? first.slice(0, 3) : letters.slice(0, 3), words.map((w) => w[0]).join('').slice(0, 3)];
  for (let i = 0; i + 3 <= letters.length; i++) tries.push(letters.slice(i, i + 3));
  tries.push(letters.slice(0, 2), letters.slice(0, 1));
  for (const t of tries) {
    const c = pad(t);
    if (c && isNameAllowed(c)) return c;
  }
  return 'BLK';
}
