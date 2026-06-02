#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import re
import requests
import time
import csv
import base64
import uuid
from wordutils import normalize_word_for_filename, preprocess_word_for_tts


class TencentTTS:
    def __init__(self, pronunciations_dir, cache_dir):
        self.pronunciations_dir = pronunciations_dir
        self.cache_dir = cache_dir
        self.audio_cache_dir = os.path.join(cache_dir, 'audio')
        self.translation_cache_file = os.path.join(cache_dir, 'translation.json')
        
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        
        # 先尝试从环境变量加载腾讯云密钥
        self.secret_id = os.environ.get('TENCENT_SECRET_ID', '')
        self.secret_key = os.environ.get('TENCENT_SECRET_KEY', '')
        
        # 如果环境变量没有，尝试从SecretKey.csv加载
        if not self.secret_id or not self.secret_key:
            self._load_tencent_secrets()
        
        if self.secret_id and self.secret_key:
            print(f"腾讯云密钥已设置")
        else:
            print(f"警告: 腾讯云密钥未设置，TTS和翻译功能将不可用")
        
        # 腾讯云SDK客户端
        self.tencent_client = None
        self.tencent_tts_client = None
        self._init_tencent_client()
        self._init_tencent_tts_client()
        
        # 腾讯云TTS音色配置（按优先级顺序：第三个->第一个->第二个）
        # 按acc区分：us优先用1001，uk优先用1002
        self.tts_voice_types = {
            'us': [
                {"voice_type": 1001, "name": "Super Nature US (1001)"},  # 超自然美式
                {"voice_type": 1002, "name": "Super Nature UK (1002)"},
                {"voice_type": 1003, "name": "Super Nature (1003)"},
                {"voice_type": 101001, "name": "Large Model (101001)"},
                {"voice_type": 0, "name": "General Male (0)"},
                {"voice_type": 1, "name": "General Female (1)"},
            ],
            'uk': [
                {"voice_type": 1002, "name": "Super Nature UK (1002)"},  # 超自然英式
                {"voice_type": 1001, "name": "Super Nature US (1001)"},
                {"voice_type": 1003, "name": "Super Nature (1003)"},
                {"voice_type": 101001, "name": "Large Model (101001)"},
                {"voice_type": 1, "name": "General Female (1)"},
                {"voice_type": 0, "name": "General Male (0)"},
            ]
        }
        self.current_voice_idx = {'us': 0, 'uk': 0}
        
        self._ensure_dirs()
    
    def _ensure_dirs(self):
        os.makedirs(self.pronunciations_dir, exist_ok=True)
        os.makedirs(self.cache_dir, exist_ok=True)
        os.makedirs(self.audio_cache_dir, exist_ok=True)
    
    def _load_tencent_secrets(self):
        """从SecretKey.csv加载腾讯云密钥"""
        try:
            csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'SecretKey.csv')
            if os.path.exists(csv_path):
                # 尝试用不同编码打开，处理BOM
                for encoding in ['utf-8-sig', 'utf-8', 'gbk', 'latin-1']:
                    try:
                        with open(csv_path, 'r', encoding=encoding) as f:
                            reader = csv.DictReader(f)
                            for row in reader:
                                # 遍历所有可能的字段名
                                for key in row.keys():
                                    if 'SecretId' in key:
                                        self.secret_id = row[key].strip()
                                    if 'SecretKey' in key:
                                        self.secret_key = row[key].strip()
                                
                                if self.secret_id and self.secret_key:
                                    print(f"腾讯云密钥加载成功 (编码: {encoding})")
                                    return
                        break
                    except Exception as e:
                        continue
        except Exception as e:
            print(f"加载腾讯云密钥失败: {e}")
    
    def _init_tencent_client(self):
        """初始化腾讯云翻译SDK客户端"""
        if not self.secret_id or not self.secret_key:
            return
        
        try:
            from tencentcloud.common import credential
            from tencentcloud.common.profile.client_profile import ClientProfile
            from tencentcloud.common.profile.http_profile import HttpProfile
            from tencentcloud.tmt.v20180321 import tmt_client, models
            
            cred = credential.Credential(self.secret_id, self.secret_key)
            httpProfile = HttpProfile()
            httpProfile.endpoint = "tmt.tencentcloudapi.com"
            
            clientProfile = ClientProfile()
            clientProfile.httpProfile = httpProfile
            self.tencent_client = tmt_client.TmtClient(cred, "ap-guangzhou", clientProfile)
            print(f"腾讯云翻译SDK初始化成功")
        except Exception as e:
            print(f"腾讯云翻译SDK初始化失败: {e}")
            self.tencent_client = None
    
    def _init_tencent_tts_client(self):
        """初始化腾讯云语音合成SDK客户端"""
        if not self.secret_id or not self.secret_key:
            return
        
        try:
            from tencentcloud.common import credential
            from tencentcloud.common.profile.client_profile import ClientProfile
            from tencentcloud.common.profile.http_profile import HttpProfile
            from tencentcloud.tts.v20190823 import tts_client, models
            
            cred = credential.Credential(self.secret_id, self.secret_key)
            httpProfile = HttpProfile()
            httpProfile.endpoint = "tts.tencentcloudapi.com"
            
            clientProfile = ClientProfile()
            clientProfile.httpProfile = httpProfile
            self.tencent_tts_client = tts_client.TtsClient(cred, "ap-guangzhou", clientProfile)
            print(f"腾讯云语音合成SDK初始化成功")
        except Exception as e:
            print(f"腾讯云语音合成SDK初始化失败: {e}")
            self.tencent_tts_client = None
    
    def _tencent_translate(self, text):
        """使用腾讯云翻译API（英译中）"""
        if not self.tencent_client:
            print(f"腾讯云客户端未初始化，跳过腾讯云翻译")
            return None
        
        print(f"使用腾讯云翻译: {text}")
        try:
            from tencentcloud.tmt.v20180321 import models
            
            req = models.TextTranslateRequest()
            req.Source = "en"
            req.Target = "zh"
            req.SourceText = text
            req.ProjectId = 0
            
            resp = self.tencent_client.TextTranslate(req)
            print(f"腾讯云翻译结果: {resp.TargetText}")
            return resp.TargetText
            
        except Exception as e:
            print(f"腾讯云翻译出错: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def _tencent_tts(self, text, accent='us'):
        """使用腾讯云语音合成API生成音频"""
        if not self.tencent_tts_client:
            print(f"腾讯云TTS客户端未初始化，跳过腾讯云TTS")
            return None
        
        # 获取对应口音的配置
        voice_list = self.tts_voice_types.get(accent, self.tts_voice_types['us'])
        start_idx = self.current_voice_idx.get(accent, 0)
        
        # 尝试不同的音色配置
        for i in range(start_idx, len(voice_list)):
            config = voice_list[i]
            try:
                print(f"使用腾讯云TTS ({config['name']}, accent={accent}): {text}")
                from tencentcloud.tts.v20190823 import models
                
                req = models.TextToVoiceRequest()
                params = {
                    "Text": text,
                    "VoiceType": config["voice_type"],
                    "Codec": "mp3",
                    "SampleRate": 16000,
                    "SessionId": str(uuid.uuid4())
                }
                
                req.from_json_string(str(params).replace("'", "\""))
                
                resp = self.tencent_tts_client.TextToVoice(req)
                
                if hasattr(resp, 'Audio') and resp.Audio:
                    print(f"腾讯云TTS生成成功 ({config['name']})")
                    self.current_voice_idx[accent] = i  # 记录当前成功的配置
                    return base64.b64decode(resp.Audio)
                else:
                    print(f"腾讯云TTS响应中没有音频数据 ({config['name']})")
                    
            except Exception as e:
                print(f"腾讯云TTS出错 ({config['name']}): {e}")
                # 如果失败，尝试下一个配置
                continue
        
        # 如果所有配置都失败，返回None
        print(f"所有腾讯云TTS配置都失败了 (accent={accent})")
        return None
    
    def _is_single_word(self, text):
        text = text.strip()
        return ' ' not in text and len(text.split()) == 1
    
    def get_pronunciation(self, text, accent='us', force_regenerate=False):
        text = text.strip()
        if not text:
            return None
        
        is_single = self._is_single_word(text)
        
        if is_single:
            return self._get_word_pronunciation(text, accent, force_regenerate)
        else:
            return self._get_phrase_pronunciation(text, accent, force_regenerate)
    
    def _save_audio(self, audio_data, filepath):
        """保存音频数据到文件"""
        try:
            with open(filepath, 'wb') as f:
                f.write(audio_data)
            print(f"音频保存成功: {filepath}")
            return True
        except Exception as e:
            print(f"音频保存失败: {e}")
            return False
    
    def _youdao_tts(self, word, accent='us'):
        """使用有道TTS API生成单词发音"""
        try:
            print(f"使用有道TTS (accent={accent}): {word}")
            
            # 有道TTS API
            # 美式英语: type=1
            # 英式英语: type=2
            youdao_type = 1 if accent == 'us' else 2
            
            url = f"https://dict.youdao.com/dictvoice?type={youdao_type}&audio={word}"
            
            response = self.session.get(url, timeout=10)
            if response.status_code == 200 and len(response.content) > 100:  # 确保有有效音频数据
                print(f"有道TTS生成成功")
                return response.content
            else:
                print(f"有道TTS失败，状态码: {response.status_code}, 长度: {len(response.content)}")
                return None
        except Exception as e:
            print(f"有道TTS出错: {e}")
            return None
    
    def _get_word_pronunciation(self, word, accent, force_regenerate):
        normalized_word = normalize_word_for_filename(word)
        filename = f"{normalized_word}_{accent}.mp3"
        filepath = os.path.join(self.pronunciations_dir, filename)
        
        if not force_regenerate and os.path.exists(filepath):
            print(f"文件已存在: {filepath}")
            return filepath
        
        processed_word = preprocess_word_for_tts(word)
        if not processed_word:
            processed_word = word
        
        # 优先使用有道TTS
        audio_data = self._youdao_tts(processed_word, accent)
        if audio_data and self._save_audio(audio_data, filepath):
            return filepath
        
        # 有道失败，使用腾讯云TTS作为备用
        print(f"有道TTS失败，尝试腾讯云TTS")
        audio_data = self._tencent_tts(processed_word, accent)
        if audio_data and self._save_audio(audio_data, filepath):
            return filepath
        
        return None
    
    def _get_phrase_pronunciation(self, phrase, accent, force_regenerate):
        normalized_phrase = normalize_word_for_filename(phrase)
        filename = f"{normalized_phrase}_{accent}.mp3"
        filepath = os.path.join(self.audio_cache_dir, filename)
        
        if not force_regenerate and os.path.exists(filepath):
            print(f"文件已存在: {filepath}")
            return filepath
        
        # 使用腾讯云TTS生成音频
        audio_data = self._tencent_tts(phrase, accent)
        if audio_data and self._save_audio(audio_data, filepath):
            return filepath
        
        return None
    
    def test_network(self):
        try:
            response = self.session.get('https://www.baidu.com', timeout=5)
            return response.status_code == 200
        except Exception:
            try:
                response = self.session.get('https://www.bing.com', timeout=5)
                return response.status_code == 200
            except Exception:
                return False
    
    def translate(self, text):
        """
        使用腾讯云翻译API进行翻译
        英译中
        """
        if not text:
            return text
        
        try:
            # 优先使用腾讯云翻译
            if self.secret_id and self.secret_key:
                translation = self._tencent_translate(text)
                if translation and translation != text:
                    return translation
            
            # 如果腾讯云失败，备用方案
            # 使用有道网页翻译
            try:
                web_url = "https://fanyi.youdao.com/translate"
                web_data = {
                    'i': text,
                    'from': 'en',
                    'to': 'zh-CHS',
                    'smartresult': 'dict',
                    'client': 'fanyideskweb',
                    'doctype': 'json',
                    'version': '2.1',
                    'keyfrom': 'fanyi.web',
                    'action': 'FY_BY_CLICKBUTTON'
                }
                web_response = self.session.post(web_url, data=web_data, timeout=15)
                web_result = web_response.json()
                
                if web_result.get('translateResult'):
                    translation = web_result['translateResult'][0][0]['tgt']
                    if translation and translation != text:
                        return translation
            except Exception as e:
                print(f"有道翻译备用方案出错: {e}")
            
            # 最后返回原文
            return text
            
        except Exception as e:
            print(f"翻译出错: {e}")
            import traceback
            traceback.print_exc()
            return text


_tts_instance = None


def init_tts(pronunciations_dir, cache_dir):
    global _tts_instance
    _tts_instance = TencentTTS(pronunciations_dir, cache_dir)
    return _tts_instance


def get_tts():
    return _tts_instance
