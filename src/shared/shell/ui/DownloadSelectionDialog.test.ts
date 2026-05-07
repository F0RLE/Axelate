import { describe, expect, it, vi } from 'vitest';

import { openDownloadSelectionDialog } from './DownloadSelectionDialog';
import type { ReleaseDownloadOptions } from '@/shared/types/coreTypes';

describe('openDownloadSelectionDialog', () => {
    it('allows selecting both CPU and GPU packages', async () => {
        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
            callback(0);
            return 0;
        });
        Element.prototype.scrollIntoView = vi.fn();

        const options: ReleaseDownloadOptions = {
            module_id: 'llamacpp',
            versions: [
                {
                    tag_name: 'v1.0.0',
                    published_at: '2026-05-06T00:00:00Z',
                    recommended: 'gpu',
                    gpu: {
                        compute_target: 'gpu',
                        assets: ['gpu.zip'],
                        total_size: 1024,
                    },
                    cpu: {
                        compute_target: 'cpu',
                        assets: ['cpu.zip'],
                        total_size: 2048,
                    },
                },
            ],
        };

        const resultPromise = openDownloadSelectionDialog({
            app: { id: 'llamacpp', name: 'llama.cpp', icon: 'L' },
            loadOptions: () => Promise.resolve(options),
            translate: (_key, fallback) => fallback,
        });

        await vi.waitFor(() => {
            expect(document.querySelectorAll('[data-download-target]')).toHaveLength(3);
        });

        const bothButton = document.querySelector<HTMLButtonElement>(
            '[data-download-target="both"]',
        );
        expect(bothButton).not.toBeNull();
        if (bothButton === null) {
            throw new Error('Both package button not found');
        }
        bothButton.click();

        const confirmButton = document.querySelector<HTMLButtonElement>(
            '.download-selection-confirm',
        );
        expect(confirmButton).not.toBeNull();
        if (confirmButton === null) {
            throw new Error('Download confirm button not found');
        }
        confirmButton.click();

        await expect(resultPromise).resolves.toEqual({
            tag_name: 'v1.0.0',
            compute_target: 'both',
        });
    });
});
