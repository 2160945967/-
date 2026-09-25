# -*- coding: utf-8 -*-
"""
拾词 · 有道发音批量下载器（独立运行，零第三方依赖，仅用 Python 标准库）

数据来源（自动收集、合并、去重）：
  1) resource/stardict.db            主词典（约 328 万词条）
  2) public/.../cet4-beidanci        《英语四级你还在背单词吗》主词 + 派生词
  阅读/听力模拟题的“核心词”就是 cet4 词表，不另产生新词。

功能：
  - 多线程下载，可配并发数
  - 每个请求带间隔（随机抖动），降低被限流概率
  - 断点续传：启动时一次性扫描输出目录建立内存索引，已存在音频秒跳过（不依赖状态文件）
  - 自动去重：词集合去重；同一词同一口音只下一次
  - 失败自动重试（指数退避）；连续网络错误/限流时全局冷却
  - 音频有效性校验（拒绝有道返回的 JSON 错误与过短数据）+ 临时文件原子落盘
  - 实时进度、速率、预计剩余时间；Ctrl+C 可随时安全退出
  - 失败清单写入 failed.txt，可用 --retry-failed 只重下失败项

用法示例（--accent 默认 both，英美音各下一份）：
  python tools/download_pronunciations.py                         # common 范围，英美音都下
  python tools/download_pronunciations.py --scope common --accent us
  python tools/download_pronunciations.py --scope cet4            # 仅四级词书，英美音
  python tools/download_pronunciations.py --accent uk             # 只补下英音
  python tools/download_pronunciations.py --retry-failed
"""

import argparse
import json
import os
import random
import sqlite3
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib import request as urlreq
from urllib import error as urlerr

sys.stdout.reconfigure(encoding="utf-8")

# tools/ 的上一级即项目根
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB = os.path.join(ROOT, "resource", "stardict.db")
WB_DIR = os.path.join(ROOT, "public", "wordbooks", "cet4-beidanci")
DEFAULT_OUT = os.path.join(ROOT, "pronunciations")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

# Unicode 上/下标数字（用于把 cet4 词书里的 bow¹ / bow² 还原成 bow）
_SUPER = "".join(chr(c) for c in (list(range(0x2070, 0x207A)) + [0x00B9, 0x00B2, 0x00B3]))
_SUP_TABLE = str.maketrans("", "", _SUPER)


def has_cn(s: str) -> bool:
    return any("一" <= c <= "鿿" for c in s)


def clean_word(w: str) -> str:
    return w.strip().translate(_SUP_TABLE).strip()


def normalize_filename(word: str) -> str:
    """严格复刻 electron/utils/helpers.ts 的 normalizeWordForFilename。"""
    out = word
    for ch in "\\/:*?<>|":
        out = out.replace(ch, "_")
    out = out.replace("&", "_and_")
    return out


def audio_filename(word: str, accent: str) -> str:
    return "%s_%s.mp3" % (normalize_filename(word), accent)


# ==================== 收集词 ====================

def load_cet4_words() -> set:
    lessons = ["U%dL%d" % (u, l) for u in range(1, 13) for l in range(1, 4 + 1)]
    with open(os.path.join(WB_DIR, "index.json"), encoding="utf-8") as f:
        idx = json.load(f)
    with open(os.path.join(WB_DIR, "der.json"), encoding="utf-8") as f:
        der = json.load(f)
    words = set()
    for L in lessons:
        words.update(idx.get(L, []))
        words.update(der.get(L, []))
    out = set()
    for w in words:
        c = clean_word(w)
        if c and not has_cn(c):
            out.add(c)
    return out


def collect_words(scope: str, db_path: str) -> set:
    cet = load_cet4_words()
    if scope == "cet4":
        return cet

    if not os.path.exists(db_path):
        print("[警告] 找不到词典数据库 %s，仅使用 cet4 词书。" % db_path)
        return cet

    con = sqlite3.connect(db_path)
    cur = con.cursor()
    if scope == "exam":
        sql = "SELECT word FROM stardict WHERE COALESCE(tag,'')<>''"
    elif scope == "common":
        sql = ("SELECT word FROM stardict WHERE COALESCE(tag,'')<>'' "
               "OR COALESCE(collins,0)>0 OR (frq IS NOT NULL AND frq>0)")
    elif scope == "all":
        sql = "SELECT word FROM stardict"
    else:
        con.close()
        raise ValueError("unknown scope: %s" % scope)
    rows = cur.execute(sql).fetchall()
    con.close()

    sd = set()
    for (w,) in rows:
        c = clean_word(w or "")
        if c and not has_cn(c):
            sd.add(c)
    return sd | cet


# ==================== 音频校验 / 落盘 ====================

def is_valid_mp3(data: bytes) -> bool:
    if not data or len(data) <= 100:
        return False
    if data[0] == 0x7B:  # '{' 有道返回的 JSON 错误
        return False
    if data[:3] == b"ID3":
        return True
    if data[0] == 0xFF and (data[1] & 0xE0) == 0xE0:  # MP3 帧同步
        return True
    return False


def atomic_write(fp: str, data: bytes) -> None:
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    tmp = "%s.tmp.%d" % (fp, threading.get_ident())
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, fp)


# ==================== 下载 ====================

class Downloader:
    def __init__(self, args):
        self.args = args
        self.out = args.out
        os.makedirs(self.out, exist_ok=True)
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.pause_until = 0.0
        self.consecutive_err = 0
        self.cursor = 0
        self.done = self.ok = self.skip = self.fail = 0
        self.failed = []
        # 一次性扫描输出目录，建立「完整文件名」索引；之后跳过判断全部走内存集合，
        # 不再对每个任务发起 getsize/open 磁盘调用（几万文件逐个 stat 在 Windows 上很慢）
        self.existing = self.scan_existing()

    def scan_existing(self) -> set:
        """扫描输出目录，返回所有「已存在且体积有效」的完整 mp3 文件名集合。

        只以完整文件名（{word}_{accent}.mp3）为键，不做任何前缀/模糊匹配；
        体积阈值 >100 字节与 is_valid_mp3 的长度校验一致。音频头校验只用于
        新下载内容（is_valid_mp3）——落盘文件均经校验后原子写入，半截文件只会
        以 .tmp.<线程id> 残留，不会进入本集合。
        """
        names = set()
        try:
            with os.scandir(self.out) as it:
                for entry in it:
                    if not entry.name.endswith(".mp3"):
                        continue
                    try:
                        # follow_symlinks=False 时 Windows 直接复用目录枚举的缓存元数据，
                        # 不打开文件、不触发杀毒扫描；输出目录中本就没有符号链接
                        if entry.is_file(follow_symlinks=False) and \
                                entry.stat(follow_symlinks=False).st_size > 100:
                            names.add(entry.name)
                    except OSError:
                        continue
        except FileNotFoundError:
            pass
        return names

    def fetch(self, word: str, accent: str) -> bytes:
        ytype = 0 if accent == "us" else 1
        url = "https://dict.youdao.com/dictvoice?type=%d&audio=%s" % (
            ytype, urlreq.quote(word))
        req = urlreq.Request(url, headers={"User-Agent": UA})
        with urlreq.urlopen(req, timeout=self.args.timeout) as resp:
            return resp.read()

    def maybe_pause(self) -> None:
        while not self.stop.is_set():
            with self.lock:
                t = self.pause_until
            now = time.time()
            if t <= now:
                return
            time.sleep(min(t - now, 5.0))

    def on_net_error(self) -> None:
        with self.lock:
            self.consecutive_err += 1
            n = self.consecutive_err
        if n >= 3:
            wait = min(2 ** min(n - 2, 5), 60)  # 2,4,8,16,32,60
            with self.lock:
                self.pause_until = max(self.pause_until, time.time() + wait)

    def on_success(self) -> None:
        with self.lock:
            self.consecutive_err = 0

    def download_one(self, word: str, accent: str) -> str:
        name = audio_filename(word, accent)
        if name in self.existing:
            return "skip"  # 纯内存判断，无磁盘 I/O
        fp = os.path.join(self.out, name)
        for attempt in range(1, self.args.retries + 1):
            if self.stop.is_set():
                return "abort"
            self.maybe_pause()
            try:
                data = self.fetch(word, accent)
                if is_valid_mp3(data):
                    atomic_write(fp, data)
                    self.existing.add(name)  # 同一次运行内后续命中也直接跳过
                    self.on_success()
                    return "ok"
                # 无效内容（无发音/JSON），短暂退避后重试
                time.sleep(0.4 * attempt)
            except urlerr.HTTPError as e:
                if e.code in (429, 500, 502, 503):
                    self.on_net_error()
                time.sleep(0.5 * attempt)
            except Exception:
                self.on_net_error()
                time.sleep(0.5 * attempt)
        return "fail"

    def worker(self, tasks) -> None:
        while not self.stop.is_set():
            with self.lock:
                if self.cursor >= len(tasks):
                    return
                word, accent = tasks[self.cursor]
                self.cursor += 1
            result = self.download_one(word, accent)
            if result in ("ok", "fail"):
                # 请求间隔（随机抖动）：仅对真正发起网络请求的任务限速；
                # skip 只是本地文件检测、不发请求，不再空等，断点续传扫描瞬间完成
                base = self.args.interval
                time.sleep(base * (0.7 + 0.6 * random.random()))
            with self.lock:
                if result == "ok":
                    self.ok += 1
                elif result == "skip":
                    self.skip += 1
                elif result == "fail":
                    self.fail += 1
                    self.failed.append("%s|%s" % (word, accent))
                self.done += 1

    def progress_printer(self, total) -> None:
        start = time.time()
        while not self.stop.is_set():
            time.sleep(0.5)
            with self.lock:
                done, ok, skip, fail = self.done, self.ok, self.skip, self.fail
            elapsed = time.time() - start
            rate = done / elapsed if elapsed > 0 else 0
            eta = (total - done) / rate if rate > 0 else 0
            pct = done * 100 / total if total else 100
            sys.stdout.write(
                "\r  %5d/%-5d (%5.1f%%) 新下=%-5d 已存在=%-5d 失败=%-4d | %4.1f 个/秒 | 剩余约 %5.1f 分钟   "
                % (done, total, pct, ok, skip, fail, rate, eta / 60))
            sys.stdout.flush()

    def run(self, tasks) -> None:
        total = len(tasks)
        print("输出目录: %s" % self.out)
        print("已扫描到 %d 个有效音频，命中即秒跳过（内存索引，零磁盘检测）"
              % len(self.existing))
        print("待处理任务: %d（词 × 口音），并发 %d，单请求间隔约 %.2fs"
              % (total, self.args.workers, self.args.interval))
        print("提示：按 Ctrl+C 可随时安全退出，重跑会自动跳过已下载项。\n")

        printer = threading.Thread(target=self.progress_printer, args=(total,), daemon=True)
        printer.start()
        threads = [threading.Thread(target=self.worker, args=(tasks,), daemon=True)
                   for _ in range(self.args.workers)]
        for t in threads:
            t.start()
        try:
            while any(t.is_alive() for t in threads):
                time.sleep(0.3)
        except KeyboardInterrupt:
            self.stop.set()
        sys.stdout.write("\n")

        self.write_failed()
        self.write_state(total)

    def failed_path(self) -> str:
        return os.path.join(self.out, "failed.txt")

    def write_failed(self) -> None:
        with self.lock:
            failed = list(self.failed)
        if failed:
            with open(self.failed_path(), "w", encoding="utf-8") as f:
                f.write("\n".join(failed))
            print("失败清单已写入: %s（共 %d，可用 --retry-failed 重试）"
                  % (self.failed_path(), len(failed)))
        else:
            if os.path.exists(self.failed_path()):
                try:
                    os.remove(self.failed_path())
                except OSError:
                    pass

    def write_state(self, total) -> None:
        state = {
            "scope": self.args.scope,
            "accent": self.args.accent,
            "totalTasks": total,
            "newDownloaded": self.ok,
            "alreadyExisted": self.skip,
            "failed": self.fail,
            "finishedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        with open(os.path.join(self.out, "download_state.json"), "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)


def parse_failed_tasks(path: str):
    tasks = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if "|" in line:
                w, a = line.rsplit("|", 1)
                if a in ("us", "uk"):
                    tasks.append((w, a))
    return tasks


def main():
    p = argparse.ArgumentParser(description="拾词 · 有道发音批量下载器")
    p.add_argument("--scope", choices=["cet4", "exam", "common", "all"], default="common",
                   help="cet4=仅背单词词书(约6千)；exam=有考试标签(约3.8万)；"
                        "common=考试/常用词(约5.3万，默认)；all=全部(约328万，不建议)")
    p.add_argument("--accent", choices=["us", "uk", "both"], default="both",
                   help="美音/英音/两者（默认两者，各下一份 _us.mp3 / _uk.mp3）")
    p.add_argument("--out", default=DEFAULT_OUT, help="音频输出目录")
    p.add_argument("--db", default=DEFAULT_DB, help="stardict.db 路径")
    p.add_argument("--workers", type=int, default=4, help="并发线程数（默认4）")
    p.add_argument("--interval", type=float, default=0.2, help="单请求基础间隔秒（默认0.2）")
    p.add_argument("--retries", type=int, default=3, help="单词失败重试次数（默认3）")
    p.add_argument("--timeout", type=float, default=10, help="单请求超时秒（默认10）")
    p.add_argument("--limit", type=int, default=0, help="仅处理前 N 个任务（测试用）")
    p.add_argument("--retry-failed", action="store_true", help="只重试 failed.txt 中的失败项")
    args = p.parse_args()

    dl = Downloader(args)

    if args.retry_failed:
        fpath = dl.failed_path()
        if not os.path.exists(fpath):
            print("找不到失败清单 %s，无需重试。" % fpath)
            return
        tasks = parse_failed_tasks(fpath)
        print("从失败清单载入 %d 个任务。" % len(tasks))
    else:
        words = collect_words(args.scope, args.db)
        words = sorted(words)
        accents = ["us", "uk"] if args.accent == "both" else [args.accent]
        tasks = [(w, a) for w in words for a in accents]
        if args.limit > 0:
            tasks = tasks[:args.limit]

    if not tasks:
        print("没有需要下载的任务。")
        return

    dl.run(tasks)
    print("\n完成。新下载 %d，已存在 %d，失败 %d。" % (dl.ok, dl.skip, dl.fail))


if __name__ == "__main__":
    main()
