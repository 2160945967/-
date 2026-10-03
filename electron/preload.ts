import { contextBridge, ipcRenderer, webFrame } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: '2.0.0',
  onReleasePages: (callback: (payload: { half?: boolean; count?: number }) => void) => {
    ipcRenderer.on('release-pages', (_event, payload) => callback(payload));
  },
  sendMemoryReleased: (count: number) => ipcRenderer.send('memory-released', count),
  /** 获取后端服务器端口，返回 null 表示尚未就绪 */
  getServerPort: (): Promise<number | null> => ipcRenderer.invoke('get-server-port'),
  /** 拼接完整的后端 API 地址 */
  getApiBase: async (): Promise<string> => {
    const port = await ipcRenderer.invoke('get-server-port');
    return `http://127.0.0.1:${port}`;
  },
  /** 通知主进程修复窗口焦点（Windows 下 alert/confirm 关闭后输入框可能无法响应键盘） */
  fixFocus: () => ipcRenderer.send('fix-focus'),
  /** 请求主进程重启应用 */
  restartApp: () => ipcRenderer.send('app-restart'),
  /** 渲染进程错误上报到主进程写入本地日志 */
  reportError: (info: { message: string; source?: string; line?: number; col?: number; stack?: string }) =>
    ipcRenderer.send('renderer-error', info),
});

// Windows 下原生 alert/confirm 关闭后，窗口焦点可能丢失，导致输入框无法响应键盘。
// 通过 webFrame 向页面注入覆盖脚本，在 alert/confirm 关闭后通知主进程修复焦点。
if (process.platform === 'win32') {
  webFrame.executeJavaScript(`
    (function () {
      if (window.__alertConfirmFocusFixed) return;
      window.__alertConfirmFocusFixed = true;
      const originalAlert = window.alert;
      const originalConfirm = window.confirm;
      window.alert = function (message) {
        originalAlert.call(window, message);
        window.electronAPI?.fixFocus?.();
      };
      window.confirm = function (message) {
        const result = originalConfirm.call(window, message);
        window.electronAPI?.fixFocus?.();
        return result;
      };
    })();
  `);
}