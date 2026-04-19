import type { IApp } from '../../types/coreTypes';

export class ModalSelectionPolicy {
    public getModalTitleInfo(category: string): { key: string; defaultText: string } {
        if (category === 'ai' || category === 'ai_text') {
            return {
                key: 'ui.launcher.modules.modal.ai_title',
                defaultText: 'Select AI Module',
            };
        }

        if (category === 'ai_image') {
            return {
                key: 'ui.launcher.modules.modal.ai_image_title',
                defaultText: 'Select Image AI',
            };
        }

        return {
            key: 'ui.launcher.modules.modal.services_title',
            defaultText: 'Select Service',
        };
    }

    public getVisibleApps(apps: IApp[], category: string, currentFilter: 'text' | 'image'): IApp[] {
        const isAi = category === 'ai' || category.startsWith('ai_');
        const filteredApps = isAi
            ? apps.filter((app) => (app.capability ?? 'text') === currentFilter)
            : apps;

        return this.getSortedApps(filteredApps);
    }

    public getButtonState(
        card: HTMLElement,
        isSelected: boolean,
    ): {
        className: string;
        key: string;
        defaultLabel: string;
    } {
        if (!isSelected) {
            return {
                className: 'modal-btn modal-btn-primary',
                key: 'ui.launcher.modules.modal.btn_select',
                defaultLabel: 'Select',
            };
        }

        const isStarting =
            card.classList.contains('engine-starting') ||
            card.classList.contains('engine-swapping');

        if (isStarting) {
            return {
                className: 'modal-btn modal-btn-secondary active-module-btn',
                key: 'ui.launcher.modules.modal.btn_booting',
                defaultLabel: 'Booting...',
            };
        }

        return {
            className: 'modal-btn modal-btn-secondary',
            key: 'ui.launcher.modules.modal.btn_remove',
            defaultLabel: 'Убрать',
        };
    }

    public shouldShowFilterTabs(rawCategory: string): boolean {
        return rawCategory === 'ai';
    }

    public hasImageApps(apps: IApp[]): boolean {
        return apps.some((app) => app.capability === 'image');
    }

    private getSortedApps(apps: IApp[]): IApp[] {
        const priority = ['axelate', 'gpt', 'gemini'];

        return [...apps].sort((a, b) => {
            const idA = a.id.toLowerCase();
            const idB = b.id.toLowerCase();
            const nameA = (a.name ?? a.id).toLowerCase();
            const nameB = (b.name ?? b.id).toLowerCase();
            const getPriority = (id: string): number => {
                const index = priority.findIndex((item) => id.includes(item));
                return index === -1 ? 999 : index;
            };

            const priorityDiff = getPriority(idA) - getPriority(idB);
            if (priorityDiff !== 0) {
                return priorityDiff;
            }

            if ((a.installed === true) !== (b.installed === true)) {
                return a.installed === true ? -1 : 1;
            }

            return nameA.localeCompare(nameB);
        });
    }
}
