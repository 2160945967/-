/**
 * electron-builder 打包配置（跨平台 + 在线/离线双形态）
 *
 * 形态由环境变量 BUILD_VARIANT 控制：
 *   online （默认）：在线小安装包，仅含约 3MB 文本资源；stardict / examples / sherpa / semantic
 *                    在首次运行（或用到）时按需下载。
 *   offline        ：完整离线安装包，内置全部资源，安装后无需联网。
 *
 * 平台：--win / --mac / --linux（macOS 的 dmg 只能在 macOS runner 上构建，由 CI 保证）。
 */
const variant = process.env.BUILD_VARIANT === 'offline' ? 'offline' : 'online';
const tag = variant === 'offline' ? '-Offline' : '';

// 小体积文本资源（约 3MB），两种形态都内置
const smallResources = [
  { from: 'resource/resemble.txt', to: 'resemble.txt' },
  { from: 'resource/lemma.en.txt', to: 'lemma.en.txt' },
  { from: 'resource/wordroot.txt', to: 'wordroot.txt' },
];

// 大体积资源（合计数 GB）：仅离线包内置，在线包改为按需下载
const bigResources = [
  { from: 'stardict.db', to: 'stardict.db' },
  { from: 'resource/examples.db', to: 'examples.db' },
  { from: 'resource/sherpa-onnx-sense-voice-zh-en-ja-ko-yue', to: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue' },
  { from: 'resource/semantic-model-files', to: 'semantic-model-files' },
];

const winName = '拾词' + tag + '-Setup-${version}.${ext}';
const nixName = '拾词' + tag + '-${version}-${arch}.${ext}';

module.exports = {
  appId: 'com.shici.app',
  productName: '拾词',
  // better-sqlite3@13 已自带 Node-API 全平台 prebuilds（gypfile:false），运行时直接加载，无需重编译；
  // 关闭重编译也避免本机缺少 VS C++ 工具链时 `electron-builder install-app-deps` 失败。
  npmRebuild: false,
  directories: {
    output: variant === 'offline' ? 'release-offline' : 'release-final4',
  },
  extraResources: variant === 'offline' ? [...bigResources, ...smallResources] : smallResources,
  compression: 'maximum',
  asar: true,
  asarUnpack: [
    'node_modules/better-sqlite3/**/*.node',
    'node_modules/sherpa-onnx-win-x64/**',
    'node_modules/sherpa-onnx-darwin-x64/**',
    'node_modules/sherpa-onnx-darwin-arm64/**',
    'node_modules/sherpa-onnx-linux-x64/**',
    'node_modules/sherpa-onnx-linux-arm64/**',
    'node_modules/7zip-bin/**/*',
  ],
  files: [
    'electron-dist/**/*',
    '!electron-dist/**/*.map',
    'dist/**/*',
    'node_modules/**/*',
    'wordbooks.json',
    'logo.ico',
    'package.json',
    '!node_modules/**/*.d.ts',
    '!node_modules/**/*.map',
    '!node_modules/**/test/**/*',
    '!node_modules/**/tests/**/*',
    '!node_modules/**/docs/**/*',
    '!node_modules/**/README*',
    '!node_modules/**/CHANGELOG*',
    '!node_modules/**/LICENSE*',
  ],

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'logo.ico',
    artifactName: winName,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '拾词',
    include: 'build/uninstaller.nsh',
    license: 'build/license.txt',
    artifactName: winName,
  },

  mac: {
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    icon: 'build/icon.png',
    category: 'public.app-category.education',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    artifactName: nixName,
  },
  dmg: {
    artifactName: nixName,
  },

  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    icon: 'build/icons',
    category: 'Education',
    maintainer: 'yangs-project',
    synopsis: '拾词 - 离线背单词桌面应用',
    artifactName: nixName,
  },
};
