// 学习数据全量备份 / 恢复 / 自动备份
import { showConfirm } from '../global';
import { showToast } from './gsap';

export const BACKUP_APP = 'pick-up-words';
export const BACKUP_VERSION = 1;
const AUTO_BACKUP_KEY = 'autoBackupEnabled';
const AUTO_BACKUP_INTERVAL = 60_000;

// 备份时排除：纯缓存、可自动重建的数据
const EXCLUDE_KEYS = new Set(['systemWordbookWordsCache']);

export interface BackupFile {
  app: string;
  version: number;
  exportedAt: string;
  data: Record<string, string>;
}
export interface BackupMeta { name: string; size: number; mtime: string; }

/** 收集当前 localStorage 全量数据（排除可重建缓存） */
export function collectBackupData(): BackupFile {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || EXCLUDE_KEYS.has(k)) continue;
    data[k] = localStorage.getItem(k) ?? '';
  }
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }
export function fileTimestamp(d = new Date()): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportBackupManually(): void {
  const payload = collectBackupData();
  downloadText(`拾词备份_${fileTimestamp()}.json`, JSON.stringify(payload, null, 2));
  showToast('已导出全部学习数据', 'success');
}

export function parseBackup(text: string): BackupFile {
  let obj: any;
  try { obj = JSON.parse(text); } catch { throw new Error('文件不是有效的 JSON'); }
  if (!obj || obj.app !== BACKUP_APP || !obj.data || typeof obj.data !== 'object') {
    throw new Error('文件不是拾词的有效备份');
  }
  return obj as BackupFile;
}

/** 用备份覆盖恢复：先写后端 wordbooks.json，再覆盖 localStorage */
export async function restoreFromBackup(backup: BackupFile): Promise<void> {
  try {
    await fetch('/api/backup/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: backup.data }),
    });
  } catch { /* 后端不可达则仅恢复 localStorage */ }
  for (const k of Object.keys(backup.data)) localStorage.setItem(k, backup.data[k]);
}

async function fetchBackupContent(name: string): Promise<BackupFile> {
  const r = await fetch(`/api/backup/file/${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error('读取备份失败');
  return parseBackup(await r.text());
}

async function confirmAndRestore(backup: BackupFile, label: string): Promise<void> {
  const ok = await showConfirm(
    `将用备份「${label}」覆盖当前所有学习数据。\n建议先点「导出全部数据」留底。\n是否继续？`,
    '恢复备份'
  );
  if (!ok) return;
  await restoreFromBackup(backup);
  showToast('数据已恢复，即将刷新', 'success');
  skipAutoBackupOnNextUnload();
  setTimeout(() => location.reload(), 900);
}

export async function importBackupFromFile(file: File): Promise<void> {
  let backup: BackupFile;
  try {
    backup = parseBackup(await file.text());
  } catch (e: any) {
    showToast(e?.message || '备份文件无效', 'error');
    return;
  }
  await confirmAndRestore(backup, file.name);
}

// ---------------- 自动备份 ----------------
export function isAutoBackupEnabled(): boolean {
  return localStorage.getItem(AUTO_BACKUP_KEY) !== '0';
}
export function setAutoBackupEnabled(on: boolean): void {
  localStorage.setItem(AUTO_BACKUP_KEY, on ? '1' : '0');
}

let lastAutoAt = 0;
let autoInFlight = false;
function postAutoBackup(): void {
  if (autoInFlight) return;
  autoInFlight = true;
  const payload = collectBackupData();
  fetch('/api/backup/auto', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => undefined)
    .finally(() => { autoInFlight = false; });
}

/** 答题活动：节流，约每分钟最多写一份 */
export function notifyActivity(): void {
  if (!isAutoBackupEnabled()) return;
  const now = Date.now();
  if (now - lastAutoAt < AUTO_BACKUP_INTERVAL) return;
  lastAutoAt = now;
  postAutoBackup();
}

/** 立即备份（一轮结束等） */
export function backupNow(): void {
  if (!isAutoBackupEnabled()) return;
  lastAutoAt = Date.now();
  postAutoBackup();
}

let skipNextUnloadBackup = false;
/** 程序主动 reload（如恢复数据）前调用：跳过这一次 beforeunload 自动备份，避免产生内容相同的冗余备份 */
export function skipAutoBackupOnNextUnload(): void { skipNextUnloadBackup = true; }

/** 注册退出 / 关机时的自动备份（sendBeacon，keepalive 兜底） */
export function initAutoBackup(): void {
  window.addEventListener('beforeunload', () => {
    if (skipNextUnloadBackup) { skipNextUnloadBackup = false; return; }
    if (!isAutoBackupEnabled()) return;
    const blob = new Blob([JSON.stringify(collectBackupData())], { type: 'application/json' });
    let sent = false;
    try { sent = navigator.sendBeacon('/api/backup/auto', blob); } catch { sent = false; }
    if (!sent) {
      try { fetch('/api/backup/auto', { method: 'POST', body: blob, keepalive: true }); } catch { /* ignore */ }
    }
  });
}

// ---------------- 备份列表 UI ----------------
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}
function formatTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export async function fetchBackupList(): Promise<BackupMeta[]> {
  const r = await fetch('/api/backup/list');
  const j = await r.json();
  if (!j.success) throw new Error(j?.error?.message || '获取备份列表失败');
  return j.data as BackupMeta[];
}

async function renderBackupList(): Promise<void> {
  const box = document.getElementById('backup-list');
  if (!box) return;
  box.innerHTML = '<span class="backup-empty">加载中…</span>';
  let items: BackupMeta[];
  try { items = await fetchBackupList(); }
  catch (e: any) { box.innerHTML = `<span class="backup-empty">${e?.message || '加载失败'}</span>`; return; }
  if (!items.length) { box.innerHTML = '<span class="backup-empty">暂无备份</span>'; return; }
  box.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'backup-item';
    row.dataset.name = it.name;
    row.innerHTML = `
      <span class="backup-item-name"></span>
      <span class="backup-item-meta">${formatTime(it.mtime)} · ${formatSize(it.size)}</span>
      <span class="backup-item-actions">
        <button class="btn-small" data-act="restore">恢复</button>
        <button class="btn-small" data-act="download">下载</button>
        <button class="btn-small" data-act="delete">删除</button>
      </span>`;
    (row.querySelector('.backup-item-name') as HTMLElement).textContent = it.name;
    box.appendChild(row);
  }
}

export function initBackupUI(): void {
  const exportBtn = document.getElementById('backup-export');
  const importBtn = document.getElementById('backup-import');
  const importFile = document.getElementById('backup-import-file') as HTMLInputElement | null;
  const autoBox = document.getElementById('auto-backup') as HTMLInputElement | null;
  const refreshBtn = document.getElementById('backup-refresh');
  const listBox = document.getElementById('backup-list');

  exportBtn?.addEventListener('click', () => exportBackupManually());
  importBtn?.addEventListener('click', () => importFile?.click());
  importFile?.addEventListener('change', () => {
    const f = importFile.files?.[0];
    if (f) void importBackupFromFile(f);
    importFile.value = '';
  });
  if (autoBox) {
    autoBox.checked = isAutoBackupEnabled();
    autoBox.addEventListener('change', () => {
      setAutoBackupEnabled(autoBox.checked);
      showToast(autoBox.checked ? '已开启自动备份' : '已关闭自动备份', 'info');
      if (autoBox.checked) backupNow();
    });
  }
  refreshBtn?.addEventListener('click', () => void renderBackupList());

  listBox?.addEventListener('click', (e: Event) => {
    const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
    if (!btn) return;
    const row = btn.closest('.backup-item') as HTMLElement;
    const name = row.dataset.name || '';
    const act = btn.dataset.act;
    if (act === 'download') {
      const a = document.createElement('a');
      a.href = `/api/backup/file/${encodeURIComponent(name)}`; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
    } else if (act === 'delete') {
      void (async () => {
        const ok = await showConfirm(`确定删除备份「${name}」？`, '删除备份');
        if (!ok) return;
        const r = await fetch(`/api/backup/file/${encodeURIComponent(name)}`, { method: 'DELETE' });
        if (r.ok) { showToast('已删除', 'success'); void renderBackupList(); }
        else showToast('删除失败', 'error');
      })();
    } else if (act === 'restore') {
      void (async () => {
        try { await confirmAndRestore(await fetchBackupContent(name), name); }
        catch (e: any) { showToast(e?.message || '读取备份失败', 'error'); }
      })();
    }
  });

  void renderBackupList();
}
