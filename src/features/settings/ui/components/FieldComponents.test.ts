import { describe, expect, it } from 'vitest';
import { createField } from './FieldFactory';
import { NumberField } from './NumberField';
import { SelectField } from './SelectField';
import { TextField } from './TextField';
import { ToggleField } from './ToggleField';

describe('setting field components', () => {
    it('creates a text field by default', () => {
        const field = createField({ fieldType: 'text' } as never, 'hello');
        expect(field).toBeInstanceOf(TextField);
        expect(field.render()).toBeInstanceOf(HTMLInputElement);
        expect(field.getValue()).toBe('hello');
    });

    it('creates a number field and emits numeric changes', () => {
        const field = createField({ fieldType: 'number' } as never, 42) as NumberField;
        expect(field).toBeInstanceOf(NumberField);

        const input = field.render() as HTMLInputElement;
        let nextValue = 0;
        field.onChange((value) => {
            nextValue = value;
        });

        input.value = '17';
        input.dispatchEvent(new Event('change'));

        expect(field.getValue()).toBe(17);
        expect(nextValue).toBe(17);
    });

    it('creates a toggle field and emits boolean changes', () => {
        const field = createField({ fieldType: 'boolean' } as never, true) as ToggleField;
        expect(field).toBeInstanceOf(ToggleField);

        const wrapper = field.render();
        const input = wrapper.querySelector('input') as HTMLInputElement;
        let nextValue = true;
        field.onChange((value) => {
            nextValue = value;
        });

        input.checked = false;
        input.dispatchEvent(new Event('change'));

        expect(field.getValue()).toBe(false);
        expect(nextValue).toBe(false);
        expect(wrapper.classList.contains('form-toggle')).toBe(true);
    });

    it('creates a select field with options and emits string changes', () => {
        const field = createField(
            { fieldType: 'select', options: ['low', 'medium', 'high'] } as never,
            'medium',
        ) as SelectField;
        expect(field).toBeInstanceOf(SelectField);

        const select = field.render() as HTMLSelectElement;
        let nextValue = '';
        field.onChange((value) => {
            nextValue = value;
        });

        expect(select.value).toBe('medium');
        select.value = 'high';
        select.dispatchEvent(new Event('change'));

        expect(field.getValue()).toBe('high');
        expect(nextValue).toBe('high');
    });

    it('text field emits raw string changes', () => {
        const field = new TextField('alpha');
        const input = field.render() as HTMLInputElement;
        let nextValue = '';
        field.onChange((value) => {
            nextValue = value;
        });

        input.value = 'beta';
        input.dispatchEvent(new Event('change'));

        expect(field.getValue()).toBe('beta');
        expect(nextValue).toBe('beta');
    });
});
