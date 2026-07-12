// 共享常量：统一管理考试标签映射、魔法数字、系统单词本配置

// ==================== 系统单词本配置 ====================
export const SYSTEM_WORDBOOKS = [
    { id: 'sys_zk', name: '中考', tag: 'zk' },
    { id: 'sys_gk', name: '高考', tag: 'gk' },
    { id: 'sys_cet4', name: '四级', tag: 'cet4' },
    { id: 'sys_cet6', name: '六级', tag: 'cet6' },
    { id: 'sys_ky', name: '考研', tag: 'ky' },
    { id: 'sys_toefl', name: '托福', tag: 'toefl' },
    { id: 'sys_ielts', name: '雅思', tag: 'ielts' },
    { id: 'sys_gre', name: 'GRE', tag: 'gre' },
] as const;

// tag → 中文名映射
export const SYSTEM_TAGS: Record<string, string> = {
    zk: '中考', gk: '高考', cet4: '四级', cet6: '六级',
    ky: '考研', toefl: '托福', ielts: '雅思', gre: 'GRE',
};

// ==================== 虚拟滚动 ====================
export const VIRTUAL_SCROLL_BUFFER = 20;
export const COLLAPSED_HEIGHT = 140;

// ==================== 音频 ====================
export const AUDIO_MAX_CONCURRENT = 3;
export const AUDIO_MAX_RETRIES = 1;
export const AUDIO_PRELOAD_COUNT = 2;

// ==================== 页面管理 ====================
export const MAX_RENDERED_PAGES = 3;

// ==================== 保留单词本名称 ====================
export const RESERVED_WORDBOOK_NAMES = ['wordlist', 'favorites', 'errorbook'] as const;