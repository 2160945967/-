// 腾讯云 API 密钥：仅从环境变量读取，不在源码中内置默认值。
// 未配置（环境变量与设置页均无）时返回空，TTS / 翻译服务会跳过腾讯、走其他降级链。
export const TENCENT_SECRET_ID = process.env.TENCENT_SECRET_ID || '';
export const TENCENT_SECRET_KEY = process.env.TENCENT_SECRET_KEY || '';
