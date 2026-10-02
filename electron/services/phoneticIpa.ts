// ECDICT 重拼音标 / 半 IPA 音标 -> 标准 DJ 音标（IPA）转换器
// 由 tools/wordbook/scripts_phonetic_convert.py（参考实现 v3，57 项单测）1:1 移植。
// - 自动识别「重拼式」（拉丁元音 i/u/o + 西里尔 ә + ASCII 重音 '）与「已 IPA」；
// - 重拼式走完整元音重映射；已 IPA 走幂等轻量归一化（只修重音 / 长音符号 / 注释）；
// - 只保留第一个读音变体；脏数据（韦氏音标、中文说明、IPA: 原文）原样返回。

const LONG: Array<[string, string]> = [
    ['iә', 'ɪə'], ['eә', 'eə'], ['εә', 'eə'], ['ɛә', 'eə'], ['єә', 'eə'],
    ['әu', 'əʊ'], ['ou', 'əʊ'],
    ['ei', 'eɪ'], ['ai', 'aɪ'], ['ɔi', 'ɔɪ'], ['au', 'aʊ'],
    ['i:', 'iː'], ['ɑ:', 'ɑː'], ['ɒ:', 'ɔː'], ['ɔ:', 'ɔː'], ['u:', 'uː'],
    ['ә:', 'ɜː'], ['ə:', 'ɜː'], ['ɜ:', 'ɜː'], ['ɝ:', 'ɜː'],
];

const VOWEL_CHARS = new Set('әəaæeɛεiɒɔʌɑou'.split(''));

const STRESS_VARIANTS: Record<string, string> = {
    'ˊ': 'ˈ', '´': 'ˈ', '’': 'ˈ', '‘': 'ˈ', 'ʹ': 'ˈ',
};

const SINGLE_MAP: Record<string, string> = {
    'ә': 'ə', 'є': 'e', 'ɛ': 'e', 'ε': 'e',
    'ɒ': 'ɒ', 'ɔ': 'ɒ', 'ɑ': 'ɑː',
    'ɚ': 'ə', 'ɝ': 'ɜ', 'ɹ': 'r', 'ɵ': 'ə',
};

const DIRTY_CHARS = new Set('āēīōūăĕĭŏŭäëïöüÄËÏÖÜÂÊÎÔÛâêîôû'.split(''));

// 已是 IPA 的铁证：这些字符只可能出现在 IPA 中（重拼式用 i/u/ә: 代替）
const IPA_MARKER = /[ːɪʊɜə]/;

function convertRespelled(input: string): string {
    let s = input;
    for (const k of Object.keys(STRESS_VARIANTS)) {
        s = s.split(k).join(STRESS_VARIANTS[k]);
    }
    const placeholders: Record<string, string> = {};
    LONG.forEach(([src, dst], i) => {
        const ph = `\u0000${i}\u0000`;
        if (s.includes(src)) {
            s = s.split(src).join(ph);
            placeholders[ph] = dst;
        }
    });
    const out: string[] = [];
    let idx = 0;
    while (idx < s.length) {
        const ch = s[idx];
        const nxt = idx + 1 < s.length ? s[idx + 1] : '';
        const prev = idx > 0 ? s[idx - 1] : '';
        if (ch === 'u' && nxt === 'ә') {
            out.push(prev === 'j' ? 'uə' : 'ʊə');
            idx += 2;
            continue;
        }
        if (ch === 'u') {
            const afterVowel = nxt === '' ||
                VOWEL_CHARS.has(nxt) || nxt === '\u0000';
            out.push(prev === 'j' && afterVowel ? 'u' : 'ʊ');
        } else if (ch === 'i') {
            const rest = s.slice(idx + 1);
            const onlyPlaceholders = rest === '' ||
                rest.replace(/\u0000\d*\u0000/g, '') === '';
            out.push(onlyPlaceholders ? 'i' : 'ɪ');
        } else if (ch === 'o') {
            out.push('əʊ');
        } else if (ch === 'U') {
            out.push('ʌ');
        } else if (Object.prototype.hasOwnProperty.call(SINGLE_MAP, ch)) {
            out.push(SINGLE_MAP[ch]);
        } else if (ch === '^' || ch === '?' || ch === '\\' || ch === ':') {
            // 丢弃脏符号
        } else {
            out.push(ch);
        }
        idx += 1;
    }
    s = out.join('');
    for (const ph of Object.keys(placeholders)) {
        s = s.split(ph).join(placeholders[ph]);
    }
    return s.split("'").join('ˈ');
}

function normalizeIpa(input: string): string {
    let s = input;
    for (const k of Object.keys(STRESS_VARIANTS)) {
        s = s.split(k).join(STRESS_VARIANTS[k]);
    }
    const pairs: Array<[string, string]> = [
        ['i:', 'iː'], ['u:', 'uː'], ['ɑ:', 'ɑː'], ['ɒ:', 'ɔː'],
        ['ɔ:', 'ɔː'], ['ə:', 'ɜː'], ['ә:', 'ɜː'], ['ɜ:', 'ɜː'], ['e:', 'eː'],
    ];
    pairs.forEach(([src, dst]) => { s = s.split(src).join(dst); });
    s = s.split('ә').join('ə').split("'").join('ˈ');
    // 残留裸冒号（元音长音）统一为 ː
    s = s.replace(/(?<=[aeiouæɑɒɔəɜʌɪʊɛɝ])\s*:/g, 'ː');
    return s;
}

function firstPhoneticSegment(raw: string): string {
    let s = raw.trim();
    // 删除 (=xxx) 形式的等号注释
    s = s.replace(/\(\s*=[^)]*\)/g, '');
    // 配对斜杠：取第一个 /.../
    const m = /^\s*\/([^/]*)\/.*/.exec(s);
    if (m) {
        s = m[1].trim();
    } else {
        // 无斜杠：在首个中文 / 等号处截断
        s = s.split(/[\u4e00-\u9fff=]/)[0].trim();
    }
    // 统一只取第一个读音变体
    s = s.split(/\s*[;,；，]\s*|\s*\.\s+/)[0];
    return s.trim();
}

/**
 * 把任意来源的音标字符串标准化为 IPA。
 * 无法识别 / 脏数据原样返回（仅去除包裹斜杠），不做破坏性转换。
 */
export function phoneticToIpa(raw: string | null | undefined): string {
    if (!raw) return '';
    const original = raw.trim();
    // 数据自带标准 IPA（形如 "IPA: /.../" 或 "IPA: [...]"，常与韦氏音标并存）时优先提取
    const mIpa = /IPA\s*[:：]?\s*[/\[]([^/\]\[]+)[/\]]/.exec(original);
    if (mIpa) {
        const cand = mIpa[1].trim().replace(/ɹ/g, 'r');
        return normalizeIpa(cand).trim().replace(/^\/+|\/+$/g, '').trim();
    }
    let s = original;
    // 反斜杠 + 冒号乱码 = ɜː
    s = s.replace(/\\+\s*:/g, 'ɜː');

    let lead = '';
    const noLeadSlash = s.replace(/^\/+/, '');
    if (noLeadSlash.startsWith(',') || noLeadSlash.startsWith('.')) {
        lead = 'ˌ';
        if (!s.startsWith('/')) {
            s = noLeadSlash.slice(1);
        }
        // 以 / 开头时保持原样，交由配对斜杠逻辑提取
    }
    if (s && (s[0] === ',' || s[0] === '.')) {
        lead = 'ˌ';
        s = s.slice(1);
    }

    s = firstPhoneticSegment(s);
    if (!s) return '';

    // 脏数据原样返回
    let dirty = false;
    for (const ch of s) {
        if (DIRTY_CHARS.has(ch)) { dirty = true; break; }
    }
    if (dirty || original.includes('IPA')) {
        return s;
    }

    let converted = IPA_MARKER.test(s) ? normalizeIpa(s) : convertRespelled(s);
    if (lead && !converted.startsWith('ˈ')) {
        converted = lead + converted;
    }
    return converted.trim().replace(/^\/+|\/+$/g, '').trim();
}
