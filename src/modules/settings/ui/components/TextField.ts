import type { ISettingField } from './ISettingField';

export class TextField implements ISettingField<string> {
    private input: HTMLInputElement;

    constructor(initialValue: string) {
        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.className = 'form-input';
        this.input.value = initialValue;
    }

    render(): HTMLElement {
        return this.input;
    }

    getValue(): string {
        return this.input.value;
    }

    onChange(cb: (val: string) => void): void {
        this.input.onchange = () => cb(this.input.value);
    }
}
