#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据下载器
自动从GitHub Releases下载大文件
"""

import os
import sys
import zipfile
import requests
from tqdm import tqdm


_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 默认配置 - 部署时修改这里！
DEFAULT_CONFIG = {
    # 你的Gitee仓库地址，格式: "https://gitee.com/你的用户名/你的仓库名"
    "repo_url": "https://gitee.com/yangs-project/pick-up-words",
    # Release版本: "latest" 或具体版本号如 "v1.0"
    "release_version": "latest"
}


def download_file(url, dest_path):
    """
    下载文件，带进度条
    """
    print(f"正在下载: {os.path.basename(dest_path)}")
    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()
        
        total_size = int(response.headers.get('content-length', 0))
        
        progress_bar = tqdm(
            total=total_size,
            unit='B',
            unit_scale=True,
            desc=f"正在下载 {os.path.basename(dest_path)}",
        )
        
        with open(dest_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    progress_bar.update(len(chunk))
        
        progress_bar.close()
        print(f"✓ 下载完成: {os.path.basename(dest_path)}")
        return True
    except Exception as e:
        print(f"✗ 下载失败: {e}")
        if os.path.exists(dest_path):
            os.remove(dest_path)
        return False


def extract_zip(zip_path, extract_to):
    """
    解压zip文件
    """
    print(f"正在解压: {os.path.basename(zip_path)}")
    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_to)
        print(f"✓ 解压完成")
        return True
    except Exception as e:
        print(f"✗ 解压失败: {e}")
        return False


def check_and_download():
    """
    检查并下载数据文件
    """
    print("=" * 60)
    print("📦 拾词数据文件检查器")
    print("=" * 60)
    print()
    
    # 检查配置
    if DEFAULT_CONFIG["repo_url"] == "https://gitee.com/你的用户名/你的仓库名":
        print("⚠️ 请先配置你的Gitee仓库地址！")
        print("编辑 data_downloader.py，修改 DEFAULT_CONFIG['repo_url'] 为你的仓库地址")
        print()
        print("临时解决方案：")
        print("1. 先在 Gitee 上创建仓库")
        print("2. 上传数据文件到 Releases")
        print("3. 配置这里的 repo_url")
        print()
        return False
    
    # 检查需要的文件
    required_files = [
        os.path.join(_BASE_DIR, 'ecdict.csv'),
        os.path.join(_BASE_DIR, 'sentences.csv'),
        os.path.join(_BASE_DIR, 'links.csv'),
        os.path.join(_BASE_DIR, 'lemma.en.txt'),
    ]
    
    missing_files = []
    for f in required_files:
        if not os.path.exists(f):
            missing_files.append(os.path.basename(f))
    
    if not missing_files:
        print("✓ 所有数据文件已存在！")
        return True
    
    print(f"⚠️ 缺少文件: {', '.join(missing_files)}")
    print()
    
    # 询问是否下载
    print("是否自动下载？")
    print(f"从: {DEFAULT_CONFIG['repo_url']}")
    print()
    
    try:
        choice = input("按 Enter 下载，或按 Ctrl+C 退出: ")
    except KeyboardInterrupt:
        print()
        return False
    
    # 构建下载URL
    repo_url = DEFAULT_CONFIG['repo_url'].rstrip('/')
    release_version = DEFAULT_CONFIG['release_version']
    
    if release_version == 'latest':
        download_base = f"{repo_url}/releases/latest/download/"
    else:
        download_base = f"{repo_url}/releases/download/{release_version}/"
    
    # 下载数据文件
    print()
    print("📥 正在下载数据文件...")
    data_zip_path = os.path.join(_BASE_DIR, 'data.zip')
    
    data_url = download_base + 'data.zip'
    
    if not download_file(data_url, data_zip_path):
        print("数据文件下载失败")
        return False
    
    # 解压
    if not extract_zip(data_zip_path, _BASE_DIR):
        return False
    
    # 清理zip文件
    try:
        os.remove(data_zip_path)
        print("✓ 已清理临时文件")
    except:
        pass
    
    print()
    print("=" * 60)
    print("✅ 数据文件下载完成！")
    print("=" * 60)
    return True


def check_pronunciations():
    """
    检查发音文件
    """
    pron_dir = os.path.join(_BASE_DIR, 'pronunciations')
    if os.path.exists(pron_dir):
        mp3_count = len([f for f in os.listdir(pron_dir) if f.endswith('.mp3')])
        if mp3_count > 500:
            print(f"✓ 发音文件已存在: {mp3_count}个")
            return True
    return False


def download_pronunciations():
    """
    下载发音文件
    """
    print()
    print("🎵 发音文件检查...")
    
    if check_pronunciations():
        return True
    
    print("⚠️ 发音文件可能不完整，是否下载？")
    print()
    
    try:
        choice = input("按 Enter 下载，或按 Ctrl+C 跳过: ")
    except KeyboardInterrupt:
        print()
        return False
    
    repo_url = DEFAULT_CONFIG['repo_url'].rstrip('/')
    release_version = DEFAULT_CONFIG['release_version']
    
    if release_version == 'latest':
        download_base = f"{repo_url}/releases/latest/download/"
    else:
        download_base = f"{repo_url}/releases/download/{release_version}/"
    
    pron_zip_path = os.path.join(_BASE_DIR, 'pronunciations.zip')
    pron_url = download_base + 'pronunciations.zip'
    
    if not download_file(pron_url, pron_zip_path):
        print("发音文件下载失败")
        return False
    
    pron_dir = os.path.join(_BASE_DIR, 'pronunciations')
    if not extract_zip(pron_zip_path, _BASE_DIR):
        return False
    
    try:
        os.remove(pron_zip_path)
        print("✓ 已清理临时文件")
    except:
        pass
    
    print()
    print("✅ 发音文件下载完成！")
    return True


def main():
    """
    主函数
    """
    success = check_and_download()
    
    if success:
        download_pronunciations()
    
    print()
    print("🎉 数据文件准备完成！")
    print("现在可以运行 python app.py 启动程序了")


if __name__ == '__main__':
    main()
