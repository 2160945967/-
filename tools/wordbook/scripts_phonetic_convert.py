# -*- coding: utf-8 -*-
"""
ECDICT 重拼音标 / 半 IPA 音标 -> 标准 DJ 音标（IPA）转换器（Python 参考实现 v3）
- 自动识别输入是"重拼式"（拉丁元音 i/u/o + 西里尔 ә + ASCII 重音 '）还是"已 IPA"；
- 重拼式走完整元音重映射；已 IPA 走幂等轻量归一化（只修重音/长音符号/注释）；
- 只保留第一个读音变体；脏数据（韦氏音标、中文说明、IPA: 原文）原样返回。
"""
import re

_LONG = [
    ('iә', 'ɪə'), ('eә', 'eə'), ('εә', 'eə'), ('ɛә', 'eə'), ('єә', 'eə'),
    ('әu', 'əʊ'), ('ou', 'əʊ'),
    ('ei', 'eɪ'), ('ai', 'aɪ'), ('ɔi', 'ɔɪ'), ('au', 'aʊ'),
    ('i:', 'iː'), ('ɑ:', 'ɑː'), ('ɒ:', 'ɔː'), ('ɔ:', 'ɔː'), ('u:', 'uː'),
    ('ә:', 'ɜː'), ('ə:', 'ɜː'), ('ɜ:', 'ɜː'), ('ɝ:', 'ɜː'),
]
_VOWEL_CHARS = set('әəaæeɛεiɒɔʌɑou')
_STRESS_VARIANTS = {'ˊ': 'ˈ', '´': 'ˈ', '’': 'ˈ', '‘': 'ˈ', 'ʹ': 'ˈ'}
_SINGLE_MAP = {
    'ә': 'ə', 'є': 'e', 'ɛ': 'e', 'ε': 'e',
    'ɒ': 'ɒ', 'ɔ': 'ɒ', 'ɑ': 'ɑː',
    'ɚ': 'ə', 'ɝ': 'ɜ', 'ɹ': 'r', 'ɵ': 'ə',
}
_DIRTY_CHARS = set('āēīōūăĕĭŏŭäëïöüÄËÏÖÜÂÊÎÔÛâêîôû')

# 已是 IPA 的铁证：这些字符只可能出现在 IPA 中（重拼式用 i/u/ә: 代替）
_IPA_MARKER = re.compile(r'[ːɪʊɜə]')
# 合法音标字符（用于截取首个音标段，剔除后面混入的词性/释义/注释）
_PHONETIC_RUN = re.compile(r"^[\sˈˌ'’,\.a-zA-Zɑæɒɔəɜɛɪʊʌʌθðʃʒŋɐɚɝɹɵɡ\u0300-\u036f()ːːː\-rRlLmnɱœøɐɛœæ\u0250-\u02af]+")

def _convert_respelled(s: str) -> str:
    for k, v in _STRESS_VARIANTS.items():
        s = s.replace(k, v)
    placeholders = {}
    for i, (src, dst) in enumerate(_LONG):
        ph = f'\x00{i}\x00'
        if src in s:
            s = s.replace(src, ph)
            placeholders[ph] = dst
    out = []
    idx = 0
    while idx < len(s):
        ch = s[idx]
        nxt = s[idx + 1] if idx + 1 < len(s) else ''
        prev = s[idx - 1] if idx > 0 else ''
        if ch == 'u' and nxt == 'ә':
            out.append('uə' if prev == 'j' else 'ʊə'); idx += 2; continue
        if ch == 'u':
            out.append('u' if prev == 'j' and (nxt in _VOWEL_CHARS or nxt == '\x00' or nxt == '') else 'ʊ')
        elif ch == 'i':
            rest = s[idx + 1:]
            out.append('i' if rest == '' or all(c == '\x00' for c in rest) else 'ɪ')
        elif ch == 'o':
            out.append('əʊ')
        elif ch == 'U':
            out.append('ʌ')
        elif ch in _SINGLE_MAP:
            out.append(_SINGLE_MAP[ch])
        elif ch in '^?\\:':
            pass
        else:
            out.append(ch)
        idx += 1
    s = ''.join(out)
    for ph, dst in placeholders.items():
        s = s.replace(ph, dst)
    return s.replace("'", 'ˈ')

def _normalize_ipa(s: str) -> str:
    """已 IPA 的幂等归一化：重音、ASCII 长音冒号、个别西里尔字符。"""
    for k, v in _STRESS_VARIANTS.items():
        s = s.replace(k, v)
    for src, dst in [('i:', 'iː'), ('u:', 'uː'), ('ɑ:', 'ɑː'), ('ɒ:', 'ɔː'),
                     ('ɔ:', 'ɔː'), ('ə:', 'ɜː'), ('ә:', 'ɜː'), ('ɜ:', 'ɜː'), ('e:', 'eː')]:
        s = s.replace(src, dst)
    s = s.replace('ә', 'ə').replace("'", 'ˈ')
    # 残留裸冒号（元音长音）统一为 ː；不在元音后的冒号极少见，忽略
    s = re.sub(r'(?<=[aeiouæɑɒɔəɜʌɪʊɛɝ])\s*:', 'ː', s)
    return s

def _first_phonetic_segment(s: str) -> str:
    """从可能混入词性/释义/注释的字符串中取出首个音标段。"""
    s = s.strip()
    # 删除 (=xxx) 形式的等号注释
    s = re.sub(r'\(\s*=[^)]*\)', '', s)
    # 配对斜杠：取第一个 /.../
    m = re.match(r'\s*/([^/]*)/', s)
    if m:
        s = m.group(1).strip()
    else:
        # 无斜杠：在首个中文/等号处截断
        s = re.split(r'[\u4e00-\u9fff=]', s)[0].strip()
    # 统一只取第一个读音变体
    s = re.split(r'\s*[;,；，]\s*|\s*\.\s+', s)[0]
    return s.strip()

def phonetic_to_ipa(raw: str) -> str:
    if not raw:
        return ''
    original = raw.strip()
    # 数据自带标准 IPA（形如 "IPA: /.../" 或 "IPA: [...]"，常与韦氏音标并存）时优先提取
    m_ipa = re.search(r'IPA\s*[:：]?\s*[/\[]([^/\]\[]+)[/\]]', original)
    if m_ipa:
        cand = m_ipa.group(1).strip().replace('ɹ', 'r')
        return _normalize_ipa(cand).strip().strip('/').strip()
    s = original
    # 反斜杠 + 冒号乱码 = ɜː（cleanPhonetic 同款问题）
    s = re.sub(r'\\+\s*:', 'ɜː', s)
    lead = ''
    if s and s.lstrip('/').startswith((',', '.')):
        lead = 'ˌ'
        s = s.lstrip('/')[1:] if not s.startswith('/') else s
    if s and s[0] in (',', '.'):
        lead = 'ˌ'; s = s[1:]
    s = _first_phonetic_segment(s)
    if not s:
        return ''
    # 脏数据原样返回（去斜杠）
    if any(ch in s for ch in _DIRTY_CHARS) or 'IPA' in original:
        return s
    converted = _normalize_ipa(s) if _IPA_MARKER.search(s) else _convert_respelled(s)
    if lead and not converted.startswith('ˈ'):
        converted = lead + converted
    return converted.strip().strip('/').strip()

if __name__ == '__main__':
    tests = [
        # 重拼式
        ('speis', 'speɪs'), ("'ju:nivә:s", 'ˈjuːnɪvɜːs'), ("ju:'nait", 'juːˈnaɪt'),
        (".ri:ju:'nait", 'ˌriːjuːˈnaɪt'), ("'ju:njәn", 'ˈjuːnjən'), ("dai'vә:s", 'daɪˈvɜːs'),
        ("kәn'vә:t", 'kənˈvɜːt'), ("æni'vә:sәri", 'ænɪˈvɜːsəri'), ("'ænjuәl", 'ˈænjuəl'),
        ("'kɒntrәvә:si", 'ˈkɒntrəvɜːsi'), ("'nɑ:sti", 'ˈnɑːsti'), ("'æstrәnɒ:t", 'ˈæstrənɔːt'),
        ("'sætlait", 'ˈsætlaɪt'), ("di'velәp", 'dɪˈveləp'), ("i'vɒlv", 'ɪˈvɒlv'),
        ("'ɒngәuiŋ", 'ˈɒngəʊɪŋ'), ("im'pru:v", 'ɪmˈpruːv'), ("i'neibl", 'ɪˈneɪbl'),
        ("in'lɑ:dʒ", 'ɪnˈlɑːdʒ'), ("'fɑ:sәn", 'ˈfɑːsən'), ("'wɒtәtait", 'ˈwɒtətaɪt'),
        (".ʌn'du:", 'ˌʌnˈduː'), ('fɒ:m', 'fɔːm'), ("fɒ:'meiʃәn", 'fɔːˈmeɪʃən'),
        ("'fɒ:mjuleit", 'ˈfɔːmjʊleɪt'), ("'fɒ:mjulә", 'ˈfɔːmjʊlə'), ("'nәutifai", 'ˈnəʊtɪfaɪ'),
        ("'nәutisәbl", 'ˈnəʊtɪsəbl'), ("'hevn", 'ˈhevn'), ("'bʌkl", 'ˈbʌkl'),
        ("'eni", 'ˈeni'), ('sent', 'sent'), (",ri:ju:nifi'keiʃәn,ri:,ju:-", 'ˌriːjuːnɪfɪˈkeɪʃən'),
        ("in'ritʃ", 'ɪnˈrɪtʃ'), ("'ju:nifɒ:m", 'ˈjuːnɪfɔːm'), ('mu:n', 'muːn'), ('lu:s', 'luːs'),
        ('wә:k', 'wɜːk'), ('ðєә', 'ðeə'), ('gou', 'gəʊ'), ('ju', 'ju'),
        ('puә. pɒ:', 'pʊə'), ('kjuә', 'kjuə'), ('tuә', 'tʊə'),
        # 已 IPA（幂等）
        ('/vɑːst/', 'vɑːst'), ('/ˈlɑːdʒli/', 'ˈlɑːdʒli'), ('/biːtʃ/', 'biːtʃ'),
        ('/ʃɔː(r)/', 'ʃɔː(r)'), ('/ɪˈnɔːməs/', 'ɪˈnɔːməs'), ('/kəʊst/', 'kəʊst'),
        ('/waɪl/(=whilst)', 'waɪl'), ('/hu:/', 'huː'), ('/zu:m/', 'zuːm'),
        ("/ə'bændən/", 'əˈbændən'), ('/ˈdʒaɪənt/', 'ˈdʒaɪənt'),
        ("/ˌɪnˈlænd/ adv.向（或在）内陆；/ˈɪnlənd/ adj.内陆的", 'ˌɪnˈlænd'),
        ('/eɪ;ə;æn;ən/', 'eɪ'),
    ]
    ok = 0
    for raw, expect in tests:
        got = phonetic_to_ipa(raw)
        mark = 'OK ' if got == expect else 'XX '
        if got == expect: ok += 1
        print(f"{mark}{raw!r:46} -> {got!r:24} expect {expect!r}")
    print(f'\n{ok}/{len(tests)} matched')
