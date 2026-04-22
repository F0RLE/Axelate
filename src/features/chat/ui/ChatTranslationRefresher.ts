type ChatTranslate = (
    key: string,
    defaultValue?: string,
    params?: Record<string, unknown>,
) => string;

type ChatTranslationElements = {
    chatInput: HTMLTextAreaElement | null;
    chatInputPlaceholder: HTMLElement | null;
    clearBtn: HTMLElement | null;
    attachBtn: HTMLElement | null;
    voiceBtn: HTMLElement | null;
    sendBtn: HTMLElement | null;
    tokenCount: HTMLElement | null;
};

export function refreshChatTranslations(
    elements: ChatTranslationElements,
    translate: ChatTranslate,
    refreshMessageActions: (translate: ChatTranslate) => void,
    updateTokenCount: () => void,
): void {
    if (elements.chatInput) {
        const placeholderKey = elements.chatInput.dataset['i18nPlaceholder'];
        if (placeholderKey !== undefined) {
            const placeholderText = translate(placeholderKey, 'Ask something...');
            elements.chatInput.placeholder = placeholderText;
            if (elements.chatInputPlaceholder) {
                elements.chatInputPlaceholder.textContent = placeholderText;
            }
        }
    }

    if (elements.clearBtn) {
        const clearTitleKey =
            elements.clearBtn.dataset['i18nTitle'] ?? 'ui.launcher.web.chat_clear_title';
        elements.clearBtn.title = translate(clearTitleKey, 'Clear Chat');
        const clearText = elements.clearBtn.querySelector('.chat-clear-text');
        if (clearText) {
            clearText.textContent = translate('ui.launcher.web.chat_clear', 'Clear Chat');
        }
    }

    if (elements.attachBtn)
        elements.attachBtn.title = translate('ui.launcher.web.attach', 'Attach');
    if (elements.voiceBtn) elements.voiceBtn.title = translate('ui.launcher.web.voice', 'Voice');
    if (elements.sendBtn) elements.sendBtn.title = translate('ui.launcher.web.send', 'Send');

    refreshMessageActions(translate);

    document.querySelectorAll<HTMLElement>('.chat-save-image-btn').forEach((btn) => {
        btn.title = translate('ui.chat.save_image', 'Save Image');
    });

    document.querySelectorAll<HTMLElement>('.chat-open-image-folder-btn').forEach((btn) => {
        btn.title = translate('ui.chat.open_image_folder', 'Open image folder');
    });

    document.querySelectorAll<HTMLElement>('.chat-generated-control.is-cancel').forEach((btn) => {
        btn.textContent = translate('ui.chat.image_cancel', 'Cancel');
    });

    document
        .querySelectorAll<HTMLElement>('.chat-generated-control.is-regenerate')
        .forEach((btn) => {
            btn.textContent = translate('ui.chat.image_regenerate', 'Regenerate');
        });

    const viewerClose = document.querySelector<HTMLElement>('.chat-image-viewer-close');
    if (viewerClose) {
        viewerClose.setAttribute(
            'aria-label',
            translate('ui.chat.close_image_preview', 'Close image preview'),
        );
        viewerClose.title = translate('ui.chat.close_image_preview', 'Close image preview');
    }

    document.querySelectorAll<HTMLElement>('.media-remove').forEach((btn) => {
        btn.title = translate('ui.launcher.web.remove_attachment', 'Remove attachment');
    });

    if (elements.tokenCount?.classList.contains('visible') === true) {
        updateTokenCount();
    }
}
