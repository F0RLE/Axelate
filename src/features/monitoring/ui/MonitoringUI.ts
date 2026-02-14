import { BaseComponent } from '../../../shared/ui/BaseComponent';
import { type MonitoringService } from '../services/MonitoringService';
import type { ISystemStats } from '../types/monitoringTypes';

export class MonitoringUI extends BaseComponent {
    private readonly _boundUpdateUI = this.updateUI.bind(this);

    // Cache for numerical state to avoid string parsing in animations
    private readonly _lastValues = new Map<HTMLElement, number>();
    private readonly _activeTweens = new Map<HTMLElement, number>();

    constructor(private readonly service: MonitoringService) {
        super();
    }

    protected onInit(): void {
        // Subscribe to service
        this.service.subscribe(this._boundUpdateUI);

        // Start service
        void this.service.startMonitoring();
    }

    protected onDestroy(): void {
        this.service.unsubscribe(this._boundUpdateUI);
        this._lastValues.clear();

        // Cancel any active animations
        for (const tweenId of this._activeTweens.values()) {
            cancelAnimationFrame(tweenId);
        }
        this._activeTweens.clear();
    }

    private updateUI(stats: ISystemStats) {
        this._updateNetwork(stats);
        this._updateDisk(stats);
        this._updateCPU(stats);
        this._updateRAM(stats);
        this._updateGPU(stats);
        this._updateVRAM(stats);
    }

    private _updateNetwork(stats: ISystemStats) {
        if (!this.isVisible('network-status')) return;

        const downRate = stats.network.downloadRate;
        const upRate = stats.network.uploadRate;
        const netPeak = Math.max(downRate, upRate) / (1024 * 1024);

        const networkStatusEl = this.getElement('network-status');
        const networkProgressEl = this.getElement('network-progress');

        if (networkStatusEl) {
            const { val1, val2, unit } = this._formatSmartRate(downRate, upRate);
            let compactUnit = unit;
            if (unit === 'MB/s') compactUnit = 'M/s';
            else if (unit === 'GB/s') compactUnit = 'G/s';

            this._setValueWithSecondary(networkStatusEl, `↓${val1}·↑${val2}`, compactUnit);
        }

        if (networkProgressEl) {
            const netPercent = Math.min(100, (netPeak / 10) * 100);
            networkProgressEl.style.width = `${Math.max(0, netPercent).toString()}%`;
            this._setProgressColor(networkProgressEl, netPercent);
            networkProgressEl.classList.toggle('pulse', netPercent > 5);
        }
    }

    private _updateDisk(stats: ISystemStats) {
        if (!this.isVisible('disk-usage')) return;

        const readRate = stats.disk.readRate;
        const writeRate = stats.disk.writeRate;

        const diskUsageEl = this.getElement('disk-usage');
        const diskProgressEl = this.getElement('disk-progress');

        if (diskUsageEl) {
            const { val1, val2, unit } = this._formatSmartRate(readRate, writeRate);
            let compactUnit = unit;
            if (unit === 'MB/s') compactUnit = 'M/s';
            else if (unit === 'GB/s') compactUnit = 'G/s';

            this._setValueWithSecondary(diskUsageEl, `R${val1}·W${val2}`, compactUnit);
            diskUsageEl.title = `Usage: ${stats.disk.utilization.toFixed(1)}%`;
        }

        if (diskProgressEl) {
            const activity = stats.disk.activityPercent;
            diskProgressEl.style.width = `${Math.max(0, Math.min(100, activity)).toString()}%`;
            this._setProgressColor(diskProgressEl, activity);
            diskProgressEl.classList.toggle('pulse', activity > 5);
        }
    }

    private _animateMainValue(el: HTMLElement, targetVal: number, decimals = 0, suffix = '') {
        const targetNode = el.querySelector('.main-val') ?? el;
        if (!(targetNode instanceof HTMLElement)) return;

        const start = this._lastValues.get(targetNode) ?? 0;
        if (Math.abs(start - targetVal) < 0.1) {
            targetNode.textContent = `${targetVal.toFixed(decimals)}${suffix}`;
            this._lastValues.set(targetNode, targetVal);
            return;
        }

        if (this._activeTweens.has(targetNode)) {
            const frameId = this._activeTweens.get(targetNode);
            if (frameId !== undefined) {
                cancelAnimationFrame(frameId);
            }
        }

        const duration = 400; // Snapper animation (400ms)
        const startTime = performance.now();

        const tick = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 4);

            const val = start + (targetVal - start) * ease;
            targetNode.textContent = `${val.toFixed(decimals)}${suffix}`;

            if (progress < 1) {
                this._activeTweens.set(targetNode, requestAnimationFrame(tick));
            } else {
                this._activeTweens.delete(targetNode);
                this._lastValues.set(targetNode, targetVal);
                targetNode.textContent = `${targetVal.toFixed(decimals)}${suffix}`;
            }
        };

        this._activeTweens.set(targetNode, requestAnimationFrame(tick));
    }

    private _updateCPU(stats: ISystemStats) {
        if (!this.isVisible('cpu-percent')) return;
        const cpuPercentEl = this.getElement('cpu-percent');
        const cpuProgressEl = this.getElement('cpu-progress');

        if (cpuPercentEl) this._animateMainValue(cpuPercentEl, stats.cpu.percent, 0); // Removed suffix
        if (cpuProgressEl) {
            cpuProgressEl.style.width = `${Math.max(0, Math.min(100, stats.cpu.percent)).toString()}%`;
            this._setProgressColor(cpuProgressEl, stats.cpu.percent);
        }
    }

    private _updateRAM(stats: ISystemStats) {
        if (!this.isVisible('ram-percent')) return;
        const ramPercentEl = this.getElement('ram-percent');
        const ramProgressEl = this.getElement('ram-progress');

        if (ramPercentEl) {
            this._setValueWithSecondary(
                ramPercentEl,
                stats.ram.usedGb.toFixed(1),
                `/${stats.ram.totalGb.toFixed(0)}G`,
            );
            this._animateMainValue(ramPercentEl, stats.ram.usedGb, 1);
        }
        if (ramProgressEl) {
            ramProgressEl.style.width = `${Math.max(0, Math.min(100, stats.ram.percent)).toString()}%`;
            this._setProgressColor(ramProgressEl, stats.ram.percent);
        }
    }

    private _updateGPU(stats: ISystemStats) {
        if (!this.isVisible('gpu-util')) return;
        const gpuUtilEl = this.getElement('gpu-util');
        const gpuProgressEl = this.getElement('gpu-progress');

        if (gpuUtilEl) this._animateMainValue(gpuUtilEl, stats.gpu?.usage ?? 0, 0);
        if (gpuProgressEl) {
            const usage = stats.gpu?.usage ?? 0;
            gpuProgressEl.style.width = `${Math.max(0, Math.min(100, usage)).toString()}%`;
            this._setProgressColor(gpuProgressEl, usage);
        }
    }

    private _updateVRAM(stats: ISystemStats) {
        if (!this.isVisible('gpu-memory')) return;
        const vramEl = this.getElement('gpu-memory');
        const vramProgressEl = this.getElement('vram-progress');

        if (vramEl) {
            const vramUsed = stats.vram?.usedGb ?? 0;
            const vramTotal = stats.vram?.totalGb ?? 0;
            this._setValueWithSecondary(vramEl, vramUsed.toFixed(1), `/${vramTotal.toFixed(0)}G`);
            this._animateMainValue(vramEl, vramUsed, 1);
        }
        if (vramProgressEl) {
            const vramUsed = stats.vram?.usedGb ?? 0;
            const vramTotal = stats.vram?.totalGb ?? 0;
            const percent = vramTotal > 0 ? (vramUsed / vramTotal) * 100 : 0;
            vramProgressEl.style.width = `${Math.max(0, Math.min(100, percent)).toString()}%`;
            this._setProgressColor(vramProgressEl, percent);
        }
    }

    private _setValueWithSecondary(el: HTMLElement, primaryText: string, secondaryText: string) {
        let main = el.querySelector('.main-val');
        if (!(main instanceof HTMLElement)) {
            el.innerHTML = '';
            main = document.createElement('span');
            main.className = 'main-val';
            el.appendChild(main);
        }
        if (main.textContent !== primaryText) main.textContent = primaryText;

        let sub = el.querySelector('.sysmon-value-sub');
        if (secondaryText) {
            if (!(sub instanceof HTMLElement)) {
                sub = document.createElement('span');
                sub.className = 'sysmon-value-sub';
                el.appendChild(sub);
            }
            if (sub.textContent !== secondaryText) sub.textContent = secondaryText;
        } else if (sub) {
            sub.remove();
        }
    }

    private _setProgressColor(el: HTMLElement, percent: number) {
        el.classList.toggle('high', percent >= 85);
        el.classList.toggle('medium', percent >= 70 && percent < 85);
        el.classList.toggle('low', percent < 70);
    }

    private _formatSmartRate(b1: number, b2: number): { val1: string; val2: string; unit: string } {
        const mb1 = b1 / (1024 * 1024);
        const mb2 = b2 / (1024 * 1024);
        const peak = Math.max(mb1, mb2);

        if (peak >= 1024) {
            return { val1: (mb1 / 1024).toFixed(1), val2: (mb2 / 1024).toFixed(1), unit: 'GB/s' };
        }
        return { val1: Math.round(mb1).toString(), val2: Math.round(mb2).toString(), unit: 'MB/s' };
    }
}
