// 全局类型声明 — 浏览器原生 API + Vue CDN

/// <reference path="./enums.ts" />

interface Window {
  Vue: any;
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
  /** 全局函数注册表调度器（供动态 HTML 内联 onclick 调用） */
  g: (name: string, ...args: unknown[]) => void;
  /** Electron API（preload 暴露） */
  electronAPI?: {
    platform: string;
    version: string;
    onReleasePages?: (callback: (payload: { half?: boolean; count?: number }) => void) => void;
    sendMemoryReleased?: (count: number) => void;
    getServerPort?: () => Promise<number | null>;
    getApiBase?: () => Promise<string>;
    restartApp?: () => void;
  };
}
