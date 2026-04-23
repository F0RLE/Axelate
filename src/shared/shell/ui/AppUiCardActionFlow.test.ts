import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IApp } from '../../types/coreTypes';
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

    it('cancels in-flight download and restores button state', async () => {
        const card = document.createElement('div');
        card.className = 'app-card';
        const btn = document.createElement('button');
        btn.className = 'download-btn downloading';
        card.appendChild(btn);
        const event = {
            stopPropagation: vi.fn(),
            currentTarget: card,
            target: card,
        } as unknown as MouseEvent;
        const app = { id: 'svc', installed: false, repoUrl: 'https://repo' } as IApp;
        platformService.cancelDownload.mockResolvedValue(undefined);
        platformService.delete.mockResolvedValue(undefined);

        await flow.tryDownloadAction(event, app, 'services');
        await Promise.resolve();

        expect(platformService.cancelDownload).toHaveBeenCalledWith('svc');
        expect(deps.resetDownloadButton).toHaveBeenCalledWith(btn);
        expect(deps.restoreDownloadButtonLabel).toHaveBeenCalledWith(btn);
    });
});
