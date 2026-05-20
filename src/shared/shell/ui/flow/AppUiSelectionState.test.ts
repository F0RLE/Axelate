import { beforeEach, describe, expect, it } from 'vitest';
import type { IApp } from '../../../types/coreTypes';
import { AppUiSelectionState } from './AppUiSelectionState';

describe('AppUiSelectionState', () => {
    let selectionState: AppUiSelectionState;

    beforeEach(() => {
        selectionState = new AppUiSelectionState();
        document.body.innerHTML = '';
    });

    it('resolves the shown category from shared ai card metadata', () => {
        const sharedApp = { id: 'shared-ai', name: 'Shared AI' } as IApp;
        selectionState.set('ai_text', sharedApp);

        const card = document.createElement('div');
        card.id = 'ai-module-card';
        card.dataset['currentModule'] = 'shared-ai';

        expect(selectionState.resolveCategoryFromCard(card)).toBe('ai_text');

        card.dataset['currentCapability'] = 'ai_image';
        expect(selectionState.resolveCategoryFromCard(card)).toBe('ai_image');
    });

    it('tracks whether an ai app is still selected in the other slot', () => {
        const sharedApp = { id: 'shared-ai', name: 'Shared AI' } as IApp;
        selectionState.set('ai_text', sharedApp);
        selectionState.set('ai_image', sharedApp);

        expect(selectionState.shouldKeepRemovedAiAppRunning('ai_text', sharedApp)).toBe(true);
        expect(selectionState.isSelectedInAnotherAiSlot('ai_text', 'shared-ai')).toBe(true);
        expect(selectionState.hasAnyAiSlot()).toBe(true);
    });

    it('computes secondary shared ai badge state', () => {
        const textApp = { id: 'text-model', name: 'Text Model' } as IApp;
        const imageApp = { id: 'image-model', name: 'Image Model' } as IApp;
        selectionState.set('ai_text', textApp);
        selectionState.set('ai_image', imageApp);

        const card = document.createElement('div');
        card.id = 'ai-module-card';
        card.dataset['currentCapability'] = 'ai_text';

        expect(selectionState.getSharedAiCardState(card)).toMatchObject({
            secondaryApp: imageApp,
            openCapability: 'ai_image',
        });
    });
});
