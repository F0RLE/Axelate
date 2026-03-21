import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUI } from './AppUI';
import { eventBus } from '../services/EventBus';
import type { ModulePlatformService } from '../services/ModulePlatformService';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { IApp } from '../types/coreTypes';

describe('AppUI lifecycle', () => {
    let appUI: AppUI | null = null;

    beforeEach(() => {
        document.body.innerHTML = '';
        (
            globalThis as unknown as {
                APP_DATA: { ai: unknown[]; services: unknown[]; stars: unknown[] };
            }
        ).APP_DATA = {
            ai: [],
            services: [],
            stars: [],
        };
        (
            globalThis as unknown as {
                uiState: {
                    removeSelectedModule: ReturnType<typeof vi.fn>;
                    updateState: ReturnType<typeof vi.fn>;
                    setSelectedModule: ReturnType<typeof vi.fn>;
                };
                t: (key: string, fallback: string) => string;
                getCatalogCategory: ReturnType<typeof vi.fn>;
                launchApp: ReturnType<typeof vi.fn>;
                closeAppSelection: ReturnType<typeof vi.fn>;
                showToast: ReturnType<typeof vi.fn>;
                openModuleSettings: ReturnType<typeof vi.fn>;
                aiBridge: { stopProvider: ReturnType<typeof vi.fn> };
            }
        ).uiState = {
            removeSelectedModule: vi.fn(),
            updateState: vi.fn(),
            setSelectedModule: vi.fn(),
        };
        (globalThis as unknown as { t: (key: string, fallback: string) => string }).t = (
            _key,
            fallback,
        ) => fallback;
        (
            globalThis as unknown as {
                getCatalogCategory: ReturnType<typeof vi.fn>;
                launchApp: ReturnType<typeof vi.fn>;
                closeAppSelection: ReturnType<typeof vi.fn>;
                showToast: ReturnType<typeof vi.fn>;
                openModuleSettings: ReturnType<typeof vi.fn>;
                aiBridge: { stopProvider: ReturnType<typeof vi.fn> };
            }
        ).getCatalogCategory = vi.fn().mockReturnValue([]);
        (globalThis as unknown as { launchApp: ReturnType<typeof vi.fn> }).launchApp = vi
            .fn()
            .mockResolvedValue(undefined);
        (
            globalThis as unknown as { closeAppSelection: ReturnType<typeof vi.fn> }
        ).closeAppSelection = vi.fn();
        (globalThis as unknown as { showToast: ReturnType<typeof vi.fn> }).showToast = vi.fn();
        (
            globalThis as unknown as { openModuleSettings: ReturnType<typeof vi.fn> }
        ).openModuleSettings = vi.fn();
        (
            globalThis as unknown as { aiBridge: { stopProvider: ReturnType<typeof vi.fn> } }
        ).aiBridge = { stopProvider: vi.fn() };
    });

    afterEach(() => {
        appUI?.destroy();
        appUI = null;
        vi.useRealTimers();
    });

    function createAppUI(): AppUI {
        const platformService = {
            isApiModule: vi.fn().mockReturnValue(false),
            delete: vi.fn(),
            download: vi.fn(),
            cancelDownload: vi.fn(),
            stop: vi.fn(),
        } as unknown as ModulePlatformService;

        const navigation = {
            pushBackAction: vi.fn(),
            removeBackAction: vi.fn(),
        } as unknown as NavigationService;

        return new AppUI(platformService, navigation);
    }

    function mountAiCard(currentModule = 'text-model'): HTMLElement {
        document.body.innerHTML = `
            <div id="ai-module-card" class="selected">
                <div class="model-icon-wrapper"></div>
                <div class="model-card-title"></div>
                <div class="model-card-desc"></div>
            </div>
        `;

        const card = document.getElementById('ai-module-card');
        if (!(card instanceof HTMLElement)) {
            throw new Error('AI module card not mounted');
        }

        card.dataset['currentModule'] = currentModule;
        card.dataset['currentModuleName'] = currentModule;
        return card;
    }

    function setAiSelections(targetAppUI: AppUI, textApp: IApp, imageApp: IApp): void {
        const selectedApps = (
            targetAppUI as unknown as {
                _selectedApps: Map<string, IApp>;
            }
        )._selectedApps;

        selectedApps.set('ai_text', textApp);
        selectedApps.set('ai_image', imageApp);
    }

    it('should unsubscribe from page:change on destroy', () => {
        const initialCount = eventBus.listenerCount('page:change');
        appUI = createAppUI();

        expect(eventBus.listenerCount('page:change')).toBe(initialCount + 1);

        appUI.destroy();

        expect(eventBus.listenerCount('page:change')).toBe(initialCount);
    });

    it('should remove language-changed listener on destroy', () => {
        appUI = createAppUI();
        const refreshSpy = vi.spyOn(
            (appUI as unknown as { _modalManager: { refreshCurrentSelection: () => void } })
                ._modalManager,
            'refreshCurrentSelection',
        );

        globalThis.dispatchEvent(new Event('language-changed'));
        expect(refreshSpy).toHaveBeenCalledTimes(1);

        appUI.destroy();
        globalThis.dispatchEvent(new Event('language-changed'));

        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('should cancel pending AI card wheel switch on destroy', () => {
        vi.useFakeTimers();
        appUI = createAppUI();

        const card = mountAiCard();
        const textApp = { id: 'text-model', name: 'Text Model', installed: true } as IApp;
        const imageApp = { id: 'image-model', name: 'Image Model', installed: true } as IApp;
        setAiSelections(appUI, textApp, imageApp);

        card.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 1 }));

        expect(card.style.opacity).toBe('0');

        appUI.destroy();
        vi.advanceTimersByTime(150);

        expect(card.dataset['currentModule']).toBe('text-model');
        expect(card.style.opacity).toBe('');
        appUI = null;
    });

    it('should cancel pending AI card wheel switch when clearing the target slot', () => {
        vi.useFakeTimers();
        appUI = createAppUI();

        const card = mountAiCard();
        const textApp = { id: 'text-model', name: 'Text Model', installed: true } as IApp;
        const imageApp = { id: 'image-model', name: 'Image Model', installed: true } as IApp;
        setAiSelections(appUI, textApp, imageApp);

        card.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 1 }));

        appUI.clearModuleCard('ai_image');
        vi.advanceTimersByTime(150);

        expect(card.dataset['currentModule']).toBe('text-model');
        expect(card.style.opacity).toBe('');
    });

    it('should reset action feedback hide timer when showing feedback again', () => {
        vi.useFakeTimers();
        appUI = createAppUI();

        appUI.showActionFeedback('success');
        vi.advanceTimersByTime(500);

        const feedback = document.getElementById('action-feedback');
        if (!(feedback instanceof HTMLElement)) {
            throw new Error('Action feedback was not created');
        }

        appUI.showActionFeedback('error');
        vi.advanceTimersByTime(100);

        expect(feedback.classList.contains('show')).toBe(true);
        expect(feedback.classList.contains('error')).toBe(true);

        vi.advanceTimersByTime(500);
        expect(feedback.classList.contains('show')).toBe(false);
    });

    it('should cancel action feedback hide timer on destroy', () => {
        vi.useFakeTimers();
        appUI = createAppUI();

        appUI.showActionFeedback('success');
        const feedback = document.getElementById('action-feedback');
        if (!(feedback instanceof HTMLElement)) {
            throw new Error('Action feedback was not created');
        }

        appUI.destroy();
        vi.advanceTimersByTime(600);

        expect(feedback.classList.contains('show')).toBe(true);
        appUI = null;
    });

    it('should delegate modal opening and prompt tab switching', () => {
        appUI = createAppUI();
        const modalOpenSpy = vi.spyOn(
            (
                appUI as unknown as {
                    _modalManager: { openAppSelection: (...args: unknown[]) => void };
                }
            )._modalManager,
            'openAppSelection',
        );

        document.body.innerHTML = `
            <div id="prompt-tab-chat" class="prompt-tab-content" style="display:block"></div>
            <div id="prompt-tab-settings" class="prompt-tab-content"></div>
            <div><button id="tab-a"></button><button id="tab-b"></button></div>
        `;

        appUI.openAppSelection('ai', [{ id: 'gpt', installed: true } as IApp]);
        expect(modalOpenSpy).toHaveBeenCalledWith(
            'ai_text',
            [{ id: 'gpt', installed: true }],
            undefined,
        );

        const btn = document.getElementById('tab-b') as HTMLElement;
        appUI.showPromptTab('settings', btn);
        expect((document.getElementById('prompt-tab-chat') as HTMLElement).style.display).toBe(
            'none',
        );
        expect((document.getElementById('prompt-tab-settings') as HTMLElement).style.display).toBe(
            'block',
        );
        expect(btn.style.background).toBe('var(--primary)');
    });

    it('should update and clear module cards while managing ai slots', () => {
        appUI = createAppUI();
        document.body.innerHTML = `
            <div id="ai-module-card" class="empty">
                <div class="model-icon-wrapper"></div>
                <div class="model-card-title"></div>
                <div class="model-card-desc"></div>
            </div>
        `;

        const textApp = { id: 'text-model', name: 'Text Model', installed: true } as IApp;
        const imageApp = { id: 'image-model', name: 'Image Model', installed: true } as IApp;

        appUI.updateModuleCard('ai_text', textApp);
        appUI.updateModuleCard('ai_image', imageApp);

        const card = document.getElementById('ai-module-card') as HTMLElement;
        expect(card.classList.contains('selected')).toBe(true);
        expect(card.querySelector('.module-action-badge.stack')).not.toBeNull();

        appUI.clearModuleCard('ai_text');
        expect(card.dataset['currentModule']).toBe('image-model');

        appUI.clearModuleCard('ai_image');
        expect(card.classList.contains('empty')).toBe(true);
        const mockedGlobals = globalThis as unknown as {
            aiBridge: { stopProvider: ReturnType<typeof vi.fn> };
            uiState: { updateState: ReturnType<typeof vi.fn> };
        };
        expect(mockedGlobals.aiBridge.stopProvider).toHaveBeenCalled();
        expect(mockedGlobals.uiState.updateState).toHaveBeenCalledWith({
            last_active_provider: null,
        });
    });

    it('should perform selection action for select and deselect flows', () => {
        appUI = createAppUI();
        document.body.innerHTML = `
            <div id="services-module-card" class="empty">
                <div class="model-icon-wrapper"></div>
                <div class="model-card-title"></div>
                <div class="model-card-desc"></div>
            </div>
        `;

        const privateAppUI = appUI as unknown as {
            _performSelectionAction: (category: string, app: IApp) => void;
            _modalManager: { updateSelection: ReturnType<typeof vi.fn> };
        };
        const updateSelectionSpy = vi.spyOn(privateAppUI._modalManager, 'updateSelection');
        const serviceApp = {
            id: 'svc',
            name: 'Service',
            type: 'local',
            icon: 'S',
            desc: 'Desc',
            installed: true,
        } as IApp;

        privateAppUI._performSelectionAction('services', serviceApp);
        expect(updateSelectionSpy).toHaveBeenCalledWith('svc');
        const mockedGlobals = globalThis as unknown as {
            uiState: { setSelectedModule: ReturnType<typeof vi.fn> };
            launchApp: ReturnType<typeof vi.fn>;
        };
        expect(mockedGlobals.uiState.setSelectedModule).toHaveBeenCalled();
        expect(mockedGlobals.launchApp).toHaveBeenCalledWith('svc');

        privateAppUI._performSelectionAction('services', serviceApp);
        expect(updateSelectionSpy).toHaveBeenLastCalledWith(null);
    });

    it('should handle modal download success and error', () => {
        appUI = createAppUI();
        const privateAppUI = appUI as unknown as {
            _onModalDownloadSuccess: (btn: HTMLElement | null, app: IApp) => void;
            _onModalDownloadError: (btn: HTMLElement | null, err: unknown) => void;
            _modalManager: { refreshCurrentSelection: ReturnType<typeof vi.fn> };
        };
        const refreshSpy = vi.spyOn(privateAppUI._modalManager, 'refreshCurrentSelection');

        const card = document.createElement('div');
        card.className = 'app-card';
        card.innerHTML = `
            <div class="app-card-hover-actions"></div>
            <div class="app-type-badge not-installed"></div>
            <div class="app-card-overlay"></div>
        `;
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading indeterminate';
        card.appendChild(btn);

        const app = { id: 'local-app', name: 'Local App', installed: false } as IApp;
        privateAppUI._onModalDownloadSuccess(btn, app);
        expect(app.installed).toBe(true);
        expect(btn.classList.contains('downloading')).toBe(false);
        expect(refreshSpy).toHaveBeenCalled();

        privateAppUI._onModalDownloadError(btn, new Error('broken'));
        const mockedGlobals = globalThis as unknown as { showToast: ReturnType<typeof vi.fn> };
        expect(mockedGlobals.showToast).not.toHaveBeenCalled();
    });
});
