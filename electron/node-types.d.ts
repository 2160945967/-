// Node.js 内置模块 + 第三方库类型声明，解决沙箱环境 @types 安装异常

// ==================== Buffer ====================
interface Buffer {
  length: number;
  toString(encoding?: string, start?: number, end?: number): string;
  slice(start?: number, end?: number): Buffer;
  [index: number]: number;
}
declare const Buffer: {
  from(data: string, encoding?: string): Buffer;
  from(data: Buffer): Buffer;
  alloc(size: number): Buffer;
  concat(list: Buffer[], totalLength?: number): Buffer;
  byteLength(str: string, encoding?: string): number;
};

// ==================== Node 内置模块 ====================

declare module 'path' {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
  export function extname(p: string): string;
  export function normalize(p: string): string;
  export function relative(from: string, to: string): string;
  export const sep: string;
  export const delimiter: string;
  namespace path {
    export { join, resolve, dirname, basename, extname, normalize, relative, sep, delimiter };
  }
  export default path;
}

declare module 'fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string): Buffer;
  export function readFileSync(path: string, encoding: string): string;
  export function readFileSync(path: string, options: { encoding?: string; flag?: string }): string | Buffer;
  export function writeFileSync(path: string, data: string | Buffer, options?: any): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean; size: number; mtime: Date };
  export function unlinkSync(path: string): void;
  export function rmdirSync(path: string, options?: { recursive?: boolean }): void;
  export function renameSync(oldPath: string, newPath: string): void;
  export function copyFileSync(src: string, dest: string): void;
  export function createReadStream(path: string, options?: any): any;
  export function createWriteStream(path: string, options?: any): any;
  export function openSync(path: string, flags: string, mode?: number): number;
  export function closeSync(fd: number): void;
  export function fstatSync(fd: number): { size: number };
  export function readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number): number;
  namespace fs {
    export {
      existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync,
      statSync, unlinkSync, rmdirSync, renameSync, copyFileSync,
      createReadStream, createWriteStream, openSync, closeSync, fstatSync, readSync
    };
  }
  export default fs;
}

declare module 'net' {
  export interface AddressInfo { address: string; family: string; port: number; }
  export function createServer(connectionListener?: (socket: any) => void): any;
  namespace net {
    export { createServer, AddressInfo };
  }
  export default net;
}

declare module 'crypto' {
  export function createHmac(algorithm: string, key: Buffer | string): { update(data: string, encoding?: string): any; digest(encoding?: string): Buffer; };
  export function randomUUID(): string;
  export function createHash(algorithm: string): { update(data: string, encoding?: string): any; digest(encoding: string): string };
  namespace crypto {
    export { createHmac, randomUUID, createHash };
  }
  export default crypto;
}

declare module 'https' {
  export function request(options: any, callback?: (res: any) => void): any;
  export function request(url: string, options: any, callback?: (res: any) => void): any;
  export function get(url: string | any, options?: any, callback?: (res: any) => void): any;
  namespace https {
    export { request, get };
  }
  export default https;
}

declare module 'http' {
  export interface IncomingHttpHeaders { [key: string]: string | string[] | undefined; }
  export function request(options: any, callback?: (res: any) => void): any;
  export function request(url: string, options: any, callback?: (res: any) => void): any;
  export function get(url: string | any, options?: any, callback?: (res: any) => void): any;
  namespace http {
    export { request, get, IncomingHttpHeaders };
  }
  export default http;
}

declare module 'child_process' {
  export function execSync(command: string, options?: any): Buffer;
  namespace child_process {
    export { execSync };
  }
  export default child_process;
}

declare module 'url' {
  export function parse(url: string): any;
  namespace url {
    export { parse };
  }
  export default url;
}

// ==================== 第三方库 ====================

declare module 'express' {
  import { Server } from 'http';
  export interface Request {
    method: string;
    url: string;
    path: string;
    params: { [key: string]: string };
    query: { [key: string]: string };
    body: any;
    headers: { [key: string]: string };
  }
  export interface Response {
    status(code: number): Response;
    json(data: any): Response;
    send(data?: any): Response;
    sendFile(path: string, options?: any): void;
    set(field: string, value: string): Response;
    type(type: string): Response;
    header(field: string, value: string): Response;
    redirect(url: string): void;
    statusCode: number;
  }
  export interface NextFunction { (err?: any): void; }
  export interface RequestHandler { (req: Request, res: Response, next: NextFunction): void; }

  function e(): any;
  namespace e {
    function static(root: string, options?: any): any;
    function json(options?: any): any;
  }

  export default e;
}

declare module 'electron' {
  export interface BrowserWindowOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    autoHideMenuBar?: boolean;
    webPreferences?: {
      nodeIntegration?: boolean;
      contextIsolation?: boolean;
      preload?: string;
      webSecurity?: boolean;
    };
    icon?: string;
    title?: string;
  }
  export class BrowserWindow {
    constructor(options?: BrowserWindowOptions);
    loadURL(url: string): Promise<void>;
    loadFile(filePath: string): Promise<void>;
    on(event: string, listener: (...args: any[]) => void): void;
    webContents: {
      on(event: string, listener: (...args: any[]) => void): void;
      session: {
        webRequest: {
          onHeadersReceived: (listener: (details: any, callback: any) => void) => void;
        };
      };
    };
    show(): void;
    close(): void;
    isDestroyed(): boolean;
  }
  export const app: {
    whenReady(): Promise<void>;
    on(event: string, listener: (...args: any[]) => void): void;
    quit(): void;
    getPath(name: string): string;
    isPackaged: boolean;
    commandLine: {
      appendSwitch: (name: string, value?: string) => void;
    };
    getName(): string;
    getVersion(): string;
  };
  export const ipcMain: {
    on(channel: string, listener: (event: any, ...args: any[]) => void): void;
    handle(channel: string, listener: (...args: any[]) => Promise<any>): void;
  };
  export const ipcRenderer: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    on(channel: string, listener: (event: any, ...args: any[]) => void): void;
  };
  export const contextBridge: {
    exposeInMainWorld(key: string, api: any): void;
  };
  export const shell: {
    openExternal(url: string): Promise<void>;
  };
  export const nativeTheme: {
    themeSource: string;
    shouldUseDarkColors: boolean;
  };
}

declare module 'better-sqlite3' {
  interface Statement {
    run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }
  interface DatabaseOptions {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (...args: any[]) => void;
  }
  class Database {
    constructor(filename: string, options?: DatabaseOptions);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    pragma(key: string, options?: { simple?: boolean }): any;
    close(): void;
    transaction(fn: (...args: any[]) => any): (...args: any[]) => any;
  }
  namespace better_sqlite3 {
    export { Database, Statement, DatabaseOptions };
  }
  export = Database;
}

declare module 'edge-tts' {
  interface EdgeTTSOptions {
    voice?: string;
    lang?: string;
    rate?: string;
    pitch?: string;
    outputPath?: string;
  }
  class EdgeTTS {
    constructor(options?: EdgeTTSOptions);
    ttsPromise(text: string, outputPath: string): Promise<void>;
    close(): void;
  }
  export { EdgeTTS };
}

declare module 'multer' {
  function multer(options?: { dest?: string; storage?: any }): any;
  namespace multer {
    export { multer };
  }
  export default multer;
}

declare module 'docx' {
  export class Document {
    constructor(options: { sections: any[] });
  }
  export class Packer {
    static toBuffer(doc: Document): Promise<Buffer>;
  }
  export class Paragraph {
    constructor(options: { text?: string; heading?: string; children?: any[] });
  }
  export class TextRun {
    constructor(options: { text: string; bold?: boolean; font?: string; size?: number });
  }
  export class Table {
    constructor(options: { rows: any[] });
  }
  export class TableRow {
    constructor(options: { children: any[] });
  }
  export class TableCell {
    constructor(options: { children: any[] });
  }
  export class HeadingLevel {
    static HEADING_1: string;
    static HEADING_2: string;
  }
}

declare module 'mammoth' {
  function extractRawText(options: { buffer: Buffer }): Promise<{ value: string; messages: any[] }>;
  namespace mammoth {
    export { extractRawText };
  }
  export default mammoth;
}

// ==================== 全局变量 ====================
declare const __dirname: string;
declare const __filename: string;
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd(): string;
  exit(code?: number): void;
  on(event: string, listener: (...args: any[]) => void): void;
  platform: string;
  versions: { node: string };
};
declare const require: NodeRequire;
declare function setImmediate(callback: (...args: any[]) => void, ...args: any[]): any;