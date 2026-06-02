#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re

def preprocess_word_for_tts(word):
    """
    智能预处理单词，用于TTS发音生成
    根据不同的括号格式采用不同的处理策略
    """
    if not word:
        return word
    
    processed = word.strip()
    
    # 策略1: 数字编号格式 - 去掉编号，保留核心词
    match = re.match(r'^\(\s*\d+\s*\)\s*(.+)$', processed)
    if match:
        processed = match.group(1).strip()
    
    # 特殊情况：对于 (Sp)-8-Br-cAMPS 这样的复杂化学术语，完全保留
    if processed.startswith('(Sp)-') or processed.startswith('(sp)-'):
        return processed
    
    # 策略2: 特殊情况 - 对于 (R)-loxiglumide 这样的格式，保留核心词 loxiglumide
    # 但对于后面跟着数字或连字符的复杂单词，如 (S)-4-PHENYL-2-OXAZOLIDINONE，保留完整
    match = re.match(r'^\(([A-Z])\)-([a-z]+)$', processed)
    if match:
        processed = match.group(2)
    
    # 策略3: 对于 (trans)-isomer 这样的格式，保留核心词 isomer
    match = re.match(r'^\(([a-z]+)\)-([a-z]+)$', processed, re.IGNORECASE)
    if match:
        processed = match.group(2)
    
    # 策略4: 对于 (1S)-(-)-Camphor 这样的复杂化学术语，保留核心词
    match = re.match(r'^\([0-9a-zA-Z-]+\)[-\s]*\([0-9a-zA-Z-]*\)[-\s]*([a-zA-Z]+)$', processed, re.IGNORECASE)
    if match:
        processed = match.group(1)
    
    # 策略5: 可选拼写格式 - 保留完整形式（包含可选字母）
    match = re.match(r'^\(([a-zA-Z])\)([a-zA-Z-]+)$', processed)
    if match:
        processed = match.group(1) + match.group(2)
    
    # 策略6: 去掉方括号的学科标记
    processed = re.sub(r'\[.*?\]\s*', '', processed)
    
    # 策略7: 去掉圆括号的分类/描述标记 - 只匹配完整单词和 of 短语
    # (african)、(of fish)、(of a silkworm)、(of livestock) 等
    match = re.match(r'^\(([a-z]{2,}(?:\s+of\s+[a-z\s]+)?)\)\s*(.+)$', processed, re.IGNORECASE)
    if match:
        processed = match.group(2).strip()
    
    # 策略8: 特殊处理一些常见的标记
    match = re.match(r'^\((actinic|arithmetic|basic|bee|burner|common|data|domestic|electromagnetic|european|feed|fish|hemispherical|hog|hva|impressio|input|lamp|lobus|luminescence|magnetic|mechanical|methylthio|montevideo|multi|musculus|myotomic|net|of|optical|pons|potash|processus|psychophysical|radiation|red-eye|resin|robaxin|rotary|sea|sin|solid|spring|storage|striped|sweetened|technical|total|traffic|ts|var|von|water|written|hazardous)\)\s*(.+)$', processed, re.IGNORECASE)
    if match:
        processed = match.group(2).strip()
    
    # 策略9: 去掉开头的撇号（如 'hood、'tween）
    if processed.startswith("'") and len(processed) > 1:
        if processed[1].isalpha():
            processed = processed[1:]
    
    # 策略10: 对于 (Robaxin)Methocarbamol 这样的商品名，保留核心词
    match = re.match(r'^\([A-Za-z]+\)([A-Za-z]+)$', processed)
    if match:
        processed = match.group(1)
    
    # 策略11: 对于 (4-ethoxyphenyl)methane 这样的格式，保留核心词 methane
    # 但对于 (tercyclohexan)yl 这样的，保留完整
    match = re.match(r'^\([0-9a-zA-Z-]+\)([a-zA-Z]+)$', processed)
    if match:
        if match.group(1) == 'yl':
            pass
        else:
            processed = match.group(1)
    
    # 特殊处理：对于 (tercyclohexan)yl 和 (terthiophen)yl 保留完整
    if '(tercyclohexan)yl' in word or '(terthiophen)yl' in word:
        processed = word
        processed = re.sub(r'^\(\s*\d+\s*\)\s*', '', processed)
    
    # 策略12: 对于 (6-4)PDs 这样的格式，保留核心词 PDs
    match = re.match(r'^\([0-9-]+\)([A-Za-z0-9]+)$', processed)
    if match:
        processed = match.group(1)
    
    return processed.strip()

def normalize_word_for_filename(word):
    """
    规范化单词，使其适合作为文件名
    只替换 Windows 文件系统不允许的字符，保留空格和撇号
    """
    if not word:
        return word
    
    normalized = word
    
    # 只替换 Windows 文件系统不允许的字符
    normalized = normalized.replace("/", "_")
    normalized = normalized.replace("\\", "_")
    normalized = normalized.replace(":", "_")
    normalized = normalized.replace("*", "_")
    normalized = normalized.replace("?", "_")
    normalized = normalized.replace("<", "_")
    normalized = normalized.replace(">", "_")
    normalized = normalized.replace("|", "_")
    normalized = normalized.replace("&", "_and_")
    
    # 保留空格和撇号，不替换
    
    return normalized


def get_pronunciation_filename(word, accent):
    """
    获取发音文件的文件名
    """
    normalized_word = normalize_word_for_filename(word)
    return f"{normalized_word}_{accent}.mp3"
