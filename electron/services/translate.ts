import * as crypto from 'crypto';
import * as https from 'https';
import { LRUCache } from '../utils/cache';
import { TENCENT_SECRET_ID, TENCENT_SECRET_KEY } from '../config';

const TMT_HOST = 'tmt.tencentcloudapi.com';
const TMT_SERVICE = 'tmt';
const TMT_ACTION = 'TextTranslate';
const TMT_VERSION = '2018-03-21';

// ---------------------------------------------------------------------------
// LRU translation cache
// ---------------------------------------------------------------------------
const translationCache = new LRUCache<string>(500);

// ---------------------------------------------------------------------------
// TC3-HMAC-SHA256 signing helpers
// ---------------------------------------------------------------------------

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function hmacSha256Hex(key: Buffer | string, data: string): string {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

/**
 * Build the TC3-HMAC-SHA256 Authorization header and signed request.
 */
function buildTc3Request(payload: string, timestamp: number, secretId: string, secretKey: string): { authorization: string; headers: Record<string, string> } {
  // TC3 requires YYYY-MM-DD format
  const dateStr = new Date(timestamp * 1000).toISOString().slice(0, 10);

  // Step 1: Build canonical request
  const httpRequestMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${TMT_HOST}\n`;
  const signedHeaders = 'content-type;host';
  const hashedRequestPayload = sha256Hex(payload);

  const canonicalRequest = [
    httpRequestMethod,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload,
  ].join('\n');

  // Step 2: Build string to sign
  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = `${dateStr}/${TMT_SERVICE}/tc3_request`;
  const hashedCanonicalRequest = sha256Hex(canonicalRequest);

  const stringToSign = [
    algorithm,
    String(timestamp),
    credentialScope,
    hashedCanonicalRequest,
  ].join('\n');

  // Step 3: Calculate signature
  const secretDate = hmacSha256(`TC3${secretKey}`, dateStr);
  const secretService = hmacSha256(secretDate, TMT_SERVICE);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = hmacSha256Hex(secretSigning, stringToSign);

  // Step 4: Build authorization header
  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    authorization,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Host': TMT_HOST,
      'X-TC-Action': TMT_ACTION,
      'X-TC-Version': TMT_VERSION,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': 'ap-guangzhou',
      'Authorization': authorization,
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP POST helpers
// ---------------------------------------------------------------------------

function httpPost(
  hostname: string,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers,
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => resolve(data));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tencent Cloud translation
// ---------------------------------------------------------------------------

async function tencentTranslate(text: string, secretId?: string, secretKey?: string, source: string = 'en', target: string = 'zh'): Promise<string | null> {
  const timestamp = Math.floor(Date.now() / 1000);
  const sid = secretId || TENCENT_SECRET_ID;
  const skey = secretKey || TENCENT_SECRET_KEY;

  const payload = JSON.stringify({
    SourceText: text,
    Source: source,
    Target: target,
    ProjectId: 0,
  });

  const { authorization, headers } = buildTc3Request(payload, timestamp, sid, skey);

  try {
    const responseBody = await httpPost(TMT_HOST, '/', headers, payload);
    const result = JSON.parse(responseBody);

    if (result.Response && result.Response.TargetText) {
      return result.Response.TargetText;
    }

    if (result.Response && result.Response.Error) {
      console.error('[TencentTranslate] 翻译接口返回错误:', JSON.stringify(result.Response.Error));
      return null;
    }

    console.log('[TencentTranslate] 未知响应:', responseBody.slice(0, 200));
    return null;
  } catch (err) {
    console.error('[TencentTranslate] 翻译请求失败:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Youdao web translate (fallback)
// ---------------------------------------------------------------------------

async function youdaoTranslate(text: string, fromLang: string = 'en', toLang: string = 'zh-CHS'): Promise<string | null> {
  const qs = new URLSearchParams({
    i: text,
    from: fromLang,
    to: toLang,
    smartresult: 'dict',
    client: 'fanyideskweb',
    doctype: 'json',
    version: '2.1',
    keyfrom: 'fanyi.web',
    action: 'FY_BY_CLICKBUTTON',
    typoResult: 'false',
  });

  const body = qs.toString();

  try {
    const responseBody = await httpPost(
      'fanyi.youdao.com',
      '/translate_o?smartresult=dict&smartresult=rule',
      {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Content-Length': String(Buffer.byteLength(body)),
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://fanyi.youdao.com/',
      },
      body,
    );

    const result = JSON.parse(responseBody);

    if (result.translateResult && result.translateResult.length > 0) {
      const tgt = result.translateResult[0][0].tgt;
      if (tgt && tgt !== text) {
        return tgt;
      }
    }

    return null;
  } catch (err) {
    console.error('[YoudaoTranslate] 翻译请求失败:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// MyMemory free translation API (no auth required)
// ---------------------------------------------------------------------------

async function myMemoryTranslate(text: string, source: string = 'en', target: string = 'zh-CN'): Promise<string | null> {
  try {
    const url = `/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}&de=app@example.com`;
    const responseBody = await httpGet('api.mymemory.translated.net', url, 10000);
    if (!responseBody) return null;

    const result = JSON.parse(responseBody);
    if (result && result.responseData && result.responseData.translatedText) {
      const translated = result.responseData.translatedText;
      if (translated && translated !== text && translated.trim().length > 0) {
        return translated.trim();
      }
    }
    return null;
  } catch (err) {
    console.error('[MyMemoryTranslate] 翻译请求失败:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Simple HTTP GET helper (for translation)
// ---------------------------------------------------------------------------

function httpGet(
  hostname: string,
  path: string,
  timeout: number = 10000,
): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
        },
        timeout,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => resolve(data));
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** 从共享缓存读取翻译（供 routes 导出等场景复用） */
export function getCachedTranslation(text: string): string | undefined {
  return translationCache.get(text);
}

/** 写入共享翻译缓存 */
export function putCachedTranslation(text: string, value: string): void {
  translationCache.put(text, value);
}

/** 导出缓存数据用于持久化 */
export function getTranslationCacheData(): Record<string, string> {
  return translationCache.toJSON();
}

/** 清空翻译缓存 */
export function clearTranslationCache(): void {
  translationCache.clear();
}

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(text);
}

/**
 * 自动判断翻译方向：含中文则中译英，否则英译中。
 * Tries Tencent Cloud -> Youdao -> MyMemory. Returns empty string as last resort.
 * Results are cached via LRU cache.
 * 可选传入 secretId/secretKey 使用自定义腾讯云密钥，否则使用默认配置。
 */
export async function translateText(text: string, secretId?: string, secretKey?: string): Promise<string> {
  if (!text) return text;

  const isZh2En = hasChinese(text);

  // Check cache
  const cached = translationCache.get(text);
  if (cached !== undefined) {
    return cached;
  }

  // Try Tencent Cloud
  const tcResult = isZh2En
    ? await tencentTranslate(text, secretId, secretKey, 'zh', 'en')
    : await tencentTranslate(text, secretId, secretKey, 'en', 'zh');
  if (tcResult !== null && tcResult !== text && tcResult.trim().length > 0) {
    translationCache.put(text, tcResult);
    return tcResult;
  }

  // Fallback to Youdao
  const ydResult = isZh2En
    ? await youdaoTranslate(text, 'zh-CHS', 'en')
    : await youdaoTranslate(text, 'en', 'zh-CHS');
  if (ydResult !== null && ydResult !== text && ydResult.trim().length > 0) {
    translationCache.put(text, ydResult);
    return ydResult;
  }

  // Fallback to MyMemory
  const mmResult = isZh2En
    ? await myMemoryTranslate(text, 'zh-CN', 'en')
    : await myMemoryTranslate(text, 'en', 'zh-CN');
  if (mmResult !== null && mmResult !== text && mmResult.trim().length > 0) {
    translationCache.put(text, mmResult);
    return mmResult;
  }

  // 所有翻译都失败，缓存空结果避免重复请求
  translationCache.put(text, '');
  return '';
}