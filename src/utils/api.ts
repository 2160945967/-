// API request wrapper: unified fetch logic for all backend endpoints
// 底层基于原生 fetch（项目未使用 axios）。统一分级超时（AbortController）：
//   - 普通接口 15s；
//   - 语义相似度接口（/api/semantic-similarity，本地 sherpa-onnx 模型推理较慢）60s。
// 识别方式：按 URL 路径自动判定（见 isSemanticEndpoint），调用方函数签名保持不变。
// 超时通过 AbortController 中止 fetch 并抛错，走现有 parseResponse/throw 路径，
// 由各调用方 try/catch 提示，不会永久转圈。

const DEFAULT_TIMEOUT_MS = 15000;
const SEMANTIC_TIMEOUT_MS = 60000;

function isSemanticEndpoint(url: string): boolean {
  return url.indexOf('/api/semantic-similarity') !== -1;
}

function timeoutFor(url: string): number {
  return isSemanticEndpoint(url) ? SEMANTIC_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutFor(url));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err: any) {
    if (err && err.name === 'AbortError') {
      const sec = Math.round(timeoutFor(url) / 1000);
      throw new Error(`请求超时（${sec}s）：${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function apiGet<T = any>(url: string): Promise<T> {
  const response = await fetchWithTimeout(url);
  return parseResponse<T>(response);
}

export async function apiPost<T = any>(url: string, body: any): Promise<T> {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

export async function apiPostForm<T = any>(url: string, formData: FormData): Promise<T> {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    body: formData
  });
  return parseResponse<T>(response);
}

export async function apiTranslate(text: string): Promise<{ success: boolean; translation?: string; error?: string; cached?: boolean; is_from_dict?: boolean; input_type?: string }> {
  return apiPost('/api/translate', { text });
}