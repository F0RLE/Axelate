import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModuleSettingsAutosaveController } from './ModuleSettingsAutosaveController';

describe('ModuleSettingsAutosaveController', () => {
    const translate = vi.fn((_: string, fallback?: string) => fallback ?? '');
    const saveSetting = vi.fn<(...args: [string, string]) => Promise<void>>();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        document.body.innerHTML = '<div id="save-indicator"><span></span></div>';
    });

    it('shows indicator and hides it after successful save', async () => {
        saveSetting.mockResolvedValue(undefined);
        const controller = new ModuleSettingsAutosaveController(translate, saveSetting);

        controller.debouncedSave('svc_key', 'value');
        expect(document.getElementById('save-indicator')?.classList.contains('show')).toBe(true);

        await vi.runAllTimersAsync();

        expect(saveSetting).toHaveBeenCalledWith('svc_key', 'value');
        expect(document.getElementById('save-indicator')?.classList.contains('show')).toBe(false);
    });

    it('shows error state on save failure and reset clears pending saves', async () => {
        saveSetting.mockRejectedValue(new Error('boom'));
        const controller = new ModuleSettingsAutosaveController(translate, saveSetting);

        controller.debouncedSave('svc_key', 'value');
        await vi.runAllTimersAsync();

        expect(
            document.querySelector<HTMLSpanElement>('#save-indicator span')?.textContent,
        ).toBe('Save failed');

        controller.debouncedSave('svc_key', 'value-2');
        controller.reset();
        await vi.runAllTimersAsync();

        expect(saveSetting).toHaveBeenCalledTimes(1);
        expect(document.getElementById('save-indicator')?.classList.contains('show')).toBe(false);
        vi.useRealTimers();
    });
});
