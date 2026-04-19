type ChatTranslate = (
    key: string,
    defaultValue?: string,
    params?: Record<string, unknown>,
) => string;

export function safeExtractText(data: unknown, translate: ChatTranslate): string {
    if (typeof data === 'string') return data;
    if (data instanceof Error) return data.message;

    if (typeof data === 'object' && data !== null) {
        return extractFromObject(data as Record<string, unknown>, translate);
    }

    return typeof data === 'number' || typeof data === 'boolean' ? String(data) : '';
}

export function extractErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;

    return String(error);
}

function extractFromObject(value: Record<string, unknown>, translate: ChatTranslate): string {
    if ('message' in value && typeof value['message'] === 'string') return value['message'];
    if ('error' in value && typeof value['error'] === 'string') return value['error'];
    if ('text' in value && typeof value['text'] === 'string') return value['text'];

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return translate('ui.chat.complex_object_fallback', '[Complex object: cannot display]');
    }
}
