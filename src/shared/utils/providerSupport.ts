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

const IMAGE_PROVIDER_IDS = new Set([
    'sdcpp',
    'stable-diffusion',
    'comfyui',
    'gemini-image',
    'gpt-image',
    'seedream-image',
    CUSTOM_IMAGE_PROVIDER_ID,
]);

const MANAGED_LOCAL_IMAGE_PROVIDER_IDS = new Set(['sdcpp', 'stable-diffusion']);

export function isCloudProviderId(providerId: string): boolean {
    return CLOUD_PROVIDER_IDS.has(providerId);
}

export function isImageProviderId(providerId: string): boolean {
    return IMAGE_PROVIDER_IDS.has(providerId);
}

export function isManagedLocalImageProviderId(providerId: string): boolean {
    return MANAGED_LOCAL_IMAGE_PROVIDER_IDS.has(providerId);
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
