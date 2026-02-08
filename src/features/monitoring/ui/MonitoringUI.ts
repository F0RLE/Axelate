import { type MonitoringService } from '../services/MonitoringService';
import type { ISystemStats } from '../types/monitoringTypes';

export class MonitoringUI {
    private isInit = false;
    private readonly _boundUpdateUI = this.updateUI.bind(this);

    constructor(private readonly service: MonitoringService) {}

    public init(): void {
        if (this.isInit) return;
        this.isInit = true;

        // Set initial loading state
        this.setLoadingState();

        // Subscribe to service
        this.service.subscribe(this._boundUpdateUI);

        // Start service
        void this.service.startMonitoring();

        this.checkDemoMode();
    }

    /**
     * Cleans up the UI event listeners.
     */
    public destroy(): void {
        this.service.unsubscribe(this._boundUpdateUI);
        this.isInit = false;
    }

    private checkDemoMode() {
        // Method body removed as it was only for demo/web mode which is lint-flagged as unnecessary
    }

    private updateUI(stats: ISystemStats) {
        this._updateNetwork(stats);
        this._updateDisk(stats);
        this._updateCPU(stats);
        this._updateRAM(stats);
        this._updateGPU(stats);
    }

    /**
     * Checks if an element is visible in the layout.
     * offsetParent is null if display: none is set on element or any parent (including collapsed sidebar).
     */
    private _isVisible(id: string): boolean {
        const el = document.getElementById(id);
        return el !== null && el.offsetParent !== null;
    }

    private _updateNetwork(stats: ISystemStats) {
        if (!this._isVisible('network-status')) return;

        const downRate = stats.network.downloadRate;
        const upRate = stats.network.uploadRate;
        const netPeak = Math.max(downRate, upRate) / (1024 * 1024);

        const networkStatusEl = document.getElementById('network-status');
        const networkProgressEl = document.getElementById('network-progress');

        if (networkStatusEl) {
            // Smart conversion: if > 1024 MB/s, switch both to GB/s
            const { val1, val2, unit } = this._formatSmartRate(downRate, upRate);
            this._setValueWithSecondary(networkStatusEl, `↓${val1} • ↑${val2}`, ` ${unit}`);
        }
        if (networkProgressEl) {
            const netPercent = Math.min(100, (netPeak / 10) * 100);
            networkProgressEl.style.width = `${Math.max(0, netPercent).toString()}%`;

            if (netPeak >= 10) {
                networkProgressEl.classList.add('sysmon-fill-gold');
                this._setProgressColor(networkProgressEl, 100);
            } else {
                networkProgressEl.classList.remove('sysmon-fill-gold');
                this._setProgressColor(networkProgressEl, netPercent);
            }

            networkProgressEl.classList.toggle('pulse', netPercent > 5);
        }
    }

    private _updateDisk(stats: ISystemStats) {
        if (!this._isVisible('disk-usage')) return;

        const diskPct = stats.disk.utilization;
        const readRate = stats.disk.readRate;
        const writeRate = stats.disk.writeRate;

        const diskUsageEl = document.getElementById('disk-usage');
        const diskProgressEl = document.getElementById('disk-progress');

        if (diskUsageEl) {
            // Smart conversion: if > 1024 MB/s, switch both to GB/s
            const { val1, val2, unit } = this._formatSmartRate(readRate, writeRate);
            this._setValueWithSecondary(diskUsageEl, `R:${val1} • W:${val2}`, ` ${unit}`);
            const used = stats.disk.usedGb;
            const total = stats.disk.totalGb;
            diskUsageEl.title = `Space: ${used.toFixed(1)} / ${total.toFixed(1)} GB (Usage: ${diskPct.toFixed(1)}%)`;
        }
        if (diskProgressEl) {
            const activity = stats.disk.activityPercent;
            diskProgressEl.style.width = `${Math.max(0, Math.min(100, activity)).toString()}%`;
            this._setProgressColor(diskProgressEl, activity);
            diskProgressEl.classList.toggle('pulse', activity > 5);
        }
    }

    private readonly _activeTweens = new Map<HTMLElement, number>();

    /**
     * Animates the main value of a monitoring element (CPU, RAM, etc.)
     */
    private _animateMainValue(el: HTMLElement, targetVal: number, decimals = 0, suffix = '') {
        // Determine target node (either el itself or .main-val child)
        let targetNode = el.querySelector('.main-val');

        // If no .main-val but we have secondary structure needed (has children), create it?
        // Or assume straight textContent for simple elements like CPU/GPU.
        if (!(targetNode instanceof HTMLElement) && el.children.length === 0) {
            // Simple element (CPU % etc)
            targetNode = el;
        }
        if (!(targetNode instanceof HTMLElement)) return;

        const startText = targetNode.textContent || '0';
        const startVal = Number.parseFloat(startText.replaceAll(/[^0-9.-]/g, ''));

        // If parsing failed (e.g. "Waiting..."), jump to target or start from 0
        const start = Number.isNaN(startVal) ? 0 : startVal;

        if (Math.abs(start - targetVal) < 0.1) {
            targetNode.textContent = `${targetVal.toFixed(decimals)}${suffix}`;
            return;
        }

        // Cancel previous animation on this node
        if (this._activeTweens.has(targetNode)) {
            const id = this._activeTweens.get(targetNode);
            if (id !== undefined) cancelAnimationFrame(id);
        }

        const duration = 600; // ms
        const startTime = performance.now();

        const tick = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // EaseOutQuart
            const ease = 1 - Math.pow(1 - progress, 4);

            const val = start + (targetVal - start) * ease;
            if (targetNode instanceof HTMLElement) {
                targetNode.textContent = `${val.toFixed(decimals)}${suffix}`;

                if (progress < 1) {
                    this._activeTweens.set(targetNode, requestAnimationFrame(tick));
                } else {
                    this._activeTweens.delete(targetNode);
                    targetNode.textContent = `${targetVal.toFixed(decimals)}${suffix}`; // Snap to exact end
                }
            }
        };

        this._activeTweens.set(targetNode, requestAnimationFrame(tick));
    }

    private _updateCPU(stats: ISystemStats) {
        if (!this._isVisible('cpu-percent')) return;

        const cpuPercent = stats.cpu.percent;
        const cpuPercentEl = document.getElementById('cpu-percent');
        const cpuProgressEl = document.getElementById('cpu-progress');

        if (cpuPercentEl) {
            this._animateMainValue(cpuPercentEl, cpuPercent, 0, '%');
        }
        if (cpuProgressEl) {
            cpuProgressEl.style.width = `${Math.max(0, Math.min(100, cpuPercent)).toString()}%`;
            this._setProgressColor(cpuProgressEl, cpuPercent);
        }
    }

    private _updateRAM(stats: ISystemStats) {
        if (!this._isVisible('ram-percent')) return;

        const ramPercent = stats.ram.percent;
        const ramUsed = stats.ram.usedGb;
        const ramTotal = stats.ram.totalGb;
        const ramPercentEl = document.getElementById('ram-percent');
        const ramProgressEl = document.getElementById('ram-progress');

        if (ramPercentEl) {
            // Ensure structure exists first
            this._setValueWithSecondary(
                ramPercentEl,
                ramUsed.toFixed(1),
                `/${ramTotal.toFixed(0)} GB`,
            );
            // Then animate main val
            this._animateMainValue(ramPercentEl, ramUsed, 1);
        }
        if (ramProgressEl) {
            ramProgressEl.style.width = `${Math.max(0, Math.min(100, ramPercent)).toString()}%`;
            this._setProgressColor(ramProgressEl, ramPercent);
        }
    }

    private _updateGPU(stats: ISystemStats) {
        // Optimized check: both items are in the same block, checking one is enough
        if (!this._isVisible('gpu-util')) return;

        const gpuUtil = stats.gpu?.usage ?? 0;
        const gpuUtilEl = document.getElementById('gpu-util');
        const gpuProgressEl = document.getElementById('gpu-progress');

        if (gpuUtilEl) {
            this._animateMainValue(gpuUtilEl, gpuUtil, 0, '%');
        }
        if (gpuProgressEl) {
            gpuProgressEl.style.width = `${Math.max(0, Math.min(100, gpuUtil)).toString()}%`;
            this._setProgressColor(gpuProgressEl, gpuUtil);
        }

        const vramEl = document.getElementById('gpu-memory');
        if (vramEl) {
            const vramUsed = stats.vram?.usedGb ?? 0;
            const vramTotal =
                stats.vram?.totalGb ??
                (stats.gpu?.memoryTotal !== undefined && stats.gpu.memoryTotal > 0
                    ? stats.gpu.memoryTotal / (1024 * 1024 * 1024)
                    : 0);

            // Ensure structure
            this._setValueWithSecondary(vramEl, vramUsed.toFixed(1), `/${vramTotal.toFixed(0)} GB`);
            this._animateMainValue(vramEl, vramUsed, 1);
        }

        const vramProgressEl = document.getElementById('vram-progress');
        if (vramProgressEl) {
            const vramPct = stats.vram?.percent ?? 0;
            vramProgressEl.style.width = `${Math.max(0, Math.min(100, vramPct)).toString()}%`;
            this._setProgressColor(vramProgressEl, vramPct);
        }
    }

    private setLoadingState() {
        [
            'cpu-percent',
            'gpu-util',
            'ram-percent',
            'gpu-memory',
            'disk-usage',
            'network-status',
        ].forEach((id) => {
            const el = document.getElementById(id);
            if (el !== null) {
                // Ensure nodes are initialized for stable textContent updates
                this._setValueWithSecondary(el, 'Waiting...', '');
            }
        });
    }

    /**
     * Performance optimized: uses textContent and simple spans instead of innerHTML nuking.
     */
    private _setValueWithSecondary(el: HTMLElement, primaryText: string, secondaryText: string) {
        // Locate or create primary node WITHOUT nuking existing content if possible
        let main = el.querySelector('.main-val');
        if (!(main instanceof HTMLElement)) {
            // Check if el has children (like "Waiting..." text). If so, clear it only ONCE.
            if (el.childNodes.length > 0 && !el.querySelector('.main-val')) {
                el.innerHTML = '';
            }
            main = document.createElement('span');
            main.className = 'main-val';
            el.appendChild(main);
        }

        if (main.textContent !== primaryText) {
            main.textContent = primaryText;
        }

        // Locate or create secondary node
        let sub = el.querySelector('.sysmon-value-sub');
        if (secondaryText) {
            if (!(sub instanceof HTMLElement)) {
                sub = document.createElement('span');
                sub.className = 'sysmon-value-sub';
                el.appendChild(sub);
            }
            if (sub.textContent !== secondaryText) {
                sub.textContent = secondaryText;
            }
        } else if (sub instanceof HTMLElement) {
            sub.remove();
        }
    }

    private _setProgressColor(el: HTMLElement, percent: number) {
        // Toggle only state classes, preserving 'sysmon-fill' or 'pulse'
        el.classList.toggle('high', percent >= 85);
        el.classList.toggle('medium', percent >= 70 && percent < 85);
        el.classList.toggle('low', percent < 70);
    }

    /**
     * Formats two sibling rates with a unified unit (MB/s or GB/s) based on the peak value.
     */
    private _formatSmartRate(
        bytes1: number,
        bytes2: number,
    ): { val1: string; val2: string; unit: string } {
        const mb1 = bytes1 / (1024 * 1024);
        const mb2 = bytes2 / (1024 * 1024);
        const peakMB = Math.max(mb1, mb2);

        if (peakMB >= 1000) {
            return {
                val1: (mb1 / 1024).toFixed(1),
                val2: (mb2 / 1024).toFixed(1),
                unit: 'GB/s',
            };
        }

        return {
            val1: Math.round(mb1).toString(),
            val2: Math.round(mb2).toString(),
            unit: 'MB/s',
        };
    }
}
