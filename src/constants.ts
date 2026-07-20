// 共享常量：统一管理考试标签映射、魔法数字、系统单词本配置

// ==================== 系统单词本配置 ====================
export const SYSTEM_WORDBOOKS = [
    { id: 'sys_xx', name: '小学', tag: 'xx' },
    { id: 'sys_zk', name: '中考', tag: 'zk' },
    { id: 'sys_gk', name: '高考', tag: 'gk' },
    { id: 'sys_cet4', name: '四级', tag: 'cet4' },
    { id: 'sys_cet6', name: '六级', tag: 'cet6' },
    { id: 'sys_cet6_star', name: '六级星标', tag: 'cet6_star' },
    { id: 'sys_tem4', name: '专四', tag: 'tem4' },
    { id: 'sys_tem8', name: '专八', tag: 'tem8' },
    { id: 'sys_tem8_star', name: '专八星标', tag: 'tem8_star' },
    { id: 'sys_ky', name: '考研', tag: 'ky' },
    { id: 'sys_toefl', name: '托福', tag: 'toefl' },
    { id: 'sys_ielts', name: '雅思', tag: 'ielts' },
    { id: 'sys_gre', name: 'GRE', tag: 'gre' },
    { id: 'sys_gre_hongbao', name: 'GRE红宝书', tag: 'gre_hongbao' },
    { id: 'sys_coca20000', name: 'COCA 20000', tag: 'coca20000' },
    { id: 'sys_coca_abridged', name: 'COCA精简', tag: 'coca_abridged' },
    { id: 'sys_oald8', name: '牛津高阶', tag: 'oald8' },
    { id: 'sys_tw_hs', name: '台湾高中', tag: 'tw_hs' },
] as const;

// tag → 中文名映射
export const SYSTEM_TAGS: Record<string, string> = {
    xx: '小学', zk: '中考', gk: '高考', cet4: '四级', cet6: '六级',
    cet6_star: '六级星标', tem4: '专四', tem8: '专八', tem8_star: '专八星标',
    ky: '考研', toefl: '托福', ielts: '雅思', gre: 'GRE', gre_hongbao: 'GRE红宝书',
    coca20000: 'COCA 20000', coca_abridged: 'COCA精简', oald8: '牛津高阶', tw_hs: '台湾高中',
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