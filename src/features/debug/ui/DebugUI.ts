import { type DebugService } from '../services/DebugService';

export class DebugUI {
    constructor(private readonly service: DebugService) {}

    public init(): void {
        this.bindSliders();
        this.bindDraggable();
        this.bindDropzone();
        this.bindTabs();
        this.bindLogControls();
        this.startLogPolling();

        // Shim globals for backward compat if needed, or preferably we fix the calls.
        // Legacy debug.js exposed setDebugTab. We bind it here.
        globalThis.setDebugTab = (tabId: string, btn: HTMLElement) => {
            this.setTab(tabId, btn);
        };
        globalThis.setLogView = (view: string, btn: HTMLElement) => {
            this.setLogView(view, btn);
        };
        globalThis.clearLogs = () => this.clearLogs();
    }

    private bindSliders(): void {
        // Slider 1
        const slider1 = document.querySelector('.debug-slider-1');
        const slider1Value = document.querySelector('.debug-slider-1-value');
        if (slider1 && slider1Value) {
            slider1.addEventListener('input', (e) => {
                const target = e.target as HTMLInputElement;
                slider1Value.textContent = `${target.value}%`;
            });
        }

        // Slider 2 (animated)
        const animatedSlider = document.querySelector('.debug-slider-animated');
        const sliderValue = document.querySelector('.debug-slider-value');
        if (animatedSlider && sliderValue) {
            animatedSlider.addEventListener('input', (e) => {
                const target = e.target as HTMLInputElement;
                sliderValue.textContent = `${target.value}%`;
            });
        }

        // Slider 3 (gradient)
        const slider3 = document.querySelector('.debug-slider-3');
        const slider3Value = document.querySelector('.debug-slider-3-value');
        if (slider3 && slider3Value) {
            slider3.addEventListener('input', (e) => {
                const target = e.target as HTMLInputElement;
                slider3Value.textContent = `${target.value}%`;
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

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('drag-over');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('drag-over');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('drag-over');
            dropzone.textContent =
                typeof globalThis.t === 'function'
                    ? globalThis.t('ui.debug.drag_drop.dragged', 'Item dragged!')
                    : 'Item dragged!';
            setTimeout(() => {
                dropzone.textContent =
                    typeof globalThis.t === 'function'
                        ? globalThis.t('ui.debug.drag_drop.drop_here', 'Drop here')
                        : 'Drop here';
            }, 2000);
        });
    }

    private bindTabs(): void {
        // Tab logic is exposed via global setDebugTab for HTML onclick handlers
        // But we could also bind if using data attributes
        document.querySelectorAll('.debug-tab').forEach((btn) => {
            btn.addEventListener('click', () => {
                // Extract ID 'debug-general-tab-btn' -> 'general' ???
                // Legacy used: onclick="setDebugTab('general', this)"
                // We keep the global shim for now.
            });
        });
    }

    private setTab(tabId: string, btn: HTMLElement): void {
        document.querySelectorAll('.debug-tab').forEach((t) => {
            t.classList.remove('active');
        });
        document.querySelectorAll('.debug-tab-content').forEach((p) => {
            p.classList.remove('active');
        });
        btn.classList.add('active');
        const tabContent = document.getElementById(`debug-${tabId}-tab`);
        if (tabContent) {
            tabContent.classList.add('active');
        }
    }

    // --- Logs ---

    private bindLogControls(): void {
        // logic handled via global setLogView shim
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

    private pollInterval: number | null = null;
    private unsubscribers: (() => void)[] = [];

    public destroy(): void {
        if (this.pollInterval !== null) {
            globalThis.clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.unsubscribers.forEach((fn) => {
            fn();
        });
        this.unsubscribers = [];
    }

    private startLogPolling() {
        if (this.pollInterval !== null) globalThis.clearInterval(this.pollInterval);
        this.pollInterval = globalThis.setInterval(() => {
            void (async () => {
                const newLogs = await this.service.fetchLogs();
                if (newLogs.length > 0) {
                    this.renderLogs();
                }
            })();
        }, 1000) as unknown as number;
    }

    private renderLogs(clear = false): void {
        const container = document.getElementById('logs-general');
        if (!container) return;

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
        container.scrollTop = container.scrollHeight;
    }
}
