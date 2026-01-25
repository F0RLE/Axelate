    import { MonitoringService } from '../services/MonitoringService';
import { ISystemStats } from '../types/monitoringTypes';

export class MonitoringUI {
    private isInit = false;
    private readonly _boundUpdateUI = this.updateUI.bind(this);

    constructor(private readonly service: MonitoringService) {}

    public init(): void {
        const cpuVal = document.getElementById('cpu-percent');
        if (!cpuVal) {
            console.warn('[MonitoringUI] DOM elements missing, skipping init');
            return;
        }

        if (this.isInit) return;
        this.isInit = true;

        console.log('[MonitoringUI] Initializing...');

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
        if (!globalThis.__TAURI__) {
            const titleEl = document.querySelector('[data-card-id="monitoring"] .card-title');
            if (titleEl) {
                setTimeout(() => {
                    const badge = document.createElement('span');
                    badge.textContent = globalThis.t ? globalThis.t('ui.monitoring.demo_data', ' (Demo Data)') : ' (Demo Data)';
                    badge.style.color = 'var(--warning)';
                    badge.style.fontSize = '0.8rem';
                    badge.style.marginLeft = '0.5rem';
                    badge.style.fontWeight = 'bold';
                    const titleText = titleEl.querySelector('[data-i18n]');
                    if (titleText && !titleText.textContent?.includes('Demo')) {
                         titleText.appendChild(badge);
                    }
                }, 500);
            }
        }
    }

    private updateUI(stats: ISystemStats) {
        if (!stats) return;
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
        return !!el && el.offsetParent !== null;
    }

    private _updateNetwork(stats: ISystemStats) {
        if (!this._isVisible('network-status')) return;

        const downRate = stats.network?.download_rate || 0;
        const upRate = stats.network?.upload_rate || 0;
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
            networkProgressEl.style.width = `${Math.max(0, netPercent)}%`;
            
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

        const diskPct = stats.disk?.utilization || 0;
        const readRate = stats.disk?.read_rate || 0;
        const writeRate = stats.disk?.write_rate || 0;

        const diskUsageEl = document.getElementById('disk-usage');
        const diskProgressEl = document.getElementById('disk-progress');

        if (diskUsageEl) {
             // Smart conversion: if > 1024 MB/s, switch both to GB/s
             const { val1, val2, unit } = this._formatSmartRate(readRate, writeRate);
             this._setValueWithSecondary(diskUsageEl, `R:${val1} • W:${val2}`, ` ${unit}`);
             const used = stats.disk?.used_gb || 0;
             const total = stats.disk?.total_gb || 0;
             diskUsageEl.title = `Space: ${used.toFixed(1)} / ${total.toFixed(1)} GB (Usage: ${diskPct.toFixed(1)}%)`;
        }
        if (diskProgressEl) {
            const activity = stats.disk?.activity_percent || 0;
            diskProgressEl.style.width = `${Math.max(0, Math.min(100, activity))}%`;
            this._setProgressColor(diskProgressEl, activity);
            diskProgressEl.classList.toggle('pulse', activity > 5);
        }
    }

    private _updateCPU(stats: ISystemStats) {
        if (!this._isVisible('cpu-percent')) return;

        const cpuPercent = stats.cpu?.percent || 0;
        const cpuPercentEl = document.getElementById('cpu-percent');
        const cpuProgressEl = document.getElementById('cpu-progress');

        if (cpuPercentEl) {
            cpuPercentEl.textContent = `${Math.round(cpuPercent)}%`;
        }
        if (cpuProgressEl) {
            cpuProgressEl.style.width = `${Math.max(0, Math.min(100, cpuPercent))}%`;
            this._setProgressColor(cpuProgressEl, cpuPercent);
        }
    }

    private _updateRAM(stats: ISystemStats) {
        if (!this._isVisible('ram-percent')) return;

        const ramPercent = stats.ram?.percent || 0;
        const ramUsed = stats.ram?.used_gb || 0;
        const ramTotal = stats.ram?.total_gb || 0;
        const ramPercentEl = document.getElementById('ram-percent');
        const ramProgressEl = document.getElementById('ram-progress');

        if (ramPercentEl) {
            // Compact format: 1.2 / 16 GB (Used is white, total is gray)
            this._setValueWithSecondary(ramPercentEl, ramUsed.toFixed(1), `/${ramTotal.toFixed(0)} GB`);
        }
        if (ramProgressEl) {
            ramProgressEl.style.width = `${Math.max(0, Math.min(100, ramPercent))}%`;
            this._setProgressColor(ramProgressEl, ramPercent);
        }
    }

    private _updateGPU(stats: ISystemStats) {
        // Optimized check: both items are in the same block, checking one is enough
        if (!this._isVisible('gpu-util')) return;

        const gpuUtil = stats.gpu?.usage || 0;
        const gpuUtilEl = document.getElementById('gpu-util');
        const gpuProgressEl = document.getElementById('gpu-progress');

        if (gpuUtilEl) {
            gpuUtilEl.textContent = `${gpuUtil}%`;
        }
        if (gpuProgressEl) {
            gpuProgressEl.style.width = `${Math.max(0, Math.min(100, gpuUtil))}%`;
            this._setProgressColor(gpuProgressEl, gpuUtil);
        }

        const vramEl = document.getElementById('gpu-memory');
        if (vramEl && stats.vram) {
             const vramUsed = stats.vram.used_gb || 0;
             const vramTotal = stats.vram.total_gb || 0;
             // Compact format: 1.2 / 8 GB (Used is white, total is gray)
             this._setValueWithSecondary(vramEl, vramUsed.toFixed(1), `/${vramTotal.toFixed(0)} GB`);
        }

        const vramProgressEl = document.getElementById('vram-progress');
        if (vramProgressEl && stats.vram) {
            const vramPct = stats.vram.percent || 0;
            vramProgressEl.style.width = `${Math.max(0, Math.min(100, vramPct))}%`;
            this._setProgressColor(vramProgressEl, vramPct);
        }
    }

    private setLoadingState() {
        ['cpu-percent', 'gpu-util', 'ram-percent', 'gpu-memory', 'disk-usage', 'network-status'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                // Ensure nodes are initialized for stable textContent updates
                this._setValueWithSecondary(el, 'Waiting...', '');
            }
        });
    }

    /**
     * Performance optimized: uses textContent and simple spans instead of innerHTML nuking.
     */
    private _setValueWithSecondary(el: HTMLElement, primaryText: string, secondaryText: string) {
        if (!el) return;
        
        // Locate or create primary node WITHOUT nuking existing content if possible
        let main = el.querySelector('.main-val') as HTMLElement;
        if (!main) {
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
        let sub = el.querySelector('.sysmon-value-sub') as HTMLElement;
        if (secondaryText) {
            if (!sub) {
                sub = document.createElement('span');
                sub.className = 'sysmon-value-sub';
                el.appendChild(sub);
            }
            if (sub.textContent !== secondaryText) {
                sub.textContent = secondaryText;
            }
        } else if (sub) {
            sub.remove();
        }
    }

    private _setProgressColor(el: HTMLElement, percent: number) {
        if (!el) return;
        
        // Toggle only state classes, preserving 'sysmon-fill' or 'pulse'
        el.classList.toggle('high', percent >= 85);
        el.classList.toggle('medium', percent >= 70 && percent < 85);
        el.classList.toggle('low', percent < 70);
    }

    private _formatMB(bytes: number): string {
        const mb = Math.round(bytes / (1024 * 1024));
        if (mb < 1) return '0 MB/s';
        return `${mb} MB/s`;
    }

    private _formatSimpleMB(bytes: number): string {
        const mb = Math.round(bytes / (1024 * 1024));
        return `${mb}`;
    }

    /**
     * Formats two sibling rates with a unified unit (MB/s or GB/s) based on the peak value.
     */
    private _formatSmartRate(bytes1: number, bytes2: number): { val1: string, val2: string, unit: string } {
        const mb1 = bytes1 / (1024 * 1024);
        const mb2 = bytes2 / (1024 * 1024);
        const peakMB = Math.max(mb1, mb2);

        if (peakMB >= 1000) {
            return {
                val1: (mb1 / 1024).toFixed(1),
                val2: (mb2 / 1024).toFixed(1),
                unit: 'GB/s'
            };
        }

        return {
            val1: Math.round(mb1).toString(),
            val2: Math.round(mb2).toString(),
            unit: 'MB/s'
        };
    }
}
