"""Recalculate every formula cell of the economy workbook and compare it with what the generator cached.

Run after scripts/economy-workbook.py, with the same Python (openpyxl):
    python scripts/economy-formulas.py [docs/economy/Blocky-League-Economy.xlsx] [docs/economy/model.json]

A small evaluator for the formula shapes the workbook uses (arithmetic, comparisons, IF, AND, MAX, SUM, ROUND,
ROUNDUP, ABS, ranges, unions, sheet-qualified and absolute references): no third-party engine. Each formula is worked
out from the workbook's own input cells. Two comparisons are printed:
  1. the recalculated value against the value the generator cached (which it computes from model.json, not from the sheet);
  2. each Balance Checks row against the model's own measure of the same check, and whether PASS / FAIL agree.
Exit code 1 if a formula cannot be evaluated, a cached value differs, or a check's result differs from the model's."""
import json, math, re, sys
from pathlib import Path
import openpyxl
from openpyxl.utils import range_boundaries, get_column_letter

path = sys.argv[1] if len(sys.argv) > 1 else 'docs/economy/Blocky-League-Economy.xlsx'
model_path = sys.argv[2] if len(sys.argv) > 2 else 'docs/economy/model.json'
wf = openpyxl.load_workbook(path)                    # formulas as written
wv = openpyxl.load_workbook(path, data_only=True)    # the cached values the generator wrote

TOKEN = re.compile(r"""\s*(?:
  (?P<num>\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+) |
  (?P<str>"(?:[^"]|"")*") |
  (?P<ref>(?:'[^']+'!|[A-Za-z_][A-Za-z0-9_ ]*!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?) |
  (?P<name>[A-Z][A-Z0-9.]*)(?=\() |
  (?P<op><=|>=|<>|[-+*/^(),<>=&])
)""", re.X)

def tokenize(src):
    out, i = [], 0
    while i < len(src):
        m = TOKEN.match(src, i)
        if not m or m.end() == i:
            raise ValueError(f'cannot tokenize {src[i:i+30]!r} in {src!r}')
        kind = m.lastgroup
        out.append((kind, m.group(kind)))
        i = m.end()
    return out

class Range(list):
    pass

cache = {}
def cell(sheet, coord):
    key = (sheet, coord)
    if key in cache:
        return cache[key]
    raw = wf[sheet][coord].value
    if isinstance(raw, str) and raw.startswith('='):
        cache[key] = None                      # guards a cycle
        val = Parser(tokenize(raw[1:]), sheet).parse()
    else:
        val = raw
    cache[key] = val
    return val

def resolve(ref, here):
    sheet = here
    if '!' in ref:
        s, ref = ref.rsplit('!', 1)
        sheet = s.strip("'")
    ref = ref.replace('$', '')
    if ':' in ref:
        c1, r1, c2, r2 = range_boundaries(ref)
        return Range(cell(sheet, f'{get_column_letter(c)}{r}') for r in range(r1, r2 + 1) for c in range(c1, c2 + 1))
    return cell(sheet, ref)

def num(v):
    if v is None or v == '': return 0.0
    if isinstance(v, bool): return 1.0 if v else 0.0
    if isinstance(v, (int, float)): return float(v)
    raise TypeError(f'not a number: {v!r}')

def flat(args):
    for a in args:
        if isinstance(a, Range):
            for x in a:
                if isinstance(x, (int, float)) and not isinstance(x, bool): yield float(x)   # a range skips text and blanks
        elif a is not None and a != '':
            yield num(a)

def compare(op, a, b):
    # Excel orders numbers before text before booleans.
    rank = lambda v: 2 if isinstance(v, bool) else 1 if isinstance(v, str) else 0
    a = 0.0 if a is None else a; b = 0.0 if b is None else b
    ka, kb = (rank(a), a.lower() if isinstance(a, str) else float(a)), (rank(b), b.lower() if isinstance(b, str) else float(b))
    return {'<': ka < kb, '>': ka > kb, '<=': ka <= kb, '>=': ka >= kb, '=': ka == kb, '<>': ka != kb}[op]

def roundup(x, d):
    f = 10 ** d
    return math.copysign(math.ceil(abs(x) * f - 1e-12) / f, x)
def xround(x, d):
    f = 10 ** d
    return math.copysign(math.floor(abs(x) * f + 0.5 + 1e-12) / f, x)

FUNCS = {
    'IF': None, 'AND': lambda *a: all(bool(x) for x in a), 'MAX': lambda *a: max(flat(a), default=0.0), 'SUM': lambda *a: sum(flat(a)),
    'ROUND': lambda x, d=0: xround(num(x), int(num(d))), 'ROUNDUP': lambda x, d=0: roundup(num(x), int(num(d))), 'ABS': lambda x: abs(num(x)),
}
used = {}

class Parser:
    def __init__(self, toks, sheet): self.t, self.i, self.sheet = toks, 0, sheet
    def peek(self): return self.t[self.i] if self.i < len(self.t) else (None, None)
    def take(self): tok = self.peek(); self.i += 1; return tok
    def parse(self):
        v = self.comparison()
        if self.i != len(self.t): raise ValueError(f'trailing tokens {self.t[self.i:]}')
        return v
    def comparison(self):
        left = self.additive()
        while self.peek()[1] in ('<', '>', '<=', '>=', '=', '<>'):
            op = self.take()[1]; left = compare(op, left, self.additive())
        return left
    def additive(self):
        left = self.term()
        while self.peek()[1] in ('+', '-'):
            op = self.take()[1]; right = self.term()
            left = num(left) + num(right) if op == '+' else num(left) - num(right)
        return left
    def term(self):
        left = self.unary()
        while self.peek()[1] in ('*', '/'):
            op = self.take()[1]; right = self.unary()
            left = num(left) * num(right) if op == '*' else num(left) / num(right)
        return left
    def unary(self):
        if self.peek()[1] == '-': self.take(); return -num(self.unary())
        if self.peek()[1] == '+': self.take(); return num(self.unary())
        return self.atom()
    def atom(self):
        kind, text = self.take()
        if kind == 'num': return float(text)
        if kind == 'str': return text[1:-1].replace('""', '"')
        if kind == 'ref': return resolve(text, self.sheet)
        if kind == 'name':
            used[text] = used.get(text, 0) + 1
            assert self.take()[1] == '('
            if text == 'IF':                       # lazy: only the taken branch is evaluated (a guarded division)
                cond = self.comparison(); assert self.take()[1] == ','
                start = self.i; a = self.skip(); assert self.take()[1] == ','
                bstart = self.i; b = self.skip(); assert self.take()[1] == ')'
                end = self.i
                self.i = start if cond else bstart
                v = self.comparison()
                self.i = end
                return v
            args = []
            if self.peek()[1] != ')':
                args.append(self.comparison())
                while self.peek()[1] == ',': self.take(); args.append(self.comparison())
            assert self.take()[1] == ')'
            if text not in FUNCS: raise ValueError(f'function {text} not supported')
            return FUNCS[text](*args)
        if text == '(':
            v = self.comparison(); assert self.take()[1] == ')'; return v
        raise ValueError(f'unexpected {kind} {text}')
    def skip(self):
        depth = 0
        while True:
            _, text = self.peek()
            if text is None: raise ValueError('unbalanced')
            if depth == 0 and text in (',', ')'): return
            if text == '(': depth += 1
            if text == ')': depth -= 1
            self.i += 1

checked, mismatches, per_sheet, errors = 0, [], {}, []
for ws in wf:
    for row in ws.iter_rows():
        for c in row:
            if not (isinstance(c.value, str) and c.value.startswith('=')): continue
            checked += 1; per_sheet[ws.title] = per_sheet.get(ws.title, 0) + 1
            cached = wv[ws.title][c.coordinate].value
            try:
                got = cell(ws.title, c.coordinate)
            except Exception as e:                # an unsupported shape is reported, never skipped silently
                errors.append((ws.title, c.coordinate, c.value, repr(e))); continue
            if isinstance(got, bool) or isinstance(got, str) or isinstance(cached, str):
                ok = got == cached
            else:
                a, b = float(got), float(cached if cached is not None else 0)
                ok = abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))
            if not ok: mismatches.append((ws.title, c.coordinate, c.value, cached, got))
print('formula cells checked:', checked)
for k, v in per_sheet.items(): print(f'  {k}: {v}')
print('functions used:', dict(sorted(used.items())))
print('could not evaluate:', len(errors))
for e in errors[:20]: print('  ', e)
print('mismatches (cached value against recalculated):', len(mismatches))
for m in mismatches[:80]: print('  ', m[0], m[1], 'cached', m[3], 'recalculated', m[4], '|', m[2][:110])

# ---- the Balance Checks sheet against the model's own measure of each check
bad = 0
model = json.loads(Path(model_path).read_text()) if Path(model_path).exists() else None
if model and 'Balance Checks' in wf.sheetnames and model.get('career'):
    ws = wf['Balance Checks']
    checks = model['career']['checks']
    print(f"Balance Checks against {model_path} (economy v{model.get('economyVersion')}): {len(checks)} checks")
    apart = []
    for i, ch in enumerate(checks):
        r = i + 2
        measured, result = cell('Balance Checks', f'E{r}'), cell('Balance Checks', f'F{r}')
        want = 'PASS' if ch['pass'] else 'FAIL'
        if ws[f'B{r}'].value != ch['check'] or result != want:
            bad += 1; print('  RESULT DIFFERS', ch['id'], 'sheet', result, 'model', want)
        a, b = float(measured), float(ch['value'])
        if abs(a - b) > 1e-9 * max(1.0, abs(a), abs(b)):
            apart.append((ch['id'], b, a))
            if abs(a - b) > 0.01 * max(1e-9, abs(b)): bad += 1; print('  MORE THAN 1% APART', ch['id'], 'model', b, 'sheet', a)
    print(f"  results that agree with the model: {len(checks) - bad} of {len(checks)}; PASS {sum(1 for c in checks if c['pass'])}, FAIL {sum(1 for c in checks if not c['pass'])}")
    for cid, b, a in apart: print(f"  {cid}: the sheet's rows give {a:.6g}, the model's exact measure is {b:.6g} (whole coins a day, or finished seasons only, on the sheet)")
sys.exit(1 if errors or mismatches or bad else 0)
