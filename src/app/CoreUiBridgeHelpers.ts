import { estimateTokenCount } from '@/features/chat/utils/chatUtils';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { AppUI } from '@/shared/shell/AppUI';
import type { IApp } from '@/shared/types/coreTypes';
import type { ModuleSettingsUiController } from './CoreUiContracts';

type TokenEstimatorDeps = {
    tauriProvider: TauriProvider;
    tracer: Pick<LoggerService, 'warn'>;
};

const TOKEN_ESTIMATE_TIMEOUT_MS = 650;

export type ModuleSettingsGateway = {
    openModuleSettings: (app: IApp) => Promise<void>;
};

export function createToastBridge(
    appUI: AppUI,
): (
    message: string,
    type?: string,
    duration?: number,
    title?: string | null,
    id?: string | null,
    onClick?: (() => void) | null,
) => void {
    return (message, type, duration, title, id, onClick) => {
        appUI.showToast(message, type, duration, title, id, onClick);
    };
}

export function createModuleSettingsGateway(
    getModuleSettingsUI: () => ModuleSettingsUiController | null,
): ModuleSettingsGateway {
    return {
        openModuleSettings: async (app) => {
            await getModuleSettingsUI()?.openModuleSettings(app);
        },
    };
}

export function createClipboardWriter(
    tauriProvider: TauriProvider,
): (text: string) => Promise<void> {
    return async (text: string) => {
        await tauriProvider.writeToClipboard(text);
    };
}

export function createClipboardReader(tauriProvider: TauriProvider): () => Promise<string | null> {
    return async () =>
        await tauriProvider.withClipboardReadAccess(
            async () => await tauriProvider.readClipboardText(),
        );
}

export function createExternalUrlOpener(
    tauriProvider: TauriProvider,
): (url: string) => Promise<void> {
    return async (url) => {
        await tauriProvider.openUrl(url);
    };
}

export function createTokenEstimator(
    deps: TokenEstimatorDeps,
): (text: string, model?: string) => Promise<number> {
    return async (text, model = 'gpt-4') => {
        if (deps.tauriProvider.isTauri()) {
            try {
                return await withTimeout(
                    deps.tauriProvider.invoke<number>('count_tokens', {
                        text,
                        model,
                    }),
                    TOKEN_ESTIMATE_TIMEOUT_MS,
                );
            } catch (error) {
                deps.tracer.warn(`[TokenCount] Backend failed, using heuristic: ${String(error)}`);
            }
        }

        return estimateTokenCount(text);
    };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = globalThis.setTimeout(() => {
            reject(new Error(`Timed out after ${String(timeoutMs)}ms`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeout]);
    } finally {
        if (timeoutId !== undefined) {
            globalThis.clearTimeout(timeoutId);
        }
    }
}
