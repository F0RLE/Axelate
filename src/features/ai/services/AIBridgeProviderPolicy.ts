import type { IApp } from '@/shared/types/coreTypes';

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

type ProviderCatalogGetter = () => { ai?: unknown[] } | null | undefined;

export class AIBridgeProviderPolicy {
    public constructor(private readonly _getCatalog?: ProviderCatalogGetter) {}

    public isCloudProvider(providerId: string): boolean {
        const policy = this._catalogProvider(providerId)?.providerPolicy;
        return policy?.isCloudProvider ?? true;
    }

    public isImageProvider(providerId: string): boolean {
        return this._catalogCapability(providerId) === 'image';
    }

    public isManagedLocalImageEngine(providerId: string): boolean {
        return !this.isCloudProvider(providerId) && this.isImageProvider(providerId);
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

    private _catalogCapability(providerId: string): IApp['capability'] | null {
        return this._catalogProvider(providerId)?.capability ?? null;
    }

    private _catalogProvider(providerId: string): Partial<IApp> | null {
        const catalog = this._getCatalog?.();
        const ai = catalog?.ai;
        if (!Array.isArray(ai)) {
            return null;
        }

        return (
            ai.find((entry): entry is Partial<IApp> => {
                return (
                    typeof entry === 'object' &&
                    entry !== null &&
                    (entry as Partial<IApp>).id === providerId
                );
            }) ?? null
        );
    }
}
