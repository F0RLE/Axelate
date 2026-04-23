import type { ISettingField } from './ISettingField';

export class NumberField implements ISettingField<number> {
    private readonly input: HTMLInputElement;

    constructor(
        initialValue: number,
        options?: {
            mode?: 'number' | 'range';
            min?: number;
            max?: number;
            step?: number;
        },
    ) {
        this.input = document.createElement('input');
        this.input.type = options?.mode ?? 'number';
        this.input.className = 'form-input';
        this.input.value = String(initialValue);
        if (options?.min !== undefined) this.input.min = String(options.min);
        if (options?.max !== undefined) this.input.max = String(options.max);
        if (options?.step !== undefined) this.input.step = String(options.step);
    }

    render(): HTMLElement {
        return this.input;
    }

    getValue(): number {
        return Number(this.input.value);
    }

    onChange(cb: (val: number) => void): void {
        this.input.onchange = () => {
            cb(Number(this.input.value));
        };
    }
}
