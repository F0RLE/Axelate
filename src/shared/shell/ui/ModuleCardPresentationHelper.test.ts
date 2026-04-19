import { describe, expect, it, vi } from 'vitest';

vi.mock('dompurify', () => ({
    default: {
        sanitize: vi.fn((value: string) => value),
    },
}));

import { ModuleCardPresentationHelper } from './ModuleCardPresentationHelper';

describe('ModuleCardPresentationHelper', () => {
    const helper = new ModuleCardPresentationHelper({
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: [],
        ALLOW_DATA_ATTR: true,
    }, (key, fallback) => `${key}:${fallback}`);

    it('should resolve translated content and badges', () => {
        expect(helper.getAppName({ id: 'gpt', name: 'GPT' } as never)).toBe(
            'ui.launcher.module.gpt.name:GPT',
        );
        expect(helper.getAppDesc({ id: 'gpt', desc: 'Desc' } as never)).toBe(
            'ui.launcher.module.gpt.desc:Desc',
        );
        expect(helper.getTypeBadgeHtml(true, true)).toContain('ui.launcher.badge.cloud:CLOUD');
        expect(helper.getDeleteBadgeHtml(false, true)).toContain('ui.launcher.module.delete:DELETE');
        expect(helper.getDownloadLabel()).toBe('ui.launcher.module.download:Download');
        expect(helper.getExtractingLabel()).toBe('ui.launcher.module.extracting:Extracting');
    });
});
