// 把翻译字符串渲染成带词性/领域标签的 HTML
// 单词本、收藏、错题本的卡片共用

export interface ParsedMeaning {
    part: string;
    definition: string;
}

export interface ParseMeaningOptions {
    // ECDICT 词性字段，如 "adj"、"n/v"
    pos?: string;
    // 词头文本，用于在没有任何词性信息时区分词组（含空格）与单个单词
    word?: string;
}

// ECDICT pos 字段拆成标签数组："adj" -> ["adj."]，"v n adj" -> ["v.","n.","adj."]
function parsePosField(pos?: string): string[] {
    if (!pos) return [];
    return pos.split(/[/;；、,\s]+/).filter(Boolean).map((raw) => {
        const t = raw.trim().toLowerCase().replace(/\.+$/, '');
        return t ? `${t}.` : '';
    }).filter(Boolean);
}

function defaultPartForHeadword(word?: string): string {
    // 含空格的词头视为词组/短语；单个单词无词性时不贴标签（此前一律贴“词组”是误标）
    if (word && /\s/.test(word.trim())) return '词组';
    return '';
}

// 解析不出词性时的兜底标签：
// pos 字段只有唯一词性时才贴（多词性无法判断该义项属于哪个，贴一串会误导）；
// 其余情况按词头是否含空格判断是否为“词组”，单个单词不贴标签
export function fallbackPart(pos?: string, word?: string): string {
    const labels = parsePosField(pos);
    if (labels.length === 1) return labels[0];
    return defaultPartForHeadword(word);
}

const DOMAIN_COLORS: Record<string, string> = {
    '医': '#e74c3c', '经': '#f39c12', '法': '#3498db',
    '计': '#2ecc71', '心': '#9b59b6', '生': '#1abc9c',
    '化': '#e67e22', '物': '#27ae60', '地': '#34495e',
    '科': '#7f8c8d', '电': '#2980b9', '机': '#16a085'
};

export function normalizeNewlines(text?: string): string {
    if (!text) return '';
    return text
        // 先处理双反斜杠的转义序列（数据库里偶尔会出现 \\n）
        .replace(/\\\\r\\\\n/g, '\n')
        .replace(/\\\\n/g, '\n')
        .replace(/\\\\r/g, '\n')
        // 再处理单反斜杠的转义序列
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\n')
        // 最后处理真实换行符
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
}

// 常见词性标签；非标准标记（如 na.）不识别为词性
const VALID_POS_TAGS = new Set([
    'n', 'v', 'adj', 'adv', 'vt', 'vi', 'prep', 'conj', 'pron', 'art', 'num', 'int', 'interj', 'aux',
    'a', 's', 'r', 'c', 'u',
    'pl', 'sing', 'abbr',
    'ad', 'vbl', 'verb', 'auxv', 'linkv', 'modalv', 'det', 'quant', 'ordnumber',
    'pref', 'suf', 'suff', 'comb', 'phr', 'pn', 'pp', 'exclam'
]);

function cleanTailBackslash(text: string): string {
    return text.replace(/\\+\s*$/, '').trim();
}

// 修复部分词典数据里缺失半个括号的情况，如 "使)循环" -> "(使)循环"
// 也处理 "沸腾炉)床上方燃烧器" -> "(沸腾炉)床上方燃烧器"
function fixUnbalancedParentheses(text: string): string {
    const fixSide = (s: string, openCh: string, closeCh: string): string => {
        // 对正则元字符进行转义，避免 closeCh 为 )/） 等时构造失败
        const escapedClose = closeCh.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedOpen = openCh.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(?<![${openCh}])([\\u4e00-\\u9fa5]+)(${escapedClose})`, 'g');
        const result = Array.from(s);
        const matches: Array<{ start: number; end: number }> = [];
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(s)) !== null) {
            matches.push({ start: m.index, end: m.index + m[0].length });
        }
        for (const match of matches.reverse()) {
            const before = result.slice(0, match.end).join('');
            const openCount = (before.match(new RegExp(escapedOpen, 'g')) || []).length;
            const closeCount = (before.match(new RegExp(escapedClose, 'g')) || []).length;
            if (closeCount > openCount) {
                result.splice(match.start, 0, openCh);
            }
        }
        return result.join('');
    };

    text = fixSide(text, '(', ')');
    text = fixSide(text, '（', '）');
    return text;
}

// 把释义文本转成可安全插入 HTML 的字符串（不转换换行，换行由调用方决定）
function escapeHtmlText(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 把释义文本转成可安全插入 HTML 的字符串，\n 等换行渲染为 <br>
export function formatDefinitionHtml(text?: string): string {
    if (!text) return '';
    return normalizeNewlines(text)
        .replace(/\\+\s*$/, '')
        .trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

// 释义文本清洗：删除 PUA/控制字符残留，去掉尾部空词性标签和外语乱码
// （后端查询时也会清洗，这里防御用户导入与离线缓存等未经过后端的数据）
function sanitizeGloss(text: string): string {
    let t = text.replace(/[\uE000-\uF8FF\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    // 尾部空词性标签碎片，如 "…收受；/n."、"…/v.@"
    t = t.replace(/[\s；;，,、/]*[a-zA-Z]{1,8}\.\s*[^\u4e00-\u9fffa-zA-Z0-9]*$/, '');
    // 尾部外语乱码（阿拉伯/希伯来/韩文/泰文/天城文等），可能挂着 "/v." 或单个拉丁字母
    t = t.replace(
        /[\s；;，,、/]*[a-zA-Z]{0,8}[\u02B0-\u02FF]?\.?[\x00-\x1F\x7F-\x9F]*[\u0590-\u06FF\u0750-\u077F\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\u0900-\u097F\u0E00-\u0E7F][\s\S]{0,12}$/,
        ''
    );
    return t.replace(/[\s；;，,、/\\]+$/, '').trim();
}

// 释义是否含有效内容（中文/英文/数字）
function hasGlossContent(text: string): boolean {
    return /[\u4e00-\u9fffa-zA-Z0-9]/.test(text);
}

// 同一词性下重复释义保序去重（源数据常把同一释义重复聚合十几遍）
function dedupeGlosses(text: string): string {
    const tokens = text.split(/[；;，,、]/).map(s => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    return tokens.filter((t) => {
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
    }).join('；');
}

function extractPos(line: string): { part: string; rest: string } | null {
    const m = line.match(/^([a-zA-Z]+\.)\s*(.*)$/);
    if (!m) return null;
    const tag = m[1].replace('.', '');
    // 非标准词性标记（如 na.）直接当作普通文本
    if (!VALID_POS_TAGS.has(tag.toLowerCase())) return null;
    return { part: m[1], rest: cleanTailBackslash(m[2]) };
}

// 中文合并为一行、英文有多行不同词性时，统计英文各词性义项数，取占多数的主要词性
// （abandon 英文 1 个 n.、3 个 v.，中文字面又全是动词义 -> 归 v.，避免误标 n.）
function dominantDefPart(defLines: string[]): string | null {
    const counts = new Map<string, number>();
    defLines.forEach((l) => {
        const m = extractPos(l);
        if (m) counts.set(m.part, (counts.get(m.part) || 0) + 1);
    });
    if (counts.size === 0) return null;
    let best: string | null = null;
    let bestN = -1;
    counts.forEach((n, p) => { if (n > bestN) { bestN = n; best = p; } });
    return best;
}

// 把一行中文释义按行内词性标签拆成多行，例如 "废物vt. 废弃" -> ["废物", "vt. 废弃"]
// 也处理 & / 、 , 连接多个词性的情况，如 "a. & n. xxx" -> ["a.", "n. xxx"]
function splitInlinePos(line: string): string[] {
    const parts: string[] = [];
    let lastIndex = 0;
    // 匹配出现在非字母/空白后的词性标签，或在 & / 、 , 等连接符后的词性标签
    const regex = /([^a-zA-Z\s]|(?:&|\/|、|,))(\s*)([a-zA-Z]+\.)\s*/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
        const tag = match[3].replace('.', '');
        if (!VALID_POS_TAGS.has(tag.toLowerCase())) continue;

        const connector = match[1];
        if (/[&\\/、,]/.test(connector)) {
            // 连接符后的词性标签属于新义项，上一段到连接符前
            parts.push(line.slice(lastIndex, match.index).trim());
            lastIndex = match.index + connector.length + match[2].length;
        } else {
            // 普通内联标签：前置字符仍保留在上一段，新义项从词性标签开始
            parts.push(line.slice(lastIndex, match.index + connector.length).trim());
            lastIndex = match.index + connector.length + match[2].length;
        }
    }
    parts.push(line.slice(lastIndex).trim());
    return parts.filter(Boolean);
}

// 把 translation 按行拆成 {词性, 释义}
// 如果某行中文释义没有词性，尝试从对应行的英文 definition 里补
export function parseMeanings(translation?: string, definition?: string, options: ParseMeaningOptions = {}): ParsedMeaning[] {
    const meanings: ParsedMeaning[] = [];
    if (!translation) return meanings;

    const headwordFallback = fallbackPart(options.pos, options.word);

    const transLines = normalizeNewlines(fixUnbalancedParentheses(translation)).split('\n').map(s => s.trim()).filter(Boolean);
    const defLines = normalizeNewlines(definition).split('\n').map(s => s.trim()).filter(Boolean);

    transLines.forEach((line, index) => {
        // 先把行内词性标签拆开，如 "废物vt. 废弃" -> ["废物", "vt. 废弃"]
        const segments = splitInlinePos(line);

        segments.forEach((segment, segIndex) => {
            const posMatch = extractPos(segment);
            if (posMatch) {
                const rest = sanitizeGloss(posMatch.rest);
                // 标签后没有任何有效释义（如尾部 "/v.ؓؓ춡" 拆出的空 v. 段）直接丢弃
                if (hasGlossContent(rest)) {
                    meanings.push({ part: posMatch.part, definition: dedupeGlosses(rest) });
                }
                return;
            }

            // 非标准词性标记（如 na.）直接去掉前缀，当作无词性释义
            const nonStandardPosMatch = segment.match(/^([a-zA-Z]+\.)\s*(.*)$/);
            if (nonStandardPosMatch && !VALID_POS_TAGS.has(nonStandardPosMatch[1].replace('.', '').toLowerCase())) {
                const rest = sanitizeGloss(cleanTailBackslash(nonStandardPosMatch[2]));
                if (hasGlossContent(rest)) meanings.push({ part: '', definition: dedupeGlosses(rest) });
                return;
            }

            // 中文行没词性：中英逐行对应时取英文同行词性；中文合并成一行而英文多词性时取英文主要词性
            let inferredPart: string | null = null;
            if (segIndex === 0) {
                if (transLines.length === defLines.length) {
                    inferredPart = extractPos(defLines[index] || '')?.part || null;
                } else if (transLines.length === 1 && defLines.length > 1) {
                    inferredPart = dominantDefPart(defLines);
                } else {
                    inferredPart = extractPos(defLines[index] || '')?.part || null;
                }
            }
            const cleanedSegment = sanitizeGloss(cleanTailBackslash(segment));
            if (hasGlossContent(cleanedSegment)) {
                meanings.push({
                    part: inferredPart || headwordFallback,
                    definition: dedupeGlosses(cleanedSegment)
                });
            }
        });
    });

    if (meanings.length === 0 && translation) {
        meanings.push({ part: headwordFallback, definition: translation });
    }

    return meanings;
}

export function buildTranslationHtml(translation?: string, phonetic?: string, definition?: string, options: ParseMeaningOptions = {}): string {
    let html = '';

    if (phonetic) {
        // 去掉数据源自带的首尾斜杠，再统一包裹，避免出现 //xxx//
        const ph = phonetic.replace(/^\/+|\/+$/g, '');
        html += `<div class="def-phonetic" style="margin-bottom: 10px; color: var(--text-gray); font-size: 16px;">/${escapeHtmlText(ph)}/</div>`;
    }

    const meanings = parseMeanings(translation, definition, options);
    if (meanings.length > 0) {
        html += `<div style="margin-bottom: 10px;">`;

        meanings.forEach((meaning) => {
            let tagHtml = '';
            let text = meaning.definition;

            // 提取领域标签 [经] [医] 等
            const extractDomain = (src: string): string => {
                const m = src.match(/^\[([^\]]+)\]\s*(.*)$/);
                if (m) {
                    const color = DOMAIN_COLORS[m[1]] || '#3498db';
                    text = m[2];
                    return `<div class="part-of-speech" style="background:${color}20;color:${color}">[${escapeHtmlText(m[1])}]</div>`;
                }
                return '';
            };

            // 领域标签可能在词性前面，也可能在词性后面
            tagHtml += extractDomain(text);

            if (meaning.part && meaning.part !== '词组') {
                tagHtml += `<div class="part-of-speech">${escapeHtmlText(meaning.part)}</div>`;
                // 词性后面还可能跟着领域标签，如 art. [计]
                tagHtml += extractDomain(text);
            }

            // 仅当解析器判定为词组时贴“词组”；单个单词无词性时不输出标签行
            if (!tagHtml && meaning.part === '词组') {
                tagHtml += '<div class="part-of-speech">词组</div>';
            }

            if (tagHtml) {
                html += '<div class="meaning-tag-row">' + tagHtml + '</div>';
            }
            html += '<div class="definition">' + escapeHtmlText(text) + '</div>';
        });

        html += `</div>`;
    }

    return html;
}
