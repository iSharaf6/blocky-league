/**
 * Player-typed names (club name, short code, anything else a player can call something): the characters
 * a name may use, and a blocklist so a name can't be a slur, a swear word or a sex word — plain, in
 * leetspeak (sh1t, a$$), spaced out (f u c k), dotted, hyphenated, accented or in any case.
 *
 * The list lives here and nowhere else. Keep it lowercase, plain ASCII, and never print it in the UI.
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
];

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '€': 'e', '£': 'l',
  '(': 'c', '<': 'c', '¢': 'c', 'ß': 'ss', '9': 'g', '8': 'b',
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

function scanAnywhere(joined: string): boolean {
  let s = joined;
  for (const a of ALLOW_SORTED) if (s.includes(a)) s = s.split(a).join(' ');
  s = s.replace(/\s+/g, '');
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

/** True when the name is fine to show to other people (nothing blocked in it). Empty names are allowed. */
export function isNameAllowed(raw: string): boolean {
  if (!raw) return true;
  // Once more with a 1 read as an l ("s1ut"), and with every odd character simply dropped ("f*u*c*k").
  const forms = [raw, raw.replace(/1/g, 'l'), raw.replace(/[^\p{L}\p{N}]/gu, '')];
  const seen = new Set<string>();
  for (const f of forms) {
    const n = normalise(f);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    if (scanWhole(n) || scanAnywhere(n)) return false;
  }
  return true;
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

/** Why a typed name can't be used, or '' when it can. */
export function nameProblem(raw: string, min = 2): '' | 'short' | 'blocked' {
  const c = cleanName(raw);
  if (!isNameAllowed(c) || !isNameAllowed(raw)) return 'blocked';
  return c.length < min ? 'short' : '';
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
