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
import type { ModuleSettingsUI } from '@/features/settings/ui/ModuleSettingsUI';
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
    readonly moduleSettingsUI: ModuleSettingsUI;
    readonly windowService: WindowService;
    readonly windowUI: WindowUI;
}

export class EventHandler {
    private readonly _core: ICoreEvents;
    private _unsubscribers: (() => void)[] = [];

    constructor(core: ICoreEvents) {
        this._core = core;
    }

    /**
     * Initializes all global event listeners.
     */
    public init(): void {
        this._initGlobalDelegation();
        this._initWindowControls();

        this._initAppSelectionModal();
        this._initLanguageModal();
        this._initModuleSettingsModal();

        tracer.debug('[EventHandler] Initialized with delegation.');
    }

    /**
     * Centralized event delegation on the document body.
     */
    private _initGlobalDelegation(): void {
        this._addListener(document.body, 'click', (e: Event): void => {
            void (async (): Promise<void> => {
                const target = e.target;
                if (!(target instanceof Element)) return;

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
                const addBtn = target.closest('#ai-module-add-btn, #services-module-add-btn');
                if (addBtn instanceof HTMLElement) {
                    e.stopPropagation();
                    const type = addBtn.id === 'ai-module-add-btn' ? 'ai' : 'services';
                    this._core.appUI.openAppSelection(type);
                    return;
                }

                const moduleCard = target.closest('#ai-module-card, #services-module-card');
                if (moduleCard instanceof HTMLElement) {
                    if (
                        target.closest(
                            '.model-card-action, .module-action-badge, .download-module-btn, .stop-btn, .module-settings-btn, .module-close-btn',
                        )
                    ) {
                        return;
                    }
                    const type = moduleCard.id === 'ai-module-card' ? 'ai' : 'services';
                    this._core.appUI.openAppSelection(type);
                    return;
                }

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
            })();
        });
    }

    /**
     * Cleans up all event listeners.
     */
    public destroy(): void {
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

    private _initAppSelectionModal(): void {
        this._addListener(document.getElementById('close-app-selection-btn'), 'click', () => {
            this._core.appUI.closeAppSelection();
        });
        this._addListener(document.getElementById('close-app-selection-btn-alt'), 'click', () => {
            this._core.appUI.closeAppSelection();
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

    private _initModuleSettingsModal(): void {
        this._addListener(document.getElementById('close-module-settings-btn'), 'click', () => {
            this._core.moduleSettingsUI.close();
        });
    }

    private _initWindowControls(): void {
        const handler = (e: Event): void => {
            const target = e.target;
            if (!(target instanceof Element)) return;

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
