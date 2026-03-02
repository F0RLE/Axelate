/**
 * @module core/boot/EventHandler
 * @description Centralized event handling and global listeners using delegation
 */

import type { AppUI } from '@/shared/shell/AppUI';
import type { ChatController } from '@/features/chat/chat';
import type { DebugUI } from '@/features/debug/ui/DebugUI';
import type { DownloadUI } from '@/features/downloads/ui/DownloadUI';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { NavigationUI } from '@/infrastructure/navigation/NavigationUI';
import type { SettingsUI } from '@/features/settings/ui/SettingsUI';
import type { WindowService } from '@/shared/services/WindowService';
import type { WindowUI } from '@/shared/shell/WindowUI';
import { tracer } from '@/infrastructure/logging/LoggerService';

export interface ICoreEvents {
    readonly appUI: AppUI;
    readonly chatController: ChatController;
    readonly debugUI: DebugUI;
    readonly downloadUI: DownloadUI;
    readonly i18nUI: I18nUI;
    readonly navigationUI: NavigationUI;
    readonly settingsUI: SettingsUI;
    readonly windowService: WindowService;
    readonly windowUI: WindowUI;
}

export class EventHandler {
    private readonly _core: ICoreEvents;
    private _unsubscribers: (() => void)[] = [];
    private readonly _cleanupAbort: AbortController = new AbortController();

    constructor(core: ICoreEvents) {
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

        tracer.debug('[EventHandler] Initialized with delegation.');
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
                        tracer.debug(`[EventHandler] Navigating to: ${pageId}`);
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
                        tracer.debug(`[EventHandler] Switching language to: ${lang}`);
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
                    if (view !== undefined) {
                        this._core.debugUI.setTab(view);
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
        tracer.debug('[EventHandler] Destroyed and listeners removed.');
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
        // Use event delegation because the module cards live in a template
        // that is loaded asynchronously AFTER this init runs.
        // Direct getElementById would return null at init time.
        this._addListener(document.body, 'click', (e): void => {
            const ev = e as MouseEvent;
            const target = ev.target;
            if (!(target instanceof HTMLElement)) return;

            // Check if click is inside a module add button (has priority)
            const addBtn = target.closest('#ai-module-add-btn, #services-module-add-btn');
            if (addBtn instanceof HTMLElement) {
                ev.stopPropagation();
                const type = addBtn.id === 'ai-module-add-btn' ? 'ai' : 'services';
                this._core.appUI.openAppSelection(type);
                return;
            }

            // Check if click is inside a module card
            const card = target.closest('#ai-module-card, #services-module-card');
            if (card instanceof HTMLElement) {
                // Skip if clicked on action elements inside the card
                if (
                    target.closest(
                        '.model-card-action, .module-action-badge, .download-module-btn, .stop-btn, .module-settings-btn, .module-close-btn',
                    )
                ) {
                    return;
                }
                const type = card.id === 'ai-module-card' ? 'ai' : 'services';
                this._core.appUI.openAppSelection(type);
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
        // All chat elements live in chat.html which is loaded asynchronously —
        // getElementById returns null at init time, so direct binding silently fails.
        // Use delegation on document.body for both click and keydown.

        this._addListener(document.body, 'click', (e: Event) => {
            const target = (e as MouseEvent).target as HTMLElement | null;
            if (!target) return;

            if (target.closest('#clear-chat-btn')) {
                this._core.chatController.clearChat();
                return;
            }
            if (target.closest('#chat-attach-btn')) {
                void this._core.chatController.pickChatFiles();
                return;
            }
            if (target.closest('#chat-voice-btn')) {
                this._core.chatController.toggleVoiceInput();
                return;
            }
            if (target.closest('#chat-send-btn')) {
                void this._core.chatController.sendChat();
            }
        });
    }

    private _initLanguageModal(): void {
        document.querySelectorAll<HTMLElement>('.lang-modal-btn[data-lang]').forEach((btn) => {
            this._addListener(btn, 'click', () => {
                const lang = btn.dataset['lang'];
                if (lang !== undefined) {
                    this._core.i18nUI.selectLangInModal(lang);
                }
            });
        });
        this._addListener(document.getElementById('confirm-lang-btn'), 'click', () => {
            void this._core.i18nUI.confirmLanguage();
        });
    }

    private _initCloseConfirmModal(): void {
        this._addListener(document.getElementById('cancel-close-btn'), 'click', () => {
            this._core.windowUI.hideCloseConfirmModal();
        });
        this._addListener(document.getElementById('confirm-close-btn'), 'click', () => {
            this._core.windowUI.confirmCloseFromModal();
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
