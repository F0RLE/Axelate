import type { IApp } from '@/shared/types/coreTypes';

export const CUSTOM_TEXT_PROVIDER_ID = 'openrouter-custom-text';
export const CUSTOM_IMAGE_PROVIDER_ID = 'openrouter-custom-image';

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
        desc: 'Use any OpenRouter text model by pasting its model ID manually.',
        descKey: 'ui.launcher.app.custom_text.desc',
        icon: '🔤',
    },
    {
        id: CUSTOM_IMAGE_PROVIDER_ID,
        capability: 'image',
        backendProviderId: 'gpt-image',
        name: 'Custom',
        nameKey: 'ui.launcher.app.custom_image.name',
        desc: 'Use any OpenRouter image model by pasting its model ID manually.',
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

export function appendCustomProviderApps(apps: IApp[]): IApp[] {
    const byId = new Map(apps.map((app) => [app.id, app]));

    CUSTOM_PROVIDER_SPECS.forEach((provider) => {
        if (byId.has(provider.id)) {
            return;
        }

        byId.set(provider.id, {
            id: provider.id,
            name: provider.name,
            nameKey: provider.nameKey,
            desc: provider.desc,
            descKey: provider.descKey,
            icon: provider.icon,
            category: 'ai',
            type: 'api',
            capability: provider.capability,
            installed: true,
            apiProviderData: {
                id: provider.id,
                type: 'api',
                baseUrl: 'https://openrouter.ai/api/v1',
                models: [],
            },
        });
    });

    return Array.from(byId.values());
}
