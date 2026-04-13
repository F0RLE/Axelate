import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUI } from './AppUI';
import { eventBus } from '../services/EventBus';
import type { ModulePlatformService } from '../services/ModulePlatformService';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { IApp } from '../types/coreTypes';

describe('AppUI lifecycle', () => {
    let appUI: AppUI | null = null;
    let platformServiceMock: {
        isApiModule: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
        download: ReturnType<typeof vi.fn>;
        cancelDownload: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        document.body.innerHTML = '';
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
        platformServiceMock = {
            isApiModule: vi.fn().mockReturnValue(false),
            delete: vi.fn(),
            download: vi.fn(),
            cancelDownload: vi.fn(),
            stop: vi.fn().mockResolvedValue(true),
        };

        const navigation = {
            pushBackAction: vi.fn(),
            removeBackAction: vi.fn(),
        } as unknown as NavigationService;

        return new AppUI(
            platformServiceMock as unknown as ModulePlatformService,
            navigation,
            (category: string) => {
                const globals = globalThis as unknown as {
                    getCatalogCategory: ReturnType<typeof vi.fn>;
                };
                return (globals.getCatalogCategory as unknown as (key: string) => IApp[])(category);
            },
        );
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

    it('should delegate modal opening', () => {
        appUI = createAppUI();
        const modalOpenSpy = vi.spyOn(
            (
                appUI as unknown as {
                    _modalManager: { openAppSelection: (...args: unknown[]) => void };
                }
            )._modalManager,
            'openAppSelection',
        );

        appUI.openAppSelection('ai', [{ id: 'gpt', installed: true } as IApp]);
        expect(modalOpenSpy).toHaveBeenCalledWith(
            'ai_text',
            [{ id: 'gpt', installed: true }],
            undefined,
        );
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
        expect(platformServiceMock.stop).toHaveBeenCalledWith(textApp);
        expect(platformServiceMock.stop).toHaveBeenCalledWith(imageApp);
    });

    it('should stop the current services module when clearing its card', () => {
        appUI = createAppUI();
        document.body.innerHTML = `
            <div id="services-module-card" class="selected">
                <div class="model-icon-wrapper"></div>
                <div class="model-card-title"></div>
                <div class="model-card-desc"></div>
            </div>
        `;

        const card = document.getElementById('services-module-card') as HTMLElement;
        card.dataset['currentModule'] = 'svc';
        card.dataset['currentModuleName'] = 'Service';

        const serviceApp = { id: 'svc', name: 'Service', installed: true } as IApp;
        appUI.updateModuleCard('services', serviceApp);
        platformServiceMock.stop.mockClear();

        appUI.clearModuleCard('services');

        expect(platformServiceMock.stop).toHaveBeenCalledWith(serviceApp);
    });

    it('should stop the previous services module when switching cards without action button running state', () => {
        appUI = createAppUI();
        document.body.innerHTML = `
            <div id="services-module-card" class="selected">
                <div class="model-icon-wrapper"></div>
                <div class="model-card-title"></div>
                <div class="model-card-desc"></div>
            </div>
        `;

        const oldApp = { id: 'svc-old', name: 'Old Service', installed: true } as IApp;
        const newApp = { id: 'svc-new', name: 'New Service', installed: true } as IApp;

        (
            globalThis as unknown as {
                getCatalogCategory: ReturnType<typeof vi.fn>;
            }
        ).getCatalogCategory.mockImplementation((category: string) =>
            category === 'services' ? [oldApp, newApp] : [],
        );

        appUI.updateModuleCard('services', oldApp);
        platformServiceMock.stop.mockClear();

        appUI.updateModuleCard('services', newApp);

        expect(platformServiceMock.stop).toHaveBeenCalledWith(oldApp);
    });

    it('should swallow stop errors when switching away from a previous module', async () => {
        appUI = createAppUI();
        platformServiceMock.stop.mockRejectedValueOnce(new Error('stop failed'));
        document.body.innerHTML = `
            <div id="services-module-card" class="selected">
                <div class="model-icon-wrapper"></div>
                <div class="model-card-title"></div>
                <div class="model-card-desc"></div>
            </div>
        `;

        const oldApp = { id: 'svc-old', name: 'Old Service', installed: true } as IApp;
        const newApp = { id: 'svc-new', name: 'New Service', installed: true } as IApp;

        (
            globalThis as unknown as {
                getCatalogCategory: ReturnType<typeof vi.fn>;
            }
        ).getCatalogCategory.mockImplementation((category: string) =>
            category === 'services' ? [oldApp, newApp] : [],
        );

        appUI.updateModuleCard('services', oldApp);

        expect(() => {
            appUI?.updateModuleCard('services', newApp);
        }).not.toThrow();

        await Promise.resolve();
    });

    it('should reset services card instead of showing an AI module when clearing services', () => {
        appUI = createAppUI();
        document.body.innerHTML = `
            <div id="services-module-card" class="selected">
                <div class="model-icon-wrapper"></div>
                <div class="model-card-title"></div>
                <div class="model-card-desc"></div>
            </div>
        `;

        const serviceApp = { id: 'svc', name: 'Service', installed: true } as IApp;
        const textApp = { id: 'ai-text', name: 'Text AI', installed: true } as IApp;

        appUI.updateModuleCard('services', serviceApp);
        appUI.updateModuleCard('ai_text', textApp);

        const card = document.getElementById('services-module-card') as HTMLElement;
        appUI.clearModuleCard('services');

        expect(card.classList.contains('empty')).toBe(true);
        expect(card.dataset['currentModule']).toBeUndefined();
    });

    it('should not stop an AI provider if the same provider remains selected in the other AI slot', () => {
        appUI = createAppUI();
        document.body.innerHTML = `
            <div id="ai-module-card" class="selected">
                <div class="model-icon-wrapper"></div>
                <div class="model-card-title"></div>
                <div class="model-card-desc"></div>
            </div>
        `;

        const sharedApp = { id: 'shared-ai', name: 'Shared AI', installed: true } as IApp;
        appUI.updateModuleCard('ai_text', sharedApp);
        appUI.updateModuleCard('ai_image', sharedApp);
        platformServiceMock.stop.mockClear();

        appUI.clearModuleCard('ai_text');

        expect(platformServiceMock.stop).not.toHaveBeenCalled();
    });

    it('should not stop the currently shown AI engine when selecting another AI slot on the shared card', () => {
        appUI = createAppUI();
        document.body.innerHTML = `
            <div id="ai-module-card" class="selected">
                <div class="model-icon-wrapper"></div>
                <div class="model-card-title"></div>
                <div class="model-card-desc"></div>
                <div class="model-card-action" data-running="true"></div>
            </div>
        `;

        const card = document.getElementById('ai-module-card') as HTMLElement;
        card.dataset['currentModule'] = 'text-model';
        card.dataset['currentModuleName'] = 'Text Model';

        const textApp = { id: 'text-model', name: 'Text Model', installed: true } as IApp;
        const imageApp = { id: 'image-model', name: 'Image Model', installed: true } as IApp;

        appUI.updateModuleCard('ai_text', textApp);
        platformServiceMock.stop.mockClear();

        appUI.updateModuleCard('ai_image', imageApp);

        expect(platformServiceMock.stop).not.toHaveBeenCalled();
    });

    it('should remove persisted selection when deselecting the same app from modal flow', () => {
        appUI = createAppUI();
        document.body.innerHTML = `
            <div id="services-module-card" class="selected">
                <div class="model-icon-wrapper"></div>
                <div class="model-card-title"></div>
                <div class="model-card-desc"></div>
            </div>
        `;

        const serviceApp = { id: 'svc', name: 'Service', installed: true } as IApp;
        appUI.updateModuleCard('services', serviceApp);

        (
            appUI as unknown as {
                _performSelectionAction: (category: string, app: IApp) => void;
            }
        )._performSelectionAction('services', serviceApp);

        const mockedGlobals = globalThis as unknown as {
            uiState: { removeSelectedModule: ReturnType<typeof vi.fn> };
        };
        expect(mockedGlobals.uiState.removeSelectedModule).toHaveBeenCalledWith('services');
    });

    it('should track the shown AI capability on the shared dashboard card', () => {
        appUI = createAppUI();
        document.body.innerHTML = `
            <div id="ai-module-card" class="empty">
                <div class="model-icon-wrapper"></div>
                <div class="model-card-title"></div>
                <div class="model-card-desc"></div>
            </div>
        `;

        const sharedApp = { id: 'shared-ai', name: 'Shared AI', installed: true } as IApp;
        appUI.updateModuleCard('ai_text', sharedApp);

        const card = document.getElementById('ai-module-card') as HTMLElement;
        expect(card.dataset['currentCapability']).toBe('ai_text');

        appUI.updateModuleCard('ai_image', sharedApp);
        expect(card.dataset['currentCapability']).toBe('ai_image');

        const resolvedCategory = (
            appUI as unknown as { _resolveCategoryFromCard: (card: HTMLElement) => string }
        )._resolveCategoryFromCard(card);
        expect(resolvedCategory).toBe('ai_image');
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
            _onModalDownloadSuccess: (btn: HTMLElement | null, app: IApp, category: string) => void;
            _onModalDownloadError: (btn: HTMLElement | null, err: unknown) => void;
            _modalManager: {
                refreshCurrentSelection: ReturnType<typeof vi.fn>;
                isViewingCategory: ReturnType<typeof vi.fn>;
            };
        };
        vi.spyOn(privateAppUI._modalManager, 'isViewingCategory').mockReturnValue(true);
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
        privateAppUI._onModalDownloadSuccess(btn, app, 'services');
        expect(app.installed).toBe(true);
        expect(btn.classList.contains('downloading')).toBe(false);
        expect(refreshSpy).toHaveBeenCalled();

        privateAppUI._onModalDownloadError(btn, new Error('broken'));
        const mockedGlobals = globalThis as unknown as { showToast: ReturnType<typeof vi.fn> };
        expect(mockedGlobals.showToast).not.toHaveBeenCalled();
    });

    it('should show a placeholder toast instead of selecting or downloading coming-soon modules', async () => {
        appUI = createAppUI();
        const toastSpy = vi.spyOn(appUI, 'showToast');

        const privateAppUI = appUI as unknown as {
            _handleAppCardClick: (e: MouseEvent, app: IApp, category: string) => Promise<void>;
        };

        const card = document.createElement('div');
        card.className = 'app-card';
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'currentTarget', { value: card });

        const app = {
            id: 'future-image',
            name: 'Future Image',
            installed: false,
            comingSoon: true,
        } as IApp;

        await privateAppUI._handleAppCardClick(event, app, 'ai_image');

        const mockedGlobals = globalThis as unknown as {
            launchApp: ReturnType<typeof vi.fn>;
        };
        expect(toastSpy).toHaveBeenCalled();
        expect(platformServiceMock.download).not.toHaveBeenCalled();
        expect(mockedGlobals.launchApp).not.toHaveBeenCalled();
    });

    it('should stop stale launched module after quick reselection', async () => {
        appUI = createAppUI();

        let releaseFirstLaunch!: () => void;
        const firstLaunchPromise = new Promise<void>((resolve) => {
            releaseFirstLaunch = resolve;
        });
        const launchApp = vi
            .fn<(...args: [string]) => Promise<void>>()
            .mockImplementationOnce(async () => firstLaunchPromise)
            .mockResolvedValueOnce(undefined);
        (globalThis as unknown as { launchApp: typeof launchApp }).launchApp = launchApp;

        const privateAppUI = appUI as unknown as {
            _performSelectionAction: (category: string, app: IApp) => void;
        };
        const firstApp = {
            id: 'svc-a',
            name: 'Service A',
            type: 'local',
            icon: 'A',
            desc: 'A',
            installed: true,
        } as IApp;
        const secondApp = {
            id: 'svc-b',
            name: 'Service B',
            type: 'local',
            icon: 'B',
            desc: 'B',
            installed: true,
        } as IApp;

        document.body.innerHTML = `
            <div id="services-module-card" class="empty">
                <div class="model-icon-wrapper"></div>
                <div class="model-card-title"></div>
                <div class="model-card-desc"></div>
            </div>
        `;

        privateAppUI._performSelectionAction('services', firstApp);
        privateAppUI._performSelectionAction('services', secondApp);

        releaseFirstLaunch();
        await Promise.resolve();
        await Promise.resolve();

        expect(launchApp).toHaveBeenNthCalledWith(1, 'svc-a');
        expect(launchApp).toHaveBeenNthCalledWith(2, 'svc-b');
        expect(platformServiceMock.stop).toHaveBeenCalledWith(firstApp);
    });

    it('should not reopen modal after delete if app selection was already closed', async () => {
        appUI = createAppUI();

        const privateAppUI = appUI as unknown as {
            _handleDeleteModule: (app: IApp, category: string) => Promise<void>;
            _modalManager: { isAppSelectionOpen: () => boolean };
        };

        vi.spyOn(privateAppUI._modalManager, 'isAppSelectionOpen').mockReturnValue(false);
        const reopenSpy = vi.spyOn(appUI, 'openAppSelection');

        platformServiceMock.delete.mockResolvedValue(undefined);
        (
            globalThis as unknown as {
                getCatalogCategory: ReturnType<typeof vi.fn>;
            }
        ).getCatalogCategory.mockReturnValue([{ id: 'svc', name: 'Service', installed: false }]);

        await privateAppUI._handleDeleteModule(
            { id: 'svc', name: 'Service', installed: true } as IApp,
            'services',
        );

        expect(reopenSpy).not.toHaveBeenCalled();
    });

    it('should reopen modal after delete when app selection is still open', async () => {
        appUI = createAppUI();

        const privateAppUI = appUI as unknown as {
            _handleDeleteModule: (app: IApp, category: string) => Promise<void>;
            _modalManager: { isAppSelectionOpen: () => boolean };
        };

        vi.spyOn(privateAppUI._modalManager, 'isAppSelectionOpen').mockReturnValue(true);
        const reopenSpy = vi.spyOn(appUI, 'openAppSelection');

        platformServiceMock.delete.mockResolvedValue(undefined);
        const refreshedApps = [{ id: 'svc', name: 'Service', installed: false }] as IApp[];
        (
            globalThis as unknown as {
                getCatalogCategory: ReturnType<typeof vi.fn>;
            }
        ).getCatalogCategory.mockReturnValue(refreshedApps);

        await privateAppUI._handleDeleteModule(
            { id: 'svc', name: 'Service', installed: true } as IApp,
            'services',
        );

        expect(reopenSpy).toHaveBeenCalledWith('services', refreshedApps);
    });

    it('should not refresh modal after download success when viewing another category', () => {
        appUI = createAppUI();

        const privateAppUI = appUI as unknown as {
            _onModalDownloadSuccess: (btn: HTMLElement | null, app: IApp, category: string) => void;
            _modalManager: {
                isViewingCategory: (category: string) => boolean;
                refreshCurrentSelection: () => void;
            };
        };

        vi.spyOn(privateAppUI._modalManager, 'isViewingCategory').mockReturnValue(false);
        const refreshSpy = vi.spyOn(privateAppUI._modalManager, 'refreshCurrentSelection');

        const btn = document.createElement('button');
        btn.className = 'download-btn downloading indeterminate';
        const app = { id: 'local-app', name: 'Local App', installed: false } as IApp;

        privateAppUI._onModalDownloadSuccess(btn, app, 'services');

        expect(app.installed).toBe(true);
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('should resolve app by id from injected catalog resolver', () => {
        appUI = createAppUI();
        (
            globalThis as unknown as {
                getCatalogCategory: ReturnType<typeof vi.fn>;
            }
        ).getCatalogCategory.mockImplementation((category: string) =>
            category === 'services' ? [{ id: 'svc', name: 'Service', installed: true }] : [],
        );

        const resolved = (
            appUI as unknown as { _resolveAppById: (appId: string) => IApp | undefined }
        )._resolveAppById('svc');

        expect(resolved?.id).toBe('svc');
    });
});
