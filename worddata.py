#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
词干、词根、形近词数据处理模块
"""

import json
import os

# 获取模块所在目录
_MODULE_DIR = os.path.dirname(os.path.abspath(__file__))


def _get_data_filepath(filename):
    """获取数据文件的绝对路径"""
    return os.path.join(_MODULE_DIR, filename)


class LemmaDB:
    """词干数据库"""
    
    def __init__(self, filepath=None):
        if filepath is None:
            filepath = _get_data_filepath('lemma.en.txt')
        self.filepath = filepath
        self.lemma_map = {}  # 词形 -> 词干
        self.inflections = {}  # 词干 -> 词形列表
        self._load()
    
    def _load(self):
        """加载词干数据库"""
        if not os.path.exists(self.filepath):
            print(f"Warning: {self.filepath} not found")
            return
        
        with open(self.filepath, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith(';'):
                    continue
                
                if '->' in line:
                    parts = line.split('->', 1)
                    lemma_part = parts[0].strip()
                    inflection_part = parts[1].strip()
                    
                    # 提取词干和词频
                    if '/' in lemma_part:
                        lemma, _ = lemma_part.split('/', 1)
                    else:
                        lemma = lemma_part
                    
                    lemma = lemma.lower()
                    
                    # 提取词形变化列表
                    inflections = [w.strip().lower() for w in inflection_part.split(',') if w.strip()]
                    
                    # 存储词干 -> 词形列表
                    self.inflections[lemma] = inflections
                    
                    # 存储词形 -> 词干
                    for w in inflections:
                        self.lemma_map[w] = lemma
                    # 词干本身也指向自己
                    self.lemma_map[lemma] = lemma
    
    def get_lemma(self, word):
        """获取单词的词干"""
        return self.lemma_map.get(word.lower())
    
    def get_inflections(self, lemma):
        """获取词干的所有词形变化
        参数:
            lemma: 词干
        """
        return self.inflections.get(lemma.lower(), [])
    
    def find_related_forms(self, word):
        """查找单词的所有相关词形（包括词干和所有变体）
        参数:
            word: 查询单词
        """
        word_lower = word.lower()
        lemma = self.get_lemma(word_lower)
        if lemma:
            forms = self.get_inflections(lemma)
            # 确保词干也在列表中
            if lemma not in forms:
                forms.insert(0, lemma)
            # 移除查询词本身的重复
            forms = [w for w in forms if w != word_lower]
            return forms
        return []


class WordRootDB:
    """词根数据库"""
    
    def __init__(self, filepath=None):
        if filepath is None:
            filepath = _get_data_filepath('wordroot.txt')
        self.filepath = filepath
        self.root_data = {}  # 词根/词缀 -> 详细信息
        self.word_to_roots = {}  # 单词 -> 相关词根列表
        self._load()
    
    def _load(self):
        """加载词根数据库"""
        if not os.path.exists(self.filepath):
            print(f"Warning: {self.filepath} not found")
            return
        
        try:
            with open(self.filepath, 'r', encoding='utf-8') as f:
                content = f.read()
                # 尝试解析JSON
                self.root_data = json.loads(content)
                
                # 构建单词到词根的反向索引
                for root, info in self.root_data.items():
                    if 'example' in info:
                        for word in info['example']:
                            word_lower = word.lower()
                            if word_lower not in self.word_to_roots:
                                self.word_to_roots[word_lower] = []
                            self.word_to_roots[word_lower].append(root)
        except Exception as e:
            print(f"Error loading wordroot.txt: {e}")
    
    def get_roots_for_word(self, word):
        """获取单词相关的词根"""
        return self.word_to_roots.get(word.lower(), [])
    
    def get_root_info(self, root):
        """获取词根的详细信息"""
        return self.root_data.get(root)


class ResembleDB:
    """形近词/同义词数据库"""
    
    def __init__(self, filepath=None):
        if filepath is None:
            filepath = _get_data_filepath('resemble.txt')
        self.filepath = filepath
        self.groups = []  # 所有词组
        self.word_to_groups = {}  # 单词(小写) -> 所属词组列表
        self.word_variants = {}  # 单词(小写) -> 原始大小写单词列表
        self._load()
    
    def _load(self):
        """加载形近词数据库"""
        if not os.path.exists(self.filepath):
            print(f"Warning: {self.filepath} not found")
            return
        
        current_group = None
        
        with open(self.filepath, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                
                if line.startswith('%'):
                    # 新词组开始
                    if current_group:
                        self.groups.append(current_group)
                    
                    words_str = line[1:].strip()
                    # 保持单词原始大小写
                    words = [w.strip() for w in words_str.split(',') if w.strip()]
                    current_group = {
                        'words': words,
                        'explanation': []
                    }
                    
                    # 为每个单词建立索引（小写索引，保存原始大小写）
                    for word in words:
                        word_lower = word.lower()
                        if word_lower not in self.word_to_groups:
                            self.word_to_groups[word_lower] = []
                        self.word_to_groups[word_lower].append(len(self.groups))
                        
                        # 保存原始大小写的单词变体
                        if word_lower not in self.word_variants:
                            self.word_variants[word_lower] = set()
                        self.word_variants[word_lower].add(word)
                
                elif current_group and line:
                    # 添加到当前词组的说明
                    current_group['explanation'].append(line)
            
            # 添加最后一个词组
            if current_group:
                self.groups.append(current_group)
    
    def get_similar_words(self, word):
        """获取单词的形近词/同义词
        参数:
            word: 查询单词
        """
        word_lower = word.lower()
        group_indices = self.word_to_groups.get(word_lower, [])
        
        similar_words = []
        for idx in group_indices:
            if idx < len(self.groups):
                group = self.groups[idx]
                # 排除当前单词本身，精确匹配大小写
                others = [w for w in group['words'] if w != word]
                similar_words.extend(others)
        
        # 去重
        return list(set(similar_words))
    
    def get_group_info(self, word):
        """获取单词所属的词组详细信息
        参数:
            word: 查询单词
        """
        word_lower = word.lower()
        group_indices = self.word_to_groups.get(word_lower, [])
        
        results = []
        for idx in group_indices:
            if idx < len(self.groups):
                group = self.groups[idx].copy()
                results.append(group)
        
        return results


# 单例实例
_lemma_db = None
_wordroot_db = None
_resemble_db = None


def get_lemma_db():
    global _lemma_db
    if _lemma_db is None:
        _lemma_db = LemmaDB()
    return _lemma_db


def get_wordroot_db():
    global _wordroot_db
    if _wordroot_db is None:
        _wordroot_db = WordRootDB()
    return _wordroot_db


def get_resemble_db():
    global _resemble_db
    if _resemble_db is None:
        _resemble_db = ResembleDB()
    return _resemble_db


def get_word_enhanced_info(word):
    """获取单词的增强信息（词干、词根、形近词）
    参数:
        word: 查询单词
    """
    lemma_db = get_lemma_db()
    wordroot_db = get_wordroot_db()
    resemble_db = get_resemble_db()
    
    word_lower = word.lower()
    
    info = {
        'word': word,
        'lemma': lemma_db.get_lemma(word_lower),
        'related_forms': lemma_db.find_related_forms(word),
        'roots': [],
        'similar_words': resemble_db.get_similar_words(word),
        'resemble_groups': resemble_db.get_group_info(word)
    }
    
    # 获取词根详细信息
    roots = wordroot_db.get_roots_for_word(word_lower)
    for root in roots:
        root_info = wordroot_db.get_root_info(root)
        if root_info:
            info['roots'].append({
                'root': root,
                'info': root_info
            })
    
    return info
