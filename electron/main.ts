import { app, BrowserWindow, session, ipcMain, crashReporter } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { fork, ChildProcess } from 'child_process';
import * as os from 'os';
import { ROOT_DIR, APP_ROOT_DIR, USER_DATA_DIR, CACHE_DIR } from './utils/helpers';
import { initProcessLogging, log } from './services/logger';

// macOS / Linux 上 sherpa-onnx 的原生 .node 依赖同目录的 onnxruntime 动态库。
// 在加载原生模块前把平台包目录加入动态库搜索路径作为兜底（CI 还会用 install_name_tool/patchelf 做 rpath 修复）。
function setupNativeLibPath(): void {
  if (process.platform === 'win32') return;
  const plat = process.platform === 'darwin' ? 'darwin' : 'linux';
  const dirName = `sherpa-onnx-${plat}-${process.arch}`;
  const candidates = [
    path.join(__dirname, '..', 'node_modules', dirName),                    // dev: electron-dist/../node_modules
    path.join(__dirname, '..', 'app.asar.unpacked', 'node_modules', dirName), // packaged
  ];
  const dir = candidates.find((d) => fs.existsSync(d));
  if (!dir) return;
  if (process.platform === 'darwin') {
    process.env.DYLD_LIBRARY_PATH = `${dir}${path.delimiter}${process.env.DYLD_LIBRARY_PATH || ''}`;
  } else {
    process.env.LD_LIBRARY_PATH = `${dir}${path.delimiter}${process.env.LD_LIBRARY_PATH || ''}`;
  }
}
setupNativeLibPath();

// 崩溃仅本地收集（Crashpad dump 写入 userData/Crashpad），不上传第三方
crashReporter.start({ uploadToServer: false, compress: true });
initProcessLogging('main');

// 某些 Windows 环境下 Chromium 会默认降级 GPU，导致页面动画掉帧，强制开启 GPU 光栅化。
// 仅 Windows 处理：macOS / Linux 的 Chromium 默认 GPU 支持成熟，无需强制开关。
// 不使用 enable-zero-copy：它在部分 NVIDIA + Windows 环境会触发 GPU 命令缓冲区错误（崩溃），收益有限。
if (os.platform() === 'win32') {
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}

// Windows 控制台默认 GBK，后端输出中文容易乱码，启动时切到 UTF-8
if (os.platform() === 'win32') {
  try {
    require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
  } catch { /* ignore */ }
  if ((process.stdout as any).setDefaultEncoding) {
    (process.stdout as any).setDefaultEncoding('utf8');
  }
  if ((process.stderr as any).setDefaultEncoding) {
    (process.stderr as any).setDefaultEncoding('utf8');
  }
}

let serverProcess: ChildProcess | null = null;
let serverPort: number | null = null;

app.whenReady().then(async () => {
  // 创建窗口
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: '#f0f4f8',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Windows 下 alert/confirm 关闭后输入框可能无法聚焦，由渲染进程通过 IPC 触发修复
  ipcMain.on('fix-focus', () => {
    if (process.platform !== 'win32' || win.isDestroyed() || win.isMinimized()) return;
    win.blur();
    win.focus();
  });

  // 渲染进程报错 / 未处理 Promise（由 preload 转发），写入本地日志
  ipcMain.on('renderer-error', (_event, info: any) => {
    log(
      'ERROR',
      `[renderer] ${info?.message || ''} @ ${info?.source || ''}:${info?.line || ''}:${info?.col || ''}` +
        (info?.stack ? `\n${info.stack}` : ''),
    );
  });

  // 最小化还原后强制置顶，Windows 下有时还原后 Z-order 不对
  win.on('restore', () => {
    const bringToFront = (delay: number) => {
      setTimeout(() => {
        if (win.isDestroyed()) return;
        if (win.isMinimized()) return;
        win.show();
        win.moveTop();
        // 临时置顶再取消，强制刷新 Z-order
        win.setAlwaysOnTop(true);
        setTimeout(() => {
          if (!win.isDestroyed()) {
            win.setAlwaysOnTop(false);
            win.focus();
          }
        }, 30);
      }, delay);
    };
    bringToFront(30);
    bringToFront(150);
    bringToFront(350);
  });

  // Fork 子进程运行 Express 后端
  // 全部忽略 stdio，避免 GUI 模式下父进程没有 stdout 导致子进程 console.log 触发 EPIPE 弹窗
  // 子进程内部会把日志写入 server.log（见 server.ts）
  serverProcess = fork(
    path.join(__dirname, 'server.js'),
    [],
    {
      env: {
        ...process.env,
        ROOT_DIR,
        APP_ROOT_DIR,
        USER_DATA_DIR,
        CACHE_DIR,
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    }
  );

  serverProcess.on('message', (msg: any) => {
    if (msg.type === 'ready') {
      serverPort = msg.port;
      console.log(`Server ready on port ${serverPort}`);
      win.loadURL(`http://127.0.0.1:${serverPort}`);
    }
  });

  serverProcess.on('exit', (code) => {
    console.log(`Server process exited with code ${code}`);
    log(code === 0 ? 'INFO' : 'ERROR', `后端子进程退出，code=${code}`);
    if (code !== 0 && !win.isDestroyed()) {
      win.loadURL(`data:text/html,<h1 style="color:red;text-align:center;margin-top:40vh">后端服务异常退出，请重启应用</h1>`);
    }
  });

  // 把端口暴露给渲染进程
  ipcMain.handle('get-server-port', () => serverPort);

  // 内存监控
  const MEMORY_THRESHOLD_MB = 1024;
  setInterval(() => {
    try {
      const metrics = app.getAppMetrics();
      const rendererPid = win.webContents.getOSProcessId();
      const metric = metrics.find((m: any) => m.pid === rendererPid);
      const workingSetMB = Math.round((metric?.memory?.workingSetSize ?? 0) / 1024);
      if (workingSetMB > MEMORY_THRESHOLD_MB) {
        console.log(`渲染进程内存 ${workingSetMB}MB，触发后台页面释放`);
        win.webContents.send('release-pages', { half: true });
      }
    } catch (err) {
      console.error('内存监控失败:', err);
    }
  }, 10000);

  ipcMain.on('memory-released', (_event, count: number) => {
    console.log(`已释放 ${count} 个后台页面`);
  });

  // 渲染进程请求重启应用（如下载完成后需要重启生效）
  ipcMain.on('app-restart', () => {
    console.log('[main] 收到重启请求，准备重启应用');
    app.relaunch();
    app.quit();
  });

  // 处理媒体权限请求
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
});

function shutdownServer() {
  if (serverProcess) {
    try {
      if (serverProcess.connected) {
        serverProcess.send('shutdown');
        // 给子进程 3 秒时间优雅退出，超时强杀
        setTimeout(() => {
          if (serverProcess && !serverProcess.killed) {
            serverProcess.kill();
          }
        }, 3000);
      } else {
        serverProcess.kill();
      }
    } catch { /* ignore */ }
  }
}

app.on('window-all-closed', () => {
  shutdownServer();
  app.quit();
});

app.on('before-quit', () => {
  shutdownServer();
});