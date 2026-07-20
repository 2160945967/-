#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""上传语义模型分卷文件到 Gitee Release"""
import sys
import requests
from pathlib import Path

TOKEN = '3e37f425ecd65bb12fdce76f367c67fa'
ASSETS_DIR = Path(__file__).parent.parent / 'gitee-assets'
RELEASE_TAG = 'v1.0.0'

# 获取 release ID
r = requests.get(
    f'https://gitee.com/api/v5/repos/yangs-project/download/releases/tags/{RELEASE_TAG}',
    params={'access_token': TOKEN}
)
if r.status_code != 200:
    print(f'获取 Release 失败: {r.status_code} {r.text[:200]}')
    sys.exit(1)

release = r.json()
release_id = release['id']
print(f'Release ID: {release_id}')

# 上传分卷文件
files = sorted(ASSETS_DIR.glob('semantic-model.7z.*'))
if not files:
    print('没有找到分卷文件')
    sys.exit(1)

for f in files:
    size_mb = f.stat().st_size / 1024 / 1024
    print(f'上传: {f.name} ({size_mb:.1f} MB)...', end=' ', flush=True)
    with open(f, 'rb') as fp:
        r = requests.post(
            f'https://gitee.com/api/v5/repos/yangs-project/download/releases/{release_id}/attach_files',
            params={'access_token': TOKEN},
            files={'file': (f.name, fp)},
        )
    if r.status_code == 201:
        data = r.json()
        url = data.get('browser_download_url', '')
        print(f'OK -> {url}')
    else:
        print(f'失败: {r.status_code} {r.text[:200]}')

print('\n完成')
