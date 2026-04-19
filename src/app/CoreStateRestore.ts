import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { CatalogService } from '@/shared/services/CatalogService';
import type { AISettingsService } from '@/shared/services/ai/AISettingsService';
import type { ModuleSettingsService } from '@/shared/services/modules/ModuleSettingsService';
import type { AppUI } from '@/shared/shell/AppUI';
import type { IApp } from '@/shared/types/coreTypes';

type RestoreLogger = Pick<LoggerService, 'warn'>;

type RestoreSelectedModulesArgs = {
    tracer: RestoreLogger;
    moduleSettings: ModuleSettingsService;
    catalog: CatalogService;
    appUI: AppUI;
};

type RestoreActiveAiProviderArgs = {
    tracer: RestoreLogger;
    aiSettings: AISettingsService;
    aiBridge: AIBridge;
    restoredSelections: RestoredSelections;
};

export type RestoredSelections = {
    aiText: IApp | null;
    aiImage: IApp | null;
    services: IApp[];
};

export function restoreSelectedModules(args: RestoreSelectedModulesArgs): RestoredSelections {
    const restoredSelections: RestoredSelections = {
        aiText: null,
        aiImage: null,
        services: [],
    };

    const selectedModules = args.moduleSettings.getSelectedModules();
    Object.entries(selectedModules).forEach(([category, selectedModule]) => {
        const restoredApp = resolveRestoredApp(args.catalog, selectedModule);
        if (restoredApp === null) {
            args.tracer.warn(
                `[CoreStateRestore] Selected module not found in catalog: ${selectedModule.id ?? category}`,
            );
            return;
        }

        args.appUI.updateModuleCard(category, restoredApp);
        if (category === 'ai_text') {
            restoredSelections.aiText = restoredApp;
            return;
        }

        if (category === 'ai_image') {
            restoredSelections.aiImage = restoredApp;
            return;
        }

        restoredSelections.services.push(restoredApp);
    });

    return restoredSelections;
}

export function restoreActiveAiProvider(args: RestoreActiveAiProviderArgs): void {
    const providerToStart = resolveProviderToStart(
        args.aiSettings.getLastActiveProvider(),
        args.restoredSelections,
    );
    if (providerToStart === null) {
        return;
    }

    void args.aiBridge.startProvider(providerToStart).catch(() => {
        args.tracer.warn(
            `[CoreStateRestore] Failed to restore active AI provider: ${providerToStart}`,
        );
    });
}

function resolveProviderToStart(
    lastActiveProvider: string | null,
    restoredSelections: RestoredSelections,
): string | null {
    const restoredAiProviders = [
        restoredSelections.aiText?.id ?? null,
        restoredSelections.aiImage?.id ?? null,
    ].filter((providerId): providerId is string => providerId !== null && providerId !== '');

    if (
        typeof lastActiveProvider === 'string' &&
        lastActiveProvider !== '' &&
        restoredAiProviders.includes(lastActiveProvider)
    ) {
        return lastActiveProvider;
    }

    return restoredSelections.aiText?.id ?? restoredSelections.aiImage?.id ?? null;
}

function resolveRestoredApp(catalog: CatalogService, selectedModule: Partial<IApp>): IApp | null {
    if (typeof selectedModule.id !== 'string' || selectedModule.id === '') {
        return null;
    }

    return catalog.getAppById(selectedModule.id) ?? null;
}
