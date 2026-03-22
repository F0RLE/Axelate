import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalManager } from './ModalManager';
import { ModuleCardRenderer } from './ModuleCardRenderer';
import type { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { IApp } from '../../types/coreTypes';

describe('ModalManager lifecycle', () => {
    let modalManager: ModalManager | null = null;
    let interactionSpy: ReturnType<typeof vi.fn>;
    let navigation: NavigationService;

    beforeEach(() => {
        document.body.innerHTML = `
            <dialog id="app-selection-modal" class="hidden"></dialog>
            <div class="models-container"></div>
            <div id="app-modal-title"></div>
            <div id="app-modal-sidebar">
                <button class="category-filter-btn"><span>Text models</span></button>
                <button class="category-filter-btn"><span>Image models wide title</span></button>
            </div>
            <div id="app-modal-tab-row" class="hidden">
                <button id="filter-text-btn" type="button">Text</button>
                <button id="filter-image-btn" type="button">Image</button>
            </div>
            <div id="app-modal-list"></div>
            <template id="tpl-empty-state-module"><span></span></template>
            <template id="tpl-module-card">
                <div class="app-icon-wrapper"></div>
                <div class="app-card-title"></div>
                <div class="app-card-desc"></div>
            </template>
        `;

        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement | null;
        if (!(modal instanceof HTMLElement)) {
            throw new Error('Modal root not mounted');
        }

        (modal as HTMLDialogElement).showModal = vi.fn(() => {
            modal.setAttribute('open', '');
        });
        (modal as HTMLDialogElement).close = vi.fn(() => {
            modal.removeAttribute('open');
        });

        (
            globalThis as unknown as {
                t: (key: string, fallback: string) => string;
                aiBridge: { getState: () => Record<string, never> };
            }
        ).t = (_key, fallback) => fallback;
        (
            globalThis as unknown as { aiBridge: { getState: () => Record<string, never> } }
        ).aiBridge = {
            getState: () => ({}),
        };
        interactionSpy = vi.fn();
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

    function createManager(onFilterChange?: (capability: 'text' | 'image') => string | null) {
        return new ModalManager(
            new ModuleCardRenderer(),
            interactionSpy as unknown as (e: MouseEvent, app: IApp, category: string) => void,
            onFilterChange ?? (() => null),
            navigation,
        );
    }

    it('should not accumulate overlay click listeners across reopen cycles', () => {
        modalManager = createManager();

        modalManager.openAppSelection('services', []);
        modalManager.closeAppSelection();
        modalManager.openAppSelection('services', []);

        const closeSpy = vi.spyOn(modalManager, 'closeAppSelection');
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement;
        modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('should cancel pending filter transition when the modal closes', () => {
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

        expect(populateSpy).toHaveBeenCalledTimes(1);
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
            (document.getElementById('app-selection-modal') as HTMLDialogElement).showModal,
        ).toHaveBeenCalledTimes(1);
    });

    it('should not re-show modal or duplicate back action when reopening an already open modal', () => {
        modalManager = createManager();
        const modal = document.getElementById('app-selection-modal') as HTMLDialogElement;
        const apps = [{ id: 'svc', name: 'Service', installed: true } as IApp];

        modalManager.openAppSelection('services', apps, 'svc');
        modalManager.openAppSelection('services', apps, 'svc');

        expect(modal.showModal).toHaveBeenCalledTimes(1);
        expect(navigation.pushBackAction).toHaveBeenCalledTimes(1);
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

        const imageBtn = document.getElementById('filter-image-btn') as HTMLButtonElement;
        expect(imageBtn.disabled).toBe(true);
        expect(imageBtn.title).toBe('Coming soon');

        (modalManager as unknown as { _currentFilter: 'text' | 'image' })._currentFilter = 'image';
        (
            modalManager as unknown as { _populateAppList: (...args: unknown[]) => void }
        )._populateAppList(
            document.getElementById('app-modal-list') as HTMLElement,
            [{ id: 'txt-1', name: 'Only Text', installed: true, capability: 'text' } as IApp],
            'ai',
            null,
        );
        expect(document.querySelector('#app-modal-list span')?.textContent).toContain(
            'No applications found',
        );
    });

    it('should sort by stable module id priority instead of localized names', () => {
        modalManager = createManager();

        const sorted = (
            modalManager as unknown as { _getSortedApps: (apps: IApp[]) => IApp[] }
        )._getSortedApps([
            { id: 'custom', name: 'A Localized Name', installed: true } as IApp,
            { id: 'gemini', name: 'ZZZ localized', installed: true } as IApp,
            { id: 'gpt', name: 'YYY localized', installed: true } as IApp,
        ]);

        expect(sorted.map((app) => app.id)).toEqual(['gpt', 'gemini', 'custom']);
    });

    it('should react to download progress events and update selection labels', () => {
        modalManager = createManager();
        const list = document.getElementById('app-modal-list') as HTMLElement;
        list.innerHTML = `
            <div class="app-card selected engine-ready" data-app-id="gpt">
                <div class="app-card-hover-actions"><button class="modal-btn">Select</button></div>
                <button class="download-btn"><span class="download-label">Download</span><span class="download-pct"></span></button>
            </div>
            <div class="app-card" data-app-id="gemini">
                <div class="app-card-hover-actions"><button class="modal-btn">Select</button></div>
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

    it('should cancel and start downloads through the global bridge helpers', async () => {
        modalManager = createManager();
        (
            globalThis as unknown as {
                cancelDownloadModule: ReturnType<typeof vi.fn>;
                deleteModule: ReturnType<typeof vi.fn>;
                downloadModule: ReturnType<typeof vi.fn>;
                t: (key: string, fallback: string) => string;
            }
        ).cancelDownloadModule = vi.fn().mockResolvedValue(undefined);
        (
            globalThis as unknown as {
                deleteModule: ReturnType<typeof vi.fn>;
            }
        ).deleteModule = vi.fn().mockResolvedValue(undefined);
        (
            globalThis as unknown as {
                downloadModule: ReturnType<typeof vi.fn>;
            }
        ).downloadModule = vi.fn().mockResolvedValue(undefined);

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

        expect(
            (globalThis as unknown as { cancelDownloadModule: ReturnType<typeof vi.fn> })
                .cancelDownloadModule,
        ).toHaveBeenCalledWith('gpt');
        expect(
            (globalThis as unknown as { deleteModule: ReturnType<typeof vi.fn> }).deleteModule,
        ).toHaveBeenCalledWith('gpt');
        expect(document.querySelector('.download-label')?.textContent).toBe('Download');

        list.innerHTML = `<div class="app-card" data-app-id="svc"><button class="download-btn"></button></div>`;
        handleDownload.call(modalManager, {
            id: 'svc',
            name: 'Service',
            installed: false,
            repoUrl: 'https://example.com/service.zip',
            expectedHash: 'abc',
            dlType: 'github',
        } as IApp);
        expect(
            (globalThis as unknown as { downloadModule: ReturnType<typeof vi.fn> }).downloadModule,
        ).toHaveBeenCalledWith('svc', 'https://example.com/service.zip', 'abc', 'github');
    });

    it('should handle missing repo, missing download bridge and dynamic sidebar widths', () => {
        modalManager = createManager();
        const handleDownload = (modalManager as unknown as { _handleDownload: (app: IApp) => void })
            ._handleDownload;

        handleDownload.call(modalManager, { id: 'empty', name: 'Empty', installed: false } as IApp);

        delete (globalThis as Record<string, unknown>)['downloadModule'];
        handleDownload.call(modalManager, {
            id: 'svc',
            name: 'Service',
            installed: false,
            repoUrl: 'https://example.com/service.zip',
        } as IApp);

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
