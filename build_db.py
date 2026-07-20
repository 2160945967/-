import csv
import os
import sqlite3
import time

ROOT_DIR = r"d:\学习\英语\程序\拾词 - electron"
STARDICT_CSV = os.path.join(ROOT_DIR, "stardict.csv")
STARDICT_DB = os.path.join(ROOT_DIR, "stardict.db")

def stripword(word):
    """只保留字母和数字，转小写"""
    result = ''
    for ch in word:
        if ('a' <= ch <= 'z') or ('A' <= ch <= 'Z') or ('0' <= ch <= '9'):
            result += ch
    return result.lower()

def safe_int(value, default=None):
    if value is None or value == '':
        return default
    try:
        return int(float(value))
    except:
        return default

def safe_str(value):
    if value is None:
        return ''
    return str(value).strip()

print("=" * 60)
print("开始从 stardict.csv 生成 stardict.db")
print("=" * 60)

# 删除旧数据库
if os.path.exists(STARDICT_DB):
    print("删除旧的 stardict.db...")
    os.remove(STARDICT_DB)

conn = sqlite3.connect(STARDICT_DB)
cursor = conn.cursor()

# 建表
cursor.executescript("""
CREATE TABLE IF NOT EXISTS "stardict" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL UNIQUE,
    "word" VARCHAR(64) COLLATE NOCASE NOT NULL UNIQUE,
    "sw" VARCHAR(64) COLLATE NOCASE NOT NULL,
    "phonetic" VARCHAR(64),
    "definition" TEXT,
    "translation" TEXT,
    "pos" VARCHAR(16),
    "collins" INTEGER DEFAULT(0),
    "oxford" INTEGER DEFAULT(0),
    "tag" VARCHAR(64),
    "bnc" INTEGER DEFAULT(NULL),
    "frq" INTEGER DEFAULT(NULL),
    "exchange" TEXT,
    "detail" TEXT,
    "audio" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "stardict_1" ON stardict (id);
CREATE UNIQUE INDEX IF NOT EXISTS "stardict_2" ON stardict (word);
CREATE INDEX IF NOT EXISTS "stardict_3" ON stardict (sw, word collate nocase);
CREATE INDEX IF NOT EXISTS "sd_1" ON stardict (word collate nocase);
""")

# 准备插入语句
insert_sql = """
INSERT INTO stardict (word, sw, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange, detail, audio)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""

print("读取 stardict.csv 并导入...")
t0 = time.time()

total = 0
batch = []
BATCH_SIZE = 1000
seen = set()

with open(STARDICT_CSV, 'r', encoding='utf-8', newline='') as f:
    reader = csv.DictReader(f)
    for row in reader:
        word = safe_str(row.get('word', ''))
        if not word:
            continue
        
        lower = word.lower()
        if lower in seen:
            continue
        seen.add(lower)
        
        batch.append((
            word,
            stripword(word),
            safe_str(row.get('phonetic', '')),
            safe_str(row.get('definition', '')),
            safe_str(row.get('translation', '')),
            safe_str(row.get('pos', '')),
            safe_int(row.get('collins', ''), 0) or 0,
            safe_int(row.get('oxford', ''), 0) or 0,
            safe_str(row.get('tag', '')),
            safe_int(row.get('bnc', '')),
            safe_int(row.get('frq', '')),
            safe_str(row.get('exchange', '')),
            safe_str(row.get('detail', '')),
            safe_str(row.get('audio', ''))
        ))
        
        if len(batch) >= BATCH_SIZE:
            cursor.executemany(insert_sql, batch)
            batch = []
            total += BATCH_SIZE
            if total % 100000 == 0:
                print(f"  已导入 {total} 条...")

if batch:
    cursor.executemany(insert_sql, batch)
    total += len(batch)

conn.commit()

# 统计
cursor.execute("SELECT COUNT(*) FROM stardict")
count = cursor.fetchone()[0]

print(f"\n导入完成: {count} 条单词")
print(f"耗时: {time.time() - t0:.1f} 秒")
print(f"数据库大小: {os.path.getsize(STARDICT_DB) / (1024*1024):.2f} MB")

# 查询测试
test_words = ['abruptly', 'hello', 'computer', 'university', 'absorb']
print("\n查询测试:")
for w in test_words:
    cursor.execute("SELECT word, translation, tag FROM stardict WHERE word = ? COLLATE NOCASE", (w,))
    row = cursor.fetchone()
    if row:
        print(f"  {row[0]}: {row[1][:50] if row[1] else '(无翻译)'} [tag: {row[2] or ''}]")
    else:
        print(f"  {w}: 未找到")

conn.close()
print(f"\n数据库已保存到: {STARDICT_DB}")
