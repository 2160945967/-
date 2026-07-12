/**
 * 可选/可下载资源清单
 *
 * 说明：
 * - required: 应用启动必需，缺失时自动下载（如词典数据库）
 * - optional: 使用到对应功能时才下载（如例句库、语音识别模型）
 *
 * 当前资源已按 Gitee Release 附件 100MB 限制做成分卷 7z 包。
 * 上传时请把 gitee-assets/ 目录下的 .7z.001、.7z.002 ... 全部上传到同一个 Release 下。
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

// 默认 CDN 基地址，可在环境变量 ASSETS_BASE_URL 中覆盖
const BASE_URL = process.env.ASSETS_BASE_URL || 'https://gitee.com/yangs-project/download/releases/download/v1.0.0';

function url(path: string): string {
  if (!BASE_URL) return '';
  return `${BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
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
          { filename: 'stardict.7z.001', url: url('stardict.7z.001'), size: 99_614_720 },
          { filename: 'stardict.7z.002', url: url('stardict.7z.002'), size: 56_979_524 },
        ],
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
          { filename: 'examples.7z.001', url: url('examples.7z.001'), size: 99_614_720 },
          { filename: 'examples.7z.002', url: url('examples.7z.002'), size: 99_614_720 },
          { filename: 'examples.7z.003', url: url('examples.7z.003'), size: 6_270_361 },
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
          { filename: 'sherpa-model.7z.001', url: url('sherpa-model.7z.001'), size: 99_614_720 },
          { filename: 'sherpa-model.7z.002', url: url('sherpa-model.7z.002'), size: 54_759_337 },
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
