import { beforeEach, describe, expect, it, vi } from 'vitest';

const appendMessage = vi.fn();
const clearUi = vi.fn();
const updateTokenCount = vi.fn();

vi.mock('./ui/ChatUI', () => ({
    ChatUI: class {
        public init = vi.fn().mockResolvedValue(undefined);
        public destroy = vi.fn();
        public setEditMessageHandler = vi.fn();
        public updateAttachments = vi.fn();
        public refreshTranslations = vi.fn();
        public revealLatestMessage = vi.fn();
        public renderHistory = vi.fn();
        public showToast = vi.fn();
        public removeTyping = vi.fn();
        public appendMessage = appendMessage;
        public clear = clearUi;
        public updateTokenCount = updateTokenCount;
    },
}));

vi.mock('./controllers/VoiceController', () => ({
    VoiceController: class {
        public toggle = vi.fn();
        public stop = vi.fn();
    },
}));

vi.mock('./controllers/FilePickerController', () => ({
    FilePickerController: class {
        public pick = vi.fn();
        public updateTokenCount = vi.fn().mockResolvedValue(undefined);
        public handleFileSelect = vi.fn();
    },
}));

vi.mock('./utils/chatUtils', () => ({
    getTokenCount: vi.fn(),
}));

vi.mock('./services/ChatFileHandler', () => ({
    chatFileHandler: {
        clear: vi.fn(),
        setUpdateCallback: vi.fn(),
        hasFiles: vi.fn().mockReturnValue(false),
        getFiles: vi.fn().mockReturnValue([]),
    },
}));

import { ChatController } from './chat';
import { getTokenCount } from './utils/chatUtils';

describe('ChatController', () => {
    const aiBridge = {
        isActive: vi.fn(),
        getSessionId: vi.fn().mockReturnValue('session-1'),
        getHistory: vi.fn().mockResolvedValue([]),
        clearHistory: vi.fn().mockResolvedValue(undefined),
        startProvider: vi.fn().mockResolvedValue(false),
    };

    const i18n = {
        t: vi.fn((_: string, fallback?: string) => fallback ?? ''),
    };

    const soundService = {
        playToggle: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
    });

    it('should use fallback token estimate when reply token counting fails', async () => {
        vi.mocked(getTokenCount).mockRejectedValueOnce(new Error('token fail'));
        const controller = new ChatController(aiBridge as never, i18n as never, soundService as never);

        await (controller as any)._handleChatResponse({ ok: true, message: 'hello' }, null);

        expect(appendMessage).toHaveBeenCalledWith('assistant', 'hello', { tokens: 2 });
        expect((controller as any)._chatHistory).toEqual([{ role: 'assistant', content: 'hello' }]);
    });

    it('should not append delayed inactive-ai error after ai becomes active', async () => {
        vi.useFakeTimers();
        aiBridge.isActive.mockReturnValue(false);
        const controller = new ChatController(aiBridge as never, i18n as never, soundService as never);
        (controller as any)._tryAutoStartAI = vi.fn().mockResolvedValue(false);

        await (controller as any)._checkAIActive(null);
        aiBridge.isActive.mockReturnValue(true);
        vi.advanceTimersByTime(500);

        expect(appendMessage).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('should clear pending inactive-ai error timeout when chat is cleared', async () => {
        vi.useFakeTimers();
        aiBridge.isActive.mockReturnValue(false);
        const controller = new ChatController(aiBridge as never, i18n as never, soundService as never);
        (controller as any)._tryAutoStartAI = vi.fn().mockResolvedValue(false);

        await (controller as any)._checkAIActive(null);
        controller.clearChat();
        vi.advanceTimersByTime(500);

        expect(appendMessage).not.toHaveBeenCalled();
        expect(clearUi).toHaveBeenCalledTimes(1);
        expect(updateTokenCount).toHaveBeenCalledWith(0);
        vi.useRealTimers();
    });
});
