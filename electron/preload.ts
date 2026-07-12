import { contextBridge, ipcRenderer } from 'electron';

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
});