import type { AIBridge } from '@/features/ai/services/AIBridge';
import { ChatController } from '@/features/chat/chat';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { EventBus } from '@/shared/services/EventBus';
import type { UiStateStore } from '@/shared/services/state/UiStateStore';
import type { AppUI } from '@/shared/shell/AppUI';
import {
    createClipboardReader,
    createClipboardWriter,
    createExternalUrlOpener,
    createToastBridge,
    createTokenEstimator,
} from './CoreUiBridgeHelpers';

type CreateChatControllerDeps = {
    aiBridge: AIBridge;
    i18n: I18nService;
    soundService: ConstructorParameters<typeof ChatController>[2];
    tauriProvider: TauriProvider;
    tracer: LoggerService;
    appUI: AppUI;
    eventBus: EventBus;
    stateStore: UiStateStore;
};

export function createChatController(deps: CreateChatControllerDeps): ChatController {
    const isTauriRuntime = (): boolean => deps.tauriProvider.isTauri();
    const showToast = createToastBridge(deps.appUI);
    const copyText = createClipboardWriter(deps.tauriProvider);
    const readClipboardText = createClipboardReader(deps.tauriProvider);
    const openExternalUrl = createExternalUrlOpener(deps.tauriProvider);
    const estimateTokens = createTokenEstimator({
        tauriProvider: deps.tauriProvider,
        tracer: deps.tracer,
    });

    return new ChatController(deps.aiBridge, deps.i18n, deps.soundService, {
        showToast: (message, type = 'success', duration = 2000, title, id, onClick) =>
            showToast(message, type, duration, title, id, onClick),
        isTauriRuntime,
        openExternalUrl,
        copyText,
        readClipboardText,
        getPendingChatRevealStore: () => ({
            getState: () => deps.stateStore.getState(),
            updateState: (updates) => deps.stateStore.updateState(updates),
        }),
        estimateTokens,
        hostBridge: deps.tauriProvider,
        eventBus: deps.eventBus,
        getSelectedModule: (category) => deps.stateStore.getSelectedModule(category),
        getPreferredAiCategory: () => deps.appUI.getPreferredAiCategory(),
        tracer: deps.tracer,
    });
}
