"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSETS_DIR = exports.CACHE_DIR = exports.USER_DATA_DIR = exports.APP_ROOT_DIR = exports.ROOT_DIR = void 0;
exports.resolveAssetPath = resolveAssetPath;
exports.findPronunciationFile = findPronunciationFile;
exports.normalizeWordForFilename = normalizeWordForFilename;
exports.preprocessWordForTTS = preprocessWordForTTS;
exports.successResponse = successResponse;
exports.errorResponse = errorResponse;
exports.ensureDirExists = ensureDirExists;
exports.getRequestParam = getRequestParam;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// 子进程（fork）模式下从环境变量读路径，主进程模式下从 app 读
function resolvePaths() {
    if (process.env.ROOT_DIR) {
        return {
            ROOT_DIR: process.env.ROOT_DIR,
            APP_ROOT_DIR: process.env.APP_ROOT_DIR,
            USER_DATA_DIR: process.env.USER_DATA_DIR,
            CACHE_DIR: process.env.CACHE_DIR || path.join(process.env.USER_DATA_DIR, 'cache'),
        };
    }
    const { app } = require('electron');
    // __dirname 在 dev 为 project-root/electron-dist，打包后为 app.asar/electron-dist
    const candidateRoot = path.resolve(__dirname, '..', '..');
    // 使用 Electron 原生的 app.isPackaged 判断，避免 electron-dist 在项目目录内导致的误判
    const isDev = !app.isPackaged;
    const rootDir = isDev ? candidateRoot : process.resourcesPath;
    const appRootDir = candidateRoot;
    // 开发版和打包版使用不同的 userData 目录，避免数据互相污染
    const userDataDir = isDev
        ? path.join(app.getPath('appData'), '拾词-dev')
        : path.join(app.getPath('appData'), '拾词');
    return {
        ROOT_DIR: rootDir,
        APP_ROOT_DIR: appRootDir,
        USER_DATA_DIR: userDataDir,
        CACHE_DIR: path.join(userDataDir, 'cache'),
    };
}
const _paths = resolvePaths();
exports.ROOT_DIR = _paths.ROOT_DIR;
exports.APP_ROOT_DIR = _paths.APP_ROOT_DIR;
exports.USER_DATA_DIR = _paths.USER_DATA_DIR;
exports.CACHE_DIR = _paths.CACHE_DIR;
exports.ASSETS_DIR = path.join(exports.USER_DATA_DIR, 'assets');
/**
 * 解析资源文件路径。
 * 优先使用用户数据目录中下载/生成的资源（ASSETS_DIR），
 * 回退到应用安装目录（ROOT_DIR），便于开发时直接使用本地文件。
 */
function resolveAssetPath(relativePath) {
    const userPath = path.join(exports.ASSETS_DIR, relativePath);
    if (fs.existsSync(userPath))
        return userPath;
    return path.join(exports.ROOT_DIR, relativePath);
}
/** 查找发音文件，优先用户数据目录，再回退安装目录 */
function findPronunciationFile(filename) {
    const userFile = path.join(exports.ASSETS_DIR, 'pronunciations', filename);
    if (fs.existsSync(userFile))
        return userFile;
    const bundledFile = path.join(exports.ROOT_DIR, 'pronunciations', filename);
    if (fs.existsSync(bundledFile))
        return bundledFile;
    return null;
}
/**
 * Replace Windows-invalid filename characters with underscores.
 * Preserves spaces and apostrophes.
 */
function normalizeWordForFilename(word) {
    if (!word)
        return word;
    let normalized = word;
    normalized = normalized.replace(/\//g, '_');
    normalized = normalized.replace(/\\/g, '_');
    normalized = normalized.replace(/:/g, '_');
    normalized = normalized.replace(/\*/g, '_');
    normalized = normalized.replace(/\?/g, '_');
    normalized = normalized.replace(/</g, '_');
    normalized = normalized.replace(/>/g, '_');
    normalized = normalized.replace(/\|/g, '_');
    normalized = normalized.replace(/&/g, '_and_');
    return normalized;
}
/**
 * Clean up word text for TTS by removing parenthetical annotations,
 * bracket content, and descriptive markers.
 */
function preprocessWordForTTS(word) {
    if (!word)
        return word;
    let processed = word.trim();
    // 策略1: 数字编号格式 - 去掉编号，保留核心词
    const numMatch = processed.match(/^\(\s*\d+\s*\)\s*(.+)$/);
    if (numMatch) {
        processed = numMatch[1].trim();
    }
    // 特殊情况：对于 (Sp)-8-Br-cAMPS 这样的复杂化学术语，完全保留
    if (processed.startsWith('(Sp)-') || processed.startsWith('(sp)-')) {
        return processed;
    }
    // 策略2: 对于 (R)-loxiglumide 这样的格式，保留核心词 loxiglumide
    const singleCapMatch = processed.match(/^\(([A-Z])\)-([a-z]+)$/);
    if (singleCapMatch) {
        processed = singleCapMatch[2];
    }
    // 策略3: 对于 (trans)-isomer 这样的格式，保留核心词 isomer
    const transMatch = processed.match(/^\(([a-z]+)\)-([a-z]+)$/i);
    if (transMatch) {
        processed = transMatch[2];
    }
    // 策略4: 对于 (1S)-(-)-Camphor 这样的复杂化学术语，保留核心词
    const complexMatch = processed.match(/^\([0-9a-zA-Z-]+\)[-\s]*\([0-9a-zA-Z-]*\)[-\s]*([a-zA-Z]+)$/i);
    if (complexMatch) {
        processed = complexMatch[1];
    }
    // 策略5: 可选拼写格式 - 保留完整形式（包含可选字母）
    const optionalMatch = processed.match(/^\(([a-zA-Z])\)([a-zA-Z-]+)$/);
    if (optionalMatch) {
        processed = optionalMatch[1] + optionalMatch[2];
    }
    // 策略6: 去掉方括号的学科标记
    processed = processed.replace(/\[.*?\]\s*/g, '');
    // 策略7: 去掉圆括号的分类/描述标记
    const descMatch = processed.match(/^\(([a-z]{2,}(?:\s+of\s+[a-z\s]+)?)\)\s*(.+)$/i);
    if (descMatch) {
        processed = descMatch[2].trim();
    }
    // 策略8: 特殊处理一些常见的标记
    const specialTags = '(actinic|arithmetic|basic|bee|burner|common|data|domestic|electromagnetic|european|feed|fish|hemispherical|hog|hva|impressio|input|lamp|lobus|luminescence|magnetic|mechanical|methylthio|montevideo|multi|musculus|myotomic|net|of|optical|pons|potash|processus|psychophysical|radiation|red-eye|resin|robaxin|rotary|sea|sin|solid|spring|storage|striped|sweetened|technical|total|traffic|ts|var|von|water|written|hazardous)';
    const specialMatch = processed.match(new RegExp(`^\\(${specialTags}\\)\\s*(.+)$`, 'i'));
    if (specialMatch) {
        processed = specialMatch[1].trim();
    }
    // 策略9: 去掉开头的撇号
    if (processed.startsWith("'") && processed.length > 1) {
        if (/[a-zA-Z]/.test(processed[1])) {
            processed = processed.substring(1);
        }
    }
    // 策略10: 对于 (Robaxin)Methocarbamol 这样的商品名，保留核心词
    const brandMatch = processed.match(/^\([A-Za-z]+\)([A-Za-z]+)$/);
    if (brandMatch) {
        processed = brandMatch[1];
    }
    // 策略11: 对于 (4-ethoxyphenyl)methane 这样的格式
    const chemicalMatch = processed.match(/^\([0-9a-zA-Z-]+\)([a-zA-Z]+)$/);
    if (chemicalMatch) {
        if (chemicalMatch[1] !== 'yl') {
            processed = chemicalMatch[1];
        }
    }
    // 特殊处理：对于 (tercyclohexan)yl 和 (terthiophen)yl 保留完整
    if (word.includes('(tercyclohexan)yl') || word.includes('(terthiophen)yl')) {
        processed = word.trim();
        processed = processed.replace(/^\(\s*\d+\s*\)\s*/, '');
    }
    // 策略12: 对于 (6-4)PDs 这样的格式
    const numericMatch = processed.match(/^\([0-9-]+\)([A-Za-z0-9]+)$/);
    if (numericMatch) {
        processed = numericMatch[1];
    }
    return processed.trim();
}
/** Wrap data in a success response object. */
function successResponse(data) {
    return { success: true, data };
}
/** Wrap an error message in an error response object. */
function errorResponse(message, statusCode = 400) {
    return { success: false, error: { message, statusCode } };
}
/** Create a directory (including parents) if it does not exist. */
function ensureDirExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}
/**
 * Extract a request parameter from query, body JSON, or URL-encoded form body.
 * Returns the default value if the key is not found.
 */
function getRequestParam(req, key, defaultValue = undefined) {
    // Check query string
    if (req.query && req.query[key] !== undefined) {
        return req.query[key];
    }
    // Check JSON body
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body) && req.body[key] !== undefined) {
        return req.body[key];
    }
    return defaultValue;
}
//# sourceMappingURL=helpers.js.map