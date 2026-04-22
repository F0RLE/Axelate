import { describe, expect, it } from 'vitest';

import { resolveModuleSettingsRenderPlan } from './ModuleSettingsRenderPlan';
import { CUSTOM_TEXT_PROVIDER_ID } from '@/shared/utils/customProviderSupport';

describe('ModuleSettingsRenderPlan', () => {
    it('routes gemini image provider to universal api renderer', () => {
        const plan = resolveModuleSettingsRenderPlan({
            id: 'gemini-image',
            type: 'api',
        });

        expect(plan).toEqual({ kind: 'universal-api' });
    });

    it('routes seedream image provider to universal api renderer', () => {
        const plan = resolveModuleSettingsRenderPlan({
            id: 'seedream-image',
            type: 'api',
        });

        expect(plan).toEqual({ kind: 'universal-api' });
    });

    it('routes custom openrouter providers to universal api renderer', () => {
        const plan = resolveModuleSettingsRenderPlan({
            id: CUSTOM_TEXT_PROVIDER_ID,
            type: 'api',
        });

        expect(plan).toEqual({ kind: 'universal-api' });
    });
});
