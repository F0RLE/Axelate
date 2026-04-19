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
    let checkInstalled: (moduleId: string) => Promise<boolean>;
    let openModuleSettingsSpy: ReturnType<typeof vi.fn>;
    let tracer: LoggerService;

    beforeEach(() => {
        checkInstalled = vi.fn<(_: string) => Promise<boolean>>(() => Promise.resolve(false));
        openModuleSettingsSpy = vi.fn();
        tracer = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as unknown as LoggerService;
        renderer = new ModuleCardRenderer({
            checkInstalled,
            translate: (key, fallback) => `${key}:${fallback}`,
            tracer,
            openModuleSettings: (app) => {
                (openModuleSettingsSpy as unknown as (value: unknown) => void)(app);
            },
        });
        document.body.innerHTML = `
            <template id="tpl-module-card">
                <div class="app-icon-wrapper"></div>
                <div class="app-card-title"></div>
                <div class="app-card-desc"></div>
            </template>
        `;
        (
            globalThis as unknown as {
                aiBridge?: { getState: () => { activeProviderId?: string } };
            }
        ).aiBridge = {
            getState: () => ({ activeProviderId: 'Убрать-app' }),
        };
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('creates download cards and reacts to download progress', () => {
        const onClick = vi.fn();
        const onDownload = vi.fn();
        const card = renderer.createCard(
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
        expect(card.querySelector('.app-card-title')?.textContent).toContain('Local App');

        (card.querySelector('.download-btn') as HTMLButtonElement).click();
        expect(onDownload).toHaveBeenCalled();

        ModuleCardRenderer.setDownloadProgress(card, 47.4, 'downloading');
        expect((card.querySelector('.download-pct') as HTMLElement).textContent).toBe('47%');

        ModuleCardRenderer.setDownloadProgress(card, 73, 'extracting');
        expect((card.querySelector('.download-label') as HTMLElement).textContent).toContain(
            'Extracting',
        );
        expect((card.querySelector('.download-pct') as HTMLElement).textContent).toBe('73%');
        expect(card.querySelector('.download-btn')?.classList.contains('indeterminate')).toBe(
            false,
        );

        ModuleCardRenderer.clearDownloadProgress(card);
        expect(card.querySelector('.download-btn')?.classList.contains('downloading')).toBe(false);
    });

    it('creates action buttons for selected and Убрать modules', () => {
        const onClick = vi.fn();

        const selectedCard = renderer.createCard(
            { id: 'Убрать-app', name: 'Runner', desc: 'Desc', installed: true } as never,
            'services',
            true,
            onClick,
        );
        expect(selectedCard.textContent).toContain('Убрать');

        const removableCard = renderer.createCard(
            { id: 'installed-app', name: 'Installed', desc: 'Desc', installed: true } as never,
            'services',
            true,
            onClick,
        );
        expect(removableCard.textContent).toContain('Убрать');

        const selectCard = renderer.createCard(
            { id: 'installed-app', name: 'Installed', desc: 'Desc', installed: true } as never,
            'services',
            false,
            onClick,
        );
        expect(selectCard.textContent).toContain('Select');

        (selectCard.querySelector('.modal-btn-primary') as HTMLButtonElement).click();
        expect(onClick).toHaveBeenCalled();
    });

    it('renders a disabled coming-soon button for placeholder modules', () => {
        const onClick = vi.fn();
        const onDownload = vi.fn();

        const card = renderer.createCard(
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

    it('renders delete badge emoji for installed local modules', () => {
        const onClick = vi.fn();
        const card = renderer.createCard(
            { id: 'installed-app', name: 'Installed', desc: 'Desc', installed: true } as never,
            'services',
            false,
            onClick,
        );

        const deleteIcon = card.querySelector('.app-delete-badge .badge-icon');
        expect(deleteIcon?.textContent).toContain('🗑');
    });

    it('opens module settings on right click for installed cards and ignores uninstalled ones', async () => {
        const onClick = vi.fn();

        const installedCard = renderer.createCard(
            { id: 'installed-app', name: 'Installed', desc: 'Desc', installed: true } as never,
            'services',
            false,
            onClick,
        );
        installedCard.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        );
        expect(openModuleSettingsSpy).toHaveBeenCalled();

        (checkInstalled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        const asyncCard = renderer.createCard(
            { id: 'late-install', name: 'Later', desc: 'Desc', installed: false } as never,
            'services',
            false,
            onClick,
        );
        document.body.appendChild(asyncCard);
        await Promise.resolve();
        await Promise.resolve();

        expect(asyncCard.classList.contains('is-installed')).toBe(true);
        asyncCard.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        expect(openModuleSettingsSpy).toHaveBeenCalledTimes(2);

        const uninstalledCard = renderer.createCard(
            { id: 'not-installed', name: 'Missing', desc: 'Desc', installed: false } as never,
            'services',
            false,
            onClick,
        );
        uninstalledCard.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        );
        expect(openModuleSettingsSpy).toHaveBeenCalledTimes(2);
    });

    it('should ignore late async install resolution for detached cards', async () => {
        const onClick = vi.fn();
        (checkInstalled as ReturnType<typeof vi.fn>).mockResolvedValue(true);

        const card = renderer.createCard(
            { id: 'late-install-detached', name: 'Later', desc: 'Desc', installed: false } as never,
            'services',
            false,
            onClick,
        );

        card.remove();
        await Promise.resolve();
        await Promise.resolve();

        expect(card.classList.contains('is-installed')).toBe(false);
    });

    it('updates dashboard card content and marks cards as installed', () => {
        const card = document.createElement('div');
        card.innerHTML = `
            <div class="model-icon-wrapper"></div>
            <div class="model-card-title" data-i18n="stale"></div>
            <div class="model-card-desc" data-i18n="stale"></div>
            <div class="app-card-hover-actions"></div>
            <div class="app-type-badge not-installed"></div>
            <div class="app-card-overlay"></div>
        `;

        renderer.updateCardAttributes(card, { id: 'gpt', name: 'GPT' } as never);
        renderer.updateCardContent(card, {
            id: 'axelate',
            name: 'Ignored',
            desc: 'Desc',
            icon: '<i>✨</i>',
            descKey: 'desc.key',
        } as never);
        expect(card.dataset['currentModule']).toBe('gpt');
        expect(card.querySelector('.model-card-title')?.textContent).toBe(
            'ui.launcher.web.app_title:Axelate',
        );

        renderer.updateCardContent(card, {
            id: 'custom',
            name: 'Custom',
            nameKey: 'name.key',
            desc: 'Custom desc',
            descKey: 'desc.key',
            icon: '<i>📡</i>',
        } as never);
        expect(card.querySelector('.model-card-title')?.textContent).toBe('name.key:Custom');
        expect(card.querySelector('.model-card-desc')?.textContent).toBe('desc.key:Custom desc');

        const configureActionBtn = vi.fn((targetCard: HTMLElement) => {
            targetCard
                .querySelector('.app-card-hover-actions')
                ?.appendChild(document.createElement('button'));
        });
        renderer.markCardAsInstalled(
            card,
            { id: 'custom', name: 'Custom', installed: true } as never,
            configureActionBtn,
        );

        expect(card.classList.contains('is-installed')).toBe(true);
        expect(card.querySelector('.app-card-overlay')).toBeNull();
        expect(configureActionBtn).toHaveBeenCalled();
    });
});
