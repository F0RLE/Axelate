import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IApp } from '../../types/coreTypes';
import { AppUiChrome } from './AppUiChrome';

describe('AppUiChrome', () => {
    let chrome: AppUiChrome;

    beforeEach(() => {
        document.body.innerHTML = '';
        (globalThis as unknown as { t?: (key: string, fallback: string) => string }).t = (
            _key,
            fallback,
        ) => fallback;
        chrome = new AppUiChrome();
    });

    it('reuses a single action feedback node', () => {
        const first = chrome.ensureActionFeedback();
        const second = chrome.ensureActionFeedback();

        expect(first).toBe(second);
        expect(document.querySelectorAll('#action-feedback')).toHaveLength(1);
    });

    it('creates settings and close badges with attached handlers', () => {
        const app = { id: 'svc', name: 'Service' } as IApp;
        const openSettings = vi.fn();
        const closeCategory = vi.fn();
        const openSelection = vi.fn();

        const settingsBadge = chrome.createSettingsBadge(app, openSettings);
        const closeBadge = chrome.createCloseBadge('services', closeCategory);
        const stackBadge = chrome.createStackBadge('Image Model', openSelection);

        settingsBadge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        closeBadge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        stackBadge.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(openSettings).toHaveBeenCalledWith(app);
        expect(closeCategory).toHaveBeenCalledWith('services');
        expect(openSelection).toHaveBeenCalled();
    });
});
