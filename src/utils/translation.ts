// 把翻译字符串渲染成带词性/领域标签的 HTML
// 单词本、收藏、错题本的卡片共用

export interface ParsedMeaning {
    part: string;
    definition: string;
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

function extractPos(line: string): { part: string; rest: string } | null {
    const m = line.match(/^([a-zA-Z]+\.)\s*(.*)$/);
    if (!m) return null;
    const tag = m[1].replace('.', '');
    // 非标准词性标记（如 na.）直接当作普通文本
    if (!VALID_POS_TAGS.has(tag.toLowerCase())) return null;
    return { part: m[1], rest: cleanTailBackslash(m[2]) };
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
export function parseMeanings(translation?: string, definition?: string): ParsedMeaning[] {
    const meanings: ParsedMeaning[] = [];
    if (!translation) return meanings;

    const transLines = normalizeNewlines(fixUnbalancedParentheses(translation)).split('\n').map(s => s.trim()).filter(Boolean);
    const defLines = normalizeNewlines(definition).split('\n').map(s => s.trim()).filter(Boolean);

    transLines.forEach((line, index) => {
        // 先把行内词性标签拆开，如 "废物vt. 废弃" -> ["废物", "vt. 废弃"]
        const segments = splitInlinePos(line);

        segments.forEach((segment, segIndex) => {
            const posMatch = extractPos(segment);
            if (posMatch) {
                meanings.push({ part: posMatch.part, definition: posMatch.rest });
                return;
            }

            // 非标准词性标记（如 na.）直接去掉前缀，当作无词性释义
            const nonStandardPosMatch = segment.match(/^([a-zA-Z]+\.)\s*(.*)$/);
            if (nonStandardPosMatch && !VALID_POS_TAGS.has(nonStandardPosMatch[1].replace('.', '').toLowerCase())) {
                meanings.push({ part: '', definition: cleanTailBackslash(nonStandardPosMatch[2]) });
                return;
            }

            // 中文行没词性，看英文释义同行；多段时只第一段使用英文词性兜底
            const defPosMatch = segIndex === 0 ? extractPos(defLines[index] || '') : null;
            meanings.push({
                part: defPosMatch ? defPosMatch.part : '词组',
                definition: cleanTailBackslash(segment)
            });
        });
    });

    if (meanings.length === 0 && translation) {
        meanings.push({ part: '词组', definition: translation });
    }

    return meanings;
}

export function buildTranslationHtml(translation?: string, phonetic?: string, definition?: string): string {
    let html = '';

    if (phonetic) {
        html += `<div class="def-phonetic" style="margin-bottom: 10px; color: var(--text-gray); font-size: 16px;">/${phonetic}/</div>`;
    }

    const meanings = parseMeanings(translation, definition);
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
                    return `<div class="part-of-speech" style="background:${color}20;color:${color}">[${m[1]}]</div>`;
                }
                return '';
            };

            // 领域标签可能在词性前面，也可能在词性后面
            tagHtml += extractDomain(text);

            if (meaning.part && meaning.part !== '词组') {
                tagHtml += `<div class="part-of-speech">${meaning.part}</div>`;
                // 词性后面还可能跟着领域标签，如 art. [计]
                tagHtml += extractDomain(text);
            }

            if (!tagHtml) {
                tagHtml += '<div class="part-of-speech">词组</div>';
            }

            html += '<div class="meaning-tag-row">' + tagHtml + '</div>';
            html += '<div class="definition">' + text + '</div>';
        });

        html += `</div>`;
    }

    return html;
}
