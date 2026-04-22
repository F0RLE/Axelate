import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventBus } from '@/shared/services/EventBus';
import type { ChatFileHandler } from './ChatFileHandler';
import { ChatLifecycleHelper } from './ChatLifecycleHelper';

describe('ChatLifecycleHelper', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function createHelper() {
        const eventBus = new EventBus();
        const fileHandler = {
            setUpdateCallback: vi.fn(),
            clearUpdateCallback: vi.fn(),
            hasFiles: vi.fn().mockReturnValue(false),
            getFiles: vi.fn().mockReturnValue([]),
            removeFile: vi.fn(),
        } as unknown as Pick<
            ChatFileHandler,
            'setUpdateCallback' | 'clearUpdateCallback' | 'hasFiles' | 'getFiles' | 'removeFile'
        >;
        const deps = {
            fileHandler,
            eventBus,
            refreshTranslations: vi.fn(),
            ensureHistoryLoaded: vi.fn(),
            scheduleRevealLatestMessage: vi.fn(),
            bindEvents: vi.fn(),
            canBindEventsNow: vi.fn().mockReturnValue(false),
            areEventsBound: vi.fn().mockReturnValue(false),
            setEventsBound: vi.fn(),
            randomizeGreeting: vi.fn(),
            currentGreetingIndex: vi.fn().mockReturnValue(5),
            updateAttachmentsFromFiles: vi.fn(),
            updateTokenCount: vi.fn(),
        };

        return {
            helper: new ChatLifecycleHelper(deps),
            eventBus,
            deps,
            fileHandler,
        };
    }

    it('should wire page-change and translation events', () => {
        const { helper, eventBus, deps } = createHelper();

        helper.start();
        eventBus.emit('page:change', { pageId: 'chat' });
        eventBus.emit('i18n:translations:loaded', { lang: 'en' });

        expect(deps.bindEvents).toHaveBeenCalledTimes(1);
        expect(deps.setEventsBound).toHaveBeenCalledWith(true);
        expect(deps.randomizeGreeting).toHaveBeenNthCalledWith(1);
        expect(deps.randomizeGreeting).toHaveBeenCalledWith(5);
        expect(deps.refreshTranslations).toHaveBeenCalledTimes(2);
        expect(deps.scheduleRevealLatestMessage).toHaveBeenCalledTimes(1);
    });

    it('should clear file callback and unsubscribers on stop', () => {
        const { helper, eventBus, deps, fileHandler } = createHelper();

        helper.start();
        helper.stop();
        eventBus.emit('page:change', { pageId: 'chat' });

        expect(fileHandler.clearUpdateCallback).toHaveBeenCalledTimes(1);
        expect(deps.bindEvents).not.toHaveBeenCalled();
        expect(deps.setEventsBound).toHaveBeenCalledWith(false);
    });

    it('should bind events immediately when chat input is already mounted', () => {
        const { helper, deps } = createHelper();
        deps.canBindEventsNow.mockReturnValue(true);

        helper.start();

        expect(deps.bindEvents).toHaveBeenCalledTimes(1);
        expect(deps.setEventsBound).toHaveBeenCalledWith(true);
    });
});
