// 通用进度工具 — 导出进度条动画和阶段信息

interface Stage {
    range: string;
    text: string;
    done: boolean;
}

export function getStageInfo(currentStage: number): string {
    const stages: Stage[] = [
        { range: '0-20%', text: '准备阶段', done: currentStage > 0 },
        { range: '20-30%', text: '准备导出', done: currentStage > 1 },
        { range: '30-80%', text: '导出单词', done: currentStage > 2 },
        { range: '80-95%', text: '下载文件', done: currentStage > 3 },
        { range: '95-100%', text: '完成', done: currentStage > 4 },
    ];
    return stages
        .map((stage, idx) => {
            const isCurrent = idx === currentStage;
            const color = stage.done
                ? 'var(--accent-green)'
                : isCurrent
                ? 'var(--primary-blue)'
                : 'var(--text-gray)';
            const icon = stage.done ? '✅' : isCurrent ? '⏳' : '○';
            return `<div style="color: ${color};">${icon} ${stage.range}：${stage.text}</div>`;
        })
        .join('');
}

export function simulateProgress(
    startPercent: number,
    endPercent: number,
    duration: number,
    message: string,
    currentStage: number,
    updateProgress: (percent: number, message: string, stageInfo: string) => void,
): Promise<void> {
    return new Promise<void>((resolve) => {
        let currentPercent = startPercent;
        const startTime = Date.now();
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            currentPercent = startPercent + (endPercent - startPercent) * progress;
            updateProgress(Math.floor(currentPercent), message, getStageInfo(currentStage));
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                resolve();
            }
        };
        animate();
    });
}