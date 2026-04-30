export type ChatImagePayload = {
    mime: string;
    data_base64: string;
};

const allowedImageMimePattern = /^image\/(?:png|jpe?g|gif|webp|bmp|avif)$/iu;

export function normalizeImageMime(mime: string): string | null {
    const normalized = mime.trim().toLowerCase();
    return allowedImageMimePattern.test(normalized) ? normalized : null;
}

export function normalizeImageBase64(data: string): string | null {
    const normalized = data.replaceAll(/\s+/gu, '');
    if (normalized === '') {
        return null;
    }
    return /^[A-Za-z0-9+/]+={0,2}$/u.test(normalized) ? normalized : null;
}

export function normalizeImagePayload(image: ChatImagePayload): ChatImagePayload | null {
    const mime = normalizeImageMime(image.mime);
    const dataBase64 = normalizeImageBase64(image.data_base64);
    if (mime === null || dataBase64 === null) {
        return null;
    }

    return {
        mime,
        data_base64: dataBase64,
    };
}

export function buildSafeImageDataUrl(image: ChatImagePayload): string | null {
    const normalized = normalizeImagePayload(image);
    if (normalized === null) {
        return null;
    }

    return `data:${normalized.mime};base64,${normalized.data_base64}`;
}

export function isSafeImageDataUrl(dataUrl: string): boolean {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/iu.exec(dataUrl.trim());
    if (match === null) {
        return false;
    }

    const mime = match[1];
    const dataBase64 = match[2];
    return (
        mime !== undefined &&
        dataBase64 !== undefined &&
        normalizeImageMime(mime) !== null &&
        normalizeImageBase64(dataBase64) !== null
    );
}
