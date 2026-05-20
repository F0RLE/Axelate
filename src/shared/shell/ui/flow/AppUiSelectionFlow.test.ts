import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IApp } from '../../../types/coreTypes';
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

    it('selects integration module, persists it, and launches it', () => {
        const app = { id: 'svc', name: 'Service', type: 'local', icon: 'S', desc: 'Desc' } as IApp;
        getSelectedApp.mockReturnValue(undefined);

        flow.performSelectionAction('services', app);

        expect(updateModuleCard).toHaveBeenCalledWith('services', app);
        expect(updateModalSelection).toHaveBeenCalledWith('svc');
        expect(setSelectedModule).toHaveBeenCalled();
        expect(launchSelectedApp).toHaveBeenCalledWith('services', app, 1, launchApp);
    });

    it('selects AI module and launches it through lifecycle guard', () => {
        const app = { id: 'text-model', name: 'Text Model', type: 'api', icon: 'T' } as IApp;
        getSelectedApp.mockReturnValue(undefined);

        flow.performSelectionAction('ai_text', app);

        expect(updateModuleCard).toHaveBeenCalledWith('ai_text', app);
        expect(updateModalSelection).toHaveBeenCalledWith('text-model');
        expect(setSelectedModule).toHaveBeenCalled();
        expect(launchSelectedApp).toHaveBeenCalledWith('ai_text', app, 1, launchApp);
    });

    it('does not launch an existing selection when switching visible state', () => {
        const app = { id: 'svc', name: 'Service', type: 'local' } as IApp;

        flow.activateExistingSelection('services', app);

        expect(launchApp).not.toHaveBeenCalled();
    });

    it('deselects current module and clears persisted selection', () => {
        const app = { id: 'svc', name: 'Service' } as IApp;
        getSelectedApp.mockReturnValue(app);

        flow.performSelectionAction('services', app);

        expect(clearModuleCard).toHaveBeenCalledWith('services');
        expect(updateModalSelection).toHaveBeenCalledWith(null);
        expect(removeSelectedModule).toHaveBeenCalledWith('services');
        expect(stopSelectedApp).toHaveBeenCalledWith(app, 'services');
    });
});
