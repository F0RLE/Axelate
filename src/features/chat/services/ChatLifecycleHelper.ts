import type { ChatFileHandler } from './ChatFileHandler';
import type { EventBus, IEventBusEvents } from '@/shared/services/EventBus';

type ChatLifecycleHelperDeps = {
    fileHandler: Pick<
        ChatFileHandler,
        | 'setUpdateCallback'
        | 'clearUpdateCallback'
        | 'hasFiles'
        | 'getFiles'
        | 'removeFile'
    >;
    eventBus: EventBus;
    refreshTranslations: () => void;
    ensureHistoryLoaded: () => void | Promise<void>;
    scheduleRevealLatestMessage: () => void;
    bindEvents: () => void;
    areEventsBound: () => boolean;
    setEventsBound: (value: boolean) => void;
    randomizeGreeting: (forceIndex?: number) => void;
    currentGreetingIndex: () => number;
    updateAttachmentsFromFiles: (
        files: ReturnType<ChatFileHandler['getFiles']>,
        onRemove: (index: number) => void,
    ) => void;
    updateTokenCount: () => void | Promise<void>;
};

export class ChatLifecycleHelper {
    private _pageChangeUnsub: (() => void) | null = null;
    private _translationsLoadedUnsub: (() => void) | null = null;

    public constructor(private readonly _deps: ChatLifecycleHelperDeps) {}

    public start(): void {
        this._deps.fileHandler.setUpdateCallback((files, onRemove) => {
            this._deps.updateAttachmentsFromFiles(files, onRemove);
            void this._deps.updateTokenCount();
        });

        if (this._deps.fileHandler.hasFiles()) {
            this._deps.updateAttachmentsFromFiles(this._deps.fileHandler.getFiles(), (index) => {
                this._deps.fileHandler.removeFile(index);
            });
        }

        void this._deps.ensureHistoryLoaded();

        this._pageChangeUnsub = this._deps.eventBus.on('page:change', (data) => {
            this._handlePageChange(data);
        });
        this._translationsLoadedUnsub = this._deps.eventBus.on('i18n:translations:loaded', () => {
            this._deps.randomizeGreeting(this._deps.currentGreetingIndex());
            this._deps.refreshTranslations();
        });
    }

    public stop(): void {
        this._pageChangeUnsub?.();
        this._pageChangeUnsub = null;
        this._translationsLoadedUnsub?.();
        this._translationsLoadedUnsub = null;
        this._deps.setEventsBound(false);
        this._deps.fileHandler.clearUpdateCallback();
    }

    private _handlePageChange(data: IEventBusEvents['page:change']): void {
        if (data.pageId !== 'chat') {
            return;
        }

        if (!this._deps.areEventsBound()) {
            this._deps.bindEvents();
            this._deps.setEventsBound(true);
        }

        this._deps.randomizeGreeting();
        this._deps.refreshTranslations();
        void this._deps.ensureHistoryLoaded();
        this._deps.scheduleRevealLatestMessage();
    }
}
