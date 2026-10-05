# 拾词 (Pick Up Words)

> 一个用拼写检验真实掌握程度的背单词桌面应用。

## 下载安装

**最新版本 v2.0.0**（由 GitHub Actions 在 Windows / macOS / Linux 上自动构建并校验）：

| 平台 | 在线小安装包（推荐：体积小，首次运行按需下载资源） | 完整离线包（内置全部资源，断网可用） |
| --- | --- | --- |
| Windows 10/11 (x64) | [拾词-Setup-2.0.0.exe](https://github.com/2160945967/pick-up-words/releases/download/v2.0.0/拾词-Setup-2.0.0.exe) | [拾词-Offline-Setup-2.0.0.exe](https://github.com/2160945967/pick-up-words/releases/download/v2.0.0/拾词-Offline-Setup-2.0.0.exe) |
| macOS · Apple Silicon (M 系列) | [拾词-2.0.0-arm64.dmg](https://github.com/2160945967/pick-up-words/releases/download/v2.0.0/拾词-2.0.0-arm64.dmg) | [拾词-Offline-2.0.0-arm64.dmg](https://github.com/2160945967/pick-up-words/releases/download/v2.0.0/拾词-Offline-2.0.0-arm64.dmg) |
| macOS · Intel | [拾词-2.0.0-x64.dmg](https://github.com/2160945967/pick-up-words/releases/download/v2.0.0/拾词-2.0.0-x64.dmg) | [拾词-Offline-2.0.0-x64.dmg](https://github.com/2160945967/pick-up-words/releases/download/v2.0.0/拾词-Offline-2.0.0-x64.dmg) |
| Linux (x64) | [拾词-2.0.0-x64.AppImage](https://github.com/2160945967/pick-up-words/releases/download/v2.0.0/拾词-2.0.0-x64.AppImage) · [.deb](https://github.com/2160945967/pick-up-words/releases/download/v2.0.0/拾词-2.0.0-x64.deb) | [拾词-Offline-2.0.0-x64.AppImage](https://github.com/2160945967/pick-up-words/releases/download/v2.0.0/拾词-Offline-2.0.0-x64.AppImage) · [.deb](https://github.com/2160945967/pick-up-words/releases/download/v2.0.0/拾词-Offline-2.0.0-x64.deb) |

- **在线小安装包**：仅含约 3MB 文本资源；首次启动自动下载词典（约 150MB），例句库 / 语音识别 / 语义模型在用到时按需下载，需联网。
- **完整离线包**：内置词典、例句、语音识别、语义模型等全部资源，安装后断网可用，体积较大。
- macOS 暂未做 Apple 签名 / 公证：首次打开若提示「无法验证开发者」，在 Finder 中对应用**右键 → 打开**一次，或在「系统设置 → 隐私与安全性」点「仍要打开」。
- 全部安装包与源码见 [GitHub Releases](https://github.com/2160945967/pick-up-words/releases/tag/v2.0.0)。

## 简介

市面上的背单词软件大多是“四选一”选择题，训练的是“认得出”，但考试要的是“写得出”。**拾词** 改变这个模式：它只给你中文释义，要求你**完整拼写出英文单词**。答对才算会，错了自动加入错题本，按艾宾浩斯遗忘曲线安排复习。

## 核心功能

- **查词**：输入单词，返回释义、音标、例句、词频等多维度信息。
- **单词本**：自由创建、导入、管理单词本，支持从查词结果一键加入。
- **单词测验（五种模式）**：中译英、英译中、听写、跟练、听力卡壳；题目与输入合并到同一圆角输入区（内嵌粗体 Fredoka 字体 + 长下划线）。**跟练模式**本质是带提示的中译英：输入区先铺一层浅色的完整正确拼写，照着逐字母跟打，输对的字母逐位变清晰（绿色）、输错标红并轻抖，拼完整词自动判对进入下一题，适合记新词。中译英 / 跟练都有逐字符反馈；其中中译英可用「辅助拼写」胶囊或设置开关控制（正确前缀标绿、首个错误位起标红、拼对自动提交），跟练始终带完整拼写提示、不显示该开关。中译英 / 跟练 / 英译中支持「例句填空」：答题时把目标词挖成下划线，该词没有任何例句时显示「暂无例句」占位，答对后在详解中揭示完整例句与翻译。**英译中**对用户输入的每个中文释义片段独立判分：先字面匹配，未命中再把该片段与词书及 ECDict 的**每个义项单独**调用语义相似度模型比对，任一义项相似即判对（不把多义项 join 成一串，避免「极好的 / 怪诞的」等不同义项互相干扰）；判别期间显示「正在判别答案…」，提交后命中的释义标绿、未命中标红，修改即恢复默认、再次提交重新判别；判分同时参考 ECDict 释义，词书未列的同义说法（如 probably 的「或许」及其他近义表述）也能判对；开启「辅助拼写」后输入过程中按字面实时标色（不调模型以保证跟手），最后一个仍在输入、未输分隔符的释义不标色。答错自动归集到错题本。测验配置（来源 / 模式 / 个数 / 顺序）自动保留，测验个数与设置中「每日学习单词数」双向联动；选词书弹窗记住上次所在标签（我的词库 / 四级词书），下次直接在该标签勾选；测验每答完一题即自动保存进度，中途退出或关机后可点「继续上一轮答题」从中断处继续（随机顺序、已答记录与对错计数一并恢复）；每次启动程序都从词典首页开始，不恢复上次页面。
- **艾宾浩斯复习**：根据记忆曲线权重排序，优先复习即将遗忘和已逾期的单词。
- **错题本 / 收藏**：错题自动归档，重点单词可收藏。
- **浅色 / 深色主题**：一键切换，带圆形扩散过渡动画。
- **发音与语音输入**：支持单词发音、例句朗读、语音查词（需配置相关模型/密钥）。
- **操作音效反馈**：答对、答错、按钮点击、测验完成时播放 Web Audio API 合成的轻量提示音，可在设置中开关。
- **数据备份与恢复**：设置页一键导出 / 导入全部学习数据（收藏、错题、学习记录、单词本、测验配置等）；默认开启磁盘自动备份（活动时定时 + 退出前落盘，保留最近 10 份），可在设置中查看、恢复、下载或删除历史备份。
- **键盘导航与可访问性**：弹窗 / 确认框内置焦点陷阱（Tab 循环、Esc 关闭、关闭后焦点还原），选词书标签支持方向键切换，发音按钮带 ARIA 标签，统一的 `:focus-visible` 焦点样式，并遵循 `prefers-reduced-motion`。
- **四六级模拟题**：四级听力 100 套（原声音频 + 0.7–1.5 倍九档调速，答题阶段只能顺序播放、交卷后可自由回听 + 听力原文 + 自动判分）、阅读理解四级 199 篇 / 六级 200 篇（难度严格分开）。先做题再交卷判分：交卷后列表里该篇 / 套的序号圆圈标绿（重新打开程序仍保留，重做不取消标记），随后可查看答案解析、全文翻译（听力为原文），并在下方得到本篇「四级核心词」。交卷后阅读正文 / 听力原文的**每个单词**都是隐藏链接——鼠标悬浮即高光、弹出随鼠标移动的小提示，点击直接跳词典查该词；页面上也有操作提示。侧边栏学习时长只在测验 / 复习 / 模拟题做题与交卷复习期间累计，查词、设置、浏览词表或停在配置页不计时，60 秒无操作自动暂停。
- **四级词书《英语四级你还在背单词吗》**：按单元 / 课程整书或勾选多课出题，支持「顺序 / 乱序」切换并自动记住选择；可在设置页或选词书弹窗中开关「词书附带练习派生词」（弹窗内切换会实时重算整本 / 单元 / 每课词数），开启后每个主词的派生词作为独立词条紧跟主词练习（全本去重 4499 主词 + 1528 派生词 = 共 6027 词，派生词无书例句时自动补外部例句），此时答对详解区不再重复列出这些派生词；词书练习与模拟题「四级核心词」的精简释义、音标取自该词书，点击核心词跳转词典时仍展示 ECDict 完整释义（运行时词书优先、ECDict 兜底，不改动全局词典库）。

## 技术栈

- **桌面框架**：Electron 44
- **前端**：Vue 3 + TypeScript（通过 CDN 引入）
- **构建工具**：Vite
- **后端服务**：Express + better-sqlite3 13
- **动画**：GSAP
- **打包**：electron-builder
- **测试**：Vitest（97 用例）
- **CI/CD**：GitHub Actions（Windows / macOS / Linux 三平台自动构建、测试与发布）

## 快速开始

### 环境要求

- Node.js >= 22（better-sqlite3 13 要求）
- npm 或 pnpm

### 安装依赖

```bash
npm install
```

### 准备词典数据库

将 ECDICT 导出的 `stardict.csv` 放入 `resource/` 目录。应用首次启动时若发现 `resource/stardict.db` 不存在，会自动从 CSV 构建该 SQLite 词典库（约 328 万条）；也可以直接放入已构建好的 `stardict.db`。

### 开发运行

完整启动 Electron + 本地 API（推荐）：

```bash
npm run electron:start
```

仅启动 Vite 前端开发服务器（不含 Electron 主进程与本地接口）：

```bash
npm run dev
```

### 运行自动化测试

```bash
npm test
```

97 个用例（10 个测试文件），覆盖判题、测验会话、释义解析、正则清洗、随机生成器、模拟题判分与备份逻辑（Vitest + happy-dom）。

### 打包

打包采用两份静态 YAML 配置（加载可靠、不受 `type: module` 下 JS 配置加载影响）：`electron-builder.online.yml`（在线小包，仅内置约 3MB 文本，大资源首次运行按需下载）与 `electron-builder.offline.yml`（离线全包，内置全部资源）；`--win / --mac / --linux` 选择目标平台。

Windows 在线小安装包：

```bash
npm run dist:win
```

Windows 完整离线包：

```bash
npm run dist:win:offline
```

仅生成免安装解包目录（快速验证）：

```bash
npm run dist:dir
```

在对应操作系统上也可直接产出当前平台的在线 / 离线包（**macOS 的 dmg 只能在 macOS 上构建**）：

```bash
npm run pack:online      # 当前平台在线小包
npm run pack:offline     # 当前平台离线全包
```

编译产物位于 `electron-dist/`；在线包输出到 `release-final4/`、离线包输出到 `release-offline/`。配置 `npmRebuild: false`：better-sqlite3 13 自带 Node-API 全平台 prebuilds，打包时不从源码重编译（无需本机安装 Visual Studio）。**发音文件与听力音频默认不打入安装包**，改为设置页按需下载；缺失时发音自动降级到在线 TTS，听力题目与原文仍可练习。日常发布无需本地打包：推送 `v*` 标签后由 GitHub Actions 在三平台自动构建在线 + 离线包并发布 Release。

### 资源分发

源码仓库：

- GitHub（主仓库，含三平台 CI 与安装包 Release）：<https://github.com/2160945967/pick-up-words>
- Gitee（镜像）：<https://gitee.com/yangs-project/pick-up-words>

Gitee 普通项目配额：仓库单文件 50MB、单仓库约 1GB；**Release 附件单文件 100MB、单仓库附件总容量 1GB**。因此大资源不入库，词典 / 模型 / 例句按约 100MB 分卷，发布在 [V2.0 Release](https://gitee.com/yangs-project/pick-up-words/releases/tag/V2.0)：

| 资源 | 分卷 | 解压后 | 必需性 |
| --- | --- | --- | --- |
| stardict.7z | 2 | stardict.db（ECDict 词典） | 必需 |
| semantic-model.7z | 4 | text2vec-base-chinese（多释义判别） | 可选 |
| sherpa-model.7z | 2 | SenseVoice 语音识别模型 | 可选 |
| examples.7z | 3 | examples.db（例句库） | 可选 |

**推荐**：在应用内「设置 → 数据资源下载」一键下载（自动逐卷、断点续传、校验并合并解压到用户数据目录，已接通以下 Release）。也可手动下载同一资源的全部分卷放入同一目录，用 7-Zip 解压 `.001` 自动合并还原。

**四级听力音频（约 8.14GB、100 套 wav，压缩分卷后约 3.56GB / 39 卷）**：单仓库 Release 附件上限 1GB，因此分卷分散在 4 个如实标注的配套资源仓库（各含 Release v1.0 与说明）：

- 第 1 部分（卷 001–010）：<https://gitee.com/yangs-project/pick-up-words-audio-1>
- 第 2 部分（卷 011–020）：<https://gitee.com/yangs-project/pick-up-words-audio-2>
- 第 3 部分（卷 021–030）：<https://gitee.com/yangs-project/pick-up-words-audio-3>
- 第 4 部分（卷 031–039）：<https://gitee.com/yangs-project/pick-up-words-audio-4>

**推荐**在应用内「设置 → 数据资源下载」一键下载（自动跨 4 个仓库取卷、合并解压）。手动方式：下载全部 39 卷放入同一目录，用 7-Zip 解压 `.001` 合并，将还原出的 `CET4_Listening_Bank` 放入用户数据目录的 `assets/`（或 `resource/模拟题/`）。

单词发音不随仓库分发，可在应用内设置页下载，或运行 `tools/download_pronunciations.py` 自行下载（多线程、断点续传、自动去重）。

## 安全与工程质量

- **内容安全策略（CSP）**：页面通过 CSP meta 限制脚本 / 样式 / 连接来源，外部请求统一走后端同源接口。
- **本地崩溃与日志**：原生崩溃由 Crashpad 本地收集（不上传）；主 / 后端 / 渲染进程的未捕获异常与未处理 Promise 写入 `%APPDATA%/拾词/logs/app.log`（2MB 轮转）。
- **类型检查卡点**：`npm run build` 前置 `tsc --noEmit`，类型错误即中断构建。
- **依赖审计**：生产依赖 `npm audit --omit=dev` 为 0 漏洞。
- **持续集成 / 持续发布**：`.github/workflows/ci.yml` 在推送 / PR 时运行类型检查、单测与构建；`.github/workflows/release.yml` 在推送 `v*` 标签时于 Windows / macOS (x64 + arm64) / Linux 上分别构建在线与离线安装包并发布 GitHub Release，也支持手动触发。

## 项目结构

```
.
├── electron/           # Electron 主进程、Express API、数据库与各类服务
│   └── api/exam.ts     # 模拟题接口：听力音频、音频状态、四级核心词
├── src/                # 前端源码（原生 TypeScript 命令式模块 + 少量 Vue 虚拟列表）
│   └── modules/exam.ts # 模拟题前端（听力 / 阅读、交卷判分、核心词查词）
├── public/             # 静态资源
│   ├── exams/          # 模拟题 JSON（reading/ 与 listening/，构建期生成）
│   └── wordbooks/      # 四级词书 JSON（cet4-beidanci/）
├── resource/           # 大型运行期资源（stardict、例句、模型、模拟题源与音频）
├── tools/              # 离线构建 / 下载脚本（模拟题 JSON、语义模型、有道发音预下载）
├── scripts/            # 语义模型下载等脚本
├── tests/              # Vitest 自动化测试
├── dist/               # Vite 构建输出
├── electron-dist/      # Electron 编译产物
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tsconfig.electron.json
```

## 开源许可

- 本项目代码基于 [MIT License](LICENSE) 开源。
- 词典数据来自 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT）。
- 例句数据来自 [Tatoeba](https://tatoeba.org/)（CC-BY 2.0 FR）。
- 详见 [NOTICE](NOTICE)。

## 致谢

本项目由作者借助 TRAE AI 工具协作完成，代码 95%+ 由 AI 生成，是一个“vibe coding”的完整实践案例。
