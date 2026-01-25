/**
 * @module core/boot/EventHandler
 * @description Centralized event handling and global listeners using delegation
 */

import type { Core } from '../core';

export class EventHandler {
    private readonly _core: Core;
    private _unsubscribers: (() => void)[] = [];
    private readonly _cleanupAbort: AbortController = new AbortController();

    constructor(core: Core) {
        this._core = core;
    }

    /**
     * Initializes all global event listeners.
     */
    public init(): void {
        this._initGlobalDelegation();
        
        this._initDownloadsPage();
        this._initAppModuleCards();
        this._initAppSelectionModal();
        this._initChatPage();
        this._initLanguageModal();
        this._initCloseConfirmModal();
        this._initDownloadSettingsModal();
        this._initModuleSettingsModal();
        this._initDownloadSpeedSettings();

        console.debug('[EventHandler] Initialized with delegation.');
    }

    /**
     * Centralized event delegation on the document body.
     */
    private _initGlobalDelegation(): void {
        this._addListener(document.body, 'click', async (e: Event) => {
            const target = e.target as HTMLElement;
            if (!target) return;

            // 1. Navigation Logic [data-page]
            const navBtn = target.closest('[data-page]') as HTMLElement;
            if (navBtn) {
                const pageId = navBtn.dataset.page;
                if (pageId) {
                    e.preventDefault();
                    console.debug('[EventHandler] Navigating to:', pageId);
                    this._core.navigationUI.showPage(pageId, navBtn);
                    return;
                }
            }

            // 2. Language Switcher Trigger
            const trigger = target.closest('#current-lang-trigger');
            if (trigger) {
                e.preventDefault();
                this._core.i18nUI.toggleMenu();
                return;
            }

            // 3. Language Selection [data-lang]
            const langBtn = target.closest('.lang-btn[data-lang]') as HTMLElement;
            if (langBtn) {
                const lang = langBtn.dataset.lang;
                if (lang) {
                    e.preventDefault();
                    console.debug('[EventHandler] Switching language to:', lang);
                    await this._core.i18nUI.setLanguage(lang);
                    return;
                }
            }

            // 4. Window Controls
            if (this._handleWindowControls(target)) return;

            // 5. Debug Console Logic
            if (target.closest('#clear-logs-btn')) {
                this._core.debugUI.clearLogs();
                return;
            }

            const debugTab = target.closest('.console-tab[data-view]') as HTMLElement;
            if (debugTab) {
                const view = debugTab.dataset.view;
                const win = globalThis as unknown as Window & { setLogView?: (v: string, b: HTMLElement) => void };
                if (view) win.setLogView?.(view, debugTab);
            }
        });
    }

    /**
     * Cleans up all event listeners.
     */
    public destroy(): void {
        this._cleanupAbort.abort();
        this._unsubscribers.forEach(fn => fn());
        this._unsubscribers = [];
        console.debug('[EventHandler] Destroyed and listeners removed.');
    }

    /**
     * Helper to add event listener with auto-cleanup.
     */
    private _addListener(target: EventTarget | null, event: string, handler: EventListenerOrEventListenerObject): void {
        if (target) {
            target.addEventListener(event, handler);
            this._unsubscribers.push(() => target.removeEventListener(event, handler));
        }
    }

    private _initDownloadsPage(): void {
        this._addListener(document.getElementById('open-download-settings'), 'click', () => {
            this._core.downloadUI.openSettings();
        });
    }

    private _initAppModuleCards(): void {
        const aiModuleCard = document.getElementById('ai-module-card');
        const aiModuleAdd = document.getElementById('ai-module-add-btn');
        const servicesModuleCard = document.getElementById('services-module-card');
        const servicesModuleAdd = document.getElementById('services-module-add-btn');

        this._setupModuleCard(aiModuleCard, 'ai');
        this._setupModuleAddBtn(aiModuleAdd, 'ai');
        this._setupModuleCard(servicesModuleCard, 'services');
        this._setupModuleAddBtn(servicesModuleAdd, 'services');
    }

    private _setupModuleCard(card: HTMLElement | null, type: 'ai' | 'services'): void {
        if (!card) return;
        this._addListener(card, 'click', (e) => {
            const ev = e as MouseEvent;
            const target = ev.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.closest('.model-card-action, .module-action-badge, .download-module-btn, .stop-btn')) {
                return;
            }
            if (card.classList.contains('empty')) {
                const catalog = this._core.catalog.getCatalog();
                const apps = catalog[type] || [];
                this._core.appUI.openAppSelection(type, apps);
            }
        });
    }

    private _setupModuleAddBtn(btn: HTMLElement | null, type: 'ai' | 'services'): void {
        if (!btn) return;
        this._addListener(btn, 'click', (e) => {
            const ev = e as MouseEvent;
            ev.stopPropagation();
            const card = btn.closest('.model-card-premium');
            if (card?.classList.contains('empty')) {
                const catalog = this._core.catalog.getCatalog();
                const apps = catalog[type] || [];
                this._core.appUI.openAppSelection(type, apps);
            }
        });
    }

    private _initAppSelectionModal(): void {
        this._addListener(document.getElementById('close-app-selection-btn'), 'click', () => this._core.appUI.closeAppSelection());
        this._addListener(document.getElementById('close-app-selection-btn-alt'), 'click', () => this._core.appUI.closeAppSelection());
    }


    private _initChatPage(): void {
        const win = globalThis as unknown as Window & { clearChat?: () => void; pickChatFiles?: () => void; toggleVoiceInput?: () => void; sendChat?: () => void };
        this._addListener(document.getElementById('clear-chat-btn'), 'click', () => win.clearChat?.());
        this._addListener(document.getElementById('pick-chat-files-btn'), 'click', () => win.pickChatFiles?.());
        this._addListener(document.getElementById('voice-input-btn'), 'click', () => win.toggleVoiceInput?.());
        this._addListener(document.getElementById('send-chat-btn'), 'click', () => win.sendChat?.());
    }

    private _initLanguageModal(): void {
        const win = globalThis as unknown as Window & { selectLangInModal?: (l: string) => void; confirmLanguage?: () => void };
        document.querySelectorAll<HTMLElement>('.lang-modal-btn[data-lang]').forEach(btn => {
            this._addListener(btn, 'click', () => {
                const lang = btn.dataset.lang;
                if (lang) win.selectLangInModal?.(lang);
            });
        });
        this._addListener(document.getElementById('confirm-lang-btn'), 'click', () => win.confirmLanguage?.());
    }

    private _initCloseConfirmModal(): void {
        const win = globalThis as unknown as Window & { hideCloseConfirmModal?: () => void; confirmCloseFromModal?: () => void };
        this._addListener(document.getElementById('cancel-close-btn'), 'click', () => win.hideCloseConfirmModal?.());
        this._addListener(document.getElementById('confirm-close-btn'), 'click', () => win.confirmCloseFromModal?.());
    }

    private _initDownloadSettingsModal(): void {
        const downloadSettingsOverlay = document.getElementById('download-settings-overlay');
        this._addListener(downloadSettingsOverlay, 'click', (e) => {
            if (e.target === downloadSettingsOverlay) this._core.downloadUI.closeSettings();
        });
        this._addListener(document.getElementById('close-download-settings-btn'), 'click', () => this._core.downloadUI.closeSettings());
    }

    private _initModuleSettingsModal(): void {
        this._addListener(document.getElementById('close-module-settings-btn'), 'click', () => this._core.settingsUI.close());
    }

    private _initDownloadSpeedSettings(): void {
        const speedLimitToggle = document.getElementById('download-speed-limit-toggle') as HTMLInputElement;
        if (speedLimitToggle) this._addListener(speedLimitToggle, 'change', () => this._core.downloadUI.saveSettings());
        const speedSlider = document.getElementById('download-speed-slider') as HTMLInputElement;
        if (speedSlider) {
            this._addListener(speedSlider, 'input', (e: Event) => {
                const target = e.target as HTMLInputElement;
                this._core.downloadUI.updateSpeedDisplay(target.value);
                this._core.downloadUI.saveSettings();
            });
        }
    }


    private _handleWindowControls(target: HTMLElement): boolean {
        if (target.closest('#minimize-btn')) {
            this._core.windowService.minimize();
            return true;
        }
        if (target.closest('#maximize-btn')) {
            this._core.windowService.toggleMaximize();
            return true;
        }
        if (target.closest('#close-btn')) {
            this._core.windowService.close();
            return true;
        }
        if (target.closest('#sound-toggle-btn')) {
            this._core.windowUI.toggleSound();
            return true;
        }
        return false;
    }
}
