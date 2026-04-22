import { describe, expect, it, vi } from 'vitest';

import { ChatAutoStartHelper } from './ChatAutoStartHelper';

describe('ChatAutoStartHelper', () => {
    it('should prefer the currently visible AI slot when resolving module id', () => {
        const helper = new ChatAutoStartHelper({
            aiBridge: {
                startProvider: vi.fn().mockResolvedValue(true),
            },
            getSelectedModule: (category) =>
                category === 'ai_text' ? { id: 'text-model' } : { id: 'image-model' },
            getPreferredAiCategory: () => 'ai_image',
            tracer: {
                info: vi.fn(),
            },
        });

        expect(helper.resolveSelectedModuleId()).toBe('image-model');
    });

    it('should fall back to the other AI slot when the visible slot is empty', () => {
        const helper = new ChatAutoStartHelper({
            aiBridge: {
                startProvider: vi.fn().mockResolvedValue(true),
            },
            getSelectedModule: (category) =>
                category === 'ai_text' ? { id: 'text-model' } : undefined,
            getPreferredAiCategory: () => 'ai_image',
            tracer: {
                info: vi.fn(),
            },
        });

        expect(helper.resolveSelectedModuleId()).toBe('text-model');
    });
});
