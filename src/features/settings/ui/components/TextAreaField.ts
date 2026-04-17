import type { ISettingField } from './ISettingField';

export class TextAreaField implements ISettingField<string> {
    private readonly textarea: HTMLTextAreaElement;

    constructor(
        initialValue: string,
        options?: {
            placeholder?: string;
            rows?: number;
        },
    ) {
        this.textarea = document.createElement('textarea');
        this.textarea.className = 'form-input';
        this.textarea.value = initialValue;
        this.textarea.rows = options?.rows ?? 4;
        if (options?.placeholder !== undefined && options.placeholder !== '') {
            this.textarea.placeholder = options.placeholder;
        }
    }

    render(): HTMLElement {
        return this.textarea;
    }

    getValue(): string {
        return this.textarea.value;
    }

    onChange(cb: (val: string) => void): void {
        this.textarea.onchange = () => {
            cb(this.textarea.value);
        };
    }
}
