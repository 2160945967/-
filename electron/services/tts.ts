import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
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
  private _edgeTtsModule: any = null;
  private _edgeTtsImportTried = false;

  constructor(pronunciationsDir: string, cacheDir: string) {
    this.pronunciationsDir = pronunciationsDir;
    this.cacheDir = cacheDir;
    this.audioCacheDir = path.join(cacheDir, 'audio');

    // 硬编码腾讯云密钥
    this.secretId = TENCENT_SECRET_ID;
    this.secretKey = TENCENT_SECRET_KEY;

    if(DEBUG)console.log('腾讯云密钥已设置');

    this.currentVoiceIdx = { 'us': 0, 'uk': 0 };

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
    audioData = await this.tencentCloudTTS(processedWord, accent);
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

    // 句子链按「当前国内网络实测可用性」排序：
    // 1. 百度 gettts：国内直连、亚秒级、实测可合成整句（旧 text2audio 英文引擎已停用，baiduTTS 内已切换）
    if(DEBUG)console.log(`【句子发音】尝试 百度gettts: ${phrase.substring(0, 50)}`);
    let audioData = await this.baiduTTS(phrase, accent);
    if (audioData && this.saveWithProvider(audioData, filepath, 'baidu')) {
      return filepath;
    }

    // 2. 有道 dictvoice：词典短语 / 常用句可合成；连续请求易被限流（HTTP 500），失败安全跳过
    if(DEBUG)console.log(`【句子发音】尝试 有道TTS: ${phrase.substring(0, 50)}`);
    audioData = await this.youdaoTTS(phrase, accent);
    if (audioData && this.saveWithProvider(audioData, filepath, 'youdao')) {
      return filepath;
    }

    // 3. Edge TTS：免费、音质最自然；微软语音端点在国内网络常被重置（ECONNRESET），外网 / 代理时作为优质兜底
    if(DEBUG)console.log(`【句子发音】尝试 Edge TTS: ${phrase.substring(0, 50)}`);
    audioData = await this.edgeTTS(phrase, accent);
    if (audioData && this.saveWithProvider(audioData, filepath, 'edge')) {
      return filepath;
    }

    // 4. 腾讯云TTS：音质好，但需语音资源包有效；账号额度用尽（PkgExhausted）时自动跳过
    if(DEBUG)console.log(`【句子发音】尝试 腾讯云TTS: ${phrase.substring(0, 50)}`);
    audioData = await this.tencentCloudTTS(phrase, accent);
    if (audioData && this.saveWithProvider(audioData, filepath, 'tencent')) {
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
      // 旧 text2audio 免费端点英文引擎已停（实测稳定 503「jtts engine」/中文报缺 pid），
      // 改用百度翻译网页 gettts：国内直连、无需鉴权，实测单词与整句均可合成；失败仍按首字节/状态码跳过
      const url = `https://fanyi.baidu.com/gettts?lan=en&text=${wordEncoded}&spd=3&source=web`;

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

  // Edge TTS（使用项目依赖的 edge-tts 库直连微软语音服务）
  // 旧实现 spawn `npx edge-tts` 调 CLI，但 npm 版 edge-tts 是纯库、package.json 没有 bin，
  // 该命令在任何机器上都会报 "could not determine executable to run"，句子发音的 Edge 兜底从未生效

  // CJS 产物里必须保留运行时原生 import()：TS 编译到 commonjs 会把 await import() 降级成 require，
  // 而 edge-tts 是 ESM-only，require 会抛 ERR_REQUIRE_ESM；用 Function 构造器绕过编译降级
  private _dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

  private async loadEdgeTts(): Promise<any | null> {
    if (this._edgeTtsImportTried) return this._edgeTtsModule;
    this._edgeTtsImportTried = true;
    try {
      // Electron 28 子进程是 Node 18，全局 Web Crypto（globalThis.crypto）到 Node 19 才默认可用，
      // edge-tts 库内部直接用全局 crypto 生成令牌，缺失时会 ReferenceError: crypto is not defined
      const g = globalThis as any;
      if (typeof g.crypto === 'undefined' || !g.crypto || typeof g.crypto.subtle === 'undefined') {
        g.crypto = require('crypto').webcrypto;
      }
      // 包的 main 指向 index.ts（Node 无法执行 TS），显式指定其编译产物
      this._edgeTtsModule = await this._dynamicImport('edge-tts/out/index.js');
      if (DEBUG) console.log('Edge TTS 库加载成功');
    } catch (e) {
      if (DEBUG) console.log(`Edge TTS 库加载失败: ${e}`);
      this._edgeTtsModule = null;
    }
    return this._edgeTtsModule;
  }

  private async edgeTTS(text: string, accent: string): Promise<Buffer | null> {
    const mod = await this.loadEdgeTts();
    if (!mod || typeof mod.tts !== 'function') return null;
    const voice = accent === 'uk' ? 'en-GB-SoniaNeural' : 'en-US-AriaNeural';
    try {
      if(DEBUG)console.log(`使用Edge TTS (voice=${voice}): ${text.substring(0, 80)}`);

      const audioData: Buffer = await Promise.race([
        mod.tts(text, { voice }),
        new Promise<Buffer>((_, reject) => setTimeout(() => reject(new Error('Edge TTS 超时(10s)')), 10000)),
      ]);

      if (audioData && audioData.length > 100) {
        if(DEBUG)console.log(`Edge TTS生成成功 (${audioData.length} bytes)`);
        return audioData;
      }
      if(DEBUG)console.log('Edge TTS返回数据过小');
      return null;
    } catch (e) {
      if(DEBUG)console.log(`Edge TTS出错: ${e}`);
      return null;
    }
  }

  // 腾讯云 TTS

  private async tencentCloudTTS(text: string, accent: string): Promise<Buffer | null> {
    const voiceList = TTS_VOICE_TYPES[accent] || TTS_VOICE_TYPES['us'];
    const startIdx = this.currentVoiceIdx[accent] || 0;

    for (let i = startIdx; i < voiceList.length; i++) {
      const config = voiceList[i];
      try {
        if(DEBUG)console.log(`使用腾讯云TTS (${config.name}, accent=${accent}): ${text}`);

        const audioData = await this.tencentCloudTTSRaw(text, config.voiceType, 'mp3', 16000);

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

  private async tencentCloudTTSRaw(
    text: string,
    voiceType: number,
    codec: string = 'mp3',
    sampleRate: number = 16000
  ): Promise<Buffer | null> {
    if (!this.secretId || !this.secretKey) return null; // 未配置腾讯密钥，跳过
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
      const response = await httpPostAsync(url, payload, signResult.headers);

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
}

//  异步 HTTP 辅助函数（腾讯云 TTS 兜底链路专用）
//  使用 child_process.execFile + curl 参数数组，避免命令注入且不阻塞事件循环
//  请求参数、超时与失败语义与原同步实现完全一致，仅改为非阻塞异步

function httpPostAsync(url: string, body: string, headers: Record<string, string> = {}, timeout: number = 10000): Promise<HttpResponse | null> {
  const tmpOutput = path.join(CACHE_DIR, `_http_tmp_out_${Date.now()}_${Math.random().toString(36).slice(2)}.dat`);
  const tmpBody = path.join(CACHE_DIR, `_http_tmp_body_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  const timeoutSec = Math.ceil(timeout / 1000);

  return new Promise((resolve) => {
    const { execFile } = require('child_process');
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

    execFile('curl', args, {
      timeout: timeout + 5000, encoding: 'utf8'
    }, (err: Error | null, stdout: string) => {
      try {
        if (err) {
          resolve(null);
          return;
        }
        const code = parseInt(stdout.trim(), 10);
        let data = Buffer.alloc(0);
        if (fs.existsSync(tmpOutput)) {
          data = fs.readFileSync(tmpOutput);
        }
        resolve({ statusCode: code, data, headers: {} });
      } catch (e) {
        resolve(null);
      } finally {
        try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch {}
        try { if (fs.existsSync(tmpBody)) fs.unlinkSync(tmpBody); } catch {}
      }
    });
  });
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