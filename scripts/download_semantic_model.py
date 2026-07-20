#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
下载语义相似度模型文件并打包为分卷 7z
模型：shibing624/text2vec-base-chinese (ONNX q8)
"""
import os
import sys
import subprocess
from pathlib import Path

os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'

from huggingface_hub import snapshot_download

PROJECT_ROOT = Path(__file__).parent.parent
MODEL_DIR = PROJECT_ROOT / 'semantic-model-files'
OUTPUT_DIR = PROJECT_ROOT / 'gitee-assets'

print('=== 下载语义相似度模型文件 ===\n')
print(f'模型: shibing624/text2vec-base-chinese (ONNX q8)')
print(f'缓存目录: {MODEL_DIR}')

try:
    local_dir = snapshot_download(
        repo_id='shibing624/text2vec-base-chinese',
        local_dir=str(MODEL_DIR),
        allow_patterns=[
            'config.json',
            'tokenizer.json',
            'tokenizer_config.json',
            'vocab.txt',
            'special_tokens_map.json',
            'onnx/model_q8.onnx',
        ],
    )
    print(f'\n模型下载完成: {local_dir}')
except Exception as e:
    print(f'下载失败: {e}')
    sys.exit(1)

# 列出文件
print('\n=== 已下载文件 ===')
total_size = 0
for root, dirs, files in os.walk(MODEL_DIR):
    for f in files:
        fp = Path(root) / f
        size = fp.stat().st_size
        total_size += size
        rel = fp.relative_to(MODEL_DIR)
        print(f'  {rel}: {size} bytes')
print(f'\n总计: {total_size} bytes ({total_size / 1024 / 1024:.1f} MB)')

# 打包为分卷 7z
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
archive_name = 'semantic-model.7z'
archive_path = OUTPUT_DIR / archive_name

# 删除旧的分卷文件
for old in OUTPUT_DIR.glob('semantic-model.7z.*'):
    old.unlink()

print(f'\n=== 打包为 7z (分卷 100MB) ===')
try:
    subprocess.run(
        ['7z', 'a', '-mx=5', '-v100m', str(archive_path), str(MODEL_DIR) + '\\*'],
        check=True,
    )
except subprocess.CalledProcessError:
    # 7z 分卷打包返回码可能非0但文件已生成
    pass

# 列出分卷文件
print('\n=== 分卷文件 ===')
parts = sorted(OUTPUT_DIR.glob('semantic-model.7z.*'))
part_total = 0
for p in parts:
    size = p.stat().st_size
    part_total += size
    print(f'  {p.name}: {size} bytes')
print(f'\n分卷总计: {part_total} bytes ({part_total / 1024 / 1024:.1f} MB)')

print('\n=== 完成 ===')
print(f'模型文件目录: {MODEL_DIR}')
print(f'分卷输出目录: {OUTPUT_DIR}')
print('\n请上传以下文件到 Gitee Release:')
for p in parts:
    print(f'  {p.name}')
