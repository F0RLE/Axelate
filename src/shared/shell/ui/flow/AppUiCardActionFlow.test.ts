import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IApp } from '../../../types/coreTypes';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import { AppUiCardActionFlow } from './AppUiCardActionFlow';

describe('AppUiCardActionFlow', () => {
    const platformService = {
        isApiModule: vi.fn(() => false),
        cancelDownload: vi.fn(),
        delete: vi.fn(),
    };

    const deps = {
        platformService: platformService as never,
        tracer: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as unknown as LoggerService,
        isComingSoonApp: vi.fn(() => false),
        showComingSoonToast: vi.fn(),
        showToast: vi.fn(),
        handleDeleteModule: vi.fn(),
        handleDownloadModule: vi.fn(),
        pauseDownload: vi.fn(),
        resumeDownload: vi.fn(),
        cancelDownload: vi.fn(),
        resetDownloadButton: vi.fn(),
        restoreDownloadButtonLabel: vi.fn(),
        performSelectionAction: vi.fn(),
        translate: vi.fn((_key: string, fallback: string) => fallback),
    };

    let flow: AppUiCardActionFlow;

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        platformService.isApiModule.mockReturnValue(false);
        deps.pauseDownload.mockResolvedValue(true);
        deps.resumeDownload.mockResolvedValue(true);
        deps.cancelDownload.mockResolvedValue(true);
        deps.isComingSoonApp.mockReturnValue(false);
        flow = new AppUiCardActionFlow(deps);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('routes coming soon apps to placeholder toast', async () => {
        deps.isComingSoonApp.mockReturnValue(true);
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const app = { id: 'future', comingSoon: true } as IApp;

        await flow.handleAppCardClick(event, app, 'ai_image');

        expect(deps.showComingSoonToast).toHaveBeenCalled();
        expect(deps.performSelectionAction).not.toHaveBeenCalled();
    });

    it('pauses in-flight download from the left side and updates the button state', async () => {
        const card = document.createElement('div');
        card.className = 'app-card';
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading';
        btn.dataset['resumeLabel'] = 'Resume';
        btn.innerHTML = '<span class="download-hover-action-pause">Pause</span>';
        btn.getBoundingClientRect = vi.fn(
            () =>
                ({
                    left: 0,
                    width: 100,
                }) as DOMRect,
        );
        card.appendChild(btn);
        const event = {
            stopPropagation: vi.fn(),
            currentTarget: card,
            target: btn,
            clientX: 20,
        } as unknown as MouseEvent;
        const app = { id: 'svc', installed: false, repoUrl: 'https://repo' } as IApp;
        platformService.delete.mockResolvedValue(undefined);

        await flow.tryDownloadAction(event, app, 'services');

        expect(deps.pauseDownload).toHaveBeenCalledWith('svc');
        expect(btn.dataset['downloadStatus']).toBe('paused');
        expect(btn.querySelector('.download-hover-action-pause')?.textContent).toBe('Resume');
        expect(deps.cancelDownload).not.toHaveBeenCalled();
        expect(platformService.delete).not.toHaveBeenCalled();
        expect(deps.resetDownloadButton).not.toHaveBeenCalled();
    });

    it('resumes paused download from the left side and updates the button state', async () => {
        const card = document.createElement('div');
        card.className = 'app-card';
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading';
        btn.dataset['downloadStatus'] = 'paused';
        btn.dataset['pauseLabel'] = 'Pause';
        btn.innerHTML = '<span class="download-hover-action-pause">Resume</span>';
        btn.getBoundingClientRect = vi.fn(
            () =>
                ({
                    left: 0,
                    width: 100,
                }) as DOMRect,
        );
        card.appendChild(btn);
        const event = {
            stopPropagation: vi.fn(),
            currentTarget: card,
            target: btn,
            clientX: 20,
        } as unknown as MouseEvent;
        const app = { id: 'svc', installed: false, repoUrl: 'https://repo' } as IApp;

        await flow.tryDownloadAction(event, app, 'services');

        expect(deps.resumeDownload).toHaveBeenCalledWith('svc');
        expect(btn.dataset['downloadStatus']).toBe('downloading');
        expect(btn.querySelector('.download-hover-action-pause')?.textContent).toBe('Pause');
        expect(deps.pauseDownload).not.toHaveBeenCalled();
        expect(deps.cancelDownload).not.toHaveBeenCalled();
    });

    it('uses right half of active download button to cancel', async () => {
        const card = document.createElement('div');
        card.className = 'app-card';
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading';
        btn.getBoundingClientRect = vi.fn(
            () =>
                ({
                    left: 0,
                    width: 100,
                }) as DOMRect,
        );
        card.appendChild(btn);
        const event = {
            stopPropagation: vi.fn(),
            currentTarget: card,
            target: btn,
            clientX: 75,
        } as unknown as MouseEvent;
        const app = { id: 'svc', installed: false, repoUrl: 'https://repo' } as IApp;

        await flow.tryDownloadAction(event, app, 'services');

        expect(deps.cancelDownload).toHaveBeenCalledWith('svc');
        expect(platformService.delete).not.toHaveBeenCalled();
        expect(deps.resetDownloadButton).toHaveBeenCalledWith(btn);
        expect(deps.restoreDownloadButtonLabel).toHaveBeenCalledWith(btn);
    });

    it('keeps active download button state when pause is rejected by backend', async () => {
        deps.pauseDownload.mockResolvedValue(false);
        const card = document.createElement('div');
        card.className = 'app-card';
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading';
        btn.dataset['resumeLabel'] = 'Resume';
        btn.innerHTML = '<span class="download-hover-action-pause">Pause</span>';
        btn.getBoundingClientRect = vi.fn(
            () =>
                ({
                    left: 0,
                    width: 100,
                }) as DOMRect,
        );
        card.appendChild(btn);
        const event = {
            stopPropagation: vi.fn(),
            currentTarget: card,
            target: btn,
            clientX: 20,
        } as unknown as MouseEvent;
        const app = { id: 'svc', installed: false, repoUrl: 'https://repo' } as IApp;

        await flow.tryDownloadAction(event, app, 'services');

        expect(btn.dataset['downloadStatus']).toBeUndefined();
        expect(btn.querySelector('.download-hover-action-pause')?.textContent).toBe('Pause');
        expect(deps.resetDownloadButton).not.toHaveBeenCalled();
        expect(deps.showToast).toHaveBeenCalledWith('Download control failed', 'warning');
    });

    it('keeps active download button state when cancel is rejected by backend', async () => {
        deps.cancelDownload.mockResolvedValue(false);
        const card = document.createElement('div');
        card.className = 'app-card';
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading';
        btn.getBoundingClientRect = vi.fn(
            () =>
                ({
                    left: 0,
                    width: 100,
                }) as DOMRect,
        );
        card.appendChild(btn);
        const event = {
            stopPropagation: vi.fn(),
            currentTarget: card,
            target: btn,
            clientX: 75,
        } as unknown as MouseEvent;
        const app = { id: 'svc', installed: false, repoUrl: 'https://repo' } as IApp;

        await flow.tryDownloadAction(event, app, 'services');

        expect(deps.cancelDownload).toHaveBeenCalledWith('svc');
        expect(deps.resetDownloadButton).not.toHaveBeenCalled();
        expect(deps.restoreDownloadButtonLabel).not.toHaveBeenCalled();
        expect(deps.showToast).toHaveBeenCalledWith('Download control failed', 'warning');
    });

    it('starts a download from a plain uninstalled card click', async () => {
        const card = document.createElement('div');
        card.className = 'app-card';
        const btn = document.createElement('button');
        btn.className = 'download-btn';
        card.appendChild(btn);

        const event = {
            stopPropagation: vi.fn(),
            currentTarget: card,
            target: card,
            clientX: 20,
        } as unknown as MouseEvent;
        const app = { id: 'llamacpp', installed: false, repoUrl: 'https://repo' } as IApp;

        await flow.handleAppCardClick(event, app, 'ai_text');

        expect(event.stopPropagation).toHaveBeenCalled();
        expect(deps.handleDownloadModule).toHaveBeenCalledWith(app, 'ai_text', btn);
        expect(deps.performSelectionAction).not.toHaveBeenCalled();
    });

    it('ignores plain card clicks while download is already active', async () => {
        const card = document.createElement('div');
        card.className = 'app-card';
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading';
        card.appendChild(btn);

        const event = {
            stopPropagation: vi.fn(),
            currentTarget: card,
            target: card,
            clientX: 20,
        } as unknown as MouseEvent;
        const app = { id: 'llamacpp', installed: false, repoUrl: 'https://repo' } as IApp;

        await flow.handleAppCardClick(event, app, 'ai_text');

        expect(deps.handleDownloadModule).not.toHaveBeenCalled();
        expect(deps.pauseDownload).not.toHaveBeenCalled();
        expect(deps.cancelDownload).not.toHaveBeenCalled();
        expect(deps.performSelectionAction).not.toHaveBeenCalled();
    });

    it('selects installed local cards from a plain card click', async () => {
        const card = document.createElement('div');
        card.className = 'app-card';
        const event = {
            stopPropagation: vi.fn(),
            currentTarget: card,
            target: card,
            clientX: 20,
        } as unknown as MouseEvent;
        const app = { id: 'llamacpp', installed: true, repoUrl: 'https://repo' } as IApp;

        await flow.handleAppCardClick(event, app, 'ai_text');

        expect(deps.performSelectionAction).toHaveBeenCalledWith('ai_text', app);
    });
});
