import csv
import json
import os
import re
import shutil
import time
from collections import defaultdict

ROOT_DIR = r"d:\学习\英语\程序\拾词 - electron"
STARDICT_PATH = os.path.join(ROOT_DIR, "stardict.csv")
BACKUP_PATH = os.path.join(ROOT_DIR, f"stardict_backup_{time.strftime('%Y%m%d_%H%M%S')}.csv")
QUESTION_BANKS_DIR = os.path.join(ROOT_DIR, "question_banks")

# ============================================================
# 字段定义（与 stardict.csv 保持一致）
# ============================================================
FIELDS = ["word", "phonetic", "definition", "translation", "pos", "collins", "oxford", "tag", "bnc", "frq", "exchange", "detail", "audio"]

# ============================================================
# 工具函数
# ============================================================
def normalize_word(word):
    """标准化单词用于去重"""
    if not word:
        return ""
    return str(word).strip().lower()

def safe_str(value):
    if value is None:
        return ""
    return str(value).strip()

def extract_tag_from_filename(filename):
    """从文件名提取考试标签"""
    name = os.path.splitext(filename)[0].upper()
    tags = []
    
    # CET
    if re.search(r'CET[_-]?4|4-?CET|四级|Level4', name):
        tags.append('cet4')
    if re.search(r'CET[_-]?6|6-?CET|六级|Level6|Level8', name):
        tags.append('cet6')
    if re.search(r'大学四级', name):
        tags.append('cet4')
    if re.search(r'大学六级', name):
        tags.append('cet6')
    
    # 考研
    if re.search(r'考研|KAOYAN|NPEE|研究生', name):
        tags.append('ky')
    
    # 中高考
    if re.search(r'中考|初中|CHUZHONG|PEPCHUZHONG', name):
        tags.append('zk')
    if re.search(r'高考|高中|GAOZHONG|PEPGAOZHONG|BEISHIGAOZHONG', name):
        tags.append('gk')
    
    # 小学
    if re.search(r'小学|PEPXIAOXUE', name):
        tags.append('primary')
    
    # 出国留学
    if re.search(r'TOEFL|托福', name):
        tags.append('toefl')
    if re.search(r'IELTS|雅思', name):
        tags.append('ielts')
    if re.search(r'SAT', name):
        tags.append('sat')
    if re.search(r'GRE', name):
        tags.append('gre')
    if re.search(r'GMAT', name):
        tags.append('gmat')
    
    # 其他
    if re.search(r'BEC', name):
        tags.append('bec')
    if re.search(r'专四|专八|TEM', name):
        tags.append('tem')
    if re.search(r'COCA', name):
        tags.append('coca')
    if re.search(r'OALD', name):
        tags.append('oald')
    
    return ' '.join(tags)

def parse_pos_from_translations(translations):
    """从 translations 数组提取词性"""
    pos_list = []
    for t in translations:
        if isinstance(t, dict):
            pos = safe_str(t.get('type', ''))
            if pos and pos not in pos_list:
                pos_list.append(pos)
    return ' '.join(pos_list)

def parse_translation_from_translations(translations):
    """从 translations 数组提取中文翻译"""
    trans_list = []
    for t in translations:
        if isinstance(t, dict):
            trans = safe_str(t.get('translation', ''))
            if trans and trans not in trans_list:
                trans_list.append(trans)
    return '；'.join(trans_list)

def parse_phrases(phrases):
    """提取词组到 detail"""
    if not phrases:
        return ""
    phrase_list = []
    for p in phrases:
        if isinstance(p, dict):
            phrase = safe_str(p.get('phrase', ''))
            trans = safe_str(p.get('translation', ''))
            if phrase:
                phrase_list.append(f"{phrase}: {trans}" if trans else phrase)
    return '\n'.join(phrase_list)

def merge_detail(existing_detail, new_detail):
    """合并 detail 字段，避免重复"""
    if not new_detail:
        return existing_detail
    if not existing_detail:
        return new_detail
    if new_detail in existing_detail:
        return existing_detail
    return existing_detail + "\n" + new_detail

def merge_translation(existing_trans, new_trans):
    """合并中文翻译，避免重复"""
    if not new_trans:
        return existing_trans
    if not existing_trans:
        return new_trans
    existing_parts = [p.strip() for p in existing_trans.split('；') if p.strip()]
    new_parts = [p.strip() for p in new_trans.split('；') if p.strip()]
    for p in new_parts:
        if p not in existing_parts:
            existing_parts.append(p)
    return '；'.join(existing_parts)

def merge_pos(existing_pos, new_pos):
    """合并词性字段"""
    if not new_pos:
        return existing_pos
    if not existing_pos:
        return new_pos
    existing_parts = [p.strip() for p in existing_pos.split(' ') if p.strip()]
    new_parts = [p.strip() for p in new_pos.split(' ') if p.strip()]
    for p in new_parts:
        if p not in existing_parts:
            existing_parts.append(p)
    return ' '.join(existing_parts)

def merge_tag(existing_tag, new_tag):
    """合并标签字段"""
    if not new_tag:
        return existing_tag
    if not existing_tag:
        return new_tag
    existing_parts = [p.strip() for p in existing_tag.split(' ') if p.strip()]
    new_parts = [p.strip() for p in new_tag.split(' ') if p.strip()]
    for p in new_parts:
        if p not in existing_parts:
            existing_parts.append(p)
    return ' '.join(existing_parts)

def merge_word_records(existing, new_record):
    """合并两条单词记录，新记录补充缺失字段"""
    result = dict(existing)
    for field in FIELDS:
        old_val = safe_str(existing.get(field, ''))
        new_val = safe_str(new_record.get(field, ''))
        
        if field == 'translation':
            result[field] = merge_translation(old_val, new_val)
        elif field == 'pos':
            result[field] = merge_pos(old_val, new_val)
        elif field == 'tag':
            result[field] = merge_tag(old_val, new_val)
        elif field == 'detail':
            result[field] = merge_detail(old_val, new_val)
        elif field in ['collins', 'oxford', 'bnc', 'frq']:
            # 数字字段，保留已有值或取新值
            if old_val:
                try:
                    result[field] = int(float(old_val))
                except:
                    result[field] = ''
            elif new_val:
                try:
                    result[field] = int(float(new_val))
                except:
                    result[field] = ''
            else:
                result[field] = ''
        else:
            # 其他字段：如果旧值存在则保留，否则用新值
            result[field] = old_val if old_val else new_val
    return result

# ============================================================
# 1. 备份并读取现有 stardict.csv
# ============================================================
print("=" * 60)
print("开始整合词库到 stardict.csv")
print("=" * 60)

words_dict = {}
existing_count = 0

if os.path.exists(STARDICT_PATH):
    print(f"\n[1/5] 备份现有 stardict.csv -> {os.path.basename(BACKUP_PATH)}")
    shutil.copy2(STARDICT_PATH, BACKUP_PATH)
    
    print("[2/5] 读取现有 stardict.csv...")
    with open(STARDICT_PATH, 'r', encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            word = safe_str(row.get('word', ''))
            if not word:
                continue
            key = normalize_word(word)
            if key not in words_dict:
                record = {field: safe_str(row.get(field, '')) for field in FIELDS}
                words_dict[key] = record
                existing_count += 1
    print(f"  现有词条: {existing_count}")
else:
    print(f"  警告: 未找到 {STARDICT_PATH}")

# ============================================================
# 2. 读取 KyleBing 词库
# ============================================================
print("\n[3/5] 读取 KyleBing/english-vocabulary 词库...")
kylebing_dir = os.path.join(QUESTION_BANKS_DIR, "github_KyleBing_english-vocabulary", "english-vocabulary-master", "json_original", "json-simple")
if not os.path.exists(kylebing_dir):
    kylebing_dir = os.path.join(QUESTION_BANKS_DIR, "github_KyleBing_english-vocabulary", "english-vocabulary-master", "json")

kylebing_count = 0
if os.path.exists(kylebing_dir):
    for filename in sorted(os.listdir(kylebing_dir)):
        if not filename.endswith('.json'):
            continue
        filepath = os.path.join(kylebing_dir, filename)
        tag = extract_tag_from_filename(filename)
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            if isinstance(data, list):
                for item in data:
                    if not isinstance(item, dict):
                        continue
                    word = safe_str(item.get('word', item.get('headWord', '')))
                    if not word:
                        continue
                    
                    translations = item.get('translations', [])
                    if not translations and 'content' in item:
                        # json-full 格式
                        content = item.get('content', {})
                        if isinstance(content, dict):
                            word_content = content.get('word', {})
                            if isinstance(word_content, dict):
                                word_inner = word_content.get('content', {})
                                if isinstance(word_inner, dict):
                                    trans = word_inner.get('trans', [])
                                    if isinstance(trans, list):
                                        translations = []
                                        for t in trans:
                                            if isinstance(t, dict):
                                                translations.append({
                                                    'translation': t.get('tranCn', ''),
                                                    'type': t.get('pos', '')
                                                })
                    
                    translation = parse_translation_from_translations(translations)
                    pos = parse_pos_from_translations(translations)
                    phrases = parse_phrases(item.get('phrases', []))
                    
                    key = normalize_word(word)
                    new_record = {
                        'word': word,
                        'phonetic': '',
                        'definition': '',
                        'translation': translation,
                        'pos': pos,
                        'collins': '',
                        'oxford': '',
                        'tag': tag,
                        'bnc': '',
                        'frq': '',
                        'exchange': '',
                        'detail': phrases,
                        'audio': ''
                    }
                    
                    if key in words_dict:
                        words_dict[key] = merge_word_records(words_dict[key], new_record)
                    else:
                        words_dict[key] = new_record
                        kylebing_count += 1
        except Exception as e:
            print(f"  读取失败 {filename}: {e}")

print(f"  新增 KyleBing 词条: {kylebing_count}")

# ============================================================
# 3. 读取 DictionaryByGPT4
# ============================================================
print("\n[4/5] 读取 DictionaryByGPT4...")
gpt4_path = os.path.join(QUESTION_BANKS_DIR, "github_Ceelog_DictionaryByGPT4", "DictionaryByGPT4-main", "gptwords.json")
gpt4_count = 0

if os.path.exists(gpt4_path):
    try:
        with open(gpt4_path, 'r', encoding='utf-8') as f:
            # 这个文件可能是每行一个 JSON
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                    if not isinstance(item, dict):
                        continue
                    word = safe_str(item.get('word', ''))
                    content = safe_str(item.get('content', ''))
                    if not word:
                        continue
                    
                    key = normalize_word(word)
                    new_record = {
                        'word': word,
                        'phonetic': '',
                        'definition': '',
                        'translation': '',
                        'pos': '',
                        'collins': '',
                        'oxford': '',
                        'tag': 'gpt4',
                        'bnc': '',
                        'frq': '',
                        'exchange': '',
                        'detail': content,
                        'audio': ''
                    }
                    
                    if key in words_dict:
                        words_dict[key] = merge_word_records(words_dict[key], new_record)
                    else:
                        words_dict[key] = new_record
                        gpt4_count += 1
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        print(f"  读取失败: {e}")

print(f"  新增 GPT4 词条: {gpt4_count}")

# ============================================================
# 4. 读取 mahavivo 词库
# ============================================================
print("\n[5/5] 读取 mahavivo/english-wordlists...")
mahavivo_dir = os.path.join(QUESTION_BANKS_DIR, "github_mahavivo_english-wordlists", "english-wordlists-master")
mahavivo_count = 0

if os.path.exists(mahavivo_dir):
    for filename in sorted(os.listdir(mahavivo_dir)):
        if not filename.endswith('.txt'):
            continue
        filepath = os.path.join(mahavivo_dir, filename)
        tag = extract_tag_from_filename(filename)
        
        # 跳过没有翻译的纯单词表
        no_translation_files = ['COCA_20000.txt', 'COCA_abridged.txt', 'SUM_of_cet4+6+toefl+gre.txt', 
                                '小学英语大纲词汇.txt', '六级词汇表.xlsx']
        if filename in no_translation_files:
            continue
        
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    
                    # 尝试多种格式解析
                    word = ''
                    translation = ''
                    pos = ''
                    
                    # 格式1: 单词,词性.翻译
                    if ',' in line and not line.startswith('the '):
                        parts = line.split(',', 1)
                        word = safe_str(parts[0])
                        rest = parts[1]
                        # 词性在翻译前
                        m = re.match(r'^([a-zA-Z]+\.\s*)(.+)$', rest)
                        if m:
                            pos = m.group(1).rstrip('. ')
                            translation = m.group(2).strip()
                        else:
                            translation = rest
                    else:
                        # 格式2: 单词 词性.翻译
                        m = re.match(r'^([a-zA-Z\s\-\'.]+?)\s+([a-zA-Z]+\.\s*.+)$', line)
                        if m:
                            word = safe_str(m.group(1))
                            rest = m.group(2)
                            m2 = re.match(r'^([a-zA-Z]+\.\s*)(.+)$', rest)
                            if m2:
                                pos = m2.group(1).rstrip('. ')
                                translation = m2.group(2).strip()
                            else:
                                translation = rest
                        else:
                            word = safe_str(line)
                    
                    if not word or len(word) > 64:
                        continue
                    
                    key = normalize_word(word)
                    new_record = {
                        'word': word,
                        'phonetic': '',
                        'definition': '',
                        'translation': translation,
                        'pos': pos,
                        'collins': '',
                        'oxford': '',
                        'tag': tag,
                        'bnc': '',
                        'frq': '',
                        'exchange': '',
                        'detail': '',
                        'audio': ''
                    }
                    
                    if key in words_dict:
                        words_dict[key] = merge_word_records(words_dict[key], new_record)
                    else:
                        words_dict[key] = new_record
                        mahavivo_count += 1
        except Exception as e:
            print(f"  读取失败 {filename}: {e}")

print(f"  新增 mahavivo 词条: {mahavivo_count}")

# ============================================================
# 5. 写入新的 stardict.csv
# ============================================================
print("\n" + "=" * 60)
print("写入新的 stardict.csv")
print("=" * 60)

total_count = len(words_dict)
print(f"  总词条数: {total_count}")

with open(STARDICT_PATH, 'w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=FIELDS)
    writer.writeheader()
    
    # 按单词字母顺序排序写入
    for key in sorted(words_dict.keys()):
        record = words_dict[key]
        writer.writerow(record)

print(f"  已保存到: {STARDICT_PATH}")
print(f"  备份文件: {BACKUP_PATH}")

# 统计
print("\n" + "=" * 60)
print("统计信息")
print("=" * 60)
print(f"  原 stardict.csv 词条: {existing_count}")
print(f"  新增 KyleBing 词条: {kylebing_count}")
print(f"  新增 GPT4 词条: {gpt4_count}")
print(f"  新增 mahavivo 词条: {mahavivo_count}")
print(f"  合并后总词条: {total_count}")
