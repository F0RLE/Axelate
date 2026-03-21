import type { IApp } from '@/shared/types/coreTypes';

/**
 * Determines whether an app should be treated as a cloud/API provider.
 *
 * The backend catalog is the source of truth for provider classification, so
 * the frontend should rely on hydrated app metadata instead of hardcoded IDs.
 */
export function isApiApp(app: Pick<IApp, 'type' | 'apiProviderData'> | null | undefined): boolean {
    return app?.type?.toLowerCase() === 'api' || app?.apiProviderData !== undefined;
}
