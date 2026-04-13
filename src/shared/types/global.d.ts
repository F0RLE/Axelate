import { type IApp, type ILogEntry } from '@/shared/types/coreTypes';
import type { IBridgeResponse } from '@/features/ai/types/aiTypes';
import type { Core } from '@/app/init';

export {};

interface ChatContentPart {
    type: 'text' | 'image_url' | 'file';
    text?: string;
    image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
    data?: string;
    mime?: string;
    name?: string;
}

type ChatHistoryContent = string | ChatContentPart[];

interface ChatHistoryItem {
    role: 'user' | 'assistant' | 'system';
    content: ChatHistoryContent;
    timestamp?: number;
}

interface AIBridgeInterface {
    setCore: (_core: Core) => void;
    init: () => Promise<void>;
    startProvider: (_providerId: string) => Promise<boolean>;
    stopProvider: () => void;
    isActive: () => boolean;
    getActiveProvider: () => { id: string; name: string } | null;
    sendMessage: (
        _text: string,
        _source?: 'chat' | 'service' | 'system',
        _attachments?: { name: string; type: string; data_base64: string }[],
    ) => Promise<IBridgeResponse>;
    onMessage: (
        _listenerId: string,
        _handler: (_response: string, _source: string) => void,
    ) => void;
    removeListener: (_listenerId: string) => void;
    onChunk: (_listenerId: string, _handler: (_chunk: string) => void) => void;
    removeChunkListener: (_listenerId: string) => void;
    cancelImageGeneration: () => Promise<void>;
    getImageGenerationPreview: () => Promise<{
        data_url: string;
        updated_at_ms: number;
    } | null>;
    rewindLastTurn: () => Promise<string | null>;
    getHistory: () => Promise<ChatHistoryItem[]>;
    getState: () => { activeProviderId: string | null; isRunning: boolean };
    destroy: () => void;
}

/** UI State Management interface (Section 21) */
interface UIStateInterface {
    loadState: () => Promise<IUIState>;
    saveAsync: () => Promise<void>;
    saveImmediate: () => void;
    setState: (_state: Partial<IUIState>) => void;
    updateState: (_updates: Partial<IUIState>) => void;
    getState: () => IUIState;
    get: <K extends keyof IUIState>(_key: K) => IUIState[K];
    set: <K extends keyof IUIState>(_key: K, _value: IUIState[K]) => void;
    getSelectedModules: () => Record<string, Partial<IApp>>;
    getSelectedModule: (_category: string) => Partial<IApp> | undefined;
    setSelectedModule: (_category: string, _moduleData: Partial<IApp>) => void;
    removeSelectedModule: (_category: string) => void;
    getSelectedAIModel: (_appId: string) => string | undefined;
    setSelectedAIModel: (_appId: string, _modelKey: string) => void;
    getSidebarWidth: () => number;
    setSidebarWidth: (_width: number) => void;
    getSidebarCollapsed: () => boolean;
    setSidebarCollapsed: (_collapsed: boolean) => void;
    getLastPage: () => string;
    setLastPage: (_page: string) => void;
    getResolutionZoom: (_resKey: string) => number | undefined;
    setResolutionZoom: (_resKey: string, _zoom: number) => void;
    getZoomLevel: () => number;
    setZoomLevel: (_zoom: number) => void;
    getSoundEnabled: () => boolean;
    setSoundEnabled: (_enabled: boolean) => void;
}

declare global {
    // --- Core Localization ---
    function t(_key: string, _def?: string, _params?: Record<string, unknown>): string;
    var currentLang: string;
    var setLanguage: (_lang: string) => Promise<void>;
    var applyTranslations: () => void;

    // --- Core Services & Logging ---
    var tracer: {
        info: (_msg: string, ..._args: unknown[]) => void;
        warn: (_msg: string, ..._args: unknown[]) => void;
        error: (_msg: string, ..._args: unknown[]) => void;
        debug: (_msg: string, ..._args: unknown[]) => void;
        getLogs: () => ILogEntry[];
    };
    interface ICatalogService {
        loadCatalog: () => Promise<void>;
        getAppById: (_id: string) => IApp | undefined;
    }

    var catalogService: ICatalogService;
    var core: unknown;
    var control: (_action: string, _service: string) => Promise<boolean>;
    var updateDiagnostics: () => Promise<void>;
    var setLogView: (_view: string, _btn: HTMLElement) => void;
    var __APP_VERSION__: string;

    // --- AI Bridge & Models ---
    var aiBridge: AIBridgeInterface;
    var clearLogs: () => Promise<void>;

    // --- Tauri ---
    var __TAURI__: {
        core: {
            invoke: <T = unknown>(_cmd: string, _args?: Record<string, unknown>) => Promise<T>;
        };
        invoke: <T = unknown>(_cmd: string, _args?: Record<string, unknown>) => Promise<T>;
        event: {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
            listen: <T>(
                _event: string,
                _handler: (_event: { payload: T }) => void,
            ) => Promise<() => void>;
        };
        window: {
            getCurrentWindow: () => {
                isMaximized: () => Promise<boolean>;
                setSize: (_size: { width: number; height: number }) => Promise<void>;
                center: () => Promise<void>;
            };
            LogicalSize: new (_width: number, _height: number) => { width: number; height: number };
        };
    };
    var __TAURI_INTERNALS__:
        | {
              invoke?: <T = unknown>(_cmd: string, _args?: Record<string, unknown>) => Promise<T>;
              transformCallback?: (cb: unknown, once?: boolean) => string;
          }
        | undefined;

    // --- UI State & Navigation ---
    var uiState: UIStateInterface;
    var showPage: (_id: string, _btn?: HTMLElement | null, _isInitial?: boolean) => void;
    var openAppSelection: (_category: string) => void;
    var closeAppSelection: () => void;
    var launchApp: (_id: string) => Promise<void>;
    var setDebugTab: (_tabId: string, _btn: HTMLElement) => void;

    // --- Feedback & Notifications ---
    var showToast: (
        _message: string,
        _type?: 'success' | 'error' | 'warning' | 'info',
        _duration?: number,
        _title?: string | null,
    ) => void;
    var showSkeletonLoaders: (_id: string, _count?: number) => void;
    var hideSkeletonLoaders: (_id: string, _count?: number) => void;
    var setButtonLoading: (_btn: HTMLButtonElement | null, _loading: boolean) => void;

    // --- Module & Download Management ---
    var checkModuleInstalled: (_id: string) => Promise<boolean>;
    var openModuleSettings: (_app: IApp) => void;
    var closeModuleSettings: () => void;
    var moduleDownloadState: Record<string, unknown>;
    var diskUtil: {
        getFreeSpace: (_path: string) => Promise<number>;
    };
    var formatBytes: (_bytes: number, _decimals?: number) => string;

    // --- Window Controls ---
    var minimizeWindow: () => Promise<void>;
    var toggleMaximizeWindow: () => Promise<void>;
    var hideToTray: () => Promise<void>;
    var confirmClose: () => Promise<void>;

    interface Window {
        t: typeof t;
        currentLang: typeof currentLang;
        setLanguage: typeof setLanguage;
        tracer: typeof tracer;
        core: typeof core;
        control: typeof control;
        updateDiagnostics: typeof updateDiagnostics;
        aiBridge: typeof aiBridge;
        __TAURI__: typeof __TAURI__;
        uiState: typeof uiState;
        showPage: typeof showPage;
        openAppSelection: typeof openAppSelection;
        closeAppSelection: typeof closeAppSelection;
        launchApp: typeof launchApp;
        showToast: typeof showToast;
        showSkeletonLoaders: typeof showSkeletonLoaders;
        hideSkeletonLoaders: typeof hideSkeletonLoaders;
        setButtonLoading: typeof setButtonLoading;
        checkModuleInstalled: typeof checkModuleInstalled;
        openModuleSettings: typeof openModuleSettings;
        closeModuleSettings: typeof closeModuleSettings;
        diskUtil: typeof diskUtil;
        formatBytes: typeof formatBytes;
        minimizeWindow: typeof minimizeWindow;
        toggleMaximizeWindow: typeof toggleMaximizeWindow;
        hideToTray: typeof hideToTray;
        confirmClose: typeof confirmClose;
        applyTranslations: typeof applyTranslations;
        setLogView: typeof setLogView;
        sendChat: typeof sendChat;
        clearLogs: typeof clearLogs;
        setDebugTab: typeof setDebugTab;
        catalogService: typeof catalogService;
        __TAURI_INTERNALS__: typeof __TAURI_INTERNALS__;
    }
}
