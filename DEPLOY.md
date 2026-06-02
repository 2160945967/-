# 拾词 - 部署指南

## 简介

这是拾词词典的部署指南。大文件（词典数据和发音文件）通过 GitHub Releases 分发，避免了仓库过于庞大。

## 文件说明

### 不需要上传到 Git 的文件

这些文件会在部署时自动下载：

- `ecdict.csv` - 主词典数据
- `sentences.csv` - 例句数据（已过滤）
- `links.csv` - 例句翻译链接（已过滤）
- `pronunciations/` - 发音文件目录

### 工具脚本

- `package_data.py` - 打包数据文件（本地使用，不上传）
- `filter_csv.py` - 过滤原始数据文件（本地使用，不上传）
- `data_downloader.py` - 数据下载器（随代码一起上传）

## 部署步骤

### 1. 准备数据文件

在本地运行打包脚本：

```bash
python package_data.py
```

这会生成：
- `data.zip` - 包含词典数据和例句数据
- 可选生成 `pronunciations.zip` - 包含发音文件

### 2. 创建 GitHub 仓库

1. 在 GitHub 创建一个新仓库
2. 把代码推送到仓库（确保不要包含大文件）
3. 创建一个新的 Release（例如 `v1.0`）
4. 上传 `data.zip` 和 `pronunciations.zip` 到 Release 附件

### 3. 配置下载器

修改 `data_downloader.py` 中的配置：

```python
DEFAULT_CONFIG = {
    "repo_url": "https://github.com/你的用户名/你的仓库名",
    "release_version": "latest"  # 或者具体版本号如 "v1.0"
}
```

### 4. 部署到服务器

在服务器上：

```bash
# 克隆代码
git clone https://github.com/你的用户名/你的仓库名.git
cd 你的仓库名

# 安装依赖
pip install -r requirements.txt

# 下载数据文件
python data_downloader.py

# 启动服务
python app.py
```

## 文件结构

```
拾词/
├── app.py               # 主程序
├── data_downloader.py   # 数据下载器
├── requirements.txt     # Python依赖
├── .gitignore          # Git忽略配置
├── static/             # 前端文件
│   └── index.html
├── stardict.py         # 词典模块
├── tencent_api.py      # TTS和翻译API
├── worddata.py         # 词干数据
├── wordutils.py        # 工具函数
├── dictutils.py        # 词典工具
├── lemma.en.txt        # 词干数据（小文件，可提交）
│
└── (以下文件会自动下载)
    ├── ecdict.csv
    ├── sentences.csv
    ├── links.csv
    └── pronunciations/
```

## PythonAnywhere 部署

1. 在 PythonAnywhere 创建账户
2. 上传代码文件（或使用 Git 克隆）
3. 在 Bash 控制台运行：
   ```bash
   cd mysite
   pip install -r requirements.txt
   python data_downloader.py
   ```
4. 在 Web 标签页配置 WSGI 文件，指向 `app.py`
5. 启动 Web 应用

## 注意事项

- 确保 `SecretKey.csv` 不被提交到 Git（已在 .gitignore 中）
- 大文件更新时，创建新的 Release 并重新上传
- 服务器上数据文件更新后，删除旧的数据库文件让程序重新初始化
