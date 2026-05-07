import type { ThinkingLevel } from '@/shared/services/state/UiStateStore';

export type AITransportContext = {
    tauriProvider: {
        isTauri: () => boolean;
        invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
        listen: <T>(event: string, callback: (payload: T) => void) => Promise<() => void>;
        getSecureKey?: (service: string) => Promise<string | null>;
        hasSecureKey?: (service: string) => Promise<boolean>;
        saveSecureKey?: (service: string, key: string) => Promise<void>;
    };
};

export type AIProviderManagerContext = AITransportContext & {
    aiSettings: {
        getSelectedAIModel: (appId: string) => string | undefined;
        setSelectedAIModel: (appId: string, modelKey: string) => void;
        getThinkingLevel: (appId: string) => ThinkingLevel;
        getInternetAccessEnabled: (appId: string) => boolean;
    };
    catalog: {
        getCatalog: () => {
            ai?: unknown[];
        };
    };
};

export type EngineStatusContext = AITransportContext & {
    i18n: {
        t: (key: string, fallback: string) => string;
    };
};

export type AIBridgeContext = AIProviderManagerContext &
    EngineStatusContext & {
        settingsService: {
            getSettings: () => Record<string, unknown>;
        };
        stateStore: {
            getSelectedModule: (category: string) => { id?: string } | undefined;
        };
        windowService: {
            close: () => Promise<void>;
        };
        chatController: {
            randomizeGreeting: () => void;
        };
        appUI: {
            showToast: (
                msg: string,
                type?: 'success' | 'error' | 'warning' | 'info',
                duration?: number,
            ) => void;
        };
    };
