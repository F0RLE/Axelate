import type { ISettingField } from './ISettingField';

export class ToggleField implements ISettingField<boolean> {
    private readonly checkbox: HTMLInputElement;
    private readonly wrapper: HTMLElement;

    constructor(initialValue: boolean) {
        this.checkbox = document.createElement('input');
        this.checkbox.type = 'checkbox';
        this.checkbox.checked = initialValue;

        this.wrapper = document.createElement('div');
        this.wrapper.className = 'form-toggle';
        
        // Add Slider/Switch logic if needed visually, for now raw checkbox wrapped
        // Assuming CSS handles .form-toggle checkbox styling
        const slider = document.createElement('span');
        slider.className = 'slider round'; // Valid CSS assumption based on common toggles
        
        const label = document.createElement('label');
        label.className = 'switch';
        label.appendChild(this.checkbox);
        label.appendChild(slider);
        
        this.wrapper.appendChild(label);
    }

    render(): HTMLElement {
        return this.wrapper;
    }

    getValue(): boolean {
        return this.checkbox.checked;
    }

    onChange(cb: (val: boolean) => void): void {
        this.checkbox.onchange = () => cb(this.checkbox.checked);
    }
}
