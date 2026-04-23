import { open } from '@tauri-apps/plugin-dialog';

import type { EngineConfig } from '@/features/ai/services/EngineConfigService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

import {
    formatEngineFieldSaveValue,
    parseEngineFieldValue,
    setupInitialEngineFieldValue,
} from './ModuleSettingsEngineFieldSupport';

type EngineFieldType = 'number' | 'text' | 'select' | 'password' | 'textarea';
type EngineInputElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

type ModuleSettingsEngineFieldControllerDeps = {
    getSettings: () => Record<string, string | number | undefined>;
    setConfig: (config: EngineConfig) => void;
    debouncedSave: (key: string, value: string | number | boolean | null) => void;
    showSaveIndicator: () => void;
    translate: (key: string, fallback: string) => string;
    getModelFileName: (modelPath: string) => string;
    getModelFileFilters: (
        fileKind: 'model' | 'vae' | 'llm',
        isImage: boolean,
    ) => Array<{ name: string; extensions: string[] }>;
    tracer: Pick<LoggerService, 'error'>;
};

export class ModuleSettingsEngineFieldController {
    constructor(private readonly _deps: ModuleSettingsEngineFieldControllerDeps) {}

    public setupInitialValue(
        input: EngineInputElement,
        options: {
            key: string;
            isEngineConfig: boolean;
            defaultValue?: number | string;
            config: EngineConfig | null;
        },
    ): void {
        setupInitialEngineFieldValue(input, {
            ...options,
            config: options.config as Record<string, string | number | string[] | null> | null,
            settings: this._deps.getSettings(),
        });
    }

    public parseValue(
        raw: string,
        options: {
            type: EngineFieldType;
            min?: number;
            max?: number;
            defaultValue?: number | string;
        },
    ): { value: string | number | null; displayValue: string } {
        return parseEngineFieldValue(raw, options);
    }

    public setupEvents(
        input: EngineInputElement,
        options: {
            key: string;
            type: EngineFieldType;
            isEngineConfig: boolean;
            isFile?: boolean;
            config: EngineConfig | null;
            min?: number;
            max?: number;
            defaultValue?: number | string;
        },
    ): void {
        input.addEventListener('focus', () => {
            input.parentElement?.classList.add('focused');
        });

        input.addEventListener('blur', () => {
            input.parentElement?.classList.remove('focused');
        });

        const handleSave = () => this.handleSave(input, options);

        if (
            options.type === 'text' ||
            options.type === 'number' ||
            options.type === 'password' ||
            options.type === 'textarea'
        ) {
            input.addEventListener('input', handleSave);
        }

        input.addEventListener('change', () => {
            const { displayValue } = this.parseValue(input.value.trim(), options);
            input.value = displayValue;
            handleSave();
        });
    }

    public addFileBrowseButton(
        container: HTMLElement,
        input: HTMLInputElement,
        isImage: boolean,
        fileKind: 'model' | 'vae' | 'llm',
    ): void {
        const browseBtn = document.createElement('button');
        browseBtn.className = 'btn btn-secondary local-engine-browse-btn';
        browseBtn.textContent = this._deps.translate('ui.settings.engine.browse', 'Browse');

        browseBtn.onclick = async () => {
            try {
                const selected = await open({
                    multiple: false,
                    filters: this._deps.getModelFileFilters(fileKind, isImage),
                    title: this._deps.translate(
                        'ui.settings.engine.select_model_file',
                        'Select Model File',
                    ),
                });

                if (selected !== null && !Array.isArray(selected)) {
                    input.dataset['fullPath'] = selected;
                    input.value = this._deps.getModelFileName(selected);
                    input.title = selected;
                    input.dispatchEvent(new Event('change'));
                }
            } catch (error: unknown) {
                this._deps.tracer.error('[ModuleSettingsUI] Failed to open file dialog', error);
            }
        };

        container.appendChild(browseBtn);
    }

    public handleSave(
        input: EngineInputElement,
        options: {
            key: string;
            type: EngineFieldType;
            isEngineConfig: boolean;
            isFile?: boolean;
            config: EngineConfig | null;
            min?: number;
            max?: number;
            defaultValue?: number | string;
        },
    ): void {
        let rawValue = input.value.trim();
        if (options.isFile === true && input instanceof HTMLInputElement) {
            rawValue = input.dataset['fullPath']?.trim() ?? rawValue;
        }
        const { value } = this.parseValue(rawValue, options);

        if (!options.isEngineConfig) {
            this._deps.debouncedSave(options.key, value as string | number | boolean | null);
            return;
        }

        if (options.config !== null) {
            (options.config as unknown as Record<string, string | number | string[] | null>)[
                options.key
            ] = formatEngineFieldSaveValue(options.key, value);
            this._deps.setConfig(options.config);
            this._deps.showSaveIndicator();
        }
    }
}
