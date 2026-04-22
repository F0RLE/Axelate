import type { IConfigField } from '@/shared/types/coreTypes';
import type { ISettingField } from './ISettingField';
import { TextField } from './TextField';
import { NumberField } from './NumberField';
import { ToggleField } from './ToggleField';
import { SelectField } from './SelectField';
import { TextAreaField } from './TextAreaField';

export function createField(field: IConfigField, initialValue: unknown): ISettingField {
    switch (field.fieldType) {
        case 'boolean':
            return new ToggleField(Boolean(initialValue));

        case 'number':
            return new NumberField(Number(initialValue), {
                mode: 'number',
                ...(field.min !== undefined && field.min !== null ? { min: field.min } : {}),
                ...(field.max !== undefined && field.max !== null ? { max: field.max } : {}),
                ...(field.step !== undefined && field.step !== null ? { step: field.step } : {}),
            });

        case 'range':
        case 'slider':
            return new NumberField(Number(initialValue), {
                mode: 'range',
                ...(field.min !== undefined && field.min !== null ? { min: field.min } : {}),
                ...(field.max !== undefined && field.max !== null ? { max: field.max } : {}),
                ...(field.step !== undefined && field.step !== null ? { step: field.step } : {}),
            });

        case 'select':
            return new SelectField(field.options ?? [], String(initialValue));

        case 'textarea':
            return new TextAreaField(String(initialValue ?? ''), {
                ...(field.placeholder !== undefined && field.placeholder !== null
                    ? { placeholder: field.placeholder }
                    : {}),
                ...(field.rows !== undefined && field.rows !== null ? { rows: field.rows } : {}),
            });

        case 'password':
            return new TextField(String(initialValue ?? ''), {
                type: 'password',
                ...(field.placeholder !== undefined && field.placeholder !== null
                    ? { placeholder: field.placeholder }
                    : {}),
            });

        default:
            return new TextField(String(initialValue ?? ''), {
                ...(field.placeholder !== undefined && field.placeholder !== null
                    ? { placeholder: field.placeholder }
                    : {}),
            });
    }
}
