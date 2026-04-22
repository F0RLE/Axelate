import type { IApp } from '@/shared/types/coreTypes';
import { isCustomProviderId } from '@/shared/utils/customProviderSupport';

export type ModuleSettingsRenderPlan =
    | { kind: 'custom-ui' }
    | { kind: 'universal-api' }
    | { kind: 'empty-state' }
    | { kind: 'telegram-bot' }
    | { kind: 'local-engine' }
    | { kind: 'schema' };

const UNIVERSAL_API_PROVIDER_IDS = new Set([
    'gpt',
    'gemini',
    'gemini-image',
    'gpt-image',
    'seedream-image',
    'claude',
    'deepseek',
]);
const EMPTY_STATE_MODULE_IDS = new Set(['axelate', 'axelate-platform', 'axelate-localai']);

export function resolveModuleSettingsRenderPlan(app: IApp): ModuleSettingsRenderPlan {
    if (UNIVERSAL_API_PROVIDER_IDS.has(app.id) || isCustomProviderId(app.id)) {
        return { kind: 'universal-api' };
    }

    if (EMPTY_STATE_MODULE_IDS.has(app.id)) {
        return { kind: 'empty-state' };
    }

    if (typeof app.settingsUi === 'string' && app.settingsUi.trim() !== '') {
        return { kind: 'custom-ui' };
    }

    if (app.id === 'axelate-telegram-bot') {
        return { kind: 'telegram-bot' };
    }

    if (app.type === 'local') {
        return { kind: 'local-engine' };
    }

    return { kind: 'schema' };
}
