import type { IApp } from '@/shared/types/coreTypes';

export class AISettingsViewPolicy {
    public isCleanApp(app: IApp | string): boolean {
        const policy = typeof app === 'string' ? null : app.providerPolicy;
        if (policy?.isCleanApp !== undefined) {
            return policy.isCleanApp;
        }

        return false;
    }

    public supportsInternetAccess(app: IApp): boolean {
        return app.providerPolicy?.supportsInternetAccess ?? false;
    }

    public supportsThinking(app: IApp): boolean {
        return app.providerPolicy?.supportsThinking ?? false;
    }

    public isImageOnlyProvider(app: IApp): boolean {
        return app.providerPolicy?.imageOnly ?? app.capability === 'image';
    }

    public shouldShowModelStats(app: IApp): boolean {
        return app.providerPolicy?.showModelStats ?? true;
    }

    public shouldForceThinkingVisibility(app: IApp): boolean {
        return app.providerPolicy?.supportsThinking === true && this.supportsThinking(app);
    }

    public formatCompactContext(contextWindow: number): string {
        if (contextWindow >= 1_000_000) {
            const millions = contextWindow / 1_000_000;
            return `${millions
                .toFixed(millions >= 10 ? 0 : 2)
                .replace(/\.00$/, '')
                .replace(/(\.\d)0$/, '$1')}M`;
        }

        if (contextWindow >= 1_000) {
            const thousands = contextWindow / 1_000;
            return `${thousands.toFixed(thousands >= 100 ? 0 : 1).replace(/\.0$/, '')}K`;
        }

        return String(contextWindow);
    }
}
