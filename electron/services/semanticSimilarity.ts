// 中文语义相似度判断模块
// 使用 Transformers.js 加载本地预训练模型，判断两段中文文本的语义相似度

import { pipeline, env, cos_sim } from '@huggingface/transformers';
import * as path from 'path';
import * as fs from 'fs';
import { CACHE_DIR, resolveAssetPath } from '../utils/helpers';

// 模型缓存目录
const MODEL_CACHE_DIR = path.join(CACHE_DIR, 'transformers_models');
if (!fs.existsSync(MODEL_CACHE_DIR)) {
  fs.mkdirSync(MODEL_CACHE_DIR, { recursive: true });
}

// 配置 Transformers.js 使用本地缓存
env.cacheDir = MODEL_CACHE_DIR;
env.allowLocalModels = true;

// 使用本地模型路径(通过assets系统下载或打包在应用内)
const MODEL_PATH = resolveAssetPath('semantic-model-files');

let featureExtractor: any = null;
let modelLoadingPromise: Promise<any> | null = null;
let modelLoadFailed = false;

/**
 * 加载特征提取模型（懒加载，只加载一次）
 */
async function loadModel() {
  if (featureExtractor) return featureExtractor;
  if (modelLoadFailed) return null;
  if (modelLoadingPromise) return modelLoadingPromise;

  modelLoadingPromise = (async () => {
    // 检查本地模型目录是否存在
    if (!fs.existsSync(MODEL_PATH)) {
      console.warn('[SemanticSimilarity] 本地模型目录不存在:', MODEL_PATH);
      console.warn('[SemanticSimilarity] 请在设置中下载「语义相似度模型」');
      modelLoadFailed = true;
      return null;
    }

    console.log('[SemanticSimilarity] 开始加载本地模型:', MODEL_PATH);
    const start = Date.now();

    try {
      featureExtractor = await pipeline('feature-extraction', MODEL_PATH, {
        dtype: 'fp32',
      });
      console.log(`[SemanticSimilarity] 模型加载完成，耗时 ${Date.now() - start}ms`);
      return featureExtractor;
    } catch (err) {
      console.error('[SemanticSimilarity] 模型加载失败:', err);
      modelLoadingPromise = null;
      modelLoadFailed = true;
      return null;
    }
  })();

  return modelLoadingPromise;
}

/**
 * 计算两段文本的余弦相似度
 * @param text1 第一段文本
 * @param text2 第二段文本
 * @returns 相似度分数（0-1之间），失败返回 null
 */
export async function calculateSimilarity(text1: string, text2: string): Promise<number | null> {
  try {
    const extractor = await loadModel();
    if (!extractor) return null;

    // 分别获取两个文本的嵌入向量
    const [output1, output2] = await Promise.all([
      extractor(text1, { pooling: 'mean', normalize: true }),
      extractor(text2, { pooling: 'mean', normalize: true }),
    ]);

    // 计算余弦相似度
    const vec1 = Array.from(output1.data as Float32Array);
    const vec2 = Array.from(output2.data as Float32Array);

    return cos_sim(vec1, vec2);
  } catch (err) {
    console.error('[SemanticSimilarity] 计算相似度失败:', err);
    return null;
  }
}

/**
 * 判断两段文本是否语义相似
 * @param userInput 用户输入
 * @param correctAnswer 正确答案
 * @param threshold 相似度阈值（默认0.60）
 * @returns 是否相似，模型不可用时返回 false
 */
export async function checkSemanticSimilarity(
  userInput: string,
  correctAnswer: string,
  threshold: number = 0.60
): Promise<boolean> {
  const similarity = await calculateSimilarity(userInput, correctAnswer);
  if (similarity === null) return false;
  console.log(`[SemanticSimilarity] "${userInput}" vs "${correctAnswer}" = ${similarity.toFixed(3)} (阈值: ${threshold})`);
  return similarity >= threshold;
}

/**
 * 预加载模型（可选，在应用启动时调用）
 */
export async function preloadModel(): Promise<void> {
  try {
    await loadModel();
  } catch (err) {
    console.error('[SemanticSimilarity] 预加载模型失败:', err);
  }
}
