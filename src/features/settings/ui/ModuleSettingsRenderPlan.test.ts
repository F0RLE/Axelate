import { describe, expect, it } from 'vitest';
import { resolveModuleSettingsRenderPlan } from './ModuleSettingsRenderPlan';
import type { IApp } from '@/shared/types/coreTypes';

describe('resolveModuleSettingsRenderPlan', () => {
    it('uses the generic custom-ui path for modules that expose a settings html entry', () => {
        const app: IApp = {
            id: 'sample-integration',
            settingsUi: 'settings-ui/index.html',
        };

        expect(resolveModuleSettingsRenderPlan(app)).toEqual({ kind: 'custom-ui' });
    });
});
