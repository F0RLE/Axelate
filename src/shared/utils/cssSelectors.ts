export function escapeCssSelectorValue(value: string): string {
    const cssApi = (globalThis as { CSS?: { escape?: (selector: string) => string } }).CSS;
    if (typeof cssApi?.escape === 'function') {
        return cssApi.escape(value);
    }

    return value.replace(/["\\]/gu, '\\$&');
}
