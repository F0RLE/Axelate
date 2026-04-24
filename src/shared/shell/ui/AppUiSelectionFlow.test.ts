import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IApp } from '../../types/coreTypes';
import { AppUiSelectionFlow } from './AppUiSelectionFlow';

describe('AppUiSelectionFlow', () => {
    const getSelectedApp = vi.fn();
    const clearModuleCard = vi.fn();
    const updateModuleCard = vi.fn();
    const updateModalSelection = vi.fn();
    const bumpLaunchSelectionVersion = vi.fn(() => 1);
    const stopSelectedApp = vi.fn().mockResolvedValue(true);
    const launchSelectedApp = vi.fn();
    const removeSelectedModule = vi.fn();
    const setSelectedModule = vi.fn();
    const launchApp = vi.fn().mockResolvedValue(undefined);

    let flow: AppUiSelectionFlow;

    beforeEach(() => {
        vi.clearAllMocks();
        flow = new AppUiSelectionFlow({
            getSelectedApp,
            clearModuleCard,
            updateModuleCard,
            updateModalSelection,
            bumpLaunchSelectionVersion,
            stopSelectedApp,
            launchSelectedApp,
            removeSelectedModule,
            setSelectedModule,
            launchApp,
        });
    });

    it('selects integration module, persists it and launches it', () => {
        const app = { id: 'svc', name: 'Service', type: 'local', icon: 'S', desc: 'Desc' } as IApp;
        getSelectedApp.mockReturnValue(undefined);

        flow.performSelectionAction('services', app);

        expect(updateModuleCard).toHaveBeenCalledWith('services', app);
        expect(updateModalSelection).toHaveBeenCalledWith('svc');
        expect(setSelectedModule).toHaveBeenCalled();
        expect(launchSelectedApp).toHaveBeenCalled();
    });

    it('selects AI module without launching it immediately', () => {
        const app = { id: 'text-model', name: 'Text Model', type: 'api', icon: 'T' } as IApp;
        getSelectedApp.mockReturnValue(undefined);

        flow.performSelectionAction('ai_text', app);

        expect(updateModuleCard).toHaveBeenCalledWith('ai_text', app);
        expect(updateModalSelection).toHaveBeenCalledWith('text-model');
        expect(setSelectedModule).toHaveBeenCalled();
        expect(launchSelectedApp).not.toHaveBeenCalled();
        expect(launchApp).not.toHaveBeenCalled();
    });

    it('does not launch AI when switching the visible shared AI slot', () => {
        const app = { id: 'image-model', name: 'Image Model', type: 'local' } as IApp;

        flow.activateExistingSelection('ai_image', app);

        expect(launchApp).not.toHaveBeenCalled();
    });

    it('deselects current module and clears persisted selection', () => {
        const app = { id: 'svc', name: 'Service' } as IApp;
        getSelectedApp.mockReturnValue(app);

        flow.performSelectionAction('services', app);

        expect(clearModuleCard).toHaveBeenCalledWith('services');
        expect(updateModalSelection).toHaveBeenCalledWith(null);
        expect(removeSelectedModule).toHaveBeenCalledWith('services');
        expect(stopSelectedApp).toHaveBeenCalledWith(app);
    });
});
