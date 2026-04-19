import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModuleSettingsModalController } from './ModuleSettingsModalController';

describe('ModuleSettingsModalController', () => {
    const navigation = {
        pushBackAction: vi.fn(),
        removeBackAction: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = `
            <dialog id="module-settings-modal" class="hidden"></dialog>
            <button id="close-module-settings-btn" type="button"></button>
            <div id="sidebar"></div>
            <div id="app-header"></div>
            <div class="models-container"></div>
            <div class="page"></div>
        `;

        const modal = document.getElementById('module-settings-modal') as HTMLDialogElement;
        modal.showModal = vi.fn(function (this: HTMLDialogElement) {
            this.open = true;
        });
        modal.close = vi.fn(function (this: HTMLDialogElement) {
            this.open = false;
        });

    });

    it('opens modal, hides background and wires close actions', () => {
        const closeAppSelection = vi.fn();
        const controller = new ModuleSettingsModalController(navigation as never, {
            closeAppSelection,
        });
        const onClose = vi.fn();
        const onReopen = vi.fn();

        const modal = controller.open('svc', onClose, onReopen) as HTMLDialogElement;

        expect(modal.open).toBe(true);
        expect(navigation.pushBackAction).toHaveBeenCalled();
        expect(closeAppSelection).toHaveBeenCalledTimes(1);
        expect(document.body.classList.contains('settings-modal-open')).toBe(true);
        expect(document.getElementById('sidebar')?.classList.contains('content-hidden')).toBe(true);

        (document.getElementById('close-module-settings-btn') as HTMLButtonElement).click();
        expect(onClose).toHaveBeenCalled();
    });

    it('closes modal and restores background visibility', () => {
        const controller = new ModuleSettingsModalController(navigation as never, {
            closeAppSelection: vi.fn(),
        });
        controller.open('svc', vi.fn(), vi.fn());

        controller.close();

        expect(navigation.removeBackAction).toHaveBeenCalledWith('module-settings-modal');
        expect(document.body.classList.contains('settings-modal-open')).toBe(false);
        expect(document.getElementById('sidebar')?.classList.contains('content-hidden')).toBe(
            false,
        );
    });
});
