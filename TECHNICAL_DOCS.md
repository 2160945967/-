# 拾词 - 项目技术文档

## 1. 项目概述

拾词是一个面向英语学习者的全栈词汇学习应用，集成词典查询、例句检索、智能测验、单词本管理、收藏与错题本、学习统计等功能。项目采用 **Electron（主进程 Node.js + 渲染进程 Chromium）** 作为桌面框架，**Express 4（TypeScript）** 作为后端服务，**Vue 3 CDN + TypeScript + Vite** 作为前端，通过本地 RESTful API 进行前后端通信。

### 1.1 技术栈



| 层级   | 技术                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------- |
| 桌面框架 | Electron 44（主进程 Node.js + 渲染进程 Chromium）                                                             |
| 后端服务 | Express 4（TypeScript）、better-sqlite3 13、docx、mammoth、multer                                          |
| 前端构建 | Vue 3.4、TypeScript 5、Vite 5、GSAP 动画库                                                                 |
| 状态管理 | Proxy + Reflect 自定义响应式系统、Pub-Sub 订阅机制、localStorage 自动持久化                                             |
| 样式   | CSS 变量主题系统、毛玻璃效果（backdrop-filter）、clip-path 波纹扩散主题切换动画                                               |
| 持久化  | localStorage（前端状态）、SQLite（词典 / 例句）、JSON 文件（自定义单词本 wordbooks.json）                                    |
| 缓存   | 内存 LRU 缓存（例句 500 条、翻译 1000 条）、文件缓存（TTS 音频）                                                           |
| 语音输入 | Sherpa-ONNX (SenseVoice) 离线语音识别（中英文等多语言）                                                             |
| 语义判断 | Transformers.js 本地语义相似度模型（英译中模糊判断）                                                                   |
| 资源管理 | 可下载资源管理器（asset-manager）、Gitee Release 分卷 7z、断点续传、MD5/SHA256 校验                                       |
| 工程质量 | CSP 内容安全策略、tsc 类型检查卡点、Vitest 80 用例、Gitee Go CI、Crashpad 本地崩溃收集 + logs/app.log 日志轮转            |
| 部署   | 大型数据文件通过 Gitee Releases 托管（分卷 7z）按需下载，部分资源（词典、语音模型等）可通过 extraResources 内置打包；electron-builder 打包为安装程序 |

### 1.2 项目目录结构



```
拾词/

├── package.json                  # npm 依赖、scripts、electron-builder 配置

├── vite.config.ts                # Vite 前端构建配置

├── tsconfig.json                 # TypeScript 前端配置

├── tsconfig.electron.json        # TypeScript Electron 主进程配置

├── index.html                    # 前端主页面（HTML 结构 + Vue 3 x-template 模板）

├── electron/

│   ├── main.ts                   # Electron 主进程入口：窗口创建、Express 服务启动、权限处理、内存监控

│   ├── preload.ts                # 预加载脚本，通过 contextBridge 暴露少量 API

│   ├── server.ts                 # Express 服务入口：数据库初始化、路由注册、端口分配、日志重定向

│   ├── config/

│   │   └── assets.ts             # 可下载资源清单（词典/例句/语音模型），Gitee Release 分卷配置

│   ├── api/

│   │   └── routes.ts             # Express 路由：词典、例句、TTS、单词本、语音识别、资源下载等 API

│   ├── services/

│   │   ├── database.ts           # better-sqlite3 数据库封装、LRU 缓存、词典查询、中文搜索

│   │   ├── tts.ts                # TTS 服务：有道→百度→Edge→腾讯 四级降级链

│   │   ├── translate.ts          # 翻译服务：腾讯云→有道→MyMemory 三级降级

│   │   ├── nlp.ts                # 文本分类（单词/词组/句子），纯函数实现

│   │   ├── sherpa\_asr.ts         # Sherpa-ONNX (SenseVoice) 语音识别：离线多语言、ASCII 路径兼容

│   │   ├── asset-manager.ts      # 可下载资源管理器：分卷下载、断点续传、7z 解压、校验、进度回调

│   │   └── pronunciation-downloader.ts  # 离线发音包批量下载：词典全词遍历、断点续传、并发控制

│   └── utils/

│       ├── cache.ts              # TypeScript LRUCache

│       └── helpers.ts            # 路径解析（ROOT/APP\_ROOT/USER\_DATA/CACHE/ASSETS）、通用工具函数

├── src/

│   ├── main.ts                   # 前端入口：模块初始化、全局函数注册表、DOMContentLoaded 流程

│   ├── global.ts                 # 全局功能：主题切换、页面导航、侧边栏折叠、网络检测、文件上传

│   ├── global-registry.ts        # 全局函数注册表（供 HTML onclick="g(...)" 调用）

│   ├── store/

│   │   └── index.ts              # 状态管理：Proxy + Reflect 响应式 + localStorage 持久化 + Pub-Sub

│   ├── types/

│   │   ├── enums.ts              # 类型枚举：PronunciationType, QuizMode, SortBy, FilterType 等

│   │   ├── api.d.ts              # API 响应类型：ApiResponse\<T>, ApiError

│   │   ├── book.d.ts             # 运行时类型声明（全局 window 上的 g/gsap 等）

│   │   ├── setting.d.ts          # 设置类型：QuizSettings, ExportSettings

│   │   ├── stats.d.ts            # 学习统计类型：StudyStatsData

│   │   ├── word.d.ts             # 单词相关类型：WordbookWordItem, FavoritesItem 等

│   │   └── global.d.ts           # 全局类型声明（window.electronAPI 等）

│   ├── modules/

│   │   ├── dictionary.ts         # 词典模块：搜索、翻译、发音、搜索建议、语音输入、历史记录

│   │   ├── quiz.ts               # 测验模块：出题、判题、艾宾浩斯遗忘曲线、学习历史

│   │   ├── review.ts             # 复习模块：艾宾浩斯到期词、学习历史按天分组

│   │   ├── wordbook.ts           # 单词本模块：CRUD、导入导出、Vue 虚拟列表、筛选排序

│   │   ├── favorites.ts          # 收藏模块：收藏列表、Vue 虚拟列表、筛选排序、搜索

│   │   ├── errorbook.ts          # 错题本模块：错题列表、权重排序、Vue 虚拟列表

│   │   ├── settings.ts           # 设置模块：配置读写、拖拽排序、快捷键冲突检测、资源下载管理

│   │   └── stats.ts              # 学习统计：总单词数、搜索次数、学习天数、每日重置

│   ├── utils/

│   │   ├── audio.ts              # 音频播放队列、预加载、发音播放、Web Audio 合成提示音

│   │   ├── api.ts                # 前端 API 请求封装

│   │   ├── translation.ts        # 释义解析与词性/领域标签渲染（词典、单词本、收藏、错题本共用）

│   │   ├── virtualScroll.ts      # Vue 虚拟列表通用 mixin

│   │   ├── cardMixin.ts          # 卡片交互 mixin：翻转、展开、高度缓存

│   │   ├── progress.ts           # 系统单词本分页加载进度模拟

│   │   ├── gsap.ts               # GSAP 动画：卡片翻转、入场退场、主题切换、按钮反馈

│   │   ├── quizCommon.ts         # 测验/复习公共逻辑：IME 处理、快捷键、防抖、释义选择

│   │   ├── quizHelper.ts         # 测验答案检查与释义选择

│   │   ├── regex.ts              # 常用正则表达式模式

│   │   ├── generator.ts          # 数据生成：Fisher-Yates 洗牌、艾宾浩斯间隔计算

│   │   └── storage.ts            # localStorage 读写封装

│   │   └── popupSelect.ts        # 通用弹窗式下拉选择器（select 隐藏为状态载体，按钮触发居中弹窗）

│   ├── constants.ts              # 共享常量：系统单词本配置、虚拟滚动、音频、魔法数字

│   ├── assets/

│       ├── css/

│       │   ├── theme.css         # 主题变量、深色模式覆盖、波纹扩散动画

│       │   ├── base.css          # 基础样式重置、布局、按钮、输入框

│       │   ├── glass.css         # 毛玻璃效果（backdrop-filter + 滚动降级）

│       │   ├── dictionary.css    # 词典页面专用样式

│       │   ├── quiz.css          # 测验页面专用样式

│       │   ├── wordbook.css      # 单词本/收藏/错题本卡片与虚拟列表样式

│       │   ├── settings.css      # 设置页面拖拽排序、资源下载管理样式

│       │   └── responsive.css    # 响应式适配

│       └── animations/

│           └── animations.css    # 通用动画

├── stardict.db                   # 主词典数据库（ECDict + StarDict 合并，启动必需资源）

├── examples.db                   # 例句数据库（Tatoeba，可选下载资源）

├── wordbooks.json                # 自定义单词本数据

├── pronunciations/               # TTS 音频文件目录（可选打包）

├── sherpa-onnx-sense-voice-zh-en-ja-ko-yue/  # Sherpa-ONNX 语音模型（可选下载）

├── dist/                         # Vite 构建输出

├── static/                       # 复制 dist/ 后的静态资源（Electron 打包用）

├── electron-dist/                # Electron 主进程 TypeScript 编译输出

└── release-final4/               # electron-builder 打包输出
```

### 1.3 数据库设计

#### 1.3.1 主词典（StarDict SQLite）

数据库文件：`stardict.db`

表名 `stardict`，完整结构：



```
CREATE TABLE IF NOT EXISTS "stardict" (

&#x20;   "id"           INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL UNIQUE,

&#x20;   "word"         VARCHAR(64)  COLLATE NOCASE NOT NULL UNIQUE,

&#x20;   "sw"           VARCHAR(64)  COLLATE NOCASE NOT NULL,         -- strip word（去除非字母数字后的小写）

&#x20;   "phonetic"     VARCHAR(64),                                   -- 音标（美式或英式）

&#x20;   "definition"   TEXT,                                         -- 英文释义

&#x20;   "translation"  TEXT,                                         -- 中文翻译（按行分割，格式 "n. 名词释义"）

&#x20;   "pos"          VARCHAR(16),                                  -- 词性标记

&#x20;   "collins"      INTEGER DEFAULT(0),                           -- 柯林斯星级

&#x20;   "oxford"       INTEGER DEFAULT(0),                           -- 牛津标志

&#x20;   "tag"          VARCHAR(64),                                  -- 标签（cet4, cet6, ky, zk, gk, toefl, ielts, gre）

&#x20;   "bnc"          INTEGER DEFAULT(NULL),                        -- BNC 词频

&#x20;   "frq"          INTEGER DEFAULT(NULL),                        -- 频率

&#x20;   "exchange"     TEXT,                                         -- 词形变化（格式 "p:过去式/i:现在分词"）

&#x20;   "detail"       TEXT,                                         -- 扩展详情（JSON 格式）

&#x20;   "audio"        TEXT                                          -- 音频路径

);

CREATE UNIQUE INDEX IF NOT EXISTS "stardict\_1" ON stardict (id);

CREATE UNIQUE INDEX IF NOT EXISTS "stardict\_2" ON stardict (word);

CREATE INDEX IF NOT EXISTS "stardict\_3" ON stardict (sw, word collate nocase);

CREATE INDEX IF NOT EXISTS "sd\_1" ON stardict (word collate nocase);
```

**查询逻辑**：`query(word)` 通过 `SELECT * FROM stardict WHERE word = ?` 精确匹配；`match(prefix, limit)` 通过前缀范围查询返回建议列表；`matchWithSort(prefix, limit, category)` 增加智能排序：用户输入不含空格 / 连字符时单词优先、含空格 / 连字符时词组优先，其次按用户考试类型、柯林斯星级、词频排序。

**音标数据清洗**：`recordToObj()` 在返回记录前调用 `cleanPhonetic()`，将数据源中错误编码的四个反斜杠加冒号序列替换为 IPA 长元音 `ɜː`，避免词典页与测验页音标显示乱码。

#### 1.3.2 例句数据库（examples.db）

数据库文件：`examples.db`

三张核心表：



* **sentences**：存储原始例句


  * `id`（INTEGER PRIMARY KEY）、`text`（TEXT 英文原文）

* **word\_examples**：单词与例句的多对多关联


  * `word`（TEXT 单词）、`sentence_id`（INTEGER 关联 sentences.id）

* **translations**：翻译缓存


  * `eng_id`（INTEGER）、`cmn_id`（INTEGER）

* **sentences** 中文例句也存储在 sentences 表中，通过 translations 关联

**查询例句时使用 JOIN 过滤无中文翻译的条目**：



```
SELECT s.id, s.text as eng\_text, t.cmn\_id, s\_cmn.text as cmn\_text

FROM sentences s

JOIN word\_examples w ON s.id = w.sentence\_id

JOIN translations t ON s.id = t.eng\_id

JOIN sentences s\_cmn ON t.cmn\_id = s\_cmn.id

WHERE w.word = ?

LIMIT 50
```

API 返回上限 50 条，避免大数据量传输。

#### 1.3.3 ECDict（CSV 词典）

项目启动时不再从 CSV 导入主词典，而是直接使用预先构建好的 `stardict.db`。`ecdict.csv` 仅作为词源备份存在，开发 / 分发时不需要重新导入。`stardict.db` 是应用启动的必需资源，首次运行时通过资源管理器自动下载。

**中文反向搜索**：`stardict` 表的 `translation` 字段支持 LIKE 模糊匹配，`searchChinese(keyword, limit)` 实现通过中文释义查找对应的英文单词。

#### 1.3.4 二级词典数据



* **lemma.en.txt**：词形衍生数据库，格式 `根词/频率 -> 衍生1,衍生2,衍生3`

* **wordroot.txt**：词根数据库，JSON 格式 `{ 词根: { info, example: [...] } }`

* **resemble.txt**：形近词数据库，格式 `%单词1,单词2,单词3` 开头为一组

#### 1.3.5 单词本（wordbooks.json）

JSON 格式存储自定义单词本，结构为 `Record<string, string[]>`，键为单词本名称，值为单词数组。系统单词本的数据存储在 SQLite 中，通过 `/api/system-wordbook/words` 动态分页查询。

**系统单词本来源与说明**（数据整理自 [mahavivo/english-wordlists](https://github.com/mahavivo/english-wordlists)）：



| 显示名称    | 标签               | 说明                                                        |
| ------- | ---------------- | --------------------------------------------------------- |
| 小学      | `xx`             | 小学词汇（紫色）                                                  |
| 中考      | `zk`             | 中考词汇（紫色）                                                  |
| 高考      | `gk`             | 高考词汇（紫色）                                                  |
| 四级      | `cet4`           | 大学英语四级（绿色）                                                |
| 六级      | `cet6`           | 大学英语六级（绿色）                                                |
| 四六级合并   | `cet46`          | 四级 + 六级合并词表                                               |
| 六级星标    | `cet6_star`      | 六级重点 / 星标词汇                                               |
| 专四专八    | `tem48`          | 英语专业四、八级                                                  |
| 专八星标    | `tem8_star`      | 专八重点 / 星标词汇                                               |
| 考研      | `ky`             | 考研英语词汇（红色）                                                |
| 托福      | `toefl`          | 托福完整词汇（橙色）                                                |
| 托福精简    | `toefl_abridged` | 托福词表删除所有四六级词汇后的精选版                                        |
| 托福去重    | `toefl_del`      | 托福词表删除与四六级重复词汇后的版本                                        |
| 雅思      | `ielts`          | 雅思词汇（青色）                                                  |
| GRE     | `gre`            | GRE 完整词汇（青色）                                              |
| GRE 红宝书 | `gre_hongbao`    | GRE 8000 Words                                            |
| GRE 精简  | `gre_abridged`   | GRE 词表删除所有四六级、托福词汇后的精选版                                   |
| GRE 去重  | `gre_del`        | GRE 词表删除与四六级、托福重复词汇后的版本                                   |
| 汇总词汇    | `sum_all`        | 全部词表汇总标记                                                  |
| COCA    | `coca20000`      | COCA 20000 词频表，显示为 **COCA**                               |
| COCA 精简 | `coca_abridged`  | COCA 20000 删除四六级、托福、GRE 词汇，并进一步删除动名词、过去分词、形容词 + ly 副词等衍生词 |
| 牛津高阶    | `oald8`          | 牛津高阶英汉双解词典（第 8 版）                                         |
| 台湾高中    | `tw_hs`          | 台湾高中英文参考词汇表                                               |

**说明**：



* **精简**：在完整词表基础上去除更低阶的考试词汇（如托福精简去掉四六级、GRE 精简去掉四六级 + 托福），适合只想背高阶新词的用户。

* **去重**：在完整词表基础上去除与更低阶词表重复的部分，保留该考试的核心词汇。

* 部分词汇表内部会显示 `系统-xxx`，如 `系统-托福精简`。

**词形变化显示名称映射**：



* `p` → 过去式

* `d` → 过去分词

* `i` → 现在分词

* `3` → 第三人称单数

* `r` → 比较级

* `t` → 最高级

* `s` → 复数



***

## 2. 前端架构

### 2.1 HTML 结构（index.html）

主页面结构：



```
\<body>

&#x20; ├─ #bg-under               底层背景（z-index: -2）

&#x20; ├─ #bg-over                覆盖层背景（z-index: -1，clip-path 圆形展开）

&#x20; ├─ #ripple-layer-1/2/3     三层波纹扩散

&#x20; ├─ #theme-mask             主题切换遮罩

&#x20; ├─ .sidebar                侧边栏（学习统计 + 网络状态 + 学习类别）

&#x20; │   ├─ .network-status     网络状态指示器

&#x20; │   └─ .stats-container    统计数据（总单词数、搜索次数、学习天数等）

&#x20; ├─ .sidebar-expand-btn     折叠态下的浮动展开按钮

&#x20; └─ .main-content           主内容区

&#x20;     ├─ .navbar             顶部导航栏（玻璃效果）

&#x20;     │   ├─ .navbar-logo-wrapper  Logo 图片

&#x20;     │   ├─ #theme-toggle   主题切换按钮

&#x20;     │   └─ .navbar-nav     导航链接列表

&#x20;     └─ .container          内容容器

&#x20;         ├─ #dictionary-page    词典页面（搜索框 + 结果 + 搜索历史）

&#x20;         ├─ #quiz-page          单词测验页面（设置项 + 题目 + 反馈）

&#x20;         ├─ #wordbook-page      单词本管理页面（CRUD + 导入导出 + Vue 列表）

&#x20;         ├─ #favorites-page     我的收藏页面（搜索 + 筛选排序 + Vue 列表）

&#x20;         ├─ #errorbook-page     错题本页面（搜索 + 筛选排序 + Vue 列表）

&#x20;         ├─ #review-page        复习模式页面

&#x20;         └─ #settings-page      设置页面（可拖拽配置项）

&#x20; └─ Vue 3 x-template 模板

&#x20;     ├─ #wordbook-vue-template

&#x20;     ├─ #favorites-vue-template

&#x20;     └─ #errorbook-vue-template

&#x20; └─ 弹窗

&#x20;     ├─ #ebbinghaus-modal       艾宾浩斯遗忘曲线说明

&#x20;     └─ #import-format-modal    导入格式说明

&#x20; └─ script\[type="module"] src="/src/main.ts"  前端入口

\</body>
```

**主题初始化**：在 `<head>` 中通过内联 `<script>` 读取 localStorage `darkMode`，在 DOM 解析前应用 `dark-mode` 类，防止视觉闪烁。

### 2.2 状态管理（store/index.ts）

采用 **Proxy + Reflect** 实现响应式系统，核心是 `createNestedProxy` 函数：



```
function createNestedProxy(target: any, path: StorePath): any {

&#x20;   if (target === null || typeof target !== 'object') return target;

&#x20;   if (target instanceof Date) return target;

&#x20;   if (target instanceof RegExp) return target;

&#x20;   if (typeof (target as any).nodeType !== 'undefined') return target; // DOM 节点不代理

&#x20;   if (proxyCache.has(target)) return proxyCache.get(target);

&#x20;   const proxy = new Proxy(target, {

&#x20;       get(t, key, receiver) {

&#x20;           const raw = Reflect.get(t, key, receiver);

&#x20;           if (typeof key === 'symbol') return raw;

&#x20;           if (raw !== null && typeof raw === 'object') {

&#x20;               return createNestedProxy(raw, \[...path, String(key)]);

&#x20;           }

&#x20;           return raw;

&#x20;       },

&#x20;       set(t, key, value, receiver) {

&#x20;           if (typeof key === 'symbol') return Reflect.set(t, key, value, receiver);

&#x20;           const fullPath = \[...path, String(key)];

&#x20;           const oldVal = Reflect.get(t, key, receiver);

&#x20;           const success = Reflect.set(t, key, value, receiver);

&#x20;           if (success && !shallowEqual(oldVal, value)) {

&#x20;               const storageKey = getLocalStorageKeyForPath(fullPath);

&#x20;               if (storageKey) persistToStorage(storageKey);

&#x20;               emitSubscribers(fullPath, value, oldVal);

&#x20;           }

&#x20;           return success;

&#x20;       },

&#x20;       deleteProperty(t, key) { ... }

&#x20;   });

&#x20;   proxyCache.set(target, proxy);

&#x20;   return proxy;

}
```

**核心特性**：



* **递归拦截**：通过 `createNestedProxy` 对所有嵌套对象创建代理，实现深层响应式

* **自动持久化**：`PERSISTENCE_MAP` 定义了状态与 localStorage key 的映射关系，set 操作自动触发 `persistToStorage`

* **订阅机制**：`subscribe(path, callback)` / `emitSubscribers(path, newValue, oldValue)` 实现 Pub-Sub 模式

* **ProxyCache**（WeakMap）：避免同一对象创建多个代理实例

**持久化映射表**：



| localStorage Key       | AppState Path          |
| ---------------------- | ---------------------- |
| `darkMode`             | `isDarkMode`           |
| `sidebarCollapsed`     | `sidebarCollapsed`     |
| `favorites`            | `favorites`            |
| `wordbooks`            | `wordbooks`            |
| `errorbook`            | `errorbook`            |
| `lastSelectedWordbook` | `lastSelectedWordbook` |
| `lastWordbookSelector` | `lastWordbookSelector` |
| `lastVisitedPage`      | `lastVisitedPage`      |
| `wordbookScrollTop`    | `wordbookScrollTop`    |
| `favoritesFilter`      | `favoritesFilter`      |
| `favoritesSortBy`      | `favoritesSortBy`      |
| `errorbookSortBy`      | `errorbookSortBy`      |
| `errorbookFilter`      | `errorbookFilter`      |
| `wordbookFilter`       | `wordbookFilter`       |
| `wordbookSortBy`       | `wordbookSortBy`       |
| `studyStats`           | `studyStats`           |
| `quizSettings`         | `settings`             |

**AppState 接口**：



```
interface AppState {

&#x20;   // 主题

&#x20;   isDarkMode: boolean;

&#x20;   // 侧边栏折叠

&#x20;   sidebarCollapsed: boolean;

&#x20;   // 词汇数据

&#x20;   vocabData: Array<{ word: string; phonetic: string; meanings: Array<{ part: string; definition: string }> }>;

&#x20;   // 收藏夹

&#x20;   favorites: Array<{ word: string; type?: string; timestamp?: number; translation?: string; meanings?: Array<{ part: string; definition: string }> }>;

&#x20;   // 自建单词本

&#x20;   wordbooks: Record\<string, Array<{ word: string; type?: string; phonetic?: string; meanings?: Array<{ part: string; definition: string }>; timestamp?: number }>>;

&#x20;   // 错题本

&#x20;   errorbook: Record\<string, { word: string; type?: string; timestamp?: number; errorCount?: number; correctCount?: number; translation?: string; meanings?: Array<{ part: string; definition: string }> }>;

&#x20;   // 筛选/排序 UI 状态

&#x20;   lastSelectedWordbook: string;

&#x20;   lastWordbookSelector: string;

&#x20;   favoritesFilter: FilterType;

&#x20;   favoritesSortBy: SortBy;

&#x20;   errorbookSortBy: SortBy;

&#x20;   errorbookFilter: FilterType;

&#x20;   errorbookExpanded: Record\<string, boolean>;

&#x20;   wordbookFilter: FilterType;

&#x20;   wordbookSortBy: SortBy;

&#x20;   // 查词/测验运行时状态

&#x20;   currentSearchWord: string | null;

&#x20;   currentSentence: string | null;

&#x20;   currentQuizWord: { word: string; phonetic: string; meanings: Array<{ part: string; definition: string }> } | null;

&#x20;   currentQuizMeanings: Array<{ part: string; definition: string }>;

&#x20;   currentQuizMode: QuizMode;

&#x20;   quizWords: Array<{ word: string; phonetic: string; meanings: Array<{ part: string; definition: string }> }>;

&#x20;   errorCount: number;

&#x20;   isWaitingForNextQuestion: boolean;

&#x20;   isProcessingAnswer: boolean;

&#x20;   isInInputCooldown: boolean;

&#x20;   inputCooldownTimer: ReturnType\<typeof setTimeout> | null;

&#x20;   // 学习统计

&#x20;   studyStats: null | {

&#x20;       totalWords: number;

&#x20;       searchCount: number;

&#x20;       studyDays: number;

&#x20;       todayWords: number;

&#x20;       errorWords: number;

&#x20;       lastStudyDate: string;

&#x20;   };

&#x20;   // 设置

&#x20;   settings: {

&#x20;       pronunciationType: PronunciationType;

&#x20;       chineseCount: number;

&#x20;       showAllMeanings: boolean;

&#x20;       answerKey: string;

&#x20;       playPronunciationKey: string;

&#x20;       addToWordlistKey: string;

&#x20;       addToFavoritesKey: string;

&#x20;       addToFavoritesKeyInQuiz: string;

&#x20;       addToErrorbookAfterShowAnswer: boolean;

&#x20;       errorCorrectCount: number;

&#x20;       autoPlayPronunciationAfterErrors: number;

&#x20;       quizOrder: QuizOrder;

&#x20;       quizWordCount: number;

&#x20;       searchHistoryCount: number;

&#x20;       enableEbbinghaus: boolean;

&#x20;       quizMultiPartProbability: number;

&#x20;       quizSinglePartProbability: number;

&#x20;       dailyWordCount: number;

&#x20;       quizMode?: QuizMode;

&#x20;       wordSource?: WordSource;

&#x20;       quizCount?: number;

&#x20;   };

&#x20;   // Vue 实例引用

&#x20;   wordbookVueInstance: VueInstance | null;

&#x20;   favoritesVueInstance: VueInstance | null;

&#x20;   errorbookVueInstance: VueInstance | null;

&#x20;   wordbookSearchInitialized: boolean;

&#x20;   \[key: string]: unknown;

}
```

**hydration 流程**（`hydrate()`）：



1. 从 localStorage 读取所有持久化字段

2. `darkMode` 特殊处理：`localStorage.getItem('darkMode') === 'true'`

3. `studyStats` 兜底：如果为 null 或非对象类型，初始化为默认统计值

4. `settings` 合并：默认设置 + localStorage 中的覆盖值

5. 调用 `store.flush()` 静默初始化一次持久化

**对外 API**：



* `snapshot()`：返回深拷贝的当前状态

* `patch(patchObj)`：批量更新状态

* `reset()`：重置为默认值

* `subscribe(paths, cb)`：订阅某路径下的变化，返回取消订阅函数

* `flush()`：强制写入所有持久化字段到 localStorage

### 2.3 应用入口（main.ts）



```
document.addEventListener('DOMContentLoaded', () => {

&#x20;   // 0. 注册页面处理函数（解决循环依赖）

&#x20;   pageHandlers.updateFavoritesDisplay = updateFavoritesDisplay;

&#x20;   pageHandlers.updateErrorbookDisplay = updateErrorbookDisplay;

&#x20;   pageHandlers.updateSelectedWordbookDisplay = updateSelectedWordbookDisplay;

&#x20;   pageHandlers.showSearchHistory = showSearchHistory;

&#x20;   pageHandlers.renameWordbook = renameWordbook;

&#x20;   pageHandlers.loadWordbooks = loadWordbooks;

&#x20;   pageHandlers.showLearningHistory = showLearningHistory;

&#x20;   pageHandlers.initReviewQuiz = initReviewQuiz;

&#x20;   // 0.5 注入 appState 到音频模块（供预加载使用）

&#x20;   setAppState(appState);

&#x20;   // 1. 应用主题

&#x20;   applyTheme();

&#x20;   // 1.5 毛玻璃滚动降级逻辑（只扫描当前激活页面内的 .glass，避免 DOM 变大后全局扫描）

&#x20;   initGlassScrollDegradation();

&#x20;   // 2. 初始化导航栏

&#x20;   setupNavbar();

&#x20;   // 3. 初始化网络状态检测

&#x20;   initNetworkStatus();

&#x20;   // 4. 初始化文件上传

&#x20;   initFileUpload();

&#x20;   // 5. 初始化主题切换

&#x20;   const themeToggle = document.getElementById('theme-toggle');

&#x20;   if (themeToggle) {

&#x20;       themeToggle.addEventListener('click', (e: MouseEvent) => toggleTheme(e));

&#x20;   }

&#x20;   // 5.5 初始化侧边栏折叠

&#x20;   initSidebarCollapse();

&#x20;   // 6. 初始化词典页面

&#x20;   initSearch();

&#x20;   initKeyboardShortcuts();

&#x20;   initTranslation();

&#x20;   // 7. 初始化测验页面

&#x20;   initQuiz();

&#x20;   // 8. 初始化单词本页面

&#x20;   initWordbookManagement();

&#x20;   // 9. 初始化设置页面

&#x20;   initSettings();

&#x20;   // 10. 初始化学习统计

&#x20;   initStudyStats();

&#x20;   // 11. 初始化单词本和错题本搜索

&#x20;   initWordbookAndErrorbookSearch();

&#x20;   // 12-14. 初始化收藏/错题本/单词本页面筛选排序按钮

&#x20;   initFavoritesFilterButtons();

&#x20;   initErrorbookFilterButtons();

&#x20;   initWordbookFilterButtons();

&#x20;   // 15. 初始化导入格式说明弹窗

&#x20;   initImportFormatModal();

&#x20;   // 16. 初始化艾宾浩斯说明弹窗

&#x20;   initEbbinghausModal();

&#x20;   // 17. 初始化导出选项

&#x20;   initExportOptions();

&#x20;   // 18. 初始化 GSAP 动效

&#x20;   initGsapAnimations();

&#x20;   // 19-21. 初始化 Vue 组件

&#x20;   initWordbookVue();

&#x20;   initFavoritesVue();

&#x20;   initErrorbookVue();

});
```

初始化流程严格按顺序执行：主题应用 → 毛玻璃降级 → 导航栏 → 网络检测 → 各功能模块 → Vue 组件。`pageHandlers` 对象用于解决模块间的循环依赖问题。

**全局函数注册表注册**：



```
setupGlobalRegistry({

&#x20;   jumpToWord,

&#x20;   navigateToWord,

&#x20;   playPronunciation,

&#x20;   playSentencePronunciation,

&#x20;   switchPage,

&#x20;   searchWord,

&#x20;   translateText,

&#x20;   showSearchHistory,

&#x20;   selectSuggestion: null, // 在 initSearch 中动态设置

&#x20;   removeFromFavorites,

&#x20;   setFavoritesFilter,

&#x20;   setFavoritesSort,

&#x20;   removeFromErrorbook,

&#x20;   setErrorbookFilter,

&#x20;   setErrorbookSort,

&#x20;   setWordbookFilter,

&#x20;   setWordbookSort,

&#x20;   removeFromWordlist,

&#x20;   showImportFormat,

&#x20;   removeFromSearchHistory,

&#x20;   toggleDueWords,

&#x20;   showDueWordsCondition,

});
```

### 2.4 全局功能（global.ts）

#### 主题切换（toggleTheme）

使用 clip-path 圆形波纹扩散 + 元素覆盖层动画实现主题切换。核心流程：



1. **收集元素**（`collectAnimItems`）：遍历所有 `.navbar`、`.sidebar`、`.word-card` 等 UI 元素，记录旧背景色、旧文字色、距离点击位置的距离

2. **锁定过渡**：锁定 `#bg-under`、`#bg-over` 和 body 的 transition，防止 class 切换瞬间跳变

3. **切换主题 class**：同步执行 `documentElement.classList.toggle('dark-mode')`，回退元素文字色为旧色

4. **创建覆盖层**（`createThemeOverlays`）：为每个元素创建 fixed 定位的 overlay，用旧背景色覆盖在新主题色上方，clip-path 从点击位置开始收缩

5. **遮罩扩散**：`#theme-mask` 从点击位置展开圆形遮罩覆盖全屏，遮罩为 radial-gradient 渐变背景

6. **清理**：释放背景层锁定 → 隐藏遮罩 → 移除 overlay → 恢复元素 transition

`toggleTheme` 主函数 91 行，`collectAnimItems` 和 `createThemeOverlays` 为拆分出的辅助函数，分别负责元素收集和覆盖层创建。

#### 页面切换（switchPage）

页面切换采用 keep-alive + LRU 淘汰策略，在 “切换流畅度” 与 “内存占用” 之间取平衡：



```
export async function switchPage(section: string): Promise\<void> {

&#x20;   if (section === currentSection || isSwitching) return;

&#x20;   const targetPage = document.getElementById(\`\${section}-page\`);

&#x20;   if (!targetPage) return;

&#x20;   isSwitching = true;

&#x20;   try {

&#x20;       // 更新导航栏激活状态

&#x20;       document.querySelectorAll('.nav-link').forEach(link => {

&#x20;           link.classList.remove('active');

&#x20;           if ((link as HTMLElement).dataset.section === section) {

&#x20;               link.classList.add('active');

&#x20;           }

&#x20;       });

&#x20;       const pages = document.querySelectorAll('.content-page');

&#x20;       const prevActive = document.querySelector('.content-page.active');

&#x20;       pages.forEach(page => page.classList.remove('active'));

&#x20;       // 刚离开的页面留在后台，标记为 rendered，下次切回不必重新 layout

&#x20;       if (prevActive) {

&#x20;           const prevSection = prevActive.id.replace('-page', '');

&#x20;           prevActive.classList.add('rendered');

&#x20;           renderedOrder = renderedOrder.filter(s => s !== prevSection);

&#x20;           renderedOrder.push(prevSection);

&#x20;           // 后台页面超过上限时释放最老的

&#x20;           if (renderedOrder.length > MAX\_RENDERED\_PAGES) {

&#x20;               releaseRenderedPages({ count: renderedOrder.length - MAX\_RENDERED\_PAGES });

&#x20;           }

&#x20;           await new Promise(r => requestAnimationFrame(r));

&#x20;       }

&#x20;       // 目标页从 rendered 记录中移除并激活

&#x20;       const targetRenderedIndex = renderedOrder.indexOf(section);

&#x20;       if (targetRenderedIndex >= 0) renderedOrder.splice(targetRenderedIndex, 1);

&#x20;       targetPage.classList.remove('rendered');

&#x20;       targetPage.classList.add('active');

&#x20;       animatePageEnter(targetPage);

&#x20;       // 触发对应页面的数据刷新

&#x20;       if (section === PageSection.Favorites) pageHandlers.updateFavoritesDisplay?.();

&#x20;       else if (section === PageSection.Wordbook) {

&#x20;           initWordbookAndErrorbookSearch();

&#x20;           pageHandlers.updateSelectedWordbookDisplay?.();

&#x20;       }

&#x20;       else if (section === PageSection.Errorbook) {

&#x20;           initWordbookAndErrorbookSearch();

&#x20;           pageHandlers.updateErrorbookDisplay?.();

&#x20;       }

&#x20;       else if (section === PageSection.Review) initReviewPage();

&#x20;       else if (section === PageSection.Dictionary) pageHandlers.showSearchHistory?.();

&#x20;       else if (section === PageSection.Quiz) await updateWordSourceSelector();

&#x20;   } finally {

&#x20;       isSwitching = false;

&#x20;       currentSection = section as PageSection;

&#x20;   }

}
```

**后台页面管理**：



* `.content-page.rendered:not(.active)` 保持 `display: block` 但 `visibility: hidden`、`pointer-events: none`，下次切回时直接移除 `rendered` 并添加 `active`，没有重新构建 DOM 的开销。

* 后台页面最多保留 `MAX_RENDERED_PAGES = 3` 个，超出时按 LRU 释放最老的页面，避免 DOM 过多导致切换卡顿。

* 释放时调用 `releaseRenderedPages()` 移除 `.rendered` 类，让页面回到 `display: none` 状态，并通知主进程。

**主进程内存兜底**：



* 主进程每 10 秒通过 `app.getAppMetrics()` 读取渲染进程工作集内存。

* 当渲染进程内存超过 `MEMORY_THRESHOLD_MB = 1024` 时，发送 `release-pages` 事件，前端释放一半后台页面。

* 前端释放完成后通过 `memory-released` IPC 回执数量，便于日志追踪。

**切换动画**：



* 使用 `requestAnimationFrame` 确保先完成后台页面标记，再激活目标页。

* 目标页激活后调用 `animatePageEnter(targetPage)` 触发 GSAP 入场动画（缩放 / 透明度）。

* 切换过程中 `isSwitching` 锁防止连续点击导致的动画重叠。

#### 单词跳转（jumpToWord）

从例句、收藏、错题本等位置的单词链接触发：



```
export async function jumpToWord(word: string): Promise\<void> {

&#x20;   // 切换到词典页面

&#x20;   switchPage('dictionary-page');

&#x20;   // 执行搜索

&#x20;   await searchWord(word);

}
```

#### 全局函数注册表（global-registry.ts）

为避免直接挂载到 `window`，使用注册表模式：



```
const registry: Partial\<Registry> = {};

export function setupGlobalRegistry(functions: Partial\<Registry>): void {

&#x20;   Object.assign(registry, functions);

}

/\*\*

&#x20;\* 供动态 HTML 内联 onclick 调用的全局入口

&#x20;\* onclick="g('jumpToWord','word')" → 通过注册表执行

&#x20;\*/

(window as Record\<string, unknown>).g = function(name: string, ...args: unknown\[]): void {

&#x20;   const fn = registry\[name as keyof Registry];

&#x20;   if (typeof fn === 'function') {

&#x20;       fn(...args);

&#x20;   } else {

&#x20;       console.warn(\`\[global-registry] 函数 \${name} 未注册\`);

&#x20;   }

};
```

注册的函数包括：`jumpToWord`, `navigateToWord`, `playPronunciation`, `playSentencePronunciation`, `switchPage`, `searchWord`, `translateText`, `showSearchHistory`, `selectSuggestion`, `removeFromFavorites`, `setFavoritesFilter`, `setFavoritesSort`, `removeFromErrorbook`, `setErrorbookFilter`, `setErrorbookSort`, `setWordbookFilter`, `setWordbookSort`, `removeFromWordlist`, `showImportFormat`, `removeFromSearchHistory`, `toggleDueWords`, `showDueWordsCondition`。HTML 中通过 `onclick="g('functionName', arg1, arg2)"` 调用。

#### 弹窗式下拉选择器（src/utils/popupSelect.ts）

全程序的原生 `<select>` 统一替换为「按钮触发器 + 居中模态选项列表」，由 `initPopupSelects()`（main.ts 启动时调用）接管：

* 原生 select 保留在 DOM 中作为状态载体（加 `.ps-native-hidden` 即 `display:none`），其后插入 `button.ps-trigger`；业务代码读写 `select.value`、监听 `change` 的逻辑全部不变。通过 `Object.defineProperty` 重写实例 `value` setter，外部代码（如 `updateWordbookSelect()` 重建选项后赋值）会同步按钮文案；select 自身再挂一个 MutationObserver 监听选项增删 / disabled。

* 全局一个 MutationObserver 监听 `documentElement` 的子树新增节点，动态插入的 select（词典结果区、句子收藏弹窗、设置资源行、听力播放条等）自动接管。跳过清单：`#word-source`（由 bookPicker 提供专属树弹窗）、`.word-source-hidden-select`、`[data-popup-native]`、弹窗自身内部的 select。

* 单例弹窗 `#ps-overlay`（类含 `modal-overlay custom-prompt-modal`，`.ps-overlay` 自带 `position:fixed;inset:0;flex` 居中——其他模态框靠 HTML 内联定位，此处不能复用）；标题解析顺序 `data-popup-title` → `aria-label` → `label[for]` → 父 / 同级 label。选项点击写回 `select.value` 并派发 `input` + `change`；遮罩点击、× 按钮、捕获阶段 Esc 均可关闭；因带 `custom-prompt-modal` 类，不会被 global.ts 的通用 ESC / 遮罩处理重复响应。

* 尺寸：默认 md；`.setting-select / .ex-rate-select / .result-wb-select / #export-format / .pronunciation-accent-select` 判定为 sm。接管的位置包括：学习类别、测验模式 / 顺序、单词本选择、导出格式、复习模式 / 来源、发音类型、查词结果单词本选择器、句子加入单词本、发音口音、听力播放速度等。

* 触发器尾部为**右向 chevron**（`polyline points="9 6 15 12 9 18"`）而非下拉箭头：点击打开的是居中模态而非锚定下拉，故不做展开旋转，改为 hover / 键盘聚焦时右移 2px 并变蓝（与单词来源按钮的「更换 ›」语义一致）。

### 2.5 类型枚举（enums.ts）



```
/\*\* 发音类型 \*/

const enum PronunciationType {

&#x20;   US = 'us',

&#x20;   UK = 'uk',

}

/\*\* 测验模式 \*/

const enum QuizMode {

&#x20;   ZhToEn = 'zh-to-en',      // 中文 → 英文

&#x20;   EnToZh = 'en-to-zh',      // 英文 → 中文

&#x20;   WordMeaning = 'word-meaning',

&#x20;   Dictation = 'dictation',  // 听写模式

&#x20;   Spelling = 'spelling',    // 拼写模式：看释义拼写单词，逐字符即时反馈

&#x20;   ListeningStuck = 'listening-stuck', // 听力卡壳词追踪：听发音写单词/句子，记录薄弱点

}

/\*\* 答题顺序 \*/

const enum QuizOrder {

&#x20;   Random = 'random',

&#x20;   Order = 'order',

}

/\*\* 排序方式 \*/

const enum SortBy {

&#x20;   Alphabetical = 'alphabetical',

&#x20;   Frequency = 'frequency',

&#x20;   Time = 'time',

}

/\*\* 筛选类型 \*/

const enum FilterType {

&#x20;   All = 'all',

&#x20;   Word = 'word',

&#x20;   Phrase = 'phrase',

&#x20;   Sentence = 'sentence',

}

/\*\* 页面区段 \*/

const enum PageSection {

&#x20;   Dictionary = 'dictionary',

&#x20;   Quiz = 'quiz',

&#x20;   Wordbook = 'wordbook',

&#x20;   Favorites = 'favorites',

&#x20;   Errorbook = 'errorbook',

&#x20;   Review = 'review',

&#x20;   Settings = 'settings',

}

/\*\* 单词内容分类 \*/

const enum ContentType {

&#x20;   Word = 'word',

&#x20;   Phrase = 'phrase',

&#x20;   Sentence = 'sentence',

}
```

**注意**：当前 UI 中测验 / 复习模式实际只暴露 `zh-to-en`、`en-to-zh`、`dictation` 三种选项，`word-meaning` 保留在枚举中供未来扩展。



***

## 3. 前端功能模块

### 3.1 词典模块（dictionary.ts）

#### 核心功能：searchWord 与 searchOrTranslate

`searchWord` 用于用户明确查词（点击搜索按钮 / 回车）：



```
export async function searchWord(word: string): Promise\<void> {

&#x20;   // 1. 记录搜索历史、更新统计

&#x20;   recordSearchHistory(word);

&#x20;   appState.studyStats.searchCount++;

&#x20;   updateStudyStats();

&#x20;   // 2. 并行请求主词典和二级词典增强信息

&#x20;   const \[searchResponse, enhancedResponse] = await Promise.all(\[

&#x20;       fetch('/api/search?word=' + encodeURIComponent(word)),

&#x20;       fetch('/api/enhanced?word=' + encodeURIComponent(word))

&#x20;   ]);

&#x20;   // 3. 处理主词典结果

&#x20;   const searchData = await searchResponse.json();

&#x20;   if (searchData.success) {

&#x20;       const formattedData = convertApiDataToFrontendFormat(searchData.data);

&#x20;       // 处理词形变化、标签、例句等

&#x20;       displayResult(formattedData);

&#x20;   } else {

&#x20;       // 4. 词典未找到时调用翻译 API

&#x20;       translateText(word);

&#x20;   }

}
```

`searchOrTranslate`**&#x20;智能路由**：输入框输入后自动判断类型



* **句子**（包含空格且长度 > 1 个单词）：直接调用翻译 API

* **单词 / 词组**：先查词典，未找到再降级翻译

#### 句子收藏与单词本功能

词典页面支持对例句进行收藏和加入单词本：



* `toggleSentenceFavorites()`：收藏 / 取消收藏当前显示的例句

* `toggleSentenceWordbook()`：将例句加入指定单词本

* `showSentenceWordbookModal()`：弹出单词本选择弹窗

* `bindSentenceButtonEvents()`：绑定例句操作按钮事件

* `updateSentenceButtons()`：更新按钮状态（已收藏 / 未收藏图标切换）

#### 搜索建议（debounced）

输入框 `input` 事件触发搜索建议，使用 300ms 防抖：



```
let searchDebounceTimer: ReturnType\<typeof setTimeout> | null = null;

searchInput.addEventListener('input', function() {

&#x20;   if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

&#x20;   searchDebounceTimer = setTimeout(async () => {

&#x20;       const response = await fetch('/api/match?prefix=' + encodeURIComponent(query));

&#x20;       const data = await response.json();

&#x20;       showSuggestions(data.matches);

&#x20;   }, 300);

});
```

#### 搜索历史



* 使用 localStorage 存储，最多保留 `appState.settings.searchHistoryCount`（默认 20）条

* 最近搜索的单词排在前面

* 点击历史条目自动触发搜索

#### 标签显示

ECDict tags 在前端显示：



* `xx` → 小学（紫色 #9b59b6）

* `zk` → 中考（紫色 #9b59b6）

* `gk` → 高考（紫色 #9b59b6）

* `cet4` → 四级（绿色 #27ae60）

* `cet6` → 六级（绿色 #27ae60）

* `tem4` → 专四（橙色 #e67e22）

* `tem8` → 专八（橙色 #e67e22）

* `ky` → 考研（红色 #e74c3c）

* `toefl` → 托福（橙色 #f39c12）

* `ielts` → 雅思（青色 #1abc9c）

* `gre` → GRE（青色 #1abc9c）

**显示规范化**（`src/modules/dictionary.ts` 的 `normalizeDisplayTags`）：



* `cet46` 会拆分为 `cet4` 和 `cet6` 两个标签显示；后端检索仍按空格分隔精确匹配，因此检索 `cet4` 时不会混入仅含 `cet46` 的单词。

* 若单词同时含 `coca` 和 `coca20000`，仅显示 `coca`。

* `sum_all` 为汇总标记，不在标签区显示；`gpt4` 为 GPT-4 词表标记，保留显示。

#### 释义渲染与词性标签（parseMeanings /buildTranslationHtml）

词典结果、单词本、收藏、错题本共用 `src/utils/translation.ts` 中的释义渲染逻辑，保证词性 / 领域标签显示一致：



```
export interface ParsedMeaning {

&#x20;   part: string;

&#x20;   definition: string;

}

export function parseMeanings(translation?: string, definition?: string): ParsedMeaning\[] {

&#x20;   // 把中文 translation 按行拆分；

&#x20;   // 若某行没有词性，尝试从对应行的英文 definition 里补词性；

&#x20;   // 仍无词性时默认标注为 "词组"。

}

export function buildTranslationHtml(

&#x20;   translation?: string,

&#x20;   phonetic?: string,

&#x20;   definition?: string

): string {

&#x20;   // 基于 parseMeanings 输出带 .part-of-speech / .definition 的 HTML

}
```

**标签规则**：



* 词性标签如 `n.`、`art.`、`prep.`、`adv.` 等统一渲染为 `.part-of-speech` 色块；词库中还存在 `ad.`、`vbl.`、`interj.`、`auxv.`、`linkv.`、`modalv.`、`det.` 等内联或连接写法，均已纳入识别。

* 行内词性标签（如 `废物vt. 废弃`）以及连接符分隔的多个词性（如 `a. & n. xxx`、`a./adv. xxx`）会被拆分为独立义项。

* 领域标签如 `[计]`、`[医]`、`[经]` 等也渲染为色块，并保留固定颜色映射（医红、经橙、法蓝、计绿等）。

* ECDICT 中部分中文释义行本身不带词性（如 `a` 的第一条 `第一个字母 A; 一个; 第一的`），会取英文释义同行的 `n.` 作为标签，避免误标为 “词组”。

* 部分原始释义数据存在缺失半个括号的情况（如 `使)循环,(使)传播`），`parseMeanings` 会在解析前自动补全为 `(使)循环,(使)传播`。

单词本、收藏、错题本的卡片展开时调用 `buildTranslationHtml(data.translation, data.phonetic, data.definition)` 填充释义；词典页在 `convertApiDataToFrontendFormat()` 中直接调用 `parseMeanings()` 得到结构化的 `meanings` 数组。

#### 发音播放

通过 `playPronunciation(type, word)` 触发，调用后端 `/api/audio/${type}/${word}.mp3`。失败时回退到 `/api/audio/generate`。

### 3.2 测验模块（quiz.ts）

#### 测验流程



```
用户选择模式 → startQuiz() → 加载单词池 → 排序（随机/顺序/艾宾浩斯）→&#x20;

限制数量 → 批量加载释义 → generateQuestion() → 用户输入 → checkAnswer() →&#x20;

showAnswer() → nextQuestion()
```

#### startQuiz



```
export async function startQuiz(): Promise\<void> {

&#x20;   // 1. 获取设置

&#x20;   const quizMode = document.getElementById('quiz-mode').value;

&#x20;   const wordSource = document.getElementById('word-source').value;

&#x20;   const quizOrder = document.getElementById('quiz-order').value;

&#x20;   const quizCount = parseInt(document.getElementById('quiz-count').value);

&#x20;   // 2. 根据来源加载单词

&#x20;   if (wordSource === 'favorites') { ... }

&#x20;   else if (wordSource === 'errorbook') { ... }

&#x20;   else if (wordSource.startsWith('wordbook:')) { ... }

&#x20;   else if (wordSource.startsWith('system:')) { ... }

&#x20;   else { appState.quizWords.push(...appState.vocabData); }

&#x20;   // 3. 排序

&#x20;   if (quizOrder === QuizOrder.Random) {

&#x20;       if (appState.settings.enableEbbinghaus) {

&#x20;           // 艾宾浩斯模式：按权重分组，组内 Fisher-Yates 随机

&#x20;       } else {

&#x20;           // 纯随机 Fisher-Yates shuffle

&#x20;       }

&#x20;   }

&#x20;   // 4. 限制数量

&#x20;   if (appState.quizWords.length > quizCount) {

&#x20;       appState.quizWords = appState.quizWords.slice(0, quizCount);

&#x20;   }

&#x20;   // 5. 批量加载释义（/api/words/batch）

&#x20;   // 6. 生成第一题

&#x20;   await generateQuestion();

}
```

#### 拼写模式

新增 `QuizMode.Spelling`，用于训练「认识但写不出」的痛点：



* 题目展示中文释义，用户根据释义拼写完整英文单词。

* 输入框下方实时渲染逐字符反馈：正确字母绿色高亮、错误字母红色高亮并抖动。

* 当输入长度与目标单词一致且全部正确时，自动调用 `checkAnswer()` 提交并进入下一题。

* 错误时不会自动提交，用户可继续修改或按 Enter 手动提交。

* 相关函数：`updateSpellingFeedback()`（实时反馈）、`checkQuizAnswer()`（答案检查，与中文→英文共用逻辑）。

#### 听力卡壳词追踪

新增 `QuizMode.ListeningStuck`，用于训练「听得懂但写不出 / 反应慢」的听力薄弱点：



* 题目区播放单词或句子发音，用户听写输入；首次自动播放一次，可手动点击「播放发音」重复收听。

* 句子类题目额外提供中文参考提示，降低听力门槛。

* 回答错误时自动将该词标记为「听力卡壳词」，累加 `stuckCount` 并更新 `lastStuckTime`。

* 测验结束页展示「本轮听力卡壳词」列表，支持点击单词跳转查词，方便针对性练习。

* 卡壳词数据持久化到 `localStorage`，通过 `appState.listeningStuckWords` 全局共享，后续可用于薄弱点分析看板。

* 相关函数：`markAsListeningStuck()`（记录卡壳词）、`buildCurrentRoundStuckWordsHtml()`（生成结果列表）。

#### 艾宾浩斯遗忘曲线



```
export function calculateEbbinghausWeight(word: string): number {

&#x20;   const learningHistory = JSON.parse(localStorage.getItem('learningHistory'));

&#x20;   if (!learningHistory\[word]) return 1.0; // 新词权重最高

&#x20;   const now = Date.now();

&#x20;   const nextReviewTime = learningHistory\[word].nextReviewTime;

&#x20;   if (now >= nextReviewTime) {

&#x20;       // 超过复习时间：0.5-1.0，超时越多权重越高

&#x20;       const overdueTime = now - nextReviewTime;

&#x20;       const maxOverdue = 30 \* 24 \* 60 \* 60 \* 1000;

&#x20;       const overdueRatio = Math.min(overdueTime / maxOverdue, 1);

&#x20;       return 0.5 + (0.5 \* overdueRatio);

&#x20;   } else {

&#x20;       // 未到复习时间：0.1-0.5，距离越近权重越高

&#x20;       const timeUntilReview = nextReviewTime - now;

&#x20;       const maxTime = 90 \* 24 \* 60 \* 60 \* 1000;

&#x20;       const timeRatio = Math.min(timeUntilReview / maxTime, 1);

&#x20;       return 0.1 + (0.4 \* (1 - timeRatio));

&#x20;   }

}
```

**复习间隔**：1 天、2 天、4 天、7 天、15 天、30 天、60 天、90 天

#### generateQuestion

根据测验模式生成题目：



* **听写模式（Dictation）**：显示 "请听发音并写出单词"，自动播放发音

* **听力卡壳词追踪（ListeningStuck）**：显示 "请听发音并写出听到的单词或句子"，自动播放发音，句子附中文参考提示

* **中译英（ZhToEn）**：显示中文释义，要求输入英文单词

* **英译中（EnToZh）**：显示英文单词 + 音标，要求输入中文释义

释义解析逻辑：



1. 按分号（`；;`）拆分主要释义组

2. 每组按逗号（`，,`）拆分为同义词

3. 根据 `showAllMeanings` 设置过滤领域标签（如 `[计]`、`[医]`）

4. 按 `chineseCount` 限制显示数量

5. 支持多词性模式（基于 `quizMultiPartProbability` 百分比）

#### checkAnswer

答案判断逻辑：



* **中译英 / 听写模式**：精确匹配（忽略大小写和标点）

* **英译中模式**：

1. 拆分所有正确释义（分号、逗号分割）

2. 拆分用户输入（逗号、分号、空格分割）

3. 逐个判断是否包含关系

4. 全部正确 → 回答正确；部分正确 → 提示再检查；全部错误 → 回答错误

**错题权重更新**：



* 错误时：`meaningWeights[definition].weight *= 1.1`，`errorCount++`

* 正确时：`meaningWeights[definition].weight *= 0.9`，`correctCount++`

* 当 `correctCount >= settings.errorCorrectCount`（默认 3）时从错题本移除

**自动播放发音**：错题次数达到 `autoPlayPronunciationAfterErrors` 阈值时自动播放（句子不自动播放）

#### 公共逻辑

测验和复习共用 `src/utils/quizCommon.ts` 中的输入处理逻辑：



* `setupImeHandling(input)`：中文输入法 compositionstart/compositionend 处理 + 数字键拦截

* `setupEnterSubmission(input, imeState, onEnter)`：Enter 提交（检查 IME 状态、禁用状态）

* `setupInputCooldown(input)`：EnToZh 模式输入后 300ms 冷却期

* `getRandomMeanings(meanings)`：按分号分组随机选释义 + Fisher-Yates 洗牌

### 3.3 单词本模块（wordbook.ts）

#### CRUD 操作

所有单词本的创建、重命名、删除、添加单词、移除单词均通过后端 API 完成：



* `POST /api/wordbook/create` - 创建单词本

* `POST /api/wordbook/delete` - 删除单词本

* `POST /api/wordbook/rename` - 重命名单词本

* `POST /api/wordbook/add` - 添加单词

* `POST /api/wordbook/remove` - 移除单词

* `POST /api/wordbook/reorder` - 持久化排序（拖拽后）

* `GET /api/wordbook/list` - 获取单词本列表

* `POST /api/wordbook/import` - 导入单词

* `POST /api/wordbook/export` - 导出单词本

* `POST /api/wordbook/export-stream` - SSE 流式导出（真实进度）

* `POST /api/wordbook/export-docx` - 简化 docx 导出

#### Vue 虚拟列表

单词本、收藏、错题本均使用 Vue 3 CDN + 虚拟列表渲染，核心优化封装在 `src/utils/virtualScroll.ts`：

**分段懒计算偏移**：



```
computed: {

&#x20;   offsets() {

&#x20;       const { start, end } = this.visibleRange;

&#x20;       const cache = this.\_offsetCache;

&#x20;       const len = this.wordList.length;

&#x20;       let anchorIdx = -1, anchorOffset = 0;

&#x20;       // 找到缓存中不超过 start 的最大偏移锚点（每20步回查）

&#x20;       for (let i = start; i >= 0; i -= 20) {

&#x20;           if (cache\[i] !== undefined) { anchorIdx = i; anchorOffset = cache\[i]; break; }

&#x20;       }

&#x20;       if (anchorIdx < 0) { anchorIdx = 0; anchorOffset = 0; }

&#x20;       // 从锚点向下计算到 start

&#x20;       for (let i = anchorIdx + 1; i <= start; i++) {

&#x20;           anchorOffset += this.getHeight(i);

&#x20;       }

&#x20;       // 从 start 到 end 逐元素计算并缓存

&#x20;       const arr = \[];

&#x20;       for (let i = start; i < end && i < len; i++) {

&#x20;           arr.push(anchorOffset);

&#x20;           cache\[i] = anchorOffset;

&#x20;           anchorOffset += this.getHeight(i);

&#x20;       }

&#x20;       return arr;

&#x20;   }

}
```

**可见范围二分查找**：



```
visibleRange() {

&#x20;   const cache = this.\_offsetCache;

&#x20;   const len = this.wordList.length;

&#x20;   const viewTop = this.scrollTop;

&#x20;   const viewBottom = viewTop + this.containerHeight;

&#x20;   const bufferPx = this.BUFFER \* this.collapsedHeight;

&#x20;   // 二分查找定位 start（基于缓存或估算偏移）

&#x20;   let start = 0;

&#x20;   let low = 0, high = len - 1;

&#x20;   while (low <= high) {

&#x20;       const mid = (low + high) >> 1;

&#x20;       const estOffset = cache\[mid] ?? mid \* this.collapsedHeight;

&#x20;       const estBottom = estOffset + this.collapsedHeight \* 2;

&#x20;       if (estBottom < viewTop - bufferPx) {

&#x20;           start = mid + 1;

&#x20;           low = mid + 1;

&#x20;       } else {

&#x20;           high = mid - 1;

&#x20;       }

&#x20;   }

&#x20;   start = Math.max(0, start - this.BUFFER);

&#x20;   // 从 start 开始线性扫描找 end

&#x20;   let end = len;

&#x20;   let curOffset = cache\[start] ?? start \* this.collapsedHeight;

&#x20;   for (let i = start; i < len; i++) {

&#x20;       if (i > start) curOffset += this.getHeight(i);

&#x20;       if (curOffset > viewBottom + bufferPx) {

&#x20;           end = i;

&#x20;           break;

&#x20;       }

&#x20;   }

&#x20;   end = Math.min(len, end + this.BUFFER);

&#x20;   return { start, end };

}
```

**totalHeight 尾部估算**：



```
totalHeight() {

&#x20;   const len = this.wordList.length;

&#x20;   if (len === 0) return 0;

&#x20;   const cache = this.\_offsetCache;

&#x20;   // 从尾部回查 200 项找到缓存锚点

&#x20;   let baseIdx = -1, baseOffset = 0;

&#x20;   for (let i = len - 1; i >= Math.max(0, len - 200); i--) {

&#x20;       if (cache\[i] !== undefined) { baseIdx = i; baseOffset = cache\[i]; break; }

&#x20;   }

&#x20;   if (baseIdx < 0) {

&#x20;       // 全量回退计算

&#x20;       for (let i = 0; i < len; i++) baseOffset += this.getHeight(i);

&#x20;   } else {

&#x20;       for (let i = baseIdx; i < len; i++) baseOffset += this.getHeight(i);

&#x20;   }

&#x20;   return baseOffset;

}
```

**高度缓存机制**：



* 折叠状态：`collapsedHeight = 140px`

* 展开 / 翻转状态：首次估算 `collapsedHeight * 3`（420px），DOM 渲染后通过 `offsetHeight + 50` 精确测量

* 测量结果存入 `cachedHeights[word]`，避免重复计算

**滚动节流（rAF）**：



```
onScroll(e: Event) {

&#x20;   const target = (e.target as HTMLElement).scrollTop;

&#x20;   this.\_pendingScrollTop = target;

&#x20;   if (this.\_rafId) return;  // 已在等待帧，跳过

&#x20;   this.\_rafId = requestAnimationFrame(() => {

&#x20;       this.scrollTop = this.\_pendingScrollTop;

&#x20;       this.\_rafId = 0;

&#x20;   });

}
```



* 快速拖拽滚动条时，scroll 事件每秒触发数十次

* rAF 节流确保每帧最多只触发一次 Vue 响应式更新

* 消除快速滚动时的渲染积压和空白间隙

**缓冲区设置**：



* `BUFFER = 20`（视口上下各预留 20 条）

* 缓冲区高度 = 20 × 140px = 2800px

* 快速滚动时有足够的安全余量，避免下方出现空白

**缓存清理**：



* `setWordList()` 中清空 `_offsetCache`，确保切换单词本 / 收藏 / 错题本时缓存不会残留旧数据

#### 导入 / 导出

**导入**：支持文本文件上传（.txt/.docx），后端解析单词 / 词组，返回统计信息（总数、单词数、词组数、成功数、重复数、失败数）

**导出**：



* 支持格式：TXT、DOCX

* 选项：包含释义、包含音标

* 进度条：使用 SSE `/api/wordbook/export-stream` 真实进度

* 阶段：连接 → 批量查询（分批返回 progress 事件）→ 生成文件 → 返回 base64 done 事件

* 导出时使用 "释义:" 标签

* 音标中的 `ˌ`（次重音符号）需正确替换

#### 筛选与排序



* **筛选**：全部 / 单词 / 词组 / 句子（`FilterType` 枚举）

* **排序**：字母顺序 / 添加时间（自定义单词本）；字母顺序 / 添加时间 / 出错频率（错题本）

* 筛选和排序状态通过 localStorage 持久化

**系统单词本**：



* 显示格式：`系统-四级 (数量)`

* 不可删除、不可修改、不可编辑、不可导入

* 单词选择器中显示单词数量（如 "四级 1 (15 词)"）

* 通过 `/api/system-wordbook/words?tag=xxx&limit=200&offset=0` 分页加载，前端显示进度条

**自定义单词本**：



* 显示格式：`四级1 (15词)`

* 数量单位使用 "词" 而非 "个"

* 单词数量动态更新

### 3.4 收藏模块（favorites.ts）

收藏列表支持：



* 类型筛选（单词 / 词组 / 句子）

* 排序（字母 / 时间）

* 搜索过滤（前缀优先 + 包含）

* Vue 虚拟列表渲染

* 展开查看释义和例句（懒加载 API）

* 翻转卡片显示背面

* 正面显示收藏时缓存的 translation /meanings

### 3.5 错题本模块（errorbook.ts）

错题本特性：



* 记录每个单词的错误次数（`errorCount`）和正确次数（`correctCount`）

* 记录每个释义的权重（`meaningWeights`），用于测验时基于权重选择释义

* 排序方式：出错频率（基于权重总和）/ 字母顺序 / 时间

* 类型筛选（单词 / 词组 / 句子）

* Vue 虚拟列表渲染

**类型判断**（`getItemType`）：



```
export function getItemType(item: unknown): string {

&#x20;   const text = typeof item === 'string' ? item : (item.word || item.text || '');

&#x20;   const words = text.trim().split(/\s+/);

&#x20;   if (words.length <= 1) return 'word';

&#x20;   if (words.length > 5 || /\[.!?;]/.test(text)) return 'sentence';

&#x20;   return 'phrase';

}
```

### 3.6 设置模块（settings.ts）

#### 配置项



| 配置                               | 默认值      | 说明                                                     |
| -------------------------------- | -------- | ------------------------------------------------------ |
| pronunciationType                | 'us'     | 发音类型（美式 / 英式）                                          |
| chineseCount                     | 1        | 英译中模式显示中文释义数量                                          |
| showAllMeanings                  | false    | 是否显示全部释义（含领域标签）                                        |
| answerKey                        | '1'      | 显示答案快捷键                                                |
| playPronunciationKey             | '2'      | 播放发音快捷键                                                |
| addToWordlistKey                 | '1'      | 加入单词本快捷键（词典页面）                                         |
| addToFavoritesKey                | '2'      | 收藏快捷键（词典页面）                                            |
| addToFavoritesKeyInQuiz          | '3'      | 测验时加入收藏快捷键                                             |
| addToErrorbookAfterShowAnswer    | false    | 显示答案后自动加入错题本                                           |
| errorCorrectCount                | 3        | 错题正确多少次后移出                                             |
| autoPlayPronunciationAfterErrors | 2        | 错题自动播放发音阈值（0 = 不播放）                                    |
| quizOrder                        | 'random' | 测验单词顺序                                                 |
| quizWordCount                    | 10       | 默认测验单词数量                                               |
| searchHistoryCount               | 20       | 搜索历史保留条数                                               |
| enableEbbinghaus                 | true     | 启用艾宾浩斯遗忘曲线                                             |
| quizMultiPartProbability         | 50       | 多词性模式概率（%）                                             |
| quizSinglePartProbability        | 50       | 同一词性出现概率（%）                                            |
| dailyWordCount                   | 20       | 每日学习单词数                                                |
| soundEnabled                     | true     | 是否启用操作音效（答对 / 答错 / 按钮点击 / 完成提示）                        |
| playbackRate                     | 1.0      | TTS 发音播放速率（0.5-2.0）                                    |
| semanticSimilarityEnabled        | true     | 语义相似度模型开关，仅在「看英文写中文」模式字符串匹配失败时启用本地模型兜底判断（关闭可减少 CPU 占用） |

#### 快捷键冲突检测

保存设置时检测：



* 测验页面：`answerKey` 与 `playPronunciationKey` 不能相同

* 词典页面：`addToWordlistKey` 与 `addToFavoritesKey` 不能相同

#### 拖拽排序

设置项支持拖拽排序，基于 **Pointer Events API** 实现：



```
interface DragState {

&#x20;   container: HTMLElement;

&#x20;   containerKey: string;      // 'page-settings' 或 'quiz-settings'

&#x20;   sourceItem: HTMLElement;

&#x20;   sourceIndex: number;

&#x20;   items: HTMLElement\[];

&#x20;   originalRects: DOMRect\[];  // 相对容器坐标（不受滚动影响）

&#x20;   ghost: HTMLElement;        // 浮动副本（position: fixed, scale(1.05)）

&#x20;   offsetX: number;

&#x20;   offsetY: number;

&#x20;   targetIndex: number;

&#x20;   pointerId: number;

&#x20;   hasMoved: boolean;

&#x20;   lastMouseX: number;

&#x20;   lastMouseY: number;

}
```

**核心算法**：



1. `pointerdown`：记录源项索引、创建 ghost 副本、记录原始 rect（相对容器坐标）

2. `pointermove`：ghost 瞬间跟随鼠标（无 CSS transition），计算 `computeTargetIndex` 确定插入位置，`applyShifts` 计算其他项的 transform 偏移

3. `pointerup`：DOM 重排序、保存到 localStorage、清除 transform（带 0.22s 归位动画）

**transform 偏移计算**（`applyShifts`）：



* 向前拖（targetIndex < sourceIndex）：`[targetIndex, sourceIndex)` 的项向后移动一格

* 向后拖（targetIndex > sourceIndex）：`(sourceIndex, targetIndex]` 的项向前移动一格

* 源项保持半透明占位（`.is-dragging` 类，opacity: 0.25）

**关键实现细节**：



* `originalRects` 存储容器相对坐标而非视口坐标，避免 `getBoundingClientRect()` 受 transform 影响

* 交互元素（input, select, textarea, a, button）不触发拖拽操作

* 拖拽手柄（⋮⋮）显示在设置项上，指示可拖拽功能

排序持久化键：`setting-sort-order-page-settings`、`setting-sort-order-quiz-settings`

#### 清除所有数据

`clearAllData()` 流程：



1. 调用 `/api/cache/clear` 清除服务器翻译缓存与音频缓存。

2. 调用 `/api/wordbook/clear` 清空服务器端 `wordbooks.json` 中的用户单词本。

3. 执行 `localStorage.clear()` 清除前端本地存储（收藏、错题本、学习统计、学习历史等）。

4. 重置 `appState.settings` 为完整默认配置（含测验模式、来源、数量、每日单词数、语速、语义相似度开关等全部字段）并刷新 UI，3 秒后刷新页面。

### 3.7 复习模块（review.ts）

复习模块提供与测验模式类似的交互式复习流程，但侧重于巩固已学习单词，支持按来源筛选、艾宾浩斯到期词集中复习、学习历史按天回溯。

#### 页面结构



```
\#review-page

├─ .review-setup           复习设置区

│   ├─ #review-source      复习来源下拉框

│   │   ├─ comprehensive   综合复习

│   │   ├─ ebbinghaus      艾宾浩斯到期词

│   │   ├─ errorbook       错题本

│   │   └─ recent          近期练习词

│   ├─ #review-count       复习数量

│   ├─ #review-mode        复习模式

│   └─ #start-review       开始复习按钮

├─ 艾宾浩斯到期词折叠面板   显示 nextReviewTime <= 当前时间的单词

└─ .review-container       复习答题区

&#x20;   ├─ #review-question    题目（单词/释义）

&#x20;   ├─ #review-answer      输入框

&#x20;   ├─ #review-feedback    反馈区

&#x20;   └─ 操作按钮（显示答案、下一题、发音等）
```

#### 复习来源



| 来源              | 数据来源                         | 说明               |
| --------------- | ---------------------------- | ---------------- |
| `comprehensive` | `learningHistory` + 错题本 + 收藏 | 综合所有需要复习的单词      |
| `ebbinghaus`    | `learningHistory` 中到期词       | 只取艾宾浩斯复习周期已到期的单词 |
| `errorbook`     | `appState.errorbook`         | 错题本中的单词          |
| `recent`        | `learningHistory` 最近 N 条     | 近期练习过的单词         |

#### 艾宾浩斯到期词

**加入条件**：单词在学习历史 `learningHistory` 中存在，且其 `nextReviewTime <= Date.now()`（当前时间）。



```
function getDueWords(): LearningHistoryItem\[] {

&#x20;   const history = getLearningHistory();

&#x20;   const now = Date.now();

&#x20;   return Object.values(history).filter(item => item.nextReviewTime && item.nextReviewTime <= now);

}
```

**复习间隔**：每个单词首次答对后按 1 天、2 天、4 天、7 天、15 天、30 天、60 天、90 天递进设置下次复习时间。答错则重置为 1 天。

#### 学习历史按天分组

`learningHistory` 以单词为键记录每次练习结果。复习页面将历史按天聚合展示：



```
function formatDayKey(timestamp: number): string {

&#x20;   return new Date(timestamp).toISOString().slice(0, 10); // YYYY-MM-DD

}

function formatDayLabel(dayKey: string): string {

&#x20;   const today = new Date().toISOString().slice(0, 10);

&#x20;   const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

&#x20;   if (dayKey === today) return '今天';

&#x20;   if (dayKey === yesterday) return '昨天';

&#x20;   return dayKey;

}
```

分组规则：



* 今天：按 `newestTimestamp` 落在今日的历史条目

* 昨天：按 `newestTimestamp` 落在昨日的历史条目

* 更早：按 `YYYY-MM-DD` 显示日期

* 点击日期行可展开 / 折叠当天练习的单词列表

#### 答题与判题

复习模式答题逻辑与测验模式共享同一套判题标准：



* **英译中模式**：用户输入中文释义，系统按分号 / 逗号拆分后逐个匹配

* **中译英模式**：用户输入英文单词，忽略大小写和标点

* **显示答案**：点击后展示正确答案，再次按 Enter 进入下一题

* **错题自动发音**：每道题答错时累加 `reviewCurrentErrorCount`，当该计数达到设置项 `autoPlayPronunciationAfterErrors` 阈值时自动播放发音；使用当前题目错误计数而非累计错题本计数，避免历史错题导致阈值失效

#### 键盘快捷键

复习模式复用测验模式的快捷键配置：



| 按键                             | 功能                   |
| ------------------------------ | -------------------- |
| Enter                          | 提交答案 / 显示答案后进入下一题    |
| `answerKey`（默认 `1`）            | 显示答案                 |
| `playPronunciationKey`（默认 `2`） | 播放发音                 |
| 数字键                            | 在显示答案后选择对应释义（如果有多选项） |

快捷键在输入框聚焦时同样生效，通过 `keydown` 事件拦截实现。

#### 与测验模式的差异



| 维度   | 测验模式                 | 复习模式             |
| ---- | -------------------- | ---------------- |
| 目标   | 学习新词 / 检验掌握          | 巩固已学词            |
| 单词来源 | 单词本 / 系统词书 / 收藏 / 错题 | 学习历史 / 错题 / 近期练习 |
| 艾宾浩斯 | 排序权重                 | 独立来源 + 到期词面板     |
| 历史记录 | 仅按单词记录               | 额外按天分组展示         |
| 错题处理 | 答对 3 次移出             | 答错重置复习间隔         |

### 3.8 学习统计模块（stats.ts）

统计项：



* `totalWords`：收藏数 + 所有单词本单词数之和

* `searchCount`：搜索总次数

* `studyDays`：学习天数

* `todayWords`：今日学习单词数

* `errorWords`：错题本中的单词数

* `tomorrowWords`：明日学习单词数（= `settings.dailyWordCount`）

**每日重置逻辑**：



```
const today = new Date().toDateString();

if (appState.studyStats.lastStudyDate !== today) {

&#x20;   appState.studyStats.todayWords = 0;

&#x20;   appState.studyStats.studyDays++;

&#x20;   appState.studyStats.lastStudyDate = today;

}
```



### 3.9 模拟题模块（exam.ts）

**视图状态** `view`：`home / reading-list / listening-list / reading / listening`。

**数据来源**（静态 `public/exams`）：阅读 `reading/cet4.json`（199 篇）、`reading/cet6.json`（200 篇，文章明显更长）；听力 `listening/index.json` + `tests/Test_001..100.json`，音频走后端 `/api/exam/listening-audio/:id`（流式，支持 Range）。

**阅读三阶段**（`readingStage: 1|2|3`）：

* 阶段 1 · 注释阅读：括号注释全部显示（`.ex-inline-note`）、靶词高亮、任意单词可点查词；底部「确认选这篇，开始答题」（`reading-start-quiz`，用户可先通读文章也可直接答题），此阶段不显示题目。
* 阶段 2 · 作答：靶词注释隐藏（`noteVisible` 在阶段 2 返回 `!isTarget`），超纲词注释保留以帮助理解；显示题目与交卷条。
* 阶段 3 · 无注释回看（交卷后自动进入）：全部注释隐藏，题目着对错色（`.ex-opt-correct/.ex-opt-wrong`、`.ex-mark-ok/.ex-mark-no`）。

**靶词集合** `targetWords`：进入做题页即 `ensureKeywords()` 预加载，请求 `/api/exam/keywords?type=reading&level&n`（听力为 `type=listening&id`），返回与四级词书匹配的核心词 `{w,ph,mean,count}`；状态机 `idle/loading/done/error`，加载完成后对未交卷阅读补一次 `renderReading()`。

**交卷后附加区** `#ex-extra`（位于结果条内，`renderExtra`）：可切换显示答案与解析、中文翻译（阅读）/ 听力原文，以及四级核心词网格（`.ex-kw`，点击查词）。

**听力播放控制**：倍速为 `.ex-rate-select`，9 档 `PLAYBACK_RATES = 0.7~1.5`（每 0.1 一档），答题前后均可用；未交卷时 `audioAllowedTime` 配合 `seeking/seeked` 锁定进度（只允许顺序播放，拖动 / 回退被弹回已播放最大位置），交卷后可自由拖动、回退、重复听。音频缺失显示 `.ex-audio-missing`，题目与原文仍可练习。

**完成标记** `examCompleted`：交卷后列表序号圆圈加 `.ex-list-done` 标绿；结构为 `Record<key, boolean | { done: true; answers }>`，`markCompleted(key, answers)` 在交卷时一并保存答案（旧 boolean 记录兼容，重做交卷会更新答案）。

**列表左右键**：`.ex-list-item` 左键（click）= 重新做题（`resetAnswers` 从阶段 1 开始）；右键（`contextmenu`，preventDefault）= 查看上次答题情况（`openReading/openListening(pos, true)`，`getSavedAnswers` 恢复答案、`submitted=true`、阶段 3，直接展示上次对错与附加区），无上次记录时回退为新做。列表页 `.ex-list-hint` 提示该操作。

**模拟模式**（首页 `.ex-sim` 设置，localStorage `examSimMode` / `examSimDurationMin`，默认关 / 10 分钟，按一篇阅读约 10 分钟设定）：

* 阅读：点「开始答题」进入阶段 2 后 `startSimTimer` 倒计时，`.ex-sim-bar #sim-countdown` 显示剩余（最后 60 秒 `.sim-urgent` 红色闪烁），到点 `submit(true)` 强制交卷（未答完也交、未答判错）；阶段 1 看文章不计时。
* 听力：模拟模式下音频 `ended` 立即 `submit(true)` 自动交卷。
* `resetAnswers` / 交卷会 `stopSimTimer`，切换篇目不残留倒计时。

**悬浮查词**：`.ex-word` hover 高光，`.ex-word-tip` 随鼠标移动提示，点击 `searchWord` 跳转词典。

### 3.10 首次学习类别选择（gradeModal.ts）

* localStorage `gradeChosen` 为标记；未选择时启动约 700ms 后弹出 `#grade-modal`。
* 弹窗标题「选择你的学习类别」，11 个选项与侧边栏 `#exam-category` 完全一致：小学 `xx` / 中考 `zk` / 高考 `gk` / 四级 `cet4` / 六级 `cet6` / 专四 `tem4` / 专八 `tem8` / 考研 `ky` / 托福 `toefl` / 雅思 `ielts` / GRE `gre`（`.grade-options-grid` 三列、≤480px 两列）。
* 选择后：直接设置侧边栏 `#exam-category` 的值并触发 `change`（联动词库 / 难度、写 localStorage `exam-category`），写 `gradeChosen`；同时按 `CATEGORY_GRADE` 映射同步粗粒度 `settings.grade`（`xx→primary / zk→junior / gk→senior / 其余→college`，store 自动持久化）。
* 「跳过，默认使用小学」即 `xx`；设置页「学习类别」`#grade-level`（同样 11 类）初始化与保存均与侧边栏双向同步，可随时修改。

### 3.11 复习调度：艾宾浩斯与 ts-fsrs（scheduler.ts）

* `settings.scheduler`：`ebbinghaus`（默认）或 `fsrs`。
* 艾宾浩斯：间隔 `[1,2,4,7,15,30,60,90]` 天，按 `correctCount` 取索引（封顶），答错清零。
* ts-fsrs（v5.4.2，纯本地）：在 `recordLearningHistory` 内按调度分支。评分映射——答错 / 主动看答案 = `Again`；本轮 `errorCount>0` 后才答对 = `Hard`；一次答对且旧卡 `reps>=3`（成熟卡）= `Easy`；其余一次答对 = `Good`。
* `computeFsrs(card, grade, now)` 返回 `{card, nextReviewTime, stability, difficulty, state, scheduledDays}`；卡片序列化后存入 `learningHistory[word].card`（`due/last_review` 转毫秒）。FSRS 模式把 `nextReviewTime` 写为卡片 due，`review.ts` 到期判定（`nextReviewTime <= now`）与错题本 / 权重逻辑零改动。
* 另提供 `getCardRetrievability`、`curveRetention`（基于默认参数 `forgetting_curve`）。切换算法不丢失历史。

### 3.12 激励系统（gamification.ts）

* 独立 localStorage：`dailyLog`（`Record<dayKey, {words,seconds,goalMet}>`）、`streakData`（`current/best/freezes/lastActive/milestones`）；`dayKey` 按电脑本地日期 `YYYY-MM-DD`。
* `recordWordLearned(count)` 更新连胜：`lastActive` 为今天则不变；为昨天则 `current++`；间隔 2 天且 `freezes>0` 自动消耗 1 张保护卡保连；否则断签 `current=1`；`best` 取最大。返回 `GamEvent`（`streakAdvanced/streakFrozen/streakReset/goalJustMet/milestone/freezeReward`）。
* 里程碑 `MILESTONES = [3,7,30,100,365]`，达成奖励保护卡 `FREEZE_REWARD = {7:1,30:2,100:3,365:5}`。
* `addStudySeconds / flushDailyLog`：计时器每秒 `addStudySeconds(1)`、每 10 秒 flush，停止时也 flush。
* `fireCelebration`：零依赖 DOM 彩带（`.gm-confetti`，约 3.6s 自移除），`prefers-reduced-motion` 时关闭。
* 测验页 `#quiz-streak-panel`（`updateStreakPanel`）：🔥 连胜天数 / 🧊 保护卡 / 今日 `x/目标` 进度条。

### 3.13 记忆数据看板（charts.ts）

* 零依赖手绘 SVG，挂在独立「统计」页 `#statistics-page` 的 `#memory-dashboard`（`initMemoryDashboard`，启动时即构建）。统计页顶部另有 `renderStatOverview()` 渲染 8 张数据概览卡（总学习单词数 / 查词总数 / 学习天数 / 今日学习单词 / 错题数 / 明日计划 / 今日时长 / 累计时长，数据取自 `studyStats`、时长经 `formatDuration`）。
* 四个图表：
  * **每日练习折线**：X 轴为日期、Y 轴为当日单词数（可切「学习时长」），每日一个数据点、点间直线连接，未学习日期补零落在基线。数据按月长期保留（`getDailyLogForMonth`），头部 `‹ ›` 切换月份（最早有数据月之前禁用）；绘图区可按住鼠标左右拖动（`enableDragPan`）或横向滚动查看月内日期，当前月默认定位到今天、历史月从月初。Y 轴刻度小整数逐值标注、大值按 `niceMax`（1/2/2.5/5×10ⁿ）分 4 段。鼠标悬浮任意数据点弹出跟随鼠标的提示框，显示完整日期与当日值（单词数「X 词」、时长用完整 `fmtDurationFull`，如「4分46秒」），点 hover 半径放大。
  * **到期词分布**：全宽柱状（720×260），X 轴按本地日期分桶（已逾期 / 今天 / 明天 / 2-3 天 / 4-7 天 / 7 天后，桶下标注具体日期区间），Y 轴小整数逐值标注、柱顶标数值；悬浮柱子提示「桶名（日期区间）：X 词」，柱 hover 变蓝。
  * **答题留存率环**（`.mc-ring`）：按 correct/(correct+error) 显示。
  * **遗忘曲线（可滚动）**：X 轴 0~90 天（每天固定 18px、约 1660px 宽，超出视口可按住拖动 / 横向滚动），Y 轴回忆概率 0~100%；曲线与面积用程序实际遗忘公式 `curveRetention(t, S=3)`（FSRS forgetting-curve）；竖虚线标出艾宾浩斯固定调度的复习节点 1/2/4/7/15/30/60/90 天，橙色横虚线为目标记忆率 `FSRS_TARGET_RETENTION`（默认 90%）。
* 看板 `.md-row` 网格项设 `min-width:0` 防止固定宽 SVG 撑破列宽；`.md-row-rr`（留存环 + 曲线）在 ≤760px 折叠为单列。
* `refreshMemoryDashboard` 与 `renderStatOverview` 在进入统计页（`onPageEnter` 的 `statistics` 分支）时刷新，保证数据最新；复习页不再挂载看板。
* 悬浮提示用单例 `#mc-tip`（`ensureChartTip`，挂 body、`position:fixed`、pointer-events:none），`bindChartTooltip` 在看板根上对 `.mc-pt / .mc-due-bar` 做 mouseover / mousemove / mouseout 事件委托（图表 innerHTML 重建后仍有效），内容读元素 `data-tip`，气泡跟随鼠标并在靠右 / 靠上时自动翻转避让；替代了原先延迟较长、样式固定的 SVG 原生 `<title>`。

***

## 4. 前端 CSS 样式系统

### 4.1 主题变量（theme.css）

**浅色模式变量**：



```
:root {

&#x20;   --primary-blue: #3498db;

&#x20;   --primary-blue-dark: #2980b9;

&#x20;   --primary-blue-light: #5dade2;

&#x20;   --secondary-blue: #2c3e50;

&#x20;   --accent-green: #27ae60;

&#x20;   --accent-orange: #f39c12;

&#x20;   --accent-red: #e74c3c;

&#x20;   --bg-light: #f8f9fa;

&#x20;   --bg-white: #ffffff;

&#x20;   --text-dark: #2c3e50;

&#x20;   --text-gray: #7f8c8d;

&#x20;   --border-color: #e0e0e0;

&#x20;   --shadow-sm: 0 2px 8px rgba(0,0,0,0.08);

&#x20;   --shadow-md: 0 4px 16px rgba(0,0,0,0.12);

&#x20;   --shadow-lg: 0 8px 24px rgba(0,0,0,0.15);

&#x20;   --radius-sm: 6px;

&#x20;   --radius-md: 8px;

&#x20;   --radius-lg: 12px;

&#x20;   --radius-modal: 16px;   /* 所有弹窗统一圆角 */

&#x20;   --transition-fast: 0.2s ease;

&#x20;   --transition-normal: 0.3s ease;

}
```

**深色模式变量覆盖**：



```
html.dark-mode, body.dark-mode {

&#x20;   --primary-blue: #5dade2;

&#x20;   --primary-blue-dark: #3498db;

&#x20;   --accent-green: #58d68d;

&#x20;   --accent-orange: #f5b041;

&#x20;   --accent-red: #ec7063;

&#x20;   --bg-light: #1e1e1e;

&#x20;   --bg-white: #2d2d2d;

&#x20;   --text-dark: #e0e0e0;

&#x20;   --text-gray: #a0a0a0;

&#x20;   --border-color: #444444;

&#x20;   --shadow-sm: 0 2px 8px rgba(0,0,0,0.3);

}
```

### 4.2 主题切换动画

**双层背景系统**：



* `#bg-under`：z-index: -2，常驻当前主题色

* `#bg-over`：z-index: -1，通过 clip-path 圆形展开新主题色



```
\#bg-over {

&#x20;   position: fixed;

&#x20;   clip-path: circle(0 at var(--x) var(--y));

&#x20;   transition: clip-path 0.9s cubic-bezier(0.4, 0, 0.2, 1);

}
```

**三层波纹扩散**：



* `.theme-ripple#ripple-layer-1`：最大半径（200vmax），0.9s

* `.theme-ripple#ripple-layer-2`：中等半径（150vmax），1.1s，0.08s 延迟

* `.theme-ripple#ripple-layer-3`：较小半径（120vmax），0.7s，0.15s 延迟



```
@keyframes ripple-expand-1 {

&#x20;   0%   { clip-path: circle(0 at var(--x, 50px) var(--y, 50px)); opacity: 0.55; }

&#x20;   60%  { opacity: 0.25; }

&#x20;   100% { clip-path: circle(200vmax at var(--x, 50px) var(--y, 50px)); opacity: 0; }

}
```

**内容页面联动**：



```
@keyframes theme-content-shift {

&#x20;   0%   { transform: scale(1); filter: brightness(1); opacity: 1; }

&#x20;   40%  { transform: scale(0.985); filter: brightness(1.06); opacity: 0.92; }

&#x20;   100% { transform: scale(1); filter: brightness(1); opacity: 1; }

}
```

### 4.3 毛玻璃效果（glass.css）



```
.glass {

&#x20;   background: rgba(255, 255, 255, 0.85);

&#x20;   backdrop-filter: blur(16px) saturate(180%);

&#x20;   -webkit-backdrop-filter: blur(16px) saturate(180%);

&#x20;   border: 1px solid rgba(255, 255, 255, 0.12);

&#x20;   border-radius: 14px;

&#x20;   box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 0.5px rgba(255, 255, 255, 0.2);

}

html.dark-mode .glass, body.dark-mode .glass {

&#x20;   background: rgba(20, 20, 20, 0.85);

&#x20;   backdrop-filter: blur(18px) saturate(150%);

&#x20;   border: 1px solid rgba(255, 255, 255, 0.08);

&#x20;   box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);

}
```

**滚动降级**：当容器滚动时，移除 backdrop-filter 改为半透明纯色：



```
.glass-scroll:not(.navbar) {

&#x20;   background: rgba(32, 32, 32, 0.5) !important;

&#x20;   border: 1px solid rgba(255, 255, 255, 0.1);

&#x20;   backdrop-filter: none;

&#x20;   -webkit-backdrop-filter: none;

}
```

**毛玻璃滚动降级逻辑**（main.ts）：



```
function initGlassScrollDegradation(): void {

&#x20;   let isScrolling = false;

&#x20;   let scrollTimer: ReturnType\<typeof setTimeout> | null = null;

&#x20;   function getActiveGlass(): NodeListOf\<Element> {

&#x20;       const activePage = document.querySelector('.content-page.active');

&#x20;       return activePage ? activePage.querySelectorAll('.glass') : document.querySelectorAll('.glass');

&#x20;   }

&#x20;   window.addEventListener('scroll', () => {

&#x20;       if (!isScrolling) {

&#x20;           getActiveGlass().forEach(el => el.classList.add('glass-scroll'));

&#x20;           isScrolling = true;

&#x20;       }

&#x20;       if (scrollTimer) clearTimeout(scrollTimer);

&#x20;       scrollTimer = setTimeout(() => {

&#x20;           getActiveGlass().forEach(el => el.classList.remove('glass-scroll'));

&#x20;           isScrolling = false;

&#x20;       }, 150);

&#x20;   }, { passive: true });

}
```

**弹窗统一圆角**：所有弹窗内容容器（静态的 7 个 `.modal-content` 弹窗、`book-picker` 选书弹窗、popupSelect 选择器，以及 global.ts 的 confirm/alert/prompt、dictionary.ts 的句子单词本弹窗）统一使用 `border-radius: var(--radius-modal)`（16px）。基础规则定义在 base.css 的 `.modal-content`（同时 `overflow: hidden` 裁剪内部 header / 滚动区，防止背景顶破圆角；内容超高的说明类弹窗内联 `overflow-y: auto` 仍可滚动），bookpicker.css 等局部样式只引用同一变量，不再各写圆角值。

### 4.4 拖拽排序样式（settings.css）



```
.setting-item {

&#x20;   transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);

&#x20;   will-change: transform;

}

.setting-item.is-dragging {

&#x20;   opacity: 0.25;

}

.drag-ghost {

&#x20;   position: fixed;

&#x20;   z-index: 9999;

&#x20;   pointer-events: none;

&#x20;   transform-origin: center center;

&#x20;   box-shadow: 0 8px 32px rgba(52, 152, 219, 0.3);

&#x20;   border: 2px solid var(--primary-blue);

}
```

### 4.5 单词本卡片翻转



```
.flip-card {

&#x20;   perspective: 1000px;

}

.flip-card-inner {

&#x20;   transition: transform 0.6s;

&#x20;   transform-style: preserve-3d;

}

.flip-card.flipped .flip-card-inner {

&#x20;   transform: rotateY(180deg);

}

.flip-card-front, .flip-card-back {

&#x20;   backface-visibility: hidden;

}

.flip-card-back {

&#x20;   transform: rotateY(180deg);

&#x20;   position: absolute;

&#x20;   top: 0; left: 0; right: 0; bottom: 0;

}

/\* 卡片背面释义区域与例句区域比例 \*/

.flip-card-back {

&#x20;   display: flex;

&#x20;   padding: 10px 15px;

}

.flip-card-back .definition-area {

&#x20;   flex: 0 0 auto;

&#x20;   min-width: 35%;

&#x20;   max-width: 45%;

}

.flip-card-back .example-area {

&#x20;   flex: 1;

}

/\* 卡片背面隐藏音标 \*/

.flip-card-back .def-phonetic {

&#x20;   display: none !important;

}
```

**卡片翻转约束**：



* 仅在 transform 属性上过渡，禁止 height 过渡以防布局抖动

* 卡片高度由正面内容决定（正常流），背面使用绝对定位

* 翻转动画仅 0.6s 完成

### 4.6 抽屉展开 / 收起

单词本列表中的抽屉展开使用 max-height 过渡：



```
.word-expanded-content {

&#x20;   transition: max-height 0.4s ease, opacity 0.4s ease, padding 0.4s ease;

}

/\* 折叠状态 \*/

.collapsed {

&#x20;   max-height: 0;

&#x20;   opacity: 0;

&#x20;   padding: 0;

}

/\* 展开状态 \*/

.expanded {

&#x20;   max-height: 3000px;

&#x20;   opacity: 1;

&#x20;   padding: 15px;

}
```

**高度测量机制**：



* 首次展开使用估算高度 `collapsedHeight * 3`

* DOM 渲染后（100ms 延迟）通过 `offsetHeight + 50` 精确测量

* 测量结果缓存，避免重复计算

### 4.7 响应式（responsive.css）

针对移动端（max-width: 768px）：



* 侧边栏收起为顶部统计条

* 导航栏变为汉堡菜单

* 内容页面宽度自适应

* 搜索框和按钮垂直排列

* 卡片布局从 grid 变为单列

### 4.8 自定义滚动条样式（base.css）

#### 全局滚动条样式

**浅色主题**：



```
::-webkit-scrollbar {

&#x20;   width: 8px;

&#x20;   height: 8px;

}

::-webkit-scrollbar-track {

&#x20;   background: transparent;

&#x20;   border-radius: 4px;

}

::-webkit-scrollbar-thumb {

&#x20;   background: rgba(52, 152, 219, 0.45);

&#x20;   border-radius: 4px;

&#x20;   border: 1px solid rgba(52, 152, 219, 0.15);

&#x20;   transition: background 0.25s ease, border-color 0.25s ease;

}

::-webkit-scrollbar-thumb:hover {

&#x20;   background: rgba(52, 152, 219, 0.75);

&#x20;   border-color: rgba(52, 152, 219, 0.3);

}

/\* 隐藏滚动条按钮和角落 \*/

::-webkit-scrollbar-button { display: none; }

::-webkit-scrollbar-corner { background: transparent; }

/\* Firefox 支持 \*/

\* {

&#x20;   scrollbar-width: thin;

&#x20;   scrollbar-color: rgba(52, 152, 219, 0.45) transparent;

}
```

**深色主题**：



```
html.dark-mode ::-webkit-scrollbar-thumb,

body.dark-mode ::-webkit-scrollbar-thumb {

&#x20;   background: rgba(255, 255, 255, 0.25);

&#x20;   border: 1px solid rgba(255, 255, 255, 0.08);

}

html.dark-mode ::-webkit-scrollbar-thumb:hover,

body.dark-mode ::-webkit-scrollbar-thumb:hover {

&#x20;   background: rgba(255, 255, 255, 0.45);

&#x20;   border-color: rgba(255, 255, 255, 0.15);

}

html.dark-mode \*, body.dark-mode \* {

&#x20;   scrollbar-color: rgba(255, 255, 255, 0.25) transparent;

}
```

#### 局部滚动条覆盖



| 容器                   | 宽度  | 浅色主题                  | hover                  | 深色主题                        |
| -------------------- | --- | --------------------- | ---------------------- | --------------------------- |
| 侧边栏                  | 5px | rgba(255,255,255,0.2) | rgba(255,255,255,0.4)  | rgba(255,255,255,0.15/0.35) |
| 虚拟列表（单词本 / 收藏 / 错题本） | 6px | rgba(52,152,219,0.35) | rgba(52,152,219,0.65)  | rgba(255,255,255,0.2/0.4)   |
| 弹窗                   | 5px | rgba(128,128,128,0.3) | rgba(128,128,128,0.55) | rgba(255,255,255,0.2/0.4)   |

**局部样式实现**：



```
/\* 虚拟列表容器 \*/

.wordbook-vue-scroll::-webkit-scrollbar,

.favorites-vue-scroll::-webkit-scrollbar,

.errorbook-vue-scroll::-webkit-scrollbar {

&#x20;   width: 6px;

}

/\* 弹窗 \*/

.modal-content::-webkit-scrollbar,

.modal-body::-webkit-scrollbar {

&#x20;   width: 5px;

}

/\* 深色主题局部覆盖 \*/

html.dark-mode .wordbook-vue-scroll::-webkit-scrollbar-thumb {

&#x20;   background: rgba(255, 255, 255, 0.2);

}

html.dark-mode .wordbook-vue-scroll::-webkit-scrollbar-thumb:hover {

&#x20;   background: rgba(255, 255, 255, 0.4);

}
```

**设计原则**：



* 全局滚动条宽度统一 8px，hover 时滑块变亮（透明度从 0.45 → 0.75）

* 局部容器采用更细滚动条（5-6px），减少视觉干扰

* 侧边栏滚动条最细（5px），使用白色半透明与深色背景融合

* 虚拟列表保持品牌蓝色（52,152,219），hover 时变亮

* 弹窗使用灰色系，不与内容抢焦点



***

## 5. 后端 TypeScript/Electron 架构

### 5.1 Electron 主进程（electron/main.ts）

#### 应用启动流程



```
app.whenReady().then(async () => {

&#x20; // 1. 确保发音/缓存目录存在

&#x20; \[PRONUNCIATIONS\_DIR, CACHE\_DIR].forEach(dir => {

&#x20;   if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

&#x20; });

&#x20; // 2. 初始化数据库（主词典 + 增强数据库后台加载）

&#x20; initDatabases();

&#x20; // 3. 初始化 TTS

&#x20; initTTS(PRONUNCIATIONS\_DIR, CACHE\_DIR);

&#x20; // 4. 创建 Express 应用并注册路由

&#x20; const expressApp = express();

&#x20; setupRoutes(expressApp);

&#x20; // 5. 静态文件服务（Vite 构建输出目录 dist/）

&#x20; expressApp.use(express.static(STATIC\_DIR));

&#x20; // 6. 创建浏览器窗口

&#x20; const win = new BrowserWindow({

&#x20;   width: 1200, height: 800,

&#x20;   minWidth: 800, minHeight: 600,

&#x20;   autoHideMenuBar: true,

&#x20;   webPreferences: {

&#x20;     nodeIntegration: false,

&#x20;     contextIsolation: true,

&#x20;     preload: path.join(\_\_dirname, 'preload.js')

&#x20;   }

&#x20; });

&#x20; // 7. 动态端口启动 Express

&#x20; const PORT = await findAvailablePort(5000);

&#x20; const server = expressApp.listen(PORT, '127.0.0.1', () => {

&#x20;   win.loadURL(\`http://127.0.0.1:\${PORT}\`);

&#x20; });

&#x20; // 8. 媒体权限处理（麦克风）

&#x20; session.defaultSession.setPermissionRequestHandler((\_webContents, permission, callback) => {

&#x20;   callback(permission === 'media');

&#x20; });

&#x20; // 9. 内存监控：渲染进程内存超过阈值时通知前端释放后台页面

&#x20; const MEMORY\_THRESHOLD\_MB = 1024;

&#x20; setInterval(() => {

&#x20;   try {

&#x20;     const metrics = app.getAppMetrics();

&#x20;     const rendererPid = win.webContents.getOSProcessId();

&#x20;     const metric = metrics.find((m: any) => m.pid === rendererPid);

&#x20;     const workingSetMB = Math.round((metric?.memory?.workingSetSize ?? 0) / 1024);

&#x20;     if (workingSetMB > MEMORY\_THRESHOLD\_MB) {

&#x20;       win.webContents.send('release-pages', { half: true });

&#x20;     }

&#x20;   } catch (err) {

&#x20;     console.error('内存监控失败:', err);

&#x20;   }

&#x20; }, 10000);

&#x20; ipcMain.on('memory-released', (\_event, count: number) => {

&#x20;   console.log(\`已释放 \${count} 个后台页面\`);

&#x20; });

&#x20; // 10. 窗口关闭时退出应用

&#x20; app.on('window-all-closed', () => {

&#x20;   server.close();

&#x20;   app.quit();

&#x20; });

});
```

#### 关键路径常量

路径系统在 `electron/utils/helpers.ts` 中统一管理：



```
ROOT\_DIR           // 项目根目录（开发环境）

APP\_ROOT\_DIR       // 应用根目录（打包后为 resources/app）

USER\_DATA\_DIR      // 用户数据目录（app.getPath('userData')）

CACHE\_DIR          // 缓存目录（USER\_DATA\_DIR/cache）

ASSETS\_DIR         // 可下载资源目录（USER\_DATA\_DIR/assets）

PRONUNCIATIONS\_DIR // 发音文件目录（优先 USER\_DATA\_DIR，回退 APP\_ROOT\_DIR）
```

`resolveAssetPath(filename)` 优先从用户目录查找，回退到安装目录，确保用户下载的资源优先级最高且应用升级不丢失。

**注意**：运行时 Electron 从 `electron-dist/main.js` 启动，因此 `__dirname` 为 `electron-dist/`。打包前通过 `npm run build` 生成 `dist/`，`scripts/copy-static.cjs` 会将其复制到 `static/` 供 `electron-builder` 打包。

#### 窗口与权限



* `nodeIntegration: false` + `contextIsolation: true`：渲染进程不直接暴露 Node.js API，安全通信通过 `preload.js` 进行。

* `setPermissionRequestHandler`：仅允许 `media` 权限（麦克风），用于 Sherpa-ONNX 语音输入。

* 窗口关闭时调用 `server.close()` 并退出应用，避免 Express 进程残留。

#### 内存监控与后台页面释放

主进程负责兜底渲染进程内存，防止 keep-alive 页面无限累积：



* 每 10 秒通过 `app.getAppMetrics()` 读取渲染进程工作集内存。

* 阈值 `MEMORY_THRESHOLD_MB = 1024`，超过后发送 `release-pages` 事件。

* 前端 `global.ts` 收到事件后调用 `releaseRenderedPages({ half: true })`，释放一半最久未访问的后台页面。

* 释放完成后前端回传 `memory-released` IPC，主进程打印日志。

该机制与前端 `MAX_RENDERED_PAGES = 3` 共同控制 DOM 规模，避免连续切换页面时卡顿。

#### 崩溃收集与日志

* `crashReporter.start({ uploadToServer: false })`：原生崩溃由 Crashpad 本地收集（dump 写入 userData/Crashpad），不上传任何第三方服务器。

* `electron/services/logger.ts`：写 `userData/logs/app.log`，单文件 2MB 滚动为 `app.old.log`；`initProcessLogging(source)` 注册进程级 `uncaughtException` / `unhandledRejection`。

* 主进程与 fork 的 Express 子进程分别调用 `initProcessLogging('main' / 'server')`；渲染进程通过 preload 暴露的 `reportError` 经 IPC `renderer-error` 上报，前端 `utils/errorReport.ts` 捕获 `window.onerror` 与 `unhandledrejection`。

* Express 自身的 console 输出仍写入 `server.log`，与记录致命异常的 `app.log` 互补。

### 5.2 Express 路由（electron/api/routes.ts）

`setupRoutes(app)` 注册所有后端 API，全局启用 CORS 与 `express.json({ limit: '50mb' })` 大体积请求支持。

#### 路由总览



| 序号 | 方法   | 路径                                    | 说明                      |
| -- | ---- | ------------------------------------- | ----------------------- |
| 1  | GET  | `/`                                   | 返回 `static/index.html`  |
| 2  | -    | `/*`                                  | 静态文件服务（`static/`）       |
| 3  | GET  | `/api/search`                         | 精确查词，合并词典与增强信息          |
| 4  | GET  | `/api/match`                          | 前缀模糊匹配，支持考试类别加权排序       |
| 5  | GET  | `/api/search-chinese`                 | 中文反向搜索英文单词              |
| 6  | GET  | `/api/examples`                       | 查询带中文翻译的例句（上限 50 条）     |
| 7  | POST | `/api/words/batch`                    | 批量查询单词详情与增强信息           |
| 8  | GET  | `/api/enhanced`                       | 查询词干、词形、词根、形近词等增强信息     |
| 9  | GET  | `/api/audio/:accent/*`                | 获取发音 MP3，缺失时即时调用 TTS 生成 |
| 10 | GET  | `/api/audio/cache/:accent/*`          | 读取缓存 / 永久目录或在线生成发音      |
| 11 | POST | `/api/audio/generate`                 | 在线生成 TTS 音频             |
| 12 | POST | `/api/speech/recognize`               | Sherpa-ONNX 离线语音识别      |
| 13 | POST | `/api/translate`                      | 翻译（优先查词典，再调翻译服务）        |
| 14 | GET  | `/api/network/test`                   | 网络状态测试                  |
| 15 | GET  | `/api/assets/status`                  | 查询所有可下载资源的状态            |
| 16 | POST | `/api/assets/download`                | 开始下载指定资源（SSE 流式进度）      |
| 17 | POST | `/api/assets/pause`                   | 暂停资源下载                  |
| 18 | POST | `/api/assets/cancel`                  | 取消资源下载                  |
| 19 | POST | `/api/assets/delete`                  | 删除已安装的资源                |
| 20 | GET  | `/api/pronunciations/download/status` | 发音批量下载状态                |
| 21 | POST | `/api/pronunciations/download/start`  | 开始批量下载发音                |
| 22 | POST | `/api/pronunciations/download/pause`  | 暂停发音批量下载                |
| 23 | POST | `/api/pronunciations/download/resume` | 恢复发音批量下载                |
| 24 | POST | `/api/pronunciations/download/cancel` | 取消发音批量下载                |
| 25 | POST | `/api/pronunciations/clear`           | 清空所有发音缓存                |
| 26 | GET  | `/api/wordbook/list`                  | 获取自定义单词本列表              |
| 27 | POST | `/api/wordbook/create`                | 创建单词本                   |
| 28 | POST | `/api/wordbook/delete`                | 删除单词本                   |
| 29 | POST | `/api/wordbook/add`                   | 添加单词（按词干去重）             |
| 30 | POST | `/api/wordbook/remove`                | 移除单词                    |
| 31 | POST | `/api/wordbook/rename`                | 重命名单词本                  |
| 32 | POST | `/api/wordbook/reorder`               | 拖拽排序后持久化顺序              |
| 33 | POST | `/api/wordbook/export`                | 导出 TXT/DOCX（同步）         |
| 34 | POST | `/api/wordbook/export-stream`         | SSE 流式导出，带真实进度          |
| 35 | POST | `/api/wordbook/export-docx`           | 简化 DOCX 导出              |
| 36 | POST | `/api/wordbook/import`                | 导入 TXT/DOCX，按词干去重       |
| 37 | GET  | `/api/system-wordbooks`               | 系统单词本列表及数量              |
| 38 | GET  | `/api/system-wordbook/words`          | 系统单词本分页单词               |
| 39 | GET  | `/api/system-wordbook/search`         | 系统单词本内搜索                |
| 40 | POST | `/api/cache/clear`                    | 清除翻译缓存与音频缓存             |

#### 关键实现细节



* **词典增强信息**：`/api/search` 先查主词典 `stardict.db` 获取基础释义，再调用 `getWordEnhancedInfo(word)` 聚合词干、词形、词根、形近词等增强信息一并返回。

* **考试类别排序**：`/api/match` 接收 `category` 参数，返回结果按 “用户考试类型> 其他考试标签 > 柯林斯星级 > 词频” 排序。

* **发音文件路由**：`/api/audio/:accent/*` 会先从 `pronunciations/` 目录查找，缺失时调用 `TencentTTS.getPronunciation` 即时生成，避免前端 404 后二次请求。

* **翻译兜底**：`/api/translate` 优先查词典；词典无结果时调用 `translateText`；所有在线翻译失败时，使用主词典逐词翻译作为最终兜底。

* **导入去重**：导入时通过 `LemmaDB.getLemma` 按词干去重，词组（含空格）按原词字符串去重。

* **SSE 导出**：`/api/wordbook/export-stream` 以 `text/event-stream` 返回 `start` / `progress` / `done` / `error` 事件，前端根据 `done` 事件中的 base64 文件数据触发下载。

* **中文反向搜索**：`/api/search-chinese` 支持通过中文释义模糊搜索对应的英文单词，使用 LIKE 匹配 translation 字段。

* **资源下载 SSE**：`/api/assets/download` 使用 SSE 流式推送下载进度，包含分卷进度、下载速度、剩余时间等信息。

* **发音批量下载**：`/api/pronunciations/download/*` 系列接口管理离线发音包的全量下载，支持暂停 / 恢复 / 取消，与 TTS 缓存目录共享。

### 5.3 服务层（electron/services/）

#### database.ts

核心数据库封装，包含：



* `StarDict`**&#x20;类**：封装 `better-sqlite3`，提供 `query(key)`、`match(prefix, limit)`、`matchWithSort(prefix, limit, category)`、`queryBatch(keys)`、`count()`、`searchChinese(keyword, limit)`。

* **内存 LRUCache**：用于例句查询结果缓存，容量 500。

* `findExamplesForWord(word)`：使用 JOIN 查询 `examples.db`，只返回带中文翻译的例句，上限 50 条。

* **中文反向搜索**：`searchChinese(keyword, limit)` 通过 LIKE 匹配 translation 字段，实现中文释义查英文单词。

* **增强数据库**：


  * `LemmaDB`：读取 `lemma.en.txt`，提供 `getLemma`、`findRelatedForms`。

  * `WordRootDB`：读取 `wordroot.txt`，提供词根信息。

  * `ResembleDB`：读取 `resemble.txt`，提供形近词 / 同义词分组。

* `getWordEnhancedInfo(word)`：聚合词干、词形、词根、形近词信息，返回给 `/api/enhanced`。

* **初始化**：`initDatabases()` 同步加载主词典；增强数据库使用 `setImmediate` 后台加载，避免阻塞启动。

#### tts.ts

`TencentTTS` 类负责所有 TTS 生成与缓存：



* **文件路径**：


  * 单词永久缓存：`pronunciations/<normalizedWord>_<accent>.mp3`

  * 句子 / 词组缓存：`cache/audio/<normalizedPhrase>_<accent>.mp3`

* **单词降级链**：有道 TTS → 百度 TTS → Edge TTS（`edge-tts` CLI） → 腾讯云 TTS。

* **句子降级链**：Edge TTS → 腾讯云 TTS。

* **预处理**：`preprocessWordForTTS` 去掉编号、括号注释、学科标记等，提高 TTS 成功率。

* **缓存校验**：`checkTtsCache` 读取文件首字节，若首字节为 `{`（JSON 错误）则删除无效缓存。

#### translate.ts

独立翻译服务（tts.ts 仅负责发音，翻译功能全部由 translate.ts 提供）：



* 降级链：腾讯云翻译 → 有道网页翻译 → MyMemory 免费 API。

* 使用 `LRUCache<string>(500)` 缓存结果。

* 所有翻译失败返回空字符串，不缓存空结果以便下次重试。

#### nlp.ts

纯函数文本分类（不依赖第三方 NLP 库）：



* 0-1 个含字母 / 数字的有效 token → `word`

* 有效 token 超过 5 个，或含 `.!?;` 标点 → `sentence`

* 其他 → `phrase`

`normalizeCaseByType()` 据此规范化首字母大小写：句子首字母大写，单词 / 短语首字母小写。

#### semanticSimilarity.ts

基于 Transformers.js 的本地语义相似度判断服务，用于英译中测验模式的模糊判断：



* **模型**：使用 `shibing624/text2vec-base-chinese` 模型（ONNX q8 量化格式）

* **功能**：计算两段中文文本的语义相似度，判断用户输入的答案与正确答案是否语义相近

* **应用场景**：英译中模式下，用户输入 "宽广的" 而正确答案是 "宽敞的" 时，通过语义相似度判断为正确

* **模型加载**：通过 `resolveAssetPath('semantic-model-files')` 加载本地模型，支持安装包内置或用户下载

* **API 接口**：`POST /api/semantic-similarity`，接收 `text1`、`text2` 和可选的 `threshold`（默认 0.58）

* **性能优化**：


  * 模型懒加载，首次调用时初始化

  * 使用 ONNX Runtime 加速推理

  * q8 量化模型，体积约 358MB，平衡精度与性能

* **降级策略**：模型不可用时保持原有字符串匹配逻辑，不影响测验流程

#### sherpa\_asr.ts

Sherpa-ONNX (SenseVoice) 语音识别服务：



* `ensureAsrModel()`：延迟加载模型，检测路径是否含非 ASCII 字符，必要时复制到临时目录。

* `recognizeWithSherpa(audioData, sampleRate)`：接收 PCM Buffer，调用 Sherpa-ONNX 识别，返回带标点文本。

* `isSherpaModelReady()` / `closeSherpaModel()`：模型状态查询与资源释放。

* Windows 中文路径兼容：将模型复制到 `os.tmpdir()/sherpa-asr-model/` 后加载。

#### asset-manager.ts

可下载资源管理器（详见 15.5 节）：



* 管理 `stardict.db`、`examples.db`、语音识别模型等大型资源。

* Gitee Release 分卷 7z 下载，支持断点续传与 MD5/SHA256 校验。

* 提供下载 / 暂停 / 取消 / 删除 API，通过 SSE 推送进度。

* 启动时检查必需资源，缺失则自动下载。

#### pronunciation-downloader.ts

离线发音批量下载器（详见 15.6 节）：



* 遍历词典所有单词，按 TTS 降级链批量下载发音 MP3。

* 支持断点续传、并发控制、失败重试、失败日志。

* 与 TTS 服务共享 `pronunciations/` 缓存目录。

### 5.4 工具层（electron/utils/）

#### cache.ts

通用 `LRUCache<T>`：



* 使用 `Map` + `accessOrder` 数组实现。

* `get` 命中后移动到末尾（最近使用）。

* `put` 超过容量时移除最旧条目。

* 提供 `clear`、`has`、`toJSON`、`size`。

#### helpers.ts

**路径系统**：



* `ROOT_DIR`：项目根目录（`__dirname/../..`），开发环境指向源码根。

* `APP_ROOT_DIR`：应用根目录，打包后指向 `resources/app`，开发时等同于 `ROOT_DIR`。

* `USER_DATA_DIR`：用户数据目录（`app.getPath('userData')` 或 `%APPDATA%/拾词`），保存用户数据。

* `CACHE_DIR`：缓存目录（`USER_DATA_DIR/cache`），翻译缓存、音频缓存等。

* `ASSETS_DIR`：可下载资源目录（`USER_DATA_DIR/assets`），下载的词典 / 模型存放于此。

* `resolveAssetPath(filename)`：优先从用户目录 `ASSETS_DIR` 查找，回退到安装目录 `APP_ROOT_DIR`，统一资源路径解析。

**通用工具**：



* `normalizeWordForFilename(word)`：替换 Windows 非法文件名字符。

* `preprocessWordForTTS(word)`：简化版 TTS 预处理（供 helpers 其他调用方使用）。

* `successResponse(data)` / `errorResponse(message, statusCode)`：统一响应包装。

* `ensureDirExists(dirPath)`：递归创建目录。

* `getRequestParam(req, key, defaultValue)`：从 `req.query` 或 `req.body` 获取参数。

### 5.5 预加载脚本（electron/preload.ts）



```
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {

&#x20; platform: process.platform,

&#x20; version: '2.0.0',

});
```

当前预加载脚本仅暴露少量信息。渲染进程不直接访问 Node.js API；所有数据交互通过本地 HTTP API 完成，保持最小权限暴露。



***

## 6. 前后端集成

### 6.1 Electron 内的数据流



1. 用户启动应用 → Electron 主进程 `main.ts`。

2. 主进程初始化 SQLite 数据库、TTS 服务、Express 路由。

3. Express 监听动态端口（从 5000 开始递增）。

4. `BrowserWindow` 加载 `http://127.0.0.1:<PORT>`，渲染进程通过 `fetch` 调用 Express API。

5. 静态资源由 Express `express.static(STATIC_DIR)` 提供，指向 `dist/`（开发）或 `static/`（打包）。

### 6.2 API 请求封装

前端统一使用 `src/utils/api.ts`：



```
// 统一处理 response.ok 检查，非 2xx 响应抛出错误

async function parseResponse\<T>(response: Response): Promise\<T> { ... }

export async function apiGet\<T = any>(url: string): Promise\<T> { ... }

export async function apiPost\<T = any>(url: string, body: any): Promise\<T> { ... }

export async function apiPostForm\<T = any>(url: string, formData: FormData): Promise\<T> { ... }
```

所有请求经 `parseResponse` 统一校验 HTTP 状态码，非 2xx 响应抛出 Error，调用方需 try/catch 处理。

### 6.3 缓存策略



| 缓存层     | 位置                                        | 容量 / 策略    | 说明                                 |
| ------- | ----------------------------------------- | ---------- | ---------------------------------- |
| 例句缓存    | `routes.ts` 内存                            | 500 条 LRU  | 避免重复查询 `examples.db`               |
| 翻译缓存    | `routes.ts` 内存 + `cache/translation.json` | 1000 条 LRU | 启动时加载最近 1000 条，运行时定时写入文件           |
| 独立翻译缓存  | `translate.ts` 内存                         | 500 条 LRU  | 供 `/api/translate` 使用              |
| 音频缓存    | 文件系统                                      | 无上限        | `pronunciations/` 与 `cache/audio/` |
| 系统单词本缓存 | `wordbook.ts` 内存                          | 无上限        | 切换系统单词本时避免重新加载                     |

### 6.4 音频预加载与播放

`src/utils/audio.ts` 实现音频队列与合成提示音：



* `MAX_CONCURRENT = 3`：控制同时加载数，避免浏览器并发阻塞。

* `MAX_RETRIES = 1`：失败自动重试一次。

* `PRELOAD_COUNT = 2`：播放当前单词时预加载后 2 个。

* 缓存命中时返回克隆的 `Audio` 实例，避免播放状态互相影响。

* 播放失败自动回退到 `/api/audio/generate` 生成并播放缓存音频。

* **合成提示音**：使用 Web Audio API（OscillatorNode + GainNode）生成答对、答错、按钮点击、测验完成四类提示音，不依赖外部音频文件；通过 `appState.settings.soundEnabled` 全局开关控制，默认开启。

### 6.5 持久化映射



| 数据     | 存储位置                                   | 说明                         |
| ------ | -------------------------------------- | -------------------------- |
| 前端状态   | `localStorage`                         | 主题、侧边栏、收藏、单词本、错题本、学习统计、设置等 |
| 主词典    | `stardict.db`                          | SQLite，只读，启动必需资源（可下载）      |
| 例句     | `examples.db`                          | SQLite，只读，可选下载资源           |
| 自定义单词本 | `wordbooks.json`                       | JSON 文件，后端读写               |
| 发音文件   | `pronunciations/`                      | 永久缓存，可批量下载                 |
| 翻译缓存   | `USER_DATA_DIR/cache/translation.json` | 文件持久化                      |
| 临时音频   | `USER_DATA_DIR/cache/audio/`           | 句子 / 词组 TTS 缓存             |
| 可下载资源  | `USER_DATA_DIR/assets/`                | 下载的词典、模型等大型资源              |



***

## 7. Vue 组件模板

单词本、收藏、错题本共用 `src/utils/virtualScroll.ts` 虚拟列表 mixin，模板结构相似但数据与交互略有差异。

### 7.1 公共结构

三个模板均包含：



* 外层 `.wordbook-vue-scroll` 滚动容器，绑定 `@scroll="onScroll"`。

* 内层占位 `div`，高度为 `totalHeight`，用于撑开滚动条。

* `v-for="item in visibleItems"` 只渲染可视区项。

* 每项使用 `getItemStyle(item._idx)` 绝对定位。

* 每项内部是 `flip-card-container` + `flip-card`，支持左键展开 / 右键翻转。

* 展开后显示 `definitions[item.word]`（懒加载）和 `examples[item.word]`。

### 7.2 wordbook-vue-template



```
\<script type="text/x-template" id="wordbook-vue-template">

\<div class="wordbook-vue-scroll" @scroll="onScroll" :style="{ height: containerHeight + 'px', overflowY: 'auto', position: 'relative' }">

&#x20; \<div :style="{ height: totalHeight + 'px', position: 'relative' }">

&#x20;   \<div v-for="item in visibleItems" :key="item.word" :data-word="item.word"

&#x20;        :style="getItemStyle(item.\_idx)"

&#x20;        class="wordlist-item"

&#x20;        :draggable="!isSystemWordbook"

&#x20;        @dragstart="onDragStart(\$event, item.\_idx)"

&#x20;        @dragover.prevent="onDragOver(\$event, item.\_idx)"

&#x20;        @dragend="onDragEnd">

&#x20;     \<div class="flip-card-container">

&#x20;       \<div class="flip-card" :class="{ 'flipped': flippedMap\[item.word] }">

&#x20;         \<div class="flip-card-front" @click="handleLeftClick(item.word)" @contextmenu.prevent="handleRightClick(item.word)">

&#x20;           \<!-- 正面：单词、错误次数、操作按钮、展开释义/例句 -->

&#x20;         \</div>

&#x20;         \<div class="flip-card-back" @click="handleLeftClick(item.word)" @contextmenu.prevent="handleRightClick(item.word)">

&#x20;           \<!-- 背面：完整释义 + 例句 -->

&#x20;         \</div>

&#x20;       \</div>

&#x20;     \</div>

&#x20;   \</div>

&#x20; \</div>

\</div>

\</script>
```

**特性**：



* 自定义单词本支持拖拽排序（`draggable`、`dragstart`、`dragover`、`dragend`），系统单词本禁用拖拽。

* 正面显示 `errorInfo(item.word)`，展示该词在错题本中的错误次数。

* 操作按钮：美式发音、英式发音、移除（系统单词本隐藏移除按钮）。

* 左键切换展开，右键切换翻转。

### 7.3 favorites-vue-template

与单词本模板类似，区别：



* `:key="item.word + '_' + (item.timestamp || '')"`：同一单词可多次收藏，用时间戳区分。

* 顶部显示类型标签（单词 / 词组 / 句子）。

* 优先显示收藏时缓存的 `item.translation` 或 `item.meanings`，无需立即查词典。

* 无拖拽排序，固定移除按钮。

### 7.4 errorbook-vue-template

与收藏模板类似，区别：



* 显示错题的 `errorInfo(item.word)`（错误次数 / 正确次数）。

* 展开区域左边框使用 `--accent-red`，视觉区分错题本。

* 无类型标签显示逻辑差异，但数据来自 `appState.errorbook`。

### 7.5 展开与翻转交互



* `expandedMap`：记录当前展开的词，展开后异步请求 `/api/search` 与 `/api/examples` 填充释义和例句。

* `flippedMap`：记录翻转状态，背面直接展示完整释义，无需再次请求。

* 卡片高度在展开 / 翻转时从 `collapsedHeight`（140px）估算为 3 倍，DOM 渲染后通过 `offsetHeight + 50` 精确测量并缓存到 `cachedHeights`。



***

## 8. 性能优化

### 8.1 虚拟列表

`src/utils/virtualScroll.ts` 提供 `virtualScrollMixin`，核心优化点：



* **分段懒计算偏移**：`offsets` 计算时从 `start` 向前每 20 步查找缓存锚点，避免从 0 开始累加。

* **二分查找可见范围**：`visibleRange` 基于缓存偏移或估算偏移二分定位 `start`。

* **尾部总高度估算**：`totalHeight` 从尾部回查 200 项找到缓存锚点，快速估算列表总高度。

* **rAF 滚动节流**：`onScroll` 使用 `requestAnimationFrame`，避免快速滚动时频繁触发 Vue 响应式更新。

* **缓冲区**：`BUFFER = 20`，视口上下各预留 20 条，避免白屏。

* **高度缓存**：`cachedHeights` 记录展开 / 翻转后的真实高度，减少重复 DOM 测量。

* **缓存清理**：切换单词本 / 收藏 / 错题本时调用 `clearCache()`，避免旧偏移残留。

### 8.2 LRU 缓存

多层级缓存减少重复计算与 IO：



* 例句 500 条（`database.ts` + `routes.ts`）。

* 翻译 1000 条（`routes.ts` 内存 + 文件）。

* 系统单词本全量缓存（`wordbook.ts` `systemWordbookCache`），切换词书时瞬时响应。

* TTS 音频文件系统缓存，避免重复网络请求。

### 8.3 系统单词本分页加载

前端 `wordbook.ts` 按 `PAGE_SIZE = 200` 分批请求 `/api/system-wordbook/words`：



* 每加载一批立即调用 `renderBatch()` 渲染到 Vue，保留滚动位置。

* 进度条显示 `正在加载单词列表... (loaded/total)`。

* 使用 `AbortController` 支持切换词书时取消未完成的请求。

* 加载完成后存入 `systemWordbookCache`。

### 8.4 SSE 导出进度

`/api/wordbook/export-stream` 实现服务器发送事件：



* 连接成功后发送 `{ type: 'start', total }`。

* 每批 50 个单词查询完成后发送 `{ type: 'progress', done, total }`。

* 文件生成后发送 `{ type: 'done', file: base64, mimeType, filename }`。

* 出错发送 `{ type: 'error', message }` 并结束流。

前端 `progress.ts` 提供阶段动画与百分比进度，提升大词书导出体验。

### 8.5 音频队列

`src/utils/audio.ts`：



* 限制并发数为 3，防止浏览器一次性发起过多请求导致阻塞。

* 失败重试 1 次，超过后静默失败并打印日志。

* 播放成功后预加载后 2 个单词发音， quiz / 复习连续播放更流畅。

* 使用 `URL.createObjectURL(blob)` 加载音频，避免重复走 HTTP。

### 8.6 页面切换性能

为缓解连续切换页面时的卡顿，做了以下优化：



* **keep-alive + LRU**：离开页面时保留 `.rendered` 类，最多保留 3 个后台页面，超出时释放最老的。

* **CSS 渲染隔离**：`.content-page.rendered:not(.active)` 使用 `content-visibility: auto; contain: strict;`，降低后台页面的渲染 / 合成开销。

* **全局滚动监听瘦身**：`initGlassScrollDegradation()` 只扫描当前激活页面内的 `.glass` 元素，避免 DOM 累积后每次滚动都遍历全页。

* **主进程内存兜底**：渲染进程内存超过 1024MB 时，IPC 通知前端释放一半后台页面。

* **切换锁**：`isSwitching` 防止快速连点时动画重叠。



***

## 9. 关键设计决策

### 9.1 Electron + Express 一体化架构

采用 Electron 主进程内置 Express 服务，而非独立后端：



* 前后端同属一个进程，部署更简单，避免额外的 Python/Node 环境依赖。

* TypeScript 全栈，前后端类型一致，便于维护。

* 打包后单文件安装程序，启动即开浏览器窗口。

* 渲染进程通过本地 HTTP API（`fetch`）与主进程通信，不暴露 Node.js API。

### 9.2 better-sqlite3 同步查询

使用 `better-sqlite3` 进行同步 SQLite 查询：



* 查词、模糊匹配等操作需要低延迟，同步 API 避免 async/await 嵌套。

* 数据库以只读方式打开，主词典数据不参与写操作，稳定安全。

### 9.3 Context Isolation 与最小预加载

渲染进程不开启 `nodeIntegration`，仅通过 `preload.ts` 暴露 `electronAPI` 版本信息。所有业务数据通过本地 HTTP API 获取，降低渲染进程被 XSS 利用后的风险。

### 9.4 状态管理采用 Proxy + Reflect

不使用 Vuex/Pinia，而是自定义 `Proxy + Reflect` 响应式系统：



* 递归拦截嵌套对象，实现深层响应。

* `PERSISTENCE_MAP` 声明哪些字段自动同步 `localStorage`。

* Pub-Sub 订阅机制让模块独立监听自己关心的状态变化。

### 9.5 虚拟列表处理大数据量

单词本 / 收藏 / 错题本可能包含数千条记录，虚拟列表只渲染可视区：



* 避免一次性创建大量 DOM。

* 保持滚动流畅，支持快速拖拽滚动条。

* 卡片翻转、展开等复杂交互在虚拟列表下通过绝对定位实现。

### 9.6 多级 TTS 与翻译降级

发音和翻译都依赖外部网络服务，设计多级降级链：



* TTS：有道 → 百度 → Edge → 腾讯云。

* 翻译：腾讯云 → 有道 → MyMemory → 词典逐词兜底。

* 文件缓存避免重复请求，提升离线可用性。

### 9.7 离线语音输入

浏览器 `webkitSpeechRecognition` 在 Electron 中不可用，因此集成 Sherpa-ONNX (SenseVoice) 离线多语言模型：



* 模型文件约 800MB，可在设置页按需下载，也可通过 `extraResources` 内置到安装包中分发。

* 支持中文、英文、日文、韩文、粤语等多语言自动识别。

* 前端采集 PCM 数据经 HTTP POST `/api/speech/recognize` 送到主进程，由 Sherpa-ONNX Node.js 绑定识别。

* 识别结果自动添加标点，可直接用于搜索。

* Windows 中文路径兼容：模型路径含非 ASCII 时自动复制到 `%LOCALAPPDATA%\sherpa-onnx-sensevoice` 加载。

* 启动时优先通过 `isAssetAvailable()` 检查安装包 / 用户目录是否已有可用模型，已有则跳过下载并清理残留分卷临时文件。

* 无需网络，保护隐私。

### 9.8 文件系统存储自定义单词本

自定义单词本以 `wordbooks.json` 存储：



* 结构简单，便于导入 / 导出 / 备份。

* 后端按词干去重，避免 `work/worked/works` 重复出现。

* 系统单词本保留在 SQLite 中，与自定义单词本隔离，防止误删误改。

### 9.9 动态端口避免启动冲突

`findAvailablePort(5000)` 从 5000 开始递增寻找可用端口：



* 避免端口被占用导致启动失败。

* 渲染进程通过实际监听的端口加载页面，无需写死 5000。

### 9.10 静态资源与打包路径



* 开发时 Express 使用 `dist/`（Vite dev/build 输出）。

* 打包时 `scripts/copy-static.cjs` 将 `dist/` 复制到 `static/`，`electron-builder` 将 `static/` 打包进安装程序。

* Electron 主进程通过 `__dirname` 相对路径定位资源。

**大型资源内置 + 按需下载策略**：



* 词典（`stardict.db`）、例句（`examples.db`）、语音识别与语义模型通过 `extraResources` 内置到安装目录 `resources/`，开箱即用。

* 单词发音（约 800MB）、四级听力（压缩后约 3.56GB）体积过大，不打入安装包，改为设置页按需下载；发音缺失时自动降级在线 TTS。

* 下载源在 `electron/config/assets.ts` 配置：主资源取自主仓库 V2.0 Release，听力 39 卷按序分配到 4 个配套 audio 仓库；基地址可用环境变量 `ASSETS_BASE_URL` 整体替换。

* 资源经 Gitee Releases 7z 分卷（每卷约 95MB），`AssetManager` 逐卷下载、断点续传、校验并合并解压到 `USER_DATA_DIR/assets/`，升级应用不影响用户数据。

**electron-builder 优化配置**：



* `asar: true`：将代码打包为 asar 归档，减少文件数量。

* `compression: "maximum"`：最大压缩，减小安装包体积。

* `asarUnpack`：原生模块（better-sqlite3、sherpa-onnx-node 等）不打包进 asar，确保能正常加载。

* `files` 配置：排除 `node_modules` 中的测试文档、源码等非必要文件。

* `npmRebuild: false`：原生模块先用 `npx electron-builder install-app-deps` 针对 Electron 预编译，打包时跳过从源码重编译（无需本机 Visual Studio C++ 工具链）。

### 9.11 测验与复习模块的公共逻辑

测验（quiz.ts）和复习（review.ts）模块共用以下逻辑：



* **IME 组合输入处理**：`src/utils/quizCommon.ts` 的 `setupImeHandling()` 通过 `compositionstart`/`compositionend` 事件追踪中文输入法状态，防止拼音确认键被误判为 Enter 提交。

* **Enter 提交**：`quizCommon.ts` 的 `setupEnterSubmission()` 检查 IME 状态、禁用状态后执行回调。

* **防抖检查**：`quizCommon.ts` 的 `setupGlobalShortcuts()` 内置 100ms 防抖，防止快速连按触发重复判题。

* **快捷键系统**：`answerKey`（默认 `1`）显示答案、`playPronunciationKey`（默认 `2`）播放发音，在输入框聚焦时仅数字键触发。

* **释义选择逻辑**：通过 `quizHelper.ts` 的 `selectMeaningsForQuestion` 和 `checkQuizAnswer` 共享。

* **错题权重更新**：错误时 `meaningWeights[definition].weight *= 1.1`，正确时 `*= 0.9`。

两模块的差异主要在：



* 测验模式支持听写（Dictation）、中译英（ZhToEn）、英译中（EnToZh）三种模式；复习模式仅支持中译英和英译中。

* 测验的单词来源是单词本 / 系统词书 / 收藏 / 错题，复习的来源是学习历史 / 到期词 / 错题 / 近期练习。

* 测验在答对后自动进入下一题（带 1.5s 延迟动画），复习需要手动点击下一题。

* 复习模式额外有点击日期行展开 / 折叠按天分组的学习历史。

### 9.12 错题本权重系统

错题本 `errorbook` 中每个单词记录的不只是错误次数，还有细粒度的释义权重：



```
interface ErrorbookEntry {

&#x20; word: string;

&#x20; type?: string;

&#x20; timestamp?: number;

&#x20; errorCount: number;       // 总错误次数

&#x20; correctCount: number;     // 连续正确次数

&#x20; translation?: string;

&#x20; meanings?: Array<{ part: string; definition: string }>;

&#x20; meaningWeights?: Record\<string, { errorCount: number; correctCount: number; weight: number }>;

}
```



* `meaningWeights` 以释义文本为键，记录每个释义选项的独立错误 / 正确次数和权重。

* 测验出题时，`selectMeaningsForQuestion` 按权重随机选择释义，高权重（常错）的释义有更高概率被选中。

* 当某个释义的 `correctCount >= settings.errorCorrectCount`（默认 3）时，释义权重降低，但不从错题本移除。

* 只有单词级别的 `correctCount >= settings.errorCorrectCount` 时，整个单词才从错题本移除。



***

## 10. GSAP 动画系统详解

### 10.1 延迟加载策略

`src/utils/gsap.ts` 采用动态 import 延迟加载 GSAP，避免阻塞首屏渲染：



```
let gsapCore: any = null;

let gsapReady = false;

async function ensureGsap(): Promise\<boolean> {

&#x20;   if (gsapReady) return true;

&#x20;   try {

&#x20;       const mod = await import('gsap');

&#x20;       gsapCore = mod.default || mod;

&#x20;       gsapReady = true;

&#x20;       return true;

&#x20;   } catch {

&#x20;       gsapReady = true; // 标记已尝试过，避免反复报错

&#x20;       return false;

&#x20;   }

}

// 页面初始化时就开始加载，需要用到时大概率已就绪

ensureGsap();
```

### 10.2 动画类型



| 函数                       | 用途         | 参数            | 动画参数                                                  |
| ------------------------ | ---------- | ------------- | ----------------------------------------------------- |
| `animateCardFlip`        | 卡片翻转       | el, flipped   | rotateY: 0→180, 0.35s, power2.out                     |
| `animateCardEnter`       | 单卡片入场      | el            | opacity + y + scale, 0.45s, back.out(1.3)             |
| `animateCardsEnter`      | 批量卡片入场     | els\[]        | 同上 + stagger 0.05s                                    |
| `animateCardExit`        | 卡片退场（右滑消失） | el, onDone    | x: -120%, height: 0, 0.4s, power2.in                  |
| `animateResultShow`      | 词典结果展示     | el            | scale + opacity, 0.42s, power2.out                    |
| `animatePageEnter`       | 页面入场       | el            | scale + opacity, 0.42s, cubic-bezier(0.16, 1, 0.3, 1) |
| `animateCorrectFeedback` | 答对反馈       | el            | 绿色脉冲 + 缩放，0.5s                                        |
| `animateErrorShake`      | 答错抖动       | el            | 水平抖动，0.4s                                             |
| `showToast`              | 弹幕式 Toast  | message, type | 从右滑入 → 停留 2s → 右滑出                                    |

### 10.3 Toast 弹幕系统



```
export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {

&#x20;   const toast = document.createElement('div');

&#x20;   toast.className = \`toast toast-\${type}\`;

&#x20;   toast.textContent = message;

&#x20;   document.body.appendChild(toast);

&#x20;   // 从右滑入

&#x20;   gsapCore.fromTo(toast,

&#x20;       { x: 200, opacity: 0 },

&#x20;       { x: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }

&#x20;   );

&#x20;   // 停留后滑出并移除

&#x20;   setTimeout(() => {

&#x20;       gsapCore.to(toast, {

&#x20;           x: 200, opacity: 0, duration: 0.3, ease: 'power2.in',

&#x20;           onComplete: () => toast.remove()

&#x20;       });

&#x20;   }, 2000);

}
```

Toast 样式：



* `.toast`：fixed 定位，右上角，z-index: 10000

* `.toast-success`：绿色背景 `#27ae60`

* `.toast-error`：红色背景 `#e74c3c`

* `.toast-info`：蓝色背景 `#3498db`

### 10.4 全局按钮按压动画

在 `setupGsapGlobal()` 中为所有 `button` 元素绑定 `mousedown`/`mouseup`/`mouseleave` 事件：



* `mousedown`：`scale(0.95)`，0.1s

* `mouseup`/`mouseleave`：`scale(1)`，0.2s 弹性回弹

使用 `WeakMap` 记录按压状态，避免重复绑定。



***

## 11. 卡片交互系统（cardMixin.ts）

`src/utils/cardMixin.ts` 为单词本、收藏、错题本三个 Vue 组件提供公共的卡片交互逻辑。

### 11.1 核心数据结构



```
// 每个 Vue 组件实例维护

data: {

&#x20;   expandedMap: Record\<string, boolean>;   // 展开状态

&#x20;   flippedMap: Record\<string, boolean>;    // 翻转状态

&#x20;   definitions: Record\<string, string>;    // 释义 HTML（懒加载）

&#x20;   examples: Record\<string, any\[]>;        // 例句数据（懒加载）

&#x20;   cachedHeights: Record\<string, number>;  // 展开/翻转后的精确高度

}
```

### 11.2 交互行为



| 操作 | 触发方式          | 行为                                                 |
| -- | ------------- | -------------------------------------------------- |
| 展开 | 左键点击          | `expandedMap[word] = !expandedMap[word]`，异步请求释义和例句 |
| 翻转 | 右键点击          | `flippedMap[word] = !flippedMap[word]`，背面直接显示完整释义  |
| 关闭 | 点击已展开 / 翻转的卡片 | 重置展开和翻转状态                                          |

### 11.3 高度测量



* 折叠状态：`collapsedHeight = 140px`

* 展开 / 翻转状态：首次估算为 `collapsedHeight * 3`（420px）

* DOM 渲染后延迟 100ms，通过 `$el.querySelector('.wordlist-item').offsetHeight + 50` 精确测量

* 测量结果存入 `cachedHeights[word]`，避免重复计算

* 切换单词本时调用 `clearCache()` 清除所有高度缓存



***

## 12. 系统单词本分页加载（progress.ts）

`src/utils/progress.ts` 提供系统单词本的分页加载进度条：



```
function showProgressBar(container: HTMLElement): void {

&#x20;   // 创建进度条 DOM：进度条 + 百分比文字

}

function updateProgressBar(loaded: number, total: number): void {

&#x20;   // 更新进度条宽度和文字

}

function hideProgressBar(): void {

&#x20;   // 淡出动画后移除进度条

}
```

加载流程：



1. 用户选择系统单词本 → 发送 `/api/system-wordbook/words?tag=xxx&limit=200&offset=0`

2. 每返回一批数据，调用 `renderBatch()` 渲染到 Vue 列表

3. 进度条显示 `正在加载单词列表... (loaded/total)`

4. 使用 `AbortController` 支持切换词书时取消未完成的请求

5. 加载完成后存入 `systemWordbookCache`，下次切换直接使用缓存



***

## 13. 设置模块详解

### 13.1 API 密钥管理

腾讯云 API 密钥（Secret ID / Secret Key）通过设置页面的超链接弹窗管理：



* 设置页底部有 "API 密钥设置" 超链接（`#api-settings-link`）

* 点击打开 `#api-settings-modal` 弹窗

* 弹窗内有两个输入框：Secret ID（普通文本）和 Secret Key（password 类型）

* 保存时校验：两个字段必须同时为空或同时有值，不允许部分填写

* 保存到 `localStorage.setItem('tencent_api_keys', JSON.stringify({secretId, secretKey}))`

* 如果用户未填写，后端使用 `electron/config.ts` 中的默认密钥（可从环境变量覆盖）

* 后端每次 TTS / 翻译请求时检查 `localStorage` 中的密钥，优先使用用户自定义密钥

### 13.2 拖拽排序详细算法

设置页面的拖拽排序基于 Pointer Events API：

**数据结构**：



```
interface DragState {

&#x20;   container: HTMLElement;

&#x20;   containerKey: string;       // 'page-settings' 或 'quiz-settings'

&#x20;   sourceItem: HTMLElement;

&#x20;   sourceIndex: number;

&#x20;   items: HTMLElement\[];

&#x20;   originalRects: DOMRect\[];   // 相对容器坐标（不受滚动影响）

&#x20;   ghost: HTMLElement;         // 浮动副本 position: fixed, scale(1.05)

&#x20;   offsetX: number;

&#x20;   offsetY: number;

&#x20;   targetIndex: number;

&#x20;   pointerId: number;

&#x20;   hasMoved: boolean;

&#x20;   lastMouseX: number;

&#x20;   lastMouseY: number;

}
```

**核心算法**：



1. `pointerdown`：记录源项索引、创建 ghost 副本、记录原始 rect（相对容器坐标）

2. `pointermove`：ghost 瞬间跟随鼠标（无 CSS transition），计算 `computeTargetIndex` 确定插入位置，`applyShifts` 计算其他项的 transform 偏移

3. `pointerup`：DOM 重排序、保存到 localStorage、清除 transform（带 0.22s 归位动画）

**transform 偏移计算**（`applyShifts`）：



* 向前拖（targetIndex < sourceIndex）：`[targetIndex, sourceIndex)` 的项向后移动一格

* 向后拖（targetIndex > sourceIndex）：`(sourceIndex, targetIndex]` 的项向前移动一格

* 源项保持半透明占位（`.is-dragging` 类，opacity: 0.25）

**关键实现细节**：



* `originalRects` 存储容器相对坐标而非视口坐标，避免 `getBoundingClientRect()` 受 transform 影响

* 交互元素（input, select, textarea, a, button）不触发拖拽操作

* 拖拽手柄（⋮⋮）显示在设置项上，指示可拖拽功能

排序持久化键：`setting-sort-order-page-settings`、`setting-sort-order-quiz-settings`

### 13.3 资源下载管理

设置页新增 "资源管理" 区块，展示所有可下载资源的状态与操作入口：

**资源卡片列表**：



* 每个资源一张卡片，显示名称、大小、状态（未下载 / 下载中 / 已就绪 / 错误）

* 进度条显示下载百分比和下载速度

* 操作按钮：下载 / 暂停 / 继续 / 删除

**前端实现**：



* 页面加载时调用 `/api/assets/status` 获取初始状态

* 点击下载时建立 SSE 连接到 `/api/assets/download`，实时更新进度

* 下载完成后刷新状态，显示 "已就绪"

* 删除前弹出确认弹窗，避免误操作

**发音批量下载**：



* 独立的 "离线发音包" 管理区域

* 显示已下载数量 / 总单词数 / 预计占用空间

* 开始 / 暂停 / 继续 / 取消 按钮

* 清空发音缓存按钮（清理所有 MP3 文件）

**状态持久化**：



* 资源下载状态由后端 `AssetManager` 维护

* 前端每次进入设置页重新拉取状态

* 下载进度通过 SSE 实时推送，无需轮询



***

## 14. 词典页面词跳转过渡

从其他页面（例句、收藏、错题本）点击单词链接时，触发 `jumpToWord` → `doWordJump`：



```
async function doWordJump(word: string, triggerSearch: () => void): Promise\<void> {

&#x20;   const wasOnDict = currentSection === PageSection.Dictionary;

&#x20;   if (wasOnDict && result可见) {

&#x20;       // 同页跳转：给 result 加 .word-switching 类，触发过渡动画

&#x20;       result.classList.add('word-switching');

&#x20;       triggerSearch();

&#x20;   } else {

&#x20;       // 跨页跳转：先隐藏结果区，切到词典页，等待两帧后执行搜索

&#x20;       result.classList.remove('result-visible');

&#x20;       await switchPage(PageSection.Dictionary);

&#x20;       await new Promise(r => requestAnimationFrame(r));

&#x20;       await new Promise(r => requestAnimationFrame(r));

&#x20;       triggerSearch();

&#x20;   }

}
```



* 跨页跳转需等待两帧 `requestAnimationFrame`，确保 DOM 完全渲染后再搜索

* 跳转过程中 `isWordJumping()` 返回 true，`isCrossPageJumping()` 返回跨页状态

* 词典页面的 `displayResult` 函数根据 `isWordJumping()` 判断是否跳过入场动画



***

## 15. 后端服务详解

### 15.1 TTS 服务完整降级链

`electron/services/tts.ts` 中的 `TencentTTS` 类实现多级 TTS 降级：

**单词降级链**：



1. 有道 TTS → 检查文件缓存是否存在

2. 百度 TTS → 有道失败时调用

3. Edge TTS（`edge-tts` CLI 子进程，调用前通过 `isEdgeTtsAvailable()` 检测环境，不可用时跳过）→ 百度失败时调用

4. 腾讯云 TTS → 最终兜底

**句子降级链**：



1. Edge TTS → 句子优先使用 Edge（语音质量好）

2. 腾讯云 TTS → Edge 失败时兜底

**缓存策略**：



* 单词永久缓存：`pronunciations/<normalizedWord>_<accent>.mp3`

* 句子 / 词组缓存：`cache/audio/<normalizedPhrase>_<accent>.mp3`

* 缓存校验：读取文件首字节，若为 `{`（JSON 错误响应）则删除无效缓存

* 提供商标记：`.provider` 文件记录当前缓存的提供商，非有道时尝试升级

**音频预处理**：`preprocessWordForTTS` 去掉编号、括号注释、学科标记等，提高 TTS 成功率。

### 15.2 翻译服务降级链

`electron/services/translate.ts` 实现独立翻译服务：



1. 腾讯云翻译 → 使用用户配置的 Secret ID/Key

2. 有道网页翻译 → 腾讯云失败时调用

3. MyMemory 免费 API → 有道失败时调用

4. 词典兜底 → 所有在线翻译失败，使用主词典逐词翻译

使用 `LRUCache<string>(500)` 缓存翻译结果，失败返回空字符串不缓存。

### 15.3 NLP 文本分类

`electron/services/nlp.ts` 基于 `compromise` 库对输入文本分类：



* 以 `.!?;` 结尾 → `sentence`

* 0-1 个有效 token → `word`

* 同时包含名词（非动名词）和动词（非动名词）→ `sentence`

* 其他 → `phrase`

### 15.4 Sherpa-ONNX (SenseVoice) 语音识别

`electron/services/sherpa_asr.ts` 使用 Sherpa-ONNX 运行时加载 SenseVoice 模型进行离线多语言语音识别，完全替代了旧版 Vosk 方案。

**核心特性**：



* 多语言支持：中文、英文、日文、韩文、粤语（SenseVoice 模型）

* 模型大小：约 800MB（INT8 量化版）

* 模型文件：`sherpa-onnx-sense-voice-zh-en-ja-ko-yue/` 目录，含 model.onnx、tokens.txt 等

* 前端采集：`MediaRecorder` + `AudioContext` 16kHz 重采样为 PCM 16-bit mono

* 识别结果：带标点的文本，支持中英文自动切换

**依赖**：



* `sherpa-onnx-node`：Sherpa-ONNX 的 Node.js 绑定

* `sherpa-onnx-win-x64`：Windows x64 平台原生二进制（可选依赖）

**关键函数**：



* `ensureModelDownloaded()`：优先检查安装包 / 用户目录是否已有可用模型，缺失时触发下载；检测到可用模型后自动清理残留分卷临时文件。

* `initSherpaRecognizer()`：初始化识别器，检测路径是否含非 ASCII 字符，必要时复制到 ASCII 目录。

* `recognizeWithSherpa(base64Pcm: string)`：接收 Base64 编码的 PCM 音频数据，返回识别文本。

* `isSherpaModelReady()`：检查模型文件是否就绪。

**Windows 中文路径兼容**：

Sherpa-ONNX 原生绑定要求模型路径为 ASCII，Windows 中文用户名路径会失败。解决方案：



1. 检测路径是否含非 ASCII 字符

2. 若含非 ASCII，将模型复制到 `%LOCALAPPDATA%\sherpa-onnx-sensevoice`

3. 使用复制后的 ASCII 路径加载模型

**与 Vosk 的对比**：



| 维度    | Vosk          | Sherpa-ONNX (SenseVoice) |
| ----- | ------------- | ------------------------ |
| 模型大小  | \~43MB（英文小模型） | \~800MB（多语言 INT8 版）      |
| 支持语言  | 单语言（需切换模型）    | 中 / 英 / 日 / 韩 / 粤 多语言合一  |
| 识别准确率 | 一般（小模型）       | 较高                       |
| 标点输出  | 无             | 自动添加标点                   |
| 路径要求  | 无特殊要求         | Windows 下需 ASCII 路径      |

### 15.5 可下载资源管理器（asset-manager.ts）

`electron/services/asset-manager.ts` 管理大型可选资源的按需下载，避免安装包过大。资源通过 Gitee Releases 托管，使用 7z 分卷压缩（绕过单文件 100MB 限制）。

**资源清单（**`electron/config/assets.ts`**）**：



| 资源 ID        | 名称            | 必需 | 大小      | 说明                          |
| ------------ | ------------- | -- | ------- | --------------------------- |
| `stardict`   | 主词典数据库        | 是  | \~650MB | ECDict + StarDict 合并词库，启动必需 |
| `examples`   | 例句数据库         | 否  | \~120MB | Tatoeba 中英例句，测验 / 复习例句功能使用  |
| `sherpa-asr` | Sherpa 语音识别模型 | 否  | \~800MB | SenseVoice 多语言离线语音识别模型      |

**分卷下载方案**：



* 每个资源打包为 `{name}.7z`，再按 95MB 分割为 `{name}.7z.001`、`.002`...

* 下载时按顺序拉取所有分卷文件

* 全部下载完成后用 7z 命令合并解压

* 解压后通过 MD5/SHA256 校验完整性

**核心类：AssetManager**



```
class AssetManager {

&#x20;   // 查询所有资源的下载状态

&#x20;   getStatus(): Record\<string, AssetStatus>;

&#x20;   // 下载指定资源（支持进度回调）

&#x20;   download(assetId: string, onProgress?: (p: DownloadProgress) => void): Promise\<void>;

&#x20;   // 暂停下载

&#x20;   pause(assetId: string): void;

&#x20;   // 取消下载（删除已下载的分卷）

&#x20;   cancel(assetId: string): void;

&#x20;   // 删除已安装的资源

&#x20;   delete(assetId: string): Promise\<void>;

&#x20;   // 检查资源是否就绪

&#x20;   isReady(assetId: string): boolean;

&#x20;   // 等待启动必需资源就绪（stardict）

&#x20;   waitForRequiredAssets(timeout?: number): Promise\<void>;

}
```

**下载进度数据结构**：



```
interface DownloadProgress {

&#x20;   assetId: string;

&#x20;   status: 'downloading' | 'extracting' | 'verifying' | 'done' | 'error' | 'paused';

&#x20;   totalSize: number;      // 资源总大小（字节）

&#x20;   downloadedSize: number; // 已下载大小（字节）

&#x20;   percent: number;        // 百分比 0-100

&#x20;   speed: number;          // 下载速度（字节/秒）

&#x20;   currentPart: number;    // 当前分卷索引

&#x20;   totalParts: number;     // 总分卷数

&#x20;   error?: string;

}
```

**断点续传**：



* 使用 HTTP Range 请求续传分卷文件

* 已下载的分卷文件保留 `.part` 后缀

* 每个分卷下载完成后校验大小和哈希

* 重新下载时跳过已完成的分卷

**路径策略**：



* 资源安装到 `USER_DATA_DIR/assets/`（用户数据目录）

* 优先从用户目录读取，回退到安装目录（打包内置的资源）

* 通过 `resolveAssetPath(filename)` 统一解析

**启动流程**：



1. Express 服务启动时初始化 `AssetManager`

2. 检查 `stardict.db` 是否存在（启动必需资源）

3. 若不存在，自动开始下载，主窗口显示下载进度

4. 下载完成并校验通过后，正常加载词典数据库

### 15.6 发音批量下载器（pronunciation-downloader.ts）

`electron/services/pronunciation-downloader.ts` 提供离线发音包的批量下载功能，遍历词典数据库中的所有单词，从 TTS 服务商下载发音 MP3。

**核心特性**：



* 数据源：从主词典 `stardict` 表读取所有英文单词（自动过滤中文词条）

* 下载目标：`pronunciations/` 目录，按单词 + 口音命名存储 MP3（如 `word_us.mp3`、`word_uk.mp3`）

* 启动检测：程序启动时自动扫描发音目录，清理中文发音文件，按口音统计已下载数量

* 断点续传：跳过已存在的有效 MP3 文件（>100 字节），退出后下次启动自动恢复

* 并发控制：可配置并发数（默认 2），避免触发 API 频率限制

* TTS 降级链：有道 → 百度 → Edge → 腾讯，与正常发音相同

* 进度统计：基于实际文件系统扫描结果，准确统计已下载、待下载、失败数量

**状态机**：



```
idle → running → paused → running → done

&#x20;                 ↓

&#x20;              stopped
```

**关键 API**：



```
interface PronunciationDownloader {

&#x20;   getStatus(): DownloadStatus;

&#x20;   start(options?: DownloadOptions): Promise\<void>;

&#x20;   pause(): void;

&#x20;   resume(): void;

&#x20;   cancel(): void;

&#x20;   // 清空所有已下载的发音文件

&#x20;   clearCache(): Promise\<number>;

}

interface DownloadStatus {

&#x20;   isRunning: boolean;

&#x20;   isPaused: boolean;

&#x20;   totalWords: number;

&#x20;   downloaded: number;

&#x20;   skipped: number;

&#x20;   failed: number;

&#x20;   currentWord: string;

&#x20;   percent: number;

&#x20;   speed: number;    // 单词/分钟

&#x20;   eta: number;      // 预计剩余秒数

}
```

**失败处理**：



* 每个单词最多重试 3 次，指数退避

* 连续失败超过阈值自动暂停，等待用户确认

* 失败的单词记录到 `pronunciations/failed.log`

* 支持从失败日志重新下载

**与 TTS 服务的关系**：



* 共享同一套 TTS 降级链和缓存目录

* 批量下载的结果可以被 TTS 服务直接命中缓存

* 两种模式互补：在线 TTS 即时性好，批量下载确保离线可用

### 15.7 后端 LRU 缓存实现

`electron/utils/cache.ts` 实现通用 LRU 缓存：



```
class LRUCache\<T> {

&#x20;   private store: Map\<string, { value: T; lastAccess: number }>;

&#x20;   private maxSize: number;

&#x20;   get(key: string): T | undefined;     // 命中后更新 lastAccess

&#x20;   put(key: string, value: T): void;    // 超过容量时淘汰最旧条目

&#x20;   has(key: string): boolean;

&#x20;   clear(): void;

&#x20;   toJSON(): Record\<string, T>;

&#x20;   get size(): number;

}
```

使用场景：



* 例句缓存：500 条（database.ts + routes.ts）

* 翻译缓存：1000 条（routes.ts + translate.ts）



***

## 16. 前端工具函数详解

### 16.1 数据类型定义（types/）



| 文件             | 内容                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `enums.ts`     | PronunciationType, QuizMode, QuizOrder, SortBy, FilterType, ContentType, PageSection, WordSource |
| `word.d.ts`    | WordData, MeaningItem, ParsedMeaning 接口                                                          |
| `api.d.ts`     | ApiResponse, ApiError 接口                                                                         |
| `book.d.ts`    | WordbookItem, ErrorbookEntry 接口                                                                  |
| `setting.d.ts` | QuizSettings, ExportSettings 接口                                                                  |
| `stats.d.ts`   | StudyStatsData 接口                                                                                |
| `global.d.ts`  | 全局类型声明（window.electronAPI 等）                                                                     |

### 16.2 正则表达式工具（regex.ts）

`src/utils/regex.ts` 提供常用的正则模式：



* 词性匹配：`/^([a-zA-Z]+\.)\s*(.*)$/`

* 领域标签：`/^\[([^\]]+)\]\s*(.*)$/`

* 中文字符检测：`/[\u4e00-\u9fff]/`

* 释义分隔符：`/[；;，,]/`

### 16.3 生成器工具（generator.ts）

`src/utils/generator.ts` 提供数据生成辅助函数：



* Fisher-Yates 洗牌算法（用于测验随机排序）

* 艾宾浩斯复习间隔计算

* 学习历史按天分组

### 16.4 localStorage 工具（storage.ts）

`src/utils/storage.ts` 提供类型安全的 localStorage 读写：



```
function getStorageItem\<T>(key: string, fallback: T): T;

function setStorageItem\<T>(key: string, value: T): void;

function removeStorageItem(key: string): void;
```



***

## 17. 共享常量配置（src/constants.ts）

统一管理项目中分散的硬编码常量，避免多处重复定义不一致。

### 17.1 系统单词本配置



```
// 统一使用 tags 数组，与后端 routes.ts 保持一致

export const SYSTEM\_WORDBOOKS = \[

&#x20;   { id: 'sys\_xx', name: '小学', tags: \['xx'] },

&#x20;   { id: 'sys\_zk', name: '中考', tags: \['zk'] },

&#x20;   { id: 'sys\_gk', name: '高考', tags: \['gk'] },

&#x20;   { id: 'sys\_cet4', name: '四级', tags: \['cet4'] },

&#x20;   { id: 'sys\_cet6', name: '六级', tags: \['cet6'] },

&#x20;   { id: 'sys\_cet46', name: '四六级合并', tags: \['cet46'] },

&#x20;   { id: 'sys\_tem48', name: '专四专八', tags: \['tem4', 'tem8'] },

&#x20;   { id: 'sys\_ky', name: '考研', tags: \['ky'] },

&#x20;   { id: 'sys\_toefl', name: '托福', tags: \['toefl'] },

&#x20;   { id: 'sys\_ielts', name: '雅思', tags: \['ielts'] },

&#x20;   { id: 'sys\_gre', name: 'GRE', tags: \['gre'] },

&#x20;   // ...完整列表见 src/constants.ts

] as const;
```

使用方：`src/global.ts` 导入 `SYSTEM_WORDBOOKS` 并映射为 `{ id, name, tags }[]`，`src/constants.ts` 为唯一数据源。

### 17.2 虚拟滚动常量



```
export const VIRTUAL\_SCROLL\_BUFFER = 20;  // 可见区域外的缓冲行数

export const COLLAPSED\_HEIGHT = 140;       // 折叠状态卡片高度（px）
```

使用方：`src/utils/virtualScroll.ts` 从 constants 导入作为 Vue data 的默认值。

### 17.3 音频常量



```
export const AUDIO\_MAX\_CONCURRENT = 3;   // 最大并发请求数

export const AUDIO\_MAX\_RETRIES = 1;      // 最大重试次数

export const AUDIO\_PRELOAD\_COUNT = 2;    // 预加载数量
```

使用方：`src/utils/audio.ts` 从 constants 导入。

### 17.4 页面管理常量



```
export const MAX\_RENDERED\_PAGES = 3;     // 后台最多保留的渲染页面数

export const RESERVED\_WORDBOOK\_NAMES = \['wordlist', 'favorites', 'errorbook'] as const;
```

### 17.5 测验 / 复习公共模块（quizCommon.ts）

`src/utils/quizCommon.ts` 抽取 quiz.ts 和 review.ts 的共享逻辑，减少重复代码：



| 函数                                                                    | 用途                                                                                 | 调用方                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------- |
| `setupImeHandling(input)`                                             | 绑定 compositionstart/compositionend/ 数字键拦截，返回 `{ isComposing, justComposed }` 状态访问器 | quiz.ts, review.ts    |
| `setupEnterSubmission(input, imeState, onEnter)`                      | Enter 键提交：检查 IME 状态、禁用状态、stopPropagation                                           | quiz.ts, review.ts    |
| `setupGlobalShortcuts(container, inputId, onAnswer, onPlay, getWord)` | 全局快捷键：answerKey 显示答案（100ms 防抖）、playKey 播放发音，输入框聚焦时仅数字键触发                           | review.ts             |
| `setupInputCooldown(input)`                                           | EnToZh 模式输入后 300ms 冷却期，期间禁用快捷键                                                     | quiz.ts               |
| `getRandomMeanings(meanings)`                                         | 按分号分组随机选释义 + Fisher-Yates 洗牌                                                       | quiz.ts（通过 re-export） |

使用方式：



```
// quiz.ts

const imeState = setupImeHandling(quizAnswerInput);

setupEnterSubmission(quizAnswerInput, imeState, () => { /\* 检查答案 \*/ });

setupInputCooldown(quizAnswerInput);

// review.ts

const imeState = setupImeHandling(answerInput);

setupEnterSubmission(answerInput, imeState, () => { /\* 检查答案 \*/ });

setupGlobalShortcuts('#review-quiz-container', 'review-answer', ...);
```



***

## 18. 数据安全与健壮性

### 18.1 JSON 文件原子写入

`saveWordbooks()` 和 `saveTranslationCache()` 采用先写 `.tmp` 临时文件再 `fs.renameSync` 原子替换的模式，防止断电 / 强制关闭造成文件损坏。



```
function saveWordbooks(wordbooks: Record\<string, string\[]>): void {

&#x20; try {

&#x20;   const tmp = WORDBOOKS\_FILE + '.tmp';

&#x20;   fs.writeFileSync(tmp, JSON.stringify(wordbooks, null, 2), 'utf-8');

&#x20;   fs.renameSync(tmp, WORDBOOKS\_FILE);

&#x20; } catch (e) { console.error('\[API] 保存单词本失败:', e); }

}
```

### 18.2 API 输入校验

所有 API 路由均对输入参数进行校验：



* `/api/search`：word 长度 ≤ 200 字符

* `/api/match`：prefix 长度 ≤ 100 字符，limit 范围 \[1, 100]

* `/api/system-wordbook/words`：tag 长度 ≤ 20，limit 范围 \[1, 10000]，offset ≥ 0

* `/api/system-wordbook/search`：tag 长度 ≤ 20，limit 范围 \[1, 10000]

### 18.3 edge-tts 环境检测

TTS 降级链中的 edge-tts 通过 `isEdgeTtsAvailable()` 懒检测环境是否可用（执行 `npx edge-tts --help`），不可用时自动跳过，避免依赖缺失导致崩溃。

### 18.4 数据库连接管理

`computeSystemWordbooks()` 复用 `StarDict.countByTag()` 方法，使用已有连接池，避免每次创建新连接。`StarDict` 内部通过 `getDb()` 懒加载并缓存连接。

### 18.5 错误处理

关键路径的 catch 块均记录错误日志：`saveWordbooks()`、`saveTranslationCache()`、`loadWordbooks()`、SSE 写入、`loadAnsweredWords()`、`safeParse()`、批量加载释义等。非关键路径（如 `fs.mkdirSync` 目录已存在、`fs.unlinkSync` 文件不存在）的 catch 块静默处理。



***

## 19. 模拟题模块（四六级听力 / 阅读）

模拟题是独立于单词测验的「整卷练习」模块，入口为侧边导航「模拟题」（`PageSection.Exam = 'exam'`），数据在构建期由 Python 脚本从原始题库离线生成静态 JSON，运行期由 Express 提供音频与「四级核心词」两个动态接口。

### 19.1 功能与数据规模



| 类型 | 难度      | 数量                            | 每题量                                         | 附带内容                                |
| -- | ------- | ----------------------------- | ------------------------------------------- | ----------------------------------- |
| 听力 | 仅 CET-4 | 100 套（Test\_001 \~ Test\_100） | 每套 25 题（Section A 新闻 7 + B 长对话 8 + C 短文 10） | 原声音频 wav、听力原文 transcript、参考答案、四级核心词 |
| 阅读 | CET-4   | 199 篇（源文章编号 1–199）            | 每篇 5 题                                      | 英文原文、全文中译、题目 / 选项中译、答案解析、四级核心词      |
| 阅读 | CET-6   | 200 篇（源文章编号 200–399）          | 每篇 5 题                                      | 同上                                  |

> 难度分界说明：源文件 
>
> `resource/模拟题/CET46_Complete.md`
>
>  共 399 篇且文件内不含四六级标记。统计显示编号 1–199 英文正文平均约 3.8k 字符、200–399 平均约 5.8k 字符（长约 51%），据此确定 
>
> **1–199 为四级、200–399 为六级**
>
> ，前端两个入口严格分开，不混排。
> 「文章 375」（
>
> *Carbon Nanotube Electronics: Beyond Silicon Technology*
>
> ）源文件缺文章中译，已由手工补译文件 
>
> `tools/exam/manual_zh.json`
>
>  补齐（机制见 19.3）；构建校验会列出仍缺译的篇目，前端对缺译篇兜底显示「本篇暂无文章中译」，不影响做题与判分。

### 19.2 数据文件与 JSON Schema

构建产物位于 `public/exams/`，`npm run build`（Vite）会随 `public/**` 一起拷贝到 `dist/exams/`，运行期静态目录优先读 `dist`、开发态回退 `public`。



* 阅读：`public/exams/reading/cet4.json`、`cet6.json`

* 听力：`public/exams/listening/index.json`（清单）+ `public/exams/listening/tests/Test_001.json … Test_100.json`

为控制体积，JSON 使用短键：



```
阅读外层   { level, label, count, articles: \[ article, ... ] }

article    { n, t, p: \[正文段...],

&#x20;            q: \[ { n, s, o:\[A,B,C,D], a, e, zs, zo:\[4个中译选项] } ],

&#x20;            zt, zp: \[中译段...] }

&#x20;          n=篇号 t=英文标题 p=英文正文段 q=题目 s=题干 o=选项 a=答案字母

&#x20;          e=中文解析 zs=题干中译 zo=选项中译 zt=中文标题 zp=中译正文段

听力清单   { type, label, count, tests: \[ { id, title, hasWav } ] }

听力套卷   { id, title, audio:'/api/exam/listening-audio/\<id>',

&#x20;            sections: \[ { key, name,

&#x20;                clips: \[ { name, questions: \[ { n, s, o:\[4], a } ] } ] } ],

&#x20;            transcript: \[ { heading, paras: \[...] } ],

&#x20;            hasWav }
```

阅读 JSON 为纯静态文件，**不经过** API 信封；听力套卷同样为静态 JSON，仅音频与核心词走动态接口。

### 19.3 数据构建脚本（tools/exam/，离线运行）



* `tools/exam/build_reading.py`：解析 `CET46_Complete.md`（`## 文章 N. 标题` 分篇），按 199/200 切分，输出 `cet4.json` / `cet6.json`，并校验每篇题量、答案、翻译完整性。构建时额外做两件事：

1. **正文内嵌注释清洗**：源 md 英文正文里有大量 `单词（中文释义）` 行内注释。脚本加载 `resource/lemma.en.txt`（WordNet 风格词形还原，约 18.3 万条）与四级词书 `public/wordbooks/cet4-beidanci/index.json`（48 课合并约 4499 个原形），把被注释词小写后经词形还原得到词干，凡命中四级词表且非功能停用词的，删除其紧跟的中文括号注释、保留英文单词（如 `compounds（化合物）that` → `compounds that`；删除时若括号后紧跟英文字母会自动补一个空格，防止两侧单词粘连）；超纲专业术语的注释保留（如 `amphipods（端足类动物）`、`enzymes（酶）`），全英文括号缩写（如 `infrastructure (V2I)`）因不含汉字天然不匹配、原样保留。题干 / 选项 / 中文翻译不在清洗范围。当前统计：删除四级词注释 1011 处、保留超纲注释 3205 处。

2. **手工补译注入**：读取 `tools/exam/manual_zh.json`（结构 `{ "<篇号>": { "zt": 中标题, "zp": [中译段...] } }`），把源文件缺译篇目的中译注入产物；今后再有缺译篇按同格式增补即可，重建不丢失。

* `tools/exam/build_listening.py`：遍历 `CET4_Listening_Bank/Test_xxx/`，解析 `questions_and_answers.md`（题干 `**N. stem**`、选项 `- A) ..`、答案 `- **Answer: X**`，忽略末尾 Answer Key 表）与 `transcript.md`（按 `###` 分块），输出清单与 100 个套卷 JSON；`strip_md()` 会剥离原文中的 Markdown 粗体星号（如 `**Directions:**`）。构建结束打印套数、含音频数与校验异常数（当前为 100 套 / 100 含音频 / 0 异常）。

原始音频 `complete_test.wav`（每套约 66MB，合计约 6.6GB）**不拷贝、不打包**，只在原目录由后端按需读取。

### 19.4 后端路由（electron/api/exam.ts）

`setupExamRoutes(app)` 在 `electron/api/routes.ts` 中挂载（位于 JSON 解析中间件之后），共三个接口，统一返回 `successResponse({ success:true, data })` 信封：



1. `GET /api/exam/listening-status`

   扫描 100 套 wav 是否就位，返回 `{ total, available, ids }`，结果做模块级缓存；前端据此在列表标记「含音频 / 无音频」。

2. `GET /api/exam/listening-audio/:id`

   `:id` 严格校验 `^Test_\d{3}$` 防目录穿越；依次在 `[ASSETS_DIR, ROOT, ROOT/resource]` 下查找 `模拟题/CET4_Listening_Bank/<id>/complete_test.wav`，命中则以 `Content-Type: audio/wav`、`Accept-Ranges: bytes` 发送（Express 自动处理 Range 拖动）；缺失返回 404 中文 JSON。

3. `GET /api/exam/keywords?type=reading&level=cet4|cet6&n=<篇号>` 或 `?type=listening&id=Test_xxx`

   拼接全文 → 正则提词 → 停用词过滤 → `getLemmaDB().getLemma()` 词形还原 → 与四级词书 `index.json`（合并各课词形小写）求交集 → 按出现频次排序（阅读 top 24、听力 top 28）→ `getMainDb().queryBatch()` 补 StarDict 释义与音标，结果用 Map 缓存（上限 200 篇 / 套），返回 `{ keywords:[{ w, ph, mean, count }] }`。

### 19.5 前端模块（src/modules/exam.ts + exam.css）



* `initExam()` 把所有视图渲染进空容器 `#exam-page`，整页只注册**一个** click 事件委托，按 `data-action` 分发（`pick / submit / toggle-answers / toggle-translation / toggle-transcript / lookup / back-list / back-home / open-*`），避免长列表逐元素绑定造成掉帧。

* 视图状态机：`home → reading-list | listening-list → reading | listening`。


  * 首页两张卡：听力（CET-4，100 套）、阅读（下分 CET-4 199 篇 / CET-6 200 篇两个按钮）。

  * 列表为网格卡片，支持编号跳转输入与「随机一篇 / 一套」。

  * 做题页：阅读展示英文正文 + 5 题；听力展示 `audio`（`preload="none"`，不预载 66MB）+ 按 Section 分组的 25 题。音频缺失时显示橙色提示卡，题目与原文仍可练习。

* 交卷与判分（阅读、听力一致）：

1. 未答完时交卷按钮禁用并提示「还有 X 题未作答」；

2. 交卷后选项着对错色（错选红、正确答案绿），结果条显示「正确数 / 总数 + 正确率 %」（中性表述，不做夸张反馈）；

3. 出现「显示答案与解析」「显示中文翻译」（听力为「查看听力原文」）「重新做一遍」，按需展开；

4. 附加区自动请求 keywords，渲染「四级核心词」芯片（词 + 音标 + 截断释义），点击触发 `data-action=lookup` → `await switchPage(PageSection.Dictionary)` 后 `searchWord(w)`，直接跳转词典查词。

* **听力播放控制**：音频区在原生 `<audio controls>` 基础上提供 9 档倍速下拉（0.7/0.8/0.9/1.0/1.1/1.2/1.3/1.4/1.5，常量 `PLAYBACK_RATES`），答题前后均可切换，实时写 `audio.playbackRate`。**答题阶段锁进度**：`timeupdate` 记录已播放到的最大位置 `audioAllowedTime`，`seeking` 时若跳转目标偏离该位置超过 0.5s（无论前进还是回退）就弹回，保证只能顺序听；**交卷后重渲染的音频不再绑定锁**，可自由拖动、回退、重复收听，下方提示文案随交卷状态切换。`renderListening` 每次运行（换套 / 重做 / 交卷）都会把 `audioAllowedTime` 归零、`playbackRate` 复位 1.0。

* 样式 `src/assets/css/exam.css` 复用全局主题变量（`--primary-blue / --accent-green / --accent-orange / --accent-red / --box-bg / --border-color` 等），自动适配深色模式，含 768px 媒体查询；交卷条 sticky 定位。

* 接入点：`index.html` 引入 exam.css、导航新增「模拟题」、在设置页前插入 `<div id="exam-page" class="content-page">`；`enums.ts` 增加 `PageSection.Exam`；`main.ts` import 并调用 `initExam()`，学习计时的页面数组两处加入 `'exam'`。

### 19.6 接口信封约定（易错点）

前端 `src/utils/api.ts` 的 `parseResponse` **不解包**，返回完整响应体；后端信封为 `{ success, data }`。因此业务取数必须用 `res.data.xxx`。模拟题模块曾因 `loadKeywords` 取 `data.keywords`、`listening-status` 取 `st.ids`（少一层 `.data`）导致核心词误报「未匹配到」、听力全部误标无音频，已修正为 `res.data.keywords` / `res.data.ids`。后续新增接口一律按此约定。



***

## 20. 词书顺序 / 乱序与选书弹窗



* 底层 `quiz.ts` 的 `startQuiz` 对所有出题来源统一取词后，依据隐藏 `<select id="quiz-order">`（`random` / `order`）处理：`order` 保序、`random` 做 Fisher–Yates 洗牌；该 select 的 `change` 事件经 `saveQuizSettings` 持久化。

* 四级词书《英语四级你还在背单词吗》通过选书弹窗 `#book-picker-modal` 的「四级词书」标签选择：可整书全选或勾选若干课程，来源编码为 `cb:cet4-beidanci:all` 或 `cb:cet4-beidanci:U1L1,U2L3`，数据在 `public/wordbooks/cet4-beidanci/`（`manifest.json`、`index.json`、`lessons/UxLy.json` 共 48 课），按课顺序收集并去重，乱序仍由测验层洗牌。

* 弹窗 footer（仅四级词书标签显示）新增 `#bp-order-switch`，含两个 `.bp-order-opt[data-order=order|random]` 胶囊按钮。`bookPicker.ts` 中 `syncOrderSwitch()` 按 `#quiz-order` 当前值切换 `.bp-order-active`；点击时写回隐藏 select 并派发 `change` 持久化；`openPicker` 打开时回显当前选择。样式追加在 `bookpicker.css`。



***

## 21. 资源目录、打包与运维备忘

### 21.1 资源目录整理（resource/）

大型运行期资源统一收敛到 `resource/`，文档收敛到 `docs/`，可复用脚本收敛到 `tools/`：



* 模型目录 `semantic-model-files/`、`sherpa-onnx-sense-voice-zh-en-ja-ko-yue/` 移入 `resource/`（运行日志确认从新路径成功加载，命中 `resolveAssetPath` 的第三级回退 `ROOT/resource/`）。

* `resource/项目技术文档.md` 移至 `docs/项目技术文档.md`；`scripts/download_semantic_model.py` 移至 `tools/download_semantic_model.py`（已确认无引用、无本地相对路径依赖）。

* 删除：`resource/模拟题/.git`（嵌套仓库，约 785MB）、冗余旧拷贝 `static/`、`resource/tencent_api_keys_backup.csv`（敏感密钥备份）、临时脚本、空 `cache/`、空 `scripts/`，并清空 `logs/`。

* `package.json`：三条脚本移除 `cpSync('dist','static')`（运行期只读 `dist`）；`extraResources` 中 examples.db 与两个模型改为 `{ from: resource/..., to: ... }`。`.gitignore` 追加 `/resource/`、`/static/`、`/cache/`。

### 21.2 资源解析与打包白名单

`helpers.resolveAssetPath(rel)` 三级回退：`ASSETS_DIR/<rel>`（开发态 `%AppData%/拾词-dev/assets`，打包态 `%AppData%/拾词/assets`）→ `ROOT/<rel>` → `ROOT/resource/<rel>`；都不存在时返回 bundledPath 且不抛错，调用方需再 `existsSync` 判断。开发态 ROOT 为项目根，打包态为 `process.resourcesPath`。

`extraResources` 采用白名单映射，**不会**整体打包 `resource/`，因此约 6.6GB 的听力 wav 不进安装包。打包版若未安装听力资源，前端走 404 / 橙色「未检测到音频」提示，题目与原文仍可练习。后续可经 Gitee release 通道（`assets.ts` 中 `https://gitee.com/yangs-project/download/releases/download/v1.0.0`）下发资源包，解压到 ASSETS\_DIR 的同构目录 `模拟题/CET4_Listening_Bank/` 即可被 `listening-audio` 接口命中。

### 21.3 StarDict 数据库重建与「纯 node」禁忌（重要）



* `better-sqlite3` 是按 **Electron 的 ABI** 重新编译的，用系统纯 Node 直接 `node electron-dist/server.js` 会抛 `ERR_DLOPEN_FAILED`。

* `services/database.ts` 的 `isDbEmpty()` 在异常时被 try/catch 吞掉并返回 `true`，会误判库为空，进而 `buildStardictDbFromCsvs()` 先 `fs.unlinkSync()` 删除旧 `resource/stardict.db` 再重建 —— 纯 Node 下重建又因 ABI 失败，会**误删完好的词典库**，并在 `%AppData%/拾词-dev/assets/.downloads/` 留下半成品，导致启动卡在「下载必需资源 StarDict」。

* 结论：**不要用纯 Node 运行 electron-dist 代码**；启动 / 验证直接用 `Start-Process node_modules\.bin\electron.cmd -ArgumentList '.'`（分离进程，监听 `127.0.0.1:5000`，端口占用时自增）。

* 若确需重建 StarDict：杀全部项目 Electron 进程 → 删除 `%AppData%/拾词-dev/assets/.downloads` → 置 `ELECTRON_RUN_AS_NODE=1`、`ROOT_DIR` / `APP_ROOT_DIR` 为项目根、`USER_DATA_DIR=%AppData%/拾词-dev`，用 `node_modules/electron/dist/electron.exe` 运行调用已导出 `buildStardictDbFromCsvs(targetPath)` 的脚本，target 指向 `resource/stardict.db`（CSV 经第三级回退命中 `resource/stardict.csv`）。重建约 51 秒，产出 3,287,301 条、约 758MB。注意该脚本若以后台任务运行、stdout 管道无人消费会因背压阻塞，应使用 `Start-Process -RedirectStandardOutput/-RedirectStandardError` 落盘后分离运行、再轮询文件大小。

### 21.4 已知存量问题（与模拟题集成无关）



* 前端 `npx tsc --noEmit -p tsconfig.json` 存在 4 个历史报错（`bookPicker.ts` async 返回类型、`quiz.ts` 三处 answers/bookExtra 类型），Vite（esbuild）不做类型检查、不阻塞运行，未在本次改动以免蔓延。

* 核心词音标中少量为 ECDICT 重拼风格（如 `striːm`），经 `phoneticToIpa` 尽力转换，与全应用词典页一致，属数据源风格。

* 窄窗口（<768px）下固定侧边栏展开时会挤占主内容致顶部导航换行，属全站既有响应式表现（桌面宽窗与折叠侧边栏时正常）；此前主内容区整体偏右的问题已在第 22 章修复，与此窄窗口换行不是同一问题。



***

## 22. 2026-09-21 模拟题打磨与布局健壮性

### 22.1 阅读正文内嵌注释清洗

规则与统计见 19.3。判定口径刻意与后端核心词提取（`LemmaDB.getLemma`，`electron/services/database.ts`）保持一致：同一套 `resource/lemma.en.txt` 词形还原 + 四级词书交集，避免简陋后缀裁剪把 `Andes` 误判成 `and` 一类错误。清洗只作用于英文正文段（`p`），题干、选项、中译一律不动。

### 22.2 第 375 篇手工补译

新增 `tools/exam/manual_zh.json` 作为源题库缺译的人工补丁通道，构建期注入产物 JSON，不手改构建产物，因此重建不会丢失。

### 22.3 听力倍速与进度锁定

交互见 19.5「听力播放控制」。音频用原生控件，倍速是独立 `<select>`；进度锁定只依赖 `timeupdate` / `seeking` 事件，不要求音频完整下载（`preload="none"`，点播放才加载约 66MB 的 wav）。交卷后通过「重渲染且不绑定锁」解锁；重做 / 换套通过重渲染重新上锁并把速率复位为 1.0。

### 22.4 六级列表索引错位修复（真实缺陷）

`renderReadingList()` 原先给每个列表按钮写 `data-pos="${a.n - 1}"`。四级篇号 `n` 为 1–199，恰好等于数组下标 +1；但六级篇号 `n` 为 200–399，`n-1`（199–398）被当成只有 200 项的数组下标，再经 `openReading` 的 `clamp(0, length-1)`，导致点击六级列表绝大多数篇目都被夹到最后一篇。已改为 `data-pos` 输出数组下标（`f.articles.map((a, i) => ...)`），卡片上展示的编号仍用全局 `a.n`；列表「跳转」框对六级按显示篇号换算（减去该级首篇 `articles[0].n`，六级首篇为 200），输入看到的篇号即可。听力列表本就按下标，无需改。

### 22.5 主内容区偏右修复（真实缺陷）

现象：模拟题页（及其它主内容页）白色卡片整体偏右、左侧大片留白、右侧贴边。根因是 `base.css` 在 `body` 上直接用 `display:flex`，而侧边栏 `.sidebar` 本身是 `position:fixed`（并不参与 flex 排版），一旦 body 混入额外 in-flow 元素（典型如豆包内置浏览器的注入节点），主轴空间被占，`.main-content` 即被挤偏。修复：`body` 改为 `display:block`，主内容区用块级排版 + `margin-left:280px`（侧边栏折叠时为 0）自动填满右侧，对额外注入节点免疫；同时移除 `#exam-page{max-width:980px}`，使其与全站 `.content-page` 一致填满容器。

### 22.6 后台 / 最小化下页面切换卡死修复（健壮性）

`global.ts` 的 `switchPage` 与 `doWordJump` 原先 `await new Promise(r => requestAnimationFrame(r))` 等待一帧。当窗口最小化或标签页处于后台（`document.visibilityState === 'hidden'`）时 rAF 永久不触发，切换锁 `isSwitchingPage` 不复位，恢复后所有页面切换失效。新增 `nextFrame()`：rAF 与 `setTimeout(..., 120ms)` 兜底竞速，先到者放行；三处等待统一改用它，后台走定时器、前台仍跟动画帧，不影响观感。



***

## 23. 2026-09-21 答题输入区重构、辅助拼写与例句填空

### 23.1 背景与目标

旧答题页的输入框是独立的系统默认文本框，题目与输入分离、字体普通、对错反馈不够直观。本次把答题输入区整体重构，并新增两个可在答题页与设置页双向控制的开关：「例句填空」与「辅助拼写」。同时统一了四级词书 / 模拟题核心词的释义口径。全部改动前端 `npx tsc --noEmit` 0 错误、`npm run build` 通过，并逐模式真机回归。

### 23.2 答题区 DOM 结构（index.html）

题干与输入合并在一张统一卡片 `#quiz-answer-card.quiz-answer-card` 内（题目卡与输入卡原为两个独立容器，现合一；卡内元素按下述顺序）：

* `#quiz-question`：题干（释义 / 听写提示 / 例句填空卡），在合并卡内去除自身背景 / 边框 / 阴影，直接平铺在卡片上。

* `#quiz-quick-toggles`：两枚胶囊开关 `#qt-example`（拼写 / 中译英显示「例句填空」、英译中显示「显示例句」，文案由 `applyTypeArea()` 按模式切换）、`#qt-assist`（辅助拼写，仅英文输入模式可用，英译中禁用）。该行为题干与输入之间的**分隔行**（顶部 1px 分割线，开关右对齐）。

* `#quiz-type-area.quiz-type-area`：卡内嵌入式输入区（静息态浅底 `--bg-light` 无边框，`:focus-within` 时变白底 + 蓝边 + 光晕），内部含


  * 展示层 `#quiz-spelling-feedback.quiz-type-display`（逐字符着色的 `<span class="tc tc-ok|tc-bad|tc-neutral|tc-caret">`）；

  * `#quiz-type-placeholder`（占位提示，默认 `display:none`，仅 `.is-en:not(.has-value):not(.is-disabled)` 时显示——白名单式控制，保证模式切换 / 异步加载释义等任何中间态下都不会与输入框自身的 placeholder 同时出现）；

  * 透明的真实输入框 `input#quiz-answer`（英文模式铺满容器、文字透明，仅承担光标与输入；中文模式可见）。英文模式另用 `#quiz-answer::placeholder { color: transparent }` 隐藏原生大字号占位符，避免与自定义占位提示重叠。

* `#quiz-feedback`：对错文案（在合并卡之外）。

### 23.3 内嵌字体与样式（src/assets/css/quiz.css）



* 运行时由 `ensureQuizFont()`（quiz.ts）按 `import.meta.env.BASE_URL` 注入 3 个 `@font-face`，字体族名 `FredokaQuiz`（OFL，仅拉丁，500/600/700），文件在 `public/fonts/fredoka-latin-{500,600,700}-normal.woff2`，随 build 拷入 `dist/fonts`。**不要在 CSS 写死字体 URL**（vite `base='./'`）。

* 英文输入字符 `.tc` 用 FredokaQuiz 700 / 36px；`.tc-ok` 绿、`.tc-bad` 红、`.tc-caret` 为末尾闪烁光标。

* 容器底部一条蓝色渐变长下划线（`.quiz-type-area.is-en::after`）；中文模式（`.is-zh`）显示可见的中文粗圆体输入框（PingFang / 微软雅黑栈，26px 700，自带下划线）。

* 动画：错误 `tc-shake`（轻微左右抖动）、正确 `type-pop`（微弹）、例句卡 `cloze-in`。

* 合并卡外观：`.quiz-answer-card`（quiz.css，白底 / 左侧橙色强调边 / 阴影 / 28px 内边距，768px 下 20px 16px）；毛玻璃与深色边框在 glass.css 覆盖（`--box-bg-strong`、深色 `rgba(255,255,255,.08)` 边框），`#quiz-answer-card #quiz-question` 在 glass.css 内同样去底色，复习模式的 `#review-question` 不受影响。

* 已适配深色模式（输入区静息态用 `--bg-light`、聚焦态用 `--bg-white`；`.dark-mode` 下绿 `#46d188`、红 `#ff7060`）与 768px 响应式。所有新选择器都限定在 `#quiz-answer-card / .quiz-type-area` 内，不影响复习模式独立的 `#review-answer`。

### 23.4 五种测验模式的输入形态

quiz.ts 中：



* `ENGLISH_INPUT_MODES = [Spelling, ZhToEn, Dictation, ListeningStuck]`，`isEnglishInputMode(m)` 决定是否走英文拼写形态。

* `isCharFeedbackMode(m)`：**Spelling 恒为 true**；**ZhToEn 受设置&#x20;**`assistSpelling`**&#x20;控制**；Dictation / ListeningStuck 恒为 false（听写类不着色、不自动提交，字符用 `.tc-neutral` 中性回显，必须手动 Enter）。

* EnToZh（英译中）走 `.is-zh` 中文输入形态，提交后做语义判定，以容器对错抖动 / 微弹反馈（中文近义、多表述不适合逐字符红绿，故不做逐字符）。

* `applyTypeArea()` 每题渲染时切换容器 class（`is-en/is-zh/has-value/is-disabled`、`dataset.mode`）、占位文案与胶囊显隐。除每题渲染外，`startQuiz()` 在 `showQuizAnswerArea()` 之后、`await fetchWordDefinitionsInBatches()` 批量加载释义**之前**也会先清空输入并调用一次 `applyTypeArea()`，设置页模式下拉的 `change` 监听同样直接调用它（不再手写 input.placeholder），确保加载窗口与切模瞬间输入区形态立即与新模式一致，不残留上一轮的 class / 占位文案。

### 23.5 逐字符红绿算法与自动提交

`updateSpellingFeedback()` 维护一个 `wrong` 计数：逐位比较输入与目标候选，某位不匹配则 `wrong++`，该位及其后所有字符一律 `.tc-bad`；此前正确前缀为 `.tc-ok`，末尾补 `.tc-caret`。候选目标取「以当前输入为前缀」的 `[word, ...answers]`，兼容英美拼写 / 屈折变体（如输入 `appale` 时 `app` 绿、`ale` 红；`appa` 第 4 字符红）。仅在 `isCharFeedbackMode` 下，完整匹配任一候选后延迟 220ms 自动提交（`scheduleSpellingAutoSubmit`）；听写类不自动提交。

### 23.6 例句填空



* 设置项 `showExampleInQuiz`（默认 false）。开启后，Spelling / ZhToEn 把例句中的目标词挖成下划线（不显示中译），EnToZh 显示完整例句；句子题不显示。

* `pickBookExample()`：词书词优先用 `bookExtra.ex`（书中例句），其次 `bookExtra.real`（四级真题例句）；非词书词在答题 / 显示答案时异步请求 `GET /api/examples?word=<w>`（Tatoeba 例句库，返回 `{success,data:[{text,translation}]}`）兜底。

* `buildTargetRegex()` 匹配目标词及常见屈折后缀（s/es/ies/ied/ed/d/ing/er/est），**不挖** ly/ment/tion 等派生词，避免误伤；`maskExample()` 先 token 替换再 `escapeHtml`，挖空处渲染为 `<span class="cloze-blank" style="--blen:N">`。

* `currentClozeExample / clozeSeq` 用于防止异步返回串题；答对后 `showAnswer()` 复用同一句揭示完整句 + 中译（词书词走 `buildBookExtraHtml` 展示完整 ex/real）。

### 23.7 两个设置项与设置页生命周期（含一处真实缺陷修复）



* 类型 `src/types/setting.d.ts`、默认值 `src/store/index.ts`（`showExampleInQuiz:false`、`assistSpelling:true`）；store 是响应式 proxy，写 `appState.settings` 即自动持久化到 localStorage `quizSettings`。

* 答题页胶囊 `change` 即时改 `appState.settings` 并 `syncSettingCheckbox()` 同步设置页勾选态；设置页复选框通过「保存设置」收集。

* **真实缺陷**：本轮发现 `src/modules/settings.ts` 此前完全没有这两个字段的 UI 回填 / 保存收集 / 清空重置，导致设置页复选框回填恒为默认（与实际 localStorage 不符）。已在 `loadSettings()`（元素回填）、`saveSettings()`（读取写回）、`clearAllData()`（重置为 false /true）三处补齐。`loadSettings()` 开头本就是 `Object.assign(settings,{默认..., ...parsed})` 整体合并，数据恢复无需改，缺的只是 UI 三处。

### 23.8 胶囊按模式显隐

`applyTypeArea()` 中按模式控制两枚胶囊：例句填空胶囊在 Spelling / ZhToEn / EnToZh 显示（这三种有例句，EnToZh 显示完整句），听写 / 听力卡壳隐藏；辅助拼写胶囊仅在 Spelling / ZhToEn 显示，其余模式隐藏（该开关对它们无意义）。

### 23.9 核心词精简释义口径（electron/api/exam.ts）

新增 `getCet4Book()`：读取 `public/wordbooks/cet4-beidanci/index.json`（key 为 `UxLy`）+ 逐课 `lessons/UxLy.json`，在内存聚合小写词 → `{ph, mean}` 的 Map（懒加载缓存）。`mean` 取词性前 2 条、过滤释义仅为符号的脏数据（如 million 的 `{p:'num',d:'&'}`，规则为「释义必须含汉字或字母」），拼成「词性。释义」去重、中文分号连接。`extractKeywords()` 改为**词书 Map 命中优先用词书 mean/ph，缺词回退 StarDict&#x20;**`queryBatch`；点击核心词跳转词典仍展示 ECDict 完整释义。词书练习的释义由 `src/utils/structuredBook.ts` 的 `toQuizWord` 保证（meanings=pos、phonetic=ph、answers=ans、bookExtra={mem,ex,real,der,gn}），批量补释义只挑无释义词，词书词不被 ECDict 覆盖。

### 23.10 不做 ECDict 物理融合的决策

运行时「词书优先 / ECDict 兜底」已满足三处口径（词书练习用词书释义、模拟题核心词精简释义用词书、跳查词用 ECDict）。不把词书释义物理写回 758MB 的 `stardict.db`：物理融合会污染全局查词完整度、可逆性差、构建重。若后续确需离线全局替换，再单独评估迁移脚本与备份。

### 23.11 验证记录（[localhost](https://localhost) 真机）



* 中译英（词书 U1L1）：正确前缀全绿、首错位起全红、错误前缀全红；完整正确 220ms 自动提交；答案页展示词书音标 / 全部释义 / 记忆法 / 书中例句完整句 + 中译 / 派生词（均超链接）。

* 拼写模式：即使关闭辅助拼写仍恒定红绿（本职即拼写）；中译英关闭辅助后为中性色、不自动提交，开关即时持久化。

* 听写：输入中性色、不红绿、不自动提交，Enter 手动提交判错并保留输入。

* 英译中：中文粗圆体输入 + 下划线，Enter 语义判定通过。

* 例句填空：挖空 / 答对揭示 / 英译中完整句 / 非词书词 `/api/examples` 兜底均正常。

* 设置页两复选框回填、保存、持久化、清空重置全部修复并验证；深色模式输入区配色可读。

* 回归：词典英查 / 词形 / 同义形近链接 / 例句（22 链接）/ 句子翻译 / 查词历史、单词本管理、收藏空态、错题本、复习模式（`#review-answer` 样式未受影响）、模拟题入口（听力 100 套、阅读 199+200）、控制台 0 错误 / 警告。

### 23.12 词典联想与中文查词排序修复（真实缺陷）

回归中发现两处基础检索排序问题，均在 `electron/services/database.ts`：



* 现象：输入前缀 `aban`，前 15 条是 `abandoned` 加一堆生僻词 / 西语词（abana、abancay、abandonar…），基础词 `abandon` 排到第 57 位；中文搜「放弃」首屏是 `abandees`、`abanding` 等变形，`abandon` 沉底。

* 根因一（`matchWithSort`）：考试标签分 `tagPriority = 10 - pri` 后整体按升序，导致**无标签词（0）反而排在四级词（cet4=6）前面**，方向取反；同时 SQL 先 `ORDER BY word ... LIMIT 500` 再在 JS 排序，高产前缀（app /uni/the 候选数千）的常用词按字母序落在 500 条之外被直接截断。

* 根因二：ECDict 的 `frq=0` 表示无语料数据，原逻辑只把 `NULL` 排末尾（`frq ASC` / `frq IS NULL`），`frq=0` 被当成「最常用」排到最前。

* 修复：

1. **两段取候选**—— 前缀范围内的「高质量词」（`tag 非空 OR collins>0 OR frq>0`）全部取出，再按字母序补 400 条兜底精确短词 / 生僻词，合并按 id 去重；高质量集合实测每个前缀仅约 110 条，无性能压力。

2. 排序键改为 `[词组优先, 用户所选类别, 有无考试标签(有=0), 最基础考试层级(pri 越小越常用), -collins, 有效 frq(0/NULL→999999)]`，同键再按字母序 `localeCompare` 兜底，结果确定。

3. `searchByChinese` 的 SQL `ORDER BY` 同步改为「有效 frq（0/NULL 映射 999999）→ collins 降序 → 有无 tag → 词长」。

* 验证（真实接口）：`aban`→abandon / abandoned / abandonment；`app`→apple / appear / apply / appearance / appeal…；`uni`→university / unit / universe / union / unique / uniform…；`the`→they /their/there /them/then…；中文「放弃」→release /abandon/desert /quit/yield /render…。前端联想下拉 `/api/match` 与中文查词 `/api/search-chinese` 无需改动即生效。

### 23.13 在线服务连通性核查



* 翻译降级链（`electron/services/translate.ts`）：腾讯云 TMT（可透传用户密钥）→ 有道公共网页接口 → MyMemory，全失败再用本地词典逐词兜底。发音降级链（`electron/services/tts.ts`）：有道 dictvoice → 百度 /edge-tts → 腾讯云 TTS。

* 实测（2026-09-21）：有道 TTS、百度 TTS 均 200 返回 `audio/mpeg`；有道翻译页、MyMemory、腾讯云 TMT 网关均可达（腾讯云空 POST 返回 `MissingParameter` 标准鉴权响应，证明端点 / TLS 连通）；应用 `POST /api/translate` 英→中、中→英端到端均成功（非缓存、非词典命中，译文准确）；`GET /api/audio/us|uk/<word>` 端到端返回音频；`GET /api/network/test` 返回 `online:true`。edge-tts 走 WebSocket，对其域名根路径发普通 HTTP 超时属正常，不代表不可用。
## 24. 2026-09-22 词书派生词开关与主题切换重构

### 24.1 背景与目标

两项改造：①《英语四级 · 你还在背单词吗》每个主词带「扩（派生词）」，需要一个设置开关，开启后把派生词也作为独立词条、紧跟主词练习；②旧主题切换动画为页面大量元素各建 fixed 遮罩并各自跑 clip-path，触发强制同步布局，掉帧明显，重构为 View Transitions 单伪元素圆形揭示。

### 24.2 词书数据口径（权威数字）

* 共 48 课；主词跨课去重 **4499**。`manifest.totalCount=4502` 是各课词条「不去重」之和，多出的 3 个为原书跨模块复现词：`march`（U4L2 + U11L4）、`carbon`（U8L2 + U11L1）、`may`（U11L4 课内出现两次）。练习 / 进度 / 选择器统一按去重实际题量展示，`totalCount` 不再面向用户。
* 派生词（课 JSON 的 `der` /「扩」）共 **1528**，与主词 0 重叠、跨课 0 重复。
* 开关开启后实际题量 = 4499 + 1528 = **6027**；U1L1 = 54 主词 + 45 派生 = 99；U1 四课含派生共 364。
* 新增 `public/wordbooks/cet4-beidanci/der.json`，结构 `{lessonId:[derWord,...]}`，仅用于书选择器 / 词源下拉的计数；练习时的展开直接读课 JSON 的 `der` 详情，不依赖 der.json 的释义内容。

### 24.3 数据类型与持久化

* `SettingsData` 新增 `includeDerivations: boolean`（默认 `false`）；`store` 默认值、`loadSettings` 合并、`saveSettings` 收集、`clearAllData` 重置四处同步覆盖；经 store proxy 持久化到 localStorage 的 `quizSettings`。
* 设置页 `index.html` 新增 `data-setting-key="book-derivations"` 开关（`#include-derivations`），文案写明「去重后 4499 主词 + 1528 派生词 = 共 6027 词」。
* `QuizWordData.bookExtra` 与 `structuredBook.BookExtra/BookWord` 新增 `derivedFrom?: string`（来源主词词形）。

### 24.4 练习展开（structuredBook.ts）

* 新增 `loadDerIndex() / getDerIndexSync() / ensureDerIndexLoaded()`（fetch `${BOOK_URL}/der.json`），`warmupStructuredBook` 预热索引。
* `collectBookWords(value, includeDer=false)`：主词跨课去重后，把每个主词的派生词紧跟其后插入（全局去重、主词优先、派生词带 `derivedFrom`）。
* `getSourceWordListSync(value, includeDer=false)`：计数同步拼派生词；索引未就绪时先返回主词并异步 `loadDerIndex`。
* `toQuizWord` 透传 `derivedFrom`。
* `quiz.ts` 的开始测验与 `hydrateSessionWords`（中断续答）两处都传 `!!appState.settings.includeDerivations`；`wordbook.ts` 的 `getSourceWordList` 同步传开关，`updateWordSourceSelect` 开头 `await loadDerIndex()`。

### 24.5 派生词词条与详解卡片

* 派生词 BookWord：`mem:''`、`ex/real:null`、`der:[]`、`ans:[w]`，`ph/pos` 取词书 `der` 字段，`g/gn` 继承自主词，`derivedFrom` = 主词词形。
* 练习释义用词书 `der.pos`（精简）；派生词无书例句时，quiz 详解卡片自动走 `GET /api/examples?word=` 兜底（返回英文例句 + 中文翻译）。
* `buildBookExtraHtml` 在卡片顶部插入 `.be-derived-from` 块：「🔗 派生词 / 自主词 `<a class="quiz-clickable-word" onclick="g('jumpToWord','<主词>')">` 派生，结合词根对照记忆」，样式追加在 `quiz.css` 末尾。
* 释义口径不变：词书练习与模拟题「四级核心词」的精简释义用词书，点击跳词典展示 ECDict 完整释义（运行时词书优先、ECDict 兜底，不物理改写词典库，见 23.9 / 23.10）。

### 24.6 书选择器计数（bookPicker.ts）

* `openPicker` 经 `ensureDerIndexLoaded()` 加载索引；`derEnabled()` 读 `settings.includeDerivations`；`derCountFor(lessonId)` 取该课派生词数。
* `statsForLessons` 在与「已练」相同的 seen 去重口径下计入派生词；课行 meta、单元汇总、整本标题 / 描述 / footer 在开关开启时统一显示「含派生词」后的去重总数（整本 6027、U1 364、U1L1 99），关闭时恢复主词数。
* footer 文案合并为「共 N 词（含派生词，已练 X）」，避免两个括号连用。

### 24.7 主题切换 View Transitions 重构

* 旧实现掉帧根因：为页面每个 `.navbar/.sidebar/.word-card/button/input/a` 各创建一个 fixed `__theme_overlay` div 并各自跑 clip-path circle，且每个元素两次 `getBoundingClientRect/getComputedStyle`（强制同步布局 / 重排），再叠加 `#theme-mask` 全屏扩散与元素错峰变色；元素越多越卡。
* 新实现（`global.ts`）：删除 `AnimItem/THEME_SELECTORS/collectAnimItems/createThemeOverlays` 整套；`toggleTheme(event?)` 改用 `document.startViewTransition(cb)`，回调内只做 `isDarkMode` 翻转 + localStorage + `applyTheme()`；在 `transition.ready` 后对 `document.documentElement` 单次 `animate(clipPath: circle(0 at x y) → circle(maxR at x y), {duration:520, easing:cubic-bezier(0.22,1,0.36,1), pseudoElement:'::view-transition-new(root)'})`，单伪元素 GPU 合成圆形揭示，零 DOM 遮罩、零布局读取。圆心优先事件坐标，其次主题按钮中心，兜底右上角；`maxR=hypot(max(x,W-x),max(y,H-y))`。
* 降级：`prefers-reduced-motion` 或无 `startViewTransition` 时直接 `applyTheme()` + 200ms opacity 淡入；后台标签（`document.hidden`）下浏览器跳过快照（`ready` reject `InvalidStateError`），但回调仍执行完成换肤，`.catch` 吞掉中止错误，无弹窗、无卡死。
* 防连点双保险：`data-animating`（可见窗口动画期间锁定）+ 模块级时间戳 480ms 节流（不依赖动画 promise，覆盖动画被 skip / 降级 / 后台标签等场景）。
* `theme.css`：去掉 `#theme-mask` 的 `will-change`，删除文件尾三层 `.theme-ripple`、`ripple-expand`、`theme-content-shift` 等死规则，替换为 `::view-transition-old/new(root){animation:none;mix-blend-mode:normal}` + z-index + reduced-motion 媒体查询。
* `gsap.ts`：删除无调用方的 `animateThemeSwitchContent / animateThemeSwitch` 两个死函数（`getGsapCore/loadGsap/forceRepaint` 保留）。
* `wordbook.css`：`#export-options`、`#import-result` 的 `transition: all .6s` 收窄为 `background-color/border-color/box-shadow .3s`，缩小过渡属性面。

### 24.8 验证记录

* `npx tsc --noEmit` 0 错误；`npm run build` 成功；构建产物与 `der.json` 已同步到 `static/`（含清理旧 hash assets）。
* 派生词数据经离线脚本核对：4499 / 1528 / 6027、派生词与主词 0 重叠、跨课 0 重复、U1L1 展开 99 且顺序为 `space(主) → spacious(派生) → spatial(派生) → universe …`，派生词严格紧跟主词。
* 真机（localhost）：开关默认关、勾选保存后 reload 仍开启（持久化）；书选择器整本显示 6027（含派生词）、U1 364、U1L1 99；顺序 + 中译英第 1 题 `space`（主词卡片含记忆法 / 2020 真题 / 派生词块）、第 2 题 `spacious`（词书释义 adj.宽敞的；无书例句时走 `/api/examples` 兜底且含中文；卡片 `.be-derived-from` 含可点的自主词 `space`）、第 3 题 `spatial`。
* 主题：深 ↔ 浅切换 `html.dark-mode` 与 localStorage 正确、`[id^=__theme_overlay]` 数量为 0、`#theme-mask display:none`、测验 / 卡片在深色下配色正常；控制台无 View Transition / JS 报错（仅有既有的发音资源 404 与 `Audio NotSupportedError`，属离线发音 / TTS 配置问题，与本轮无关）。
* 限制：自动化测试浏览器标签处于后台（`visibilityState=hidden`），Chromium 对不可见页面会中止 View Transition 快照（已验证此时降级路径换肤正确、不报错）；圆形揭示的可见播放基于标准 API（Electron 28 = Chromium 120，原生支持 View Transitions）与官方圆形揭示写法，主进程 `BrowserWindow` 默认 `show:true`，用户真实可见窗口走正常动画路径。


## 25. 2026-09-22 选词书弹窗派生词开关、暂无例句占位、拼写模式改跟练模式

### 25.1 背景与目标

三项前端改造：①「词书附带练习派生词」开关此前只在设置页，需要在选词书弹窗内也能切换并实时看到计数变化；②答题时勾选了例句开关、但该词确实没有任何例句时，题目下方留空白，需要明确占位「暂无例句」；③原「拼写模式」与「中译英」交互过于接近，改造为**跟练模式**——输入区先铺一层高透明度的完整正确拼写（ghost 描红），用户照着逐字母跟打，输对的字母逐位实化变绿、输错标红轻抖，拼完整词自动判对。

### 25.2 选词书弹窗内的派生词开关（bookPicker.ts / bookpicker.css）

* `renderCetTab()` 的 `.bp-book-head` 模板在 `.bp-book-desc` 之后新增 `<label class="bp-der-toggle"><input type="checkbox" id="bp-der-toggle">`，勾选态由 `derEnabled()`（读 `settings.includeDerivations`）回填，副文案写明「全本 4499 主词 + 1528 派生词 = 6027 词，派生词紧跟对应主词」。
* change 处理：直接赋 `appState.settings.includeDerivations = checked`（store 深层 proxy 的 set trap 会经 `PERSISTENCE_MAP['quizSettings']` 自动持久化，无需手写 localStorage），同步设置页 `#include-derivations.checked`，随后 `renderCetTab()` + `updateFooter()` 实时重算整本 / 单元 / 每课计数。`renderCetTab` 每次重建 DOM 并重新绑定，开关状态在重渲染后由 `derEnabled()` 保持。
* 与设置页开关**双向同步**：任一处切换都写同一份 settings；reload 后两处都从 localStorage 回填。
* `bookpicker.css` 新增 `.bp-der-toggle / .bp-der-toggle-label / .bp-der-sub`（虚线边框卡片、hover 变主色蓝、16px accent-blue 复选框），复用 `--box-bg / --border-color / --text-gray / --radius-sm` 变量，深浅色自适应。

### 25.3 暂无例句占位（quiz.ts / quiz.css）

* 新增 `renderClozeEmpty()`：`removeCloze()` 后在 `#quiz-question` 追加 `.cloze-card.cloze-empty`，内容为「📝 例句」标题 + `<p class="cloze-en cloze-empty-text">暂无例句</p>`。
* `setupClozeForCurrent()` 的在线兜底分支（词书无 `be` 时走 `GET /api/examples?word=`）：把返回值规整为 `usable = data.filter(e => e.text?.trim())`；`usable.length>0` 才随机取句 `renderCloze`，否则 `renderClozeEmpty()`；`.catch` 在竞态序号（`clozeSeq` / `currentQuizWord`）仍匹配时也渲染占位。词书自带例句（`be` 存在）路径不变。
* `renderCloze()` 健壮性：`maskExample` 在要求挖空却没匹配到目标词时（`doMask && !r.matched`），降级为**完整展示**该例句（重新 `maskExample(en, wd, false)`），不再 `return` 留白；「· 补全划线单词」提示仅在 `reallyMasked`（确实挖空）时出现。
* 既有规则不变：句子 / 短语（`isSentence`）不挂例句卡；关闭例句开关 `removeCloze()` 一并移除占位卡。
* CSS：`.cloze-empty` 虚线边框、透明底；`.cloze-empty-text` 灰色斜体 14.5px；深色下透明底 + `rgba(255,255,255,.14)` 虚线边。

### 25.4 拼写模式 → 跟练模式（ghost 描红）

* **枚举值不变**：`QuizMode.Spelling = 'spelling'` 保留，避免破坏 localStorage 已存的 `quizMode`；仅把用户可见文案全部改为「跟练模式」（测验模式下拉 `<option>`、题面、输入占位、设置页例句说明、使用引导 `<li>`、README）。
* 题面（Spelling 分支）改为「跟练模式：看着下方浅色的完整拼写逐字母跟打，输对的字母会变清晰」，下方仍给中文释义与 🔊 发音。
* `updateSpellingFeedback()` 在原有红绿反馈基础上新增跟练分支：
  * 跟练（`m===Spelling`）：`L=max(target.length, value.length)`，逐位渲染——已输入位按对错给 `.tc-ok`（绿）/`.tc-bad`（红），**未输入位渲染 `.tc-ghost`**（完整目标词的浅色描红）；`.tc-caret` 光标插在 `value.length` 分界处（输入超长时追加在末尾）。ghost 与实字同为 `.tc`（Fredoka 36px / 700 / 相同字距），仅 `opacity` 不同（浅色 `.18`、深色 `.28`），在 flex 流中逐位天然对齐。
  * 中译英（else 分支）维持原逻辑：只回显已输入字符的红绿前缀，不铺 ghost。
  * 完整匹配候选后仍由 `scheduleSpellingAutoSubmit`（220ms）自动判对；错误位新增时整行轻抖（`pulseTypeArea(false)`）逻辑不变。
* **初始铺底**：`renderQuestion()` 末尾在 `applyTypeArea() / setupClozeForCurrent()` 之后新增一次 `updateSpellingFeedback()`，使新题在未输入时就铺出完整 ghost（旧版只在 input 事件时刷新，初始字符层为空）。
* **答案揭晓态收起 ghost**：`showAnswer()` 原本在 `applyTypeArea()/updateSpellingFeedback()` **之后**才置 `isWaitingForNextQuestion=true`，导致等待下一题时字符层仍按作答态铺着 ghost、与上方刚揭晓的正确答案重复。现把 `isWaitingForNextQuestion=true` 提前到刷新字符层之前；`updateSpellingFeedback()` 据此给输入区加 `.is-waiting` class，跟练分支在等待态不再渲染未输入位 ghost（value 已清空，只剩句首光标）。
* 占位提示配合：`.quiz-type-area.is-en[data-mode="spelling"]:not(.is-waiting) .quiz-type-placeholder{display:none}`（与原 is-en 占位规则同特异性、定义更晚而生效），作答中由 ghost 充当提示、隐藏居中占位文字；等待态 `.is-waiting` 时该隐藏规则不匹配，恢复显示 showAnswer 设定的「输入答案巩固一下，按 Enter 进入下一题」。
* **快捷胶囊**：跟练自带完整拼写提示，隐藏「辅助拼写」胶囊（`applyTypeArea` 中 `#qt-assist` 仅在 `ZhToEn` 显示），「例句填空」胶囊保留。顺带修正既有缺陷：旧代码 `qtEx.style.display / qtAs.style.display` 只隐藏胶囊内的 `<input>`，外层 `<label>` 文字仍残留；现统一改为 `qtEx/qtAs.closest('label').style.display`，隐藏 / 显示作用于整枚胶囊（听写 / 听力卡壳 / 跟练下两枚胶囊的显隐随之正确）。

### 25.5 改动文件

* `index.html`：模式下拉 `<option>`、设置页例句说明、使用引导两条 `<li>` 文案。
* `src/modules/quiz.ts`：Spelling 题面与占位文案、`applyTypeArea` 胶囊显隐（整 label + 跟练隐藏辅助拼写）、`renderQuestion` 末尾初始刷新、`updateSpellingFeedback` 跟练 ghost 分支与 `.is-waiting`、`showAnswer` 状态赋值提前、新增 `renderClozeEmpty`、`renderCloze` 降级完整展示、`setupClozeForCurrent` 空 / 失败占位。
* `src/assets/css/quiz.css`：`.tc-ghost`（含深色）、跟练作答中隐藏占位、`.cloze-empty / .cloze-empty-text`（含深色）。
* `src/modules/bookPicker.ts`：`#bp-der-toggle` 模板与 change 双向同步 / 重算。
* `src/assets/css/bookpicker.css`：`.bp-der-toggle*` 样式。

### 25.6 验证记录

* `npx tsc --noEmit` 0 错误；`npm run build` 成功；新 hash 产物（`index-*.js / index-*.css / index.html`）已同步到 `static/` 并删除旧 hash。
* 真机（localhost）回归：
  * 书选择器四级词书 tab 默认无派生词开关勾选、整本 4499 / U1L1 54；勾选后整本「6027（含派生词）」、U1L1 99，设置页 `#include-derivations` 同步勾选、localStorage `quizSettings.includeDerivations=true`；取消恢复 4499 / 54 且持久化为 false；选 U1L1 确认后来源按钮显示「四级词书·U1 L1」。
  * 跟练模式：新题未输入即铺浅色完整拼写（单词与含空格短语均正确，如 `as much as` 10 个 ghost 位）+ 句首光标；输入正确前缀逐位变绿（`be no` → 5 个 ok）、错误位标红（`be nx` → 4 ok / 1 bad）；完整正确自动判对（「回答正确！」），500ms 后答案揭晓态收起 ghost（`.is-waiting`、ghost=0、恢复巩固提示）；真实 Enter 进入下一题后重新铺 ghost、进度推进。
  * 中译英：不铺 ghost、辅助拼写胶囊回归显示、红绿前缀与原生占位正常；英译中：中文输入区（`.is-zh`、字符层 `display:none`、输入框深色可见文字）、例句胶囊文案为「显示例句」、辅助拼写胶囊整枚隐藏。
  * 暂无例句：拦截 `/api/examples` 返回空数组时，单词题（如 `dishonestly`）渲染虚线「📝 例句 / 暂无例句」卡；句子 / 短语按既有逻辑不挂卡；有词书 / 在线例句时仍正常挖空或完整展示。
  * 深色模式：ghost 为浅色 `rgb(224,224,224)` @ `.28` 透明度，描红清晰但不抢眼；暂无卡、书选择器开关使用主题变量，配色正常。
* 控制台无新增报错（仅既有的离线发音资源 404 / `Audio NotSupportedError`，与本轮无关）。

### 25.7 限制与说明

* 跟练 ghost 直接展示完整答案，定位是「记新词 / 描红」，不考查回忆；需要主动回忆应使用中译英（可关辅助拼写）或听写。
* 自动化浏览器为窄视口后台标签，顶部导航在窄宽度下会折行挤压，属响应式表现，与标准 Electron 窗口无关；本轮未改动导航布局。

## 26. 2026-09-22 学习计时口径收紧、模拟题完成标绿、交卷后单词隐藏链接、设置项拆分、拖拽变暗加固

### 26.1 背景与目标

五个前端问题：①学习时长在非练习状态（查词、设置、浏览词表、停在测验 / 模拟题配置页未开始）也累计；②模拟题做过并交卷后，列表序号圆圈没有完成标记；③交卷后阅读文章 / 听力原文的单词不能直接查词，需把全篇单词做成隐藏式超链接——默认与正文同外观，悬浮高光并弹出随鼠标移动的小提示框，页面上也给出操作提示；④设置页「答题时显示例句」嵌套在「中译英辅助拼写」项内导致缩进，需拆成独立项；⑤快捷键设置卡片随机整体变暗 / 变透明，根因是拖拽排序的 `.is-dragging{opacity:.25}` 在拖拽中断时未复位。

### 26.2 学习计时口径收紧（timer.ts / main.ts）

* 计时器仍由 onPageEnter / onPageLeave 控制 start / stop，但启动白名单由 `quiz / wordbook / favorites / errorbook / exam` 收紧为 `quiz / review / exam`；wordbook（单词本管理）、favorites（收藏列表）、errorbook（错题列表）不再启动计时。
* tick 内新增 `isPracticing()` 闸门，每秒实时判定，即使计时器在运行，非练习态也不累加：
  * quiz 页：`#quiz-progress` 进度条可见（已开始测验；配置页进度条 `display:none`）；
  * review 页：`#review-progress` 可见（已开始复习）；
  * exam 页：存在 `.ex-practice`（做题页 / 交卷复习；首页与题库列表无此元素）。
* 空闲 60s 暂停、页面 hidden 停止的机制不变；`onVisibilityChange` 恢复可见时的重启白名单同步为 `quiz / review / exam`。
* 口径：仅在测验、复习、模拟题做题 / 交卷复习期间计时；查词、设置、单词本管理、浏览收藏 / 错题、停在配置页未开始均不计时。

### 26.3 模拟题完成态与序号标绿（exam.ts / exam.css）

* 新增 localStorage `examCompleted`（`Record<string,boolean>`），经 `loadCompleted / isCompleted / markCompleted` 读写；key 规则：阅读 `reading:{level}:{n}`、听力 `listening:{id}`。
* `submit()` 成功交卷时按当前篇 / 套 markCompleted；重新做一遍（retry）不清除标记（交过即算完成）。
* `renderReadingList / renderListeningList` 渲染序号 `.ex-list-no` 时，已完成追加 `.ex-list-done`；CSS 把圆圈改为绿色实心（浅色 `var(--accent-green)` 白字、深色 `#2ecc71` 深色字）。

### 26.4 交卷后单词隐藏链接与随鼠标提示（exam.ts / exam.css）

* 新增 `linkifyEnglish(text)`：用正则 `([A-Za-z][A-Za-z'’\-]*)` 切分正文，单词包成 `<a class="ex-word" data-action="lookup-word" data-word="...">`，标点 / 空白原样转义，撇号统一规整为 ASCII。
* 阅读 `.ex-passage-p`：仅 `submitted` 后 linkify，未交卷保持纯文本；听力 `transcriptBlockHtml` 原文本就交卷后才展示，直接 linkify；中文翻译块不处理。
* `.ex-word` 默认继承正文颜色、无下划线（隐藏式），`:hover` 浅色背景高光 + 主色字；点击走新增 action `lookup-word`（与 `lookup` 同处理：切词典页并 searchWord）。
* 随鼠标 tooltip：模块级 `#ex-word-tip`（fixed、pointer-events:none、深色小卡片），在 exam 容器 `mousemove` 事件委托里，目标为 `.ex-word` 时显示「点击查看「{word}」的详细释义」并按 clientX / Y 定位（带视口边界翻转），移出 / 离开隐藏。
* 页面静态提示：交卷后正文标题下、听力原文标题下各加一条 `.ex-word-hint`「💡 提示：将鼠标移到……单词上，该词会高光，点击即可查看它的详细释义」。

### 26.5 设置项拆分（index.html）

* 把原 `quiz-assist` 项内嵌套的 `#show-example-in-quiz`（`label.setting-sub-label`）与 `.setting-sub-desc` 移出，在其后新建独立 `.setting-item.setting-item-toggle[data-setting-key="show-example"]`，使用标准 label 与 `.setting-desc`，复选框与其他项左对齐。
* settings.ts 对复选框的加载 / 保存按 id 绑定（与父容器无关），拆分后 id 不变、功能不受影响；排序持久化自然纳入新 key。

### 26.6 拖拽变暗加固（settings.ts）

* 新增模块函数 `cleanupDragRemnants()`：扫描移除所有 `.setting-item.is-dragging` 与 `.drag-ghost`。
* `initSortableContainers` 内一次性绑定三重兜底（`_dragSafetyBound`）：
  * document 捕获阶段 pointerup：下一帧若 `drag===null`（正常 endDrag 已复位）再扫描兜底，清除任何残留半透明卡片；
  * keydown Escape：拖拽中则置 drag=null 并清理；
  * window blur（切窗口 / 弹窗中断）：结束拖拽并清理。
* 正常 endDrag 路径不变；兜底在正常情况下扫描为空、无副作用。

### 26.7 改动文件

* `src/modules/timer.ts`：isPracticing、tick 闸门、visibility 白名单。
* `src/main.ts`：onPageEnter / Leave 计时白名单。
* `src/modules/exam.ts`：完成态读写与序号标绿、linkifyEnglish、正文 / 原文链接、tooltip 元素与事件、lookup-word action。
* `src/assets/css/exam.css`：`.ex-list-done / .ex-word / .ex-word-hint / .ex-word-tip`（含深色）。
* `index.html`：例句开关拆独立项。
* `src/modules/settings.ts`：cleanupDragRemnants 与三重兜底绑定。

### 26.8 验证记录

* `npx tsc --noEmit` 0 错误；`npm run build` 成功；新 hash（css `index-DnB0xCCw.css`、main `index-DuKWaeQP.js`、vendor `index-a9woYdh8.js`）dist / static hash 一致。
* 真机（localhost）回归：
  * 设置页停留 5s 计时不增；quiz 配置页（进度条隐藏）停留不增；exam 首页 / 列表不增；
  * 阅读做题页计时连续增长（32 → 37s），交卷后复习仍计；
  * 阅读第 1 篇交卷：正文 179 个 `.ex-word`、提示条、tooltip 就位；hover「new / in」时 tooltip 文字与坐标随鼠标更新；点击「unknown」跳词典并查词；回列表第 1 篇序号绿圈；
  * 听力第 1 套：25 题交卷，原文 2092 个 `.ex-word` + 提示；回列表 001 序号绿；
  * 设置项：例句开关独立成项、复选框与其他项左对齐；
  * 拖拽：pointerdown 进入 is-dragging（opacity .25）后按 Esc / window blur 均复位（dragging=false、ghost=0）；
  * 深色模式：序号亮绿、链接 hover、提示条配色正常。

### 26.9 限制与说明

* 「哪些状态算学习」按严格口径实现（仅测验 / 复习 / 模拟题做题与交卷复习）；若希望把浏览词表 / 查词也计入，需调整 isPracticing 与白名单。
* 交卷后复习（看答案 / 翻译 / 原文 / 核心词）计入学习时间；重新做一遍不取消完成标记。
* 自动化浏览器在滚动 / 浮层截图上偶有不更新（工具局限），相关视觉以 DOM 状态与确定性 CSS 为准。


## 27. 2026-09-23 派生词详解去重、巩固占位、单元排序、测验配置保留与个数联动、启动回词典、英译中逐义项纠错

### 27.1 问题清单

用户在使用中提出五处前端问题：

1. 开启「词书附带练习派生词」后，答对 / 显示答案的详解区仍重复列出该主词的派生词列表；这些派生词已作为独立词条练习，属于重复信息。关闭派生词练习时则应保留列表。
2. 提交 / 显示答案进入等待态后，输入框 placeholder 仍显示「请输入答案…」，应提示用户可再次输入巩固。
3. 选词书弹窗四级词书 tab 的单元顺序错乱：Unit 1 之后直接是 Unit 10（数据按字符串序，"U10" 字典序先于 "U2"）。
4. 测验配置（来源 / 模式 / 个数 / 顺序）切页再回来应保留；测验个数与设置中「每日学习单词数」双向联动；每次启动程序始终回词典首页，不恢复上次页面。
5. 英译中（EnToZh）提交错误时，按「中文释义」粒度标色：正确释义绿、错误释义红（区别于中译英的逐字符红绿）；用户一旦修改即恢复默认，再次提交错误重复标色。

### 27.2 派生词练习时详解区去重

`src/modules/quiz.ts` `buildBookExtraHtml()` 中派生词列表的渲染条件由：

```ts
if (be.der && be.der.length > 0) {
```

改为：

```ts
if (be.der && be.der.length > 0 && !appState.settings.includeDerivations) {
```

* 开启派生词练习（includeDerivations=true）时不渲染「🔗 派生词」列表，避免与紧跟主词练习的派生词重复。
* 关闭时条件等价原条件，行为不变。
* 上方 `be.derivedFrom` 区块（派生词回看「自主词 X 派生」的提示）不受影响，仍正常显示。

### 27.3 答案揭晓后巩固占位

`applyTypeArea()` 中占位文案按等待态分支：

```ts
const waiting = !!appState.isWaitingForNextQuestion;
if (ph) ph.textContent = waiting ? '输入答案巩固一下，按 Enter 进入下一题' : placeholderForMode(m);
input.placeholder = waiting ? '可以再次输入巩固一下哦，按 Enter 进入下一题' : inputPlaceholderForMode(m);
```

此前 `showAnswer()` 末尾设置的巩固占位会被随后的 `applyTypeArea()` 用模式默认文案覆盖，是问题根因；现统一在 `applyTypeArea()` 内按等待态生成，中文模式原生 placeholder 与英文模式自定义占位均一致。

### 27.4 选词书单元数字排序

`src/modules/bookPicker.ts` `renderCetTab()` 渲染前对每个 part 的 units 按编号排序：

```ts
const unitNum = (u: any): number => {
    const mm = /(\d+)/.exec(u.name || '');
    if (mm) return parseInt(mm[1]);
    return (u.lessons && u.lessons.length) ? Math.min(...u.lessons.map((l: any) => l.idx)) : 9999;
};
const unitsHtml = part.units.slice().sort((a: any, b: any) => unitNum(a) - unitNum(b)).map(unit => { ... });
```

课程（lesson）本就用 `compareLessonId` 数字排序，本次补齐单元层级。实测顺序 Unit 1 → Unit 12，U10 位于 U9 与 U11 之间。

### 27.5 测验配置保留、个数联动与启动页

* **配置保留**：quiz-mode / word-source / quiz-count / quiz-order 均在 `saveQuizSettings()` 写入 `appState.settings`，由 store 自动持久化到 localStorage `quizSettings`，`loadSettings()` 回填；切页（DOM 常驻）与重启均恢复上次选择。
* **个数 ↔ 每日学习数双向联动**：
  * `saveQuizSettings()` 读取 quiz-count，有效正值同时写入 `settings.quizCount` 与 `settings.dailyWordCount`。
  * quiz-count 新增 `change` 监听（失焦 / 回车确认）调用 `updateTomorrowWords()`，刷新侧边栏「明日学习单词数」。
  * `startQuiz()` 开始时把本次个数写回 `quizCount` 与 `dailyWordCount`，与 `updateTomorrowWords()` 既有「dailyWordCount → quiz-count」回填形成双向闭环。
  * 实测个数填 7 并开始后，侧边栏明日学习单词数同步为 7；重启后仍为该值。
* **启动始终回词典首页**：删除 `src/main.ts` 初始化中恢复 `appState.lastVisitedPage` 的代码段（原第 20 步），并移除因此不再使用的 `PageSection` import。`global.ts` 仍记录 lastVisitedPage，但启动不再使用。实测重启后 dictionary-page 可见、quiz-page 隐藏（lastVisitedPage 仍为 "quiz" 但不恢复）。

### 27.6 英译中逐义项红绿纠错

* `src/utils/quizHelper.ts`：
  * `CheckAnswerResult` 新增可选字段 `zhCorrect?: string[]`、`zhWrong?: string[]`。
  * EnToZh 单词分支复用既有的「正确释义集合拆分（meanings.definition 按 ；;，, 拆）+ 用户输入拆分（按 ，,；;\s 拆）+ `meaningMatch` 匹配」结果，把命中 / 未命中的用户释义片段随结果返回；该结果反映字符串匹配口径，独立于全错时的语义相似度兜底（兜底只影响最终 isCorrect）。
* `src/modules/quiz.ts`：
  * `checkAnswer()` 的部分正确与完全错误分支，在 EnToZh 且非句子时调用新增的 `renderZhCheck(zhCorrect, zhWrong)`。
  * `renderZhCheck()` 用捕获分隔符的 split 还原用户原始输入，逐释义片段着色：命中正确集合加 `.tc-ok`（绿）、未命中加 `.tc-bad`（红）、分隔符用 `.tc-zh-sep`（中性灰），并给输入区加 `.zh-checking`。
  * 用户修改触发 input → `updateSpellingFeedback()`：开头移除 `.zh-checking`，中文分支清空展示层，原生输入恢复可见；再次提交错误重新渲染。
* `src/assets/css/quiz.css`：
  * 新增 `.zh-checking` 态：中文模式下展示层恢复显示（flex），原生 input 改为绝对定位、文字透明，与展示层位置重合，caret 保留蓝色；新增 `.tc-zh`（中文圆体粗体，字号 24px）与 `.tc-zh-sep`，含深色模式适配。
* 实测输入「格式，香蕉」提交（partial）：「格式」绿、「，」中性、「香蕉」红；修改即清除；再输入「格式，西瓜」提交重复「格式」绿、「西瓜」红。

### 27.7 改动文件

| 文件 | 改动 |
|---|---|
| src/modules/quiz.ts | 派生词列表条件、等待态占位、renderZhCheck、checkAnswer 两处调用、updateSpellingFeedback 清除纠错态、startQuiz 个数写回、quiz-count change 联动、import |
| src/utils/quizHelper.ts | CheckAnswerResult 加 zhCorrect/zhWrong 并在 EnToZh 分支返回 |
| src/modules/bookPicker.ts | renderCetTab 单元数字排序 |
| src/modules/settings.ts | saveQuizSettings 中 quizCount 同步 dailyWordCount |
| src/main.ts | 删除启动页面恢复、移除 PageSection import |
| src/assets/css/quiz.css | zh-checking 态、tc-zh / tc-zh-sep 样式 |

### 27.8 验证记录

* `npx tsc --noEmit`：0 错误（初次因 result 类型被初始字面量收窄报错，已显式标注 `CheckAnswerResult`）。
* `npm run build`：成功；产物 index-Dj5U143H.js（268.61kb）、index-BEOn8R8d.css（128.43kb）、index-a9woYdh8.js（vendor 未变）。
* 真机（localhost:5000）逐项回归：① 开派生 probable 详解仅记忆法 / 例句、无派生词列表；② 等待态 placeholder 为巩固提示；③ 单元 U1→U12；④ 切页配置保留、个数 7 联动侧边栏、重启进词典；⑤ 英译中逐义项红绿 / 修改恢复 / 再错重复。
* static 同步：dist/assets 与 static/assets 三个文件 hash 全部一致，dist/index.html 与 static/index.html hash 一致，旧 hash 已清理。

### 27.9 限制与说明

* 中文释义红绿与判分同为字符串「相等 / 包含覆盖率」口径（`meaningMatch`），用户用近义表述但字面不命中时会标红；语义相似度模型只在全错时兜底改判 isCorrect，不改变红绿片段。
* 派生词「关闭」路径为原始布尔分支（条件 && !false），行为与历史版本一致。
* 真机快进会把途经词计入该来源「已练」，重新从首词开始需用「重新测验该单词本」清除已练记录（属程序既有设计）。


## 28. 2026-09-23 中文释义逐片段独立判定、英译中辅助拼写、判红错位修复

### 28.1 问题清单

1. 英译中输入多个中文释义时正确释义漏判：测 probably 输入「香蕉；或许」，「或许」本是正确释义却与「香蕉」一起判红（单独输入「或许」则判对）。
2. 英译中也要显示「辅助拼写」开关（此前该胶囊仅中译英显示），并更新设置项中辅助拼写的口径文案。
3. 判红后展示层红绿文字与原生输入框 / 光标错位：蓝色 caret 在文字中位置偏移（截图约偏 20px）。

### 28.2 根因

1. EnToZh 单词判分的正确释义集合只来自题对象 `meanings`；词书 probably 的释义为「几乎肯定；很可能；大概」，**不含「或许」**。语义相似度兜底只在「全错」时用**整段** userAnswer 比对，多释义（香蕉 + 或许）整段被「香蕉」拖累判不相似；红绿渲染只反映字符串匹配结果，与最终判分（含语义兜底）口径不一致。
2. `applyTypeArea()` 中辅助拼写胶囊 `#qt-assist` 仅在 ZhToEn 显示。
3. zh-checking 态展示层用 flex + `gap:4px 2px`，span 间插入 gap，且展示层与原生 input 的 font-family / weight / letter-spacing / line-height 未统一，字符位置逐片段累积偏移；flex 垂直居中与 input baseline 也不一致。

### 28.3 修复

**（1）ECDict 附加释义并入判分**

* `QuizWordData`（src/utils/quizSession.ts）新增 `extraMeanings?: string[]`。
* `startQuiz()`（src/modules/quiz.ts）对结构化词书来源，批量调 `/api/words/batch` 拉取 ECDict `translation`，经新增的 `splitEcdictTranslation()` 清洗（去除 adv./n./v. 等词性标签，按 ；;，,、、/ 拆分，去重）后挂到词对象 `extraMeanings`。显示 / 详解仍用词书释义，仅判分并入。
* `checkQuizAnswer()`（src/utils/quizHelper.ts）新增可选参数 `extraCorrectMeanings?: string[]`，EnToZh 单词分支把它并入正确释义集合；`checkAnswer()` 调用时传入 `currentQuizWord.extraMeanings`。
* ECDict probably 的 translation 含「或许」，并入后「或许」字面命中，无需依赖整段语义兜底。

**（2）逐片段红绿重构 + 英译中辅助拼写**

* 原 checkQuizAnswer 内局部 `meaningMatch` 提取为导出函数 `zhMeaningMatch()`，判分与红绿共用同一口径。
* 新增 `collectCorrectMeanings(wd)`（词书 meanings + extraMeanings 去重）与 `buildZhFeedbackHtml(value, wd, live)`：捕获分隔符还原原始输入，逐释义片段着色。
  * `renderZhCheck()`（提交态，live=false）：最后片段也判定。
  * `renderZhLive()`（辅助拼写实时，live=true）：最后一个仍在输入、后面无分隔符的片段视为进行中（中性），避免未打完就标红。
* `applyTypeArea()` 辅助拼写胶囊在 ZhToEn **或 EnToZh** 显示；`updateSpellingFeedback()` 中文分支在辅助拼写开启且非 IME 组字时调 `renderZhLive()` 实时标色。
* 新增模块级 `zhComposing` 标志（initQuiz 中 compositionstart/end 监听），组字期间不重渲染。
* 设置页「中译英辅助拼写」改为通用「辅助拼写」，描述分别说明中译英逐字符、英译中逐释义的标色。

**（3）错位修复**

zh-checking 态展示层由 flex 改为 block、去除 gap，span 为 inline；展示层与原生 input 完全统一 font-family / font-size / font-weight / letter-spacing / line-height / padding，使每个字符位置与透明 input 重合，caret 紧贴文字。

### 28.4 改动文件

| 文件 | 改动 |
|---|---|
| src/utils/quizSession.ts | QuizWordData 加 extraMeanings |
| src/utils/quizHelper.ts | 导出 zhMeaningMatch / splitEcdictTranslation，checkQuizAnswer 加 extraCorrectMeanings 并并入 |
| src/modules/quiz.ts | startQuiz 拉 ECDict 附加释义、checkAnswer 传参、collectCorrectMeanings/buildZhFeedbackHtml/renderZhCheck/renderZhLive、辅助拼写 EnToZh 显示与实时标色、zhComposing |
| src/assets/css/quiz.css | zh-checking 改 block 对齐、display/input 字体统一 |
| index.html | 设置项辅助拼写文案通用化 |

### 28.5 验证记录

* `npx tsc --noEmit`：0 错误（初次因 WordData 缺 extraMeanings 报错，已对 find 结果 cast 为 QuizWordData；并补回一次替换中误删的 data.forEach 行）。
* `npm run build`：成功；产物 index-Bxpv-Azy.js（267.34kb）、index-CDhCqBx1.css（131.75kb）、index-a9woYdh8.js。
* 真机（U10L1 开派生，快进到 probably，第 45 题）：
  * 实时辅助：输入「香蕉；」→ 香蕉红、；中性；补成「香蕉；或许」→ 香蕉红、或许（在输）中性。
  * Enter 提交：香蕉红、或许绿，反馈「对了一部分哦，再检查检查」（partial）。
  * 截图：caret 紧贴「或许」末尾，与展示文字对齐（对比修复前偏移约 20px）。
  * 深色模式红绿清晰。
* static 同步：dist/assets 与 static/assets 三文件 hash 一致，index.html hash 一致，旧 hash 已清理。

### 28.6 限制与说明

* extraMeanings 只覆盖 ECDict 已收录的同义说法；若 ECDict 也未收录的近义表述，仍依赖全错时的整段语义兜底，多释义场景下该片段仍可能漏判。
* 实时辅助的词边界靠用户输入分隔符（，,；;）界定；最后片段在输入分隔符前不判色。
* 中文释义红绿与判分同为 zhMeaningMatch「相等 / 包含覆盖率」口径，单字义项不做子串宽松匹配。

## 29. 2026-09-23 多释义逐片段调用语义模型、逐义项单独比对、展示层与判分口径统一

### 29.1 需求

英译中（EnToZh）输入多个中文释义片段时，对**用户输入的每个中文释义片段都独立调用语义相似度模型逐个判别**，再按结果显示红绿；不接受只在全错时对整段做兜底。

### 29.2 根因

1. 第 28 章的语义兜底只在「全错」时把**整段** userAnswer 与 `allCorrectMeanings.join('，')` 比对。把同一个词的**多个不同义项 join 成一串**会互相干扰：实测 text1=「超棒的」，text2=「极好的，了不起的，怪诞的，幻想的，异想天开的」→ `isSimilar=false`；而 text2=「极好的，了不起的」→ `true`。多释义（一错一对）时整段还会被错词拖累。
2. 展示层 `buildZhFeedbackHtml` 只按字面 `zhMeaningMatch` 重新判红绿，与 `checkQuizAnswer` 的语义判分结果脱节：语义判对的片段在展示层仍标红。

### 29.3 修复

**（1）逐片段 + 逐义项语义判分**（src/utils/quizHelper.ts）

EnToZh 单词分支改为：先把词书 meanings 与 ECDict `extraMeanings` 合并为 `allCorrectMeanings`；用户答案按 `，,；;` 与空白拆成片段，对每个片段：

1. 先字面 `zhMeaningMatch`，命中即 correct；
2. 未命中且开启语义模型时，与 `allCorrectMeanings` 中**每个义项单独** POST `/api/semantic-similarity`，任一 `isSimilar` 即该片段 correct（`break`）；模型抛错则 `break`，不再对剩余义项逐个等超时。

全部片段串行判定（不并发），避免压垮本地 sherpa-onnx 模型。

**（2）判别等待反馈**（src/modules/quiz.ts）

`checkAnswer()` 在 `await checkQuizAnswer` 前把 feedback 置为「正在判别答案…」，模型逐义项推理较慢时用户有明确反馈，不会误以为卡死。

**（3）展示层与判分口径统一**（src/modules/quiz.ts）

* `buildZhFeedbackHtml(value, wd, live, verdictCorrect?)` 新增可选参数：提交态（live=false）传入 `checkQuizAnswer.zhCorrect`（含语义判对片段），片段 `ok = 字面命中 || verdictSet.has(t)`；实时态（live=true）不传，仍仅按字面，保证输入流畅。
* `renderZhCheck(verdict?)` 接收判分结果并下传；partial / wrong 两处调用改为 `renderZhCheck(result)`。
* 用户修改输入仍走 input → `renderZhLive()`，颜色恢复默认，再次提交才重新逐义项判别。

### 29.4 改动文件

| 文件 | 改动 |
|---|---|
| src/utils/quizHelper.ts | EnToZh 单词分支逐片段：字面 → 逐义项【单独】语义比对，任一相似即该片段正确，模型抛错 break |
| src/modules/quiz.ts | checkAnswer 加「正在判别答案…」；buildZhFeedbackHtml 加 verdictCorrect 参数；renderZhCheck(verdict) 并在 partial/wrong 传 result |

### 29.5 验证记录

* 逐义项单独比对实测（text1=超棒的）：vs「极好的」=true、vs「怪诞的」=true、vs「了不起的 / 幻想的 / 异想天开的」=false；五义项 join 整串=false、「极好的，了不起的」=true。
* 确定性单元测试（临时把 checkQuizAnswer 暴露到 `window.__zh`，不经过 UI、不污染已练记录）：fantastic meanings=[{adj 极好的；了不起的；怪诞的}]、extra=[幻想的,异想天开的]，输入「香蕉；超棒的」→ `{isPartial:true, zhCorrect:["超棒的"], zhWrong:["香蕉"]}`。
* 真机 UI（localhost:5000，U10L1，automotive 第 14 题）：输入「香蕉；汽车相关的」提交 → 香蕉红、汽车相关的绿，反馈「对了一部分哦，再检查检查」（partial），展示层与判分一致。
* `npx tsc --noEmit`：0 错误；`npm run build`：成功，主产物 index-Cc1YZlXt.js、index-CDhCqBx1.css、vendor index-a9woYdh8.js；bundle 内确认无 ZHCHK/__zh 等临时残留。
* static 同步：dist/assets 与 static/assets 三文件 hash 一致，dist/index.html 与 static/index.html 引用一致，第 28 章旧 hash index-Bxpv-Azy.js 已清理。

### 29.6 限制与说明

* 语义模型不可用（接口报错 / 60s 超时）时，未命中片段按红处理，不永久转圈（catch `break` + 分级超时）。
* 逐义项语义调用次数 = 未命中片段数 × 义项数（命中即 `break`）；本地模型热身后单次约 3–7s，错误片段需遍历全部义项，多义项词提交后有可感知等待，已用「正在判别答案…」提示。
* 实时辅助拼写（renderZhLive）仍仅按字面标色、不逐字调模型，以保证输入跟手；语义逐义项判别只在提交时进行。
* 真机测验流程中每次提交 / 揭晓都会把该词计入来源「已练」，重新从首词开始需用「重新测验该单词本」清除（既有设计）；故本轮确定性验证主要通过 window 暴露的单元测试完成，UI 仅做一次代表性回归。

***

## 30. 有道发音预下载脚本（tools/download_pronunciations.py）

### 30.1 背景与定位

* 程序在线发音链路：前端 `src/utils/audio.ts` 请求 `/api/audio/:accent/*`，后端 `tts.ts` 优先取有道 `https://dict.youdao.com/dictvoice?type={0=美,1=英}&audio=<word>`，未命中再走百度 / Edge / 腾讯降级。离线使用或安装包分发需要预先把发音落盘。
* Electron 内置的 `electron/services/pronunciation-downloader.ts` 只遍历主词典、并发仅 2，且依赖应用运行。为支持「长时间、可中断、可重跑」的批量预下载，新增**独立 Python 脚本** `tools/download_pronunciations.py`：**仅用标准库（urllib / sqlite3 / threading），零第三方依赖**，命令行直接运行。

### 30.2 词全集与范围（scope）

脚本自动收集、合并、去重以下来源（含中文的词头剔除）：

1. `resource/stardict.db` 表 `stardict` 的 `word` 列；
2. 四级词书 `public/wordbooks/cet4-beidanci/` 的 `index.json`（主词）+ `der.json`（派生词）。

阅读 / 听力模拟题的「核心词」就是四级词书（见 19.4 keywords 接口），不另产生新词。四级词书中的同形异义标注 `bow¹` / `bow²` 在收集时去掉 Unicode 上标、还原为 `bow`。

| `--scope` | 含义 | 去重后词数（约） |
|---|---|---|
| `cet4` | 仅《英语四级你还在背单词吗》主词 + 派生 | 6,027 |
| `exam` | stardict 中带任意考试标签（tag 非空）∪ 四级词书 | 3.8 万 |
| `common`（默认） | 带标签 / collins 星级 / 有词频的常用词 ∪ 四级词书 | 5.3 万 |
| `all` | stardict 全部 ∪ 四级词书 | 328.7 万 |

`--accent` 取 `us` / `uk` / `both`，**默认 `both`**（英美音各下一份 `_us.mp3` / `_uk.mp3`，与应用内「美式发音 / 英式发音」两个按钮对应）；`both` 时任务数（词 × 口音）翻倍。

### 30.3 功能点

* **多线程**：`--workers` 个工作线程从共享游标抢任务（默认 4）。
* **请求间隔**：仅对**真正发起网络请求**的任务（新下 / 失败重试）sleep `--interval × (0.7~1.3)` 随机抖动（默认 0.2s），降低限流概率；判为「已存在」的跳过项只做内存索引查找、不发请求也不空等。
* **断点续传 / 自动去重**：启动时用 `os.scandir` **一次性扫描输出目录**建立内存索引（键为完整文件名 `{word}_{accent}.mp3`，仅收录普通文件且体积 >100 字节；Windows 下 `DirEntry.stat(follow_symlinks=False)` 复用目录枚举缓存元数据，不打开文件），之后每个任务只做一次集合查找——5.6 万文件扫描约 0.06s、10.6 万次命中判断约 0.04s。新下载成功的文件名即时加入索引，同一词同一口音只下一次。早期版本逐任务 `getsize + open 读头`，几万次文件打开（叠加 Windows Defender 扫描）耗时数十秒，已废弃。
* **失败重试与限流冷却**：单词级 `--retries` 次重试、退避递增；线程连续 3 次网络错误 / 429 / 5xx 时设置全局冷却（2/4/8/16/32/60s 递增），所有 worker 在 `maybe_pause()` 处等待。
* **音频校验 + 原子写**：拒绝 `{` 开头的 JSON 错误与 ≤100 字节数据，要求 `ID3` 头或 MP3 帧同步（`0xFFE0`）；先写 `.tmp.<线程id>` 再 `os.replace`，避免半截文件。
* **进度与退出**：独立线程每 0.5s 刷新「完成 / 百分比 / 新下 / 已存在 / 失败 / 速率 / 预计剩余」；Ctrl+C 置停止位，worker 在下个循环退出。
* **失败清单**：最终失败项写入 `pronunciations/failed.txt`（每行 `word|accent`），`--retry-failed` 只重下这些项；同时写 `download_state.json` 记录本次口径与计数。

### 30.4 落点与命中

* 默认输出到项目根 `pronunciations/`，文件名严格复刻 `normalizeWordForFilename`：`{word}_{us|uk}.mp3`（`\\/:*?<>|` → `_`、`&` → `_and_`，保留空格与撇号）。
* dev 下 `helpers.findPronunciationFile()` 第二回退路径即 `ROOT_DIR/pronunciations/`（ROOT_DIR dev = 项目根），故下载后无需移动即可被发音接口命中；打包分发时再按 21.2 的资源通道处理。

### 30.5 验证记录

* `--scope cet4 --accent us --limit 6`：成功下载 AIDS / April / August / Bible / Biblical / Celsius 共 6 个 MP3（6–29KB，ID3 / 帧头正常）。
* 同命令重跑：6 个全部判「已存在」、新下 0，断点续传与去重生效。
* 错词 `cigarettete`（词书当时的拼写错误，后已修复，见第 31 章）：有道返回 HTTP 500，重试后正确进入失败清单，不产生伪音频；词组 `air conditioner`、`according to`：有道可合成（ID3，约 40KB），可正常下载。
* 2026-09-25：`--accent` 默认改为 `both`；skip 项去掉空等。实测 `--accent uk --limit 12`：9 个正常词（AIDS / April / Bible / Biblical / Celsius / Christ / Christian / Christianity / Christmas）下载成功（10–31KB，帧头正常），`'twixt` / `'zine` 等有道无音频的生僻词按预期进失败清单；直接拉取 apple / banana / sunny / beautiful 英音均有效。
* 2026-09-25（二改）：skip 判断改为 scandir 内存索引。实测目录内 56,137 个 mp3 扫描建索引 0.06s，common 全集 105,980 个任务（52,990 词 × 英美）的命中判断 0.042s（命中 56,137，待下 49,843）；真实脚本 `--limit 8` 中 4 个 skip 零耗时，耗时仅来自 2 个无音频生僻词的网络重试。

### 30.6 限制与说明

* **不建议 `--scope all`**：328.7 万中约 323 万是无标签 / 无词频的生僻词、专有名词与长词组，有道大多无发音（返回 500 / JSON），全量还需数十 GB 存储与十几天时长；备考场景 `common`（约 5.3 万）或 `cet4`（约 6 千）即可覆盖。
* 脚本不修改任何程序源码或词书数据。四级词书 U11L2 的拼写错误 `cigarettete`（应为 cigarette）已在第 31 章修复。
* 常用命令：
  * `python tools/download_pronunciations.py`（默认 common + 英美音，断点重跑可随时执行）
  * `python tools/download_pronunciations.py --accent uk`（只补下英音）
  * `python tools/download_pronunciations.py --retry-failed`

***

## 31. 四级词书 cigarette 拼写修复

### 31.1 问题

* 原书 U11L2 词条为 `cigaret(te)`（cigaret / cigarette 两种拼写，标准为 cigarette）。早期从 PDF / CSV 构建 JSON 时被错误展开为 `cigarettete`，它不是合法英文，有道发音对其返回 HTTP 500。

### 31.2 修正

* `index.json`：U11L2 索引第 17 项 `cigarettete` → `cigarette`。
* `lessons/U11L2.json`：词条 `w` 改为 `cigarette`；`ans` 由 `["cigarettete","cigarette"]` 改为 `["cigarette","cigaret"]`（标准词 + 美式变体，两种拼写提交均判对）。音标 `ˌsɪgəˈret`、释义 `n.香烟；纸烟，卷烟` 原本正确，未改动。
* 只改字符串值、不增删词条，总条数三处仍一致（index 条目数 / `manifest.totalCount` / 各课 words 合计 = 4502）。

### 31.3 现状补充（以重新现算为准）

* 修复后 index 共 4502 条、去重 4501；唯一重复是 `carbon`（跨 U8L2 与 U11L1，原书跨课复现，非本次引入）；`march`、`may` 在 index 中已只出现一次。

### 31.4 真机验证

* `npm run build` 后用 robocopy `/MIR` 把 dist 镜像同步到 static。
* 脱离 Electron GUI 起后端：better-sqlite3 按 Electron ABI 编译，系统 node 直接跑会 `ERR_DLOPEN_FAILED`；改用 Electron 二进制的纯 node 模式——设 `ELECTRON_RUN_AS_NODE=1` 与 `ROOT_DIR / APP_ROOT_DIR / USER_DATA_DIR / CACHE_DIR`，执行 `node_modules/electron/dist/electron.exe electron-dist/server.js`（首次会在用户目录从 stardict.csv 导入约 328 万条，属一次性初始化，之后启动直接复用）。
* 浏览器真机：选四级词书 → 仅勾 U11L2、取消派生词、顺序、中文→英文，前进到第 17 词（题目「n.卷烟」）：
  * 输入错误 `cigarete` → 「回答错误，请再试一次」，留题不前进；
  * 输入变体 `cigaret` → 判对，展示标准词 cigarette 的音标 / 释义 / 例句；
  * 输入标准 `cigarette` → 判对。

### 31.5 限制

* 未改任何判题逻辑代码，仅修正数据。`carbon` 的跨课重复是否保留属既有设计，本次未处理。

***

## 32. 测验来源持久化、选书标签记忆、自动续测

### 32.1 需求

* ① 单词测验的「单词来源」记住并显示用户上次的选择（上次是四级词书，重开后来源按钮仍显示四级词书）。
* ② 打开选书弹窗时记住上次退出时所在的标签（上次在「四级词书」，下次直接停在该标签即可勾课，无需先切标签）。
* ③ 测验中途直接退出程序 / 关机（未点「结束测验」）也自动保存进度，可从中断处继续。
* 边界：应用启动仍按既有设计落在词典首页，本次持久化的是来源 / 标签 / 进度等**数据层**，与导航落点不冲突。

### 32.2 来源持久化（`wordbook.ts / updateWordSourceSelect`）

* 现状：来源值本就由 `saveQuizSettings` 写入 `appState.settings.wordSource`（store 自动持久化到 `quizSettings`）。但四级词书的 `cb:` 选项是在弹窗「确定」时动态创建的——冷启动 `loadSettings` 试图把 select 设回 `cb:` 时该 option 尚不存在，设置失败（`selectedIndex=-1`）；随后重建又以这个已丢失的 `select.value` 为准，导致重开后来源退回 / 显示「未选择」。
* 修复：重建时补回 `cb:` 选项的候选，除当前 `select.value` 外再纳入持久化的 `appState.settings.wordSource`；恢复选中时若当前值无对应 option，回退到 `appState.settings.wordSource`。

### 32.3 选书标签记忆（`bookPicker.ts`）

* 新增 `bookPickerLastTab`：两个标签点击时写入。
* `openPicker` 先按当前来源决定初始标签（`cb:`→cet4，否则 mine），再以持久化的 lastTab 覆盖；lastTab 为空时按来源推断。
* 效果：标签记忆独立于当前来源——用户在某标签查看后未改来源就关闭，下次仍停在该标签。

### 32.4 自动续测（`quiz.ts`）

* `startQuiz` 创建 session 后即置 `interrupted=true` 并保存（「全部完成」的空 session 路径仍由结果页 `endSessionComplete` 置 false，不受影响）。
* `commitCurrentAnswer` 在 `markAnswered`（currentIndex++）后，当仍有未做题（`currentIndex < words.length`）时自动 `saveSessionState`。
* 自然完成由 `showQuizResult → endSessionComplete` 置 `interrupted=false`；续测恢复复用既有 `continueQuiz`（`hydrateSessionWords` 重新补全词书释义，按保存的词序恢复，随机顺序也一致）。
* 已知边界：最后一题判完但未点「下一题」就关机时，最后一次自动保存的索引是 `length-1`，续测重做最后一题，不产生异常空状态。

### 32.5 并发重建加固（`wordbook.ts`）

* 问题：快速进入 / 重复触发时并发多个 `updateWordSourceSelect`，旧调用请求系统词库列表时被新调用 abort，原逻辑对 AbortError 直接 `return`，可能整条重建放弃、select 停留静态选项 / 「未选择」。
* 修复：新增运行序号 `sourceSelectRunSeq`，写 DOM 前若 `myRun !== sourceSelectRunSeq` 则交出返回；系统词库请求被 abort 不再致命，继续用已有 / 空 counts 重建（`cb:` 选项至少补回）。

### 32.6 真机验证

* `npm run build` + robocopy `/MIR` 同步 static；Electron 纯 node 模式起 server（见 31.4）。
* 选四级词书 U1L1（顺序、中文→英文），答对第 1 题 space 后直接 reload：
  * 重进测验页：来源按钮显示「四级词书·U1 L1」、select 选中 `cb:cet4-beidanci:U1L1`（①）；
  * 弹窗标签：切「我的词库」后取消、重开停 mine，切「四级词书」后重开停 cet4（②，双向，与来源无关）；
  * 点「继续上一轮答题」：从第 2 题 universe（currentIndex=1）准确继续、进度 2/54（③）。

### 32.7 限制

* 未改判题逻辑；续测对非词书来源沿用既有恢复路径。
* 来源按钮在重建的异步窗口内理论上仍可能短暂先显示旧值；并发加固已消除「停留未选择」的失败态。

## 33. 数据备份、可访问性、自动化测试与分发（2026-10-02）

### 33.1 学习数据导出 / 导入与磁盘自动备份

数据归属：核心学习数据（favorites / errorbook / learningHistory / studyStats / quizAnsweredWords / quizSettings / searchHistory 等）保存在 localStorage；自定义单词本的磁盘真相在 `<ROOT_DIR>/wordbooks.json`（原子写），localStorage 中的 wordbooks 仅为缓存。

- 前端 `src/utils/backup.ts`：
  - `collectBackupData()` 遍历 localStorage 全键，仅排除可重建缓存 `systemWordbookWordsCache`，打包 `{app:'pick-up-words', version:1, exportedAt, data}`。
  - `exportBackupManually()` 手动导出 `拾词备份_YYYY-MM-DD_HH-MM-SS.json`（`fileTimestamp`，与后端自动备份同名格式）；`parseBackup()` 校验备份信封。
  - `initAutoBackup()`：`notifyActivity()` 活动时节流 60s，`beforeunload` 用 `navigator.sendBeacon`（失败回退 `fetch keepalive`）落盘；`backupNow()` 立即写。
  - 恢复先经确认框，先 POST `/api/backup/restore` 写回 wordbooks.json，再覆盖 localStorage 然后 reload；reload 前调用 `skipAutoBackupOnNextUnload()` 避免旧页面 beforeunload 产生冗余备份。
- 接入：`main.ts` 在设置初始化后调用 `initBackupUI()` / `initAutoBackup()`；`quiz.ts` 每题提交 `notifyActivity()`、结果页 `backupNow()`。
- 后端 `electron/api/routes.ts`：`BACKUPS_DIR = USER_DATA_DIR/backups`，自动备份保留最近 10 份；文件名经 `backupReadableName()` 生成为人类可读的 `拾词备份_YYYY-MM-DD_HH-MM-SS.json`（用 `-` 替代非法字符 `:`，同秒多次备份追加 `_2/_3`）；`isBackupFile()` 同时识别新前缀 `拾词备份_` 与旧前缀 `auto-`（旧备份仍可列出 / 清理 / 下载），`safeBackupName()` 白名单允许中文（`一-龥`），下载用 `Content-Disposition; filename*=UTF-8''`。路由 `POST /api/backup/auto`、`GET /api/backup/list`、`GET /api/backup/file/:name`、`DELETE /api/backup/file/:name`、`POST /api/backup/restore`。
- 设置页 `.backup-container`：手动导出 / 导入（隐藏 file input，accept json）/ 自动备份开关（默认开）/ 备份列表（文件名、时间、大小 + 恢复 / 下载 / 删除）。

### 33.2 键盘导航与 ARIA 可访问性

- 新建 `src/utils/focusTrap.ts`：`getFocusableElements()` 按可见性过滤；`trapFocus(container, initial)` 记录原焦点、容器兜底 tabindex=-1、Tab / Shift+Tab 循环，`release()` 还原焦点。
- `global.ts`：`openModal` / `closeModal` 与 `showConfirm` / `showAlert` / `showPrompt` 均建立并释放焦点陷阱（confirm / alert 初始焦点在「是 / 知道了」，prompt 在输入框）。
- 选词书弹窗：标签补 `role=tab`、`aria-selected`、`aria-controls` 与 roving tabindex，`bookPicker.ts` 支持 ArrowLeft / Right、Home / End 切换；正文设 `role=tabpanel`。
- 发音按钮由 `<span>🔊</span>` 改为 `<button aria-label="播放发音（快捷键X）">`（quiz 三处、review 一处）。
- `base.css` 扩展 `:focus-visible`；保留 `prefers-reduced-motion` 降级。

### 33.3 自动化测试（Vitest）

- 引入 vitest + happy-dom，`vitest.config.ts` 指定 happy-dom 环境并同步 `@` 路径别名。
- 用例（4 文件 37 测试）：quizAnswer 19、quizSession 6、translation 5、backup 7。
- 命令：`npm test`（单次）/ `npm run test:watch`。

### 33.4 词典词性错位修复（abandon）

查 abandon 时仅显示一个 `n.` 标签却配中文动词义。根因：`parseMeanings` 在中文只有 1 个合并行、英文有多行时，用英文首行词性（n.）贴给整行中文。新增 `dominantDefPart()` 统计英文各词性义项数取多数（abandon v.3 > n.1 → v.），中文单行 / 英文多行时采用该词性；新增 3 个 parseMeanings 用例。

### 33.5 弹窗重入泄漏修复

快速重复触发（如连点「结束测验」）时，多个 showConfirm 互相 `remove()`，旧实例只删 DOM、Promise 不 resolve、document keydown 监听不清理。`global.ts` 为 confirm / alert / prompt 各维护活跃句柄，新建前若有实例则立即无动画销毁（移除 DOM、释放陷阱、移除 keyHandler、resolve 默认值），正常关闭仍走动画。

### 33.6 听力进度锁 seek 竞态加固

答题阶段原本只在 `seeking` 事件回弹，而拖到未缓冲位置时该事件触发时 currentTime 尚未更新，向前跳可漏过。补绑 `seeked` 事件（跳转真正完成后再判断），向前 / 回退拖动均可靠弹回到已播放最大位置；交卷后不拦截、可自由回听。真机验证：播放至 5.63s 后 seek +600 被拦回 5.63s。

### 33.7 Gitee 分发

- 仓库：https://gitee.com/yangs-project/pick-up-words ，默认分支 main。
- 仓库仅保留主程序、说明、许可证与必要资源；node_modules / dist / static / pronunciations / gitee-assets / resource / 大体积 db 不入库。
- 已发布 V2.0 Release（id 1180211），含 11 个分卷：stardict（2 卷 149MB）、semantic-model（4 卷 357MB）、sherpa-model（2 卷 147MB）、examples（3 卷 196MB）；全部经 HEAD 核对 Content-Length 与本地一致。
- 配额硬约束（Gitee 官方）：普通项目 Release 附件单文件 100MB、**单仓库附件总容量 1GB**；上述资源已占用约 850MB。
- 听力音频（8.14GB / 100 套 wav，mx5 压缩后 3.56GB / 39 个 95MB 卷）：单仓库附件 1GB 放不下，改用 4 个**如实标注**的配套公开仓库 pick-up-words-audio-1..4（各含 Release v1.0 与中文 README），按 10/10/10/9 卷分配，主 README 汇总链接。未采用"伪装成不同项目"的欺骗方式。
- 安全：远程 URL 不应内嵌访问令牌，令牌泄露后需在 Gitee 重置。

### 33.8 验证记录

- 备份：手动 / 自动备份生成、列表渲染、下载（Content-Disposition / Type 正确）、恢复（确认框焦点与 Enter、wordbooks.json 写回、reload）、删除全链路真机通过；备份含全部数据键、缓存已排除。
- 模拟题：四级阅读（序号标绿、做题、交卷判分、答案 / 翻译、核心词、交卷后单词隐藏链接与随鼠标提示、点击跳 ECDict）、六级长度（平均 4034 > 四级 2633，199+200）、听力（播放、九档速度、进度锁、交卷、原文、核心词）真机通过。
- 自动化测试 37 全绿。

## 34. 统计页、学习类别弹窗、备份可读命名、卡片随机透明修复

### 34.1 顶部新增「统计」页
- 导航在「模拟题」与「设置」之间新增 `data-section="statistics"`；`PageSection` 枚举补 `Statistics = 'statistics'`。
- 新增 `#statistics-page`：顶部 `#stat-overview`（`renderStatOverview()`，8 张概览卡）+ `#memory-dashboard`（记忆看板四图，自复习页迁入）。
- `onPageEnter` 的 `statistics` 分支同时刷新概览与看板；复习页移除看板后布局正常。

### 34.2 首次弹窗与设置页统一为「学习类别」
- 首次弹窗由 4 学段改为 11 个学习类别（与侧边栏一致），选择直接设置 `#exam-category` 并触发联动，同时按 `CATEGORY_GRADE` 映射粗粒度 `settings.grade`；跳过默认小学。
- 设置页「我的学段」改为「学习类别」`#grade-level`，同样 11 类，初始化 / 保存与侧边栏双向同步。

### 34.3 备份文件可读命名
- 后端自动备份与前端手动导出统一为 `拾词备份_YYYY-MM-DD_HH-MM-SS.json`，同秒重名追加 `_2/_3`；文件白名单允许中文；`isBackupFile()` 兼容旧 `auto-` 文件。

### 34.4 卡片随机「少一块 / 更透明」修复
- 根因：入场 IntersectionObserver tween（opacity 0→1，0.42s）与 hover / press / focus tween 并存，后者用 `overwrite: true`（GSAP 'all'）在入场窗口内误杀 opacity tween，`clearProps` 未执行，内联 opacity 停在中间值且 mouseleave 只复位位移不复位 opacity → 卡片永久半透明，随机出现。
- 修复：`gsap.ts` 全部 `overwrite: true` 改为 `overwrite: 'auto'`（只覆盖同一属性的 tween）；入场 `fromTo` 增加 `onInterrupt`，被中断时 `set({opacity:1,y:0,clearProps:'opacity, transform'})` 双保险。

### 34.5 验证记录
- `npm run build`、`npm run electron:compile` 通过；`npx vitest run` 97 通过 / 10 文件。
- 真机：统计页 8 卡 + 四图（横向滚动 / 切月）正常、复习页无看板残留；学习类别弹窗 11 项、选择后侧边栏 / localStorage / grade 联动正确；设置页快速滚动 + hover 后 38 张卡片 0 半透明残留；备份命名格式、中文白名单、重名与正则验证通过（旧 `auto-` 文件兼容）。

## 35. 主题切换「圆形只覆盖一部分、其余直接变色」修复（弃用 View Transitions）

### 35.1 现象与定性
- 现象：点击主题切换，圆形扩散只扫过一部分区域，屏幕其余部分在圆形到达前就直接变成新主题色。
- 定性：缺陷，不是设计；24.7 的 View Transitions 方案在本应用条件下存在「真实 DOM 提前变色」空窗。

### 35.2 根因（实测数据）
- 流程：`startViewTransition(cb)` 的回调同步把真实 DOM 切到新主题；浏览器随后捕获前后整页快照，`transition.ready`（伪元素树挂载、圆形 clip 动画开始）后才用 `::view-transition-new(root)` 覆盖真实 DOM。规范中 root 快照尺寸等于 snapshot viewport（视口），几何坐标按视口算无误。
- 实测 `ready` 时序：热路径约 141–154ms，**冷启动首次约 1757–1999ms**；临时注入 `*{backdrop-filter:none!important}` 后冷启动首次降到约 433ms——大量毛玻璃 backdrop-filter 是冷启动捕获慢的重要因素（约 1.3–1.5s），其余来自长页面 / 滚动后的单次快照捕获。
- 机制：回调已把真实 DOM 切到新主题，伪元素覆盖层却要到 ready 才挂载；回调→ready 空窗内新主题真实 DOM 直接可见。正常空窗约 1 帧（~16ms）人眼难察，本应用被放大到近 2 秒，于是圆形动画开始前整页已变色，圆形只在扫过区域呈现揭示，其余区域早已是新主题。

### 35.3 方案演进：顶层覆盖层（否决）→ 整页克隆（真机否决、已退回）→ 底层背景扩散 + 容器渐变（当前保留）
- 方案B（顶层覆盖层，否决）：在内容最上层放全覆盖 `#theme-reveal`（z-index 9000）做圆扩散、圆满后才切真实 DOM。消除了"提前变色"，但圆内只有背景、没有容器与文字——圆边界扫过容器时黑白闪、扫到侧边栏时文字消失，否决。
- 方案D（整页 DOM 克隆，真机否决、已退回）：克隆完整页面（sidebar + main-content）、注入新主题全部 CSS 变量与背景，对克隆层 #theme-clone 做圆形 clip 揭示，目标是圆边界连续扫过背景 + 容器 + 文字；并曾用 fixStickyInClone 修正克隆内吸顶 navbar / 吸底交卷条的错位。用户真机验证后反馈"还是不行"，明确选择退回方案C，故方案D 代码（collectCustomPropNames / stripCloneIds / syncCloneVisual / fixStickyInClone 及 #theme-clone）已全部移除。
- 方案C（当前保留）：**底层背景圆形扩散 + 容器 / 文字 CSS 渐变**。
  - 常驻底层 `#bg-under`（z-index -2）。切换前先清 `#bg-under` inline（防上次残留），临时 `<style>` 禁用所有 transition/animation，切到新 class 读 `getComputedStyle(#bg-under).backgroundImage` 得新背景、切回旧 class 读旧背景，再移除禁用样式（同任务无绘制、用户不可见）。
  - 切换时：把 `#bg-under` 用 inline 固定为**旧背景**（防 commit 加 class 后底层整体直接变新色）；动态创建 `#bg-over`（z-index **-1**，在 #bg-under 之上、所有容器之下，不遮挡文字），inline 新背景、初始 clip circle(0)；随后**立即 commit**（翻 isDarkMode + localStorage + applyTheme），容器 / 文字靠现有 CSS transition（.3–.45s）平滑渐变、全程可见；`#bg-over` WAAPI clip 圆扩到视口最远角 +20（560ms easeOutCubic），finished 后清 `#bg-under` inline（交还 CSS，与 over 一致、无缝）、移除 #bg-over、释放锁。
  - 已知取舍（用户接受）：圆边界进入不透明大卡片 / 导航后，#bg-over 在容器后面、圆弧在该处不可见，容器整体渐变，因此并非"圆边界连续穿过每个容器"的理想揭示；但无黑白闪烁、文字不消失、无整页克隆的性能开销。
- 兜底：`prefers-reduced-motion` 直接 commit、不建 #bg-over；动画中断（标签隐藏）的 catch 也调 cleanup 保证最终状态。
- 防连点：模块级 `themeAnimating` 锁 + 480ms 节流。

### 35.4 验证记录
- `npm run build` 通过；产物已 robocopy 同步 `static/`；`npx vitest run` **97 项全部通过**（含 backup 时间戳断言匹配"可读命名" YYYY-MM-DD_HH-MM-SS）。
- 方案D 经用户真机验证被否（反馈"还是不行"），已按用户选择退回方案C；**方案C 为当前代码状态**。
- 方案C 历史真机结论（可见窗口）：容器不闪、sidebar 文字不消失、明暗双向连续切换不卡死；已知圆弧进入不透明容器后不可见、容器整体渐变（见 35.3 取舍）。
- 本次自动化真机视觉验证受阻于 computer-use 显示环境：DWM 合成异常，应用窗口在截图表面只渲染出桌面壁纸（Win32 API 中 visible、rect 正常、未 cloaked），故最终视觉以用户真机为准。
- 备注：自动化内置浏览器离屏时 WAAPI `currentTime` 冻结，属该环境假象。

## 36. 跨平台适配与三平台 CI/CD

### 36.1 目标与分发形态
- 支持 Windows / macOS / Linux，每个平台提供两种安装包：
  - **在线小安装包**：仅含约 3MB 文本资源（resemble / lemma / wordroot）；stardict 首次启动自动下载，examples / sherpa / semantic 用到时按需下载。
  - **完整离线包**：内置全部资源，安装后断网可用。
- 硬约束：macOS 的 dmg / pkg **只能在 macOS 上构建**（electron-builder 不支持在 Windows / Linux（含官方 Docker）交叉打 mac 包）。因此不做单机交叉打包，改用 GitHub Actions 三平台 runner 分别构建。

### 36.2 打包配置（双静态 YAML）
- 采用两份静态 YAML：`electron-builder.online.yml`（输出 `release-final4`，仅内置 resemble / lemma / wordroot 三文本约 3MB，stardict / examples / sherpa / semantic 首次运行按需下载）与 `electron-builder.offline.yml`（输出 `release-offline`，extraResources 内置全部大资源，产物名加 `-Offline`）。
- 早期用单一 `electron-builder.config.cjs` + 环境变量 `BUILD_VARIANT` 切换，CI 上该 JS 配置加载不稳定；改为静态 YAML 后由 read-config-file 直接 js-yaml 加载，规避 JS / require / ESM 加载差异。
- **「Release 资产名变 shici」最终根因（经日志逐行核对）**：workflow_dispatch（`--publish never`）日志确认 YAML 正常加载（`loaded configuration ...online.yml`）、磁盘产物名正确（`building target=nsis file=release-final4\拾词-Setup-2.0.2.exe`）。但 tag run（`--publish always`）上传到 Release 时资产变成 `shici-setup-2.0.2.exe`——GitHub publisher 对上传文件名做 **ASCII 清洗**：文件名宏 `${productName}` 是 "sanitized product name"，非 ASCII 的中文「拾词」被 sanitize 后回退到 package.json 的 ASCII `name`（当时为 `shici`）；`--publish never` 不上传、故不暴露。
- **命名决策**：package.json `name` 由 `shici` 改为 `pick-up-words`，`appId` 改为 `com.pickupwords.app`，两 YAML 的 `artifactName` 统一为英文 `PickUpWords-Setup-${version}.${ext}` / `PickUpWords-${version}-${arch}.${ext}`（离线加 `-Offline`）；`productName` 仍为「拾词」，故安装后桌面 / 开始菜单快捷方式与窗口标题照常显示中文，仅 Release 安装包文件名为英文（跨平台 URL 与自动更新链路要求 ASCII）。
- 包体积实测（Windows）：在线 NSIS 约 236MB（Electron / Chromium 运行时固有体积 + 小文本，大资源未内置；这是 Electron 应用的体积下限，与是否内置词库无关），离线 NSIS 约 1.1GB（在线基础 + 全部大资源）。
- 平台 target：Win = NSIS(x64)；mac = dmg + zip（x64、arm64）；linux = AppImage + deb(x64)。
- 图标：`logo.ico` 仅 Windows；`tools/gen-icons.cjs`（sharp）把矢量 `public/logo.svg` 渲染为 `build/icon.png`(1024) 与 `build/icons/16..1024.png`，mac/linux 由 electron-builder 自动生成 icns / 多尺寸；`.gitignore` 已放行这两处。
- `npmRebuild: false`：better-sqlite3 13 依赖 node-addon-api、`gypfile:false`、自带全平台 prebuilds，运行时直接加载，不需 node-gyp / Visual Studio。

### 36.3 平台相关代码隔离
- main.ts：GPU 强制开关（enable-gpu-rasterization / ignore-gpu-blocklist）**限定 win32**；移除 `enable-zero-copy`（部分 NVIDIA + Windows 触发 GPU 命令缓冲区错误）；`chcp 65001` 本就限定 win32。
- main.ts `setupNativeLibPath()`：macOS / Linux 在加载 sherpa 原生模块前，把 `sherpa-onnx-{darwin|linux}-{arch}` 平台包目录加入 `DYLD_LIBRARY_PATH` / `LD_LIBRARY_PATH`（dev 的 node_modules 与打包后 app.asar.unpacked 两处候选）；CI 产物不签名，DYLD 对未签名 app 生效。
- preload.ts：alert/confirm 焦点修复已限定 win32；并暴露 `platform`。
- asset-manager.ts：`extractZip` 由 powershell `Expand-Archive` 改为 7zip-bin 的 7za（7za 支持 zip），与 `extract7z` 统一、三平台通用；移除不再使用的 execSync。
- tts.ts：腾讯兜底走 `execFile('curl', 参数数组)`，mac/linux 自带 curl、Win10+ 自带 curl.exe，找不到时走兜底、不崩溃。
- sherpa_asr.ts：`require('sherpa-onnx-node')` 懒加载；其 addon.js 按 `sherpa-onnx-{platform}-{arch}` 定位平台包。

### 36.4 CI/CD（.github/workflows）
- `ci.yml`：push / PR 到 main，ubuntu 跑 typecheck（渲染层 + 主进程）、Vitest、vite build、electron 编译，作为快速门禁。
- `release.yml`：
  - 推送 `v*` 标签：matrix 四 job（windows-latest、ubuntu-latest、macos-13→x64、macos-latest→arm64），每 job 先打在线小包；离线前由 `tools/prepare-offline-resources.cjs` 从 Gitee V2.0 下载四组 7z 分卷（约 849MB）、解压并放置 `stardict.db` 与 `resource/` 下 examples / sherpa / semantic（幂等、分卷断点、指数退避重试），再打离线包；`--publish always` 借内置 GITHUB_TOKEN 汇聚到同一 tag 的 Release。
  - 草稿自动发布：electron-builder 默认产出 draft Release；汇总 job `publish-release`（needs: build）在所有平台（含离线）完成后执行 `gh release edit <tag> --draft=false`，转为正式公开 Release。
  - `workflow_dispatch`：选择 online / offline，`--publish never`，产物经 upload-artifact 提供下载。
- CI 依赖安装：所有 native 模块（better-sqlite3 / sherpa-onnx-node / 7zip-bin / sharp / esbuild）均自带跨平台 prebuilds 或平台 optionalDependencies，故统一 `npm ci --ignore-scripts || npm install --ignore-scripts` 跳过隐式 node-gyp（干净 CI 上 Windows 的 node-gyp 9.4.1 无法识别新版 VS、macOS 的 Python 3.14 已无 distutils），再 `node node_modules/electron/install.js` 手动补下载 Electron 二进制；electron-builder 设 `npmRebuild:false`。
- 词典完整度核对：Gitee V2.0 的 stardict 分卷下载约 149MB，解压后为约 776MB、340 万词条（含 definition / translation / exchange / detail）的完整库，比本地 758MB / 328 万词条版本更新更全；`assets.ts` 的 `size` 字段是分卷下载量而非解压大小，在线小包按需下载后词典与离线包一致、无缺失。

### 36.5 已知限制
- macOS 暂未签名 / 公证：用户首次打开需「右键 → 打开」；要彻底消除提示需 Apple 开发者账号。
- GitHub Release 单文件 ≤2GB：若某平台离线包压缩后超限需改分卷（当前预估 <2GB，待 CI 实测）。
- 云同步仍不做（无服务器），维持导出 / 导入迁移数据。
