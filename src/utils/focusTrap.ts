// 弹窗焦点陷阱：打开时焦点移入、Tab/Shift+Tab 在弹窗内循环、关闭后焦点回到触发元素
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
}

export interface TrapHandle { release: () => void; }

/**
 * 在 container 上建立焦点陷阱。
 * @param initial 初始聚焦元素（须在 container 内），默认第一个可聚焦元素
 */
export function trapFocus(container: HTMLElement, initial?: HTMLElement | null): TrapHandle {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  // 兜底：让容器本身可编程聚焦
  const hadTabIndex = container.hasAttribute('tabindex');
  const oldTabIndex = container.getAttribute('tabindex');
  if (!hadTabIndex) container.setAttribute('tabindex', '-1');

  function moveInitial(): void {
    const target = initial && container.contains(initial)
      ? initial
      : getFocusableElements(container)[0] || container;
    try { target.focus(); } catch { container.focus(); }
  }
  moveInitial();

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const items = getFocusableElements(container);
    if (!items.length) { e.preventDefault(); container.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) { e.preventDefault(); last.focus(); }
    } else {
      if (active === last || !container.contains(active)) { e.preventDefault(); first.focus(); }
    }
  }
  container.addEventListener('keydown', onKeydown, true);

  let released = false;
  function release(): void {
    if (released) return;
    released = true;
    container.removeEventListener('keydown', onKeydown, true);
    if (hadTabIndex) container.setAttribute('tabindex', oldTabIndex as string);
    else container.removeAttribute('tabindex');
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      try { previouslyFocused.focus(); } catch { /* ignore */ }
    }
  }
  return { release };
}
