// 首次进入「学习类别」选择弹窗：选项与侧边栏学习类别一致
// （小学 / 中考 / 高考 / 四级 / 六级 / 专四 / 专八 / 考研 / 托福 / 雅思 / GRE），可跳过（默认小学）。
// 选择结果：设置侧边栏 exam-category 并持久化，同时同步设置页粗粒度 settings.grade。
// 仅首次进入弹出（gradeChosen 标记）。

import { appState, openModal, closeModal } from '../global';
import { GradeLevel } from '../types/enums';

const GRADE_CHOSEN_KEY = 'gradeChosen';

/** 学习类别（exam-category 的值）→ 设置页粗粒度学段 grade */
const CATEGORY_GRADE: Record<string, GradeLevel> = {
    xx: GradeLevel.Primary,
    zk: GradeLevel.Junior,
    gk: GradeLevel.Senior,
    cet4: GradeLevel.College,
    cet6: GradeLevel.College,
    tem4: GradeLevel.College,
    tem8: GradeLevel.College,
    ky: GradeLevel.College,
    toefl: GradeLevel.College,
    ielts: GradeLevel.College,
    gre: GradeLevel.College,
};

export function initGradeModal(): void {
    // 已选择或已跳过，不再弹出
    if (localStorage.getItem(GRADE_CHOSEN_KEY)) return;
    const overlay = document.getElementById('grade-modal');
    if (!overlay) return;

    const choose = (category: string): void => {
        localStorage.setItem(GRADE_CHOSEN_KEY, '1');
        appState.settings.grade = CATEGORY_GRADE[category] || GradeLevel.Primary; // store 自动持久化
        // 直接设置侧边栏学习类别并触发 change（联动词库/难度）
        const sel = document.getElementById('exam-category') as HTMLSelectElement | null;
        if (sel) {
            sel.value = category;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        closeModal(overlay);
    };

    overlay.addEventListener('click', (e: MouseEvent) => {
        const opt = (e.target as HTMLElement).closest('.grade-option') as HTMLElement | null;
        if (opt) {
            choose((opt.dataset.category as string) || 'xx');
            return;
        }
        if ((e.target as HTMLElement).id === 'grade-skip') choose('xx');
    });

    // 延迟弹出，等首页渲染与初始化完成
    window.setTimeout(() => openModal(overlay), 700);
}
