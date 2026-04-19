import type { IApp } from '@/shared/types/coreTypes';

export type ModuleSettingsRenderPlan =
    | { kind: 'custom-ui' }
    | { kind: 'universal-api' }
    | { kind: 'empty-state' }
    | { kind: 'telegram-bot' }
    | { kind: 'comfyui' }
    | { kind: 'local-engine' }
    | { kind: 'schema' };

const UNIVERSAL_API_PROVIDER_IDS = new Set(['gpt', 'gemini', 'claude', 'deepseek']);
const EMPTY_STATE_MODULE_IDS = new Set(['axelate', 'axelate-platform', 'axelate-localai']);

export function resolveModuleSettingsRenderPlan(app: IApp): ModuleSettingsRenderPlan {
    if (typeof app.settingsUi === 'string' && app.settingsUi.trim() !== '') {
        return { kind: 'custom-ui' };
    }

    if (UNIVERSAL_API_PROVIDER_IDS.has(app.id)) {
        return { kind: 'universal-api' };
    }

    if (EMPTY_STATE_MODULE_IDS.has(app.id)) {
        return { kind: 'empty-state' };
    }

    if (app.id === 'axelate-telegram-bot') {
        return { kind: 'telegram-bot' };
    }

    if (app.id === 'comfyui') {
        return { kind: 'comfyui' };
    }

    if (app.type === 'local') {
        return { kind: 'local-engine' };
    }

    return { kind: 'schema' };
}
