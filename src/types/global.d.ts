import { IApp, ILogEntry } from '../modules/core/types/coreTypes';

export {};

/** Secure Storage interface */
interface SecureStorageAPI {
    get: (_key: string) => Promise<string | null>;
    save: (_key: string, _value: string) => Promise<void>;
}

/** FluxAPI interface */
interface FluxAPIInterface {
    secureStorage: SecureStorageAPI;
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
}

/** AI Bridge interface */
interface AIBridgeInterface {
    startProvider: (_providerId: string) => Promise<boolean>;
    stopProvider: () => void;
    isActive: () => boolean;
    getActiveProvider: () => { id: string; name: string } | null;
    sendMessage: (_text: string, _source: 'chat' | 'service' | 'system') => Promise<string>;
    onMessage: (
        _listenerId: string,
        _handler: (_response: string, _source: string) => void,
    ) => void;
    removeListener: (_listenerId: string) => void;
    clearHistory: () => void;
}

/** UI State Management interface */
interface UIStateInterface {
    load?: () => Promise<void>;
    setSelectedModule: (_category: string, _moduleData: Partial<IApp>) => void;
    removeSelectedModule: (_category: string) => void;
    getSelectedModules: () => Record<string, Partial<IApp>>;
    getSidebarWidth: () => number;
    setSidebarWidth: (_width: number) => void;
    getSidebarCollapsed: () => boolean;
    setSidebarCollapsed: (_collapsed: boolean) => void;
    getLastPage: () => string;
    setLastPage: (_page: string) => void;
    getDownloadSettings: () => { limitEnabled: boolean; maxSpeed: number };
    setDownloadSettings: (_limitEnabled: boolean, _maxSpeed: number) => void;
}

declare global {
    // --- Core Localization ---
    function t(_key: string, _def?: string, _params?: Record<string, unknown>): string;
    var currentLang: string;
    var setLanguage: (_lang: string) => Promise<void>;
    var changeLanguage: (_lang: string) => Promise<void>;
    var toggleLangMenu: () => void;
    var toggleSidebarLangMenu: () => void;
    var applyTranslations: () => void;
    var initEmojiFlags: () => void;
    var updateLangButtons: () => void;
    var selectLangInModal: (_lang: string) => void;
    var confirmLanguage: () => void;

    // --- Core Services & Logging ---
    var logger: {
        info: (_msg: string, ..._args: unknown[]) => void;
        warn: (_msg: string, ..._args: unknown[]) => void;
        error: (_msg: string, ..._args: unknown[]) => void;
        debug: (_msg: string, ..._args: unknown[]) => void;
        getLogs: () => ILogEntry[];
    };
    var core: unknown;
    var control: (_action: string, _service: string) => Promise<boolean>;
    var controlModule: (_id: string, _action: string) => Promise<boolean>;
    var updateDiagnostics: () => Promise<void>;
    var updateState: () => void;
    var checkFirstLaunch: () => Promise<void>;
    var setLogView: (_view: string, _btn: HTMLElement) => void;
    var __APP_VERSION__: string;


    // --- AI Bridge & Models ---
    var aiBridge: AIBridgeInterface;
    var GPT_MODELS: Record<string, unknown>;
    var GEMINI_MODELS: Record<string, unknown>;
    var selectGPTModel: (_modelId: string) => void;
    var selectGeminiModel: (_modelId: string) => void;
    var saveGPTKey: (_key: string) => Promise<void>;
    var saveGeminiKey: (_key: string) => Promise<void>;
    var checkGPTKey: () => Promise<boolean>;
    var checkGeminiKey: () => Promise<boolean>;
    var clearChat: () => void;
    var pickChatFiles: () => void;
    var toggleVoiceInput: () => void;
    var sendChat: () => void;

    // --- FluxAPI & Tauri ---
    var fluxAPI: FluxAPIInterface;
    var __TAURI__: {
        core: {
            invoke: <T = unknown>(_cmd: string, _args?: Record<string, unknown>) => Promise<T>;
        };
        event: {
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
    var APP_DATA: Record<string, IApp[]>;

    // --- UI State & Navigation ---
    var uiState: UIStateInterface;
    var showPage: (_id: string, _btn?: HTMLElement | null, _isInitial?: boolean) => void;
    var showPromptTab: (_tab: string, _btn?: HTMLElement) => void;
    var openAppSelection: (_category: string) => void;
    var closeAppSelection: () => void;
    var selectApp: (_category: string, _app: IApp) => Promise<void>;
    var launchApp: (_id: string) => Promise<void>;

    // --- Feedback & Notifications ---
    var showToast: (
        _message: string,
        _type?: 'success' | 'error' | 'warning' | 'info',
        _duration?: number,
        _title?: string | null,
    ) => void;
    var showActionFeedback: (_type?: string) => void;
    var showSkeletonLoaders: (_id: string, _count?: number) => void;
    var hideSkeletonLoaders: (_id: string, _count?: number) => void;
    var setButtonLoading: (_btn: HTMLButtonElement | null, _loading: boolean) => void;

    // --- Module & Download Management ---
    var downloadModule: (_id: string, _url: string) => Promise<void>;
    var deleteModule: (_id: string) => Promise<void>;
    var checkModuleInstalled: (_id: string) => Promise<boolean>;
    var openModuleSettings: (_app: IApp) => void;
    var closeModuleSettings: () => void;
    var updateModuleSettings: (_settings: Record<string, unknown>) => void;
    var openDownloadSettings: () => void;
    var closeDownloadSettings: () => void;
    var saveDownloadSettings: () => void;
    var updateSpeedDisplay: (_speed: string) => void;
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
    var hideSplashScreen: () => void;
    var hideCloseConfirmModal: () => void;
    var confirmCloseFromModal: () => void;

    interface Window {
        t: typeof t;
        currentLang: typeof currentLang;
        setLanguage: typeof setLanguage;
        changeLanguage: typeof changeLanguage;
        logger: typeof logger;
        core: typeof core;
        control: typeof control;
        controlModule: typeof controlModule;
        updateDiagnostics: typeof updateDiagnostics;
        updateState: typeof updateState;
        aiBridge: typeof aiBridge;
        GPT_MODELS: typeof GPT_MODELS;
        GEMINI_MODELS: typeof GEMINI_MODELS;
        selectGPTModel: typeof selectGPTModel;
        selectGeminiModel: typeof selectGeminiModel;
        saveGPTKey: typeof saveGPTKey;
        saveGeminiKey: typeof saveGeminiKey;
        checkGPTKey: typeof checkGPTKey;
        checkGeminiKey: typeof checkGeminiKey;
        fluxAPI: typeof fluxAPI;
        __TAURI__: typeof __TAURI__;
        APP_DATA: typeof APP_DATA;
        uiState: typeof uiState;
        showPage: typeof showPage;
        showPromptTab: typeof showPromptTab;
        openAppSelection: typeof openAppSelection;
        closeAppSelection: typeof closeAppSelection;
        selectApp: typeof selectApp;
        launchApp: typeof launchApp;
        showToast: typeof showToast;
        showActionFeedback: typeof showActionFeedback;
        showSkeletonLoaders: typeof showSkeletonLoaders;
        hideSkeletonLoaders: typeof hideSkeletonLoaders;
        setButtonLoading: typeof setButtonLoading;
        downloadModule: typeof downloadModule;
        deleteModule: typeof deleteModule;
        checkModuleInstalled: typeof checkModuleInstalled;
        openModuleSettings: typeof openModuleSettings;
        closeModuleSettings: typeof closeModuleSettings;
        updateModuleSettings: typeof updateModuleSettings;
        openDownloadSettings: typeof openDownloadSettings;
        closeDownloadSettings: typeof closeDownloadSettings;
        diskUtil: typeof diskUtil;
        formatBytes: typeof formatBytes;
        minimizeWindow: typeof minimizeWindow;
        toggleMaximizeWindow: typeof toggleMaximizeWindow;
        hideToTray: typeof hideToTray;
        confirmClose: typeof confirmClose;
        hideSplashScreen: typeof hideSplashScreen;
        toggleLangMenu: typeof toggleLangMenu;
        toggleSidebarLangMenu: typeof toggleSidebarLangMenu;
        applyTranslations: typeof applyTranslations;
        initEmojiFlags: typeof initEmojiFlags;
        updateLangButtons: typeof updateLangButtons;
        checkFirstLaunch: typeof checkFirstLaunch;
        setLogView: typeof setLogView;
        clearChat: typeof clearChat;
        pickChatFiles: typeof pickChatFiles;
        toggleVoiceInput: typeof toggleVoiceInput;
        sendChat: typeof sendChat;
        selectLangInModal: typeof selectLangInModal;
        confirmLanguage: typeof confirmLanguage;
        hideCloseConfirmModal: typeof hideCloseConfirmModal;
        confirmCloseFromModal: typeof confirmCloseFromModal;
        saveDownloadSettings: typeof saveDownloadSettings;
        updateSpeedDisplay: typeof updateSpeedDisplay;
    }
}
