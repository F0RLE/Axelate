type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export type AIBridgeRequestOptions = {
    thinkingLevel?: Exclude<ThinkingLevel, 'off'>;
    maxTokens?: number;
    webSearchEnabled?: boolean;
};

type RequestOptionInput = {
    hasApiKey: boolean;
    maxOutputTokens: number | undefined;
    thinkingLevel: ThinkingLevel | undefined;
    webSearchEnabled: boolean | undefined;
};

export class AIBridgeProviderPolicy {
    private static readonly _cloudProviders = new Set([
        'gpt',
        'gemini',
        'openai',
        'openrouter',
        'anthropic',
        'mistral',
        'claude',
        'deepseek',
    ]);
    private static readonly _imageProviders = new Set([
        'sdcpp',
        'stable-diffusion',
        'comfyui',
    ]);
    private static readonly _managedLocalImageEngines = new Set(['sdcpp', 'stable-diffusion']);

    public isCloudProvider(providerId: string): boolean {
        return AIBridgeProviderPolicy._cloudProviders.has(providerId);
    }

    public isImageProvider(providerId: string): boolean {
        return AIBridgeProviderPolicy._imageProviders.has(providerId);
    }

    public isManagedLocalImageEngine(providerId: string): boolean {
        return AIBridgeProviderPolicy._managedLocalImageEngines.has(providerId);
    }

    public buildRequestOptions(input: RequestOptionInput): AIBridgeRequestOptions {
        if (!input.hasApiKey) {
            return {};
        }

        const requestOptions: AIBridgeRequestOptions = {};
        const effectiveThinkingLevel =
            input.thinkingLevel !== 'off' ? input.thinkingLevel : undefined;

        if (effectiveThinkingLevel !== undefined) {
            requestOptions.thinkingLevel = effectiveThinkingLevel;
        }

        if (input.maxOutputTokens !== undefined) {
            requestOptions.maxTokens = input.maxOutputTokens;
        }

        if (input.webSearchEnabled === true) {
            requestOptions.webSearchEnabled = true;
        }

        return requestOptions;
    }

    public isImagePerformanceModeEnabled(
        settings: Record<string, unknown> | undefined,
        settingsKey: string,
    ): boolean {
        return (
            this._readBooleanSetting(settings, `${settingsKey}_performance_mode`) ||
            this._readBooleanSetting(settings, 'sdcpp_performance_mode')
        );
    }

    private _readBooleanSetting(
        settings: Record<string, unknown> | undefined,
        key: string,
    ): boolean {
        const value = settings?.[key];
        if (typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'string') {
            return value.trim().toLowerCase() === 'true';
        }

        return false;
    }
}
