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
import { type IGlobalBridge, type TGlobalWin } from '@/shared/types/global_bridge_types';
import { eventBus } from '@/shared/services/EventBus';
import { aiSettingsRenderer } from '@/features/ai/ui/AISettingsRenderer';
import { logger } from '@/shared/services/LoggerService';
import { type SettingsService } from '../services/SettingsService';
import { type StateService } from '@/shared/services/StateService';
import type { IApp, IConfigField } from '@/shared/types/coreTypes';
import { GeneralSettingsRenderer } from './GeneralSettingsRenderer';
import type { ISettingsUIContext } from './SettingsContext';
import { createField } from './components/FieldFactory';
import { CardResizer } from './components/CardResizer';

type SettingValue = string | number | boolean | null;

export class SettingsUI {
    // ... existing properties ...

    // ... existing methods ...

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
        // Safe cast to access dictionary
        const savedSettings = this._service.getSettings() as unknown as Record<
            string,
            SettingValue
        >;
        const initialValue = savedSettings[settingKey] ?? field.default;

        const fieldComponent = createField(field, initialValue);

        fieldComponent.onChange((val: unknown) => {
             // Cast val to SettingValue (string|number|boolean|null)
            this._debouncedSave(settingKey, val as SettingValue);
        });

        row.appendChild(fieldComponent.render());
        form.appendChild(row);
    }
    private readonly _unsubscribers: (() => void)[] = [];
    private _context!: ISettingsUIContext;
    private _resizer!: CardResizer;

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
        aiSettingsRenderer.init(_service, _state);
        this._generalRenderer = new GeneralSettingsRenderer(_state);
    }

    /**
     * Initializes the settings UI, renders components, and binds events.
     */
    public async init(): Promise<void> {
        logger.info('[SettingsUI] Initializing...');

        // 1. Setup Context
        const win = globalThis as TGlobalWin;
        this._context = {
            t: win.t ?? ((_: string, d?: string) => d ?? ''),
            showToast:
                win.showToast ??
                ((m: string, s: string) => {
                    logger.info(m, s);
                }),
            toggleNavItem: (id: string, en: boolean) => {
                this._generalRenderer.toggleNavItem(id, en);
            },
            toggleMonitorItem: (id: string, en: boolean) => {
                this._generalRenderer.toggleMonitorItem(id, en);
            },
        };

        // Wait for settings template to be injected
        let attempts = 0;
        let container = document.getElementById('settings-grid');
        while (!container && attempts < 10) {
            await new Promise((r) => setTimeout(r, 100));
            container = document.getElementById('settings-grid');
            attempts++;
        }

        if (!container) {
            logger.warn(
                '[SettingsUI] Settings container not found after 1s. Templates might still be loading.',
            );
        }

        // 0. Subscribe to navigation events
        const unsub = eventBus.on('page:change', () => {
            this.close();
        });
        this._unsubscribers.push(unsub);

        // 1. Load Data
        this._generalRenderer.init(this._context);
        this._loadCardWidths();
        this._bindEvents();

        this._resizer = new CardResizer((id: string, w: string) => {
            this._state.setCardWidth(id, w);
        });
        this._resizer.init();

        // 4. Load GPU Info
        this._loadGpuInfo().catch((e: unknown) => {
            logger.error('[SettingsUI] GPU Info failed:', e);
        });

        // 5. Expose necessary global functions (legacy support for some templates)
        win.openModuleSettings = (app: IApp) => {
            void this._openModuleSettingsHelper(app).catch((e: unknown) => {
                logger.error(String(e));
            });
        };
        (win as unknown as IGlobalBridge)['setCardWidth'] = (btn: HTMLElement, w: string) => {
            this.setCardWidth(btn, w);
        };

        globalThis.addEventListener('lang:changed', () => {
            this.refreshActiveModule();
        });
    }

    public static close(): void {
        const modal = document.getElementById('module-settings-modal');
        if (modal instanceof HTMLElement) {
            // modal-backdrop uses hidden class with CSS transition
            modal.classList.add('hidden');
        }
    }

    /**
     * Re-renders the currently open settings module (e.g. on language change).
     */
    public refreshActiveModule(): void {
        const currentApp = this._context.currentModule;

        const modal = document.getElementById('module-settings-modal');
        const container = document.getElementById('module-config-modal-active');

        if (
            modal?.classList.contains('hidden') === false &&
            container !== null &&
            currentApp !== undefined
        ) {
            logger.debug('[SettingsUI] Refreshing active module settings:', currentApp.id);

            const title = document.getElementById('module-settings-title');
            const suffix = this._context.t('ui.settings.header_suffix', 'Settings');
            if (title !== null) title.innerHTML = DOMPurify.sanitize(suffix);

            this._renderSpecializedModuleConfig(container, currentApp).catch((e: unknown) => {
                logger.error(String(e));
            });
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
        this._unsubscribers.forEach((fn) => {
            fn();
        });
        this._unsubscribers.length = 0;
        logger.info('[SettingsUI] Destroyed.');
    }

    /**
     * Loads GPU information from the service and updates the UI.
     */
    private async _loadGpuInfo() {
        const data = await this._service.loadGpuInfo();
        const gpuInfoEl = document.getElementById('gpu-info');
        if (!gpuInfoEl) return;

        if (data.detected) {
            gpuInfoEl.className = 'gpu-info detected';
            gpuInfoEl.innerHTML = DOMPurify.sanitize(`
                <div style="font-weight: 600; margin-bottom: 0.25rem;">${data.name ?? ''}</div>
                <div class="gpu-info-details">${data.cuda === true ? 'CUDA • ' : ''}${data.memory === undefined ? '' : `${data.memory.toString()} GB`}</div>
            `);
        } else {
            gpuInfoEl.className = 'gpu-info not-detected';
            gpuInfoEl.innerHTML = DOMPurify.sanitize(
                `<div>${this._context.t('ui.launcher.web.gpu_not_found', 'GPU not found')}</div><div class="gpu-info-details">${this._context.t('ui.launcher.web.gpu_fallback_cpu', 'CPU will be used (slower)')}</div>`,
            );
        }
    }

    /**
     * Renders a specialized module configuration UI (API, Local AI, or generic).
     */
    private async _renderSpecializedModuleConfig(container: HTMLElement, app: IApp) {
        const renderers: Record<string, (c: HTMLElement, a: IApp) => Promise<void> | void> = {
            gpt: (c, a) => {
                void this._renderUniversalApiSettings(c, a);
            },
            gemini: (c, a) => {
                void this._renderUniversalApiSettings(c, a);
            },
            claude: (c, a) => {
                void this._renderUniversalApiSettings(c, a);
            },
            axelate: (c, a) => {
                this._renderEmptyState(c, a);
            },
            'axelate-platform': (c, a) => {
                this._renderEmptyState(c, a);
            },
            'axelate-localai': (c, a) => {
                this._renderEmptyState(c, a);
            },
        };

        const renderer = renderers[app.id];
        if (renderer !== undefined) {
            await renderer(container, app);
            return;
        }

        if (app.type === 'api') {
            await this._renderUniversalApiSettings(container, app);
            return;
        }

        if (app.id.includes('telegram')) {
            this._renderEmptyState(container, app);
            return;
        }

        // Default Schema-based rendering
        container.innerHTML = '';
        if (app.configSchema !== undefined && Object.keys(app.configSchema).length > 0) {
            const form = document.createElement('div');
            form.className = 'module-settings-form';

            const header = document.createElement('h3');
            header.style.marginBottom = '1.5rem';
            header.style.color = 'var(--text-primary)';
            header.textContent = app.name !== undefined && app.name !== '' ? app.name : app.id;
            form.appendChild(header);

            Object.entries(app.configSchema).forEach(([key, field]) => {
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
        const win = globalThis as unknown as TGlobalWin;
        const catalog = win.APP_DATA.ai;
        const app = catalog.find((a: IApp) => a.id === appId);
        const providerData = app?.apiProviderData as
            | {
                  models?: Record<
                      string,
                      { stats: { speed: number; logic: number; creative: number } }
                  >;
              }
            | undefined;
        const providerDataModels = providerData?.models;
        const stats =
            providerDataModels !== undefined && modelKey !== ''
                ? providerDataModels[modelKey]?.stats
                : undefined;

        if (!stats) return '<div class="model-desc">Stats unavailable</div>';

        const renderStars = (count: number) => {
            let s = '';
            for (let i = 0; i < 5; i++) {
                s += `<span style="color: ${i < count ? '#FFD700' : 'rgba(255,255,255,0.1)'}; font-size: 1.1rem;">★</span>`;
            }
            return s;
        };

        const t = this._context.t;

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
        const input = document.getElementById(`${appId}-api-key-input`) as HTMLInputElement | null;
        const btn = document.getElementById(`${appId}-key-toggle-btn`);
        if (input !== null && btn !== null) {
            const isPass = input.type === 'password';
            input.type = isPass ? 'text' : 'password';
            btn.innerHTML = isPass ? this.ICONS.VISIBLE : this.ICONS.HIDDEN;
        }
    }

    /**
     * Checks the validity of an API key via its provider endpoint.
     */
    public async checkModuleKey(appId: string) {
        const input = document.getElementById(`${appId}-api-key-input`) as HTMLInputElement | null;
        const btn = document.getElementById(`${appId}-key-check-btn`);
        if (input === null || btn === null) return;

        const t = this._context.t;
        const key = input.value.trim();
        if (key === '') {
            this._context.showToast(t('ui.settings.key_invalid', 'Invalid Key'), 'error');
            return;
        }

        const originalHtml = btn.innerHTML;
        const originalWidth = btn.offsetWidth;
        btn.style.width = `${originalWidth.toString()}px`;
        btn.innerHTML = this.ICONS.SPINNER;
        btn.style.pointerEvents = 'none';

        try {
            const provider = appId === 'gemini' ? 'gemini' : 'openai';
            const ok = await this._service.validateApiKey(provider, key);

            if (ok) {
                btn.style.borderColor = 'var(--success)';
                btn.style.color = 'var(--success)';
                btn.innerHTML = this.ICONS.CHECK;
                this._context.showToast(t('ui.settings.key_valid', 'Key is valid'), 'success');
            } else {
                btn.style.borderColor = 'var(--error)';
                btn.style.color = 'var(--error)';
                btn.innerHTML = this.ICONS.X;
                this._context.showToast(
                    t('ui.settings.key_invalid_check', 'Key is invalid'),
                    'error',
                );
            }
        } catch {
            btn.style.borderColor = 'var(--error)';
            btn.style.color = 'var(--error)';
            btn.innerHTML = this.ICONS.X;
            this._context.showToast(t('ui.settings.key_check_error', 'Key check error'), 'error');
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
        this._state.setSelectedAIModel(appId, modelKey);

        const grid = document.querySelector('.ai-models-grid');
        grid?.querySelectorAll('.ai-model-card').forEach((card) => {
            const cardElement = card as HTMLElement;
            const cardModelKey = cardElement.dataset['modelKey'];
            cardElement.classList.toggle('selected', cardModelKey === modelKey);
        });

        const statsArea = document.getElementById(`${appId}-model-stats`);
        if (statsArea !== null) {
            const t = this._context.t;
            const win = globalThis as unknown as TGlobalWin;
            const applyTranslations = win.applyTranslations as (() => void) | undefined;

            statsArea.innerHTML = DOMPurify.sanitize(
                `<h3>${t('ui.settings.model_stats', 'Model Stats')}</h3>${this._renderAIModelStats(appId, modelKey)}`,
            );

            if (typeof applyTranslations === 'function') {
                applyTranslations();
            }
        }
    }

    /**
     * Prompts the user to add a custom AI model.
     */
    public async addCustomModelToSettings(provider: 'openai' | 'gemini' | 'local') {
        const t = this._context.t;
        const currentApp = this._context.currentModule;

        const promptMsg = t(
            'ui.settings.custom_model.prompt_id',
            `Enter Model ID for ${provider} (e.g. gpt-4o):`,
            { provider },
        );

        const modelId = prompt(promptMsg);
        if (modelId === null || modelId === '') return;

        const promptNameMsg = t('ui.settings.custom_model.prompt_name', 'Enter Display Name:');
        const modelName = prompt(promptNameMsg, modelId);
        if (modelName === null || modelName === '') return;

        try {
            await this._service.addCustomModel(provider, modelId, modelName);

            // Custom models will be added to the provider's model list in future update
            if (typeof showToast === 'function') {
                showToast(
                    typeof t === 'function'
                        ? t(
                              'ui.settings.custom_model.toast_update',
                              'Custom model support is being updated',
                          )
                        : 'Custom model support is being updated',
                    'info',
                );
            }

            // Re-render current modal content
            const container = document.getElementById('module-config-modal-active');
            if (container && currentApp) {
                this._renderUniversalApiSettings(container, currentApp).catch((e: unknown) => {
                    logger.error(String(e));
                });
            }

            if (typeof showToast === 'function') {
                showToast(
                    typeof t === 'function'
                        ? t('ui.settings.custom_model.toast_added', 'Custom model added')
                        : 'Custom model added',
                    'success',
                );
            }
        } catch (e) {
            logger.error('[SettingsUI] Failed to add custom model', e);
        }
    }

    public updateModuleSettings(_configModels: unknown) {
        // Dynamic update logic will be implemented via the catalog refresh
    }

    // --- Card Resizing ---

    private _loadCardWidths() {
        const widths = this._state.getCardWidths();
        Object.keys(widths).forEach((id) => {
            const card = document.querySelector(`.resizable-card[data-card-id="${id}"]`);
            const width = widths[id];
            if (card instanceof HTMLElement && typeof width === 'string') {
                card.dataset['cardWidth'] = width;
                this._updateCardLayout(card, width);
            }
        });
    }

    private setCardWidth(btn: HTMLElement, width: string) {
        const card = btn.closest('.hardware-card');
        if (!(card instanceof HTMLElement)) return;

        card.dataset['cardWidth'] = width;
        const id = card.dataset['cardId'];
        if (id !== undefined) this._state.setCardWidth(id, width);

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
        const container = card.closest('[style*="grid-template-columns"]');
        if (container instanceof HTMLElement) {
            if (width === 'full') {
                container.style.gridTemplateColumns = '1fr';
            } else {
                container.style.gridTemplateColumns = '1fr 1fr';
            }
        }
    }

    // Card Resizing delegated to CardResizer component

    // --- Auto Save ---

    /**
     * Binds global events (e.g. clicking outside dropdowns).
     */
    private _bindEvents() {
        document.addEventListener('click', (e) => {
            document.querySelectorAll('.lang-dropdown-menu').forEach((dropdown) => {
                const page = dropdown.id.replace('lang-dropdown-menu-', '');
                const btn = document.getElementById(`lang-dropdown-btn-${page}`);
                if (
                    btn !== null &&
                    !dropdown.contains(e.target as Node) &&
                    !btn.contains(e.target as Node)
                ) {
                    dropdown.classList.remove('show');
                }
            });
        });
    }

    /**
     * Helper to open the settings modal for a specific module.
     */
    private async _openModuleSettingsHelper(app: IApp) {
        const modal = document.getElementById('module-settings-modal');
        const container = document.getElementById('module-config-modal-active');
        const title = document.getElementById('module-settings-title');

        if (modal === null || container === null || title === null) return;

        this._context.currentModule = app;

        const suffix = this._context.t('ui.settings.header_suffix', 'Settings');
        title.innerHTML = DOMPurify.sanitize(suffix);

        await this._renderSpecializedModuleConfig(container, app);

        // modal-backdrop: just remove hidden class, CSS handles animation
        modal.classList.remove('hidden');

        // Close logic
        const closeBtn = document.getElementById('close-module-settings-btn');
        if (closeBtn) {
            closeBtn.onclick = () => {
                this.close();
            };
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
        if (el === null) {
            el = document.createElement('div');
            el.id = 'save-indicator';
            el.className = 'save-indicator';
            const msg = this._context.t('ui.settings.saved_message', 'Settings Saved');
            el.innerHTML = DOMPurify.sanitize(`<span>${msg}</span>`);
            document.body.appendChild(el);
        }
        el.classList.add('show');
        const indicator = el;
        setTimeout(() => {
            indicator.classList.remove('show');
        }, 2000);
    }

    private _saveTimer: ReturnType<typeof setTimeout> | null = null;
    private _debouncedSave(key: string, value: SettingValue) {
        if (this._saveTimer !== null) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            void (async () => {
                logger.info(`[SettingsUI] Debounced saving: ${key} = ${String(value)}`);
                // Use non-null assertion or cast since backend expects non-null string|number|boolean
                if (value !== null) {
                    await this._service.saveSetting(key, value);
                }
                this._showSaveIndicator();
            })();
        }, 300);
    }
}
