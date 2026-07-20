#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
调整文章51-100的答案分布，使ABCD各占约25%
"""

import re
import random
from collections import Counter

def parse_articles_51_100(content):
    """解析文章51-100的题目和答案"""
    # 找到文章51的起始位置
    article_51_match = re.search(r'## 文章 51\.', content)
    if not article_51_match:
        raise ValueError("找不到文章51")
    
    # 找到文章101的起始位置（文章100的结束）
    article_101_match = re.search(r'## 文章 101\.', content)
    if not article_101_match:
        raise ValueError("找不到文章101")
    
    start_pos = article_51_match.start()
    end_pos = article_101_match.start()
    
    articles_content = content[start_pos:end_pos]
    
    # 分割成50篇文章
    articles = []
    for i in range(51, 101):
        pattern = rf'## 文章 {i}\..*?(?=## 文章 {i+1}\.|$)'
        match = re.search(pattern, articles_content, re.DOTALL)
        if match:
            articles.append(match.group(0))
        else:
            raise ValueError(f"找不到文章{i}")
    
    return articles

def parse_article(article_text):
    """解析单篇文章的题目和答案"""
    # 提取问题部分
    questions_match = re.search(r'\*\*Questions:\*\*\s*\n(.*?)(?=\*\*Answers:\*\*)', article_text, re.DOTALL)
    if not questions_match:
        raise ValueError("找不到问题部分")
    
    questions_text = questions_match.group(1)
    
    # 提取答案部分
    answers_match = re.search(r'\*\*Answers:\*\*\s*\n(.*?)$', article_text, re.DOTALL)
    if not answers_match:
        raise ValueError("找不到答案部分")
    
    answers_text = answers_match.group(1)
    
    # 解析每个问题
    questions = []
    question_pattern = r'(\d+)\.\s+(.*?)\n\s+A\)\s+(.*?)\n\s+B\)\s+(.*?)\n\s+C\)\s+(.*?)\n\s+D\)\s+(.*?)(?=\n\d+\.|\n\n|\Z)'
    
    for match in re.finditer(question_pattern, questions_text, re.DOTALL):
        q_num = int(match.group(1))
        q_text = match.group(2).strip()
        options = {
            'A': match.group(3).strip(),
            'B': match.group(4).strip(),
            'C': match.group(5).strip(),
            'D': match.group(6).strip()
        }
        questions.append({
            'num': q_num,
            'text': q_text,
            'options': options
        })
    
    # 解析答案
    answers = {}
    answer_pattern = r'(\d+)\.\s+([A-D])\s+-\s+(.*?)$'
    for match in re.finditer(answer_pattern, answers_text, re.MULTILINE):
        q_num = int(match.group(1))
        correct_answer = match.group(2)
        explanation = match.group(3).strip()
        answers[q_num] = {
            'answer': correct_answer,
            'explanation': explanation
        }
    
    return questions, answers

def redistribute_answers(all_articles_data):
    """重新分配答案，使ABCD各占约25%"""
    total_questions = 250
    target_per_letter = total_questions // 4  # 62-63个
    
    # 统计当前分布
    current_answers = []
    for article_data in all_articles_data:
        questions, answers = article_data
        for q_num, answer_data in answers.items():
            current_answers.append(answer_data['answer'])
    
    print(f"当前答案分布: {Counter(current_answers)}")
    
    # 生成新的答案分布
    # 我们需要250个答案，ABCD各62-63个
    new_distribution = []
    for letter in ['A', 'B', 'C', 'D']:
        new_distribution.extend([letter] * 62)
    new_distribution.extend(['A'] * 2)  # 补充到250个
    
    random.shuffle(new_distribution)
    
    # 确保每篇文章的答案模式不重复
    article_patterns = set()
    article_answers = []
    
    idx = 0
    for article_idx, article_data in enumerate(all_articles_data):
        questions, answers = article_data
        pattern = []
        
        for q in questions:
            q_num = q['num']
            new_answer = new_distribution[idx]
            pattern.append(new_answer)
            idx += 1
        
        pattern_str = ''.join(pattern)
        
        # 如果模式重复，重新生成
        attempts = 0
        while pattern_str in article_patterns and attempts < 100:
            random.shuffle(pattern)
            pattern_str = ''.join(pattern)
            attempts += 1
        
        article_patterns.add(pattern_str)
        article_answers.append(pattern)
    
    return article_answers

def shuffle_options(questions, answers, new_answer_pattern):
    """根据新的答案模式重新排列选项"""
    new_questions = []
    new_answers = {}
    
    for i, q in enumerate(questions):
        q_num = q['num']
        original_answer = answers[q_num]['answer']
        explanation = answers[q_num]['explanation']
        
        # 获取正确答案的内容
        correct_content = q['options'][original_answer]
        
        # 新的正确答案
        new_correct_letter = new_answer_pattern[i]
        
        # 重新排列选项
        # 策略：将正确答案放到新位置，其他选项随机排列
        other_options = [content for letter, content in q['options'].items() if letter != original_answer]
        random.shuffle(other_options)
        
        # 构建新选项
        new_options = {}
        option_idx = 0
        for letter in ['A', 'B', 'C', 'D']:
            if letter == new_correct_letter:
                new_options[letter] = correct_content
            else:
                new_options[letter] = other_options[option_idx]
                option_idx += 1
        
        new_questions.append({
            'num': q_num,
            'text': q['text'],
            'options': new_options
        })
        
        new_answers[q_num] = {
            'answer': new_correct_letter,
            'explanation': explanation
        }
    
    return new_questions, new_answers

def rebuild_article(article_text, new_questions, new_answers):
    """重建文章文本"""
    # 保留文章标题和正文
    header_match = re.match(r'(## 文章 \d+\..*?\*\*Questions:\*\*\s*\n)', article_text, re.DOTALL)
    if not header_match:
        raise ValueError("无法提取文章头部")
    
    header = header_match.group(1)
    
    # 重建问题部分
    questions_text = ""
    for q in new_questions:
        questions_text += f"\n{q['num']}. {q['text']}\n"
        questions_text += f"   A) {q['options']['A']}\n"
        questions_text += f"   B) {q['options']['B']}\n"
        questions_text += f"   C) {q['options']['C']}\n"
        questions_text += f"   D) {q['options']['D']}\n"
    
    # 重建答案部分
    answers_text = "\n**Answers:**\n"
    for q_num in sorted(new_answers.keys()):
        answer_data = new_answers[q_num]
        answers_text += f"{q_num}. {answer_data['answer']} - {answer_data['explanation']}\n"
    
    return header + questions_text + answers_text

def main():
    # 读取文件
    with open(r'd:\学习\英语\真题\CET4_Reading_Comprehension.md', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 解析文章51-100
    articles = parse_articles_51_100(content)
    print(f"成功解析 {len(articles)} 篇文章")
    
    # 解析每篇文章
    all_articles_data = []
    for article in articles:
        questions, answers = parse_article(article)
        all_articles_data.append((questions, answers))
    
    # 重新分配答案
    new_article_answers = redistribute_answers(all_articles_data)
    
    # 重建文章
    new_articles = []
    for i, article_data in enumerate(all_articles_data):
        questions, answers = article_data
        new_questions, new_answers = shuffle_options(questions, answers, new_article_answers[i])
        new_article_text = rebuild_article(articles[i], new_questions, new_answers)
        new_articles.append(new_article_text)
    
    # 统计新的答案分布
    all_new_answers = []
    for _, new_answers in [(q, a) for q, a in [shuffle_options(qd, ad, new_article_answers[i]) 
                                                  for i, (qd, ad) in enumerate(all_articles_data)]]:
        for q_num, answer_data in new_answers.items():
            all_new_answers.append(answer_data['answer'])
    
    print(f"新的答案分布: {Counter(all_new_answers)}")
    
    # 替换原文件中的文章51-100
    article_51_match = re.search(r'## 文章 51\.', content)
    article_101_match = re.search(r'## 文章 101\.', content)
    
    new_content = content[:article_51_match.start()]
    new_content += '\n'.join(new_articles)
    new_content += content[article_101_match.start():]
    
    # 写入文件
    with open(r'd:\学习\英语\真题\CET4_Reading_Comprehension.md', 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print("文件已更新")

if __name__ == '__main__':
    main()
