import type { IApp } from '@/shared/types/coreTypes';

type TranslateFn = (key: string, defaultValue?: string) => string;
type GetCardWidthsFn = () => Record<string, unknown>;
type ApplyCardWidthFn = (card: HTMLElement, width: string) => void;

export class ModuleSettingsViewHelper {
    public closeLanguageDropdowns(event: MouseEvent): void {
        document.querySelectorAll('.lang-dropdown-menu').forEach((dropdown) => {
            const page = dropdown.id.replace('lang-dropdown-menu-', '');
            const button = document.getElementById(`lang-dropdown-btn-${page}`);

            if (
                button !== null &&
                !dropdown.contains(event.target as Node) &&
                !button.contains(event.target as Node)
            ) {
                dropdown.classList.remove('show');
            }
        });
    }

    public loadCardWidths(getCardWidths: GetCardWidthsFn, applyCardWidth: ApplyCardWidthFn): void {
        const widths = getCardWidths();

        Object.keys(widths).forEach((id) => {
            const card = document.querySelector(`.resizable-card[data-card-id="${id}"]`);
            const width = widths[id];

            if (card instanceof HTMLElement && typeof width === 'string') {
                card.dataset['cardWidth'] = width;
                applyCardWidth(card, width);
            }
        });
    }

    public updateCardLayout(card: HTMLElement, width: string): void {
        const container = card.closest('[style*="grid-template-columns"]');
        if (!(container instanceof HTMLElement)) {
            return;
        }

        container.style.gridTemplateColumns = width === 'full' ? '1fr' : '1fr 1fr';
    }

    public showDirtySettingsIndicator(translate: TranslateFn): void {
        const indicator = document.getElementById('save-indicator');
        if (!(indicator instanceof HTMLElement)) {
            return;
        }

        indicator.classList.add('show');
        const span = indicator.querySelector('span');
        if (span instanceof HTMLElement) {
            span.style.color = 'var(--text-secondary)';
            span.textContent = translate('ui.settings.unsaved_changes', 'Unsaved changes');
        }
    }

    public getModuleSettingsTitle(app: IApp, translate: TranslateFn): string {
        const suffix = translate('ui.settings.header_suffix', 'Settings');
        void app;
        return suffix;
    }
}
