import type { ISettingField } from './ISettingField';

export class NumberField implements ISettingField<number> {
    private input: HTMLInputElement;

    constructor(initialValue: number) {
        this.input = document.createElement('input');
        this.input.type = 'number';
        this.input.className = 'form-input';
        this.input.value = String(initialValue);
    }

    render(): HTMLElement {
        return this.input;
    }

    getValue(): number {
        return Number(this.input.value);
    }

    onChange(cb: (val: number) => void): void {
        this.input.onchange = () => cb(Number(this.input.value));
    }
}
