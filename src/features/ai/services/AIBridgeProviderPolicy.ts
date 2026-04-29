import {
    isCloudProviderId,
    isImageProviderId,
    isManagedLocalImageProviderId,
} from '@/shared/utils/providerSupport';

type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';
type CloudReasoningEffort = 'none' | Exclude<ThinkingLevel, 'off'>;

export type AIBridgeRequestOptions = {
    thinkingLevel?: CloudReasoningEffort;
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
    public isCloudProvider(providerId: string): boolean {
        return isCloudProviderId(providerId);
    }

    public isImageProvider(providerId: string): boolean {
        return isImageProviderId(providerId);
    }

    public isManagedLocalImageEngine(providerId: string): boolean {
        return isManagedLocalImageProviderId(providerId);
    }

    public isLocalTextProvider(providerId: string): boolean {
        return !this.isCloudProvider(providerId) && !this.isImageProvider(providerId);
    }

    public buildRequestOptions(input: RequestOptionInput): AIBridgeRequestOptions {
        if (!input.hasApiKey) {
            return {};
        }

        const requestOptions: AIBridgeRequestOptions = {};
        const effectiveThinkingLevel: CloudReasoningEffort | undefined =
            input.thinkingLevel === undefined
                ? undefined
                : input.thinkingLevel === 'off'
                  ? 'none'
                  : input.thinkingLevel;

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
}
