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
            const target = e.target;
            if (!(target instanceof Element)) return;

            void this._handleGlobalClick(e, target);
        });
    }

    private async _handleGlobalClick(e: Event, target: Element): Promise<void> {
        if (await this._handleNavigationClick(e, target)) return;
        if (this._handleLanguageMenuToggle(e, target)) return;
        if (await this._handleLanguageSelection(e, target)) return;
        if (this._handleModuleAddClick(e, target)) return;
        if (this._handleModuleCardClick(target)) return;
        await this._handleChatActionClick(target);
    }

    private async _handleNavigationClick(e: Event, target: Element): Promise<boolean> {
        const navBtn = target.closest('[data-page]');
        if (!(navBtn instanceof HTMLElement)) return false;

        const pageId = navBtn.dataset['page'];
        if (pageId === undefined) return false;

        e.preventDefault();
        tracer.debug(`[EventHandler] Navigating to: ${pageId}`);
        await this._core.navigationUI.showPage(pageId, navBtn);
        return true;
    }

    private _handleLanguageMenuToggle(e: Event, target: Element): boolean {
        const trigger = target.closest('#current-lang-trigger');
        if (trigger === null) return false;

        e.preventDefault();
        this._core.i18nUI.toggleMenu();
        return true;
    }

    private async _handleLanguageSelection(e: Event, target: Element): Promise<boolean> {
        const langBtn = target.closest('.lang-btn[data-lang]');
        if (!(langBtn instanceof HTMLElement)) return false;

        const lang = langBtn.dataset['lang'];
        if (lang === undefined) return false;

        e.preventDefault();
        tracer.debug(`[EventHandler] Switching language to: ${lang}`);
        await this._core.i18nUI.setLanguage(lang);
        return true;
    }

    private _handleModuleAddClick(e: Event, target: Element): boolean {
        const addBtn = target.closest('#ai-module-add-btn, #services-module-add-btn');
        if (!(addBtn instanceof HTMLElement)) return false;

        e.stopPropagation();
        const type = addBtn.id === 'ai-module-add-btn' ? 'ai' : 'services';
        this._core.appUI.openAppSelection(type);
        return true;
    }

    private _handleModuleCardClick(target: Element): boolean {
        const moduleCard = target.closest('#ai-module-card, #services-module-card');
        if (!(moduleCard instanceof HTMLElement)) return false;

        const actionTarget = target.closest(
            '.model-card-action, .module-action-badge, .download-module-btn, .stop-btn, .module-settings-btn, .module-close-btn',
        );
        if (actionTarget !== null) return true;

        const type = moduleCard.id === 'ai-module-card' ? 'ai' : 'services';
        this._core.appUI.openAppSelection(type);
        return true;
    }

    private async _handleChatActionClick(target: Element): Promise<void> {
        if (target.closest('#clear-chat-btn') !== null) {
            this._core.chatController.clearChat();
            return;
        }

        if (target.closest('#chat-attach-btn') !== null) {
            await this._core.chatController.pickChatFiles();
            return;
        }

        if (target.closest('#chat-voice-btn') !== null) {
            this._core.chatController.toggleVoiceInput();
            return;
        }

        if (target.closest('#chat-send-btn') !== null) {
            await this._core.chatController.sendChat();
        }
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
