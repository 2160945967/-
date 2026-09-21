// 通用「弹窗式下拉框」
// 把原生 <select> 视觉隐藏（保留为状态载体，.value / change / options 逻辑全部不变），
// 替换为按钮触发器，点击后弹出居中模态选项列表。
// initPopupSelects 会扫描全文档，并通过 MutationObserver 自动接管后续动态插入的 select。
// 跳过清单：#word-source（由 bookPicker 提供专属弹窗）、.word-source-hidden-select、[data-popup-native]。

import { escapeHtml, openModal, closeModal } from '../global';

// escapeHtml 基于 textContent/innerHTML，不转义双引号，属性内需额外处理
function escapeAttr(text: string): string {
    return escapeHtml(text).replace(/"/g, '&quot;');
}

const ATTR_ENHANCED = 'data-ps-enhanced';
const HIDDEN_CLASS = 'ps-native-hidden';
const OVERLAY_ID = 'ps-overlay';

interface EnhancedSelect {
    select: HTMLSelectElement;
    trigger: HTMLButtonElement;
    labelEl: HTMLSpanElement;
    observer: MutationObserver;
}

const enhancedMap = new WeakMap<HTMLSelectElement, EnhancedSelect>();
let active: EnhancedSelect | null = null;

// 由 bookPicker 专属接管，或元素显式声明保留原生样式时跳过
function shouldSkip(select: HTMLSelectElement): boolean {
    if (select.id === 'word-source') return true;
    if (select.classList.contains('word-source-hidden-select')) return true;
    if (select.hasAttribute('data-popup-native')) return true;
    if (select.closest(`#${OVERLAY_ID}`)) return true;
    return false;
}

function isCompact(select: HTMLSelectElement): boolean {
    return select.matches(
        '.setting-select, .ex-rate-select, .result-wb-select, #export-format, .pronunciation-accent-select'
    );
}

function resolveTitle(select: HTMLSelectElement): string {
    const custom = select.dataset.popupTitle;
    if (custom) return custom;
    const aria = select.getAttribute('aria-label');
    if (aria) return aria;
    if (select.id) {
        const label = document.querySelector(`label[for="${CSS.escape(select.id)}"]`);
        const text = label?.textContent?.trim();
        if (text) return text.replace(/[：:]\s*$/, '');
    }
    const wrapperLabel = select.closest('label')?.textContent?.trim();
    if (wrapperLabel) return wrapperLabel;
    const siblingLabel = select.parentElement?.querySelector('label')?.textContent?.trim();
    if (siblingLabel) return siblingLabel.replace(/[：:]\s*$/, '');
    return '请选择';
}

function syncTrigger(entry: EnhancedSelect): void {
    const { select, labelEl, trigger } = entry;
    const option = select.options[select.selectedIndex];
    labelEl.textContent = option?.textContent?.trim() || '请选择';
    trigger.classList.toggle('ps-placeholder', !option || option.value === '');
    trigger.disabled = select.disabled;
    trigger.setAttribute('aria-expanded', trigger.dataset.open === '1' ? 'true' : 'false');
}

// 重写实例级 value setter：外部代码 select.value = x 时同步按钮文案
function hookValueSetter(entry: EnhancedSelect): void {
    const select = entry.select;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (!descriptor?.get || !descriptor.set) return;
    Object.defineProperty(select, 'value', {
        configurable: true,
        get() { return descriptor.get!.call(this); },
        set(v: string) {
            descriptor.set!.call(this, v);
            const cur = enhancedMap.get(select);
            if (cur) syncTrigger(cur);
        },
    });
}

function enhance(select: HTMLSelectElement): void {
    if (select.hasAttribute(ATTR_ENHANCED) || shouldSkip(select)) return;
    select.setAttribute(ATTR_ENHANCED, '1');
    select.classList.add(HIDDEN_CLASS);
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ps-trigger';
    trigger.dataset.size = isCompact(select) ? 'sm' : 'md';
    if (select.id === 'wordbook-select') trigger.classList.add('ps-trigger-flex');
    if (select.classList.contains('sentence-wb-select')) trigger.classList.add('ps-trigger-full');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.innerHTML =
        '<span class="ps-trigger-label"></span>' +
        '<svg class="ps-trigger-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<polyline points="6 9 12 15 18 9"></polyline></svg>';
    const labelEl = trigger.querySelector('.ps-trigger-label') as HTMLSpanElement;

    const entry: EnhancedSelect = { select, trigger, labelEl, observer: null as unknown as MutationObserver };
    enhancedMap.set(select, entry);

    select.insertAdjacentElement('afterend', trigger);
    hookValueSetter(entry);
    syncTrigger(entry);

    // 选项动态增删 / disabled 切换后刷新按钮
    const observer = new MutationObserver(() => syncTrigger(entry));
    observer.observe(select, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['selected', 'disabled', 'label'],
    });
    entry.observer = observer;

    select.addEventListener('change', () => syncTrigger(entry));
    trigger.addEventListener('click', () => {
        if (!select.disabled) openPopup(entry);
    });
}

// ---------------- 弹窗 ----------------

function ensureOverlay(): HTMLElement {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'modal-overlay custom-prompt-modal ps-overlay';
    overlay.innerHTML = `
        <div class="modal-content ps-dialog" role="dialog" aria-modal="true">
            <div class="ps-dialog-head">
                <span class="ps-dialog-title"></span>
                <button type="button" class="ps-dialog-close" aria-label="关闭">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="ps-options" tabindex="-1"></div>
        </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closePopup();
    });
    overlay.querySelector('.ps-dialog-close')?.addEventListener('click', () => closePopup());
    return overlay;
}

function renderOptions(entry: EnhancedSelect): void {
    const { select } = entry;
    const box = ensureOverlay();
    const list = box.querySelector('.ps-options') as HTMLElement;
    const currentValue = select.value;
    const rows: string[] = [];

    Array.from(select.options).forEach((opt) => {
        const selected = opt.value !== '' && opt.value === currentValue && select.selectedIndex >= 0;
        rows.push(
            `<button type="button" class="ps-option${selected ? ' ps-option-selected' : ''}" data-value="${escapeAttr(opt.value)}"${opt.disabled ? ' disabled' : ''}>` +
            `<span class="ps-option-label">${escapeHtml(opt.textContent?.trim() || opt.value)}</span>` +
            `<svg class="ps-option-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                 <polyline points="20 6 9 17 4 12"></polyline></svg>` +
            `</button>`
        );
    });

    list.innerHTML = rows.length ? rows.join('') : '<div class="ps-empty">暂无可选项</div>';
    list.querySelectorAll<HTMLElement>('.ps-option').forEach((row) => {
        row.addEventListener('click', () => {
            const value = row.dataset.value || '';
            if (select.value !== value) {
                select.value = value;
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            closePopup();
        });
    });

    requestAnimationFrame(() => {
        const selected = list.querySelector<HTMLElement>('.ps-option-selected');
        (selected || list.querySelector<HTMLElement>('.ps-option'))?.focus();
    });
}

function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && active) {
        e.stopPropagation();
        closePopup();
    }
}

function openPopup(entry: EnhancedSelect): void {
    active = entry;
    const overlay = ensureOverlay();
    (overlay.querySelector('.ps-dialog-title') as HTMLElement).textContent = resolveTitle(entry.select);
    entry.trigger.dataset.open = '1';
    renderOptions(entry);
    document.body.classList.add('modal-open');
    openModal(overlay);
    document.addEventListener('keydown', onKeydown, true);
}

function closePopup(): void {
    if (!active) return;
    const overlay = document.getElementById(OVERLAY_ID);
    active.trigger.dataset.open = '0';
    syncTrigger(active);
    active = null;
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', onKeydown, true);
    if (overlay) closeModal(overlay);
}

// ---------------- 初始化 ----------------

export function initPopupSelects(): void {
    const enhanceWithin = (root: ParentNode): void => {
        root.querySelectorAll('select').forEach(el => enhance(el as HTMLSelectElement));
    };
    enhanceWithin(document);

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
            m.addedNodes.forEach((node) => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                const el = node as Element;
                if (el.matches?.('select')) enhance(el as HTMLSelectElement);
                el.querySelectorAll?.('select').forEach(s => enhance(s as HTMLSelectElement));
            });
        });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}
