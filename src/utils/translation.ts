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
    'n', 'v', 'adj', 'adv', 'vt', 'vi', 'prep', 'conj', 'pron', 'art', 'num', 'int', 'aux',
    'a', 's', 'r', 'c', 'u',
    'pl', 'sing', 'abbr'
]);

function cleanTailBackslash(text: string): string {
    return text.replace(/\\+\s*$/, '').trim();
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

// 把 translation 按行拆成 {词性, 释义}
// 如果某行中文释义没有词性，尝试从对应行的英文 definition 里补
export function parseMeanings(translation?: string, definition?: string): ParsedMeaning[] {
    const meanings: ParsedMeaning[] = [];
    if (!translation) return meanings;

    const transLines = normalizeNewlines(translation).split('\n').map(s => s.trim()).filter(Boolean);
    const defLines = normalizeNewlines(definition).split('\n').map(s => s.trim()).filter(Boolean);

    transLines.forEach((line, index) => {
        const posMatch = extractPos(line);
        if (posMatch) {
            meanings.push({ part: posMatch.part, definition: posMatch.rest });
            return;
        }

        // 非标准词性标记（如 na.）直接去掉前缀，当作无词性释义
        const nonStandardPosMatch = line.match(/^([a-zA-Z]+\.)\s*(.*)$/);
        if (nonStandardPosMatch && !VALID_POS_TAGS.has(nonStandardPosMatch[1].replace('.', '').toLowerCase())) {
            meanings.push({ part: '', definition: cleanTailBackslash(nonStandardPosMatch[2]) });
            return;
        }

        // 中文行没词性，看英文释义同行
        const defPosMatch = extractPos(defLines[index] || '');
        meanings.push({
            part: defPosMatch ? defPosMatch.part : '词组',
            definition: cleanTailBackslash(line)
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
