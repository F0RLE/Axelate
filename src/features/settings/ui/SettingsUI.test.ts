import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModuleSettingsUI } from './ModuleSettingsUI';
import type { SettingsService } from '../services/SettingsService';
import type { UISettingsService } from '@/shared/services/ui/UISettingsService';
import type { AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { TauriProvider } from '@/infrastructure/tauri/TauriProvider';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { EventBus } from '@/shared/services/EventBus';

type ModuleSettingsUIPrivate = {
    _context: {
        t: (key: string, defaultValue?: string) => string;
        showToast: ReturnType<typeof vi.fn>;
        i18nUI: { applyTranslations: ReturnType<typeof vi.fn> };
        currentModule?: Record<string, unknown>;
    };
    _bindEvents: () => void;
    _loadCardWidths: () => void;
    _updateCardLayout: (card: HTMLElement, width: string) => void;
    _showSaveIndicator: () => void;
    _hideSaveIndicator: () => void;
    _debouncedSave: (key: string, value: string | number | boolean | null) => void;
    _renderLocalEngineConfig: (
        container: HTMLElement,
        app: Record<string, unknown>,
    ) => Promise<void>;
    _openModuleSettingsHelper: (app: Record<string, unknown>) => Promise<void>;
    openModuleSettings: (app: Record<string, unknown>) => Promise<void>;
    _resetDynamicModuleState: () => void;
    destroy: () => void;
    _onModuleSettingsChanged: ReturnType<typeof vi.fn>;
};

describe('ModuleSettingsUI lifecycle', () => {
    let settingsUI: ModuleSettingsUI | null = null;

    beforeEach(() => {
        document.body.innerHTML = '<dialog id="module-settings-modal"></dialog>';
        vi.clearAllMocks();
    });

    afterEach(() => {
        settingsUI?.destroy();
        settingsUI = null;
        document.body.innerHTML = '';
    });

    function createSettingsUI(): ModuleSettingsUIPrivate {
        const service = {
            getSettings: vi.fn().mockReturnValue({}),
            saveSetting: vi.fn().mockResolvedValue(true),
            loadGpuInfo: vi.fn().mockResolvedValue({
                detected: true,
                name: 'NVIDIA RTX 4090',
                cuda: true,
                backend: 'cuda',
                memory: 24576,
            }),
        } as unknown as SettingsService;
        const uiSettings = {
            setCardWidth: vi.fn(),
            getCardWidth: vi.fn().mockReturnValue(undefined),
            getCardWidths: vi.fn().mockReturnValue({}),
        } as unknown as UISettingsService;
        const aiSettings = {
            getThinkingLevel: vi
                .fn()
                .mockImplementation((appId: string) => (appId === 'llamacpp' ? 'low' : 'high')),
            setThinkingLevel: vi.fn(),
        } as unknown as AISettingsService;
        const i18nUI = {
            applyTranslations: vi.fn(),
        } as unknown as I18nUI;
        const tauri = {
            isTauri: vi.fn().mockReturnValue(false),
        } as unknown as TauriProvider;
        const navigation = {
            removeBackAction: vi.fn(),
        } as unknown as NavigationService;
        const onModuleSettingsChanged = vi.fn();

        settingsUI = new ModuleSettingsUI(
            service,
            uiSettings,
            aiSettings,
            {
                t: (key: string, defaultValue = '') => `t:${key}:${defaultValue}`,
            } as unknown as I18nService,
            i18nUI,
            tauri,
            navigation,
            {
                tracer: {
                    info: vi.fn(),
                    warn: vi.fn(),
                    error: vi.fn(),
                    debug: vi.fn(),
                } satisfies Pick<LoggerService, 'info' | 'warn' | 'error' | 'debug'>,
                showToast: vi.fn(),
                reopenModuleSettings: vi.fn(),
                closeAppSelection: vi.fn(),
                onModuleSettingsChanged,
                eventBus: new EventBus(),
            },
        );

        const privateUI = settingsUI as unknown as ModuleSettingsUIPrivate;
        (
            privateUI as unknown as {
                _engineConfigService: { setConfig: ReturnType<typeof vi.fn> };
            }
        )._engineConfigService = {
            setConfig: vi.fn().mockResolvedValue(undefined),
        };
        privateUI._context = {
            t: (key: string, defaultValue?: string) => `t:${key}:${defaultValue ?? ''}`,
            showToast: vi.fn(),
            i18nUI: {
                applyTranslations: vi.fn(),
            },
        };
        privateUI._onModuleSettingsChanged = onModuleSettingsChanged;

        return privateUI;
    }

    it('should render context size and system prompt for llamacpp local settings', async () => {
        const ui = createSettingsUI();
        const container = document.createElement('div');
        (
            ui as unknown as {
                _engineConfigService: { getSettingsPayload: ReturnType<typeof vi.fn> };
            }
        )._engineConfigService.getSettingsPayload = vi.fn().mockResolvedValue({
            config: {
                engine_id: 'llamacpp',
                compute_mode: 'gpu',
                context_size: 8192,
                model_path: 'C:/models/llama.gguf',
                extra_args: ['--flash-attn'],
            },
        });

        await ui._renderLocalEngineConfig(container, { id: 'llamacpp', capability: 'text' });

        const labels = Array.from(container.querySelectorAll('.local-engine-field-label')).map(
            (node) => node.textContent,
        );
        expect(labels).not.toContain('t:ui.settings.engine.compute_mode:Compute Device');
        expect(labels).toContain('t:ui.settings.engine.context_size:Context Window');
        expect(labels).toContain('t:ui.settings.engine.system_prompt:System Prompt');
    });

    it('should stop active module lifecycle when module settings change', () => {
        const ui = createSettingsUI();
        const app = { id: 'llamacpp', name: 'llama.cpp' };
        ui._context.currentModule = app;

        ui._debouncedSave('llamacpp_system_prompt', 'Be concise');

        expect(ui._onModuleSettingsChanged).toHaveBeenCalledWith(app);
    });

    it('should not render runtime package hint for sdcpp local settings', async () => {
        const ui = createSettingsUI();
        const container = document.createElement('div');
        (
            ui as unknown as {
                _engineConfigService: { getSettingsPayload: ReturnType<typeof vi.fn> };
            }
        )._engineConfigService.getSettingsPayload = vi.fn().mockResolvedValue({
            config: {
                engine_id: 'sdcpp',
                compute_mode: 'gpu',
                context_size: 4096,
                model_path: 'C:/models/sd.safetensors',
                extra_args: [],
            },
        });

        await ui._renderLocalEngineConfig(container, { id: 'sdcpp', capability: 'image' });

        expect(container.textContent).not.toContain('Auto download package');
    });

    it('should show save errors and apply stored card widths', async () => {
        vi.useFakeTimers();
        const ui = createSettingsUI();
        document.body.innerHTML += `
            <div id="save-indicator"><span></span></div>
            <div style="grid-template-columns:1fr 1fr">
                <div class="resizable-card" data-card-id="gpu"></div>
            </div>
        `;
        (
            ui as unknown as {
                _service: { saveSetting: ReturnType<typeof vi.fn> };
                _uiSettings: { getCardWidths: ReturnType<typeof vi.fn> };
            }
        )._service.saveSetting.mockRejectedValueOnce(new Error('nope'));
        (
            ui as unknown as {
                _uiSettings: { getCardWidths: ReturnType<typeof vi.fn> };
            }
        )._uiSettings.getCardWidths.mockReturnValue({ gpu: 'full' });

        ui._loadCardWidths();
        const card = document.querySelector('.resizable-card') as HTMLElement;
        expect(card.dataset['cardWidth']).toBe('full');

        ui._updateCardLayout(card, 'half');
        expect((card.parentElement as HTMLElement).style.gridTemplateColumns).toBe('1fr 1fr');

        ui._showSaveIndicator();
        expect(document.getElementById('save-indicator')?.classList.contains('show')).toBe(true);
        ui._hideSaveIndicator();
        expect(document.getElementById('save-indicator')?.classList.contains('show')).toBe(false);

        ui._debouncedSave('theme', 'dark');
        await vi.runAllTimersAsync();
        expect(document.querySelector('#save-indicator span')?.textContent).toBe(
            't:ui.settings.save_failed:Save failed',
        );
    });

    it('should cancel pending autosave timers when modal closes', async () => {
        vi.useFakeTimers();
        createSettingsUI();
        document.body.innerHTML += '<div id="save-indicator"><span></span></div>';

        const service = (
            settingsUI as unknown as {
                _service: { saveSetting: ReturnType<typeof vi.fn> };
            }
        )._service;

        (
            settingsUI as unknown as {
                _debouncedSave: (key: string, value: string | number | boolean | null) => void;
            }
        )._debouncedSave('theme', 'dark');

        settingsUI?.close();
        vi.advanceTimersByTime(1000);
        await Promise.resolve();

        expect(service.saveSetting).not.toHaveBeenCalled();
        expect(document.getElementById('save-indicator')?.classList.contains('show')).toBe(false);
    });

    it('should remove dropdown document listener on destroy', () => {
        const ui = createSettingsUI();
        document.body.innerHTML +=
            '<button id="lang-dropdown-btn-home"></button><div id="lang-dropdown-menu-home" class="lang-dropdown-menu show"></div>';
        const dropdown = document.getElementById('lang-dropdown-menu-home') as HTMLDivElement;

        ui._bindEvents();

        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(dropdown.classList.contains('show')).toBe(false);

        dropdown.classList.add('show');
        ui.destroy();

        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(dropdown.classList.contains('show')).toBe(true);
    });

    it('should reuse the in-flight open request for the same module', async () => {
        const ui = createSettingsUI();
        const app: Record<string, unknown> = { id: 'module-a' };
        let resolveOpen!: () => void;
        const pendingOpen = new Promise<void>((resolve) => {
            resolveOpen = resolve;
        });
        const openHelper = vi.fn().mockImplementation(async () => await pendingOpen);

        ui._openModuleSettingsHelper = openHelper as typeof ui._openModuleSettingsHelper;

        const firstOpen = ui.openModuleSettings(app);
        await Promise.resolve();
        const secondOpen = ui.openModuleSettings(app);

        expect(openHelper).toHaveBeenCalledTimes(1);

        resolveOpen();
        await Promise.all([firstOpen, secondOpen]);

        await ui.openModuleSettings(app);
        expect(openHelper).toHaveBeenCalledTimes(2);
    });
});
