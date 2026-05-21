import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import {
    container,
    type CoreInfrastructure,
    type CoreServices,
    type CoreUI,
} from './CoreContainer';
import type { CoreDisposables } from './CoreLifecycleController';

type LogBatch = { level: string; message: string }[];

type RegisterCoreContainerArgs = {
    services: CoreServices;
    ui: CoreUI;
    infra: CoreInfrastructure;
};

type BindAIBridgeContextArgs = Pick<
    CoreServices,
    | 'aiBridge'
    | 'tauriProvider'
    | 'aiSettings'
    | 'catalog'
    | 'i18n'
    | 'settingsService'
    | 'stateStore'
    | 'windowService'
    | 'chatController'
> &
    Pick<CoreUI, 'appUI'>;

type DestroyCoreResourcesArgs = CoreDisposables & {
    deferredChatInitTimer: ReturnType<typeof setTimeout> | null;
};

export function configureTracerTransport(
    tracer: LoggerService,
    tauriProvider: CoreServices['tauriProvider'],
): void {
    const transport = async (logs: LogBatch): Promise<void> => {
        await tauriProvider.invoke('log_batch', { logs });
    };
    tracer.setFallbackTransport(transport);
    tracer.setTransport(transport);
}

export function bindAIBridgeContext(args: BindAIBridgeContextArgs): void {
    args.aiBridge.setContext({
        tauriProvider: args.tauriProvider,
        aiSettings: args.aiSettings,
        catalog: args.catalog,
        i18n: args.i18n,
        settingsService: args.settingsService,
        stateStore: args.stateStore,
        windowService: args.windowService,
        chatController: args.chatController,
        appUI: args.appUI,
    });
}

export function registerCoreContainer(args: RegisterCoreContainerArgs): void {
    container.registerServices(args.services);
    container.registerUI(args.ui);
    container.registerInfra(args.infra);
    container.lock();
}

export async function destroyCoreResources(args: DestroyCoreResourcesArgs): Promise<void> {
    if (args.deferredChatInitTimer !== null) {
        globalThis.clearTimeout(args.deferredChatInitTimer);
    }

    const destroyers: Array<() => Promise<void> | void> = [
        () => args.stateManager.destroy(),
        () => args.eventHandler.destroy(),
        () => args.chatController.destroy(),
        () => args.appUI.destroy(),
        () => args.settingsUI.destroy(),
        () => args.moduleSettingsUI.destroy(),
        () => args.downloadUI.destroy(),
        () => args.navigationUI.destroy(),
        () => args.windowUI.destroy(),
        () => args.windowService.destroy(),
        () => args.moduleService.destroy(),
        () => args.i18nUI.destroy(),
        () => args.consoleUI.destroy(),
        () => args.monitoringUI.destroy(),
        () => args.monitoringService.destroy(),
        () => args.sidebarUI.destroy(),
        () => args.particles.destroy(),
        () => args.soundService.destroy(),
        () => args.stateStore.destroy(),
        () => args.aiBridge.destroy(),
        () => args.bridge.destroy(),
        () => args.errorHandler.destroy(),
        () => args.globalTextContextMenu.destroy(),
    ];
    const errors: unknown[] = [];

    for (const destroy of destroyers) {
        try {
            await destroy();
        } catch (error: unknown) {
            errors.push(error);
        }
    }

    if (errors.length > 0) {
        throw new AggregateError(errors, 'Core resource cleanup failed');
    }
}
