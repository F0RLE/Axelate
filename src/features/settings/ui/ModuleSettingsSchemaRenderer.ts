import type { IApp, IConfigField } from '@/shared/types/coreTypes';

import { createField } from './components/FieldFactory';

type SettingValue = string | number | boolean | null;

type ModuleSettingsSchemaRendererDeps = {
    getSavedSettings: () => Record<string, SettingValue>;
    onFieldChange: (key: string, value: SettingValue) => void;
    translate: (key: string, defaultValue: string) => string;
};

export class ModuleSettingsSchemaRenderer {
    constructor(private readonly _deps: ModuleSettingsSchemaRendererDeps) {}

    public renderSchemaModuleConfig(container: HTMLElement, app: IApp): void {
        container.innerHTML = '';
        if (app.configSchema !== undefined && Object.keys(app.configSchema).length > 0) {
            const form = document.createElement('div');
            form.className = 'module-settings-form';

            form.appendChild(this.createStandardSettingsNotice());

            const header = document.createElement('h3');
            header.style.marginBottom = '1.5rem';
            header.style.color = 'var(--text-primary)';
            header.textContent = app.name !== undefined && app.name !== '' ? app.name : app.id;
            form.appendChild(header);

            this.renderConfigSchemaFields(form, app);
            container.appendChild(form);
            return;
        }

        this.renderEmptyState(container);
    }

    public renderEmptyState(container: HTMLElement): void {
        const t = this._deps.translate;

        container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'ai-module-config universal-api-theme';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.alignItems = 'center';
        wrapper.style.justifyContent = 'center';
        wrapper.style.width = '100%';
        wrapper.style.padding = '2rem 0';

        const textDiv = document.createElement('div');
        textDiv.style.textAlign = 'center';
        textDiv.style.color = 'var(--text-secondary)';
        textDiv.style.fontSize = '1.2rem';
        textDiv.style.opacity = '0.7';
        textDiv.dataset['i18n'] = 'ui.settings.module_not_ready';
        textDiv.textContent = t('ui.settings.module_not_ready', 'This module is not ready yet.');

        wrapper.appendChild(textDiv);
        container.appendChild(wrapper);
    }

    private renderSettingField(
        form: HTMLElement,
        appId: string,
        key: string,
        field: IConfigField,
    ): void {
        const row = document.createElement('div');
        row.className = 'form-row';

        const label = document.createElement('label');
        label.textContent = field.label || key;
        row.appendChild(label);

        const settingKey = `${appId}_${key}`;
        const initialValue = this._deps.getSavedSettings()[settingKey] ?? field.default;
        const fieldComponent = createField(field, initialValue);

        fieldComponent.onChange((val: unknown) => {
            this._deps.onFieldChange(settingKey, val as SettingValue);
        });

        row.appendChild(fieldComponent.render());

        if (
            field.description !== undefined &&
            field.description !== null &&
            field.description !== ''
        ) {
            const help = document.createElement('p');
            help.className = 'stats-note';
            help.textContent = field.description;
            row.appendChild(help);
        }

        form.appendChild(row);
    }

    private getSortedConfigSchemaEntries(app: IApp): Array<[string, IConfigField]> {
        return Object.entries(app.configSchema ?? {}).sort((left, right) => {
            const leftOrder = left[1].order ?? Number.MAX_SAFE_INTEGER;
            const rightOrder = right[1].order ?? Number.MAX_SAFE_INTEGER;
            if (leftOrder !== rightOrder) {
                return leftOrder - rightOrder;
            }

            const leftLabel = left[1].label || left[0];
            const rightLabel = right[1].label || right[0];
            return leftLabel.localeCompare(rightLabel);
        });
    }

    private renderConfigSchemaFields(form: HTMLElement, app: IApp): void {
        let currentSection: string | null = null;

        this.getSortedConfigSchemaEntries(app).forEach(([key, field]) => {
            const nextSection = field.section?.trim() ?? '';
            if (nextSection !== '' && nextSection !== currentSection) {
                currentSection = nextSection;
                const sectionHeading = document.createElement('h4');
                sectionHeading.className = 'card-title';
                sectionHeading.style.margin = '1.5rem 0 0.75rem';
                sectionHeading.style.fontSize = '0.95rem';
                sectionHeading.textContent = currentSection;
                form.appendChild(sectionHeading);
            }

            this.renderSettingField(form, app.id, key, field);
        });
    }

    private createStandardSettingsNotice(): HTMLElement {
        const note = document.createElement('div');
        note.className = 'module-settings-standard-note';
        note.textContent = this._deps.translate(
            'ui.settings.standard_mode_notice',
            'Standard launcher settings',
        );
        return note;
    }
}
