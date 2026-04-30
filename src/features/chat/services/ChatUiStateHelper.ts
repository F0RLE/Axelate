import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { I18nService } from '@/infrastructure/i18n/I18nService';

type ChatUiDeps = {
    aiBridge: AIBridge;
    i18n: I18nService;
    showErrorToast: (message: string) => void;
    getChatInput: () => HTMLTextAreaElement | null;
    maxInputHeightPx: number;
    baseInputHeightPx: number;
};

type LockedUiElements = {
    input: HTMLTextAreaElement | null;
    sendBtn: HTMLButtonElement | null;
    voiceBtn: HTMLButtonElement | null;
    attachBtn: HTMLButtonElement | null;
    contextBtn: HTMLButtonElement | null;
};

export class ChatUiStateHelper {
    private _inactiveAiErrorTimeout: ReturnType<typeof setTimeout> | null = null;
    private _resizeAnimationFrame: number | null = null;

    public constructor(private readonly _deps: ChatUiDeps) {}

    public clearInactiveAiErrorTimeout(): void {
        if (this._inactiveAiErrorTimeout !== null) {
            globalThis.clearTimeout(this._inactiveAiErrorTimeout);
            this._inactiveAiErrorTimeout = null;
        }
    }

    public scheduleInactiveAiError(input: HTMLTextAreaElement | null): void {
        this.clearInactiveAiErrorTimeout();
        this._inactiveAiErrorTimeout = globalThis.setTimeout(() => {
            this._inactiveAiErrorTimeout = null;
            if (this._deps.aiBridge.isActive()) {
                return;
            }
            this._deps.showErrorToast(
                this._deps.i18n.t(
                    'ui.ai.no_provider',
                    'No AI module running. Please select and launch a module first.',
                ),
            );
        }, 500);
        input?.focus();
    }

    public lockUi(input: HTMLTextAreaElement | null): LockedUiElements {
        const sendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement | null;
        const voiceBtn = document.getElementById('chat-voice-btn') as HTMLButtonElement | null;
        const attachBtn = document.getElementById('chat-attach-btn') as HTMLButtonElement | null;
        const contextBtn = document.getElementById('chat-context-btn') as HTMLButtonElement | null;

        if (input) {
            input.disabled = true;
        }
        if (sendBtn) {
            this._setSendButtonMode(sendBtn, 'stop');
        }
        if (voiceBtn) voiceBtn.disabled = true;
        if (attachBtn) attachBtn.disabled = true;
        if (contextBtn) contextBtn.disabled = true;

        return { input, sendBtn, voiceBtn, attachBtn, contextBtn };
    }

    public unlockUi(els: LockedUiElements): void {
        if (els.input && document.body.contains(els.input)) {
            els.input.disabled = false;
            els.input.focus();
        }
        if (els.sendBtn) {
            this._setSendButtonMode(els.sendBtn, 'send');
        }
        if (els.voiceBtn) els.voiceBtn.disabled = false;
        if (els.attachBtn) els.attachBtn.disabled = false;
        if (els.contextBtn) els.contextBtn.disabled = false;
    }

    public scheduleAutoResizeInput(): void {
        if (this._resizeAnimationFrame !== null) {
            globalThis.cancelAnimationFrame(this._resizeAnimationFrame);
        }
        this._resizeAnimationFrame = globalThis.requestAnimationFrame(() => {
            this._resizeAnimationFrame = null;
            this.autoResizeInput();
        });
    }

    public autoResizeInput(): void {
        const input = this._deps.getChatInput();
        if (input === null) {
            return;
        }

        if (input.value === '') {
            input.style.height = `${String(this._deps.baseInputHeightPx)}px`;
            input.style.overflowY = 'hidden';
            return;
        }

        input.style.height = 'auto';
        const targetHeight = Math.max(input.scrollHeight, this._deps.baseInputHeightPx);
        const isOverflowing = targetHeight > this._deps.maxInputHeightPx;
        const nextHeight = `${String(Math.min(targetHeight, this._deps.maxInputHeightPx))}px`;

        input.style.height = nextHeight;
        input.style.overflowY = isOverflowing ? 'auto' : 'hidden';
    }

    public dispose(): void {
        this.clearInactiveAiErrorTimeout();
        if (this._resizeAnimationFrame !== null) {
            globalThis.cancelAnimationFrame(this._resizeAnimationFrame);
            this._resizeAnimationFrame = null;
        }
    }

    private _setSendButtonMode(sendBtn: HTMLButtonElement, mode: 'send' | 'stop'): void {
        const iconUse = sendBtn.querySelector('use');
        const isStop = mode === 'stop';
        const title = isStop
            ? this._deps.i18n.t('ui.launcher.web.stop_generation', 'Stop generation')
            : this._deps.i18n.t('ui.launcher.web.send', 'Send');

        sendBtn.disabled = false;
        sendBtn.classList.toggle('is-generating', isStop);
        sendBtn.title = title;
        sendBtn.setAttribute('aria-label', title);
        if (iconUse !== null) {
            iconUse.setAttribute('href', isStop ? '#icon-stop' : '#icon-send');
        }
    }
}
