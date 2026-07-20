/**
 * 使用 Transformers.js 下载语义相似度模型并打包为分卷 7z
 * 模型：shibing624/text2vec-base-chinese (ONNX q8)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MODEL_DIR = path.join(__dirname, '..', 'semantic-model-files');
const OUTPUT_DIR = path.join(__dirname, '..', 'gitee-assets');

async function main() {
  console.log('=== 使用 Transformers.js 下载语义相似度模型 ===\n');

  // 设置缓存目录到我们的目标目录
  process.env.TRANSFORMERS_CACHE = MODEL_DIR;

  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = MODEL_DIR;
  env.allowLocalModels = false;

  console.log('开始下载模型 shibing624/text2vec-base-chinese (q8)...');
  const start = Date.now();

  try {
    const extractor = await pipeline('feature-extraction', 'shibing624/text2vec-base-chinese', {
      dtype: 'q8',
    });
    console.log(`模型下载完成，耗时 ${Date.now() - start}ms`);
  } catch (err) {
    console.error('模型下载失败:', err.message);
    process.exit(1);
  }

  // 列出已下载的文件和大小
  console.log('\n=== 已下载文件 ===');
  let totalSize = 0;
  function listFiles(dir, prefix = '') {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        listFiles(fullPath, prefix + entry.name + '/');
      } else {
        const size = fs.statSync(fullPath).size;
        totalSize += size;
        console.log(`  ${prefix}${entry.name}: ${size} bytes`);
      }
    }
  }
  listFiles(MODEL_DIR);
  console.log(`\n总计: ${totalSize} bytes (${(totalSize / 1024 / 1024).toFixed(1)} MB)`);

  // 打包为分卷 7z（每卷 100MB）
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const archiveName = 'semantic-model.7z';
  const archivePath = path.join(OUTPUT_DIR, archiveName);

  // 删除旧的分卷文件
  const oldParts = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith('semantic-model.7z.'));
  oldParts.forEach(f => fs.unlinkSync(path.join(OUTPUT_DIR, f)));

  console.log(`\n=== 打包为 7z (分卷 100MB) ===`);
  try {
    execSync(`7z a -mx=5 -v100m "${archivePath}" "${MODEL_DIR}\\*"`, { stdio: 'inherit' });
  } catch {
    // 7z 分卷打包返回码可能非0但文件已生成
  }

  // 列出分卷文件
  console.log('\n=== 分卷文件 ===');
  const parts = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('semantic-model.7z.'))
    .sort();

  let partTotal = 0;
  for (const part of parts) {
    const size = fs.statSync(path.join(OUTPUT_DIR, part)).size;
    partTotal += size;
    console.log(`  ${part}: ${size} bytes`);
  }
  console.log(`\n分卷总计: ${partTotal} bytes (${(partTotal / 1024 / 1024).toFixed(1)} MB)`);

  console.log('\n=== 完成 ===');
  console.log(`模型文件目录: ${MODEL_DIR}`);
  console.log(`分卷输出目录: ${OUTPUT_DIR}`);
  console.log(`\n请上传以下文件到 Gitee Release:`);
  for (const part of parts) {
    console.log(`  ${part}`);
  }
}

main().catch(console.error);
