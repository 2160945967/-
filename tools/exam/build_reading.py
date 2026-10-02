# -*- coding: utf-8 -*-
"""
构建模拟题-阅读 结构化数据。
源: resource/模拟题/CET46_Complete.md  (399 篇, 连续编号 ## 文章 N.)
难度分界(用户拍板 + 长度统计支持):
    文章 1-199   -> CET-4
    文章 200-399 -> CET-6
输出: public/exams/reading/cet4.json, cet6.json
每篇: 英文正文 / 5 题(题干+ABCD) / 答案字母+中文解析 / 中文文章翻译 / 中文题目翻译
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "resource" / "模拟题" / "CET46_Complete.md"
OUT_DIR = ROOT / "public" / "exams" / "reading"

OPT_RE = re.compile(r"^\s*([A-D])\)\s+(.*)$")
QHEAD_RE = re.compile(r"^\s*(\d+)\.\s+(.*)$")
ANS_RE = re.compile(r"^\s*(\d+)\.\s+([A-D])\s*[-–—]\s*(.*)$")
ART_RE = re.compile(r"^##\s*文章\s*(\d+)\.\s*(.*)$", re.MULTILINE)
ZH_TITLE_RE = re.compile(r"^\s*\*\*文章\s*\d+[.．]\s*(.*?)\*\*\s*$")


# ---------- 正文内嵌注释清洗 / 手工翻译补丁 ----------
# 四级核心词表（《英语四级你还在背单词吗》）：判断哪些 “word(中文)” 内嵌注释应删除
_WB_INDEX = ROOT / "public" / "wordbooks" / "cet4-beidanci" / "index.json"
CET4_WORDS = set()
if _WB_INDEX.exists():
    _idx = json.loads(_WB_INDEX.read_text(encoding="utf-8"))
    for _ws in _idx.values():
        CET4_WORDS.update(w.strip().lower() for w in _ws if w.strip())

# WordNet 风格词干库（与后端 LemmaDB 同口径）：屈折形 -> 词干
LEMMA = {}
_LEMMA_FILE = ROOT / "resource" / "lemma.en.txt"
if _LEMMA_FILE.exists():
    for _line in _LEMMA_FILE.read_text(encoding="utf-8").splitlines():
        _s = _line.strip()
        if not _s or _s.startswith(";") or "->" not in _s:
            continue
        _lp, _ip = _s.split("->", 1)
        _stem = _lp.split("/")[0].strip().lower()
        for _w in [w.split("/")[0].strip().lower() for w in _ip.split(",") if w.strip()]:
            LEMMA[_w] = _stem
        LEMMA[_stem] = _stem

# 功能词即使出现在词表中也不据此删注释（避免正则边界误抓冠词/介词等）
STOPWORDS = {
    "a", "an", "the", "of", "to", "in", "on", "with", "for", "and", "or", "but",
    "is", "are", "was", "were", "be", "been", "being", "by", "as", "at", "it",
    "its", "this", "that", "these", "those", "from", "into", "onto", "about",
    "than", "then", "so", "if", "when", "where", "which", "who", "whom", "how",
    "not", "no", "can", "could", "will", "would", "may", "might", "must", "should",
}

# 紧贴英文单词之后、括号内含汉字的注释：infrastructure（基础设施） / abandon(抛弃)
# 要求括号内含汉字，天然跳过 transistors（CNTFETs）这类英文缩写括号
INLINE_GLOSS_RE = re.compile(r"([A-Za-z][A-Za-z'’\-]*)\s*[（(]\s*([^）)]*[\u4e00-\u9fff][^）)]*?)\s*[）)]")
CLEAN_STATS = {"removed": 0, "kept": 0}


def _is_cet4(word):
    wl = word.lower()
    if wl in STOPWORDS:
        return False
    stem = LEMMA.get(wl, wl)
    return stem in CET4_WORDS or wl in CET4_WORDS


def clean_inline_gloss(text):
    """删除英文正文中四级核心词的 (中文释义) 内嵌注释；超纲词/专业术语注释保留。"""
    def _sub(m):
        if _is_cet4(m.group(1)):
            CLEAN_STATS["removed"] += 1
            # 注释括号原本起到了分隔作用，若其后紧跟英文字母（如 compounds（化合物）that），
            # 删除括号后需补一个空格，避免两侧单词粘连成 compoundsthat
            nxt = text[m.end()] if m.end() < len(text) else ""
            tail = " " if (len(nxt) == 1 and nxt.isascii() and nxt.isalpha()) else ""
            return m.group(1) + tail
        CLEAN_STATS["kept"] += 1
        return m.group(0)
    return INLINE_GLOSS_RE.sub(_sub, text)


# 手工补译（源 md 缺中文翻译的篇目）：{"篇号": {"zt": 中标题, "zp": [中段...]}}
_MANUAL_ZH_FILE = Path(__file__).resolve().parent / "manual_zh.json"
MANUAL_ZH = json.loads(_MANUAL_ZH_FILE.read_text(encoding="utf-8")) if _MANUAL_ZH_FILE.exists() else {}


def split_blocks(text):
    return [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]


def parse_questions(block):
    """解析 Questions 区 / 题目翻译区: 返回 {题号: {stem, options:{A..}}}"""
    result = {}
    cur = None
    for raw in block.splitlines():
        line = raw.rstrip()
        mo = OPT_RE.match(line)
        if mo and cur is not None:
            result[cur]["options"][mo.group(1)] = mo.group(2).strip()
            continue
        mh = QHEAD_RE.match(line)
        # 选项行已在上面处理; 此处题干行形如 "1. xxx"
        if mh:
            n = int(mh.group(1))
            if 1 <= n <= 5:
                cur = n
                result.setdefault(n, {"stem": mh.group(2).strip(), "options": {}})
                continue
        # 题干跨行续接
        if cur is not None and line.strip() and not OPT_RE.match(line):
            result[cur]["stem"] = (result[cur]["stem"] + " " + line.strip()).strip()
    return result


def parse_answers(block):
    answers = {}
    for line in block.splitlines():
        m = ANS_RE.match(line)
        if m:
            answers[int(m.group(1))] = {"a": m.group(2), "e": m.group(3).strip()}
    return answers


def parse_article(num, title, body):
    # 英文区 / 翻译区
    zh_split = re.split(r"^###\s*翻译\s*$", body, maxsplit=1, flags=re.MULTILINE)
    en_part = zh_split[0]
    zh_part = zh_split[1] if len(zh_split) > 1 else ""

    # 英文区切出 正文 / Questions / Answers
    q_split = re.split(r"^\*\*Questions:\*\*\s*$", en_part, maxsplit=1, flags=re.MULTILINE)
    head = q_split[0]
    rest = q_split[1] if len(q_split) > 1 else ""
    a_split = re.split(r"^\*\*Answers:\*\*\s*$", rest, maxsplit=1, flags=re.MULTILINE)
    questions_block = a_split[0]
    answers_block = a_split[1] if len(a_split) > 1 else ""

    # 正文段落: 去掉篇头标题行
    head_lines = head.splitlines()
    if head_lines and ART_RE.match(head_lines[0]):
        head_lines = head_lines[1:]
    paras = [clean_inline_gloss(p.replace("\n", " ").strip())
             for p in split_blocks("\n".join(head_lines))]

    q_en = parse_questions(questions_block)
    ans = parse_answers(answers_block)

    # ---- 翻译区 ----
    zh_title = ""
    zh_paras = []
    q_zh = {}
    if zh_part:
        zt = re.split(r"^\*\*题目翻译[:：]\*\*\s*$", zh_part, maxsplit=1, flags=re.MULTILINE)
        article_zh = zt[0]
        qtrans_block = zt[1] if len(zt) > 1 else ""
        # 中标题 + 中文正文
        zh_lines = article_zh.splitlines()
        body_start = 0
        for idx, ln in enumerate(zh_lines):
            mt = ZH_TITLE_RE.match(ln)
            if mt:
                zh_title = mt.group(1).strip()
                body_start = idx + 1
                break
        zh_paras = [p.replace("\n", " ").strip()
                    for p in split_blocks("\n".join(zh_lines[body_start:]))]
        if qtrans_block.strip():
            q_zh = parse_questions(qtrans_block)

    questions = []
    for n in range(1, 6):
        en = q_en.get(n, {"stem": "", "options": {}})
        meta = ans.get(n, {"a": "", "e": ""})
        zh = q_zh.get(n, {"stem": "", "options": {}})
        questions.append({
            "n": n,
            "s": en["stem"],
            "o": [en["options"].get(k, "") for k in ("A", "B", "C", "D")],
            "a": meta["a"],
            "e": meta["e"],
            "zs": zh.get("stem", ""),
            "zo": [zh.get("options", {}).get(k, "") for k in ("A", "B", "C", "D")],
        })

    return {
        "n": num,
        "t": title.strip(),
        "p": paras,
        "q": questions,
        "zt": zh_title,
        "zp": zh_paras,
    }


def main():
    text = SRC.read_text(encoding="utf-8")
    # 切篇
    matches = list(ART_RE.finditer(text))
    articles = []
    problems = []
    for idx, m in enumerate(matches):
        num = int(m.group(1))
        start = m.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        body = text[start:end]
        art = parse_article(num, m.group(2), body)
        _mz = MANUAL_ZH.get(str(num))
        if _mz:
            if _mz.get("zt"):
                art["zt"] = _mz["zt"]
            if _mz.get("zp"):
                art["zp"] = list(_mz["zp"])
        articles.append((num, art))
        # 校验
        if len(art["p"]) == 0:
            problems.append(f"文章{num}: 无英文正文")
        if not art["zt"] or not art["zp"]:
            problems.append(f"文章{num}: 缺中文翻译")
        for q in art["q"]:
            if not q["s"] or any(not x for x in q["o"]) or not q["a"]:
                problems.append(f"文章{num} 题{q['n']}: 题干/选项/答案不完整")

    articles.sort(key=lambda x: x[0])
    cet4 = [a for n, a in articles if n <= 199]
    cet6 = [a for n, a in articles if n >= 200]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload4 = {"level": "cet4", "label": "CET-4 阅读理解", "count": len(cet4),
                "articles": cet4}
    payload6 = {"level": "cet6", "label": "CET-6 阅读理解", "count": len(cet6),
                "articles": cet6}
    (OUT_DIR / "cet4.json").write_text(
        json.dumps(payload4, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT_DIR / "cet6.json").write_text(
        json.dumps(payload6, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"总篇数: {len(articles)}  CET4: {len(cet4)}  CET6: {len(cet6)}")
    print(f"问题数: {sum(len(a['q']) for _,a in articles)} (期望 {len(articles)*5})")
    print(f"正文内嵌注释清洗: 删除四级词注释 {CLEAN_STATS['removed']} 处，保留超纲注释 {CLEAN_STATS['kept']} 处")
    print(f"校验异常: {len(problems)}")
    for p in problems[:30]:
        print("  ", p)
    # 抽样
    s = cet4[0]
    print("\n[样例 CET4 文章1]", s["t"])
    print("正文段数:", len(s["p"]), "| 中文段数:", len(s["zp"]), "| 中标题:", s["zt"])
    print("题1:", s["q"][0]["s"][:60], "| 答案:", s["q"][0]["a"], "| 解析:", s["q"][0]["e"][:30])
    print("题1中译:", s["q"][0]["zs"][:40])
    s6 = cet6[0]
    print("\n[样例 CET6 文章200]", s6["t"], "| 正文段数:", len(s6["p"]))


if __name__ == "__main__":
    main()
