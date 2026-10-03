// 渲染进程全局错误捕获，经 preload IPC 转发到主进程写入本地日志。

export function initErrorReport(): void {
  const api = (window as any).electronAPI;

  window.addEventListener('error', (event) => {
    try {
      api?.reportError?.({
        message: event.message || '未知错误',
        source: event.filename,
        line: event.lineno,
        col: event.colno,
        stack: event.error?.stack,
      });
    } catch { /* ignore */ }
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason = event.reason;
      api?.reportError?.({
        message: '未处理 Promise: ' + (reason?.message || String(reason)),
        stack: reason?.stack,
      });
    } catch { /* ignore */ }
  });
}
