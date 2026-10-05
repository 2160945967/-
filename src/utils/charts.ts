// 记忆数据可视化：零依赖手绘 SVG（契合 GSAP、不增加打包体积）
// 图表：每日练习（单词数 / 时长，可切换）、到期词分布、留存率环、遗忘曲线
// 落点：复习页「记忆数据看板」。数据来源 learningHistory / dailyLog / ts-fsrs。

import { safeParse } from './storage';
import { getDailyLogForMonth, getEarliestLogMonth } from './gamification';
import { curveRetention, FSRS_TARGET_RETENTION } from './scheduler';

const NS = 'http://www.w3.org/2000/svg';
function svg(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, String(v)));
    return e;
}
function fmtDurationCompact(sec: number): string {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m}m`;
    return `${(m / 60).toFixed(1)}h`;
}
/** 完整可读时长（悬浮提示用）：如 4分46秒 / 1小时3分 / 0秒 */
function fmtDurationFull(sec: number): string {
    if (sec <= 0) return '0秒';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    let r = '';
    if (h) r += `${h}小时`;
    if (m) r += `${m}分`;
    if (s || !r) r += `${s}秒`;
    return r;
}

// ---------------- 通用柱状图 ----------------
function barChart(
    host: HTMLElement,
    values: number[],
    labels: string[],
    color: string = 'var(--accent, #4da3ff)',
): void {
    host.innerHTML = '';
    const W = 720, H = 240, padL = 44, padR = 12, padT = 14, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'mc-svg' });
    const max = Math.max(1, ...values);
    // 网格 + y 刻度（4 段）
    for (let i = 0; i <= 4; i++) {
        const y = padT + plotH - (plotH * i) / 4;
        root.appendChild(svg('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'mc-grid' }));
        const t = svg('text', { x: padL - 6, y: y + 4, class: 'mc-axis', 'text-anchor': 'end' });
        t.textContent = String(Math.round((max * i) / 4));
        root.appendChild(t);
    }
    const n = values.length, bw = plotW / n;
    values.forEach((v, i) => {
        const h = (v / max) * plotH;
        const x = padL + bw * i + bw * 0.2;
        const y = padT + plotH - h;
        const r = svg('rect', { x, y, width: Math.max(1, bw * 0.6), height: Math.max(0, h), rx: 3, class: 'mc-bar', fill: color });
        const title = svg('title'); title.textContent = `${labels[i]}：${v}`; r.appendChild(title);
        root.appendChild(r);
        const lbl = svg('text', { x: x + bw * 0.3, y: H - 10, class: 'mc-axis', 'text-anchor': 'middle' });
        lbl.textContent = labels[i];
        root.appendChild(lbl);
    });
    host.appendChild(root);
}

// ---------------- 通用面积折线 ----------------
function areaChart(
    host: HTMLElement,
    values: number[],
    labels: string[],
    yMax?: number,
    yFmt: (v: number) => string = String,
): void {
    host.innerHTML = '';
    const W = 720, H = 240, padL = 48, padR = 12, padT = 14, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'mc-svg' });
    const max = yMax ?? Math.max(1, ...values);
    for (let i = 0; i <= 4; i++) {
        const y = padT + plotH - (plotH * i) / 4;
        root.appendChild(svg('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'mc-grid' }));
        const t = svg('text', { x: padL - 6, y: y + 4, class: 'mc-axis', 'text-anchor': 'end' });
        t.textContent = yFmt(max * i / 4);
        root.appendChild(t);
    }
    const n = values.length;
    const X = (i: number) => padL + (plotW * i) / Math.max(1, n - 1);
    const Y = (v: number) => padT + plotH - (Math.min(max, v) / max) * plotH;
    let line = '', area = '';
    values.forEach((v, i) => {
        const x = X(i), y = Y(v);
        line += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
        area += (i === 0 ? `M${x.toFixed(1)} ${(padT + plotH).toFixed(1)} L` : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    });
    area += ` L${X(n - 1).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;
    root.appendChild(svg('path', { d: area, class: 'mc-area' }));
    root.appendChild(svg('path', { d: line, class: 'mc-line', fill: 'none' }));
    // x 标签：约 6 个
    const step = Math.max(1, Math.floor(n / 6));
    for (let i = 0; i < n; i += step) {
        const t = svg('text', { x: X(i), y: H - 10, class: 'mc-axis', 'text-anchor': 'middle' });
        t.textContent = labels[i];
        root.appendChild(t);
    }
    host.appendChild(root);
}

// ---------------- 每日练习折线（按月查看、可横向拖动） ----------------
type DailyMode = 'words' | 'seconds';
const dailyState = { year: 0, month: 0, mode: 'words' as DailyMode };
const SLOT = 46;            // 每天固定宽度：点舒展、超出宽度可横向滚动
const LH = 260, LpadT = 16, LpadB = 36;
const LplotH = LH - LpadT - LpadB;

/** 生成规整的 Y 轴最大值（1/2/2.5/5×10ⁿ） */
function niceMax(raw: number): number {
    if (raw <= 5) return Math.ceil(raw);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    let nice: number;
    if (n <= 1) nice = 1;
    else if (n <= 2) nice = 2;
    else if (n <= 2.5) nice = 2.5;
    else if (n <= 5) nice = 5;
    else nice = 10;
    return nice * mag;
}

function initDailyState(): void {
    if (dailyState.year === 0) {
        const now = new Date();
        dailyState.year = now.getFullYear();
        dailyState.month = now.getMonth();
    }
}

/** 在横向滚动容器上启用“按住左右拖动平移”，move/up 在松手时解绑，避免泄漏 */
function enableDragPan(sc: HTMLElement): void {
    let down = false, sx = 0, sl = 0;
    const move = (e: MouseEvent) => { if (down) sc.scrollLeft = sl - (e.pageX - sx); };
    const up = () => {
        down = false;
        sc.classList.remove('is-dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
    };
    sc.addEventListener('mousedown', (e: MouseEvent) => {
        down = true; sx = e.pageX; sl = sc.scrollLeft;
        sc.classList.add('is-dragging');
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        e.preventDefault();
    });
}

function renderDailyCard(): void {
    initDailyState();
    const card = document.getElementById('md-daily-card');
    if (!card) return;

    const data = getDailyLogForMonth(dailyState.year, dailyState.month);
    const now = new Date();
    const isCurMonth = dailyState.year === now.getFullYear() && dailyState.month === now.getMonth();
    const earliest = getEarliestLogMonth();
    const atEarliest = dailyState.year < earliest.year
        || (dailyState.year === earliest.year && dailyState.month <= earliest.month);
    const mode = dailyState.mode;
    const values = data.map(d => (mode === 'words' ? d.entry.words : d.entry.seconds));
    const max = niceMax(Math.max(1, ...values));
    const fmt = mode === 'words' ? (v: number) => String(Math.round(v)) : fmtDurationCompact;
    const yOf = (v: number) => LpadT + LplotH - (Math.min(max, v) / max) * LplotH;

    const n = data.length;
    const scrollW = 10 + Math.max(1, n) * SLOT + 12;
    const xOf = (i: number) => 10 + SLOT * i + SLOT / 2;

    // Y 刻度：小整数(max<=5)逐整数标，大值分 4 段，避免出现 0,0,1,1,1
    const tickFractions: number[] = Number.isInteger(max) && max <= 5
        ? Array.from({ length: max + 1 }, (_, i) => i / max)
        : [0, 0.25, 0.5, 0.75, 1];
    let yTicks = '', hgrid = '';
    tickFractions.forEach(fr => {
        const y = LpadT + LplotH - LplotH * fr;
        yTicks += `<text x="40" y="${(y + 4).toFixed(1)}" class="mc-axis" text-anchor="end">${fmt(max * fr)}</text>`;
        hgrid += `<line x1="0" y1="${y.toFixed(1)}" x2="${scrollW}" y2="${y.toFixed(1)}" class="mc-grid"/>`;
    });
    // 折线、点、X 标签
    let line = '', pts = '', xlbl = '', extras = '';
    const lastDate = n ? data[n - 1].date : '';
    data.forEach((d, i) => {
        const x = xOf(i), y = yOf(values[i]);
        line += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
        const isToday = isCurMonth && d.date === lastDate;
        const valText = mode === 'words' ? `${values[i]} 词` : fmtDurationFull(values[i]);
        pts += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isToday ? 6 : 5}" class="${isToday ? 'mc-pt mc-pt-today' : 'mc-pt'}" data-tip="${d.date}｜${valText}"></circle>`;
        const dayNo = Number(d.date.slice(8));
        xlbl += `<text x="${x.toFixed(1)}" y="${LH - 12}" class="mc-day-lbl ${dayNo === 1 ? 'mc-day-month' : ''}" text-anchor="middle">${dayNo === 1 ? d.date.slice(5) : dayNo}</text>`;
        if (isToday) extras += `<line x1="${x.toFixed(1)}" y1="${LpadT}" x2="${x.toFixed(1)}" y2="${(LpadT + LplotH).toFixed(1)}" class="mc-today-line"/>`;
    });

    card.innerHTML = `
      <div class="md-card-head">
        <h4>每日练习</h4>
        <div class="md-head-tools">
          <div class="md-month" role="group" aria-label="切换月份">
            <button type="button" class="md-month-btn" data-action="prev-month" ${atEarliest ? 'disabled' : ''} aria-label="上一月">‹</button>
            <span class="md-month-name">${dailyState.year} 年 ${dailyState.month + 1} 月</span>
            <button type="button" class="md-month-btn" data-action="next-month" ${isCurMonth ? 'disabled' : ''} aria-label="下一月">›</button>
          </div>
          <div class="md-toggle" role="tablist" aria-label="切换统计口径">
            <button type="button" class="md-toggle-btn ${mode === 'words' ? 'is-active' : ''}" data-md="words" role="tab">单词数</button>
            <button type="button" class="md-toggle-btn ${mode === 'seconds' ? 'is-active' : ''}" data-md="seconds" role="tab">学习时长</button>
          </div>
        </div>
      </div>
      <div class="md-line-wrap">
        <svg width="44" height="${LH}" viewBox="0 0 44 ${LH}" class="mc-lc-y">${yTicks}</svg>
        <div class="md-scroll" id="md-daily-scroll">
          <svg width="${scrollW}" height="${LH}" viewBox="0 0 ${scrollW} ${LH}" class="mc-lc-svg">
            ${hgrid}${extras}
            <path d="${line}" class="mc-daily-line"/>
            ${pts}${xlbl}
          </svg>
        </div>
      </div>
      <p class="md-scroll-hint">按住图表左右拖动，可查看本月更早的练习；数据按月长期保留，用上方 ‹ › 切换月份。</p>`;

    const sc = document.getElementById('md-daily-scroll');
    if (sc) {
        sc.scrollLeft = isCurMonth ? sc.scrollWidth : 0;  // 当前月定位到今天，历史月从月初
        enableDragPan(sc);
    }
}

/** 相对今天偏移 n 天的日期标签 MM-DD（按电脑本地日期） */
function mdDate(offset: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderDueDistribution(host: HTMLElement): void {
    host.innerHTML = '';
    const hist = safeParse<Record<string, { nextReviewTime?: number }>>('learningHistory', {});
    const now = Date.now(), day = 86_400_000;
    const buckets = [0, 0, 0, 0, 0, 0];
    Object.values(hist).forEach(d => {
        const t = d.nextReviewTime;
        if (!t) return;
        if (t <= now) buckets[0]++;
        else if (t <= now + day) buckets[1]++;
        else if (t <= now + 2 * day) buckets[2]++;
        else if (t <= now + 4 * day) buckets[3]++;
        else if (t <= now + 8 * day) buckets[4]++;
        else buckets[5]++;
    });
    // X 标签：相对时间 + 电脑本地具体日期
    const labels: { top: string; bottom: string }[] = [
        { top: '已逾期', bottom: '' },
        { top: '今天', bottom: mdDate(0) },
        { top: '明天', bottom: mdDate(1) },
        { top: '2-3 天', bottom: `${mdDate(2)}~${mdDate(3)}` },
        { top: '4-7 天', bottom: `${mdDate(4)}~${mdDate(7)}` },
        { top: '7 天后', bottom: '' },
    ];

    // 与每日练习一致的全宽尺寸
    const W = 720, H = 260, padL = 48, padR = 16, padT = 18, padB = 46;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'mc-svg' });
    const max = niceMax(Math.max(1, ...buckets));
    // Y 刻度：小整数逐值、大值分段
    const frac = Number.isInteger(max) && max <= 5
        ? Array.from({ length: max + 1 }, (_, i) => i / max)
        : [0, 0.25, 0.5, 0.75, 1];
    frac.forEach(fr => {
        const y = padT + plotH - plotH * fr;
        root.appendChild(svg('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'mc-grid' }));
        const t = svg('text', { x: padL - 6, y: y + 4, class: 'mc-axis', 'text-anchor': 'end' });
        t.textContent = String(Math.round(max * fr));
        root.appendChild(t);
    });

    const n = buckets.length, bw = plotW / n;
    buckets.forEach((v, i) => {
        const h = (v / max) * plotH;
        const x = padL + bw * i + bw * 0.18;
        const y = padT + plotH - h;
        const cx = padL + bw * i + bw / 2;
        const bar = svg('rect', { x, y, width: bw * 0.64, height: Math.max(0, h), rx: 4, class: 'mc-due-bar' });
        const datePart = labels[i].bottom ? `（${labels[i].bottom}）` : '';
        bar.setAttribute('data-tip', `${labels[i].top}${datePart}：${v} 词`);
        root.appendChild(bar);
        if (v > 0) {
            const vt = svg('text', { x: cx, y: y - 6, class: 'mc-due-val', 'text-anchor': 'middle' });
            vt.textContent = String(v); root.appendChild(vt);
        }
        // 两行 X 标签
        const tx = svg('text', { x: cx, y: H - 24, class: 'mc-due-lbl', 'text-anchor': 'middle' });
        const s1 = document.createElementNS(NS, 'tspan'); s1.setAttribute('x', String(cx)); s1.setAttribute('dy', '0');
        s1.textContent = labels[i].top; tx.appendChild(s1);
        if (labels[i].bottom) {
            const s2 = document.createElementNS(NS, 'tspan'); s2.setAttribute('x', String(cx)); s2.setAttribute('dy', '15');
            s2.setAttribute('class', 'mc-due-date'); s2.textContent = labels[i].bottom; tx.appendChild(s2);
        }
        root.appendChild(tx);
    });
    host.appendChild(root);
}

function renderRetentionRing(host: HTMLElement): void {
    const hist = safeParse<Record<string, { correctCount?: number; errorCount?: number }>>('learningHistory', {});
    let c = 0, e = 0;
    Object.values(hist).forEach(d => { c += d.correctCount || 0; e += d.errorCount || 0; });
    const total = c + e;
    const rate = total ? c / total : 0;
    host.innerHTML = '';
    const S = 180, cx = S / 2, cy = S / 2, r = 66, C = 2 * Math.PI * r;
    const root = svg('svg', { viewBox: `0 0 ${S} ${S}`, class: 'mc-ring-svg' });
    root.appendChild(svg('circle', { cx, cy, r, class: 'mc-ring-bg', fill: 'none', 'stroke-width': 14 }));
    root.appendChild(svg('circle', {
        cx, cy, r, class: 'mc-ring-fg', fill: 'none', 'stroke-width': 14,
        'stroke-dasharray': C, 'stroke-dashoffset': C * (1 - rate),
        'stroke-linecap': 'round', transform: `rotate(-90 ${cx} ${cy})`,
    }));
    const t1 = svg('text', { x: cx, y: cy - 2, class: 'mc-ring-num', 'text-anchor': 'middle' });
    t1.textContent = total ? `${Math.round(rate * 100)}%` : '—';
    root.appendChild(t1);
    const t2 = svg('text', { x: cx, y: cy + 22, class: 'mc-ring-cap', 'text-anchor': 'middle' });
    t2.textContent = `对${c} · 错${e}`;
    root.appendChild(t2);
    host.appendChild(root);
}

function renderForgettingCurve(host: HTMLElement): void {
    host.innerHTML = '';
    const S = 3;                 // 代表稳定度（复习数次后的常见值）
    const MAXDAY = 90;           // 与艾宾浩斯最大复习间隔一致
    const CSLOT = 18;            // 每天固定宽度，0~90 天超出视口可横向滚动
    const padL = 10;
    const scrollW = padL + (MAXDAY + 1) * CSLOT + 12;
    const baseY = LpadT + LplotH;
    const yOfR = (r: number) => LpadT + LplotH - r * LplotH;
    const xOfT = (t: number) => padL + t * CSLOT + CSLOT / 2;

    // 固定 Y 轴：回忆概率 0/25/50/75/100%
    let yTicks = '', hgrid = '';
    [0, 0.25, 0.5, 0.75, 1].forEach(fr => {
        const y = LpadT + LplotH - LplotH * fr;
        yTicks += `<text x="40" y="${(y + 4).toFixed(1)}" class="mc-axis" text-anchor="end">${Math.round(fr * 100)}%</text>`;
        hgrid += `<line x1="0" y1="${y.toFixed(1)}" x2="${scrollW}" y2="${y.toFixed(1)}" class="mc-grid"/>`;
    });

    // 遗忘曲线（程序实际 curveRetention）+ 面积填充
    let line = '';
    for (let t = 0; t <= MAXDAY; t++) {
        line += (t === 0 ? 'M' : 'L') + xOfT(t).toFixed(1) + ' ' + yOfR(curveRetention(t, S)).toFixed(1);
    }
    let area = `M${xOfT(0).toFixed(1)} ${baseY} `;
    for (let t = 0; t <= MAXDAY; t++) {
        area += `L${xOfT(t).toFixed(1)} ${yOfR(curveRetention(t, S)).toFixed(1)} `;
    }
    area += `L${xOfT(MAXDAY).toFixed(1)} ${baseY} Z`;

    // 艾宾浩斯复习节点（程序固定调度的实际间隔）
    const EB = [1, 2, 4, 7, 15, 30, 60, 90];
    let ebLines = '', ebLbl = '';
    EB.forEach(t => {
        const x = xOfT(t);
        ebLines += `<line x1="${x.toFixed(1)}" y1="${LpadT}" x2="${x.toFixed(1)}" y2="${baseY}" class="mc-eb-line"/>`;
        ebLbl += `<text x="${x.toFixed(1)}" y="${LH - 12}" class="mc-eb-lbl" text-anchor="middle">${t}</text>`;
    });

    // 目标记忆率横线
    const ty = yOfR(FSRS_TARGET_RETENTION);
    const targetLine = `<line x1="0" y1="${ty.toFixed(1)}" x2="${scrollW}" y2="${ty.toFixed(1)}" class="mc-target-line" stroke-dasharray="5 5"/>`;

    host.innerHTML = `
      <div class="md-line-wrap">
        <svg width="44" height="${LH}" viewBox="0 0 44 ${LH}" class="mc-lc-y">${yTicks}</svg>
        <div class="md-scroll" id="md-curve-scroll">
          <svg width="${scrollW}" height="${LH}" viewBox="0 0 ${scrollW} ${LH}" class="mc-lc-svg">
            ${hgrid}
            <path d="${area}" class="mc-curve-area"/>
            ${targetLine}
            ${ebLines}
            <path d="${line}" class="mc-curve-line"/>
            ${ebLbl}
          </svg>
        </div>
      </div>
      <p class="md-scroll-hint">按住图表左右拖动，查看 0~90 天回忆概率（稳定度 S=3，曲线为程序实际遗忘公式）；竖线与数字为艾宾浩斯复习节点，橙色虚线为目标记忆率 ${Math.round(FSRS_TARGET_RETENTION * 100)}%。</p>`;

    const sc = document.getElementById('md-curve-scroll');
    if (sc) enableDragPan(sc);
}

// ---------------- 图表悬浮提示（自定义 tooltip，替代原生 <title>） ----------------
const TIP_SEL = '.mc-pt, .mc-due-bar';

function ensureChartTip(): HTMLElement {
    let tip = document.getElementById('mc-tip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'mc-tip';
        tip.className = 'mc-tip';
        tip.setAttribute('role', 'status');
        document.body.appendChild(tip);
    }
    return tip;
}

/** 在看板根上做事件委托（点 / 柱重建后仍有效），tooltip 跟随鼠标、自动避让边界 */
function bindChartTooltip(host: HTMLElement): void {
    if (host.dataset.tipBound === '1') return;
    host.dataset.tipBound = '1';
    const tip = ensureChartTip();

    const position = (e: MouseEvent): void => {
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        let x = e.clientX + 14;
        let y = e.clientY - th - 12;                 // 默认显示在点上方
        if (x + tw > window.innerWidth - 8) x = e.clientX - tw - 14;  // 靠右则翻左
        if (y < 8) y = e.clientY + 18;                // 靠上则翻下
        tip.style.left = `${x}px`;
        tip.style.top = `${y}px`;
    };

    host.addEventListener('mouseover', (e: MouseEvent) => {
        const el = (e.target as HTMLElement).closest(TIP_SEL) as HTMLElement | null;
        if (!el || !host.contains(el)) return;
        tip.textContent = el.getAttribute('data-tip') || '';
        tip.classList.add('is-show');
        position(e);
    });
    host.addEventListener('mousemove', (e: MouseEvent) => {
        const el = (e.target as HTMLElement).closest(TIP_SEL) as HTMLElement | null;
        if (el && host.contains(el) && tip.classList.contains('is-show')) position(e);
    });
    host.addEventListener('mouseout', (e: MouseEvent) => {
        const el = (e.target as HTMLElement).closest(TIP_SEL) as HTMLElement | null;
        if (el) tip.classList.remove('is-show');
    });
}

// ---------------- 看板装配 ----------------
export function initMemoryDashboard(): void {
    const host = document.getElementById('memory-dashboard');
    if (!host) return;
    host.innerHTML = `
      <div class="md-board glass">
        <h3 class="md-title">记忆数据看板</h3>
        <div class="md-card md-daily" id="md-daily-card"></div>
        <div class="md-card">
          <h4>到期词分布</h4>
          <div class="md-chart" id="md-due-chart"></div>
        </div>
        <div class="md-row md-row-rr">
          <div class="md-card md-retention-card">
            <h4>答题留存率</h4>
            <div class="md-chart md-ring-host" id="md-retention"></div>
          </div>
          <div class="md-card md-curve-card">
            <h4>遗忘曲线（稳定度 S=3 时的回忆概率）</h4>
            <div class="md-chart" id="md-curve"></div>
          </div>
        </div>
      </div>`;

    renderDailyCard();
    renderDueDistribution(document.getElementById('md-due-chart') as HTMLElement);
    renderRetentionRing(document.getElementById('md-retention') as HTMLElement);
    renderForgettingCurve(document.getElementById('md-curve') as HTMLElement);

    bindChartTooltip(host);

    host.addEventListener('click', (e: MouseEvent) => {
        const el = (e.target as HTMLElement).closest('[data-action],[data-md]') as HTMLElement | null;
        if (!el) return;
        if (el.dataset.action === 'prev-month' || el.dataset.action === 'next-month') {
            const dir = el.dataset.action === 'prev-month' ? -1 : 1;
            let m = dailyState.month + dir, y = dailyState.year;
            if (m < 0) { m = 11; y--; }
            else if (m > 11) { m = 0; y++; }
            dailyState.year = y; dailyState.month = m;
            renderDailyCard();
            return;
        }
        const md = el.dataset.md as DailyMode | undefined;
        if (md === 'words' || md === 'seconds') {
            dailyState.mode = md;
            renderDailyCard();
        }
    });
}

/** 刷新看板（进入复习页时调用，保证数据最新） */
export function refreshMemoryDashboard(): void {
    const due = document.getElementById('md-due-chart');
    const ret = document.getElementById('md-retention');
    const curve = document.getElementById('md-curve');
    if (document.getElementById('md-daily-card')) renderDailyCard();
    if (due) renderDueDistribution(due);
    if (ret) renderRetentionRing(ret);
    if (curve) renderForgettingCurve(curve);
}
