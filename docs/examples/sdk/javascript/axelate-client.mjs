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

        const body = await response.json();
        if (!response.ok) {
            throw new Error(body.error ?? `Axelate request failed: ${response.status}`);
        }

        return body;
    }

    settings() {
        return this.request('GET', `/v1/modules/${this.moduleId}/settings`).then(
            (body) => body.settings ?? {},
        );
    }

    saveSettings(settings) {
        return this.request('PUT', `/v1/modules/${this.moduleId}/settings`, settings);
    }

    stage(stage, label, progress) {
        const payload = { stage, label };
        if (progress !== undefined) {
            payload.progress = progress;
        }
        return this.request('POST', `/v1/modules/${this.moduleId}/stage`, payload);
    }

    aiText(prompt, options = {}) {
        return this.request('POST', '/v1/ai/text', {
            prompt,
            sessionId: this.moduleId,
            ...options,
        });
    }
}
