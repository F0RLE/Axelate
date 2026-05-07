import type { AppConfig } from '@/shared/types/bindings';
import type { IModule } from '@/shared/types/coreTypes';

export type EngineDefinition = {
    id: string;
    installed: boolean;
    installed_compute_modes?: Array<'gpu' | 'cpu'>;
};

export type CatalogLoadSnapshot = {
    config: AppConfig;
    installedModules: IModule[];
    engineDefs: EngineDefinition[];
};
