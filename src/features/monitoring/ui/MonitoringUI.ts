import { BaseComponent } from '../../../shared/ui/BaseComponent';
import { type MonitoringService } from '../services/MonitoringService';
import type { ISystemStats } from '../types/monitoringTypes';

export class MonitoringUI extends BaseComponent {
    private readonly _boundUpdateUI = this.updateUI.bind(this);

    // Performance Caching
    private readonly _lastValues = new Map<HTMLElement, number>();
    private readonly _activeTweens = new Map<HTMLElement, number>();
    private readonly _nodeCache = new Map<
        HTMLElement,
        { main?: HTMLElement; sub?: HTMLElement; bar?: HTMLElement }
    >();
    private _lastRenderTime = 0;
    private readonly _RENDER_THROTTLE_MS = 100; // ~10fps UI updates

    // Frontend EMA for smooth graphs
    private readonly _emaState = new Map<string, number>();

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
        this._nodeCache.clear();
        this._emaState.clear();

        // Cancel any active animations
        for (const tweenId of this._activeTweens.values()) {
            cancelAnimationFrame(tweenId);
        }
        this._activeTweens.clear();
    }

    private updateUI(stats: ISystemStats) {
        // UI Throttling
        const now = performance.now();
        if (now - this._lastRenderTime < this._RENDER_THROTTLE_MS) return;
        this._lastRenderTime = now;

        this._updateNetwork(stats);
        this._updateDisk(stats);
        this._updateCPU(stats);
        this._updateRAM(stats);
        this._updateGPU(stats);
        this._updateVRAM(stats);
    }

    private _updateNetwork(stats: ISystemStats) {
        const el = this.getElement('network-status');
        if (!el || !this.isVisible('network-status')) return;

        const cache = this._getCachedNodes(el, 'network-progress');

        const { val1, val2, unit } = this._formatSmartRate(
            stats.network.downloadRate,
            stats.network.uploadRate,
        );
        let compactUnit = unit;
        if (unit === 'MB/s') compactUnit = 'M/s';
        else if (unit === 'GB/s') compactUnit = 'G/s';

        this._updateText(el, `↓${val1}·↑${val2}`, compactUnit);
        this._updateProgressBar(cache.bar, stats.network.activityPercent, true);
    }

    private _updateDisk(stats: ISystemStats) {
        const el = this.getElement('disk-usage');
        if (!el || !this.isVisible('disk-usage')) return;

        const cache = this._getCachedNodes(el, 'disk-progress');

        const { val1, val2, unit } = this._formatSmartRate(
            stats.disk.readRate,
            stats.disk.writeRate,
        );
        let compactUnit = unit;
        if (unit === 'MB/s') compactUnit = 'M/s';
        else if (unit === 'GB/s') compactUnit = 'G/s';

        this._updateText(el, `R${val1}·W${val2}`, compactUnit);
        el.title = `Usage: ${stats.disk.utilization.toFixed(1)}%`;
        this._updateProgressBar(cache.bar, stats.disk.activityPercent, true);
    }

    private _animateMainValue(el: HTMLElement, targetVal: number, decimals = 0, suffix = '') {
        const { main } = this._getCachedNodes(el);
        const targetNode = main ?? el;

        const start = this._lastValues.get(targetNode) ?? 0;
        // Skip micro-animations and redundant updates
        if (Math.abs(start - targetVal) < (decimals === 0 ? 0.5 : 0.05)) {
            const text = `${targetVal.toFixed(decimals)}${suffix}`;
            if (targetNode.textContent !== text) targetNode.textContent = text;
            this._lastValues.set(targetNode, targetVal);
            return;
        }

        const activeTween = this._activeTweens.get(targetNode);
        if (activeTween !== undefined) {
            cancelAnimationFrame(activeTween);
        }

        const duration = 400;
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
            }
        };

        this._activeTweens.set(targetNode, requestAnimationFrame(tick));
    }

    private _updateCPU(stats: ISystemStats) {
        const el = this.getElement('cpu-percent');
        if (!el || !this.isVisible('cpu-percent')) return;

        const cache = this._getCachedNodes(el, 'cpu-progress');
        this._animateMainValue(el, stats.cpu.percent, 0);
        this._updateProgressBar(cache.bar, stats.cpu.percent);
    }

    private _updateRAM(stats: ISystemStats) {
        const el = this.getElement('ram-percent');
        if (!el || !this.isVisible('ram-percent')) return;

        const cache = this._getCachedNodes(el, 'ram-progress');

        // Update secondary text once per throttle cycle
        const subText = `/${stats.ram.totalGb.toFixed(0)}G`;
        if (cache.sub && cache.sub.textContent !== subText) cache.sub.textContent = subText;

        this._animateMainValue(el, stats.ram.usedGb, 1);
        this._updateProgressBar(cache.bar, stats.ram.percent);
    }

    private _updateGPU(stats: ISystemStats) {
        const el = this.getElement('gpu-util');
        if (!el || !this.isVisible('gpu-util')) return;

        const cache = this._getCachedNodes(el, 'gpu-progress');
        const rawUsage = stats.gpu?.usage ?? 0;

        // Frontend EMA for silky smooth graph
        const ema = this._ema('gpu', rawUsage, 0.3);

        this._animateMainValue(el, rawUsage, 0);
        this._updateProgressBar(cache.bar, ema);
    }

    private _updateVRAM(stats: ISystemStats) {
        const el = this.getElement('gpu-memory');
        if (!el || !this.isVisible('gpu-memory')) return;

        const cache = this._getCachedNodes(el, 'vram-progress');
        const vramUsed = stats.vram?.usedGb ?? 0;
        const vramTotal = stats.vram?.totalGb ?? 0;
        const percent = vramTotal > 0 ? (vramUsed / vramTotal) * 100 : 0;

        const subText = `/${vramTotal.toFixed(0)}G`;
        if (cache.sub && cache.sub.textContent !== subText) cache.sub.textContent = subText;

        this._animateMainValue(el, vramUsed, 1);
        this._updateProgressBar(cache.bar, this._ema('vram', percent, 0.3));
    }

    private _getCachedNodes(
        container: HTMLElement,
        barId?: string,
    ): { main?: HTMLElement; sub?: HTMLElement; bar?: HTMLElement } {
        const cached = this._nodeCache.get(container);
        // If we have a cache and we don't need a bar, or we have the bar, return it
        if (cached !== undefined && (barId === undefined || cached.bar !== undefined))
            return cached;

        const mainNode = container.querySelector('.main-val');
        const subNode = container.querySelector('.sysmon-value-sub');
        const barNode = barId !== undefined && barId !== '' ? this.getElement(barId) : undefined;

        const newCache: { main?: HTMLElement; sub?: HTMLElement; bar?: HTMLElement } = {};
        if (mainNode instanceof HTMLElement) newCache.main = mainNode;
        if (subNode instanceof HTMLElement) newCache.sub = subNode;
        if (barNode instanceof HTMLElement) newCache.bar = barNode;

        this._nodeCache.set(container, newCache);
        return newCache;
    }

    private _updateText(container: HTMLElement, primary: string, secondary?: string) {
        const cache = this._getCachedNodes(container);
        const mainNode = cache.main ?? container;
        if (mainNode.textContent !== primary) mainNode.textContent = primary;

        if (secondary !== undefined && secondary !== '' && cache.sub !== undefined) {
            if (cache.sub.textContent !== secondary) cache.sub.textContent = secondary;
        }
    }

    private _updateProgressBar(bar: HTMLElement | undefined, percent: number, isActivity = false) {
        if (!bar) return;
        const p = Math.max(0, Math.min(100, percent));

        // GPU Friendly: Use transform instead of width
        bar.style.transform = `scaleX(${p / 100})`;

        bar.classList.toggle('high', p >= 85);
        bar.classList.toggle('medium', p >= 70 && p < 85);
        bar.classList.toggle('low', p < 70);
        bar.classList.toggle('critical', p >= 95); // Peak glow

        if (isActivity) {
            bar.classList.toggle('pulse', p > 5);
        }
    }

    private _ema(key: string, current: number, alpha: number): number {
        const prev = this._emaState.get(key) ?? current;
        const next = prev * (1 - alpha) + current * alpha;
        this._emaState.set(key, next);
        return next;
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
