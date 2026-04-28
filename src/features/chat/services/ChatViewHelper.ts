import type { I18nService } from '@/infrastructure/i18n/I18nService';

type ChatViewHelperDeps = {
    i18n: I18nService;
    onFileInputChange: (event: Event) => void;
    onChatInputKeydown: (event: KeyboardEvent) => void;
    onChatInputInput: () => void;
    onViewportResize: () => void;
};

export class ChatViewHelper {
    public constructor(private readonly _deps: ChatViewHelperDeps) {}

    public bindEvents(): void {
        this._setEventBindings('add');
    }

    public unbindEvents(): void {
        this._setEventBindings('remove');
    }

    private _setEventBindings(mode: 'add' | 'remove'): void {
        const method = mode === 'add' ? 'addEventListener' : 'removeEventListener';
        const fileInput = document.getElementById('chat-file-input') as HTMLInputElement | null;
        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;

        fileInput?.[method]('change', this._deps.onFileInputChange);
        chatInput?.[method]('keydown', this._deps.onChatInputKeydown as EventListener);
        chatInput?.[method]('input', this._deps.onChatInputInput);
        globalThis[method]('resize', this._deps.onViewportResize);
    }

    public randomizeGreeting(currentGreetingIndex: number, forceIndex?: number): number {
        const header = document.getElementById('chat-header-question');
        if (!(header instanceof HTMLElement)) {
            return currentGreetingIndex;
        }

        const nextIndex =
            typeof forceIndex === 'number' ? forceIndex : this._getRandomGreetingIndex();
        const translation = this._deps.i18n.t(`ui.chat.greeting.${String(nextIndex)}`, '');

        if (translation === '' || translation === `ui.chat.greeting.${String(nextIndex)}`) {
            const fallbackGreeting = this._deps.i18n.t(
                'ui.chat.greeting.default',
                'How can I help you today?',
            );
            if (header.textContent === '' || header.textContent === fallbackGreeting) {
                header.textContent = fallbackGreeting;
            }
            return nextIndex;
        }

        header.textContent = translation;
        return nextIndex;
    }

    private _getRandomGreetingIndex(): number {
        const values = new Uint32Array(1);
        crypto.getRandomValues(values);
        return ((values[0] ?? 0) % 50) + 1;
    }
}
