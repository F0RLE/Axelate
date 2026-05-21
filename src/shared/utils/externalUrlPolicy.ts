const ALLOWED_EXTERNAL_URL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

export function isAllowedExternalUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return ALLOWED_EXTERNAL_URL_PROTOCOLS.has(parsed.protocol);
    } catch {
        return false;
    }
}

export function assertAllowedExternalUrl(url: string): void {
    if (!isAllowedExternalUrl(url)) {
        throw new Error(`Blocked external URL with unsupported protocol: ${url}`);
    }
}
