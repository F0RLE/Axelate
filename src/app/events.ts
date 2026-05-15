/**
 * @module core/boot/EventHandler
 * @description Centralized event handling and global listeners using delegation
 */

import type { AppUI } from '@/shared/shell/AppUI';
import type { ChatController } from '@/features/chat/ChatController';
import type { DownloadUI } from '@/features/downloads/ui/DownloadUI';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { NavigationUI } from '@/infrastructure/navigation/NavigationUI';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { WindowService } from '@/shared/services/WindowService';
import type { WindowUI } from '@/shared/shell/WindowUI';
import type { DeferredUiController, ModuleSettingsUiController } from './CoreUiContracts';

export interface ICoreEvents {
    readonly appUI: AppUI;
    readonly chatController: ChatController;
    readonly consoleUI: DeferredUiController;
    readonly downloadUI: DownloadUI;
    readonly i18nUI: I18nUI;
    readonly navigationUI: NavigationUI;
    readonly moduleSettingsUI: ModuleSettingsUiController;
    readonly tracer: LoggerService;
    readonly windowService: WindowService;
    readonly windowUI: WindowUI;
}

type EventHandlerRuntime = {
    addWindowListener: typeof globalThis.addEventListener;
    removeWindowListener: typeof globalThis.removeEventListener;
};

type ClickAction = {
    selector: string;
    action: () => void | Promise<void>;
};

function createDefaultEventHandlerRuntime(): EventHandlerRuntime {
    return {
        addWindowListener: globalThis.addEventListener.bind(globalThis),
        removeWindowListener: globalThis.removeEventListener.bind(globalThis),
    };
}

export class EventHandler {
    private readonly _core: ICoreEvents;
    private _unsubscribers: (() => void)[] = [];
    private _initialized = false;

    constructor(
        core: ICoreEvents,
        private readonly _runtime: EventHandlerRuntime = createDefaultEventHandlerRuntime(),
    ) {
        this._core = core;
    }

    /**
     * Initializes all global event listeners.
     */
    public init(): void {
        if (this._initialized) {
            return;
        }
        this._initialized = true;

        this._initGlobalDelegation();
        this._initWindowControls();

        this._initAppSelectionModal();
        this._initLanguageModal();
        this._initModuleSettingsModal();

        this._core.tracer.debug('[EventHandler] Initialized with delegation.');
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
        if (document.body.classList.contains('download-selection-open')) {
            return true;
        }

        this._core.tracer.debug(`[EventHandler] Navigating to: ${pageId}`);
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
        this._core.tracer.debug(`[EventHandler] Switching language to: ${lang}`);
        await this._core.i18nUI.setLanguage(lang);
        return true;
    }

    private _handleModuleAddClick(e: Event, target: Element): boolean {
        const addBtn = target.closest('#ai-module-add-btn, #services-module-add-btn');
        if (!(addBtn instanceof HTMLElement)) return false;

        e.stopPropagation();
        const type = this._resolveModuleSelectionType(addBtn.id);
        this._core.appUI.openAppSelection(type);
        return true;
    }

    private _handleModuleCardClick(target: Element): boolean {
        const moduleCard = target.closest('#ai-module-card, #services-module-card');
        if (!(moduleCard instanceof HTMLElement)) return false;

        const actionTarget = target.closest(
            '.module-slot-card-action, .module-action-badge, .download-module-btn, .stop-btn, .module-settings-btn, .module-close-btn',
        );
        if (actionTarget !== null) return true;

        const type = this._resolveModuleSelectionType(moduleCard.id);
        this._core.appUI.openAppSelection(type);
        return true;
    }

    private async _handleChatActionClick(target: Element): Promise<void> {
        if (target.closest('#clear-chat-btn') !== null) {
            await this._core.chatController.clearChat();
            return;
        }

        const attachMenuAction = target.closest('[data-chat-attach-action]');
        const attachMenu = attachMenuAction?.closest('.chat-attach-menu');
        if (attachMenu instanceof HTMLElement && attachMenuAction instanceof HTMLElement) {
            const action = attachMenuAction.dataset['chatAttachAction'];
            if (action === 'file') {
                await this._core.chatController.pickChatFilesFromMenu();
                return;
            }
            if (action === 'image') {
                await this._core.chatController.sendImageGenerationFromMenu();
                return;
            }
        }

        if (target.closest('#chat-attach-btn') !== null) {
            this._core.chatController.toggleAttachMenu();
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
        if (!this._initialized) {
            return;
        }

        this._unsubscribers.forEach((fn) => {
            fn();
        });
        this._unsubscribers = [];
        this._initialized = false;
        this._core.tracer.debug('[EventHandler] Destroyed and listeners removed.');
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
        this._bindClickActions([
            {
                selector: '#close-app-selection-btn',
                action: () => {
                    this._core.appUI.closeAppSelection();
                },
            },
            {
                selector: '#close-app-selection-btn-alt',
                action: () => {
                    this._core.appUI.closeAppSelection();
                },
            },
        ]);
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
        this._bindClickActions([
            {
                selector: '#confirm-lang-btn',
                action: async () => {
                    await this._core.i18nUI.confirmLanguage();
                },
            },
        ]);
    }

    private _initModuleSettingsModal(): void {
        this._bindClickActions([
            {
                selector: '#close-module-settings-btn',
                action: () => {
                    this._core.moduleSettingsUI.close();
                },
            },
        ]);
    }

    private _initWindowControls(): void {
        const actions: ClickAction[] = [
            {
                selector: '#minimize-btn',
                action: async () => {
                    await this._core.windowService.minimize();
                },
            },
            {
                selector: '#maximize-btn',
                action: async () => {
                    await this._core.windowUI.toggleMaximize();
                },
            },
            {
                selector: '#close-btn',
                action: async () => {
                    await this._core.windowService.close();
                },
            },
            {
                selector: '#sound-toggle-btn',
                action: () => {
                    this._core.windowUI.toggleSound();
                },
            },
        ];

        const handler = (e: Event): void => {
            const target = e.target;
            if (!(target instanceof Element)) return;

            const action = actions.find((item) => target.closest(item.selector) !== null);
            if (action !== undefined) {
                e.preventDefault();
                e.stopImmediatePropagation();
                void action.action();
            }
        };

        this._runtime.addWindowListener('click', handler, { capture: true });

        this._unsubscribers.push(() => {
            this._runtime.removeWindowListener('click', handler, { capture: true });
        });
    }

    private _bindClickActions(actions: ClickAction[]): void {
        actions.forEach(({ selector, action }) => {
            this._addListener(document.querySelector(selector), 'click', () => {
                void action();
            });
        });
    }

    private _resolveModuleSelectionType(id: string): 'ai' | 'services' {
        return id === 'ai-module-add-btn' || id === 'ai-module-card' ? 'ai' : 'services';
    }
}
