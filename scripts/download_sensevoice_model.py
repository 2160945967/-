#!/usr/bin/env python3
from modelscope.hub.file_download import model_file_download
import os

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_ID = 'pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue'
LOCAL_DIR = os.path.join(ROOT_DIR, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue')

os.makedirs(LOCAL_DIR, exist_ok=True)

files = ['model.int8.onnx', 'tokens.txt']
for f in files:
    print(f'开始下载 {f} ...')
    saved = model_file_download(MODEL_ID, f, local_dir=LOCAL_DIR)
    print(f'已保存: {saved}')

print('SenseVoice 模型下载完成')
