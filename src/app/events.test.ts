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
    beforeEach(() => {
        document.body.className = '';
        document.body.innerHTML = '';
    });

    it('blocks sidebar navigation while release download selection is open', async () => {
        document.body.innerHTML = `<button data-page="integrations">Integrations</button>`;
        document.body.classList.add('download-selection-open');
        const core = createCoreEvents();
        const handler = new EventHandler(core, {
            addWindowListener: vi.fn(),
            removeWindowListener: vi.fn(),
        });
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
        const handler = new EventHandler(core, {
            addWindowListener: vi.fn(),
            removeWindowListener: vi.fn(),
        });
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
});
