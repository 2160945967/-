import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import { LRUCache } from '../utils/cache';
import {
  normalizeWordForFilename, preprocessWordForTTS, ROOT_DIR, CACHE_DIR
} from '../utils/helpers';
import { classifyText } from './nlp';
import { getMainDb } from './database';
import { TENCENT_SECRET_ID, TENCENT_SECRET_KEY } from '../config';

const DEBUG = false;

//HTTP 工具

interface HttpResponse {
  statusCode: number;
  data: Buffer;
  headers: http.IncomingHttpHeaders;
}

function httpGet(url: string, timeout: number = 15000): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === 'https:' ? https : http;

    const req = mod.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            data: Buffer.concat(chunks),
            headers: res.headers
          });
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

function httpPost(
  url: string,
  body: string,
  headers: Record<string, string> = {},
  timeout: number = 15000
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === 'https:' ? https : http;

    const allHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Content-Type': 'application/json',
      ...headers
    };

    const req = mod.request(
      url,
      {
        method: 'POST',
        headers: allHeaders,
        timeout
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            data: Buffer.concat(chunks),
            headers: res.headers
          });
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(body);
    req.end();
  });
}

//  Tencent Cloud TC3-HMAC-SHA256 签名 

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function tencentCloudSign(
  secretId: string,
  secretKey: string,
  service: string,
  action: string,
  version: string,
  region: string,
  payload: string,
  timestamp: number
): { authorization: string; host: string; headers: Record<string, string> } {
  const host = `${service}.tencentcloudapi.com`;
  const date = new Date(timestamp * 1000).toISOString().substring(0, 10);
  const algorithm = 'TC3-HMAC-SHA256';

  // Step 1: CanonicalRequest
  const httpRequestMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const contentType = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host';
  const hashedRequestPayload = sha256Hex(payload);

  const canonicalRequest = [
    httpRequestMethod,
    canonicalUri,
    canonicalQueryString,
    `content-type:${contentType}`,
    `host:${host}`,
    '',
    signedHeaders,
    hashedRequestPayload
  ].join('\n');

  // Step 2: StringToSign
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = sha256Hex(canonicalRequest);

  const stringToSign = [
    algorithm,
    String(timestamp),
    credentialScope,
    hashedCanonicalRequest
  ].join('\n');

  // Step 3: Signature
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = hmacSha256(secretSigning, stringToSign).toString('hex');

  // Step 4: Authorization
  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    authorization,
    host,
    headers: {
      'Authorization': authorization,
      'Content-Type': contentType,
      'Host': host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': region
    }
  };
}

// ==================== TencentTTS 主类 ====================

const TTS_VOICE_TYPES: Record<string, Array<{ voiceType: number; name: string }>> = {
  'us': [
    { voiceType: 1001, name: 'Super Nature US (1001)' },
    { voiceType: 1002, name: 'Super Nature UK (1002)' },
    { voiceType: 1003, name: 'Super Nature (1003)' },
    { voiceType: 101001, name: 'Large Model (101001)' },
    { voiceType: 0, name: 'General Male (0)' },
    { voiceType: 1, name: 'General Female (1)' }
  ],
  'uk': [
    { voiceType: 1002, name: 'Super Nature UK (1002)' },
    { voiceType: 1001, name: 'Super Nature US (1001)' },
    { voiceType: 1003, name: 'Super Nature (1003)' },
    { voiceType: 101001, name: 'Large Model (101001)' },
    { voiceType: 1, name: 'General Female (1)' },
    { voiceType: 0, name: 'General Male (0)' }
  ]
};

export class TencentTTS {
  private pronunciationsDir: string;
  private cacheDir: string;
  private audioCacheDir: string;
  private secretId: string;
  private secretKey: string;
  private currentVoiceIdx: Record<string, number>;
  private translationCache: LRUCache<string>;
  private _edgeTtsChecked = false;
  private _edgeTtsAvailable = false;

  constructor(pronunciationsDir: string, cacheDir: string) {
    this.pronunciationsDir = pronunciationsDir;
    this.cacheDir = cacheDir;
    this.audioCacheDir = path.join(cacheDir, 'audio');

    // 硬编码腾讯云密钥
    this.secretId = TENCENT_SECRET_ID;
    this.secretKey = TENCENT_SECRET_KEY;

    if(DEBUG)console.log('腾讯云密钥已设置');

    this.currentVoiceIdx = { 'us': 0, 'uk': 0 };
    this.translationCache = new LRUCache<string>(500);

    this.ensureDirs();
  }

  private ensureDirs(): void {
    try { fs.mkdirSync(this.pronunciationsDir, { recursive: true }); } catch {}
    try { fs.mkdirSync(this.cacheDir, { recursive: true }); } catch {}
    try { fs.mkdirSync(this.audioCacheDir, { recursive: true }); } catch {}
  }

  // ==================== 文本类型判断 ====================

  private isInDictionary(text: string): boolean {
    const mainDb = getMainDb();
    return !!(mainDb && mainDb.query(text));
  }

  // ==================== 主入口 ====================

  async getPronunciation(text: string, accent: string = 'us', forceRegenerate: boolean = false): Promise<string | null> {
    const trimmed = text.trim();
    if (!trimmed) return null;

    if (/[\u4e00-\u9fa5]/.test(trimmed)) {
      return null;
    }

    // 优先查词典：词典收录的（单词/词组）走更快的单词发音通道
    const inDict = this.isInDictionary(trimmed);
    const type = classifyText(trimmed);

    if (inDict || type !== 'sentence') {
      return await this.getWordPronunciation(trimmed, accent, forceRegenerate);
    }

    return await this.getPhrasePronunciation(trimmed, accent, forceRegenerate);
  }

  //单词发音

  async getWordPronunciation(word: string, accent: string, forceRegenerate: boolean = false): Promise<string | null> {
    const normalizedWord = normalizeWordForFilename(word);
    const filename = `${normalizedWord}_${accent}.mp3`;
    const filepath = path.join(this.pronunciationsDir, filename);

    const processedWord = preprocessWordForTTS(word) || word;

    if (!forceRegenerate) {
      const useCache = this.checkTtsCache(filepath, 'youdao');
      if (useCache) return filepath;
    }

    // 1. 有道TTS（首选，速度最快）
    if(DEBUG)console.log(`【单词发音】尝试 有道TTS: ${processedWord}`);
    let audioData = await this.youdaoTTS(processedWord, accent);
    if (audioData && this.saveWithProvider(audioData, filepath, 'youdao')) {
      return filepath;
    }

    // 2. 百度TTS
    if(DEBUG)console.log(`【单词发音】尝试 百度TTS: ${processedWord}`);
    audioData = await this.baiduTTS(processedWord, accent);
    if (audioData && this.saveWithProvider(audioData, filepath, 'baidu')) {
      return filepath;
    }

    // 3. Edge TTS
    if(DEBUG)console.log(`【单词发音】尝试 Edge TTS: ${processedWord}`);
    audioData = await this.edgeTTS(processedWord, accent);
    if (audioData && this.saveWithProvider(audioData, filepath, 'edge')) {
      return filepath;
    }

    // 4. 腾讯云TTS（最终兜底）
    if(DEBUG)console.log(`【单词发音】尝试 腾讯云TTS: ${processedWord}`);
    audioData = this.tencentCloudTTS(processedWord, accent);
    if (audioData && this.saveWithProvider(audioData, filepath, 'tencent')) {
      return filepath;
    }

    if(DEBUG)console.log(`【单词发音】所有TTS提供商均失败: ${processedWord}`);
    return null;
  }

  // 句子发音

  async getPhrasePronunciation(phrase: string, accent: string, forceRegenerate: boolean = false): Promise<string | null> {
    const normalizedPhrase = normalizeWordForFilename(phrase);
    const filename = `${normalizedPhrase}_${accent}.mp3`;
    const filepath = path.join(this.audioCacheDir, filename);

    if (!forceRegenerate) {
      const useCache = this.checkTtsCache(filepath, 'edge');
      if (useCache) return filepath;
    }

    // 1. 腾讯云TTS（HTTP 更快，优先尝试）
    if(DEBUG)console.log(`【句子发音】尝试 腾讯云TTS: ${phrase.substring(0, 50)}`);
    let audioData = this.tencentCloudTTS(phrase, accent);
    if (audioData && this.saveWithProvider(audioData, filepath, 'tencent')) {
      return filepath;
    }

    // 2. Edge TTS（兜底）
    if(DEBUG)console.log(`【句子发音】尝试 Edge TTS: ${phrase.substring(0, 50)}`);
    audioData = await this.edgeTTS(phrase, accent);
    if (audioData && this.saveWithProvider(audioData, filepath, 'edge')) {
      return filepath;
    }

    if(DEBUG)console.log(`【句子发音】所有TTS提供商均失败: ${phrase.substring(0, 50)}`);
    return null;
  }

  // 有道 TTS

  private async youdaoTTS(word: string, accent: string): Promise<Buffer | null> {
    const youdaoType = accent === 'us' ? 0 : 1;
    const url = `https://dict.youdao.com/dictvoice?type=${youdaoType}&audio=${encodeURIComponent(word)}`;

    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }

        if(DEBUG)console.log(`使用有道TTS (accent=${accent}, attempt=${attempt}): ${word}`);
        const response = await httpGet(url, 8000);

        if (response && response.statusCode === 200 && response.data.length > 100) {
          // 有道可能对失败词返回 JSON 错误，检查首字节
          if (response.data[0] === 0x7B) {
            if(DEBUG)console.log('有道TTS 返回 JSON 错误 (非音频)');
            continue;
          }
          if(DEBUG)console.log('有道TTS生成成功');
          return response.data;
        } else {
          if(DEBUG)console.log(`有道TTS失败，状态码: ${response?.statusCode}, 长度: ${response?.data?.length}`);
        }
      } catch (e) {
        if(DEBUG)console.log(`有道TTS出错 (attempt ${attempt}): ${e}`);
      }
    }

    if(DEBUG)console.log(`有道TTS重试${maxRetries}次后仍失败`);
    return null;
  }

  // 尝试把非有道缓存升级成有道（点击发音按钮时触发），3秒超时，只试一次
  async tryUpgradeToYoudao(word: string, accent: string, filepath: string): Promise<boolean> {
    const youdaoType = accent === 'us' ? 0 : 1;
    const url = `https://dict.youdao.com/dictvoice?type=${youdaoType}&audio=${encodeURIComponent(word)}`;
    try {
      const response = await httpGet(url, 3000);
      if (response && response.statusCode === 200 && response.data.length > 100 && response.data[0] !== 0x7B) {
        return this.saveWithProvider(response.data, filepath, 'youdao');
      }
    } catch {}
    return false;
  }

  // 百度 TTS

  private async baiduTTS(word: string, accent: string): Promise<Buffer | null> {
    try {
      const wordEncoded = encodeURIComponent(word);
      const url = `https://tts.baidu.com/text2audio?lan=en&ie=UTF-8&spd=4&text=${wordEncoded}&cuid=shici_app&ctp=1`;

      if(DEBUG)console.log(`使用百度TTS (accent=${accent}): ${word}`);
      const response = await httpGet(url, 8000);

      if (response && response.statusCode === 200 && response.data.length > 100) {
        // 百度TTS 失败时返回 JSON 错误，成功时返回 MP3（以 0xFF 0xFB 或 ID3 开头）
        if (response.data[0] === 0x7B) {
          if(DEBUG)console.log('百度TTS 返回 JSON 错误 (非音频)');
          return null;
        }
        if(DEBUG)console.log('百度TTS生成成功');
        return response.data;
      } else {
        if(DEBUG)console.log(`百度TTS失败，状态码: ${response?.statusCode}`);
        return null;
      }
    } catch (e) {
      if(DEBUG)console.log(`百度TTS出错: ${e}`);
      return null;
    }
  }

  // Edge TTS

  private isEdgeTtsAvailable(): boolean {
    if (this._edgeTtsChecked) return this._edgeTtsAvailable;
    this._edgeTtsChecked = true;
    try {
      const { execSync } = require('child_process');
      execSync('npx edge-tts --help', { stdio: 'pipe', timeout: 5000 });
      this._edgeTtsAvailable = true;
    } catch {
      this._edgeTtsAvailable = false;
    }
    return this._edgeTtsAvailable;
  }

  private async edgeTTS(text: string, accent: string): Promise<Buffer | null> {
    if (!this.isEdgeTtsAvailable()) return null;
    try {
      const voice = accent === 'uk' ? 'en-GB-SoniaNeural' : 'en-US-AriaNeural';
      if(DEBUG)console.log(`使用Edge TTS (voice=${voice}): ${text.substring(0, 80)}`);

      const tmpPath = await this.edgeTTSGenerate(text, voice);

      if (tmpPath) {
        const audioData = fs.readFileSync(tmpPath);
        try { fs.unlinkSync(tmpPath); } catch {}

        if (audioData.length > 100) {
          if(DEBUG)console.log(`Edge TTS生成成功 (${audioData.length} bytes)`);
          return audioData;
        } else {
          if(DEBUG)console.log('Edge TTS返回数据过小');
          return null;
        }
      }

      return null;
    } catch (e) {
      if(DEBUG)console.log(`Edge TTS出错: ${e}`);
      return null;
    }
  }

  // 使用 spawn 避免 shell 注入，异步执行
  private edgeTTSGenerate(text: string, voice: string): Promise<string | null> {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const tmpPath = path.join(this.cacheDir, `_edge_tmp_${Date.now()}.mp3`);
      const proc = spawn('npx', ['edge-tts', '--text', text, '--voice', voice, '--write-media', tmpPath], {
        timeout: 15000,
        stdio: 'pipe',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });

      proc.on('close', (code: number) => {
        if (fs.existsSync(tmpPath)) {
          const stat = fs.statSync(tmpPath);
          if (stat.size > 100) {
            resolve(tmpPath);
          } else {
            try { fs.unlinkSync(tmpPath); } catch {}
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });

      proc.on('error', () => {
        resolve(null);
      });
    });
  }

  // 腾讯云 TTS

  private tencentCloudTTS(text: string, accent: string): Buffer | null {
    const voiceList = TTS_VOICE_TYPES[accent] || TTS_VOICE_TYPES['us'];
    const startIdx = this.currentVoiceIdx[accent] || 0;

    for (let i = startIdx; i < voiceList.length; i++) {
      const config = voiceList[i];
      try {
        if(DEBUG)console.log(`使用腾讯云TTS (${config.name}, accent=${accent}): ${text}`);

        const audioData = this.tencentCloudTTSRaw(text, config.voiceType, 'mp3', 16000);

        if (audioData) {
          if(DEBUG)console.log(`腾讯云TTS生成成功 (${config.name})`);
          this.currentVoiceIdx[accent] = i;
          return audioData;
        } else {
          if(DEBUG)console.log(`腾讯云TTS响应中没有音频数据 (${config.name})`);
        }
      } catch (e) {
        if(DEBUG)console.log(`腾讯云TTS出错 (${config.name}): ${e}`);
        continue;
      }
    }

    if(DEBUG)console.log(`所有腾讯云TTS配置都失败了 (accent=${accent})`);
    return null;
  }

  private tencentCloudTTSRaw(
    text: string,
    voiceType: number,
    codec: string = 'mp3',
    sampleRate: number = 16000
  ): Buffer | null {
    const action = 'TextToVoice';
    const version = '2019-08-23';
    const region = 'ap-guangzhou';
    const service = 'tts';
    const timestamp = Math.floor(Date.now() / 1000);

    const params: Record<string, any> = {
      Text: text,
      VoiceType: voiceType,
      Codec: codec,
      SampleRate: sampleRate,
      SessionId: crypto.randomUUID()
    };
    const payload = JSON.stringify(params);

    const signResult = tencentCloudSign(
      this.secretId,
      this.secretKey,
      service,
      action,
      version,
      region,
      payload,
      timestamp
    );

    const url = `https://${signResult.host}/`;

    try {
      const response = httpPostSync(url, payload, signResult.headers);

      if (response && response.statusCode === 200) {
        const responseData = JSON.parse(response.data.toString('utf8'));
        if (responseData.Response && responseData.Response.Audio) {
          return Buffer.from(responseData.Response.Audio, 'base64');
        }
        if (responseData.Response && responseData.Response.Error) {
          if(DEBUG)console.log(`腾讯云TTS API错误: ${JSON.stringify(responseData.Response.Error)}`);
        }
      } else {
        if(DEBUG)console.log(`腾讯云TTS HTTP错误: ${response?.statusCode}`);
      }
    } catch (e) {
      if(DEBUG)console.log(`腾讯云TTS网络请求出错: ${e}`);
    }

    return null;
  }

  // 缓存管理

  private checkTtsCache(filepath: string, preferredProvider: string): boolean {
    if (!fs.existsSync(filepath)) {
      return false;
    }

    const stat = fs.statSync(filepath);
    if (stat.size < 100) {
      return false;
    }

    // 验证是有效 MP3 而不是 JSON 错误响应
    const firstByte = this.readFirstByte(filepath);
    if (firstByte === 0x7B) {
      // 文件内容是 JSON（TTS 返回的错误），删除无效缓存
      try { fs.unlinkSync(filepath); } catch {}
      const providerFile = filepath + '.provider';
      try { if (fs.existsSync(providerFile)) fs.unlinkSync(providerFile); } catch {}
      if(DEBUG)console.log(`删除无效缓存 (非音频): ${filepath}`);
      return false;
    }

    // 只要有有效的 MP3 文件就用，不强制匹配提供商
    if(DEBUG)console.log(`使用缓存: ${filepath}`);
    return true;
  }

  private readFirstByte(filepath: string): number {
    try {
      const fd = fs.openSync(filepath, 'r');
      const buf = Buffer.alloc(1);
      fs.readSync(fd, buf, 0, 1, 0);
      fs.closeSync(fd);
      return buf[0];
    } catch {
      return 0;
    }
  }

  private saveAudio(audioData: Buffer, filepath: string): boolean {
    try {
      fs.writeFileSync(filepath, audioData);
      if(DEBUG)console.log(`音频保存成功: ${filepath}`);
      return true;
    } catch (e) {
      if(DEBUG)console.log(`音频保存失败: ${e}`);
      return false;
    }
  }

  private saveWithProvider(audioData: Buffer, filepath: string, provider: string): boolean {
    if (this.saveAudio(audioData, filepath)) {
      const providerFile = filepath + '.provider';
      try {
        if (provider === 'youdao') {
          // 有道是默认发音源，不写 provider 标记；有旧标记则清理
          if (fs.existsSync(providerFile)) fs.unlinkSync(providerFile);
        } else {
          fs.writeFileSync(providerFile, provider, 'utf8');
        }
      } catch {}
      return true;
    }
    return false;
  }

  // 网络测试

  testNetwork(): boolean {
    return true;
  }

  //  翻译 

  translate(text: string): string {
    if (!text) return text;

    // 检查 LRU 缓存
    const cacheKey = `translate:${text}`;
    const cached = this.translationCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let translation = text;

    try {
      // 优先使用腾讯云翻译
      translation = this.tencentTranslate(text);
      if (translation && translation !== text) {
        this.translationCache.put(cacheKey, translation);
        return translation;
      }

      // 备选：有道网页翻译
      translation = this.youdaoTranslate(text);
      if (translation && translation !== text) {
        this.translationCache.put(cacheKey, translation);
        return translation;
      }
    } catch (e) {
      if(DEBUG)console.log(`翻译出错: ${e}`);
    }

    this.translationCache.put(cacheKey, text);
    return text;
  }

  private tencentTranslate(text: string): string | null {
    if (!this.secretId || !this.secretKey) {
      if(DEBUG)console.log('腾讯云客户端未初始化，跳过腾讯云翻译');
      return null;
    }

    if(DEBUG)console.log(`使用腾讯云翻译: ${text}`);

    const action = 'TextTranslate';
    const version = '2018-03-21';
    const region = 'ap-guangzhou';
    const service = 'tmt';
    const timestamp = Math.floor(Date.now() / 1000);

    const params = {
      Source: 'en',
      Target: 'zh',
      SourceText: text,
      ProjectId: 0
    };
    const payload = JSON.stringify(params);

    const signResult = tencentCloudSign(
      this.secretId,
      this.secretKey,
      service,
      action,
      version,
      region,
      payload,
      timestamp
    );

    const url = `https://${signResult.host}/`;

    try {
      const response = httpPostSync(url, payload, signResult.headers);

      if (response && response.statusCode === 200) {
        const responseData = JSON.parse(response.data.toString('utf8'));
        if (responseData.Response && responseData.Response.TargetText) {
          if(DEBUG)console.log(`腾讯云翻译结果: ${responseData.Response.TargetText}`);
          return responseData.Response.TargetText;
        }
        if (responseData.Response && responseData.Response.Error) {
          if(DEBUG)console.log(`腾讯云翻译API错误: ${JSON.stringify(responseData.Response.Error)}`);
        }
      }
    } catch (e) {
      if(DEBUG)console.log(`腾讯云翻译出错: ${e}`);
    }

    return null;
  }

  private youdaoTranslate(text: string): string | null {
    try {
      const url = 'https://fanyi.youdao.com/translate';
      const body = new URLSearchParams({
        'i': text,
        'from': 'en',
        'to': 'zh-CHS',
        'smartresult': 'dict',
        'client': 'fanyideskweb',
        'doctype': 'json',
        'version': '2.1',
        'keyfrom': 'fanyi.web',
        'action': 'FY_BY_CLICKBUTTON'
      }).toString();

      const response = httpPostSync(url, body, {
        'Content-Type': 'application/x-www-form-urlencoded'
      });

      if (response && response.statusCode === 200) {
        const result = JSON.parse(response.data.toString('utf8'));
        if (result.translateResult && result.translateResult[0] && result.translateResult[0][0]) {
          const translation = result.translateResult[0][0].tgt;
          if (translation && translation !== text) {
            return translation;
          }
        }
      }
    } catch (e) {
      if(DEBUG)console.log(`有道翻译备用方案出错: ${e}`);
    }

    return null;
  }
}

//  同步 HTTP 辅助函数 
//  使用 child_process.execFileSync + curl 参数数组，避免命令注入
//  curl 在 Windows 10+ 和所有主流平台均可用

function httpGetSync(url: string, timeout: number = 10000): HttpResponse | null {
  const tmpFile = path.join(CACHE_DIR, `_http_tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.dat`);
  const timeoutSec = Math.ceil(timeout / 1000);

  try {
    const { execFileSync } = require('child_process');
    const args = [
      '-s', '-L', '-o', tmpFile, '-w', '%{http_code}',
      '--connect-timeout', String(timeoutSec),
      '--max-time', String(timeoutSec),
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      url,
    ];
    const statusCode = execFileSync('curl', args, {
      timeout: timeout + 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    const code = parseInt(statusCode, 10);
    let data = Buffer.alloc(0);
    if (fs.existsSync(tmpFile)) {
      data = fs.readFileSync(tmpFile);
    }
    return { statusCode: code, data, headers: {} };
  } catch (e) {
    return null;
  } finally {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
  }
}

function httpPostSync(url: string, body: string, headers: Record<string, string> = {}, timeout: number = 10000): HttpResponse | null {
  const tmpOutput = path.join(CACHE_DIR, `_http_tmp_out_${Date.now()}_${Math.random().toString(36).slice(2)}.dat`);
  const tmpBody = path.join(CACHE_DIR, `_http_tmp_body_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  const timeoutSec = Math.ceil(timeout / 1000);

  try {
    const { execFileSync } = require('child_process');
    // 将请求体写入临时文件
    fs.writeFileSync(tmpBody, body, 'utf8');

    // 构建参数数组（每个参数独立，防止命令注入）
    const args = [
      '-s', '-X', 'POST',
      '-d', `@${tmpBody}`,
      '-o', tmpOutput,
      '-w', '%{http_code}',
      '--connect-timeout', String(timeoutSec),
      '--max-time', String(timeoutSec),
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    ];
    for (const [key, value] of Object.entries(headers)) {
      args.push('-H', `${key}: ${value}`);
    }
    args.push(url);

    const statusCode = execFileSync('curl', args, {
      timeout: timeout + 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    const code = parseInt(statusCode, 10);
    let data = Buffer.alloc(0);
    if (fs.existsSync(tmpOutput)) {
      data = fs.readFileSync(tmpOutput);
    }
    return { statusCode: code, data, headers: {} };
  } catch (e) {
    return null;
  } finally {
    try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch {}
    try { if (fs.existsSync(tmpBody)) fs.unlinkSync(tmpBody); } catch {}
  }
}

//  单例模式 

let ttsInstance: TencentTTS | null = null;

export function initTTS(pronunciationsDir: string, cacheDir: string): TencentTTS {
  ttsInstance = new TencentTTS(pronunciationsDir, cacheDir);
  return ttsInstance;
}

export function getTTS(): TencentTTS | null {
  return ttsInstance;
}