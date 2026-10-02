# -*- coding: utf-8 -*-
"""
构建《英语四级 你还在背单词吗》结构化词书 JSON 数据包。
输入：resource/英语四级你还在背单词吗/UxLy.csv（48 课）+ resource/stardict.db（音标兜底，只读）
输出：public/wordbooks/cet4-beidanci/manifest.json + lessons/UxLy.json
"""
import csv, os, re, json, sqlite3, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scripts_phonetic_convert import phonetic_to_ipa as cv

BASE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = os.path.join(BASE, 'resource', '英语四级你还在背单词吗')
DEST = os.path.join(BASE, 'public', 'wordbooks', 'cet4-beidanci')
LESSON_DIR = os.path.join(DEST, 'lessons')
os.makedirs(LESSON_DIR, exist_ok=True)

# ---------- stardict 音标签名缓存（只读，用于损坏/缺失音标的兜底） ----------
conn = sqlite3.connect(os.path.join(BASE, 'resource', 'stardict.db'))
_db = conn.cursor()
_phon_cache = {}
def db_phonetic(word):
    key = word.lower()
    if key in _phon_cache:
        return _phon_cache[key]
    cands = [word]
    # 去括号、去后缀变体后的基础形
    base = re.sub(r'\([^)]*\)', '', word)
    if base != word:
        cands.append(base)
    full = re.sub(r'[()]', '', word)
    if full not in cands:
        cands.append(full)
    val = ''
    for cw in cands:
        cw = cw.strip().lower()
        if not cw:
            continue
        _db.execute('SELECT phonetic FROM stardict WHERE word=? LIMIT 1', (cw,))
        r = _db.fetchone()
        if r and r[0]:
            val = cv(r[0])
            if val and '?' not in val:
                break
    _phon_cache[key] = val
    return val

def fix_phonetic(raw, word):
    """CSV 音标 -> 标准 IPA（无斜杠）；损坏/缺失时查 stardict 兜底。"""
    raw = raw or ''
    # 含 ? 说明是识别损坏的音标，转换会丢音，直接丢弃走兜底
    p = '' if '?' in raw else cv(raw)
    if not p or '?' in p:
        p = db_phonetic(word)
    return (p or '').strip('/').strip()

# ---------- 词形展开（用于拼写判分的可接受答案） ----------
# 主拼写（显示用）人工覆盖：解决 -our/-l(l)- 等英美拼写不规则
DISPLAY_OVERRIDE = {
    'fulfil(l)': 'fulfil', 'fulfil(l)ment': 'fulfilment',
    'enrol(l)': 'enrol', 'enrol(l)ment': 'enrolment',
    'instal(l)': 'install', 'instal(l)ment': 'instalment',
    'wag(g)on': 'wagon', 'marvel(l)ous': 'marvellous',
    'jewel(le)ry': 'jewellery',
}
def expand_forms(w):
    w = w.strip()
    if w in DISPLAY_OVERRIDE:
        primary = DISPLAY_OVERRIDE[w]
    else:
        primary = None
    segs = [s.strip() for s in w.split('/') if s.strip()]
    forms = []
    prev_full = None
    for seg in segs:
        if seg.startswith('-') and prev_full:
            suffix = seg[1:]
            alt = prev_full[:len(prev_full) - len(suffix)] + suffix
            cand = [prev_full, alt]
        else:
            opts = [seg]
            for m in re.finditer(r'\(([^)]*)\)', seg):
                new = []
                for o in opts:
                    new.append(o.replace(m.group(0), m.group(1)))
                    new.append(o.replace(m.group(0), ''))
                opts = new
            cand = opts
            if cand:
                prev_full = cand[0]
        for c in cand:
            c = c.strip()
            if c and c not in forms:
                forms.append(c)
    if primary and primary not in forms:
        forms.insert(0, primary)
    if primary and forms[0] != primary:
        forms.remove(primary)
        forms.insert(0, primary)
    return forms

# ---------- pos_def -> meanings ----------
POS_RE = re.compile(r'((?:modal\s+)?[a-zA-Z]{1,6})\.\s*')
def parse_pos_def(text):
    text = (text or '').strip()
    if not text:
        return []
    matches = list(POS_RE.finditer(text))
    if not matches or matches[0].start() > 2:
        return [{'p': '', 'd': text}]
    out = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        part = m.group(1).replace('modal ', '').strip()
        if part == 'modal':
            part = 'v'
        definition = text[start:end].strip(' ；;，,')
        if definition:
            out.append({'p': part, 'd': definition})
    return out or [{'p': '', 'd': text}]

# ---------- 例句拆分 ----------
DASH_RE = re.compile(r'\s*(?:——|--|—|–)\s*')
YEAR_RE = re.compile(r'[（(]\s*(\d{4})\s*[)）]\s*$')
def parse_example(text):
    text = (text or '').strip()
    if not text:
        return None
    parts = DASH_RE.split(text, 1)
    en = parts[0].strip()
    zh = parts[1].strip() if len(parts) > 1 else ''
    year = ''
    my = YEAR_RE.search(en)
    if my:
        year = my.group(1)
        en = en[:my.start()].strip()
    return {'en': en, 'zh': zh, 'y': year} if (en or zh) else None

# ---------- 派生词解析 ----------
# 一个派生词块 = 词形 + 空格 + /音标/ + 释义；释义可含；（同词多词性/多义），
# 块的边界是"；+ 下一个词形 + 空格 + /音标/"。词形内部斜杠（urbanise/-ize）无空格，不参与边界判定。
DERIV_BLOCK_RE = re.compile(
    r'(.+?)\s+/([^/]+)/\s*(.*?)'
    r'(?=\s*[;；]\s*[A-Za-z][A-Za-z()\-]*(?:[ /][A-Za-z()\-]+)*\s*/[^/]+/|$)',
    re.S
)
def parse_derivatives(text):
    text = (text or '').strip()
    if not text:
        return []
    out = []
    for m in DERIV_BLOCK_RE.finditer(text):
        raw_w = m.group(1).strip().lstrip(';；').strip()
        raw_ph = m.group(2).strip()
        rest = m.group(3).strip().strip(';；').strip()
        if not raw_w:
            continue
        forms = expand_forms(raw_w)
        w = forms[0]
        ph = fix_phonetic(raw_ph, w)
        pos = parse_pos_def(rest)
        out.append({'w': w, 'ph': ph, 'pos': pos})
    return out

# ---------- 构建 48 课 ----------
units = {}
total = 0
report_missing_ph = []
for unit in range(1, 13):
    for lesson in range(1, 5):
        uid, lid = f'U{unit}', f'L{lesson}'
        fpath = os.path.join(SRC, f'{uid}{lid}.csv')
        if not os.path.exists(fpath):
            continue
        words = []
        groups = {}
        with open(fpath, encoding='utf-8-sig') as f:
            for row in csv.DictReader(f):
                w_raw = row['word'].strip()
                forms = expand_forms(w_raw)
                w = forms[0]
                ph = fix_phonetic(row.get('phonetic', ''), w_raw)
                if not ph:
                    report_missing_ph.append((f'{uid}{lid}', w_raw))
                pos = parse_pos_def(row.get('pos_def', ''))
                der = parse_derivatives(row.get('derivatives', ''))
                for d in der:
                    if not d['ph']:
                        report_missing_ph.append((f'{uid}{lid}', '派生:' + d['w']))
                ex = parse_example(row.get('example', ''))
                real = parse_example(row.get('real', ''))
                gno = int(row.get('group_no', '0') or 0)
                gname = (row.get('group', '') or '').strip()
                if gno:
                    groups.setdefault(gno, {'no': gno, 'name': gname, 'count': 0})
                    groups[gno]['count'] += 1
                words.append({
                    'w': w, 'ans': forms, 'ph': ph,
                    'pos': pos,
                    'mem': (row.get('memory', '') or '').strip(),
                    'ex': ex, 'real': real, 'der': der,
                    'g': gno, 'gn': gname,
                })
        lesson_obj = {'id': f'{uid}{lid}', 'unit': uid, 'lesson': lid, 'words': words}
        with open(os.path.join(LESSON_DIR, f'{uid}{lid}.json'), 'w', encoding='utf-8') as f:
            json.dump(lesson_obj, f, ensure_ascii=False, separators=(',', ':'))
        part = 'P1' if unit <= 10 else 'P2'
        units.setdefault(uid, {'id': uid, 'idx': unit, 'part': part, 'lessons': []})
        units[uid]['lessons'].append({
            'id': f'{uid}{lid}', 'idx': lesson,
            'name': f'Lesson {lesson}', 'count': len(words),
            'file': f'lessons/{uid}{lid}.json',
            'groups': [groups[k] for k in sorted(groups)],
        })
        total += len(words)
        print(f'{uid}{lid}: {len(words)} words')

# ---------- manifest ----------
part_names = {'P1': '词以群记', 'P2': '词以序记'}
parts = []
for pid in ['P1', 'P2']:
    us = [units[u] for u in sorted(units) if units[u]['part'] == pid]
    parts.append({
        'id': pid, 'name': part_names[pid],
        'units': [{
            'id': u['id'], 'idx': u['idx'], 'name': f'Unit {u["idx"]}',
            'lessons': u['lessons'],
            'count': sum(l['count'] for l in u['lessons']),
        } for u in us],
    })
manifest = {
    'id': 'cet4-beidanci',
    'name': '英语四级 · 你还在背单词吗',
    'author': '刘晓艳',
    'description': 'PART 01 词以群记（U1–U10）· PART 02 词以序记（U11–U12）',
    'parts': parts,
    'totalCount': total,
    'lessonCount': sum(len(u['lessons']) for u in units.values()),
}
with open(os.path.join(DEST, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1)

# 轻量词索引：{lessonId: [word,...]}，仅用于选词进度统计（完整字段在 lessons/*.json）
index = {}
for uid2 in sorted(units):
    for l in units[uid2]['lessons']:
        data = json.load(open(os.path.join(LESSON_DIR, l['id'] + '.json'), encoding='utf-8'))
        index[l['id']] = [w['w'] for w in data['words']]
with open(os.path.join(DEST, 'index.json'), 'w', encoding='utf-8') as f:
    json.dump(index, f, ensure_ascii=False, separators=(',', ':'))

print(f'\nTOTAL words: {total}, lessons: {manifest["lessonCount"]}')
print(f'phonetic missing ({len(report_missing_ph)}):')
for x in report_missing_ph[:60]:
    print('  ', x)
conn.close()
