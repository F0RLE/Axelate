export const CUSTOM_TEXT_PROVIDER_ID = 'custom-text';
export const CUSTOM_IMAGE_PROVIDER_ID = 'custom-image';

type CustomProviderSpec = {
    readonly id: string;
    readonly capability: 'text' | 'image';
    readonly backendProviderId: string;
    readonly name: string;
    readonly nameKey: string;
    readonly desc: string;
    readonly descKey: string;
    readonly icon: string;
};

const CUSTOM_PROVIDER_SPECS: readonly CustomProviderSpec[] = [
    {
        id: CUSTOM_TEXT_PROVIDER_ID,
        capability: 'text',
        backendProviderId: 'gpt',
        name: 'Custom',
        nameKey: 'ui.launcher.app.custom_text.name',
        desc: 'Use any text model by pasting its model ID manually.',
        descKey: 'ui.launcher.app.custom_text.desc',
        icon: '🔤',
    },
    {
        id: CUSTOM_IMAGE_PROVIDER_ID,
        capability: 'image',
        backendProviderId: 'gpt-image',
        name: 'Custom',
        nameKey: 'ui.launcher.app.custom_image.name',
        desc: 'Use any image model by pasting its model ID manually.',
        descKey: 'ui.launcher.app.custom_image.desc',
        icon: '🪄',
    },
];

export function isCustomProviderId(providerId: string): boolean {
    return CUSTOM_PROVIDER_SPECS.some((provider) => provider.id === providerId);
}

export function isCustomImageProviderId(providerId: string): boolean {
    return providerId === CUSTOM_IMAGE_PROVIDER_ID;
}

export function resolveCustomProviderBackendId(providerId: string): string {
    return (
        CUSTOM_PROVIDER_SPECS.find((provider) => provider.id === providerId)?.backendProviderId ??
        providerId
    );
}

export function getCustomProviderDisplayName(providerId: string): string | null {
    return CUSTOM_PROVIDER_SPECS.find((provider) => provider.id === providerId)?.name ?? null;
}
