#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
拾词后端服务器
提供词典查询、模糊匹配、发音文件服务、有道TTS和翻译
"""

import os
import sys
import json
import time
import traceback
import webbrowser
import threading
from functools import wraps, lru_cache
from threading import Timer
from flask import Flask, jsonify, request, send_from_directory, g
from io import BytesIO

# 设置UTF-8编码环境变量
os.environ['PYTHONIOENCODING'] = 'utf-8'

# 添加当前目录到Python路径
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _BASE_DIR)

from stardict import DictCsv, StarDict
from worddata import get_word_enhanced_info, LemmaDB
from wordutils import normalize_word_for_filename
from tencent_api import init_tts, get_tts

# 尝试导入python-docx，处理可能的导入错误
try:
    from docx import Document
    DOCX_AVAILABLE = True
except ImportError:
    DOCX_AVAILABLE = False
    print("警告: python-docx 未安装，.docx导入功能将不可用")

# 检查数据文件是否存在
def check_data_files():
    """检查必需的数据文件是否存在"""
    required_files = [
        os.path.join(_BASE_DIR, 'ecdict.csv'),
        os.path.join(_BASE_DIR, 'sentences.csv'),
        os.path.join(_BASE_DIR, 'links.csv'),
        os.path.join(_BASE_DIR, 'lemma.en.txt'),
    ]
    
    missing_files = []
    for f in required_files:
        if not os.path.exists(f):
            missing_files.append(os.path.basename(f))
    
    if missing_files:
        print()
        print("⚠️  缺少必需的数据文件!")
        print(f"   缺少: {', '.join(missing_files)}")
        print()
        print("请运行以下命令下载数据文件:")
        print("   python data_downloader.py")
        print()
        return False
    
    return True

# 初始化Flask应用
app = Flask(__name__)

# CORS 处理
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

# 配置应用
app.config['JSON_AS_ASCII'] = False  # 允许JSON输出中文
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = True
app.config['JSON_AS_ASCII'] = False


# ==================== 数据库连接和缓存 ====================
import sqlite3

def get_examples_db():
    """从 g 中获取例句数据库连接（一个请求内复用）"""
    if 'examples_db' not in g:
        g.examples_db = sqlite3.connect(EXAMPLES_DB_PATH)
    return g.examples_db

@app.teardown_request
def close_db_connection(exception):
    """请求结束时关闭数据库连接"""
    examples_db = g.pop('examples_db', None)
    if examples_db is not None:
        examples_db.close()


# ==================== 工具函数定义开始 ====================

def handle_exception(f):
    """全局异常处理装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            # 避免打印时的编码问题，我们只记录到变量
            # 避免直接打印到stdout，避免编码问题
            try:
                import traceback
                traceback.print_exc()
            except:
                pass
            # 直接返回JSON响应
            result = {'success': False, 'error': str(e)}
            response = app.response_class(
                response=json.dumps(result, ensure_ascii=False),
                status=500,
                mimetype='application/json'
            )
            return response, 500
    return decorated_function


def get_request_param(key, default=None):
    """统一获取请求参数，支持JSON/Form/Args"""
    # 先尝试从JSON获取
    if request.is_json:
        try:
            data = request.get_json()
            if data and key in data:
                return data[key]
        except:
            pass
    # 然后尝试从form获取
    if key in request.form:
        return request.form[key]
    # 最后尝试从args获取
    if key in request.args:
        return request.args[key]
    return default


def success_response(data=None, **kwargs):
    """成功响应包装器"""
    result = {'success': True}
    if data is not None:
        result['data'] = data
    result.update(kwargs)
    # 直接返回JSON字符串，避免编码问题
    response = app.response_class(
        response=json.dumps(result, ensure_ascii=False),
        status=200,
        mimetype='application/json'
    )
    return response


def error_response(message, status_code=400):
    """错误响应包装器"""
    result = {'success': False, 'error': message}
    response = app.response_class(
        response=json.dumps(result, ensure_ascii=False),
        status=status_code,
        mimetype='application/json'
    )
    return response, status_code


def ensure_dir_exists(dir_path):
    """确保目录存在，如果不存在则创建"""
    if not os.path.exists(dir_path):
        os.makedirs(dir_path, exist_ok=True)


def get_audio_path(word, accent):
    """获取永久音频文件路径"""
    normalized_word = normalize_word_for_filename(word)
    filename = f"{normalized_word}_{accent}.mp3"
    return os.path.join(PRONUNCIATIONS_DIR, filename), filename


def get_cache_audio_path(word, accent):
    """获取缓存音频文件路径"""
    normalized_word = normalize_word_for_filename(word)
    filename = f"{normalized_word}_{accent}.mp3"
    cache_audio_dir = os.path.join(CACHE_DIR, 'audio')
    ensure_dir_exists(cache_audio_dir)
    return os.path.join(cache_audio_dir, filename), filename


def get_lemma(word, lemma_db_instance=None):
    """获取单词词干"""
    if lemma_db_instance is None:
        lemma_db_instance = load_lemma_db()
    return lemma_db_instance.get_lemma(word) or word


def is_lemma_duplicate(lemma, word_list, lemma_db_instance=None):
    """检查词干是否已存在于列表中"""
    if lemma_db_instance is None:
        lemma_db_instance = load_lemma_db()
    lemma_lower = lemma.lower()
    for w in word_list:
        existing_lemma = lemma_db_instance.get_lemma(w) or w
        if existing_lemma.lower() == lemma_lower:
            return True
    return False


def extract_words_from_text(text):
    """从文本中提取单词"""
    words = []
    lines = text.split('\n')
    
    for line in lines:
        line = line.strip()
        if line:
            if '|' in line:
                line = line.split('|')[0].strip()
            if line:
                words.append(line)
    
    return words


def normalize_word(word):
    """标准化单词（首字母小写，短语保持原样）"""
    if ' ' in word:
        return word
    return word[0].lower() + word[1:] if word else word


def validate_accent(accent):
    """验证口音类型是否有效"""
    return accent in ['uk', 'us']


def get_audio_filename(word, accent):
    """生成音频文件名"""
    normalized_word = normalize_word_for_filename(word)
    return f"{normalized_word}_{accent}.mp3"


def get_audio_path(word, accent):
    """获取永久音频文件路径"""
    filename = get_audio_filename(word, accent)
    return os.path.join(PRONUNCIATIONS_DIR, filename), filename


def get_cache_audio_path(word, accent):
    """获取缓存音频文件路径"""
    filename = get_audio_filename(word, accent)
    cache_audio_dir = os.path.join(CACHE_DIR, 'audio')
    ensure_dir_exists(cache_audio_dir)
    return os.path.join(cache_audio_dir, filename), filename

# ==================== 工具函数定义结束 ====================


# 统一的SQLite数据库路径
MAIN_DB_PATH = os.path.join(_BASE_DIR, 'stardict.db')
EXAMPLES_DB_PATH = os.path.join(_BASE_DIR, 'examples.db')

# 例句数据文件路径
SENTENCES_PATH = os.path.join(_BASE_DIR, 'sentences.csv')
LINKS_PATH = os.path.join(_BASE_DIR, 'links.csv')

# 主词典（使用SQLite）
dict_ecdict = None

def init_examples_db():
    """初始化例句SQLite数据库，第一次运行时导入数据"""
    import sqlite3
    
    # 检查数据库是否存在
    if os.path.exists(EXAMPLES_DB_PATH):
        # 检查数据库结构是否完整
        conn = sqlite3.connect(EXAMPLES_DB_PATH)
        c = conn.cursor()
        
        # 检查是否有 translations 表
        c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='translations'")
        has_translations = c.fetchone() is not None
        
        # 检查数据是否完整
        data_ok = False
        if has_translations:
            try:
                c.execute('SELECT COUNT(*) FROM translations')
                trans_count = c.fetchone()[0]
                c.execute('SELECT COUNT(*) FROM sentences WHERE lang="eng"')
                eng_count = c.fetchone()[0]
                data_ok = trans_count > 0 and eng_count > 0
            except:
                data_ok = False
        
        conn.close()
        
        if has_translations and data_ok:
            # 结构完整，直接返回
            return True
        else:
            # 结构不完整，删除旧数据库，重新初始化
            print("检测到旧版本或不完整的例句数据库，正在重新初始化...")
            os.remove(EXAMPLES_DB_PATH)
    
    # 开始初始化新数据库
    print("正在初始化例句数据库...")
    t0 = time.time()
    
    try:
        # 创建数据库
        conn = sqlite3.connect(EXAMPLES_DB_PATH)
        c = conn.cursor()
        
        # 创建表
        c.execute('''
            CREATE TABLE sentences (
                id INTEGER PRIMARY KEY,
                lang TEXT,
                text TEXT
            )
        ''')
        
        c.execute('''
            CREATE TABLE word_examples (
                word TEXT,
                sentence_id INTEGER,
                PRIMARY KEY (word, sentence_id)
            )
        ''')
        
        c.execute('''
            CREATE TABLE translations (
                eng_id INTEGER,
                cmn_id INTEGER,
                PRIMARY KEY (eng_id, cmn_id)
            )
        ''')
        
        c.execute('CREATE INDEX idx_word ON word_examples (word)')
        c.execute('CREATE INDEX idx_eng_trans ON translations (eng_id)')
        c.execute('CREATE INDEX idx_cmn_trans ON translations (cmn_id)')
        c.execute('CREATE INDEX idx_sentences_lang ON sentences (lang)')
        
        # 第一步：先扫描sentences.csv，收集所有sentences的语言
        print("正在扫描句子文件...")
        sentence_langs = {}  # {id: lang}
        all_sentences = []  # [(id, lang, text)]
        with open(SENTENCES_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                parts = line.split('\t', 2)
                if len(parts) >= 3:
                    sid = int(parts[0])
                    lang = parts[1]
                    text = parts[2]
                    sentence_langs[sid] = lang
                    all_sentences.append((sid, lang, text))
        
        # 导入句子
        print("正在导入句子...")
        count_eng = 0
        count_cmn = 0
        total = len(all_sentences)
        for i, (sid, lang, text) in enumerate(all_sentences):
            # 插入句子
            c.execute('INSERT OR IGNORE INTO sentences (id, lang, text) VALUES (?, ?, ?)', 
                      (sid, lang, text))
            
            # 如果是英文句子，建立单词索引
            if lang == 'eng':
                # 提取单词并建立索引
                words_in_text = []
                w = []
                for char in text:
                    if char.isalpha() or char == "'":
                        w.append(char.lower())
                    else:
                        if w:
                            words_in_text.append(''.join(w))
                            w = []
                if w:
                    words_in_text.append(''.join(w))
                
                for word in set(words_in_text):
                    if len(word) >= 2:
                        c.execute('INSERT OR IGNORE INTO word_examples (word, sentence_id) VALUES (?, ?)', 
                                  (word, sid))
                count_eng += 1
            elif lang == 'cmn':
                count_cmn += 1
            
            # 显示进度
            if (i + 1) % 100000 == 0:
                percent = int((i + 1) / total * 100)
                print(f"已导入 {i + 1}/{total} ({percent}%) 个句子...")
        
        print(f"已导入 {count_eng} 个英文句子和 {count_cmn} 个中文句子")
        
        # 第二步：导入翻译链接
        print("正在导入翻译链接...")
        count_trans = 0
        # 先数一下links有多少行，用于显示进度
        link_total = 0
        with open(LINKS_PATH, 'r', encoding='utf-8') as f:
            for _ in f:
                link_total += 1
        
        with open(LINKS_PATH, 'r', encoding='utf-8') as f:
            for i, line in enumerate(f):
                line = line.strip()
                if not line:
                    continue
                parts = line.split('\t')
                if len(parts) >= 2:
                    id1 = int(parts[0])
                    id2 = int(parts[1])
                    
                    # 从内存字典查找语言
                    lang1 = sentence_langs.get(id1)
                    lang2 = sentence_langs.get(id2)
                    
                    if lang1 and lang2:
                        # 如果是英语和中文的组合
                        if (lang1 == 'eng' and lang2 == 'cmn'):
                            c.execute('INSERT OR IGNORE INTO translations (eng_id, cmn_id) VALUES (?, ?)', 
                                      (id1, id2))
                            count_trans += 1
                        elif (lang1 == 'cmn' and lang2 == 'eng'):
                            c.execute('INSERT OR IGNORE INTO translations (eng_id, cmn_id) VALUES (?, ?)', 
                                      (id2, id1))
                            count_trans += 1
                
                # 显示进度
                if (i + 1) % 500000 == 0:
                    percent = int((i + 1) / link_total * 100)
                    print(f"已处理 {i + 1}/{link_total} ({percent}%) 个链接，找到 {count_trans} 个中英翻译...")
        
        conn.commit()
        conn.close()
        
        print(f"✅ 例句数据库初始化完成 (耗时: {time.time() - t0:.2f}s)")
        print(f"  - 英文句子: {count_eng}")
        print(f"  - 中文句子: {count_cmn}")
        print(f"  - 中英翻译链接: {count_trans}")
        return True
        
    except Exception as e:
        print(f"❌ 初始化例句数据库失败: {e}")
        import traceback
        traceback.print_exc()
        if os.path.exists(EXAMPLES_DB_PATH):
            os.remove(EXAMPLES_DB_PATH)
        return False

def init_main_db():
    """初始化主词典SQLite数据库，第一次运行时从CSV导入"""
    global dict_ecdict
    import sqlite3

    # 如果数据库已存在，直接打开
    if os.path.exists(MAIN_DB_PATH):
        dict_ecdict = StarDict(MAIN_DB_PATH)
        count = dict_ecdict.count()
        print(f"主词典数据库已存在，总词数: {count}")
        if count == 0:
            print("发现空数据库，正在重新导入...")
            # 删除空数据库，重新初始化
            os.remove(MAIN_DB_PATH)
            # 重新创建数据库
        else:
            return True
    
    # 从ECDict CSV导入
    print("正在从ECDict CSV创建SQLite数据库...")
    t0 = time.time()
    
    # 先创建数据库
    dict_ecdict = StarDict(MAIN_DB_PATH)
    
    # 从ecdict.csv导入
    csv_dict = DictCsv(os.path.join(_BASE_DIR, 'ecdict.csv'))
    
    # 批量导入
    conn = sqlite3.connect(MAIN_DB_PATH)
    cursor = conn.cursor()
    
    # 开始事务
    cursor.execute('BEGIN TRANSACTION')
    
    total_words = len(csv_dict)
    count = 0
    for index, word in csv_dict:
        word_data = csv_dict[word]
        # 插入单词
        cursor.execute('''
            INSERT OR IGNORE INTO stardict 
            (word, sw, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange, detail, audio)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            word,
            word_data.get('sw', word),
            word_data.get('phonetic', ''),
            word_data.get('definition', ''),
            word_data.get('translation', ''),
            word_data.get('pos', ''),
            word_data.get('collins', 0),
            word_data.get('oxford', 0),
            word_data.get('tag', ''),
            word_data.get('bnc'),
            word_data.get('frq'),
            word_data.get('exchange', ''),
            json.dumps(word_data.get('detail')) if word_data.get('detail') else None,
            word_data.get('audio', '')
        ))
        count += 1
        if count % 10000 == 0:
            percent = int(count / total_words * 100)
            print(f"已导入: {count}/{total_words} ({percent}%)...")
    
    # 提交事务
    cursor.execute('COMMIT')
    conn.close()
    
    t1 = time.time()
    print(f"主词典数据库创建完成，总词数: {count} (耗时: {t1 - t0:.2f}s)")
    return True

# 初始化主词典
print("正在初始化主词典...")
t0 = time.time()
init_main_db()
t1 = time.time()
print(f"✅ 主词典初始化完成 (耗时: {t1 - t0:.2f}s)")
print()

# 检查是否需要初始化例句数据库
examples_db_exists = os.path.exists(EXAMPLES_DB_PATH)
if not examples_db_exists:
    print("=" * 50)
    print("首次运行，正在初始化例句数据库...")
    print("这可能需要几分钟时间，请耐心等待...")
    print("=" * 50)
    t2 = time.time()
    init_examples_db()
    t3 = time.time()
    print(f"✅ 例句数据库初始化完成 (耗时: {t3 - t2:.2f}s)")
    print()
else:
    print("✅ 例句数据库已就绪")
    print()

# 副词典延迟加载，避免启动时消耗过多时间
dict_stardict = None
stardict_loaded = False
stardict_loading = False
stardict_load_thread = None

# 词干数据库
lemma_db = None

@lru_cache(maxsize=500)
def find_examples_for_word(word):
    """使用SQLite查询单词的例句（包含中文翻译），带LRU缓存"""
    import sqlite3
    examples = []
    
    try:
        # 确保数据库已初始化
        if not os.path.exists(EXAMPLES_DB_PATH):
            if not init_examples_db():
                return examples
        
        conn = sqlite3.connect(EXAMPLES_DB_PATH)
        c = conn.cursor()
        
        target_word = word.lower()
        
        # 查询包含该单词的句子，只返回有中文翻译的
        c.execute('''
            SELECT s.id, s.text, t.cmn_id, s_cmn.text
            FROM sentences s 
            JOIN word_examples w ON s.id = w.sentence_id 
            JOIN translations t ON s.id = t.eng_id
            JOIN sentences s_cmn ON t.cmn_id = s_cmn.id
            WHERE w.word = ? 
            LIMIT 50
        ''', (target_word,))
        
        for row in c.fetchall():
            example = {
                'id': str(row[0]),
                'lang': 'eng',
                'text': row[1],
                'translation': row[3]
            }
            examples.append(example)
        
        conn.close()
        
    except Exception as e:
        print(f"查询例句失败: {e}")
    
    return examples


def _load_stardict_async():
    """异步加载副词典的内部函数"""
    global dict_stardict, stardict_loaded, stardict_loading
    try:
        stardict_path = os.path.join(_BASE_DIR, 'stardict.csv')
        if os.path.exists(stardict_path):
            print("正在后台加载副词典...")
            t0 = time.time()
            dict_stardict = DictCsv(stardict_path)
            t1 = time.time()
            print(f"副词典加载成功，总词数: {dict_stardict.count()} (耗时: {t1 - t0:.2f}s)")
    except Exception as e:
        print(f"加载副词典失败: {e}")
    finally:
        stardict_loaded = True
        stardict_loading = False


def load_stardict():
    """触发副词典的异步加载，不阻塞"""
    global stardict_loading, stardict_load_thread
    if not stardict_loaded and not stardict_loading:
        stardict_loading = True
        stardict_load_thread = threading.Thread(target=_load_stardict_async, daemon=True)
        stardict_load_thread.start()


def load_lemma_db():
    """需要时才加载词干数据库"""
    global lemma_db
    if not lemma_db:
        print("正在加载词干数据库...")
        t0 = time.time()
        lemma_db = LemmaDB()
        t1 = time.time()
        print(f"词干数据库加载成功 (耗时: {t1 - t0:.2f}s)")
    return lemma_db


# 静态文件目录
STATIC_DIR = os.path.join(_BASE_DIR, 'static')
PRONUNCIATIONS_DIR = os.path.join(_BASE_DIR, 'pronunciations')
CACHE_DIR = os.path.join(_BASE_DIR, 'cache')

# 确保目录存在
ensure_dir_exists(STATIC_DIR)
ensure_dir_exists(CACHE_DIR)

# 初始化TTS
print("正在初始化 TTS...")
t0 = time.time()
init_tts(PRONUNCIATIONS_DIR, CACHE_DIR)
t1 = time.time()
print(f"TTS 初始化完成 (耗时: {t1 - t0:.2f}s)")

# 翻译缓存
translation_cache = {}
translation_cache_file = os.path.join(CACHE_DIR, 'translation.json')
if os.path.exists(translation_cache_file):
    try:
        with open(translation_cache_file, 'r', encoding='utf-8') as f:
            translation_cache = json.load(f)
    except Exception:
        pass


def save_translation_cache():
    try:
        with open(translation_cache_file, 'w', encoding='utf-8') as f:
            json.dump(translation_cache, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"保存翻译缓存失败: {e}")


@lru_cache(maxsize=1000)
def cached_query_ecdict(word):
    """带LRU缓存的主词典查询"""
    return dict_ecdict.query(word)

def query_both_dicts(word):
    """
    同时查询两个词典，合并结果
    返回: 优先主词典结果，如果副词典有结果会附加
    """
    result_ecdict = cached_query_ecdict(word)
    # 延迟加载副词典
    load_stardict()
    result_stardict = dict_stardict.query(word) if dict_stardict else None
    
    if result_ecdict and result_stardict:
        # 两个都有，合并结果，主词典优先，但记录来自两个词典
        merged = result_ecdict.copy()
        # 确保有word字段
        if 'word' not in merged:
            merged['word'] = merged.get('sw', word)
        if result_ecdict.get('translation') and result_stardict.get('translation'):
            if result_ecdict['translation'] != result_stardict['translation']:
                merged['translation'] = f"{result_ecdict['translation']}\n\n[副词典]: {result_stardict['translation']}"
        elif result_stardict.get('translation'):
            merged['translation'] = result_stardict['translation']
        
        merged['from_dicts'] = ['ecdict', 'stardict']
        return merged
    elif result_ecdict:
        result_ecdict['from_dicts'] = ['ecdict']
        if 'word' not in result_ecdict:
            result_ecdict['word'] = result_ecdict.get('sw', word)
        return result_ecdict
    elif result_stardict:
        result_stardict['from_dicts'] = ['stardict']
        if 'word' not in result_stardict:
            result_stardict['word'] = result_stardict.get('sw', word)
        return result_stardict
    else:
        return None


def match_both_dicts(prefix, count=10):
    """
    同时在两个词典中进行模糊匹配，合并结果，去重
    优先显示单个单词，除非用户输入有空格或连字符
    """
    # 多取很多结果来筛选单个单词
    matches_ecdict = dict_ecdict.match(prefix, count=200)
    # 延迟加载副词典
    load_stardict()
    matches_stardict = dict_stardict.match(prefix, count=200) if dict_stardict else []
    
    # 合并并去重（优先主词典）
    seen = set()
    all_matches = []
    
    # 先加主词典的结果
    for item in matches_ecdict:
        word_lower = item[1].lower()
        if word_lower not in seen:
            seen.add(word_lower)
            all_matches.append(item)
    
    # 再加副词典的结果
    if matches_stardict:
        for item in matches_stardict:
            word_lower = item[1].lower()
            if word_lower not in seen:
                seen.add(word_lower)
                all_matches.append(item)
    
    # 检查用户输入是否包含空格或连字符
    has_space_or_hyphen = ' ' in prefix or '-' in prefix
    
    if not has_space_or_hyphen:
        # 如果用户没有输入空格或连字符，优先显示单个单词
        single_words = []
        phrases = []
        for item in all_matches:
            word = item[1]
            if ' ' not in word and '-' not in word:
                single_words.append(item)
            else:
                phrases.append(item)
        all_matches = single_words + phrases
    
    return all_matches[:count]


# 单词本文件
wordbooks_file = os.path.join(_BASE_DIR, 'wordbooks.json')


def load_wordbooks():
    """加载单词本数据"""
    try:
        if os.path.exists(wordbooks_file):
            with open(wordbooks_file, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"加载单词本失败: {e}")
    return {}


def save_wordbooks(wordbooks):
    """保存单词本数据"""
    try:
        with open(wordbooks_file, 'w', encoding='utf-8') as f:
            json.dump(wordbooks, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"保存单词本失败: {e}")


def open_browser():
    """自动打开浏览器"""
    webbrowser.open_new('http://127.0.0.1:5000/')


@app.route('/api/wordbook/list', methods=['GET'])
@handle_exception
def get_wordbooks():
    """获取所有单词本"""
    wordbooks = load_wordbooks()
    return success_response(wordbooks=wordbooks)


@app.route('/api/wordbook/create', methods=['POST'])
@handle_exception
def create_wordbook():
    """创建单词本"""
    name = get_request_param('name', '')
    
    if not name:
        return error_response('请提供单词本名称')
    
    wordbooks = load_wordbooks()
    if name in wordbooks:
        return error_response('单词本已存在')
    
    wordbooks[name] = []
    save_wordbooks(wordbooks)
    
    return success_response(name=name, wordbooks=wordbooks)


@app.route('/api/wordbook/delete', methods=['POST'])
@handle_exception
def delete_wordbook_api():
    """删除单词本"""
    name = get_request_param('name', '')
    
    if not name:
        return error_response('请提供单词本名称')
    
    wordbooks = load_wordbooks()
    if name not in wordbooks:
        return error_response('单词本不存在', 404)
    
    if name in ['wordlist', 'favorites', 'errorbook']:
        return error_response('不能删除默认单词本')
    
    del wordbooks[name]
    save_wordbooks(wordbooks)
    
    return success_response(wordbooks=wordbooks)


@app.route('/api/wordbook/add', methods=['POST'])
@handle_exception
def add_to_wordbook():
    """添加单词到单词本"""
    wordbook_name = get_request_param('wordbook', '')
    word = get_request_param('word', '')
    
    if not wordbook_name or not word:
        return error_response('缺少必要参数')
    
    wordbooks = load_wordbooks()
    if wordbook_name not in wordbooks:
        wordbooks[wordbook_name] = []
    
    # 词形还原
    lemma_db_instance = load_lemma_db()
    lemma = get_lemma(word, lemma_db_instance)
    
    # 检查词干是否已存在（不区分大小写）
    if not is_lemma_duplicate(lemma, wordbooks[wordbook_name], lemma_db_instance):
        # 处理大小写：单词首字母小写，短语保持原样
        word_to_add = normalize_word(word)
        wordbooks[wordbook_name].append(word_to_add)
        save_wordbooks(wordbooks)
    
    return success_response(wordbooks=wordbooks)


@app.route('/api/wordbook/remove', methods=['POST'])
@handle_exception
def remove_from_wordbook():
    """从单词本移除单词"""
    wordbook_name = get_request_param('wordbook', '')
    word = get_request_param('word', '')
    
    if not wordbook_name or not word:
        return error_response('缺少必要参数')
    
    wordbooks = load_wordbooks()
    if wordbook_name not in wordbooks:
        return error_response('单词本不存在', 404)
    
    # 不区分大小写匹配
    word_lower = word.lower()
    wordbooks[wordbook_name] = [w for w in wordbooks[wordbook_name] if w.lower() != word_lower]
    save_wordbooks(wordbooks)
    
    return success_response(wordbooks=wordbooks)


@app.route('/')
def index():
    """主页"""
    return send_from_directory(STATIC_DIR, 'index.html')


@app.route('/<path:filename>')
def serve_static(filename):
    """提供静态文件服务（CSS、JS等）"""
    return send_from_directory(STATIC_DIR, filename)


@app.route('/api/search', methods=['GET'])
@handle_exception
def search_word():
    """
    查询单词详情
    参数: word - 要查询的单词
    返回: 单词的详细信息
    """
    word = request.args.get('word', '').strip()
    
    if not word:
        return error_response('请提供要查询的单词', 400)
    
    result = query_both_dicts(word)
    
    if result:
        return success_response(data=result)
    else:
        return error_response(f'未找到单词: {word}', 404)


@app.route('/api/match', methods=['GET'])
@handle_exception
def match_words():
    """
    模糊匹配单词
    参数: prefix - 单词前缀
         limit - 返回结果数量（默认10）
    返回: 匹配的单词列表
    """
    prefix = request.args.get('prefix', '').strip()
    limit = int(request.args.get('limit', 10))
    
    if not prefix:
        return error_response('请提供前缀参数', 400)
    
    matches = match_both_dicts(prefix, count=limit)
    
    return success_response(data=[{'id': item[0], 'word': item[1]} for item in matches])


@app.route('/api/examples', methods=['GET'])
@handle_exception
def get_examples():
    """
    获取单词对应的例句
    参数: word - 要查询的单词
    返回: 单词对应的例句列表（最多50条）
    """
    word = request.args.get('word', '').strip().lower()
    
    if not word:
        return error_response('请提供要查询的单词', 400)
    
    # 按需查询例句，不占用内存
    examples = find_examples_for_word(word)
    
    return success_response(data=examples)


@app.route('/api/words/batch', methods=['POST'])
@handle_exception
def get_words_batch():
    """
    批量查询单词详情
    参数: words - 单词列表 JSON
    返回: 所有单词的详细信息
    """
    words = get_request_param('words', [])
    
    if not words:
        return error_response('请提供单词列表')
    
    word_data_list = []
    
    for word in words:
        # 查询单词基本信息
        word_info = query_both_dicts(word)
        # 查询单词增强信息
        enhanced_info = get_word_enhanced_info(word)
        
        word_data_list.append({
            'word': word,
            'info': word_info,
            'enhanced': enhanced_info
        })
    
    return success_response(data=word_data_list)


@app.route('/api/audio/<accent>/<path:word>.mp3')
@handle_exception
def get_audio(accent, word):
    """
    提供发音文件
    参数: accent - 口音类型 (uk 或 us)
         word - 单词（使用 path 转换器，可以包含空格）
    返回: MP3音频文件
    """
    if not validate_accent(accent):
        return error_response('口音类型必须是 uk 或 us', 400)
    
    file_path, filename = get_audio_path(word, accent)
    
    if os.path.exists(file_path):
        return send_from_directory(PRONUNCIATIONS_DIR, filename, mimetype='audio/mpeg')
    else:
        return error_response(f'未找到发音文件: {filename}', 404)


@app.route('/api/enhanced', methods=['GET'])
@handle_exception
def get_enhanced_info():
    """
    获取单词的增强信息（词干、词根、形近词）
    参数: word - 要查询的单词
    返回: 单词的增强信息
    """
    word = request.args.get('word', '').strip()
    
    if not word:
        return error_response('请提供要查询的单词', 400)
    
    # 直接返回，不做任何过滤！让程序先能用！
    enhanced_info = get_word_enhanced_info(word)
    
    return success_response(data=enhanced_info)


@app.route('/api/audio/generate', methods=['POST'])
@handle_exception
def generate_audio():
    """
    生成发音文件
    参数:
        - text: 要生成发音的文本
        - accent: 口音类型 (uk 或 us，默认 us)
        - force_regenerate: 是否强制重新生成 (true/false，默认 false)
    返回: 生成的发音文件路径和状态
    """
    text = str(get_request_param('text', '')).strip()
    accent = str(get_request_param('accent', 'us')).lower()
    force_regenerate = str(get_request_param('force_regenerate', 'false')).lower() == 'true'
    
    print(f"生成发音请求: text={text}, accent={accent}")
    
    if not text:
        return error_response('请提供要生成发音的文本')
    
    if accent not in ['uk', 'us']:
        return error_response('口音类型必须是 uk 或 us')
    
    tts = get_tts()
    filepath = tts.get_pronunciation(text, accent, force_regenerate)
    
    print(f"发音文件路径: {filepath}")
    
    if filepath:
        filename = os.path.basename(filepath)
        is_permanent = PRONUNCIATIONS_DIR in filepath
        return success_response(filename=filename, filepath=filepath, accent=accent, is_permanent=is_permanent)
    else:
        return error_response('生成发音失败', 500)


@app.route('/api/translate', methods=['POST'])
@handle_exception
def translate_text():
    """
    翻译文本
    参数:
        - text: 要翻译的文本
    返回: 翻译结果
    """
    text = get_request_param('text', '').strip()
    
    print(f"[翻译API] 收到请求, text='{text}'")
    
    if not text:
        return error_response('请提供要翻译的文本')
    
    cache_key = f"translate_{text}"
    
    if cache_key in translation_cache:
        return success_response(translation=translation_cache[cache_key], cached=True)
    
    # 判断是不是句子（包含空格且单词数超过1个）
    words = text.strip().split()
    is_sentence = len([w for w in words if w]) > 1
    
    if is_sentence:
        # 是句子，直接使用腾讯云翻译API
        tts = get_tts()
        translation = tts.translate(text)
        if not translation or translation == text:
            translation = text  # 翻译失败返回原文
    else:
        # 是单词，先查词典
        result = query_both_dicts(text)
        if result and result.get('translation'):
            translation = result['translation']
        else:
            # 词典没有，使用腾讯云翻译API
            tts = get_tts()
            translation = tts.translate(text)
            if not translation or translation == text:
                translation = text  # 翻译失败返回原文
    
    translation_cache[cache_key] = translation
    save_translation_cache()
    
    return success_response(translation=translation, cached=False)


@app.route('/api/network/test', methods=['GET'])
@handle_exception
def test_network():
    """
    测试网络连接
    返回: 网络状态
    """
    tts = get_tts()
    is_online = tts.test_network()
    return success_response(online=is_online)


@app.route('/api/wordbook/export', methods=['POST'])
@handle_exception
def export_wordbook():
    """
    导出单词本
    参数:
        - name: 单词本名称
    返回: 单词本内容（带释义）
    """
    wordbook_name = get_request_param('name', '')
    
    if not wordbook_name:
        return error_response('请提供单词本名称')
    
    wordbooks = load_wordbooks()
    if wordbook_name not in wordbooks:
        return error_response('单词本不存在', 404)
    
    words = wordbooks[wordbook_name]
    export_lines = []
    
    for word in words:
        result = query_both_dicts(word)
        line = word
        if result and result.get('translation'):
            line += f" | {result['translation']}"
        if result and result.get('phonetic'):
            line += f" | [{result['phonetic']}]"
        export_lines.append(line)
    
    content = '\n'.join(export_lines)
    
    return success_response(filename=f"{wordbook_name}_单词本.txt", content=content)


def extract_words_from_docx(file_content):
    """
    从docx文件中提取单词
    参数:
        - file_content: 文件内容字节
    返回:
        - 单词列表
    """
    try:
        if not DOCX_AVAILABLE:
            raise ImportError("python-docx 未安装")
        
        doc = Document(BytesIO(file_content))
        words = []
        
        # 提取所有段落文本
        for para in doc.paragraphs:
            text = para.text.strip()
            if text:
                words.extend(extract_words_from_text(text))
        
        # 提取表格内容
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    text = cell.text.strip()
                    if text:
                        words.extend(extract_words_from_text(text))
        
        return words
    except Exception as e:
        print(f"解析docx文件失败: {e}")
        traceback.print_exc()
        raise


def extract_words_from_txt(file_content, encoding='utf-8'):
    """
    从txt文件中提取单词
    参数:
        - file_content: 文件内容字节
        - encoding: 编码格式
    返回:
        - 单词列表
    """
    try:
        try:
            text = file_content.decode(encoding)
        except UnicodeDecodeError:
            try:
                text = file_content.decode('gbk')
            except UnicodeDecodeError:
                text = file_content.decode('latin-1')
        
        return extract_words_from_text(text)
    except Exception as e:
        print(f"解析txt文件失败: {e}")
        raise


@app.route('/api/wordbook/import', methods=['POST'])
@handle_exception
def import_wordbook():
    """
    导入单词本
    参数:
        - name: 目标单词本名称
        - words: 单词列表（一行一个）（可选）
        - file: 文件（可选，支持.txt和.docx）
    返回: 导入结果
    """
    wordbook_name = None
    raw_words = None
    file_content = None
    filename = None
    
    # 先检查是否有文件上传
    if request.files and 'file' in request.files:
        file = request.files['file']
        if file.filename:
            filename = file.filename
            file_content = file.read()
    
    # 获取其他参数
    wordbook_name = get_request_param('name', '')
    raw_words = get_request_param('words', '')
    
    # 优先从文件中解析单词
    word_list = []
    
    if file_content and filename:
        ext = os.path.splitext(filename.lower())[1]
        
        if ext == '.docx':
            try:
                word_list = extract_words_from_docx(file_content)
            except ImportError:
                return error_response('需要安装python-docx库才能导入.docx文件。请运行: pip install python-docx')
            except Exception as e:
                return error_response(f'解析.docx文件失败: {str(e)}')
        elif ext == '.txt':
            try:
                word_list = extract_words_from_txt(file_content)
            except Exception as e:
                return error_response(f'解析.txt文件失败: {str(e)}')
        else:
            return error_response(f'不支持的文件格式: {ext}。仅支持.txt和.docx文件。')
    elif raw_words:
        # 从文本中解析单词
        word_list = [w.strip() for w in raw_words.split('\n') if w.strip()]
    
    if not wordbook_name:
        return error_response('请提供单词本名称')
    
    if not word_list:
        return error_response('未找到任何单词，请检查文件内容')
    
    success_words = []
    failed_words = []
    duplicated_words = []
    word_count = 0
    phrase_count = 0
    
    wordbooks = load_wordbooks()
    
    if wordbook_name not in wordbooks:
        wordbooks[wordbook_name] = []
    
    # 获取已有单词的词干
    existing_lemmas = set()
    _lemma_db = load_lemma_db()
    for w in wordbooks[wordbook_name]:
        existing_lemma = get_lemma(w, _lemma_db)
        existing_lemmas.add(existing_lemma.lower())
    
    # 去重后的单词列表（按词干）
    seen_lemmas = set()
    unique_word_list = []
    
    for word in word_list:
        if ' ' in word:
            # 短语保持原样
            unique_word_list.append(word)
        else:
            # 单词转首字母小写，其余保持不变
            normalized_word = normalize_word(word)
            lemma = get_lemma(word, _lemma_db)
            lemma_lower = lemma.lower()
            if lemma_lower not in seen_lemmas:
                seen_lemmas.add(lemma_lower)
                unique_word_list.append(normalized_word)
    
    for word in unique_word_list:
        if ' ' in word:
            phrase_count += 1
        else:
            word_count += 1
        
        try:
            # 尝试查词，验证有效性
            result = query_both_dicts(word)
            
            # 检查词干是否已存在
            if ' ' in word:
                # 短语直接检查是否重复（不区分大小写）
                word_lower = word.lower()
                exists = any(w.lower() == word_lower for w in wordbooks[wordbook_name])
                if not exists:
                    wordbooks[wordbook_name].append(word)
                    success_words.append(word)
                else:
                    duplicated_words.append(word)
            else:
                lemma = get_lemma(word, _lemma_db)
                if lemma.lower() not in existing_lemmas:
                    wordbooks[wordbook_name].append(word)
                    success_words.append(word)
                    existing_lemmas.add(lemma.lower())
                else:
                    duplicated_words.append(word)
            
        except Exception as e:
            failed_words.append(word)
    
    save_wordbooks(wordbooks)
    
    return success_response(
        total=len(word_list),
        word_count=word_count,
        phrase_count=phrase_count,
        success_count=len(success_words),
        failed_count=len(failed_words),
        duplicated_count=len(duplicated_words),
        success_words=success_words,
        failed_words=failed_words,
        duplicated_words=duplicated_words
    )


@app.route('/api/audio/cache/<accent>/<path:word>.mp3')
@handle_exception
def get_cache_audio(accent, word):
    """
    获取缓存中的发音文件
    """
    if not validate_accent(accent):
        return error_response('口音类型必须是 uk 或 us', 400)
    
    cache_path, filename = get_cache_audio_path(word, accent)
    
    if os.path.exists(cache_path):
        cache_audio_dir = os.path.join(CACHE_DIR, 'audio')
        return send_from_directory(cache_audio_dir, filename, mimetype='audio/mpeg')
    
    perm_path, perm_filename = get_audio_path(word, accent)
    if os.path.exists(perm_path):
        return send_from_directory(PRONUNCIATIONS_DIR, perm_filename, mimetype='audio/mpeg')
    
    return error_response('未找到发音文件', 404)


@app.route('/api/cache/clear', methods=['POST'])
@handle_exception
def clear_cache():
    """
    清除所有缓存：
    - 翻译缓存
    - 音频缓存目录
    """
    import shutil
    
    cleared_items = []
    
    # 1. 清除翻译缓存内存和文件
    global translation_cache
    translation_cache = {}
    if os.path.exists(translation_cache_file):
        os.remove(translation_cache_file)
        cleared_items.append('翻译缓存文件')
    
    # 2. 清除音频缓存目录
    audio_cache_dir = os.path.join(CACHE_DIR, 'audio')
    if os.path.exists(audio_cache_dir):
        shutil.rmtree(audio_cache_dir)
        os.makedirs(audio_cache_dir)  # 重新创建空目录
        cleared_items.append('音频缓存目录')
    
    # 3. 重新保存空的翻译缓存
    save_translation_cache()
    
    return success_response(
        message=f'缓存清除成功！已清除: {", ".join(cleared_items)}',
        cleared_items=cleared_items
    )


if __name__ == '__main__':
    # 检查数据文件
    if not check_data_files():
        sys.exit(1)
    
    print()
    print("=" * 60)
    print("=== 拾词 Flask Server Starting ===")
    print(f"Static directory: {os.path.abspath(STATIC_DIR)}")
    print(f"Pronunciations directory: {os.path.abspath(PRONUNCIATIONS_DIR)}")
    print(f"Cache directory: {os.path.abspath(CACHE_DIR)}")
    print("=" * 60)
    print()
    print("✅ 所有数据库初始化完成！正在打开浏览器...")
    print()
    
    # 延迟1秒后自动打开浏览器
    Timer(1.0, open_browser).start()
    
    # 启动Flask服务器（禁用调试模式以避免自动重载问题）
    app.run(debug=False, host='0.0.0.0', port=5000)