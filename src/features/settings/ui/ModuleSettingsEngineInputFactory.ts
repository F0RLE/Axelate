type EngineFieldType = 'number' | 'text' | 'select' | 'password' | 'textarea';
type EngineInputElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export type ModuleSettingsEngineInputFactoryDeps = {
    requestAnimationFrame: (callback: FrameRequestCallback) => number;
};

export type ModuleSettingsEngineControlOptions = {
    type: EngineFieldType;
    placeholder?: string;
    min?: number;
    max?: number;
};

export class ModuleSettingsEngineInputFactory {
    public constructor(private readonly _deps: ModuleSettingsEngineInputFactoryDeps) {}

    public createTextAreaField(
        options: Pick<ModuleSettingsEngineControlOptions, 'placeholder'>,
    ): HTMLTextAreaElement {
        const textArea = document.createElement('textarea');
        textArea.className = 'settings-input local-engine-input local-engine-input--textarea';
        if (options.placeholder !== undefined && options.placeholder !== '') {
            textArea.placeholder = options.placeholder;
        }

        const autoResize = () => {
            textArea.style.height = 'auto';
            const extra = textArea.offsetHeight - textArea.clientHeight;
            textArea.style.height = `${textArea.scrollHeight + extra}px`;
        };

        textArea.addEventListener('input', autoResize);

        const valueDesc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (valueDesc?.set !== undefined) {
            const requestAnimationFrame = this._deps.requestAnimationFrame;
            Object.defineProperty(textArea, 'value', {
                set(v: string) {
                    valueDesc.set?.call(textArea, v);
                    requestAnimationFrame(autoResize);
                },
                get(): string {
                    const currentValue = valueDesc.get?.call(textArea) as unknown;
                    return typeof currentValue === 'string' ? currentValue : '';
                },
            });
        }

        this._deps.requestAnimationFrame(autoResize);
        return textArea;
    }

    public createTextInputField(
        options: Pick<ModuleSettingsEngineControlOptions, 'type' | 'placeholder' | 'min' | 'max'>,
    ): HTMLInputElement {
        const textInput = document.createElement('input');
        textInput.type = options.type;
        textInput.className = 'settings-input local-engine-input';
        if (options.type === 'number') {
            textInput.inputMode = 'numeric';
        }
        if (options.placeholder !== undefined && options.placeholder !== '') {
            textInput.placeholder = options.placeholder;
        }
        if (options.min !== undefined) {
            textInput.min = String(options.min);
        }
        if (options.max !== undefined) {
            textInput.max = String(options.max);
        }
        return textInput;
    }

    public createBasicControl(options: ModuleSettingsEngineControlOptions): EngineInputElement {
        if (options.type === 'textarea') {
            return this.createTextAreaField(options);
        }

        return this.createTextInputField(options);
    }
}
