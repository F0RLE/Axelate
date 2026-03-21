import { invoke } from '@tauri-apps/api/core';
import { type DebugService } from '../services/DebugService';

export class DebugUI {
    private pollInterval: number | null = null;
    private unsubscribers: (() => void)[] = [];
    private _isInitialized = false;
    private _dropzoneResetTimeout: ReturnType<typeof setTimeout> | null = null;
    private _previousSetDebugTab = globalThis.setDebugTab;
    private _previousSetLogView = globalThis.setLogView;
    private _previousClearLogs = globalThis.clearLogs;
    private readonly _boundSetDebugTab = (tabId: string, btn: HTMLElement) => {
        this.setTab(tabId, btn);
    };
    private readonly _boundSetLogView = (view: string, btn: HTMLElement) => {
        this.setLogView(view, btn);
    };
    private readonly _boundClearLogs = () => this.clearLogs();

    constructor(private readonly service: DebugService) {}

    public init(): void {
        if (this._isInitialized) return;
        this._isInitialized = true;

        this.bindSliders();
        this.bindDraggable();
        this.bindDropzone();
        this.bindTabs();
        this.bindLogControls();
        this.startLogPolling();

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
            .filter((message) => message.length > 0)
            .join('\n');

        if (!text) {
            if (typeof globalThis.showToast === 'function') {
                const msg =
                    typeof globalThis.t === 'function'
                        ? globalThis.t('ui.debug.logs_empty', 'No logs to copy')
                        : 'No logs to copy';
                globalThis.showToast(msg, 'warning', 1500);
            }
            return;
        }

        try {
            const isTauri = (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
            if (isTauri !== undefined) {
                try {
                    await invoke('plugin:clipboard-manager|write_text', { text });
                } catch {
                    await this._copyWithBrowserApi(text);
                }
            } else {
                await this._copyWithBrowserApi(text);
            }

            if (typeof globalThis.showToast === 'function') {
                const msg =
                    typeof globalThis.t === 'function'
                        ? globalThis.t('ui.debug.logs_copied', 'Logs copied')
                        : 'Logs copied';
                globalThis.showToast(msg, 'success', 1500);
            }
        } catch {
            if (typeof globalThis.showToast === 'function') {
                const msg =
                    typeof globalThis.t === 'function'
                        ? globalThis.t('ui.debug.logs_copy_failed', 'Failed to copy logs')
                        : 'Failed to copy logs';
                globalThis.showToast(msg, 'error', 1800);
            }
        }
    }

    private async _copyWithBrowserApi(text: string): Promise<void> {
        if (typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }

    public destroy(): void {
        if (!this._isInitialized) return;
        this._isInitialized = false;

        if (this.pollInterval !== null) {
            globalThis.clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
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
            const debugPage = document.getElementById('page-debug');
            if (debugPage?.classList.contains('active') !== true) return;

            void (async () => {
                const newLogs = await this.service.fetchLogs();
                if (newLogs.length > 0) {
                    this.renderLogs();
                }
            })();
        }, 2000) as unknown as number;
    }

    private renderLogs(clear = false): void {
        const container = document.getElementById('logs-general');
        if (!container) return;

        const wasNearBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight < 40;
        const distanceFromBottom = container.scrollHeight - container.scrollTop;

        if (clear) container.innerHTML = '';

        const logs = this.service.getLogs();
        container.innerHTML = '';
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

        container.appendChild(fragment);
        if (clear || wasNearBottom) {
            container.scrollTop = container.scrollHeight;
        } else {
            container.scrollTop = Math.max(0, container.scrollHeight - distanceFromBottom);
        }
    }
}
