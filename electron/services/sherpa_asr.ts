import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ROOT_DIR, ASSETS_DIR, resolveAssetPath } from '../utils/helpers';
import { downloadAsset, isAssetAvailable } from './asset-manager';

const PROJECT_MODEL_DIR = resolveAssetPath('sherpa-onnx-sense-voice-zh-en-ja-ko-yue');

// Sherpa-ONNX C++ 在 Windows 上读不了含中文的路径，把模型放到纯 ASCII 路径下
const ASCII_MODEL_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'sherpa-onnx-sensevoice');

let sherpaOnnx: any = null;
let recognizer: any = null;

const MODEL_FILES = ['model.int8.onnx', 'tokens.txt'];

async function ensureModelDownloaded(): Promise<void> {
    // 优先检查安装包/下载目录是否已有可用模型，避免打包后仍尝试下载
    if (isAssetAvailable('sherpa-onnx-sense-voice')) {
        // 清理可能残留的损坏分卷临时文件，防止后续触发无效解压
        const partDir = path.join(ASSETS_DIR, '.downloads', 'sherpa-onnx-sense-voice');
        if (fs.existsSync(partDir)) {
            try { fs.rmSync(partDir, { recursive: true, force: true }); } catch {}
        }
        return;
    }

    // 安装包中没有且未下载完成，才尝试下载
    try {
        await downloadAsset('sherpa-onnx-sense-voice');
    } catch (e: any) {
        console.error('[sherpa] 模型下载失败:', e.message);
    }
}

function getModelDir(): string {
    // 如果项目目录不含中文，优先用项目内/已下载模型（便于打包/迁移）
    if (!/[\u4e00-\u9fa5]/.test(PROJECT_MODEL_DIR)) {
        return PROJECT_MODEL_DIR;
    }

    // 项目路径含中文：看 ASCII 目录有没有，没有就从项目目录复制过去
    const asciiReady = MODEL_FILES.every(f => fs.existsSync(path.join(ASCII_MODEL_DIR, f)));
    if (asciiReady) {
        return ASCII_MODEL_DIR;
    }

    const projectReady = MODEL_FILES.every(f => fs.existsSync(path.join(PROJECT_MODEL_DIR, f)));
    if (projectReady) {
        copyModelToAsciiDir();
        return ASCII_MODEL_DIR;
    }

    return PROJECT_MODEL_DIR;
}

function copyModelToAsciiDir(): void {
    if (!fs.existsSync(ASCII_MODEL_DIR)) {
        fs.mkdirSync(ASCII_MODEL_DIR, { recursive: true });
    }

    console.log(`[sherpa] 项目路径含中文，正在复制模型到 ASCII 路径: ${ASCII_MODEL_DIR}`);
    for (const f of MODEL_FILES) {
        const src = path.join(PROJECT_MODEL_DIR, f);
        const dst = path.join(ASCII_MODEL_DIR, f);
        if (!fs.existsSync(dst) && fs.existsSync(src)) {
            console.log(`[sherpa] 复制 ${f} ...`);
            fs.copyFileSync(src, dst);
        }
    }
    console.log('[sherpa] 模型复制完成');
}

function getSherpaModule(): any {
  if (sherpaOnnx) return sherpaOnnx;
  try {
    sherpaOnnx = require('sherpa-onnx-node');
    return sherpaOnnx;
  } catch (e: any) {
    throw new Error(`sherpa-onnx-node 加载失败: ${e.message}`);
  }
}

function getModelPaths() {
  const dir = getModelDir();
  return {
    model: path.join(dir, 'model.int8.onnx'),
    tokens: path.join(dir, 'tokens.txt'),
  };
}

export async function isSherpaModelReady(): Promise<boolean> {
  try {
    getSherpaModule();
  } catch {
    return false;
  }
  await ensureModelDownloaded();
  const { model, tokens } = getModelPaths();
  return fs.existsSync(model) && fs.existsSync(tokens);
}

export async function initSherpaRecognizer(): Promise<void> {
  if (recognizer) return;
  await ensureModelDownloaded();
  if (!(await isSherpaModelReady())) {
    throw new Error('SenseVoice 模型未找到，请下载 sherpa-onnx-sense-voice-zh-en-ja-ko-yue 模型');
  }

  const mod = getSherpaModule();
  const { model, tokens } = getModelPaths();

  recognizer = new mod.OfflineRecognizer({
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig: {
      senseVoice: {
        model,
        useItn: true,
        language: 'auto',
      },
      tokens,
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
  });
}

function base64ToFloat32Samples(b64: string): Float32Array {
  const raw = Buffer.from(b64, 'base64');
  const int16 = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export async function recognizeWithSherpa(base64Pcm: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!base64Pcm || base64Pcm.length < 100) {
    return { ok: true, text: '' };
  }

  let stream: any = null;
  try {
    await initSherpaRecognizer();
    const samples = base64ToFloat32Samples(base64Pcm);

    stream = recognizer.createStream();
    stream.acceptWaveform({ samples, sampleRate: 16000 });
    recognizer.decode(stream);
    const result = recognizer.getResult(stream);

    return { ok: true, text: result.text || '' };
  } catch (e: any) {
    return { ok: false, error: e.message || 'Sherpa 识别失败' };
  } finally {
    if (stream) {
      try { stream.destroy?.(); } catch {}
      try { stream.free?.(); } catch {}
    }
  }
}
