type ChatTranslationTargets = {
    chatInput: HTMLTextAreaElement | null;
    chatInputPlaceholder: HTMLElement | null;
    clearBtn: HTMLElement | null;
    attachBtn: HTMLElement | null;
    voiceBtn: HTMLElement | null;
    sendBtn: HTMLElement | null;
    tokenCount: HTMLElement | null;
    contextBtn: HTMLElement | null;
};

export class ChatUiDom {
    public get messagesContainer(): HTMLElement | null {
        return document.getElementById('chat-messages');
    }

    public get chatContainer(): HTMLElement | null {
        return document.getElementById('chat-container');
    }

    public get attachmentsContainer(): HTMLElement | null {
        return document.getElementById('chat-attachments');
    }

    public get chatInput(): HTMLTextAreaElement | null {
        return document.getElementById('chat-input') as HTMLTextAreaElement | null;
    }

    public getTranslationTargets(): ChatTranslationTargets {
        return {
            chatInput: this.chatInput,
            chatInputPlaceholder: document.getElementById('chat-input-placeholder'),
            clearBtn: document.getElementById('clear-chat-btn'),
            attachBtn: document.getElementById('chat-attach-btn'),
            voiceBtn: document.getElementById('chat-voice-btn'),
            sendBtn: document.getElementById('chat-send-btn'),
            tokenCount: document.getElementById('chat-token-count'),
            contextBtn: document.getElementById('chat-context-btn'),
        };
    }
}
