/**
 * @module core/boot/EventHandler
 * @description Centralized event handling and global listeners using delegation
 */

import type { Core } from './init';
import type { TGlobalWin } from '@/shared/types/global_bridge_types';

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
        this._initWindowControls();

        this._initDownloadsPage();
        this._initAppModuleCards();
        this._initAppSelectionModal();
        this._initChatPage();
        this._initLanguageModal();
        this._initCloseConfirmModal();
        this._initDownloadSettingsModal();
        this._initModuleSettingsModal();
        this._initDownloadSpeedSettings();

        // eslint-disable-next-line no-console
        console.debug('[EventHandler] Initialized with delegation.');
    }

    /**
     * Centralized event delegation on the document body.
     */
    private _initGlobalDelegation(): void {
        this._addListener(document.body, 'click', (e: Event): void => {
            void (async (): Promise<void> => {
                const target = e.target as HTMLElement | null;
                if (!target) return;

                // 1. Navigation Logic [data-page]
                const navBtn = target.closest('[data-page]');
                if (navBtn instanceof HTMLElement) {
                    const pageId = navBtn.dataset['page'];
                    if (pageId !== undefined) {
                        e.preventDefault();
                        // eslint-disable-next-line no-console
                        console.debug('[EventHandler] Navigating to:', pageId);
                        void this._core.navigationUI.showPage(pageId, navBtn);
                        return;
                    }
                }

                // 2. Language Switcher Trigger (header)
                const trigger = target.closest('#current-lang-trigger');
                if (trigger) {
                    e.preventDefault();
                    this._core.i18nUI.toggleMenu();
                    return;
                }

                // 3. Language Selection [data-lang]
                const langBtn = target.closest('.lang-btn[data-lang]');
                if (langBtn instanceof HTMLElement) {
                    const lang = langBtn.dataset['lang'];
                    if (lang !== undefined) {
                        e.preventDefault();
                        // eslint-disable-next-line no-console
                        console.debug('[EventHandler] Switching language to:', lang);
                        await this._core.i18nUI.setLanguage(lang);
                        return;
                    }
                }

                // 4. Window Controls (Moved to direct listeners)

                // 5. Debug Console Logic
                if (target.closest('#clear-logs-btn') !== null) {
                    void this._core.debugUI.clearLogs();
                    return;
                }

                const debugTab = target.closest('.console-tab[data-view]');
                if (debugTab instanceof HTMLElement) {
                    const view = debugTab.dataset['view'];
                    const win = globalThis as TGlobalWin;
                    const setLogView = win.setLogView;
                    if (view !== undefined && typeof setLogView === 'function') {
                        setLogView(view, debugTab);
                    }
                }
            })();
        });
    }

    /**
     * Cleans up all event listeners.
     */
    public destroy(): void {
        this._cleanupAbort.abort();
        this._unsubscribers.forEach((fn) => {
            fn();
        });
        this._unsubscribers = [];
        // eslint-disable-next-line no-console
        console.debug('[EventHandler] Destroyed and listeners removed.');
    }

    /**
     * Helper to add event listener with auto-cleanup.
     */
    private _addListener(
        target: EventTarget | null,
        event: string,
        handler: EventListenerOrEventListenerObject,
    ): void {
        if (target) {
            target.addEventListener(event, handler);
            this._unsubscribers.push(() => {
                target.removeEventListener(event, handler);
            });
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
        this._addListener(card, 'click', (e): void => {
            const ev = e as MouseEvent;
            const target = ev.target;
            if (!(target instanceof HTMLElement)) return;
            if (
                target.closest(
                    '.model-card-action, .module-action-badge, .download-module-btn, .stop-btn, .module-settings-btn, .module-close-btn',
                )
            ) {
                return;
            }
            const win = globalThis as TGlobalWin;
            if (typeof win.openAppSelection === 'function') {
                win.openAppSelection(type);
            }
        });
    }

    private _setupModuleAddBtn(btn: HTMLElement | null, type: 'ai' | 'services'): void {
        if (!btn) return;
        this._addListener(btn, 'click', (e): void => {
            const ev = e as MouseEvent;
            ev.stopPropagation();
            const win = globalThis as TGlobalWin;
            if (typeof win.openAppSelection === 'function') {
                win.openAppSelection(type);
            }
        });
    }

    private _initAppSelectionModal(): void {
        this._addListener(document.getElementById('close-app-selection-btn'), 'click', () => {
            this._core.appUI.closeAppSelection();
        });
        this._addListener(document.getElementById('close-app-selection-btn-alt'), 'click', () => {
            this._core.appUI.closeAppSelection();
        });
    }

    private _initChatPage(): void {
        const win = globalThis as TGlobalWin;
        this._addListener(document.getElementById('clear-chat-btn'), 'click', () => {
            const clearChat = win.clearChat;
            if (typeof clearChat === 'function') clearChat();
        });
        this._addListener(document.getElementById('chat-attach-btn'), 'click', () => {
            const pickChatFiles = win.pickChatFiles;
            if (typeof pickChatFiles === 'function') pickChatFiles();
        });
        this._addListener(document.getElementById('chat-voice-btn'), 'click', () => {
            const toggleVoiceInput = win.toggleVoiceInput;
            if (typeof toggleVoiceInput === 'function') toggleVoiceInput();
        });
        this._addListener(document.getElementById('chat-send-btn'), 'click', () => {
            const sendChat = win.sendChat;
            if (typeof sendChat === 'function') sendChat();
        });
    }

    private _initLanguageModal(): void {
        const win = globalThis as TGlobalWin;
        const selectLangInModal = win.selectLangInModal;
        const confirmLanguage = win.confirmLanguage;

        document.querySelectorAll<HTMLElement>('.lang-modal-btn[data-lang]').forEach((btn) => {
            this._addListener(btn, 'click', () => {
                const lang = btn.dataset['lang'];
                if (lang !== undefined && typeof selectLangInModal === 'function') {
                    selectLangInModal(lang);
                }
            });
        });
        this._addListener(document.getElementById('confirm-lang-btn'), 'click', () => {
            if (typeof confirmLanguage === 'function') confirmLanguage();
        });
    }

    private _initCloseConfirmModal(): void {
        const win = globalThis as TGlobalWin;
        const hideCloseConfirmModal = win.hideCloseConfirmModal;
        const confirmCloseFromModal = win.confirmCloseFromModal;

        this._addListener(document.getElementById('cancel-close-btn'), 'click', () => {
            if (typeof hideCloseConfirmModal === 'function') hideCloseConfirmModal();
        });
        this._addListener(document.getElementById('confirm-close-btn'), 'click', () => {
            if (typeof confirmCloseFromModal === 'function') confirmCloseFromModal();
        });
    }

    private _initDownloadSettingsModal(): void {
        const downloadSettingsOverlay = document.getElementById('download-settings-overlay');
        this._addListener(downloadSettingsOverlay, 'click', (e) => {
            if (e.target === downloadSettingsOverlay) this._core.downloadUI.closeSettings();
        });
        this._addListener(document.getElementById('close-download-settings-btn'), 'click', () => {
            this._core.downloadUI.closeSettings();
        });
    }

    private _initModuleSettingsModal(): void {
        this._addListener(document.getElementById('close-module-settings-btn'), 'click', () => {
            this._core.settingsUI.close();
        });
    }

    private _initDownloadSpeedSettings(): void {
        const speedLimitToggle = document.getElementById('download-speed-limit-toggle');
        if (speedLimitToggle instanceof HTMLInputElement) {
            this._addListener(speedLimitToggle, 'change', () => {
                this._core.downloadUI.saveSettings();
            });
        }
        const speedSlider = document.getElementById('download-speed-slider');
        if (speedSlider instanceof HTMLInputElement) {
            this._addListener(speedSlider, 'input', (e: Event) => {
                const target = e.target as HTMLInputElement;
                this._core.downloadUI.updateSpeedDisplay(target.value);
                this._core.downloadUI.saveSettings();
            });
        }
    }

    private _initWindowControls(): void {
        const handler = (e: Event): void => {
            const target = e.target as HTMLElement;

            // Minimize
            if (target.closest('#minimize-btn')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                void this._core.windowService.minimize();
                return;
            }

            // Maximize
            if (target.closest('#maximize-btn')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                void this._core.windowService.toggleMaximize();
                return;
            }

            // Close
            if (target.closest('#close-btn')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                void this._core.windowService.close();
                return;
            }

            // Sound Toggle
            if (target.closest('#sound-toggle-btn')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._core.windowUI.toggleSound();
            }
        };

        // Use Capture Phase { capture: true } to intercept events before bubbling
        globalThis.addEventListener('click', handler, { capture: true });

        this._unsubscribers.push(() => {
            globalThis.removeEventListener('click', handler, { capture: true });
        });
    }
}
