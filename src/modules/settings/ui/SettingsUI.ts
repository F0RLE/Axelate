/**
 * @module settings/ui/SettingsUI
 * @description Centralized UI management for the settings application, including dynamic module configuration and rendering.
 *
 * @example
 * ```typescript
 * const settingsUI = new SettingsUI(settingsService, stateService);
 * settingsUI.init();
 * ```
 */

import DOMPurify from 'dompurify';
import { eventBus } from '@/modules/core/services/EventBus';
import { aiSettingsRenderer } from '@/modules/ai/ui/AISettingsRenderer';
import { SettingsService } from '../services/SettingsService';
import { StateService } from '../../core/services/StateService';
import { IApp, IConfigField } from '../../core/types/coreTypes';
import { GeneralSettingsRenderer } from './GeneralSettingsRenderer';

interface ISettingsGlobal {
    toggleNavItem: (id: string, en: boolean) => void;
    toggleMonitorItem: (id: string, en: boolean) => void;
    setCardWidth: (btn: HTMLElement, w: string) => void;
    control: (a: 'start' | 'stop' | 'restart', s: string) => Promise<boolean>;
    openModuleSettings: (app: IApp) => void;
    t?: (key: string, defaultVal?: string, params?: unknown) => string;
    showToast?: (m: string, s: string, d?: number) => void;
    launchApp?: (id: string) => void;
    currentSettingsModule?: IApp;
    APP_DATA?: { ai: IApp[] };
    applyTranslations?: () => void;
}

export class SettingsUI {
    private readonly _unsubscribers: (() => void)[] = [];
    private readonly _resizeState = {
        isResizing: false,
        card: null as HTMLElement | null,
        startX: 0,
        startWidth: 'full',
        hasSwitched: false,
    };

    private readonly ICONS = {
        VISIBLE:
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>',
        HIDDEN: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>',
        CHECK: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        X: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
        SPINNER:
            '<svg style="animation: spin 1s linear infinite; width: 18px; height: 18px;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle style="opacity: 0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path style="opacity: 0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>',
    };

    private readonly _generalRenderer: GeneralSettingsRenderer;

    constructor(
        private readonly _service: SettingsService,
        private readonly _state: StateService,
    ) {
        aiSettingsRenderer.init(_service);
        this._generalRenderer = new GeneralSettingsRenderer(_state);
    }

    /**
     * Initializes the settings UI, renders components, and binds events.
     */
    public async init(): Promise<void> {
        console.log('[SettingsUI] Initializing...');

        // Wait for settings template to be injected
        let attempts = 0;
        let container = document.getElementById('settings-grid');
        while (!container && attempts < 10) {
            await new Promise((r) => setTimeout(r, 100));
            container = document.getElementById('settings-grid');
            attempts++;
        }

        if (!container) {
            console.warn(
                '[SettingsUI] Settings container not found after 1s. Templates might still be loading.',
            );
        }

        // 0. Subscribe to navigation events (Section 2.4)
        const unsub = eventBus.on('page:change', () => this.close());
        this._unsubscribers.push(unsub);

        // 1. Load Data
        // 2. Init UI Components
        this._generalRenderer.init();
        this._loadCardWidths();
        this._bindEvents();
        this._bindResizeEvents();

        // 4. Load GPU Info
        this._loadGpuInfo().catch((e) => console.error('[SettingsUI] GPU Info failed:', e));

        const win = globalThis as unknown as ISettingsGlobal;

        win.toggleNavItem = (id: string, en: boolean) =>
            this._generalRenderer.toggleNavItem(id, en);
        win.toggleMonitorItem = (id: string, en: boolean) =>
            this._generalRenderer.toggleMonitorItem(id, en);
        win.setCardWidth = (btn: HTMLElement, w: string) => this.setCardWidth(btn, w);
        win.control = (a: 'start' | 'stop' | 'restart', s: string) => {
            if (a === 'start' || a === 'stop' || a === 'restart') {
                return this._service.controlService(a, s);
            }
            return Promise.resolve(false);
        };
        win.openModuleSettings = (app: IApp) => {
            this.openModuleSettings(app).catch((e) => console.error(e));
        };

        // Listen for language changes to refresh dynamic UI
        globalThis.addEventListener('lang:changed', () => {
            this.refreshActiveModule();
        });

        this._loadCustomModels();
    }

    public static close(): void {
        const modal = document.getElementById('module-settings-modal') as HTMLElement;
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.style.display = 'none';
                modal.classList.add('hidden');
            }, 300);
        }
    }

    /**
     * Re-renders the currently open settings module (e.g. on language change).
     */
    public refreshActiveModule(): void {
        const win = globalThis as unknown as Window & { currentSettingsModule: IApp };
        const currentApp = win.currentSettingsModule;

        // Re-render module settings if modal is open
        const modal = document.getElementById('module-settings-modal');
        const container = document.getElementById('module-config-modal-active');

        if (modal && !modal.classList.contains('hidden') && container && currentApp) {
            console.log('[SettingsUI] Refreshing active module settings:', currentApp.id);

            // Update Title
            const title = document.getElementById('module-settings-title');
            const suffix = globalThis.t
                ? globalThis.t('ui.settings.header_suffix', 'Settings')
                : 'Settings';
            if (title) title.innerHTML = DOMPurify.sanitize(suffix);

            // Dynamic re-render
            this._renderSpecializedModuleConfig(container, currentApp).catch((e) =>
                console.error(e),
            );
        }
    }

    public close(): void {
        SettingsUI.close();
    }

    /**
     * Resets internal state and deactivates observers.
     * MANDATORY cleanup method required by Section 4.3.
     */
    public destroy(): void {
        this._unsubscribers.forEach((fn) => fn());
        this._unsubscribers.length = 0;
        console.log('[SettingsUI] Destroyed.');
    }

    /**
     * Loads GPU information from the service and updates the UI.
     */
    private async _loadGpuInfo() {
        const data = await this._service.loadGpuInfo();
        const gpuInfoEl = document.getElementById('gpu-info');
        const win = globalThis as unknown as Window & { t: (k: string, d: string) => string };
        const t = win.t || ((_k: string, d: string) => d);

        if (!gpuInfoEl) return;

        if (data.detected) {
            gpuInfoEl.className = 'gpu-info detected';
            gpuInfoEl.innerHTML = DOMPurify.sanitize(`
                <div style="font-weight: 600; margin-bottom: 0.25rem;">${data.name}</div>
                <div class="gpu-info-details">${data.cuda ? 'CUDA • ' : ''}${data.memory ? data.memory + ' GB' : ''}</div>
            `);
        } else {
            gpuInfoEl.className = 'gpu-info not-detected';
            gpuInfoEl.innerHTML = DOMPurify.sanitize(
                `<div>${t('ui.launcher.web.gpu_not_found', 'GPU not found')}</div><div class="gpu-info-details">${t('ui.launcher.web.gpu_fallback_cpu', 'CPU will be used (slower)')}</div>`,
            );
        }
    }

    /**
     * Renders a specialized module configuration UI (API, Local AI, or generic).
     */
    private async _renderSpecializedModuleConfig(container: HTMLElement, app: IApp) {
        if (app.type === 'api' || app.id === 'gpt' || app.id === 'gemini' || app.id === 'claude') {
            await this._renderUniversalApiSettings(container, app);
            return;
        }

        // Clean settings for specific apps (User Request)
        if (
            ['axelate', 'axelate-platform', 'axelate-localai'].includes(app.id) ||
            app.id.includes('telegram')
        ) {
            this._renderEmptyState(container, app);
            return;
        }

        // Default Schema-based rendering
        container.innerHTML = '';
        if (app.config_schema && Object.keys(app.config_schema).length > 0) {
            const form = document.createElement('div');
            form.className = 'module-settings-form';

            const header = document.createElement('h3');
            header.style.marginBottom = '1.5rem';
            header.style.color = 'var(--text-primary)';
            header.textContent = app.name || app.id;
            form.appendChild(header);

            Object.entries(app.config_schema).forEach(([key, field]) => {
                this._renderSettingField(form, app.id, key, field);
            });
            container.appendChild(form);
        } else {
            this._renderEmptyState(container, app);
        }
    }

    /**
     * Renders a standardized empty state for modules with no settings.
     * "There is nothing there" - Minimalist visual standard.
     */
    private _renderEmptyState(container: HTMLElement, _app: IApp) {
        container.innerHTML = DOMPurify.sanitize(`
            <div class="ai-module-config universal-api-theme" style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; padding: 2rem 0;">
                <div style="text-align: center; color: var(--text-secondary); font-size: 1.2rem; opacity: 0.7;">
                    This module is not ready yet.
                </div>
            </div>
        `);
    }

    /**
     * Renders universal API settings using the AIRenderer.
     */
    private async _renderUniversalApiSettings(container: HTMLElement, app: IApp): Promise<void> {
        // Delegate to dedicated AI Settings Renderer singleton (Section 16.1)
        await aiSettingsRenderer.render(container, app);
    }

    /**
     * Renders quality and capability stats for an AI model.
     */
    private _renderAIModelStats(appId: string, modelKey: string): string {
        const win = globalThis as unknown as Window & {
            APP_DATA: { ai: IApp[] };
            t: (k: string, d: string) => string;
        };
        const catalog = win.APP_DATA?.ai || [];
        const app = catalog.find((a) => a.id === appId);
        const providerData = app?.api_provider_data as
            | {
                  models?: Record<
                      string,
                      { stats: { speed: number; logic: number; creative: number } }
                  >;
              }
            | undefined;
        const models = providerData?.models || {};
        const stats = models[modelKey]?.stats;

        if (!stats) return '<div class="model-desc">Stats unavailable</div>';

        const renderStars = (count: number) => {
            let s = '';
            for (let i = 0; i < 5; i++) {
                s += `<span style="color: ${i < count ? '#FFD700' : 'rgba(255,255,255,0.1)'}; font-size: 1.1rem;">★</span>`;
            }
            return s;
        };

        const t = win.t || ((_k: string, d: string) => d);

        return `
            <div class="ai-stats-grid">
                <div>
                    <div class="stat-label" data-i18n="ui.gpt.stats.speed">${t('ui.gpt.stats.speed', 'Speed')}</div>
                    <div>${renderStars(stats.speed)}</div>
                </div>
                <div>
                    <div class="stat-label" data-i18n="ui.gpt.stats.logic">${t('ui.gpt.stats.logic', 'Logic')}</div>
                    <div>${renderStars(stats.logic)}</div>
                </div>
                <div>
                    <div class="stat-label" data-i18n="ui.gpt.stats.creative">${t('ui.gpt.stats.creative', 'Creative')}</div>
                    <div>${renderStars(stats.creative)}</div>
                </div>
            </div>
        `;
    }

    /**
     * Toggles visibility of an API key input field.
     */
    public toggleModuleKeyVisibility(appId: string) {
        const input = document.getElementById(`${appId}-api-key-input`) as HTMLInputElement;
        const btn = document.getElementById(`${appId}-key-toggle-btn`) as HTMLElement;
        if (input && btn) {
            const isPass = input.type === 'password';
            input.type = isPass ? 'text' : 'password';
            btn.innerHTML = isPass ? this.ICONS.VISIBLE : this.ICONS.HIDDEN;
        }
    }

    /**
     * Checks the validity of an API key via its provider endpoint.
     */
    public async checkModuleKey(appId: string) {
        const input = document.getElementById(`${appId}-api-key-input`) as HTMLInputElement;
        const btn = document.getElementById(`${appId}-key-check-btn`) as HTMLElement;
        if (!input || !btn) return;

        const win = globalThis as unknown as Window & {
            t: (k: string, d: string) => string;
            showToast: (m: string, s: string) => void;
            APP_DATA: { ai: IApp[] };
        };
        const t = win.t || ((_k: string, d: string) => d);

        const key = input.value.trim();
        if (!key) {
            win.showToast(t('ui.settings.key_invalid', 'Invalid Key'), 'error');
            return;
        }

        const originalHtml = btn.innerHTML;
        const originalWidth = btn.offsetWidth;
        btn.style.width = originalWidth + 'px';
        btn.innerHTML = this.ICONS.SPINNER;
        btn.style.pointerEvents = 'none';

        try {
            let ok = false;
            // Get provider data for endpoint
            const catalog = win.APP_DATA?.ai || [];
            const app = catalog.find((a) => a.id === appId);
            const provider = (app?.api_provider_data as { baseUrl?: string }) || {};

            if (appId === 'gemini') {
                const res = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
                );
                ok = res.ok;
            } else {
                let url = 'https://api.openai.com/v1/models';
                if (provider.baseUrl) {
                    url = provider.baseUrl.endsWith('/v1')
                        ? `${provider.baseUrl}/models`
                        : `${provider.baseUrl}/v1/models`;
                }
                const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
                ok = res.ok;
            }

            if (ok) {
                btn.style.borderColor = 'var(--success)';
                btn.style.color = 'var(--success)';
                btn.innerHTML = this.ICONS.CHECK;
                win.showToast(t('ui.settings.key_valid', 'Key is valid'), 'success');
            } else {
                btn.style.borderColor = 'var(--error)';
                btn.style.color = 'var(--error)';
                btn.innerHTML = this.ICONS.X;
                win.showToast(t('ui.settings.key_invalid_check', 'Key is invalid'), 'error');
            }
        } catch {
            btn.style.borderColor = 'var(--error)';
            btn.style.color = 'var(--error)';
            btn.innerHTML = this.ICONS.X;
            win.showToast(t('ui.settings.key_check_error', 'Key check error'), 'error');
        } finally {
            setTimeout(() => {
                btn.style.pointerEvents = 'auto';
                btn.style.width = '';
                btn.style.borderColor = 'var(--border-color)';
                btn.style.color = 'var(--text-secondary)';
                btn.innerHTML = originalHtml;
            }, 3000);
        }
    }

    /**
     * Selects an AI model and re-renders stats.
     */
    public selectAIModel(appId: string, modelKey: string) {
        localStorage.setItem(`${appId}_selected_model`, modelKey);

        // Re-render only stats and update selection visually
        const grid = document.querySelector('.ai-models-grid');
        grid?.querySelectorAll('.ai-model-card').forEach((card) => {
            const cardModelKey = (card as HTMLElement).dataset.modelKey;
            card.classList.toggle('selected', cardModelKey === modelKey);
        });

        const statsArea = document.getElementById(`${appId}-model-stats`);
        if (statsArea) {
            const win = globalThis as unknown as Window & {
                t: (k: string, d: string) => string;
                applyTranslations?: () => void;
            };
            const t = win.t || ((_k: string, d: string) => d);
            statsArea.innerHTML = DOMPurify.sanitize(
                `<h3 data-i18n="ui.settings.model_stats">${t('ui.settings.model_stats', 'Model Stats')}</h3>${this._renderAIModelStats(appId, modelKey)}`,
            );

            // Apply translations to dynamically added content
            if (typeof win.applyTranslations === 'function') {
                win.applyTranslations();
            }
        }
    }

    private _loadCustomModels() {
        // Custom models will be handled via the dynamic provider data in the next iteration
    }

    /**
     * Prompts the user to add a custom AI model.
     */
    public addCustomModelToSettings(provider: 'openai' | 'gemini' | 'local') {
        const win = globalThis as unknown as Window & {
            t: (k: string, d?: string, p?: Record<string, unknown>) => string;
            currentSettingsModule: IApp;
            showToast: (m: string, s: string) => void;
        };
        const t = win.t || ((k: string, d?: string) => d || k);

        const modelId = prompt(
            t(
                'ui.settings.custom_model.prompt_id',
                `Enter Model ID for ${provider} (e.g. gpt-4o):`,
                { provider },
            ),
        );
        if (!modelId) return;
        const modelName = prompt(
            t('ui.settings.custom_model.prompt_name', 'Enter Display Name:'),
            modelId,
        );
        if (!modelName) return;

        try {
            const customModels = JSON.parse(localStorage.getItem('chat_custom_models') || '[]');
            customModels.push({ provider, id: modelId, name: modelName });
            localStorage.setItem('chat_custom_models', JSON.stringify(customModels));

            // Custom models will be added to the provider's model list in future update
            win.showToast(
                t('ui.settings.custom_model.toast_update', 'Custom model support is being updated'),
                'info',
            );

            // Re-render current modal content
            const container = document.getElementById('module-config-modal-active') as HTMLElement;
            if (container) {
                const currentApp = win.currentSettingsModule;
                if (currentApp) {
                    this._renderUniversalApiSettings(container, currentApp).catch((e) =>
                        console.error(e),
                    );
                }
            }

            win.showToast(
                t('ui.settings.custom_model.toast_added', 'Custom model added'),
                'success',
            );
        } catch (e) {
            console.error('[SettingsUI] Failed to add custom model', e);
        }
    }

    public updateModuleSettings(_configModels: unknown) {
        // Dynamic update logic will be implemented via the catalog refresh
    }

    // --- Card Resizing ---

    private _loadCardWidths() {
        const widths = this._state.getCardWidths();
        Object.keys(widths).forEach((id) => {
            const card = document.querySelector(
                `.resizable-card[data-card-id="${id}"]`,
            ) as HTMLElement;
            if (card) {
                card.dataset.cardWidth = widths[id];
                this._updateCardLayout(card, widths[id]);
            }
        });
    }

    private setCardWidth(btn: HTMLElement, width: string) {
        const card = btn.closest('.hardware-card') as HTMLElement;
        if (!card) return;

        card.dataset.cardWidth = width;
        const id = card.dataset.cardId;
        if (id) this._state.setCardWidth(id, width);

        // Update active button state
        const buttons = card.querySelectorAll<HTMLElement>('.btn');
        buttons.forEach((b) => {
            if (b === btn) {
                b.style.background = 'var(--primary)';
                b.style.color = 'white';
            } else {
                b.style.background = 'var(--bg-light)';
                b.style.color = 'var(--text-secondary)';
            }
        });

        this._updateCardLayout(card, width);
    }

    private _updateCardLayout(card: HTMLElement, width: string) {
        const container = card.closest('[style*="grid-template-columns"]') as HTMLElement;
        if (container) {
            if (width === 'full') {
                container.style.gridTemplateColumns = '1fr';
            } else {
                container.style.gridTemplateColumns = '1fr 1fr';
            }
        }
    }

    private _bindResizeEvents() {
        document.querySelectorAll('.resize-handle').forEach((h) => {
            h.addEventListener('mousedown', (e) =>
                this._startResize(e as MouseEvent, h as HTMLElement),
            );
        });

        document.addEventListener('mousemove', (e) => this._handleResizeMove(e));
        document.addEventListener('mouseup', () => this._handleResizeUp());
    }

    private _startResize(e: MouseEvent, handle: HTMLElement) {
        e.preventDefault();
        this._resizeState.isResizing = true;
        this._resizeState.card = handle.closest('.resizable-card');
        this._resizeState.startX = e.clientX;
        this._resizeState.startWidth = this._resizeState.card?.dataset.cardWidth || 'full';
        this._resizeState.hasSwitched = false;

        document.body.style.cursor = 'ew-resize';
        document.body.classList.add('no-select');

        const overlay = document.createElement('div');
        overlay.id = 'resize-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.zIndex = '9999';
        overlay.style.cursor = 'ew-resize';
        document.body.appendChild(overlay);
    }

    /**
     * Handles mouse movement during card resizing.
     */
    private _handleResizeMove(e: MouseEvent) {
        if (!this._resizeState.isResizing || !this._resizeState.card) return;
        const delta = e.clientX - this._resizeState.startX;
        const threshold = 100;

        if (this._resizeState.hasSwitched) return;

        if (this._resizeState.startWidth === 'full' && delta < -threshold) {
            this._resizeState.card.dataset.cardWidth = 'half';
            this._resizeState.hasSwitched = true;
            this._saveResizedWidth(this._resizeState.card);
        } else if (this._resizeState.startWidth === 'half' && delta > threshold) {
            this._resizeState.card.dataset.cardWidth = 'full';
            this._resizeState.hasSwitched = true;
            this._saveResizedWidth(this._resizeState.card);
        }
    }

    /**
     * Finalizes the resizing process.
     */
    private _handleResizeUp() {
        if (this._resizeState.isResizing) {
            this._resizeState.isResizing = false;
            this._resizeState.card = null;
            document.body.style.cursor = '';
            document.body.classList.remove('no-select');
            const overlay = document.getElementById('resize-overlay');
            if (overlay) overlay.remove();
        }
    }

    /**
     * Saves the new card width to state.
     */
    private _saveResizedWidth(card: HTMLElement) {
        const id = card.dataset.cardId;
        if (id) {
            this._state.setCardWidth(id, card.dataset.cardWidth || 'full');
        }
    }

    // --- Auto Save ---

    /**
     * Binds global events (e.g. clicking outside dropdowns).
     */
    private _bindEvents() {
        // Dropdown outside click
        document.addEventListener('click', (e) => {
            document.querySelectorAll('.lang-dropdown-menu').forEach((dropdown) => {
                const page = dropdown.id.replace('lang-dropdown-menu-', '');
                const btn = document.getElementById(`lang-dropdown-btn-${page}`);
                if (
                    dropdown &&
                    btn &&
                    !dropdown.contains(e.target as Node) &&
                    !btn.contains(e.target as Node)
                ) {
                    dropdown.classList.remove('show');
                }
            });
        });
    }

    /**
     * Opens the settings modal for a specific module.
     */
    public async openModuleSettings(app: IApp) {
        const modal = document.getElementById('module-settings-modal');
        const container = document.getElementById('module-config-modal-active');
        const title = document.getElementById('module-settings-title');

        if (!modal || !container || !title) return;

        // Set global context for other modules
        const win = globalThis as unknown as Window & { currentSettingsModule: IApp };
        win.currentSettingsModule = app;

        const suffix = globalThis.t
            ? globalThis.t('ui.settings.header_suffix', 'Settings')
            : 'Settings';
        title.innerHTML = DOMPurify.sanitize(suffix);

        await this._renderSpecializedModuleConfig(container, app);

        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('show'), 10);

        // Close logic
        const closeBtn = document.getElementById('close-module-settings-btn');
        if (closeBtn) {
            closeBtn.onclick = () => this.close();
        }

        // Close on overlay click
        modal.onclick = (e) => {
            if (e.target === modal) {
                this.close();
            }
        };
    }

    /**
     * Shows a transient save confirmation message.
     */
    private _showSaveIndicator() {
        let el = document.getElementById('save-indicator');
        if (!el) {
            el = document.createElement('div');
            el.id = 'save-indicator';
            el.className = 'save-indicator';
            const msg = globalThis.t
                ? globalThis.t('ui.settings.saved_message', 'Settings Saved')
                : 'Settings Saved';
            el.innerHTML = DOMPurify.sanitize(`<span>${msg}</span>`);
            document.body.appendChild(el);
        }
        el.classList.add('show');
        setTimeout(() => el?.classList.remove('show'), 2000);
    }

    /**
     * Renders a single setting field based on its type.
     */
    private _renderSettingField(
        form: HTMLElement,
        appId: string,
        key: string,
        field: IConfigField,
    ): void {
        const row = document.createElement('div');
        row.className = 'form-row';

        const label = document.createElement('label');
        label.textContent = field.label || key;
        row.appendChild(label);

        const settingKey = `${appId}_${key}`;
        const savedSettings = this._service.getSettings();
        const initialValue = savedSettings[settingKey] ?? field.default;

        let input: HTMLElement;

        if (field.field_type === 'select' && field.options) {
            input = this._createSelectField(field.options, initialValue);
        } else if (field.field_type === 'boolean') {
            const isTrue = String(initialValue) === 'true';
            input = this._createToggleField(isTrue);
        } else if (field.field_type === 'number') {
            input = this._createNumberField(Number(initialValue));
        } else {
            input = this._createTextField(String(initialValue));
        }

        row.appendChild(input);
        form.appendChild(row);

        this._attachAutoSave(input, field.field_type, settingKey);
    }

    /**
     * Creates a select dropdown field.
     */
    private _createSelectField(
        options: string[],
        currentVal: string | number | boolean | null,
    ): HTMLElement {
        const select = document.createElement('select');
        select.className = 'form-select';
        options.forEach((opt) => {
            const option = document.createElement('option');
            option.value = opt;
            option.textContent = opt;
            if (currentVal === opt) option.selected = true;
            select.appendChild(option);
        });
        return select;
    }

    /**
     * Creates a toggle switch field.
     */
    private _createToggleField(isChecked: boolean): HTMLElement {
        const div = document.createElement('div');
        div.className = 'form-toggle';
        div.innerHTML = DOMPurify.sanitize(`
            <label class="switch">
                <input type="checkbox" ${isChecked ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
        `);
        return div;
    }

    /**
     * Creates a number input field.
     */
    private _createNumberField(value: number): HTMLElement {
        const input = document.createElement('input');
        input.className = 'form-input';
        input.type = 'number';
        input.value = String(value);
        return input;
    }

    /**
     * Creates a text input field.
     */
    private _createTextField(value: string): HTMLElement {
        const input = document.createElement('input');
        input.className = 'form-input';
        input.type = 'text';
        input.value = value;
        return input;
    }

    /**
     * Attaches change/input listeners for auto-saving settings.
     */
    private _attachAutoSave(input: HTMLElement, type: string, settingKey: string): void {
        const save = async (val: string | number | boolean) => {
            console.log(`[SettingsUI] Auto-saving: ${settingKey} = ${val}`);
            await this._service.saveSetting(settingKey, val);
            this._showSaveIndicator();
        };

        if (type === 'boolean') {
            const checkbox = input.querySelector('input[type="checkbox"]') as HTMLInputElement;
            checkbox.onchange = () => {
                save(checkbox.checked).catch((e) => console.error(e));
            };
        } else if (type === 'select') {
            (input as HTMLSelectElement).onchange = () => {
                save((input as HTMLSelectElement).value).catch((e) => console.error(e));
            };
        } else if (type === 'number') {
            (input as HTMLInputElement).onchange = () => {
                save(Number((input as HTMLInputElement).value)).catch((e) => console.error(e));
            };
        } else {
            (input as HTMLInputElement).onchange = () => {
                save((input as HTMLInputElement).value).catch((e) => console.error(e));
            };
        }
    }
}
