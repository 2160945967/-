// 单词来源选择器：把测验页的「单词来源」下拉升级为 按钮 + 弹窗
// - 我的词库：收藏 / 错题本 / 自建单词本 / 系统词库（单选，镜像原 select 选项）
// - 四级词书：模块 → 单元 → 课 的树形多选，支持整本 / 整单元 / 多课组合
// 原生 select（#word-source）保留为状态载体（复用既有设置保存 / session / 进度机制），仅做视觉隐藏。

import {
    loadManifest, ensureIndexLoaded, encodeSource, parseSource,
    isStructuredSource, getSourceLabel,
    compareLessonId, ensureDerIndexLoaded, getDerIndexSync,
    type BookManifest,
} from '../utils/structuredBook';
import { escapeHtml, openModal, closeModal, appState } from '../global';
import { updateWordSourceSelect } from './wordbook';

const SELECT_ID = 'word-source';
const MODAL_ID = 'book-picker-modal';
const BTN_ID = 'word-source-pick-btn';
const CB_PREFIX = 'cb:';
const LAST_TAB_KEY = 'bookPickerLastTab';

let manifest: BookManifest | null = null;
let indexData: Record<string, string[]> | null = null;
let derData: Record<string, string[]> | null = null;

function derEnabled(): boolean { return !!appState.settings.includeDerivations; }
/** 某课派生词数量（仅在“词书附带练习派生词”开关开启且索引就绪时计入） */
function derCountFor(id: string): number {
    return derEnabled() && derData ? (derData[id] || []).length : 0;
}

// 弹窗内的临时选择状态
let activeTab: 'mine' | 'cet4' = 'mine';
let selectedLessons = new Set<string>();
let selectAllBook = false;

function getSelect(): HTMLSelectElement | null {
    return document.getElementById(SELECT_ID) as HTMLSelectElement | null;
}

function getPracticedSet(): Set<string> {
    const practiced = new Set<string>();
    const answered = JSON.parse(localStorage.getItem('quizAnsweredWords') || '[]') as string[];
    answered.forEach(w => practiced.add(w));
    try {
        const history = JSON.parse(localStorage.getItem('learningHistory') || '{}') as Record<string, unknown>;
        Object.keys(history).forEach(w => practiced.add(w));
    } catch { /* ignore */ }
    return practiced;
}

/** 统计若干课去重后的词数与已练词数（按词形小写去重） */
function statsForLessons(ids: string[]): { total: number; practiced: number } {
    if (!indexData) return { total: 0, practiced: 0 };
    const practiced = getPracticedSet();
    const seen = new Set<string>();
    let total = 0;
    let done = 0;
    const ordered = ids.slice().sort(compareLessonId);
    ordered.forEach(id => {
        (indexData![id] || []).forEach(w => {
            const key = w.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            total++;
            if (practiced.has(w) || practiced.has(key)) done++;
        });
    });
    // 开关开启时把派生词计入总量/已练（与 collectBookWords 同一套去重口径：主词优先、跨课去重）
    if (derEnabled() && derData) {
        ordered.forEach(id => {
            (derData[id] || []).forEach(w => {
                const key = w.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                total++;
                if (practiced.has(w) || practiced.has(key)) done++;
            });
        });
    }
    return { total, practiced: done };
}

// ---------------- 测验设置区按钮 ----------------

function unwrapLegacyWrapper(select: HTMLSelectElement): void {
    const wrapper = select.closest('.word-source-wrapper');
    if (wrapper && wrapper.parentElement) {
        const display = wrapper.querySelector('.word-source-display');
        display?.remove();
        wrapper.parentElement.insertBefore(select, wrapper);
        wrapper.remove();
    }
}

function ensurePickButton(select: HTMLSelectElement): HTMLButtonElement {
    let btn = document.getElementById(BTN_ID) as HTMLButtonElement | null;
    if (btn) return btn;

    unwrapLegacyWrapper(select);
    select.classList.add('word-source-hidden-select');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;

    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = BTN_ID;
    btn.className = 'word-source-pick-btn';
    btn.innerHTML = `
        <span class="wspb-main">
            <span class="wspb-label">单词来源</span>
            <span class="wspb-name"></span>
        </span>
        <span class="wspb-side">
            <span class="wspb-stats"></span>
            <span class="wspb-chevron">更换 ›</span>
        </span>`;
    btn.addEventListener('click', () => { void openPicker(); });
    select.insertAdjacentElement('afterend', btn);
    return btn;
}

function refreshPickButton(): void {
    const select = getSelect();
    if (!select) return;
    const btn = ensurePickButton(select);
    const option = select.options[select.selectedIndex];
    const name = option?.dataset.name || option?.textContent || '未选择';
    const nameEl = btn.querySelector('.wspb-name');
    const statsEl = btn.querySelector('.wspb-stats');
    if (nameEl) nameEl.textContent = name;
    if (statsEl) {
        const isCb = !!option && (option.value || '').startsWith(CB_PREFIX);
        if (isCb) {
            // 词书名称本身已含单元 / 课信息（如「四级词书·U1（L1、L2）」），
            // 词数与已练统计在选择弹窗内展示，按钮上不再重复拼接括号
            statsEl.textContent = '';
        } else {
            // option 文本形如「名称 （共X词 已练习：Y词 未练习：Z词）」，仅取统计部分
            const full = option?.textContent || '';
            const m = /（[^）]*）/.exec(full);
            statsEl.textContent = m ? m[0] : '';
        }
    }
}

// ---------------- 弹窗开关 ----------------

async function openPicker(): Promise<void> {
    const select = getSelect();
    const modal = document.getElementById(MODAL_ID);
    if (!select || !modal) return;

    // 确保数据就绪
    showLoading(modal);
    setModalVisible(modal, true);
    try {
        const [m, idx] = await Promise.all([
            loadManifest(),
            ensureIndexLoaded(),
            ensureDerIndexLoaded().catch(() => ({})),
        ]);
        manifest = m;
        indexData = idx;
        derData = getDerIndexSync();
    } catch (e) {
        console.error('加载词书目录失败:', e);
    }

    // 回显当前选择（先按当前来源决定初始标签）
    const current = select.value;
    if (isStructuredSource(current)) {
        const parsed = parseSource(current);
        selectAllBook = !!parsed?.all;
        selectedLessons = new Set(parsed?.all ? allLessonIds() : (parsed?.lessonIds || []));
        activeTab = 'cet4';
    } else {
        selectAllBook = false;
        selectedLessons = new Set();
        activeTab = 'mine';
    }
    // 再以「上次退出弹窗时所在标签」为准：用户可能只切到某标签查看、未改来源就关闭
    const lastTab = localStorage.getItem(LAST_TAB_KEY);
    if (lastTab === 'mine' || lastTab === 'cet4') activeTab = lastTab;

    renderModal(select);
    syncOrderSwitch();
}

function closePicker(): void {
    const modal = document.getElementById(MODAL_ID);
    if (modal) setModalVisible(modal, false);
}

function setModalVisible(modal: HTMLElement, visible: boolean): void {
    document.body.classList.toggle('modal-open', visible);
    // 复用全局弹窗开关：openModal 双 rAF 后加 .modal-visible 触发统一淡入，
    // closeModal 先淡出再 display:none；只切 display 会让 .modal-content 停留 opacity:0
    if (visible) openModal(modal);
    else closeModal(modal);
}

function showLoading(modal: HTMLElement): void {
    const body = modal.querySelector('#bp-body') as HTMLElement | null;
    const footer = modal.querySelector('#bp-footer') as HTMLElement | null;
    if (body) body.innerHTML = '<div class="bp-loading">正在加载词书目录…</div>';
    if (footer) footer.style.display = 'none';
}

function allLessonIds(): string[] {
    if (!manifest) return [];
    const ids: string[] = [];
    manifest.parts.forEach(part => part.units.forEach(u => u.lessons.forEach(l => ids.push(l.id))));
    return ids.sort(compareLessonId);
}

// ---------------- 渲染 ----------------

function renderModal(select: HTMLSelectElement): void {
    renderTabs();
    if (activeTab === 'mine') renderMineTab(select);
    else renderCetTab();
}

function renderTabs(): void {
    const mineTab = document.getElementById('bp-tab-mine');
    const cetTab = document.getElementById('bp-tab-cet4');
    if (!mineTab || !cetTab) return;
    mineTab.classList.toggle('bp-tab-active', activeTab === 'mine');
    cetTab.classList.toggle('bp-tab-active', activeTab === 'cet4');
    mineTab.setAttribute('aria-selected', String(activeTab === 'mine'));
    cetTab.setAttribute('aria-selected', String(activeTab === 'cet4'));
    mineTab.tabIndex = activeTab === 'mine' ? 0 : -1;
    cetTab.tabIndex = activeTab === 'cet4' ? 0 : -1;
    const body = document.getElementById('bp-body');
    if (body) body.setAttribute('aria-labelledby', activeTab === 'mine' ? 'bp-tab-mine' : 'bp-tab-cet4');
    const footer = document.getElementById('bp-footer');
    if (footer) footer.style.display = activeTab === 'cet4' ? 'flex' : 'none';
}

function renderMineTab(select: HTMLSelectElement): void {
    const body = document.getElementById('bp-body') as HTMLElement | null;
    if (!body) return;
    const current = select.value;
    const rows: string[] = [];
    Array.from(select.options).forEach(opt => {
        const value = opt.value;
        if (value.startsWith(CB_PREFIX)) return; // 四级词书在另一标签
        const name = opt.dataset.name || opt.textContent || value;
        const statsMatch = /（[^）]*）/.exec(opt.textContent || '');
        const active = value === current && !current.startsWith(CB_PREFIX);
        rows.push(`
            <button type="button" class="bp-source-row${active ? ' bp-row-active' : ''}" data-value="${escapeHtml(value)}">
                <span class="bp-radio ${active ? 'bp-radio-on' : ''}"></span>
                <span class="bp-source-name">${escapeHtml(name)}</span>
                <span class="bp-source-stats">${statsMatch ? escapeHtml(statsMatch[0]) : ''}</span>
            </button>`);
    });
    body.innerHTML = `<div class="bp-section-hint">选择一个已有的单词来源，点击即可立即切换：</div><div class="bp-source-list">${rows.join('') || '<div class="bp-empty">暂无可用来源</div>'}</div>`;

    body.querySelectorAll<HTMLElement>('.bp-source-row').forEach(row => {
        row.addEventListener('click', () => {
            const value = row.dataset.value || '';
            applySimpleSource(value);
        });
    });
}

function renderCetTab(): void {
    const body = document.getElementById('bp-body') as HTMLElement | null;
    if (!body || !manifest) {
        if (body) body.innerHTML = '<div class="bp-empty">词书目录加载失败，请检查资源文件后重试。</div>';
        return;
    }
    const practiced = getPracticedSet();
    const allTotal = statsForLessons(allLessonIds()).total;
    const derNote = derEnabled() ? '（含派生词）' : '';
    // 单元按编号数字排序（数据数组可能是字符串序，导致 Unit 10 排到 Unit 2 前）
    const unitNum = (u: any): number => {
        const mm = /(\d+)/.exec(u.name || '');
        if (mm) return parseInt(mm[1]);
        return (u.lessons && u.lessons.length) ? Math.min(...u.lessons.map((l: any) => l.idx)) : 9999;
    };
    const partsHtml = manifest.parts.map(part => {
        const unitsHtml = part.units.slice().sort((a: any, b: any) => unitNum(a) - unitNum(b)).map(unit => {
            const lessonIds = unit.lessons.map(l => l.id);
            const checkedCount = lessonIds.filter(id => selectedLessons.has(id)).length;
            const unitState = checkedCount === 0 ? 'none' : checkedCount === lessonIds.length ? 'all' : 'some';
            const lessonsHtml = unit.lessons.map(l => {
                const mainDone = (indexData?.[l.id] || []).filter(w => practiced.has(w)).length;
                const derDone = derEnabled() && derData ? (derData[l.id] || []).filter(w => practiced.has(w)).length : 0;
                const done = mainDone + derDone;
                const checked = selectedLessons.has(l.id) && !selectAllBook;
                const disabled = selectAllBook;
                return `
                    <label class="bp-lesson-row${disabled ? ' bp-disabled' : ''}">
                        <input type="checkbox" data-lesson="${l.id}" ${checked || selectAllBook ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
                        <span class="bp-lesson-name">L${l.idx}</span>
                        <span class="bp-lesson-meta">${l.count + derCountFor(l.id)}词 · 已练${done}</span>
                    </label>`;
            }).join('');
            const unitStats = statsForLessons(lessonIds);
            return `
                <div class="bp-unit" data-unit>
                    <label class="bp-unit-head">
                        <input type="checkbox" class="bp-unit-check" data-unit-ids="${lessonIds.join(',')}"
                            ${unitState === 'all' || selectAllBook ? 'checked' : ''}
                            ${selectAllBook ? 'disabled' : ''}
                            data-state="${unitState}">
                        <span class="bp-unit-title">${escapeHtml(unit.name)}</span>
                        <span class="bp-unit-meta">${unit.lessons.length}课 · ${unitStats.total}词 · 已练${unitStats.practiced}</span>
                    </label>
                    <div class="bp-lesson-grid">${lessonsHtml}</div>
                </div>`;
        }).join('');
        return `<div class="bp-part"><div class="bp-part-title">${escapeHtml(part.name)}</div>${unitsHtml}</div>`;
    }).join('');

    const totalStats = selectAllBook
        ? { total: allTotal, practiced: statsForLessons(allLessonIds()).practiced }
        : statsForLessons([...selectedLessons]);

    body.innerHTML = `
        <div class="bp-book-head">
            <label class="bp-all-book">
                <input type="checkbox" id="bp-all-book" ${selectAllBook ? 'checked' : ''}>
                <span class="bp-all-book-title">整本词书（${allTotal} 词${derEnabled() ? '，含派生词' : ''}）</span>
            </label>
            <div class="bp-book-desc">${escapeHtml(manifest.author ? '编著：' + manifest.author : '')}　共 ${manifest.lessonCount} 课 · 已练 ${totalStats.practiced} 词 ${derNote}</div>
            <label class="bp-der-toggle" title="开启后每个主词的派生词作为独立词条，紧跟主词练习">
                <input type="checkbox" id="bp-der-toggle" ${derEnabled() ? 'checked' : ''}>
                <span class="bp-der-toggle-label">附带练习派生词<span class="bp-der-sub">开启后全本 4499 主词 + 1528 派生词 = 6027 词，派生词紧跟对应主词</span></span>
            </label>
        </div>
        <div class="bp-tree">${partsHtml}</div>`;

    // 整本
    const allCheckbox = body.querySelector('#bp-all-book') as HTMLInputElement | null;
    if (allCheckbox) {
        // 选了部分课时，整本框显示原生半选横线
        allCheckbox.indeterminate = !selectAllBook && selectedLessons.size > 0
            && selectedLessons.size < allLessonIds().length;
        allCheckbox.addEventListener('change', () => {
            if (allCheckbox.checked) {
                selectAllBook = true;
                selectedLessons = new Set(allLessonIds());
            } else {
                // 取消整本：清空全部选择
                selectAllBook = false;
                selectedLessons = new Set();
            }
            renderCetTab();
            updateFooter();
        });
    }

    // 派生词开关：直接写 settings（store proxy 自动持久化到 quizSettings），同步设置页开关并重算计数
    const derToggle = body.querySelector('#bp-der-toggle') as HTMLInputElement | null;
    if (derToggle) {
        derToggle.addEventListener('change', () => {
            appState.settings.includeDerivations = derToggle.checked;
            const syncInSettings = document.getElementById('include-derivations') as HTMLInputElement | null;
            if (syncInSettings) syncInSettings.checked = derToggle.checked;
            renderCetTab();
            updateFooter();
        });
    }

    // 单元三态
    body.querySelectorAll<HTMLInputElement>('.bp-unit-check').forEach(cb => {
        cb.indeterminate = cb.dataset.state === 'some'; // 部分课选中：原生半选横线
        cb.addEventListener('change', () => {
            const ids = (cb.dataset.unitIds || '').split(',').filter(Boolean);
            const state = cb.dataset.state || 'none';
            if (state === 'all') ids.forEach(id => selectedLessons.delete(id));
            else ids.forEach(id => selectedLessons.add(id));
            renderCetTab();
            updateFooter();
        });
    });

    // 单课
    body.querySelectorAll<HTMLInputElement>('input[data-lesson]').forEach(cb => {
        cb.addEventListener('change', () => {
            const id = cb.dataset.lesson || '';
            if (cb.checked) selectedLessons.add(id);
            else selectedLessons.delete(id);
            renderCetTab();
            updateFooter();
        });
    });

    updateFooter();
}

function updateFooter(): void {
    const footer = document.getElementById('bp-footer');
    if (!footer || !manifest) return;
    const info = footer.querySelector('#bp-footer-info') as HTMLElement | null;
    if (selectAllBook) {
        if (info) info.textContent = `将练习整本词书，共 ${statsForLessons(allLessonIds()).total} 词${derEnabled() ? '（含派生词）' : ''}`;
    } else {
        const stats = statsForLessons([...selectedLessons]);
        if (info) {
            info.textContent = selectedLessons.size === 0
                ? '尚未选择课程'
                : `已选 ${selectedLessons.size} 课，去重后共 ${stats.total} 词（${derEnabled() ? '含派生词，' : ''}已练 ${stats.practiced}）`;
        }
    }
    const confirmBtn = footer.querySelector('#bp-confirm') as HTMLButtonElement | null;
    if (confirmBtn) confirmBtn.disabled = !selectAllBook && selectedLessons.size === 0;
}

// ---------------- 应用选择 ----------------

function applySimpleSource(value: string): void {
    const select = getSelect();
    if (!select) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    closePicker();
    refreshPickButton();
}

async function applyCetSource(): Promise<void> {
    const select = getSelect();
    if (!select) return;
    if (!selectAllBook && selectedLessons.size === 0) return;
    const source = encodeSource(selectAllBook ? 'all' : [...selectedLessons]);

    // 在隐藏 select 中准备对应 option
    let opt = Array.from(select.options).find(o => o.value.startsWith(CB_PREFIX));
    if (!opt) {
        opt = document.createElement('option');
        select.appendChild(opt);
    }
    opt.value = source;
    opt.dataset.name = getSourceLabel(source);
    select.value = source;

    closePicker();
    select.dispatchEvent(new Event('change', { bubbles: true }));
    // 刷新统计（异步，会保留当前 cb option），随后刷新按钮
    await updateWordSourceSelect();
    refreshPickButton();
}

// ---------------- 出题顺序开关（镜像测验页 #quiz-order） ----------------
function syncOrderSwitch(): void {
    const orderSelect = document.getElementById('quiz-order') as HTMLSelectElement | null;
    const val = orderSelect ? orderSelect.value : 'random';
    document.querySelectorAll<HTMLElement>('.bp-order-opt').forEach(btn => {
        btn.classList.toggle('bp-order-active', btn.dataset.order === val);
    });
}

// ---------------- 初始化 ----------------

export function initBookPicker(): void {
    const select = getSelect();
    if (!select) return;
    ensurePickButton(select);
    refreshPickButton();

    // 词源数据刷新 / 选择变化时更新按钮
    select.addEventListener('word-source-updated', () => refreshPickButton());
    window.addEventListener('storage', () => refreshPickButton());

    // tab 切换
    document.getElementById('bp-tab-mine')?.addEventListener('click', () => {
        activeTab = 'mine';
        localStorage.setItem(LAST_TAB_KEY, 'mine');
        const sel = getSelect();
        if (sel) renderModal(sel);
    });
    document.getElementById('bp-tab-cet4')?.addEventListener('click', () => {
        activeTab = 'cet4';
        localStorage.setItem(LAST_TAB_KEY, 'cet4');
        const sel = getSelect();
        if (sel) renderModal(sel);
    });

    // 标签键盘导航：左右方向键切换，Home/End 跳到首尾
    document.querySelector('.bp-tabs')?.addEventListener('keydown', (e: KeyboardEvent) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const order: Array<'mine' | 'cet4'> = ['mine', 'cet4'];
        let idx = order.indexOf(activeTab);
        if (e.key === 'ArrowLeft') idx = (idx + order.length - 1) % order.length;
        else if (e.key === 'ArrowRight') idx = (idx + 1) % order.length;
        else if (e.key === 'Home') idx = 0;
        else idx = order.length - 1;
        activeTab = order[idx];
        localStorage.setItem(LAST_TAB_KEY, order[idx]);
        const sel = getSelect();
        if (sel) renderModal(sel);
        document.getElementById(order[idx] === 'mine' ? 'bp-tab-mine' : 'bp-tab-cet4')?.focus();
    });

    // 出题顺序：顺序 / 乱序（写回隐藏的 #quiz-order 并触发其持久化逻辑）
    document.querySelectorAll<HTMLButtonElement>('.bp-order-opt').forEach(btn => {
        btn.addEventListener('click', () => {
            const orderSelect = document.getElementById('quiz-order') as HTMLSelectElement | null;
            if (!orderSelect) return;
            orderSelect.value = btn.dataset.order === 'order' ? 'order' : 'random';
            orderSelect.dispatchEvent(new Event('change', { bubbles: true }));
            syncOrderSwitch();
        });
    });
    syncOrderSwitch();

    // 关闭 / 取消 / 确定 / 遮罩点击
    document.getElementById('bp-close')?.addEventListener('click', () => closePicker());
    document.getElementById('bp-cancel')?.addEventListener('click', () => closePicker());
    document.getElementById('bp-confirm')?.addEventListener('click', () => { void applyCetSource(); });
    const modal = document.getElementById(MODAL_ID);
    modal?.addEventListener('click', e => { if (e.target === modal) closePicker(); });
}
