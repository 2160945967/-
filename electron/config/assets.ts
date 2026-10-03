/**
 * 可选 / 可下载资源清单
 *
 * 说明：
 * - required: 应用启动必需，缺失时自动下载（如词典数据库）
 * - optional: 使用到对应功能时才下载（如听力音频、例句库、语音识别模型）
 *
 * 资源按 Gitee Release 附件 100MB 限制做成分卷 7z：
 * - 词典 / 例句 / 模型位于主仓库 V2.0 Release；
 * - 四级听力 3.56GB 超过单仓库附件 1GB 上限，分卷位于 4 个配套资源仓库
 *   （pick-up-words-audio-1..4，每个仓库 Release v1.0）。
 */

export interface AssetPart {
  /** 分卷文件名，如 stardict.7z.001 */
  filename: string;
  /** 分卷下载地址 */
  url: string;
  /** 分卷大小（字节） */
  size: number;
}

export interface AssetItem {
  id: string;
  name: string;
  /** 远程下载地址（单文件资源使用；分卷资源可省略） */
  url?: string;
  /** 镜像/备用下载地址（单文件资源使用） */
  mirrors?: string[];
  /** 本地相对 assets 目录的路径（解压/下载后的最终文件或文件夹） */
  localPath: string;
  /** 是否启动必需 */
  required: boolean;
  /** 文件总大小（字节），用于显示进度；0 表示未知 */
  size: number;
  /** 校验用 MD5（可选） */
  md5?: string;
  /** 校验用 SHA256（可选，优先级高于 md5） */
  sha256?: string;
  /** 分卷列表；配置后按多卷下载、合并、解压 */
  parts?: AssetPart[];
}

export interface AssetGroup {
  id: string;
  name: string;
  description: string;
  items: AssetItem[];
}

// 主资源 Release 基地址，可在环境变量 ASSETS_BASE_URL 中整体替换（如自建镜像）
const MAIN_BASE =
  process.env.ASSETS_BASE_URL ||
  'https://gitee.com/yangs-project/pick-up-words/releases/download/V2.0';

function mainUrl(file: string): string {
  return `${MAIN_BASE.replace(/\/$/, '')}/${file}`;
}

const VOL = 99_614_720; // 标准分卷 95MB

/** 四级听力 39 卷，每 10 卷一个配套资源仓库 */
function listeningParts(): AssetPart[] {
  const parts: AssetPart[] = [];
  for (let n = 1; n <= 39; n++) {
    const vol = String(n).padStart(3, '0');
    const repo = Math.floor((n - 1) / 10) + 1;
    const file = `cet4-listening.7z.${vol}`;
    parts.push({
      filename: file,
      url: `https://gitee.com/yangs-project/pick-up-words-audio-${repo}/releases/download/v1.0/${file}`,
      size: n === 39 ? 35_226_703 : VOL,
    });
  }
  return parts;
}

export const ASSET_GROUPS: AssetGroup[] = [
  {
    id: 'dictionary',
    name: '词典数据',
    description: '查词必需的核心词典数据库',
    items: [
      {
        id: 'stardict.db',
        name: 'StarDict 词典库',
        localPath: 'stardict.db',
        required: true,
        size: 156_594_244,
        parts: [
          { filename: 'stardict.7z.001', url: mainUrl('stardict.7z.001'), size: VOL },
          { filename: 'stardict.7z.002', url: mainUrl('stardict.7z.002'), size: 56_979_524 },
        ],
      },
    ],
  },
  {
    id: 'listening',
    name: '四级听力音频',
    description: '四级听力 100 套录音（约 3.56GB 分卷，4 个资源仓库）',
    items: [
      {
        id: 'cet4-listening',
        name: '四级听力音频',
        localPath: 'CET4_Listening_Bank',
        required: false,
        size: 3_820_586_063,
        parts: listeningParts(),
      },
    ],
  },
  {
    id: 'examples',
    name: '例句数据',
    description: '单词双语例句库',
    items: [
      {
        id: 'examples.db',
        name: '双语例句库',
        localPath: 'examples.db',
        required: false,
        size: 205_499_801,
        parts: [
          { filename: 'examples.7z.001', url: mainUrl('examples.7z.001'), size: VOL },
          { filename: 'examples.7z.002', url: mainUrl('examples.7z.002'), size: VOL },
          { filename: 'examples.7z.003', url: mainUrl('examples.7z.003'), size: 6_270_361 },
        ],
      },
    ],
  },
  {
    id: 'sherpa',
    name: '语音识别模型',
    description: '语音输入识别所需的 SenseVoice 模型',
    items: [
      {
        id: 'sherpa-onnx-sense-voice',
        name: 'SenseVoice 模型',
        localPath: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue',
        required: false,
        size: 154_374_057,
        parts: [
          { filename: 'sherpa-model.7z.001', url: mainUrl('sherpa-model.7z.001'), size: VOL },
          { filename: 'sherpa-model.7z.002', url: mainUrl('sherpa-model.7z.002'), size: 54_759_337 },
        ],
      },
    ],
  },
  {
    id: 'semantic',
    name: '语义相似度模型',
    description: '多释义智能判别的中文语义模型（text2vec-base-chinese）',
    items: [
      {
        id: 'semantic-model',
        name: '语义相似度模型',
        localPath: 'semantic-model-files',
        required: false,
        size: 374_570_780,
        parts: [
          { filename: 'semantic-model.7z.001', url: mainUrl('semantic-model.7z.001'), size: 104_857_600 },
          { filename: 'semantic-model.7z.002', url: mainUrl('semantic-model.7z.002'), size: 104_857_600 },
          { filename: 'semantic-model.7z.003', url: mainUrl('semantic-model.7z.003'), size: 104_857_600 },
          { filename: 'semantic-model.7z.004', url: mainUrl('semantic-model.7z.004'), size: 59_997_980 },
        ],
      },
    ],
  },
];

export function getAllAssets(): AssetItem[] {
  return ASSET_GROUPS.flatMap(g => g.items);
}

export function getRequiredAssets(): AssetItem[] {
  return getAllAssets().filter(a => a.required);
}

export function getAssetById(id: string): AssetItem | undefined {
  return getAllAssets().find(a => a.id === id);
}
