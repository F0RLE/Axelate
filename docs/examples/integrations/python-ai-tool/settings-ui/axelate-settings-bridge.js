const CHANNEL = 'axelate:module-settings';

export class AxelateSettingsBridge {
    constructor({ target = window.parent, allowedOrigin = window.location.origin } = {}) {
        this.target = target;
        this.allowedOrigin = allowedOrigin;
        this.pending = new Map();
        this.context = null;
        this.settings = {};
        window.addEventListener('message', (event) => this.handleMessage(event));
    }

    ready() {
        this.target.postMessage({ channel: CHANNEL, type: 'module-ready' }, this.allowedOrigin);
    }

    rendered() {
        this.target.postMessage({ channel: CHANNEL, type: 'module-rendered' }, this.allowedOrigin);
    }

    waitForHost() {
        return new Promise((resolve) => {
            if (this.context !== null) {
                resolve({ context: this.context, settings: this.settings });
                return;
            }

            this.pending.set('host-ready', { resolve });
        });
    }

    saveSettings(settings) {
        return this.request('saveSettings', settings).then((savedSettings) => {
            this.settings = savedSettings;
            return savedSettings;
        });
    }

    request(method, payload) {
        const requestId = crypto.randomUUID();
        this.target.postMessage(
            { channel: CHANNEL, requestId, method, payload },
            this.allowedOrigin,
        );

        return new Promise((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
        });
    }

    handleMessage(event) {
        if (event.origin !== this.allowedOrigin || event.source !== this.target) {
            return;
        }

        const payload = event.data;
        if (payload?.channel !== CHANNEL) {
            return;
        }

        if (payload.type === 'host-ready') {
            this.context = payload.context;
            this.settings = payload.settings ?? {};
            const waiter = this.pending.get('host-ready');
            if (waiter) {
                this.pending.delete('host-ready');
                waiter.resolve({ context: this.context, settings: this.settings });
            }
            return;
        }

        if (typeof payload.requestId !== 'string') {
            return;
        }

        const pending = this.pending.get(payload.requestId);
        if (!pending) {
            return;
        }

        this.pending.delete(payload.requestId);
        if (payload.ok) {
            pending.resolve(payload.result);
        } else {
            pending.reject(new Error(payload.error ?? 'Settings bridge request failed.'));
        }
    }
}
