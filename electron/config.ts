// 腾讯云 API 密钥 —— 优先从环境变量读取，没有则用默认值
export const TENCENT_SECRET_ID = process.env.TENCENT_SECRET_ID || 'REDACTED';
export const TENCENT_SECRET_KEY = process.env.TENCENT_SECRET_KEY || 'REDACTED';