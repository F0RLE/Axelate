const BRIDGE_CHANNEL = "axelate:module-settings";
const MODULE_BOOT_TIMEOUT_MS = 4000;

const STRINGS = {
    en: {
        loading: "Loading module settings…",
        loadingModule: "Loading module settings…",
        failed: "Failed to load the module or integration settings UI.",
        invalidSavePayload: "Settings payload must be a plain object.",
        moduleBootTimedOut:
            "The module or integration settings UI did not finish loading.",
    },
    ru: {
        loading: "Загрузка интерфейса настроек модуля…",
        loadingModule: "Загрузка интерфейса настроек модуля…",
        failed: "Не удалось загрузить интерфейс настроек этого модуля или интеграции.",
        invalidSavePayload: "Настройки должны передаваться как обычный объект.",
        moduleBootTimedOut:
            "Интерфейс настроек этого модуля или интеграции не завершил загрузку.",
    },
    zh: {
        loading: "正在加载模块设置界面…",
        loadingModule: "正在加载模块设置界面…",
        failed: "无法加载该模块或集成的设置界面。",
        invalidSavePayload: "设置载荷必须是普通对象。",
        moduleBootTimedOut: "该模块或集成的设置界面未能完成加载。",
    },
};

const params = new URLSearchParams(globalThis.location.search);
const language = normalizeLanguage(params.get("language"));
const strings = STRINGS[language] ?? STRINGS.en;

const elements = {
    frame: document.getElementById("module-frame"),
    overlay: document.getElementById("overlay"),
    overlayMessage: document.getElementById("overlay-message"),
};

const state = {
    context: buildContext(params),
    settings: {},
    bootTimeoutTimer: null,
    frameLoaded: false,
    moduleReady: false,
};

document.documentElement.dataset.theme = state.context.launcher.theme;
setOverlay("loading", strings.loadingModule);

void bootstrap().catch((error) => {
    showFatalError(error);
});

async function bootstrap() {
    ensureElements();
    globalThis.addEventListener("message", handleModuleMessage);
    await loadSettings();
    mountModuleFrame();
}

function ensureElements() {
    if (
        !(elements.frame instanceof HTMLIFrameElement) ||
        !(elements.overlay instanceof HTMLElement) ||
        !(elements.overlayMessage instanceof HTMLElement)
    ) {
        throw new Error("Host UI elements are missing");
    }
}

function buildContext(searchParams) {
    return {
        bridgeVersion: 1,
        module: {
            id: searchParams.get("moduleId") ?? "",
            name:
                searchParams.get("name") ?? searchParams.get("moduleId") ?? "",
            category: searchParams.get("category") ?? "",
            type: searchParams.get("type") ?? "",
            settingsUi: searchParams.get("settingsUi"),
        },
        launcher: {
            language,
            theme: normalizeTheme(searchParams.get("theme")),
        },
    };
}

function normalizeLanguage(rawLanguage) {
    const normalized = String(rawLanguage ?? "en")
        .trim()
        .toLowerCase();
    if (normalized.startsWith("ru")) {
        return "ru";
    }
    if (normalized.startsWith("zh")) {
        return "zh";
    }
    return "en";
}

function normalizeTheme(rawTheme) {
    return String(rawTheme ?? "dark")
        .trim()
        .toLowerCase() === "light"
        ? "light"
        : "dark";
}

async function loadSettings() {
    state.settings = await requestJson("/api/settings");
}

function mountModuleFrame() {
    if (!(elements.frame instanceof HTMLIFrameElement)) {
        return;
    }

    elements.frame.addEventListener("load", () => {
        state.frameLoaded = true;
        revealModuleWhenReady();
    });
    armModuleBootTimeout();
    elements.frame.src = buildUrl("/module/");
}

function handleModuleMessage(event) {
    if (
        !(elements.frame instanceof HTMLIFrameElement) ||
        event.source !== elements.frame.contentWindow
    ) {
        return;
    }

    const payload = event.data;
    if (!isBridgePayload(payload)) {
        return;
    }

    if (payload.type === "module-ready") {
        state.moduleReady = true;
        clearModuleBootTimeout();
        postHostReady();
        revealModuleWhenReady();
        return;
    }

    if (
        typeof payload.requestId !== "string" ||
        typeof payload.method !== "string"
    ) {
        return;
    }

    void processModuleRequest(payload);
}

function isBridgePayload(payload) {
    return (
        typeof payload === "object" &&
        payload !== null &&
        payload.channel === BRIDGE_CHANNEL
    );
}

function postHostReady() {
    if (
        !(elements.frame instanceof HTMLIFrameElement) ||
        elements.frame.contentWindow === null
    ) {
        return;
    }

    elements.frame.contentWindow.postMessage(
        {
            channel: BRIDGE_CHANNEL,
            type: "host-ready",
            context: state.context,
            settings: state.settings,
        },
        "*",
    );
}

function armModuleBootTimeout() {
    clearModuleBootTimeout();
    state.frameLoaded = false;
    state.moduleReady = false;
    state.bootTimeoutTimer = globalThis.setTimeout(() => {
        if (!state.moduleReady) {
            showFatalError(new Error(strings.moduleBootTimedOut));
        }
    }, MODULE_BOOT_TIMEOUT_MS);
}

function clearModuleBootTimeout() {
    if (state.bootTimeoutTimer !== null) {
        globalThis.clearTimeout(state.bootTimeoutTimer);
        state.bootTimeoutTimer = null;
    }
}

function revealModuleWhenReady() {
    if (!state.frameLoaded || !state.moduleReady) {
        return;
    }

    clearModuleBootTimeout();
    hideOverlay();
}

async function processModuleRequest(request) {
    try {
        const result = await resolveRequest(request);
        postBridgeResponse({
            channel: BRIDGE_CHANNEL,
            requestId: request.requestId,
            ok: true,
            result,
        });
    } catch (error) {
        postBridgeResponse({
            channel: BRIDGE_CHANNEL,
            requestId: request.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function resolveRequest(request) {
    switch (request.method) {
        case "getContext":
            return state.context;
        case "getSettings":
            return state.settings;
        case "saveSettings":
            return await saveSettings(request.payload);
        // Keep optional bridge hooks compatible without letting the host own module UX.
        case "markDirty":
            return { dirty: true };
        case "notify":
            return { shown: true };
        default:
            throw new Error(
                `Unsupported custom settings method: ${request.method}`,
            );
    }
}

async function saveSettings(payload) {
    const normalizedSettings = normalizeSettingsPayload(payload);
    const savedSettings = await requestJson("/api/settings", {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify(normalizedSettings),
    });

    state.settings = savedSettings;
    return state.settings;
}

function normalizeSettingsPayload(payload) {
    if (!isPlainObject(payload)) {
        throw new Error(strings.invalidSavePayload);
    }

    return JSON.parse(JSON.stringify(payload));
}

function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function postBridgeResponse(message) {
    if (
        !(elements.frame instanceof HTMLIFrameElement) ||
        elements.frame.contentWindow === null
    ) {
        return;
    }

    elements.frame.contentWindow.postMessage(message, "*");
}

function setOverlay(stateName, message) {
    if (
        !(elements.overlay instanceof HTMLElement) ||
        !(elements.overlayMessage instanceof HTMLElement)
    ) {
        return;
    }

    elements.overlay.hidden = false;
    elements.overlay.dataset.state = stateName;
    elements.overlayMessage.textContent = message;
}

function hideOverlay() {
    if (!(elements.overlay instanceof HTMLElement)) {
        return;
    }

    elements.overlay.hidden = true;
}

async function requestJson(path, init = {}) {
    const response = await fetch(buildUrl(path), {
        cache: "no-store",
        ...init,
    });

    const bodyText = await response.text();
    const parsedBody = bodyText === "" ? {} : safeParseJson(bodyText);

    if (!response.ok) {
        const errorMessage =
            isPlainObject(parsedBody) && typeof parsedBody.message === "string"
                ? parsedBody.message
                : strings.failed;
        throw new Error(errorMessage);
    }

    return isPlainObject(parsedBody) ? parsedBody : {};
}

async function extractErrorMessage(response, fallbackMessage) {
    const bodyText = await response.text();
    const parsedBody = safeParseJson(bodyText);
    if (isPlainObject(parsedBody) && typeof parsedBody.message === "string") {
        return parsedBody.message;
    }

    return bodyText.trim() === "" ? fallbackMessage : bodyText;
}

function safeParseJson(input) {
    try {
        return JSON.parse(input);
    } catch {
        return null;
    }
}

function buildUrl(path) {
    return new URL(path, globalThis.location.href).toString();
}

function showFatalError(error) {
    clearModuleBootTimeout();
    const message =
        error instanceof Error && error.message.trim() !== ""
            ? error.message
            : strings.failed;
    setOverlay("error", message);
}
