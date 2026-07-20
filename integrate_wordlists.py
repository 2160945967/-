#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 question_banks 中的词库文件集成到 stardict.csv 中
使用流式处理避免内存溢出
"""

import os
import re
import csv
from pathlib import Path
from collections import defaultdict

# 词库文件路径
WORDLIST_DIR = Path(r"d:\学习\英语\程序\拾词 - electron\question_banks\github_mahavivo_english-wordlists\english-wordlists-master")
STARDICT_CSV = Path(r"d:\学习\英语\程序\拾词 - electron\stardict.csv")
STARDICT_CSV_NEW = Path(r"d:\学习\英语\程序\拾词 - electron\stardict_new.csv")

# 词库配置：标签 -> (文件名, 解析函数)
WORDLIST_CONFIG = {
    # 已有标签（更新）
    'xx': ('小学英语大纲词汇.txt', 'parse_simple_list'),
    'zk': ('中考英语词汇表.txt', 'parse_with_phonetic'),
    'gk': ('Highschool_edited.txt', 'parse_simple_list'),
    'cet4': ('CET4_edited.txt', 'parse_with_phonetic'),
    'cet6': ('CET6_edited.txt', 'parse_with_phonetic'),
    'ky': ('NPEE_Wordlist.txt', 'parse_simple_list'),
    'toefl': ('TOEFL.txt', 'parse_with_phonetic'),
    'gre': ('GRE_8000_Words.txt', 'parse_with_phonetic'),
    
    # 新增标签
    'coca20000': ('COCA_20000.txt', 'parse_simple_list'),
    'coca_abridged': ('COCA_abridged.txt', 'parse_with_phonetic'),
    'oald8': ('OALD8_abridged_edited.txt', 'parse_with_phonetic'),
    'tem4': ('英语专业四八级词汇表.txt', 'parse_tem4'),
    'tem8': ('英语专业四八级词汇表.txt', 'parse_tem8'),
    'tem8_star': ('英语专业星标八级词汇.txt', 'parse_with_phonetic'),
    'tw_hs': ('台灣高中英文參考詞彙表.txt', 'parse_with_phonetic'),
    'cet6_star': ('英语六级词汇（星标，1726）.txt', 'parse_simple_list'),
    'gre_hongbao': ('红宝书 GRE词汇精选.csv', 'parse_gre_csv'),
}


def read_file_with_encoding(filepath):
    """尝试多种编码读取文件"""
    encodings = ['utf-8', 'gbk', 'gb2312', 'big5', 'utf-16', 'latin1']
    for enc in encodings:
        try:
            with open(filepath, 'r', encoding=enc) as f:
                return f.read()
        except (UnicodeDecodeError, UnicodeError):
            continue
    return None


def parse_simple_list(filepath):
    """解析纯单词列表（每行一个单词）"""
    words = set()
    content = read_file_with_encoding(filepath)
    if not content:
        return words
    
    for line in content.split('\n'):
        line = line.strip()
        if line and not line.startswith('#'):
            # 提取单词（去除数字序号等）
            match = re.match(r'^\d+[\.\s]+(.+)$', line)
            if match:
                word = match.group(1).strip()
            else:
                word = line
            
            # 清理单词
            word = word.lower().strip()
            if word and len(word) > 1 and not word.startswith('('):
                words.add(word)
    return words


def parse_with_phonetic(filepath):
    """解析带音标的词库（格式：单词 [音标] 词性.释义）"""
    words = set()
    
    content = read_file_with_encoding(filepath)
    if content is None:
        print(f"  警告：无法解析文件编码 {filepath}")
        return words
    
    for line in content.split('\n'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        
        # 匹配格式：单词 [音标] 或 单词 音标
        match = re.match(r'^([a-zA-Z\s\-\'\.]+?)[\s\[]', line)
        if match:
            word = match.group(1).strip().lower()
            if word and len(word) > 1:
                words.add(word)
    
    return words


def parse_tem4(filepath):
    """解析专四词汇（英语专业四八级词汇表.txt）"""
    words = set()
    content = read_file_with_encoding(filepath)
    if not content:
        return words

    # 整个文件都是专四/专八混合，提取所有单词
    for line in content.split('\n'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        # 匹配格式：*单词 [音标] 或 单词 [音标]
        match = re.match(r'^\*?([a-zA-Z][a-zA-Z\s\-\'\.]*?)[\s\[\(]', line)
        if match:
            word = match.group(1).strip().lower()
            if word and len(word) > 1:
                words.add(word)

    return words


def parse_tem8(filepath):
    """解析专八词汇（使用英语专业星标八级词汇.txt）"""
    tem8_star_file = WORDLIST_DIR / '英语专业星标八级词汇.txt'
    return parse_with_phonetic(tem8_star_file)


def parse_gre_csv(filepath):
    """解析 GRE 红宝书 CSV 文件"""
    words = set()
    try:
        with open(filepath, 'r', encoding='gbk', errors='ignore') as f:
            reader = csv.reader(f)
            for row in reader:
                if row and len(row) > 0:
                    word = row[0].strip().lower()
                    if word and len(word) > 1:
                        words.add(word)
    except Exception as e:
        print(f"  警告：解析 {filepath} 失败：{e}")
    
    return words


def load_wordlists():
    """加载所有词库文件，返回 {tag: set(words)}"""
    print("=" * 60)
    print("第一步：加载所有词库文件")
    print("=" * 60)
    
    tag_to_words = {}
    
    for tag, (filename, parser_name) in WORDLIST_CONFIG.items():
        filepath = WORDLIST_DIR / filename
        
        if not filepath.exists():
            print(f"\n[{tag}] 跳过：文件不存在 {filename}")
            continue
        
        print(f"\n[{tag}] 处理 {filename} (解析器：{parser_name})...")
        
        # 解析单词
        parser = globals()[parser_name]
        words = parser(filepath)
        print(f"  提取到 {len(words)} 个单词")
        
        tag_to_words[tag] = words
    
    return tag_to_words


def update_stardict_csv(tag_to_words):
    """流式更新 stardict.csv"""
    print("\n" + "=" * 60)
    print("第二步：流式更新 stardict.csv")
    print("=" * 60)
    
    # 创建单词到标签的映射
    word_to_tags = defaultdict(set)
    for tag, words in tag_to_words.items():
        for word in words:
            word_to_tags[word].add(tag)
    
    print(f"共 {len(word_to_tags)} 个单词需要更新标签")
    
    # 流式处理 CSV
    print("开始处理 stardict.csv（这可能需要几分钟）...")
    
    processed_count = 0
    updated_count = 0
    
    with open(STARDICT_CSV, 'r', encoding='utf-8') as fin, \
         open(STARDICT_CSV_NEW, 'w', encoding='utf-8', newline='') as fout:
        
        reader = csv.DictReader(fin)
        fieldnames = reader.fieldnames
        writer = csv.DictWriter(fout, fieldnames=fieldnames)
        writer.writeheader()
        
        for row in reader:
            word = row['word'].strip().lower()
            
            if word in word_to_tags:
                # 更新标签
                existing_tags = set(row.get('tag', '').split())
                new_tags = word_to_tags[word]
                merged_tags = existing_tags | new_tags
                row['tag'] = ' '.join(sorted(merged_tags))
                updated_count += 1
            
            writer.writerow(row)
            processed_count += 1
            
            if processed_count % 100000 == 0:
                print(f"  已处理 {processed_count} 个单词，更新了 {updated_count} 个...")
    
    print(f"处理完成：共 {processed_count} 个单词，更新了 {updated_count} 个")
    
    # 替换原文件
    print("替换原文件...")
    os.replace(STARDICT_CSV_NEW, STARDICT_CSV)
    print("替换完成")


def print_statistics(tag_to_words):
    """输出统计信息"""
    print("\n" + "=" * 60)
    print("统计信息：")
    print("=" * 60)
    print(f"{'标签':<15} {'词库单词数':<12}")
    print("-" * 60)
    
    total_words = 0
    for tag, words in sorted(tag_to_words.items()):
        print(f"{tag:<15} {len(words):<12}")
        total_words += len(words)
    
    print("-" * 60)
    print(f"{'总计':<15} {total_words:<12}")


if __name__ == '__main__':
    # 加载词库
    tag_to_words = load_wordlists()
    
    # 输出统计
    print_statistics(tag_to_words)
    
    # 更新 CSV
    update_stardict_csv(tag_to_words)
    
    print("\n" + "=" * 60)
    print("集成完成！")
    print("=" * 60)
