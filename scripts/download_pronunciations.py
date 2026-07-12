#!/usr/bin/env python3
"""
有道TTS批量下载发音脚本
覆盖: 四级(cet4) 六级(cet6) 考研(ky) 托福(toefl) 雅思(ielts) GRE(gre)
每个词下载英美两种发音，断点续传。

运行逻辑:
  - 有 _failed.txt 时: 只跑失败列表里的词，下载成功就从中移除
  - 没有 _failed.txt 时: 跑全部词，失败的写入 _failed.txt
  - 已存在的文件自动跳过
"""

import sqlite3
import os
import sys
import time
import urllib.request
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# 配置

ROOT_DIR = Path(__file__).resolve().parent.parent
DB_PATH = ROOT_DIR / 'stardict.db'
PRON_DIR = ROOT_DIR / 'pronunciations'
FAILED_FILE = ROOT_DIR / 'pronunciations' / '_failed.txt'

TAGS = ['cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre']
ACCENTS = ['us', 'uk']

# 有道TTS: type=0 美音, type=1 英音
YOUDAO_URL = 'https://dict.youdao.com/dictvoice?type={type}&audio={word}'
# 百度TTS: lan=en, spd=语速
BAIDU_URL = 'https://tts.baidu.com/text2audio?lan=en&ie=UTF-8&spd=4&text={word}&cuid=shici_app&ctp=1'

# 失败重试间隔(秒)
RETRY_DELAY = 1
# 并发线程数
MAX_WORKERS = 5
# 失败重试次数
MAX_RETRIES = 3
# 重试间隔递增值(秒)
RETRY_BASE_DELAY = 2

# 工具函数

def normalize_filename(word):
    """单词转合法文件名，统一小写以匹配前端请求"""
    word = word.strip().lower()
    for ch in '/\\:*?<>|':
        word = word.replace(ch, '_')
    return word.replace('&', '_and_')


def is_valid_mp3(filepath):
    """检查文件是否为有效MP3(非JSON错误)"""
    if not filepath.exists():
        return False
    if filepath.stat().st_size < 300:
        return False
    with open(filepath, 'rb') as f:
        first_byte = f.read(1)
        if first_byte == b'{':
            return False
    return True


def _fetch_audio(url):
    """请求音频URL，返回 bytes 或 None"""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://dict.youdao.com/',
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
        if len(data) < 300 or data[0] == 0x7B:
            return None
        return data
    except Exception:
        return None


def download_one(word, accent, retry=0):
    """下载单个单词发音，返回 'skip' / True / False"""
    filename = f'{normalize_filename(word)}_{accent}.mp3'
    filepath = PRON_DIR / filename

    # 已存在有效文件则跳过
    if is_valid_mp3(filepath):
        return 'skip'

    # 1. 有道TTS
    youdao_type = 0 if accent == 'us' else 1
    url = YOUDAO_URL.format(type=youdao_type, word=urllib.request.quote(word))
    data = _fetch_audio(url)
    provider = 'youdao'
    if data is None:
        # 2. 百度TTS 兜底
        url = BAIDU_URL.format(word=urllib.request.quote(word))
        data = _fetch_audio(url)
        provider = 'baidu'

    if data is None:
        if retry < MAX_RETRIES - 1:
            delay = RETRY_BASE_DELAY * (retry + 1)
            time.sleep(delay)
            return download_one(word, accent, retry + 1)
        return False

    with open(filepath, 'wb') as f:
        f.write(data)

    provider_file = PRON_DIR / f'{filename}.provider'
    with open(provider_file, 'w') as f:
        f.write(provider)

    return True


def load_failed():
    """读取失败列表，返回 set"""
    if FAILED_FILE.exists():
        lines = FAILED_FILE.read_text(encoding='utf-8').strip().split('\n')
        return set(l for l in lines if l)
    return set()


def save_failed(failed_set):
    """保存失败列表"""
    if failed_set:
        FAILED_FILE.write_text('\n'.join(sorted(failed_set)), encoding='utf-8')
    elif FAILED_FILE.exists():
        FAILED_FILE.unlink()


# 主流程

def main():
    print('=' * 60)
    print('  有道TTS批量发音下载')
    print('=' * 60)

    PRON_DIR.mkdir(parents=True, exist_ok=True)

    if not DB_PATH.exists():
        print(f'[错误] 数据库不存在: {DB_PATH}')
        sys.exit(1)

    # 读取上一轮失败列表
    prev_failed = load_failed()
    retry_mode = len(prev_failed) > 0

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    if retry_mode:
        # 补全模式: 只跑失败列表里的词
        print(f'\n  [补全模式] 上次失败 {len(prev_failed)} 条，只重试这些')
        tasks = []
        for item in prev_failed:
            if ':' in item:
                word, accent = item.rsplit(':', 1)
                tasks.append((word, accent))
            else:
                # 兼容旧格式: 只有单词，两种发音都跑
                for accent in ACCENTS:
                    tasks.append((item, accent))
        print(f'  任务数: {len(tasks)}')
    else:
        # 全量模式: 跑所有词
        all_words = set()
        for tag in TAGS:
            rows = conn.execute(
                "SELECT word FROM stardict WHERE tag LIKE ?", (f'%{tag}%',)
            ).fetchall()
            words = [r['word'].strip() for r in rows if r['word']]
            all_words.update(words)
            print(f'  {tag}: {len(words)} 个词')

        conn.close()

        all_words = sorted(all_words)
        total = len(all_words)
        print(f'\n  去重后总计: {total} 个词')
        print(f'  目标: {total} 词 x 2 种发音 = {total * 2} 个文件')

        tasks = []
        for word in all_words:
            for accent in ACCENTS:
                tasks.append((word, accent))

    print(f'  发音目录: {PRON_DIR}')
    print()

    # 统计
    success = 0
    skipped = 0
    failed_set = set()
    start_time = time.time()
    total_tasks = len(tasks)

    lock = threading.Lock()
    completed = 0

    def process_one(word, accent):
        result = download_one(word, accent)
        if result is False:
            time.sleep(RETRY_DELAY)
        return word, accent, result

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_one, w, a): (w, a) for w, a in tasks}

        for future in as_completed(futures):
            word, accent, result = future.result()
            with lock:
                completed += 1
                if result == 'skip':
                    skipped += 1
                    status = '跳过'
                elif result:
                    success += 1
                    status = '成功'
                    # 成功了就从失败列表里移除
                    failed_set.discard(f'{word}:{accent}')
                else:
                    failed_set.add(f'{word}:{accent}')
                    status = '失败'

                word_label = f'{word} ({accent})'
                progress = f'[{completed}/{total_tasks}]'
                elapsed = time.time() - start_time
                eta = (elapsed / completed) * (total_tasks - completed) if completed > 0 else 0
                eta_str = f' 剩余约{eta:.0f}s' if eta > 0 else ''
                print(f'  {progress} {status:4s} | {word_label:40s}{eta_str}')

            # 每100个任务保存一次失败列表
            if completed % 100 == 0:
                save_failed(failed_set.copy())

    # 最终统计
    print()
    print('=' * 60)
    print('  下载完成')
    print(f'  成功: {success}')
    print(f'  跳过(已存在): {skipped}')
    print(f'  失败: {len(failed_set)}')
    print(f'  总耗时: {time.time() - start_time:.0f}s')

    save_failed(failed_set)

    if failed_set:
        print(f'  失败列表已保存到: {FAILED_FILE}')
        print(f'  下次运行只重试这 {len(failed_set)} 条')
    else:
        print('  全部完成! 失败列表已清除')

    print('=' * 60)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\n\n[中断] 已保存当前失败列表，下次运行会继续')
        sys.exit(0)