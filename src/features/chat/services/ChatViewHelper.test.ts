import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatViewHelper } from './ChatViewHelper';

describe('ChatViewHelper', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    function createHelper() {
        return new ChatViewHelper({
            i18n: {
                t: vi.fn((key: string, fallback?: string) => {
                    if (key === 'ui.chat.greeting.7') {
                        return 'Greeting 7';
                    }
                    return fallback ?? '';
                }),
            } as never,
            onFileInputChange: vi.fn(),
            onChatInputKeydown: vi.fn(),
            onChatInputInput: vi.fn(),
            onViewportResize: vi.fn(),
        });
    }

    it('should bind and unbind chat input events', () => {
        document.body.innerHTML = `
            <input id="chat-file-input" />
            <textarea id="chat-input"></textarea>
        `;
        const helper = createHelper();

        helper.bindEvents();
        helper.unbindEvents();

        expect(document.getElementById('chat-file-input')).toBeInstanceOf(HTMLInputElement);
        expect(document.getElementById('chat-input')).toBeInstanceOf(HTMLTextAreaElement);
    });

    it('should render forced greeting and return applied index', () => {
        document.body.innerHTML = '<div id="chat-header-question"></div>';
        const helper = createHelper();

        const appliedIndex = helper.randomizeGreeting(1, 7);

        expect(appliedIndex).toBe(7);
        expect(document.getElementById('chat-header-question')?.textContent).toBe('Greeting 7');
    });

    it('should fall back to default greeting when translation is missing', () => {
        document.body.innerHTML = '<div id="chat-header-question"></div>';
        const helper = createHelper();

        const appliedIndex = helper.randomizeGreeting(1, 8);

        expect(appliedIndex).toBe(8);
        expect(document.getElementById('chat-header-question')?.textContent).toBe(
            'How can I help you today?',
        );
    });
});
