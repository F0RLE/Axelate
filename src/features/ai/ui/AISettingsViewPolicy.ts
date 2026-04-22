import {
    CUSTOM_TEXT_PROVIDER_ID,
    isCustomProviderId,
    isCustomImageProviderId,
} from '@/shared/utils/customProviderSupport';

export class AISettingsViewPolicy {
    private static readonly _cleanAppIds = new Set(['axelate', 'axelate-platform']);
    private static readonly _thinkingProviders = new Set(['gemini', 'claude', 'gpt', 'deepseek']);
    private static readonly _imageOnlyProviders = new Set(['gemini-image', 'gpt-image', 'seedream-image']);

    public isCleanApp(appId: string): boolean {
        return AISettingsViewPolicy._cleanAppIds.has(appId) || appId.includes('telegram');
    }

    public supportsInternetAccess(appId: string): boolean {
        return (
            !this.isCleanApp(appId) &&
            !AISettingsViewPolicy._imageOnlyProviders.has(appId) &&
            !isCustomImageProviderId(appId)
        );
    }

    public supportsThinking(appId: string): boolean {
        return AISettingsViewPolicy._thinkingProviders.has(appId) || appId === CUSTOM_TEXT_PROVIDER_ID;
    }

    public isImageOnlyProvider(appId: string): boolean {
        return AISettingsViewPolicy._imageOnlyProviders.has(appId) || isCustomImageProviderId(appId);
    }

    public shouldShowModelStats(appId: string): boolean {
        return !isCustomProviderId(appId);
    }

    public shouldForceThinkingVisibility(appId: string): boolean {
        return appId === CUSTOM_TEXT_PROVIDER_ID;
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
