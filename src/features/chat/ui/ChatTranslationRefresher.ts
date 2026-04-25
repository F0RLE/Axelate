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
        const clearTitle = translate(clearTitleKey, 'Clear Chat');
        elements.clearBtn.title = clearTitle;
        elements.clearBtn.setAttribute('aria-label', clearTitle);
        const clearText = elements.clearBtn.querySelector('.chat-clear-text');
        if (clearText) {
            clearText.textContent = translate('ui.launcher.web.chat_clear', 'Clear Chat');
        }
    }

    syncButtonLabel(elements.attachBtn, translate, 'ui.launcher.web.attach', 'Attach');
    syncButtonLabel(elements.voiceBtn, translate, 'ui.launcher.web.voice', 'Voice');
    syncButtonLabel(elements.sendBtn, translate, 'ui.launcher.web.send', 'Send');

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

function syncButtonLabel(
    button: HTMLElement | null,
    translate: ChatTranslate,
    key: string,
    fallback: string,
): void {
    if (button === null) {
        return;
    }

    const titleKey = button.dataset['i18nTitle'] ?? key;
    const ariaKey = button.dataset['i18nAriaLabel'] ?? titleKey;
    const title = translate(titleKey, fallback);
    const ariaLabel = translate(ariaKey, fallback);

    button.title = title;
    button.setAttribute('aria-label', ariaLabel);
}
