import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('dompurify', () => ({
    default: {
        sanitize: vi.fn((value: string) => value),
    },
}));

import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { ModuleCardRenderer } from './ModuleCardRenderer';

describe('ModuleCardRenderer', () => {
    let renderer: ModuleCardRenderer;
    let openModuleSettingsSpy: ReturnType<typeof vi.fn>;
    let tracer: LoggerService;

    beforeEach(() => {
        openModuleSettingsSpy = vi.fn();
        tracer = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as unknown as LoggerService;
        renderer = new ModuleCardRenderer({
            translate: (key, fallback) => `${key}:${fallback}`,
            tracer,
            openModuleSettings: (app) => {
                (openModuleSettingsSpy as unknown as (value: unknown) => void)(app);
            },
        });
        document.body.innerHTML = `
            <template id="tpl-module-card">
                <div class="module-selection-card-icon"></div>
                <div class="module-selection-card-title"></div>
                <div class="module-selection-card-description"></div>
            </template>
        `;
        (
            globalThis as unknown as {
                aiBridge?: { getState: () => { activeProviderId?: string } };
            }
        ).aiBridge = {
            getState: () => ({ activeProviderId: 'remove-app' }),
        };
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('creates download cards and reacts to download progress', () => {
        const onClick = vi.fn();
        const onDownload = vi.fn();
        const card = renderer.createSelectionCard(
            {
                id: 'local-app',
                name: 'Local App',
                desc: 'Desc',
                icon: '<b>📦</b>',
                installed: false,
            } as never,
            'services',
            false,
            onClick,
            onDownload,
        );

        expect(card.classList.contains('is-installed')).toBe(false);
        expect(card.querySelector('.download-btn')).not.toBeNull();
        expect(card.querySelector('.module-selection-card-title')?.textContent).toContain(
            'Local App',
        );

        (card.querySelector('.download-btn') as HTMLButtonElement).click();
        expect(onDownload).toHaveBeenCalledWith(expect.any(Object), 'start');

        ModuleCardRenderer.setDownloadProgress(card, 47.4, 'downloading');
        expect((card.querySelector('.download-pct') as HTMLElement).textContent).toBe('47%');
        expect(card.querySelector('.download-btn')?.textContent).toContain('Pause');
        expect(card.querySelector('.download-btn')?.textContent).toContain('Cancel');

        ModuleCardRenderer.setDownloadProgress(card, 73, 'extracting');
        expect((card.querySelector('.download-label') as HTMLElement).textContent).toContain(
            'Extracting',
        );
        expect((card.querySelector('.download-pct') as HTMLElement).textContent).toBe('73%');
        expect(card.querySelector('.download-btn')?.classList.contains('indeterminate')).toBe(
            false,
        );

        ModuleCardRenderer.setDownloadProgress(card, 47.4, 'paused');
        expect(
            (card.querySelector('.download-hover-action-pause') as HTMLElement).textContent,
        ).toContain('Resume');

        ModuleCardRenderer.clearDownloadProgress(card);
        expect(card.querySelector('.download-btn')?.classList.contains('downloading')).toBe(false);
    });

    it('restores active download state when a card is recreated', () => {
        renderer = new ModuleCardRenderer({
            translate: (key, fallback) => `${key}:${fallback}`,
            tracer,
            getDownloadState: (moduleId) =>
                moduleId === 'local-app'
                    ? ({
                          status: 'paused',
                          progress: 0.13,
                      } as never)
                    : undefined,
        });

        const card = renderer.createSelectionCard(
            {
                id: 'local-app',
                name: 'Local App',
                desc: 'Desc',
                installed: false,
            } as never,
            'services',
            false,
            vi.fn(),
            vi.fn(),
        );
        const btn = card.querySelector<HTMLElement>('.download-btn');

        expect(btn?.classList.contains('downloading')).toBe(true);
        expect(btn?.dataset['downloadStatus']).toBe('paused');
        expect(card.querySelector('.download-pct')?.textContent).toBe('13%');
        expect(card.querySelector('.download-hover-action-pause')?.textContent).toContain('Resume');
    });

    it('creates action buttons for selected and removable modules', () => {
        const onClick = vi.fn();

        const selectedCard = renderer.createSelectionCard(
            { id: 'remove-app', name: 'Runner', desc: 'Desc', installed: true } as never,
            'services',
            true,
            onClick,
        );
        expect(selectedCard.textContent).toContain('Remove');

        const removableCard = renderer.createSelectionCard(
            { id: 'installed-app', name: 'Installed', desc: 'Desc', installed: true } as never,
            'services',
            true,
            onClick,
        );
        expect(removableCard.textContent).toContain('Remove');

        const selectCard = renderer.createSelectionCard(
            { id: 'installed-app', name: 'Installed', desc: 'Desc', installed: true } as never,
            'services',
            false,
            onClick,
        );
        expect(selectCard.textContent).toContain('Launch');

        (selectCard.querySelector('.modal-btn-primary') as HTMLButtonElement).click();
        expect(onClick).toHaveBeenCalled();
    });

    it('renders a disabled coming-soon button for placeholder modules', () => {
        const onClick = vi.fn();
        const onDownload = vi.fn();

        const card = renderer.createSelectionCard(
            {
                id: 'future-image',
                name: 'Future Image',
                desc: 'Desc',
                installed: false,
                comingSoon: true,
            } as never,
            'ai',
            false,
            onClick,
            onDownload,
        );

        const button = card.querySelector('.modal-btn-secondary') as HTMLButtonElement | null;
        expect(button).not.toBeNull();
        expect(button?.textContent).toContain('Coming soon');
        expect(button?.disabled).toBe(true);
        expect(card.querySelector('.download-btn')).toBeNull();
    });

    it('renders uninstalled AI engine cards as downloadable', () => {
        const onClick = vi.fn();
        const onDownload = vi.fn();

        const card = renderer.createSelectionCard(
            {
                id: 'llamacpp',
                name: 'llama.cpp',
                desc: 'Local engine',
                installed: false,
                type: 'local',
                capability: 'text',
            } as never,
            'ai_text',
            false,
            onClick,
            onDownload,
        );

        expect(card.querySelector('.download-btn')?.textContent).toContain('Download');
    });

    it('renders installed AI engine cards as selectable', () => {
        const onClick = vi.fn();
        const onDownload = vi.fn();

        const card = renderer.createSelectionCard(
            {
                id: 'llamacpp',
                name: 'llama.cpp',
                desc: 'Local engine',
                installed: true,
                type: 'local',
                capability: 'text',
            } as never,
            'ai_text',
            false,
            onClick,
            onDownload,
        );

        expect(card.querySelector('.download-btn')).toBeNull();
        expect(card.querySelector('.modal-btn-primary')?.textContent).toContain('Launch');
    });

    it('renders delete badge emoji for installed local modules', () => {
        const onClick = vi.fn();
        const card = renderer.createSelectionCard(
            { id: 'installed-app', name: 'Installed', desc: 'Desc', installed: true } as never,
            'services',
            false,
            onClick,
        );

        const deleteIcon = card.querySelector('.app-delete-badge .badge-icon');
        expect(deleteIcon?.textContent).toContain('🗑');
    });

    it('opens module settings on right click for installed cards and ignores uninstalled ones', () => {
        const onClick = vi.fn();

        const installedCard = renderer.createSelectionCard(
            { id: 'installed-app', name: 'Installed', desc: 'Desc', installed: true } as never,
            'services',
            false,
            onClick,
        );
        installedCard.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        );
        expect(openModuleSettingsSpy).toHaveBeenCalled();

        const uninstalledCard = renderer.createSelectionCard(
            { id: 'not-installed', name: 'Missing', desc: 'Desc', installed: false } as never,
            'services',
            false,
            onClick,
        );
        uninstalledCard.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        );
        expect(openModuleSettingsSpy).toHaveBeenCalledTimes(1);
    });

    it('should not open settings for modules with settings disabled', () => {
        const onClick = vi.fn();
        const comfyUiCard = renderer.createSelectionCard(
            { id: 'comfyui', name: 'ComfyUI', desc: 'Desc', installed: true } as never,
            'ai',
            false,
            onClick,
        );

        comfyUiCard.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        );

        expect(openModuleSettingsSpy).not.toHaveBeenCalled();
    });

    it('updates dashboard card content and marks cards as installed', () => {
        const card = document.createElement('div');
        card.innerHTML = `
            <div class="module-slot-card-icon"></div>
            <div class="module-slot-card-title" data-i18n="stale"></div>
            <div class="module-slot-card-description" data-i18n="stale"></div>
            <div class="module-selection-card-actions"></div>
            <div class="app-type-badge not-installed"></div>
            <div class="app-card-overlay"></div>
        `;

        renderer.updateSlotCardAttributes(card, { id: 'gpt', name: 'GPT' } as never);
        renderer.updateSlotCardContent(card, {
            id: 'axelate',
            name: 'Ignored',
            desc: 'Desc',
            icon: '<i>✨</i>',
            descKey: 'desc.key',
        } as never);
        expect(card.dataset['currentModule']).toBe('gpt');
        expect(card.querySelector('.module-slot-card-title')?.textContent).toBe(
            'ui.launcher.web.app_title:Axelate',
        );

        renderer.updateSlotCardContent(card, {
            id: 'custom',
            name: 'Custom',
            nameKey: 'name.key',
            desc: 'Custom desc',
            descKey: 'desc.key',
            icon: '<i>📡</i>',
        } as never);
        expect(card.querySelector('.module-slot-card-title')?.textContent).toBe('name.key:Custom');
        expect(card.querySelector('.module-slot-card-description')?.textContent).toBe(
            'desc.key:Custom desc',
        );

        const configureActionBtn = vi.fn((targetCard: HTMLElement) => {
            targetCard
                .querySelector('.module-selection-card-actions')
                ?.appendChild(document.createElement('button'));
        });
        renderer.markSlotCardAsInstalled(
            card,
            { id: 'custom', name: 'Custom', installed: true } as never,
            configureActionBtn,
        );

        expect(card.classList.contains('is-installed')).toBe(true);
        expect(card.querySelector('.app-card-overlay')).toBeNull();
        expect(configureActionBtn).toHaveBeenCalled();
    });
});
