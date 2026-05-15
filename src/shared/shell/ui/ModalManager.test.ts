import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalManager } from './ModalManager';
import { ModuleCardRenderer } from './ModuleCardRenderer';
import { ModalSelectionPolicy } from './ModalSelectionPolicy';
import type { IntegrationImportAction } from './ModalManagerSupport';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { IApp } from '../../types/coreTypes';
import { CUSTOM_TEXT_PROVIDER_ID } from '../../utils/customProviderSupport';

describe('ModalManager lifecycle', () => {
    let modalManager: ModalManager | null = null;
    let interactionSpy: ReturnType<typeof vi.fn>;
    let navigation: NavigationService;
    let tracer: LoggerService;

    beforeEach(() => {
        document.body.innerHTML = `
            <dialog id="app-selection-modal" class="hidden">
                <div class="app-modal">
                    <div class="app-modal-main">
                        <div class="app-modal-header">
                            <div id="app-modal-title"></div>
                            <div id="app-modal-tab-row" class="hidden">
                                <button id="filter-text-btn" type="button">Text</button>
                                <button id="filter-image-btn" type="button">Image</button>
                            </div>
                            <button id="close-app-selection-btn" class="app-close-btn" type="button">Close</button>
                        </div>
                        <div class="app-modal-body">
                            <div id="app-modal-list"></div>
                        </div>
                    </div>
                </div>
            </dialog>
            <div class="models-container"></div>
            <div id="app-modal-sidebar">
                <button class="category-filter-btn"><span>Text models</span></button>
                <button class="category-filter-btn"><span>Image models wide title</span></button>
            </div>
            <template id="tpl-empty-state-module"><span></span></template>
            <template id="tpl-module-card">
                <div class="module-selection-card-icon"></div>
                <div class="module-selection-card-title"></div>
                <div class="module-selection-card-description"></div>
            </template>
        `;

        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement | null;
        if (!(modal instanceof HTMLElement)) {
            throw new Error('Modal root not mounted');
        }

        (modal as HTMLDialogElement).show = vi.fn(() => {
            modal.setAttribute('open', '');
        });
        (modal as HTMLDialogElement).showModal = vi.fn(() => {
            modal.setAttribute('open', '');
        });
        (modal as HTMLDialogElement).close = vi.fn(() => {
            modal.removeAttribute('open');
        });

        (
            globalThis as unknown as { aiBridge: { getState: () => Record<string, never> } }
        ).aiBridge = {
            getState: () => ({}),
        };
        interactionSpy = vi.fn();
        tracer = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as unknown as LoggerService;
        navigation = {
            pushBackAction: vi.fn(),
            removeBackAction: vi.fn(),
        } as unknown as NavigationService;
    });

    afterEach(() => {
        modalManager?.destroy();
        modalManager = null;
        vi.useRealTimers();
    });

    function createManager(
        onFilterChange?: (capability: 'text' | 'image') => string | null,
        onIntegrationImport?: (action: IntegrationImportAction) => void,
    ) {
        return new ModalManager(
            new ModuleCardRenderer({ translate: (_key, fallback) => fallback, tracer }),
            interactionSpy as unknown as (e: MouseEvent, app: IApp, category: string) => void,
            onFilterChange ?? (() => null),
            vi.fn().mockResolvedValue(undefined),
            vi.fn().mockResolvedValue(undefined),
            (_key, fallback) => fallback,
            tracer,
            navigation,
            undefined,
            undefined,
            onIntegrationImport,
        );
    }

    it('should not accumulate overlay click listeners across reopen cycles', () => {
        modalManager = createManager();

        modalManager.openAppSelection('services', []);
        modalManager.closeAppSelection();
        modalManager.openAppSelection('services', []);

        expect(document.body.classList.contains('app-selection-open')).toBe(true);

        const closeSpy = vi.spyOn(modalManager, 'closeAppSelection');
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement;
        modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('should render integration import actions for empty services lists', () => {
        const importSpy = vi.fn();
        modalManager = createManager(undefined, importSpy);

        modalManager.openAppSelection('services', []);

        const importCard = document.querySelector<HTMLElement>('.integration-import-card');
        expect(importCard).not.toBeNull();
        if (importCard === null) throw new Error('integration import card missing');
        expect(document.querySelector('.app-modal-empty-state')).toBeNull();

        const actionButtons = document.querySelectorAll<HTMLButtonElement>(
            '.integration-import-action-btn',
        );
        expect(actionButtons).toHaveLength(2);
        const [openButton, linkButton] = Array.from(actionButtons);
        if (openButton === undefined || linkButton === undefined) {
            throw new Error('integration import buttons missing');
        }

        openButton.click();
        linkButton.click();
        const helpBadge = document.querySelector<HTMLButtonElement>('.integration-help-badge');
        expect(helpBadge).not.toBeNull();
        if (helpBadge === null) throw new Error('integration help badge missing');
        expect(helpBadge.querySelector('.badge-icon')?.textContent).toBe('?');
        helpBadge.click();
        importCard.click();

        expect(importSpy).toHaveBeenNthCalledWith(1, 'local');
        expect(importSpy).toHaveBeenNthCalledWith(2, 'url');
        expect(importSpy).toHaveBeenNthCalledWith(3, 'guide');
        expect(importSpy).toHaveBeenNthCalledWith(4, 'archive');
    });

    it('should rerender services selection when refresh receives an empty app list', () => {
        modalManager = createManager();

        modalManager.openAppSelection('services', [
            { id: 'parser', name: 'Parser', installed: true } as IApp,
        ]);
        expect(document.querySelector('[data-app-id="parser"]')).not.toBeNull();

        modalManager.refreshCurrentSelection([], null);

        expect(document.querySelector('[data-app-id="parser"]')).toBeNull();
        expect(document.querySelector('.integration-import-card')).not.toBeNull();
        expect(document.querySelector('.app-modal-empty-state')).toBeNull();
    });

    it('should switch filters without leaving transient list styles', () => {
        vi.useFakeTimers();

        modalManager = createManager((capability) =>
            capability === 'image' ? 'image-model' : 'text-model',
        );

        const populateSpy = vi.spyOn(
            modalManager as unknown as { _populateAppList: (...args: unknown[]) => void },
            '_populateAppList',
        );
        const apps = [
            {
                id: 'text-model',
                name: 'Text Model',
                type: 'local',
                capability: 'text',
                installed: true,
            },
            {
                id: 'image-model',
                name: 'Image Model',
                type: 'local',
                capability: 'image',
                installed: true,
            },
        ] as IApp[];

        modalManager.openAppSelection('ai_text', apps, 'text-model');

        const imageBtn = document.getElementById('filter-image-btn') as HTMLButtonElement;
        imageBtn.click();
        modalManager.closeAppSelection();
        vi.advanceTimersByTime(200);

        const listEl = document.getElementById('app-modal-list') as HTMLElement;

        expect(populateSpy).toHaveBeenCalledTimes(2);
        expect(listEl.style.opacity).toBe('');
        expect(listEl.style.transform).toBe('');
    });

    it('should render ai tabs, filter apps and refresh current selection', () => {
        modalManager = createManager((capability) => (capability === 'image' ? 'img-1' : 'txt-1'));
        const apps = [
            { id: 'txt-1', name: 'Text Model', installed: true, capability: 'text' },
            { id: 'img-1', name: 'Image Model', installed: true, capability: 'image' },
        ] as IApp[];

        modalManager.openAppSelection('ai_image', apps, 'img-1');

        const title = document.getElementById('app-modal-title') as HTMLElement;
        const tabRow = document.getElementById('app-modal-tab-row') as HTMLElement;
        expect(title.classList.contains('hidden')).toBe(true);
        expect(tabRow.classList.contains('hidden')).toBe(false);
        expect(document.querySelectorAll('#app-modal-list .app-card')).toHaveLength(1);
        expect(navigation.pushBackAction).toHaveBeenCalled();

        (document.getElementById('filter-text-btn') as HTMLButtonElement).click();
        expect(document.querySelectorAll('#app-modal-list .app-card')).toHaveLength(1);

        modalManager.refreshCurrentSelection();
        expect(navigation.pushBackAction).toHaveBeenCalledTimes(1);
        expect(
            (document.getElementById('app-selection-modal') as HTMLDialogElement).show,
        ).toHaveBeenCalledTimes(1);
    });

    it('should refresh using newly provided app snapshots', () => {
        modalManager = createManager();
        modalManager.openAppSelection(
            'services',
            [{ id: 'svc-a', name: 'Service A', installed: false } as IApp],
            'svc-a',
        );

        modalManager.refreshCurrentSelection(
            [{ id: 'svc-b', name: 'Service B', installed: true } as IApp],
            'svc-b',
        );

        expect(
            document.querySelectorAll('#app-modal-list .app-card:not(.integration-import-card)'),
        ).toHaveLength(1);
        expect(
            (
                document.querySelector(
                    '#app-modal-list .app-card:not(.integration-import-card)',
                ) as HTMLElement | null
            )?.dataset['appId'],
        ).toBe('svc-b');
        expect(document.querySelector('#app-modal-list .modal-btn')?.textContent).toBe('Remove');
    });

    it('should rerender current selection without reopening modal shell', () => {
        modalManager = createManager();
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement;

        modalManager.openAppSelection(
            'services',
            [{ id: 'svc-a', name: 'Service A', installed: false } as IApp],
            'svc-a',
        );
        modalManager.refreshCurrentSelection(
            [{ id: 'svc-b', name: 'Service B', installed: false } as IApp],
            'svc-b',
        );

        expect(modal.show).toHaveBeenCalledTimes(1);
        expect(navigation.pushBackAction).toHaveBeenCalledTimes(1);
        expect(
            (document.querySelector('#app-modal-list .app-card') as HTMLElement | null)?.dataset[
                'appId'
            ],
        ).toBe('svc-b');
    });

    it('should keep the shared modal height for up to four visible cards', () => {
        modalManager = createManager();
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement;

        Object.defineProperty(globalThis, 'innerWidth', {
            configurable: true,
            value: 1600,
        });
        Object.defineProperty(globalThis, 'innerHeight', {
            configurable: true,
            value: 1200,
        });

        modalManager.openAppSelection(
            'services',
            [
                { id: 'svc-a', name: 'Service A', installed: true } as IApp,
                { id: 'svc-b', name: 'Service B', installed: true } as IApp,
            ],
            'svc-a',
        );

        expect(modal.style.getPropertyValue('--app-modal-dynamic-height')).toBe('');
    });

    it('should restore default modal height when more than four cards are visible', () => {
        modalManager = createManager();
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement;

        modalManager.openAppSelection(
            'services',
            [
                { id: 'svc-a', name: 'Service A', installed: true } as IApp,
                { id: 'svc-b', name: 'Service B', installed: true } as IApp,
                { id: 'svc-c', name: 'Service C', installed: true } as IApp,
                { id: 'svc-d', name: 'Service D', installed: true } as IApp,
                { id: 'svc-e', name: 'Service E', installed: true } as IApp,
            ],
            'svc-a',
        );

        expect(modal.style.getPropertyValue('--app-modal-dynamic-height')).toBe('');
    });

    it('should not re-show modal or duplicate back action when reopening an already open modal', () => {
        modalManager = createManager();
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement;
        const apps = [{ id: 'svc', name: 'Service', installed: true } as IApp];

        modalManager.openAppSelection('services', apps, 'svc');
        modalManager.openAppSelection('services', apps, 'svc');

        expect(modal.show).toHaveBeenCalledTimes(1);
        expect(navigation.pushBackAction).toHaveBeenCalledTimes(1);
    });

    it('should suspend and resume app selection without exposing the dashboard', () => {
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn((callback: FrameRequestCallback) => {
                callback(0);
                return 0;
            }),
        );
        modalManager = createManager();
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement;
        const container = document.querySelector('.models-container') as HTMLElement;

        modalManager.openAppSelection(
            'services',
            [{ id: 'svc-a', name: 'Service A', installed: true } as IApp],
            'svc-a',
        );

        expect(modalManager.suspendAppSelection()).toBe(true);
        expect(modal.open).toBe(true);
        expect(modal.classList.contains('hidden')).toBe(false);
        expect(modal.style.visibility).toBe('hidden');
        expect(document.body.classList.contains('app-selection-open')).toBe(true);
        expect(container.classList.contains('content-hidden')).toBe(true);

        modalManager.resumeAppSelection();

        expect(modal.style.visibility).toBe('');
        expect(document.body.classList.contains('app-selection-open')).toBe(true);
        expect(container.classList.contains('content-hidden')).toBe(true);
        expect(navigation.removeBackAction).not.toHaveBeenCalledWith('app-selection-modal');
    });

    it('should clear page-hidden state after closing app selection', () => {
        modalManager = createManager();

        modalManager.openAppSelection(
            'services',
            [{ id: 'svc-a', name: 'Service A', installed: true } as IApp],
            'svc-a',
        );
        expect(document.body.classList.contains('app-selection-open')).toBe(true);

        modalManager.closeAppSelection();

        expect(document.body.classList.contains('app-selection-open')).toBe(false);
        expect(
            document.querySelector('.models-container')?.classList.contains('content-hidden'),
        ).toBe(false);
    });

    it('disables tab focus movement inside the app selection modal', () => {
        modalManager = createManager();
        const outsideButton = document.createElement('button');
        outsideButton.textContent = 'Outside';
        document.body.appendChild(outsideButton);

        modalManager.openAppSelection(
            'services',
            [{ id: 'svc-a', name: 'Service A', installed: true } as IApp],
            'svc-a',
        );

        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement;
        const closeButton = document.getElementById('close-app-selection-btn') as HTMLButtonElement;
        const modalAction = document.querySelector(
            '#app-modal-list .module-selection-card-actions button',
        ) as HTMLButtonElement;

        expect(document.activeElement).toBe(document.body);

        modalAction.focus();
        const tabEvent = new KeyboardEvent('keydown', {
            key: 'Tab',
            bubbles: true,
            cancelable: true,
        });
        modal.dispatchEvent(tabEvent);
        expect(tabEvent.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(document.body);

        outsideButton.focus();
        const focusInEvent = new FocusEvent('focusin', {
            bubbles: true,
        });
        Object.defineProperty(focusInEvent, 'target', {
            configurable: true,
            value: outsideButton,
        });
        document.dispatchEvent(focusInEvent);
        expect(document.activeElement).toBe(document.body);
        expect(closeButton).toBeInstanceOf(HTMLButtonElement);
    });

    it('should preserve current selection when replaying modal back action', () => {
        modalManager = createManager();
        const apps = [
            { id: 'svc-a', name: 'Service A', installed: true } as IApp,
            { id: 'svc-b', name: 'Service B', installed: true } as IApp,
        ];

        modalManager.openAppSelection('services', apps, 'svc-a');
        modalManager.updateSelection('svc-b');

        const reopen = vi.mocked(navigation.pushBackAction).mock.calls[0]?.[2] as
            | (() => void)
            | undefined;
        expect(reopen).toBeTypeOf('function');

        modalManager.closeAppSelection();
        reopen?.();

        expect(document.querySelector('[data-app-id="svc-b"] .modal-btn')?.textContent).toBe(
            'Remove',
        );
        expect(
            document
                .querySelector('[data-app-id="svc-b"] .modal-btn')
                ?.classList.contains('modal-btn-secondary'),
        ).toBe(true);
    });

    it('should disable image filter and render empty state for unsupported apps', () => {
        modalManager = createManager();
        modalManager.openAppSelection(
            'ai',
            [{ id: 'txt-1', name: 'Only Text', installed: true, capability: 'text' } as IApp],
            'txt-1',
        );

        (modalManager as unknown as { _currentFilter: 'text' | 'image' })._currentFilter = 'image';
        (
            modalManager as unknown as {
                _applyImageFilterAvailability: (
                    apps: IApp[],
                    t: (key: string, defaultText: string) => string,
                ) => void;
            }
        )._applyImageFilterAvailability(
            [{ id: 'txt-1', name: 'Only Text', installed: true, capability: 'text' } as IApp],
            (_key, defaultText) => defaultText,
        );

        const imageBtn = document.getElementById('filter-image-btn') as HTMLButtonElement;
        const textBtn = document.getElementById('filter-text-btn') as HTMLButtonElement;
        expect(imageBtn.disabled).toBe(true);
        expect(imageBtn.title).toBe('Coming soon');
        expect(textBtn.classList.contains('active')).toBe(true);
        expect(imageBtn.classList.contains('active')).toBe(false);

        (
            modalManager as unknown as { _populateAppList: (...args: unknown[]) => void }
        )._populateAppList(
            document.getElementById('app-modal-list') as HTMLElement,
            [{ id: 'txt-1', name: 'Only Text', installed: true, capability: 'text' } as IApp],
            'ai',
            null,
        );
        expect(document.querySelectorAll('#app-modal-list .app-card')).toHaveLength(1);
        expect(
            (document.querySelector('#app-modal-list .app-card') as HTMLElement | null)?.dataset[
                'appId'
            ],
        ).toBe('txt-1');
    });

    it('should sort by stable module id priority instead of localized names', () => {
        const policy = new ModalSelectionPolicy();
        const sorted = policy.getVisibleApps(
            [
                { id: 'custom', name: 'A Localized Name', installed: true } as IApp,
                { id: 'gemini', name: 'ZZZ localized', installed: true } as IApp,
                { id: 'gpt', name: 'YYY localized', installed: true } as IApp,
            ],
            'services',
            'text',
        );

        expect(sorted.map((app) => app.id)).toEqual(['gpt', 'gemini', 'custom']);
    });

    it('should place custom providers after cloud apis but before local engines', () => {
        const policy = new ModalSelectionPolicy();
        const sorted = policy.getVisibleApps(
            [
                { id: 'llamacpp', name: 'llama.cpp', type: 'local', installed: true } as IApp,
                {
                    id: CUSTOM_TEXT_PROVIDER_ID,
                    name: 'Custom',
                    type: 'api',
                    installed: true,
                } as IApp,
                { id: 'claude', name: 'Claude', type: 'api', installed: true } as IApp,
            ],
            'ai',
            'text',
        );

        expect(sorted.map((app) => app.id)).toEqual([
            'claude',
            CUSTOM_TEXT_PROVIDER_ID,
            'llamacpp',
        ]);
    });

    it('should react to download progress events and update selection labels', () => {
        modalManager = createManager();
        const list = document.getElementById('app-modal-list') as HTMLElement;
        list.innerHTML = `
            <div class="app-card selected engine-ready" data-app-id="gpt">
                <div class="module-selection-card-actions"><button class="modal-btn">Select</button></div>
                <button class="download-btn"><span class="download-label">Download</span><span class="download-pct"></span></button>
            </div>
            <div class="app-card" data-app-id="gemini">
                <div class="module-selection-card-actions"><button class="modal-btn">Select</button></div>
            </div>
        `;
        (
            globalThis as unknown as { aiBridge: { getState: () => { activeProviderId: string } } }
        ).aiBridge = {
            getState: () => ({ activeProviderId: 'gpt' }),
        };
        (
            modalManager as unknown as { _currentSelectedAppId: string | null }
        )._currentSelectedAppId = 'gpt';

        modalManager.updateSelection('gemini');
        expect(document.querySelector('[data-app-id="gpt"]')?.classList.contains('selected')).toBe(
            false,
        );
        expect(document.querySelector('[data-app-id="gemini"] .modal-btn')?.textContent).toBe(
            'Remove',
        );
        expect(
            document
                .querySelector('[data-app-id="gemini"] .modal-btn')
                ?.classList.contains('modal-btn-secondary'),
        ).toBe(true);

        globalThis.dispatchEvent(
            new CustomEvent('download-progress-update', {
                detail: { module_id: 'gpt', status: 'downloading', progress: 0.42 },
            }),
        );
        expect(
            document
                .querySelector('[data-app-id="gpt"] .download-btn')
                ?.classList.contains('downloading'),
        ).toBe(true);

        globalThis.dispatchEvent(
            new CustomEvent('download-progress-update', {
                detail: { module_id: 'gpt', status: 'complete', progress: 1 },
            }),
        );
        expect(
            document.querySelector('[data-app-id="gpt"]')?.classList.contains('is-installed'),
        ).toBe(true);
    });

    it('should route modal progress updates for app ids that need selector escaping', () => {
        modalManager = createManager();
        const list = document.getElementById('app-modal-list') as HTMLElement;
        const appId = 'svc"quoted\\id';
        const card = document.createElement('div');
        card.className = 'app-card';
        card.dataset['appId'] = appId;
        const button = document.createElement('button');
        button.className = 'download-btn';
        button.innerHTML =
            '<span class="download-label">Download</span><span class="download-pct"></span>';
        card.appendChild(button);
        list.appendChild(card);

        globalThis.dispatchEvent(
            new CustomEvent('download-progress-update', {
                detail: { module_id: appId, status: 'downloading', progress: 0.42 },
            }),
        );

        expect(button.classList.contains('downloading')).toBe(true);
        expect(button.querySelector('.download-pct')?.textContent).toBe('42%');
    });

    it('should cancel and start downloads through injected callbacks', async () => {
        const onDownloadRequest = vi.fn().mockResolvedValue(undefined);
        const onCancelDownloadRequest = vi.fn().mockResolvedValue(undefined);
        modalManager = new ModalManager(
            new ModuleCardRenderer({ translate: (_key, fallback) => fallback, tracer }),
            interactionSpy as unknown as (e: MouseEvent, app: IApp, category: string) => void,
            () => null,
            onDownloadRequest,
            onCancelDownloadRequest,
            (_key, fallback) => fallback,
            tracer,
            navigation,
        );

        const list = document.getElementById('app-modal-list') as HTMLElement;
        list.innerHTML = `
            <div class="app-card" data-app-id="gpt">
                <button class="download-btn downloading">
                    <span class="download-label" style="display:none">Downloading</span>
                    <span class="download-pct" style="display:block">42%</span>
                </button>
            </div>
        `;

        const handleDownload = (modalManager as unknown as { _handleDownload: (app: IApp) => void })
            ._handleDownload;
        handleDownload.call(modalManager, {
            id: 'gpt',
            name: 'GPT',
            installed: false,
            repoUrl: 'https://example.com/repo.zip',
        } as IApp);
        await Promise.resolve();
        await Promise.resolve();

        expect(onCancelDownloadRequest).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'gpt' }),
        );
        expect(document.querySelector('.download-label')?.textContent).toBe('Download');

        modalManager.openAppSelection('services', []);
        list.innerHTML = `<div class="app-card" data-app-id="svc"><button class="download-btn"></button></div>`;
        handleDownload.call(modalManager, {
            id: 'svc',
            name: 'Service',
            installed: false,
            repoUrl: 'https://example.com/service.zip',
            expectedHash: 'abc',
            dlType: 'github',
        } as IApp);
        expect(onDownloadRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'svc',
                repoUrl: 'https://example.com/service.zip',
                expectedHash: 'abc',
                dlType: 'github',
            }),
            'services',
            expect.any(HTMLButtonElement),
        );
    });

    it('should start modal downloads for app ids that need selector escaping', () => {
        const onDownloadRequest = vi.fn().mockResolvedValue(undefined);
        modalManager = new ModalManager(
            new ModuleCardRenderer({ translate: (_key, fallback) => fallback, tracer }),
            interactionSpy as unknown as (e: MouseEvent, app: IApp, category: string) => void,
            () => null,
            onDownloadRequest,
            vi.fn().mockResolvedValue(undefined),
            (_key, fallback) => fallback,
            tracer,
            navigation,
        );

        modalManager.openAppSelection('services', []);
        const list = document.getElementById('app-modal-list') as HTMLElement;
        const appId = 'svc"quoted\\id';
        const card = document.createElement('div');
        card.className = 'app-card';
        card.dataset['appId'] = appId;
        const button = document.createElement('button');
        button.className = 'download-btn';
        card.appendChild(button);
        list.appendChild(card);

        const handleDownload = (modalManager as unknown as { _handleDownload: (app: IApp) => void })
            ._handleDownload;
        handleDownload.call(modalManager, {
            id: appId,
            name: 'Service',
            installed: false,
            repoUrl: 'https://example.com/service.zip',
        } as IApp);

        expect(onDownloadRequest).toHaveBeenCalledWith(
            expect.objectContaining({ id: appId }),
            'services',
            button,
        );
    });

    it('should pause and resume active modal downloads through injected callbacks', () => {
        const onPauseDownloadRequest = vi.fn().mockResolvedValue(undefined);
        const onResumeDownloadRequest = vi.fn().mockResolvedValue(undefined);
        modalManager = new ModalManager(
            new ModuleCardRenderer({ translate: (_key, fallback) => fallback, tracer }),
            interactionSpy as unknown as (e: MouseEvent, app: IApp, category: string) => void,
            () => null,
            vi.fn().mockResolvedValue(undefined),
            vi.fn().mockResolvedValue(undefined),
            (_key, fallback) => fallback,
            tracer,
            navigation,
            onPauseDownloadRequest,
            onResumeDownloadRequest,
        );

        const list = document.getElementById('app-modal-list') as HTMLElement;
        list.innerHTML = `
            <div class="app-card" data-app-id="gpt">
                <button class="download-btn downloading" data-resume-label="Resume" data-pause-label="Pause">
                    <span class="download-hover-action-pause">Pause</span>
                </button>
            </div>
        `;

        const handleDownload = (
            modalManager as unknown as {
                _handleDownload: (app: IApp, action: 'pause' | 'resume') => void;
            }
        )._handleDownload;
        const app = {
            id: 'gpt',
            name: 'GPT',
            installed: false,
            repoUrl: 'https://example.com/repo.zip',
        } as IApp;

        handleDownload.call(modalManager, app, 'pause');
        const pauseAction = document.querySelector('.download-hover-action-pause');
        expect(onPauseDownloadRequest).toHaveBeenCalledWith(expect.objectContaining({ id: 'gpt' }));
        expect(
            document.querySelector<HTMLElement>('.download-btn')?.dataset['downloadStatus'],
        ).toBe('paused');
        expect(pauseAction?.textContent).toBe('Resume');

        handleDownload.call(modalManager, app, 'resume');
        expect(onResumeDownloadRequest).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'gpt' }),
        );
        expect(
            document.querySelector<HTMLElement>('.download-btn')?.dataset['downloadStatus'],
        ).toBe('downloading');
        expect(pauseAction?.textContent).toBe('Pause');
    });

    it('should handle missing repo and dynamic sidebar widths', () => {
        modalManager = createManager();
        const handleDownload = (modalManager as unknown as { _handleDownload: (app: IApp) => void })
            ._handleDownload;

        handleDownload.call(modalManager, { id: 'empty', name: 'Empty', installed: false } as IApp);

        const spans = document.querySelectorAll<HTMLElement>(
            '#app-modal-sidebar .category-filter-btn span',
        );
        Object.defineProperty(spans[0], 'scrollWidth', { configurable: true, value: 80 });
        Object.defineProperty(spans[1], 'scrollWidth', { configurable: true, value: 140 });
        (
            modalManager as unknown as { _updateDynamicSidebarWidth: () => void }
        )._updateDynamicSidebarWidth();

        const sidebar = document.getElementById('app-modal-sidebar') as HTMLElement;
        expect(sidebar.style.getPropertyValue('--sidebar-expanded-width')).not.toBe('');
        expect(sidebar.style.getPropertyValue('--filter-btn-expanded-width')).not.toBe('');
    });
});
