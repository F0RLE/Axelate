import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventHandler, type ICoreEvents } from './events';

async function flushAsyncNavigation(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function createCoreEvents(): ICoreEvents {
    return {
        appUI: {
            openAppSelection: vi.fn(),
            closeAppSelection: vi.fn(),
        },
        chatController: {
            clearChat: vi.fn(),
            pickChatFilesFromMenu: vi.fn(),
            sendImageGenerationFromMenu: vi.fn(),
            toggleAttachMenu: vi.fn(),
            toggleVoiceInput: vi.fn(),
            sendChat: vi.fn(),
        },
        consoleUI: {},
        downloadUI: {},
        i18nUI: {
            toggleMenu: vi.fn(),
            setLanguage: vi.fn(),
            selectLangInModal: vi.fn(),
            confirmLanguage: vi.fn(),
        },
        navigationUI: {
            showPage: vi.fn().mockResolvedValue(undefined),
        },
        moduleSettingsUI: {
            close: vi.fn(),
        },
        tracer: {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
        windowService: {
            minimize: vi.fn(),
            close: vi.fn(),
        },
        windowUI: {
            toggleMaximize: vi.fn(),
            toggleSound: vi.fn(),
        },
    } as unknown as ICoreEvents;
}

describe('EventHandler', () => {
    const runtime = {
        addWindowListener: vi.fn(),
        removeWindowListener: vi.fn(),
    };

    beforeEach(() => {
        document.body.className = '';
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('blocks sidebar navigation while release download selection is open', async () => {
        document.body.innerHTML = `<button data-page="integrations">Integrations</button>`;
        document.body.classList.add('download-selection-open');
        const core = createCoreEvents();
        const handler = new EventHandler(core, runtime);
        handler.init();

        const navButton = document.querySelector<HTMLButtonElement>('[data-page]');
        if (navButton === null) {
            throw new Error('Navigation button not found');
        }
        navButton.click();
        await flushAsyncNavigation();

        expect(core.navigationUI.showPage).not.toHaveBeenCalled();
        handler.destroy();
    });

    it('allows sidebar navigation when release download selection is closed', async () => {
        document.body.innerHTML = `<button data-page="integrations">Integrations</button>`;
        const core = createCoreEvents();
        const handler = new EventHandler(core, runtime);
        handler.init();

        const navButton = document.querySelector<HTMLButtonElement>('[data-page]');
        if (navButton === null) {
            throw new Error('Navigation button not found');
        }
        navButton.click();
        await flushAsyncNavigation();

        expect(core.navigationUI.showPage).toHaveBeenCalledOnce();
        handler.destroy();
    });

    it('delegates language menu and language selection clicks', async () => {
        document.body.innerHTML = `
            <button id="current-lang-trigger">EN</button>
            <button class="lang-btn" data-lang="ru">RU</button>
        `;
        const core = createCoreEvents();
        const handler = new EventHandler(core, runtime);
        handler.init();

        document.querySelector<HTMLButtonElement>('#current-lang-trigger')?.click();
        document.querySelector<HTMLButtonElement>('.lang-btn')?.click();
        await flushAsyncNavigation();

        expect(core.i18nUI.toggleMenu).toHaveBeenCalledOnce();
        expect(core.i18nUI.setLanguage).toHaveBeenCalledWith('ru');
        handler.destroy();
    });

    it('opens module selection from add buttons and module cards', async () => {
        document.body.innerHTML = `
            <button id="ai-module-add-btn">Add AI</button>
            <div id="services-module-card">Services</div>
            <div id="ai-module-card"><button class="module-settings-btn">Settings</button></div>
        `;
        const core = createCoreEvents();
        const handler = new EventHandler(core, runtime);
        handler.init();

        document.querySelector<HTMLButtonElement>('#ai-module-add-btn')?.click();
        document.querySelector<HTMLElement>('#services-module-card')?.click();
        document.querySelector<HTMLButtonElement>('.module-settings-btn')?.click();
        await flushAsyncNavigation();

        expect(core.appUI.openAppSelection).toHaveBeenNthCalledWith(1, 'ai');
        expect(core.appUI.openAppSelection).toHaveBeenNthCalledWith(2, 'services');
        expect(core.appUI.openAppSelection).toHaveBeenCalledTimes(2);
        handler.destroy();
    });

    it('delegates chat action clicks', async () => {
        document.body.innerHTML = `
            <button id="clear-chat-btn">Clear</button>
            <button id="chat-attach-btn">Attach</button>
            <button id="chat-voice-btn">Voice</button>
            <button id="chat-send-btn">Send</button>
            <div class="chat-attach-menu">
                <button data-chat-attach-action="file">File</button>
                <button data-chat-attach-action="image">Image</button>
            </div>
        `;
        const core = createCoreEvents();
        const handler = new EventHandler(core, runtime);
        handler.init();

        document.querySelector<HTMLButtonElement>('#clear-chat-btn')?.click();
        document.querySelector<HTMLButtonElement>('[data-chat-attach-action="file"]')?.click();
        document.querySelector<HTMLButtonElement>('[data-chat-attach-action="image"]')?.click();
        document.querySelector<HTMLButtonElement>('#chat-attach-btn')?.click();
        document.querySelector<HTMLButtonElement>('#chat-voice-btn')?.click();
        document.querySelector<HTMLButtonElement>('#chat-send-btn')?.click();
        await flushAsyncNavigation();

        expect(core.chatController.clearChat).toHaveBeenCalledOnce();
        expect(core.chatController.pickChatFilesFromMenu).toHaveBeenCalledOnce();
        expect(core.chatController.sendImageGenerationFromMenu).toHaveBeenCalledOnce();
        expect(core.chatController.toggleAttachMenu).toHaveBeenCalledOnce();
        expect(core.chatController.toggleVoiceInput).toHaveBeenCalledOnce();
        expect(core.chatController.sendChat).toHaveBeenCalledOnce();
        handler.destroy();
    });

    it('binds modal, language confirmation, and window control actions', async () => {
        document.body.innerHTML = `
            <button id="close-app-selection-btn">Close</button>
            <button id="close-app-selection-btn-alt">Cancel</button>
            <button class="lang-modal-btn" data-lang="en">EN</button>
            <button id="confirm-lang-btn">Confirm</button>
            <button id="close-module-settings-btn">Close settings</button>
        `;
        let windowClickHandler: EventListenerOrEventListenerObject | undefined;
        const localRuntime: ConstructorParameters<typeof EventHandler>[1] = {
            addWindowListener: vi.fn(
                (event: string, handler: EventListenerOrEventListenerObject) => {
                    if (event === 'click') windowClickHandler = handler;
                },
            ),
            removeWindowListener: vi.fn(),
        };
        const core = createCoreEvents();
        const handler = new EventHandler(core, localRuntime);
        handler.init();

        document.querySelector<HTMLButtonElement>('#close-app-selection-btn')?.click();
        document.querySelector<HTMLButtonElement>('#close-app-selection-btn-alt')?.click();
        document.querySelector<HTMLButtonElement>('.lang-modal-btn')?.click();
        document.querySelector<HTMLButtonElement>('#confirm-lang-btn')?.click();
        document.querySelector<HTMLButtonElement>('#close-module-settings-btn')?.click();
        await flushAsyncNavigation();

        expect(core.appUI.closeAppSelection).toHaveBeenCalledTimes(2);
        expect(core.i18nUI.selectLangInModal).toHaveBeenCalledWith('en');
        expect(core.i18nUI.confirmLanguage).toHaveBeenCalledOnce();
        expect(core.moduleSettingsUI.close).toHaveBeenCalledOnce();

        for (const id of ['minimize-btn', 'maximize-btn', 'close-btn', 'sound-toggle-btn']) {
            const button = document.createElement('button');
            button.id = id;
            const event = new MouseEvent('click', { bubbles: true });
            Object.defineProperty(event, 'target', { value: button });
            if (typeof windowClickHandler === 'function') {
                windowClickHandler(event);
            } else {
                windowClickHandler?.handleEvent(event);
            }
        }
        await flushAsyncNavigation();

        expect(core.windowService.minimize).toHaveBeenCalledOnce();
        expect(core.windowUI.toggleMaximize).toHaveBeenCalledOnce();
        expect(core.windowService.close).toHaveBeenCalledOnce();
        expect(core.windowUI.toggleSound).toHaveBeenCalledOnce();

        handler.destroy();
        expect(localRuntime.removeWindowListener).toHaveBeenCalledOnce();
    });
});
