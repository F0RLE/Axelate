type EngineFieldType = 'number' | 'text' | 'select' | 'password' | 'textarea';

type EngineFieldValue = string | number | string[] | null | undefined;

type EngineFieldInitialOptions = {
    key: string;
    isEngineConfig: boolean;
    defaultValue?: number | string;
    config: Record<string, EngineFieldValue> | null;
    settings: Record<string, string | number | undefined>;
};

type EngineFieldParseOptions = {
    type: EngineFieldType;
    min?: number;
    max?: number;
    defaultValue?: number | string;
};

export type EngineFieldParsedValue = {
    value: string | number | null;
    displayValue: string;
};

export function setupInitialEngineFieldValue(
    input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    options: EngineFieldInitialOptions,
): void {
    if (options.isEngineConfig) {
        setInitialEngineConfigValue(input, options.key, options.config);
        return;
    }

    setInitialEngineSettingsValue(input, options.key, options.defaultValue, options.settings);
}

export function parseEngineFieldValue(
    raw: string,
    options: EngineFieldParseOptions,
): EngineFieldParsedValue {
    if (options.type === 'number') {
        return parseNumberFieldValue(raw, options);
    }
    if (options.type === 'select') {
        return parseSelectFieldValue(raw, options.defaultValue);
    }
    return { value: raw === '' ? null : raw, displayValue: raw };
}

export function formatEngineFieldSaveValue(
    key: string,
    value: string | number | null,
): string | number | string[] | null {
    if (key === 'extra_args') {
        if (typeof value === 'string') {
            return value.trim() ? value.trim().split(/\s+/) : [];
        }
        return [];
    }

    return value;
}

function setInitialEngineConfigValue(
    input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    key: string,
    config: Record<string, EngineFieldValue> | null,
): void {
    if (config === null) {
        return;
    }

    let value = config[key];
    if (value === undefined) {
        return;
    }

    if (key === 'extra_args' && Array.isArray(value)) {
        value = value.join(' ');
    }

    const stringValue = String(value);
    input.value = stringValue;
    input.title = stringValue;
}

function setInitialEngineSettingsValue(
    input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    key: string,
    defaultValue: number | string | undefined,
    settings: Record<string, string | number | undefined>,
): void {
    const value = settings[key];
    if (value !== undefined) {
        input.value = String(value);
        return;
    }

    if (defaultValue !== undefined) {
        input.value = String(defaultValue);
    }
}

function parseNumberFieldValue(
    raw: string,
    options: Pick<EngineFieldParseOptions, 'min' | 'max' | 'defaultValue'>,
): EngineFieldParsedValue {
    if (raw === '') {
        return { value: null, displayValue: '' };
    }

    let numberValue = Number(raw);
    if (Number.isNaN(numberValue)) {
        const defaultValue = options.defaultValue as number | undefined;
        return {
            value: defaultValue ?? null,
            displayValue: defaultValue === undefined ? '' : String(defaultValue),
        };
    }

    if (options.min !== undefined && numberValue < options.min) {
        numberValue = options.min;
    }
    if (options.max !== undefined && numberValue > options.max) {
        numberValue = options.max;
    }

    return { value: numberValue, displayValue: String(numberValue) };
}

function parseSelectFieldValue(
    raw: string,
    defaultValue?: number | string,
): EngineFieldParsedValue {
    if (raw === '') {
        const stringDefaultValue = defaultValue as string | undefined;
        return {
            value: stringDefaultValue ?? null,
            displayValue: stringDefaultValue === undefined ? '' : String(stringDefaultValue),
        };
    }

    return { value: raw, displayValue: raw };
}
