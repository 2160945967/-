import { describe, it, expect, beforeEach, vi } from 'vitest';

// 隔离重型 UI 依赖，只测备份打包/校验纯逻辑
vi.mock('../src/global', () => ({ showConfirm: vi.fn() }));
vi.mock('../src/utils/gsap', () => ({ showToast: vi.fn() }));

import {
  collectBackupData, parseBackup, fileTimestamp, BACKUP_APP, BACKUP_VERSION,
} from '../src/utils/backup';

describe('collectBackupData', () => {
  beforeEach(() => localStorage.clear());

  it('收集全部 localStorage 键值并带元信息', () => {
    localStorage.setItem('favorites', '["apple"]');
    localStorage.setItem('studyStats', '{"days":1}');
    const b = collectBackupData();
    expect(b.app).toBe(BACKUP_APP);
    expect(b.version).toBe(BACKUP_VERSION);
    expect(typeof b.exportedAt).toBe('string');
    expect(b.data.favorites).toBe('["apple"]');
    expect(b.data.studyStats).toBe('{"days":1}');
  });
  it('排除可重建缓存 systemWordbookWordsCache', () => {
    localStorage.setItem('systemWordbookWordsCache', '...');
    localStorage.setItem('favorites', '[]');
    const b = collectBackupData();
    expect(b.data).not.toHaveProperty('systemWordbookWordsCache');
    expect(b.data).toHaveProperty('favorites');
  });
});

describe('parseBackup 校验', () => {
  beforeEach(() => localStorage.clear());

  it('接受合法备份', () => {
    const parsed = parseBackup(JSON.stringify(collectBackupData()));
    expect(parsed.app).toBe(BACKUP_APP);
  });
  it('非 JSON 抛错', () => {
    expect(() => parseBackup('not json')).toThrow('JSON');
  });
  it('其他应用的备份抛错', () => {
    expect(() => parseBackup(JSON.stringify({ app: 'other', data: {} }))).toThrow('拾词');
  });
  it('缺少 data 抛错', () => {
    expect(() => parseBackup(JSON.stringify({ app: BACKUP_APP }))).toThrow('拾词');
  });
});

describe('fileTimestamp', () => {
  it('格式为 YYYYMMDD-HHMMSS', () => {
    expect(fileTimestamp(new Date(2026, 9, 2, 8, 5, 3))).toBe('20261002-080503');
  });
});
