import type { IApp } from '@/shared/types/coreTypes';

const MODULES_WITHOUT_SETTINGS = new Set(['comfyui']);

export function supportsModuleSettings(app: Pick<IApp, 'id'>): boolean {
    return !MODULES_WITHOUT_SETTINGS.has(app.id);
}
