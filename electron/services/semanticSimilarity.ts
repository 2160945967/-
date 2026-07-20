// 中文语义相似度判断模块
// 使用 Transformers.js 加载本地预训练模型，判断两段中文文本的语义相似度

import { pipeline, env, cos_sim } from '@huggingface/transformers';
import * as path from 'path';
import * as fs from 'fs';
import { CACHE_DIR } from '../utils/helpers';

// 模型缓存目录
const MODEL_CACHE_DIR = path.join(CACHE_DIR, 'transformers_models');
if (!fs.existsSync(MODEL_CACHE_DIR)) {
  fs.mkdirSync(MODEL_CACHE_DIR, { recursive: true });
}

// 配置 Transformers.js 使用本地缓存
env.cacheDir = MODEL_CACHE_DIR;
env.allowLocalModels = true;

// 使用 ONNX 格式的中文句子嵌入模型
const MODEL_ID = 'shibing624/text2vec-base-chinese';

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
    console.log('[SemanticSimilarity] 开始加载模型:', MODEL_ID);
    const start = Date.now();

    try {
      featureExtractor = await pipeline('feature-extraction', MODEL_ID, {
        dtype: 'q8', // 量化版本，更小更快
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
 * @param threshold 相似度阈值（默认0.85）
 * @returns 是否相似，模型不可用时返回 false
 */
export async function checkSemanticSimilarity(
  userInput: string,
  correctAnswer: string,
  threshold: number = 0.85
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
