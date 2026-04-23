import type { AIBridge } from '@/features/ai/services/AIBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { CatalogService } from '@/shared/services/CatalogService';
import type { ModuleSettingsService } from '@/shared/services/modules/ModuleSettingsService';
import type { AppUI } from '@/shared/shell/AppUI';
import type { IApp } from '@/shared/types/coreTypes';
import { appendCustomProviderApps } from '@/shared/utils/customProviderSupport';

type RestoreLogger = Pick<LoggerService, 'warn'>;

type RestoreSelectedModulesArgs = {
    tracer: RestoreLogger;
    moduleSettings: ModuleSettingsService;
    catalog: CatalogService;
    appUI: AppUI;
};

type RestoreSelectedAiProviderArgs = {
    tracer: RestoreLogger;
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
    const nonAiSelections: Array<{ category: string; app: IApp }> = [];

    const selectedModules = args.moduleSettings.getSelectedModules();
    Object.entries(selectedModules).forEach(([category, selectedModule]) => {
        const restoredApp = resolveRestoredApp(args.catalog, category, selectedModule);
        if (restoredApp === null) {
            args.tracer.warn(
                `[CoreStateRestore] Selected module not found in catalog: ${selectedModule.id ?? category}`,
            );
            return;
        }

        if (category === 'ai_text') {
            restoredSelections.aiText = restoredApp;
            return;
        }

        if (category === 'ai_image') {
            restoredSelections.aiImage = restoredApp;
            return;
        }

        nonAiSelections.push({ category, app: restoredApp });
        restoredSelections.services.push(restoredApp);
    });

    nonAiSelections.forEach(({ category, app }) => {
        args.appUI.updateModuleCard(category, app);
    });

    if (restoredSelections.aiText !== null) {
        args.appUI.updateModuleCard('ai_text', restoredSelections.aiText);
    }

    if (restoredSelections.aiImage !== null) {
        args.appUI.updateModuleCard('ai_image', restoredSelections.aiImage);
    }

    if (restoredSelections.aiText !== null && restoredSelections.aiImage !== null) {
        args.appUI.updateModuleCard('ai_text', restoredSelections.aiText);
    }

    return restoredSelections;
}

export function restoreSelectedAiProvider(args: RestoreSelectedAiProviderArgs): void {
    const providerToStart = resolveProviderToStart(args.restoredSelections);
    if (providerToStart === null) {
        return;
    }

    void args.aiBridge.startProvider(providerToStart).catch(() => {
        args.tracer.warn(
            `[CoreStateRestore] Failed to restore selected AI provider: ${providerToStart}`,
        );
    });
}

function resolveProviderToStart(restoredSelections: RestoredSelections): string | null {
    return restoredSelections.aiText?.id ?? restoredSelections.aiImage?.id ?? null;
}

function resolveRestoredApp(
    catalog: CatalogService,
    category: string,
    selectedModule: Partial<IApp>,
): IApp | null {
    if (typeof selectedModule.id !== 'string' || selectedModule.id === '') {
        return null;
    }

    const catalogApp = catalog.getAppById(selectedModule.id);
    if (catalogApp !== undefined) {
        return catalogApp;
    }

    if (!category.startsWith('ai')) {
        return null;
    }

    return (
        appendCustomProviderApps(catalog.getCatalog().ai).find(
            (app) => app.id === selectedModule.id,
        ) ?? null
    );
}
