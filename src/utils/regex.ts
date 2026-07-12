/** 单词格式校验：仅允许字母、连字符、撇号、空格（短语） */
export const VALID_WORD = /^[A-Za-z][A-Za-z' -]{0,50}$/;

/** 非法字符过滤：移除控制字符和不可见字符（保留换行和空格） */
export const STRIP_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** 多余空白压缩：将连续空白（含全角空格）压缩为单个空格 */
export const COLLAPSE_WHITESPACE = /[\s\u3000]{2,}/g;

/** 行首行尾空白修剪 */
export const TRIM_LINE = /^\s+|\s+$/g;

/** 词条分割：匹配 "单词 | 释义" 格式，支持多分隔符（|、制表符、连续空格） */
export const ENTRY_SPLIT = /\s*[|\t]+\s*|\s{2,}/;

/** 提取行中第一个单词（用于导入时只取单词忽略释义） — 具名分组 */
export const EXTRACT_FIRST_WORD = /^(?<word>[A-Za-z][A-Za-z' -]*?)(?:\s+[|（\[].*)?$/;

/** 匹配纯英文行（用于过滤中文释义行，保留纯英文单词行） — 负向前瞻 */
export const ENGLISH_ONLY = /^(?![\u4e00-\u9fff])[A-Za-z][A-Za-z' -]*$/;

/** 检测是否包含中文 */
export const HAS_CHINESE = /[\u4e00-\u9fff]/;

/** 单词导入文本清洗链：移除控制字符 → 压缩空白 → 去除非法后缀字符 */
export const CLEAN_IMPORT_TEXT = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** 匹配单词末尾的序号（如 "1. hello" 中的 "1."） — 后行断言 */
export const LEADING_NUMBER = /^[\s]*(?<num>\d+[、.)]?)\s*/;

/** 匹配 HTML 标签（用于从富文本中提取纯文本单词） */
export const HTML_TAGS = /<[^>]+>/g;

/** 提取邮箱（用于用户反馈中的联系方式提取） */
export const EMAIL_PATTERN = /(?<email>[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
