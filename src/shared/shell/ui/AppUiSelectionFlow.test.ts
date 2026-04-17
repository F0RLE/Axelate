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
        });
        (globalThis as unknown as {
            uiState?: {
                removeSelectedModule: ReturnType<typeof vi.fn>;
                setSelectedModule: ReturnType<typeof vi.fn>;
            };
            launchApp?: ReturnType<typeof vi.fn>;
        }).uiState = {
            removeSelectedModule: vi.fn(),
            setSelectedModule: vi.fn(),
        };
        (globalThis as unknown as { launchApp?: ReturnType<typeof vi.fn> }).launchApp = vi
            .fn()
            .mockResolvedValue(undefined);
    });

    it('selects module, persists it and launches it', () => {
        const app = { id: 'svc', name: 'Service', type: 'local', icon: 'S', desc: 'Desc' } as IApp;
        getSelectedApp.mockReturnValue(undefined);

        flow.performSelectionAction('services', app);

        expect(updateModuleCard).toHaveBeenCalledWith('services', app);
        expect(updateModalSelection).toHaveBeenCalledWith('svc');
        expect(
            (
                globalThis as unknown as {
                    uiState: { setSelectedModule: ReturnType<typeof vi.fn> };
                }
            ).uiState.setSelectedModule,
        ).toHaveBeenCalled();
        expect(launchSelectedApp).toHaveBeenCalled();
    });

    it('deselects current module and clears persisted selection', () => {
        const app = { id: 'svc', name: 'Service' } as IApp;
        getSelectedApp.mockReturnValue(app);

        flow.performSelectionAction('services', app);

        expect(clearModuleCard).toHaveBeenCalledWith('services');
        expect(updateModalSelection).toHaveBeenCalledWith(null);
        expect(
            (
                globalThis as unknown as {
                    uiState: { removeSelectedModule: ReturnType<typeof vi.fn> };
                }
            ).uiState.removeSelectedModule,
        ).toHaveBeenCalledWith('services');
        expect(stopSelectedApp).toHaveBeenCalledWith(app);
    });
});
