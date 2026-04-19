import { describe, expect, it } from 'vitest';
import { ModalSelectionPolicy } from './ModalSelectionPolicy';

describe('ModalSelectionPolicy', () => {
    const policy = new ModalSelectionPolicy();

    it('should resolve modal titles and tab visibility', () => {
        expect(policy.getModalTitleInfo('ai_text')).toEqual({
            key: 'ui.launcher.modules.modal.ai_title',
            defaultText: 'Select AI Module',
        });
        expect(policy.getModalTitleInfo('ai_image')).toEqual({
            key: 'ui.launcher.modules.modal.ai_image_title',
            defaultText: 'Select Image AI',
        });
        expect(policy.shouldShowFilterTabs('ai')).toBe(true);
        expect(policy.shouldShowFilterTabs('services')).toBe(false);
    });

    it('should filter, sort and resolve button states', () => {
        const apps = [
            { id: 'custom', name: 'Custom', installed: false, capability: 'text' },
            { id: 'gemini-fast', name: 'Gemini', installed: true, capability: 'text' },
            { id: 'vision', name: 'Vision', installed: true, capability: 'image' },
        ] as never[];

        expect(policy.hasImageApps(apps)).toBe(true);
        expect(
            policy.getVisibleApps(apps, 'ai_text', 'text').map((app) => app.id),
        ).toEqual(['gemini-fast', 'custom']);

        const card = document.createElement('div');
        expect(policy.getButtonState(card, false)).toEqual({
            className: 'modal-btn modal-btn-primary',
            key: 'ui.launcher.modules.modal.btn_select',
            defaultLabel: 'Select',
        });

        card.classList.add('engine-starting');
        expect(policy.getButtonState(card, true)).toEqual({
            className: 'modal-btn modal-btn-secondary active-module-btn',
            key: 'ui.launcher.modules.modal.btn_booting',
            defaultLabel: 'Booting...',
        });
    });
});
