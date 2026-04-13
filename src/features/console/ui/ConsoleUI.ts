import { invoke } from '@tauri-apps/api/core';
import { type ConsoleLogService } from '../services/ConsoleLogService';
import { eventBus } from '@/shared/services/EventBus';

export class ConsoleUI {
    private pollInterval: number | null = null;
    private unsubscribers: (() => void)[] = [];
    private _isInitialized = false;
    private _hasRenderedLogs = false;
    private _dropzoneResetTimeout: ReturnType<typeof setTimeout> | null = null;
    private _pageChangeUnsub: (() => void) | null = null;
    private readonly _previousSetDebugTab = globalThis.setDebugTab;
    private readonly _previousSetLogView = globalThis.setLogView;
    private readonly _previousClearLogs = globalThis.clearLogs;
    private readonly _boundSetDebugTab = (tabId: string, btn: HTMLElement) => {
        this.setTab(tabId, btn);
    };
    private readonly _boundSetLogView = (view: string, btn: HTMLElement) => {
        this.setLogView(view, btn);
    };
    private readonly _boundClearLogs = () => this.clearLogs();

    constructor(private readonly service: ConsoleLogService) {}

    public init(): void {
        if (this._isInitialized) return;
        this._isInitialized = true;

        this.bindSliders();
        this.bindDraggable();
        this.bindDropzone();
        this.bindTabs();
        this.bindLogControls();
        this.startLogPolling();
        this._pageChangeUnsub = eventBus.on('page:change', (data) => {
            if (data.pageId === 'console') {
                void this._refreshLogsOnConsoleOpen();
            }
        });

        // Shim globals for backward compat if needed, or preferably we fix the calls.
        // Legacy debug.js exposed setDebugTab. We bind it here.
        globalThis.setDebugTab = this._boundSetDebugTab;
        globalThis.setLogView = this._boundSetLogView;
        globalThis.clearLogs = this._boundClearLogs;
    }

    private bindSliders(): void {
        // Slider 1
        const slider1 = document.querySelector('.debug-slider-1');
        const slider1Value = document.querySelector('.debug-slider-1-value');
        if (slider1 && slider1Value) {
            const handleSlider1Input = (e: Event) => {
                const target = e.target as HTMLInputElement;
                slider1Value.textContent = `${target.value}%`;
            };
            slider1.addEventListener('input', handleSlider1Input);
            this.unsubscribers.push(() => {
                slider1.removeEventListener('input', handleSlider1Input);
            });
        }

        // Slider 2 (animated)
        const animatedSlider = document.querySelector('.debug-slider-animated');
        const sliderValue = document.querySelector('.debug-slider-value');
        if (animatedSlider && sliderValue) {
            const handleAnimatedSliderInput = (e: Event) => {
                const target = e.target as HTMLInputElement;
                sliderValue.textContent = `${target.value}%`;
            };
            animatedSlider.addEventListener('input', handleAnimatedSliderInput);
            this.unsubscribers.push(() => {
                animatedSlider.removeEventListener('input', handleAnimatedSliderInput);
            });
        }

        // Slider 3 (gradient)
        const slider3 = document.querySelector('.debug-slider-3');
        const slider3Value = document.querySelector('.debug-slider-3-value');
        if (slider3 && slider3Value) {
            const handleSlider3Input = (e: Event) => {
                const target = e.target as HTMLInputElement;
                slider3Value.textContent = `${target.value}%`;
            };
            slider3.addEventListener('input', handleSlider3Input);
            this.unsubscribers.push(() => {
                slider3.removeEventListener('input', handleSlider3Input);
            });
        }
    }

    private bindDraggable(): void {
        const draggable = document.querySelector('.debug-draggable');
        if (!(draggable instanceof HTMLElement)) return;

        let isDragging = false;
        let startX = 0,
            startY = 0,
            initialX = 0,
            initialY = 0;

        const handleMouseDown = (e: MouseEvent) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = draggable.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            draggable.style.position = 'fixed';
            draggable.style.zIndex = '10000';
            draggable.style.cursor = 'grabbing';
            e.preventDefault();
            e.stopPropagation();
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            e.preventDefault();
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            draggable.style.left = `${String(initialX + dx)}px`;
            draggable.style.top = `${String(initialY + dy)}px`;
        };

        const handleMouseUp = () => {
            if (!isDragging) return;
            isDragging = false;
            draggable.style.cursor = 'move';
        };

        draggable.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        this.unsubscribers.push(() => {
            draggable.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        });
    }

    private bindDropzone(): void {
        const dropzone = document.querySelector('.debug-dropzone');
        if (!(dropzone instanceof HTMLElement)) return;

        const handleDragOver = (e: DragEvent) => {
            e.preventDefault();
            dropzone.classList.add('drag-over');
        };

        const handleDragLeave = () => {
            dropzone.classList.remove('drag-over');
        };

        const handleDrop = (e: DragEvent) => {
            e.preventDefault();
            dropzone.classList.remove('drag-over');
            dropzone.textContent =
                typeof globalThis.t === 'function'
                    ? globalThis.t('ui.debug.drag_drop.dragged', 'Item dragged!')
                    : 'Item dragged!';
            if (this._dropzoneResetTimeout !== null) {
                clearTimeout(this._dropzoneResetTimeout);
            }
            this._dropzoneResetTimeout = setTimeout(() => {
                dropzone.textContent =
                    typeof globalThis.t === 'function'
                        ? globalThis.t('ui.debug.drag_drop.drop_here', 'Drop here')
                        : 'Drop here';
                this._dropzoneResetTimeout = null;
            }, 2000);
        };

        dropzone.addEventListener('dragover', handleDragOver);
        dropzone.addEventListener('dragleave', handleDragLeave);
        dropzone.addEventListener('drop', handleDrop);

        this.unsubscribers.push(() => {
            dropzone.removeEventListener('dragover', handleDragOver);
            dropzone.removeEventListener('dragleave', handleDragLeave);
            dropzone.removeEventListener('drop', handleDrop);
        });
    }

    private bindTabs(): void {
        // Tab logic is exposed via global setDebugTab for HTML onclick handlers.
    }

    public setTab(tabId: string, btn?: HTMLElement): void {
        document.querySelectorAll('.debug-tab').forEach((t) => {
            t.classList.remove('active');
        });
        document.querySelectorAll('.debug-tab-content').forEach((p) => {
            p.classList.remove('active');
        });
        if (btn) btn.classList.add('active');
        const tabContent = document.getElementById(`debug-${tabId}-tab`);
        if (tabContent) {
            tabContent.classList.add('active');
        }
    }

    // --- Logs ---

    private bindLogControls(): void {
        const clearBtn = document.getElementById('clear-logs-btn');
        const copyBtn = document.getElementById('copy-logs-btn');

        const handleClear = () => {
            void this.clearLogs();
        };

        const handleCopy = () => {
            void this.copyLogs();
        };

        clearBtn?.addEventListener('click', handleClear);
        copyBtn?.addEventListener('click', handleCopy);

        this.unsubscribers.push(() => {
            clearBtn?.removeEventListener('click', handleClear);
            copyBtn?.removeEventListener('click', handleCopy);
        });
    }

    private setLogView(_view: string, btn: HTMLElement): void {
        // Update tab active states
        document.querySelectorAll('.console-tab').forEach((b) => {
            b.classList.remove('active');
        });
        btn.classList.add('active');

        // Show correct logs pane
        document.querySelectorAll('.logs-pane').forEach((p) => {
            p.classList.remove('active');
        });
        const pane = document.getElementById('logs-general'); // We only support general view for now per legacy
        if (pane) pane.classList.add('active');

        this.renderLogs(true);
    }

    public async clearLogs(): Promise<void> {
        await this.service.clearLogs();
        this.renderLogs(true);

        if (typeof globalThis.showToast === 'function') {
            const msg =
                typeof globalThis.t === 'function'
                    ? globalThis.t('ui.debug.logs_cleared', 'Logs cleared')
                    : 'Logs cleared';
            globalThis.showToast(msg, 'success', 1500);
        }
    }

    public async copyLogs(): Promise<void> {
        const logs = this.service.getLogs();
        const text = logs
            .map((log) => log.message.trim())
            .filter(Boolean)
            .join('\n');

        if (text.length === 0) {
            this._showToast('ui.debug.logs_empty', 'No logs to copy', 'warning', 1500);
            return;
        }

        try {
            await this._writeTextToClipboard(text);
            this._showToast('ui.debug.logs_copied', 'Logs copied', 'success', 1500);
        } catch {
            this._showToast('ui.debug.logs_copy_failed', 'Failed to copy logs', 'error', 1800);
        }
    }

    private async _writeTextToClipboard(text: string): Promise<void> {
        const isTauri = (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
        if (isTauri === undefined) {
            await this._copyWithBrowserApi(text);
            return;
        }

        try {
            await invoke('plugin:clipboard-manager|write_text', { text });
        } catch {
            await this._copyWithBrowserApi(text);
        }
    }

    private async _copyWithBrowserApi(text: string): Promise<void> {
        if (typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
            return;
        }

        throw new Error('Clipboard API is unavailable');
    }

    private _showToast(
        key: string,
        fallback: string,
        type: 'success' | 'error' | 'warning',
        duration: number,
    ): void {
        if (typeof globalThis.showToast !== 'function') {
            return;
        }

        const message = typeof globalThis.t === 'function' ? globalThis.t(key, fallback) : fallback;
        globalThis.showToast(message, type, duration);
    }

    public destroy(): void {
        if (!this._isInitialized) return;
        this._isInitialized = false;

        if (this.pollInterval !== null) {
            globalThis.clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this._pageChangeUnsub?.();
        this._pageChangeUnsub = null;
        this._hasRenderedLogs = false;
        if (this._dropzoneResetTimeout !== null) {
            clearTimeout(this._dropzoneResetTimeout);
            this._dropzoneResetTimeout = null;
        }
        this.unsubscribers.forEach((fn) => {
            fn();
        });
        this.unsubscribers = [];

        if (globalThis.setDebugTab === this._boundSetDebugTab) {
            globalThis.setDebugTab = this._previousSetDebugTab;
        }
        if (globalThis.setLogView === this._boundSetLogView) {
            globalThis.setLogView = this._previousSetLogView;
        }
        if (globalThis.clearLogs === this._boundClearLogs) {
            globalThis.clearLogs = this._previousClearLogs;
        }
    }

    private startLogPolling() {
        if (this.pollInterval !== null) globalThis.clearInterval(this.pollInterval);
        this.pollInterval = globalThis.setInterval(() => {
            // Only fetch when debug page is actually visible
            const consolePage = document.getElementById('page-console');
            if (consolePage?.classList.contains('active') !== true) return;

            void (async () => {
                const newLogs = await this.service.fetchLogs();
                if (newLogs.length > 0) {
                    this.renderLogs();
                }
            })();
        }, 2000) as unknown as number;
    }

    private async _refreshLogsOnConsoleOpen(): Promise<void> {
        await this.service.fetchLogs();
        this.renderLogs(true);
    }

    private renderLogs(clear = false): void {
        const scrollContainer = document.getElementById('console-container');
        const pane = document.getElementById('logs-general');
        if (!(scrollContainer instanceof HTMLElement) || !(pane instanceof HTMLElement)) return;

        const isInitialRender = this._hasRenderedLogs === false;
        const wasNearBottom =
            scrollContainer.scrollHeight -
                scrollContainer.scrollTop -
                scrollContainer.clientHeight <
            40;
        const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop;

        if (clear) pane.innerHTML = '';

        const logs = this.service.getLogs();
        pane.innerHTML = '';
        const fragment = document.createDocumentFragment();

        logs.forEach((log) => {
            const div = document.createElement('div');
            div.className = `log-entry level-${log.level}`;
            const sNorm = (log.source || '')
                .trim()
                .replaceAll(/[^a-z0-9_]/gi, '')
                .toUpperCase();
            const prefix = sNorm === 'SYSTEM' ? '⚙️' : '📝';
            const time = new Date(log.timestamp * 1000).toLocaleTimeString();

            // Safe DOM creation (XSS Proof)
            const timeSpan = document.createElement('span');
            timeSpan.className = 'log-time';
            timeSpan.textContent = time;

            const srcSpan = document.createElement('span');
            srcSpan.className = `log-src src-${sNorm}`;
            srcSpan.textContent = `${prefix} ${sNorm || log.source}`;

            const msgSpan = document.createElement('span');
            msgSpan.className = 'log-msg';
            msgSpan.textContent = log.message;

            div.appendChild(timeSpan);
            div.appendChild(srcSpan);
            div.appendChild(msgSpan);
            fragment.appendChild(div);
        });

        pane.appendChild(fragment);
        if (isInitialRender || clear || wasNearBottom) {
            this._scrollLogsToBottom(scrollContainer);
        } else {
            scrollContainer.scrollTop = Math.max(
                0,
                scrollContainer.scrollHeight - distanceFromBottom,
            );
        }
        this._hasRenderedLogs = true;
    }

    private _scrollLogsToBottom(container: HTMLElement): void {
        const scrollToBottom = () => {
            container.scrollTop = container.scrollHeight;
        };

        scrollToBottom();
        globalThis.requestAnimationFrame(scrollToBottom);
        globalThis.setTimeout(scrollToBottom, 80);
    }
}
