import type { ISettingField } from './ISettingField';

export class SelectField implements ISettingField<string> {
    private select: HTMLSelectElement;

    constructor(options: string[], initialValue: string) {
        this.select = document.createElement('select');
        this.select.className = 'form-select';

        options.forEach((opt) => {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            if (opt === initialValue) o.selected = true;
            this.select.appendChild(o);
        });
    }

    render(): HTMLElement {
        return this.select;
    }

    getValue(): string {
        return this.select.value;
    }

    onChange(cb: (val: string) => void): void {
        this.select.onchange = () => cb(this.select.value);
    }
}
