export class AxelateClient {
    constructor(env = globalThis.process?.env ?? {}) {
        this.baseUrl = String(env.AXELATE_HTTP_API_BASE ?? '').replace(/\/$/u, '');
        this.token = String(env.AXELATE_HTTP_API_TOKEN ?? '');
        this.moduleId = String(env.AXELATE_MODULE_ID ?? '');

        if (!this.baseUrl || !this.token || !this.moduleId) {
            throw new Error('Axelate integration environment is missing.');
        }
    }

    async request(method, path, payload) {
        const response = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${this.token}`,
                'Content-Type': 'application/json',
            },
            body: payload === undefined ? undefined : JSON.stringify(payload),
        });

        const body = await readResponseBody(response);
        if (!response.ok) {
            const message =
                body && typeof body === 'object' && 'error' in body
                    ? body.error
                    : `Axelate request failed: ${response.status}`;
            throw new Error(String(message));
        }

        return body;
    }

    settings() {
        return this.request('GET', `/v1/modules/${encodeURIComponent(this.moduleId)}/settings`).then(
            (body) => body.settings ?? {},
        );
    }

    saveSettings(settings) {
        return this.request(
            'PUT',
            `/v1/modules/${encodeURIComponent(this.moduleId)}/settings`,
            settings,
        );
    }

    stage(stage, label, progress) {
        const payload = { stage, label };
        if (progress !== undefined) {
            payload.progress = progress;
        }
        return this.request('POST', `/v1/modules/${encodeURIComponent(this.moduleId)}/stage`, payload);
    }

    aiText(prompt, options = {}) {
        return this.request('POST', '/v1/ai/text', {
            prompt,
            sessionId: this.moduleId,
            ...options,
        });
    }
}

async function readResponseBody(response) {
    if (response.status === 204) {
        return {};
    }

    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    if (text.length === 0) {
        return {};
    }

    if (contentType.includes('application/json')) {
        return JSON.parse(text);
    }

    return { text };
}
