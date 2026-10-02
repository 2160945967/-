# -*- coding: utf-8 -*-
"""
构建模拟题-听力 结构化数据 (仅 CET-4, 100 套)。
源: resource/模拟题/CET4_Listening_Bank/Test_001..Test_100/
      questions_and_answers.md  (Section A/B/C, 25 题, 题干/选项/内联答案)
      transcript.md             (听力原文, 按 Section / 篇章分块)
输出: public/exams/listening/index.json            (轻量清单)
      public/exams/listening/tests/<id>.json       (每套题 + 原文, 懒加载)
音频 complete_test.wav 体积巨大(单套约 66MB), 不拷贝不打包,
由后端 /api/exam/listening-audio/:id 从 resource 流式发送(支持 Range)。
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = ROOT / "resource" / "模拟题" / "CET4_Listening_Bank"
OUT_DIR = ROOT / "public" / "exams" / "listening"
TEST_DIR = OUT_DIR / "tests"

SECTION_RE = re.compile(r"^##\s+Section\s+([ABC])\.\s*(.*?)\.?\s*$")
CLIP_RE = re.compile(r"^###\s+(.+?)\s*$")
STEM_RE = re.compile(r"^\*\*\s*(\d+)\.\s*(.*?)\*\*\s*$")
OPT_RE = re.compile(r"^-\s*([A-D])\)\s+(.*)$")
ANS_RE = re.compile(r"^-\s*\*\*Answer:\s*([A-D])\*\*")
SECTION_NAME = {
    "A": "新闻报道 News Reports",
    "B": "长对话 Long Conversations",
    "C": "短文理解 Passages",
}


def parse_questions(text):
    sections = []
    cur_section = None
    cur_clip = None
    cur_q = None
    stop = False

    def flush_q():
        nonlocal cur_q, cur_clip
        if cur_q is not None and cur_clip is not None:
            cur_clip["questions"].append(cur_q)
        cur_q = None

    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("## Answer Key"):
            stop = True
            flush_q()
            break
        ms = SECTION_RE.match(line)
        if ms:
            flush_q()
            cur_section = {"key": ms.group(1), "name": SECTION_NAME.get(ms.group(1), ms.group(2)),
                           "clips": []}
            sections.append(cur_section)
            cur_clip = None
            continue
        mc = CLIP_RE.match(line)
        if mc:
            flush_q()
            if cur_section is None:
                continue
            cur_clip = {"name": mc.group(1).strip(), "questions": []}
            cur_section["clips"].append(cur_clip)
            continue
        mst = STEM_RE.match(line)
        if mst:
            flush_q()
            cur_q = {"n": int(mst.group(1)), "s": mst.group(2).strip(),
                     "o": [], "a": ""}
            continue
        mo = OPT_RE.match(line)
        if mo and cur_q is not None:
            cur_q["o"].append(mo.group(2).strip())
            continue
        ma = ANS_RE.match(line)
        if ma and cur_q is not None:
            cur_q["a"] = ma.group(1)
            continue
    if not stop:
        flush_q()
    return sections


MD_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")

def strip_md(s):
    """去除 Markdown 粗体/残留星号（如 Directions 行的 **Directions:**）。"""
    s = MD_BOLD_RE.sub(r"\1", s)
    s = s.replace("**", "").strip()
    return s


def parse_transcript(text):
    """按 ### 标题切块, 返回 [{heading, paras:[...]}]"""
    blocks = []
    cur = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("#"):
            m = re.match(r"^###\s+(.+?)\s*$", line)
            if m:
                cur = {"heading": strip_md(m.group(1)), "paras": []}
                blocks.append(cur)
            # # / ## 级标题忽略
            continue
        if not cur:
            continue
        s = strip_md(line)
        if not s or s == "---":
            continue
        cur["paras"].append(s)
    return blocks


def main():
    TEST_DIR.mkdir(parents=True, exist_ok=True)
    test_dirs = sorted([d for d in SRC_DIR.iterdir()
                        if d.is_dir() and re.match(r"^Test_\d+$", d.name)])
    index_tests = []
    problems = []

    for d in test_dirs:
        tid = d.name
        qf = d / "questions_and_answers.md"
        tf = d / "transcript.md"
        wav = d / "complete_test.wav"
        if not qf.exists():
            problems.append(f"{tid}: 缺 questions_and_answers.md")
            continue
        qtext = qf.read_text(encoding="utf-")
        sections = parse_questions(qtext)
        total_q = sum(len(c["questions"]) for sec in sections for c in sec["clips"])
        if total_q != 25:
            problems.append(f"{tid}: 题数 {total_q} != 25")
        for sec in sections:
            for clip in sec["clips"]:
                for q in clip["questions"]:
                    if len(q["o"]) != 4 or not q["a"]:
                        problems.append(f"{tid} 题{q['n']}: 选项/答案不完整")

        transcript = []
        if tf.exists():
            transcript = parse_transcript(tf.read_text(encoding="utf-8"))
        else:
            problems.append(f"{tid}: 缺 transcript.md")

        title = f"CET-4 听力模拟 {tid.split('_')[1]} 套"
        payload = {
            "id": tid,
            "title": title,
            "audio": f"/api/exam/listening-audio/{tid}",
            "sections": sections,
            "transcript": transcript,
            "hasWav": wav.exists(),
        }
        (TEST_DIR / f"{tid}.json").write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8")
        index_tests.append({"id": tid, "title": title, "hasWav": wav.exists()})

    index = {"type": "listening", "label": "CET-4 听力理解（100 套）",
             "count": len(index_tests), "tests": index_tests}
    (OUT_DIR / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"听力套数: {len(index_tests)}")
    print(f"含音频: {sum(1 for t in index_tests if t['hasWav'])} / {len(index_tests)}")
    print(f"校验异常: {len(problems)}")
    for p in problems[:30]:
        print("  ", p)
    if index_tests:
        s = json.loads((TEST_DIR / f"{index_tests[0]['id']}.json").read_text(encoding="utf-8"))
        print("\n[样例]", s["title"])
        for sec in s["sections"]:
            n = sum(len(c["questions"]) for c in sec["clips"])
            print(f"  Section {sec['key']} {sec['name']}: {len(sec['clips'])}篇 {n}题")
        print("  原文块数:", len(s["transcript"]),
              "| 首块:", s["transcript"][0]["heading"] if s["transcript"] else "-")
        q1 = s["sections"][0]["clips"][0]["questions"][0]
        print("  题1:", q1["s"][:50], "| 选项:", len(q1["o"]), "| 答案:", q1["a"])


if __name__ == "__main__":
    main()
