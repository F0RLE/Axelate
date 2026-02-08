import type { IConfigField } from '@/shared/types/coreTypes';
import type { ISettingField } from './ISettingField';
import { TextField } from './TextField';
import { NumberField } from './NumberField';
import { ToggleField } from './ToggleField';
import { SelectField } from './SelectField';

export function createField(
    field: IConfigField,
    initialValue: unknown,
): ISettingField {
    switch (field.fieldType) {
        case 'boolean':
            return new ToggleField(Boolean(initialValue));

        case 'number':
            return new NumberField(Number(initialValue));

        case 'select':
            return new SelectField(field.options ?? [], String(initialValue));

        default:
            return new TextField(String(initialValue));
    }
}
