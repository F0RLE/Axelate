import { CUSTOM_IMAGE_PROVIDER_ID, CUSTOM_TEXT_PROVIDER_ID } from './customProviderSupport';

export const SHARED_CLOUD_KEY_PROVIDER_ID = 'openrouter';

const CLOUD_PROVIDER_IDS = new Set([
    'gpt',
    'gemini',
    'gemini-image',
    'gpt-image',
    'seedream-image',
    'openai',
    'openrouter',
    'anthropic',
    'mistral',
    'claude',
    'deepseek',
    CUSTOM_TEXT_PROVIDER_ID,
    CUSTOM_IMAGE_PROVIDER_ID,
]);

export function isCloudProviderId(providerId: string): boolean {
    return CLOUD_PROVIDER_IDS.has(providerId);
}

export function getSharedCloudSecretService(): string {
    return `${SHARED_CLOUD_KEY_PROVIDER_ID}_api_key`;
}

export function resolveProviderSecretService(providerId: string): string | null {
    if (!isCloudProviderId(providerId)) {
        return null;
    }

    return getSharedCloudSecretService();
}
