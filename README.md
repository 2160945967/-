# 拾词 (Pick Up Words)

> 一个用拼写检验真实掌握程度的背单词桌面应用。

## 简介

市面上的背单词软件大多是“四选一”选择题，训练的是“认得出”，但考试要的是“写得出”。**拾词** 改变这个模式：它只给你中文释义，要求你**完整拼写出英文单词**。答对才算会，错了自动加入错题本，按艾宾浩斯遗忘曲线安排复习。

## 核心功能

- **查词**：输入单词，返回释义、音标、例句、词频等多维度信息。
- **单词本**：自由创建、导入、管理单词本，支持从查词结果一键加入。
- **拼写测验**：看中文释义，输入英文单词；答错自动归集到错题本。
- **艾宾浩斯复习**：根据记忆曲线权重排序，优先复习即将遗忘和已逾期的单词。
- **错题本 / 收藏**：错题自动归档，重点单词可收藏。
- **浅色 / 深色主题**：一键切换，带圆形扩散过渡动画。
- **发音与语音输入**：支持单词发音、例句朗读、语音查词（需配置相关模型/密钥）。

## 技术栈

- **桌面框架**：Electron
- **前端**：Vue 3 + TypeScript（通过 CDN 引入）
- **构建工具**：Vite
- **后端服务**：Express + better-sqlite3
- **动画**：GSAP
- **打包**：electron-builder

## 快速开始

### 环境要求

- Node.js >= 18
- npm 或 pnpm

### 安装依赖

```bash
npm install
```

### 准备词典数据库

将 `stardict.csv` 放在项目根目录，然后运行：

```bash
node scripts/build-stardict-db.cjs
```

这会生成 `stardict.db`，供查词服务使用。

### 开发运行

```bash
npm run dev
```

### 打包

```bash
npm run build:win
```

打包产物位于 `electron-dist/` 目录。

## 项目结构

```
.
├── electron/           # Electron 主进程、Express API、数据库服务
├── src/                # 前端源码（Vue 3 + TypeScript）
├── public/             # 静态资源
├── scripts/            # 构建脚本、模型下载脚本等
├── static/             # 内置静态页面
├── dist/               # Vite 构建输出
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
