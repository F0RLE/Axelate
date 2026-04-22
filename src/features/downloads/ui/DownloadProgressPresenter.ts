import type { IModuleDownloadState as ModuleDownloadState } from '@/shared/types/coreTypes';
import type { DownloadProgress } from '../types/downloaderTypes';

type DownloadProgressPresenterDeps = {
    translate: (key: string, fallback: string) => string;
};

export class DownloadProgressPresenter {
    public constructor(private readonly _deps: DownloadProgressPresenterDeps) {}

    public buildProgressState(progress: Partial<DownloadProgress>): DownloadProgress {
        const percent = progress.percent ?? 0;
        const downloaded = progress.downloaded ?? 0;
        const total = progress.total ?? 0;
        const speed = progress.speed ?? 0;
        const completed = progress.completed === true;
        const error = progress.error ?? null;
        const label = progress.label ?? '';

        const hasActive =
            (progress.hasActive ?? false) ||
            ((percent > 0 || downloaded > 0) &&
                !completed &&
                error === null &&
                total > 0 &&
                label.trim() !== '') ||
            (completed && label.trim() !== '');

        return { percent, downloaded, total, speed, completed, error, label, hasActive };
    }

    public buildProgressFromModuleState(
        moduleId: string,
        state: ModuleDownloadState,
    ): DownloadProgress {
        return {
            percent: state.progress * 100,
            downloaded: state.downloaded ?? 0,
            total: state.total ?? 0,
            speed: state.speed ?? 0,
            label: this.messageLabel(state.status, state.message, moduleId),
            hasActive: this.isActiveStatus(state.status),
            completed: state.status === 'complete',
            error: state.status === 'error' ? (state.error as string) || 'Unknown error' : null,
        };
    }

    public formatSpeed(bytesPerSec: number): string {
        if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
        if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
        return `${bytesPerSec.toFixed(0)} B/s`;
    }

    public formatBytes(bytes: number): string {
        if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${bytes.toFixed(0)} B`;
    }

    public statusLabel(status: string): string {
        switch (status) {
            case 'connecting':
                return this._deps.translate('ui.downloads.status.connecting', 'Connecting');
            case 'downloading':
                return this._deps.translate('ui.downloads.status.in_progress', 'Downloading');
            case 'verifying':
                return this._deps.translate('ui.downloads.status.verifying', 'Verifying');
            case 'extracting':
                return this._deps.translate('ui.downloads.status.extracting', 'Extracting');
            case 'paused':
                return this._deps.translate('ui.downloads.status.paused', 'Paused');
            case 'complete':
                return this._deps.translate('ui.downloads.status.completed', 'Completed');
            case 'error':
                return this._deps.translate('ui.downloads.status.error', 'Error');
            case 'cancelled':
                return this._deps.translate('ui.downloads.status.cancelled', 'Cancelled');
            default:
                return this._deps.translate('ui.downloads.status.waiting', 'Waiting');
        }
    }

    public etaLabel(state: DownloadProgress): string {
        const { completed, error, speed, total, downloaded } = state;

        if (completed) {
            return this._deps.translate('ui.downloads.status.ready', 'Ready');
        }
        if (error !== null) {
            return error;
        }
        if (speed > 0 && total > 0) {
            const remainingBytes = Math.max(total - downloaded, 0);
            const seconds = remainingBytes / speed;
            const s = this._deps.translate('ui.common.time.s', 's');
            const m = this._deps.translate('ui.common.time.m', 'm');

            if (seconds < 60) {
                return `${Math.floor(seconds).toString()}${s}`;
            }

            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins.toString()}${m} ${secs.toString()}${s}`;
        }

        return '--';
    }

    public messageLabel(status: string, message: string | undefined, moduleId: string): string {
        const trimmed = message?.trim() ?? '';
        if (trimmed === '') return moduleId;

        const normalized = trimmed.toLowerCase();
        const localizedStatus = this.statusLabel(status);

        if (
            normalized === 'connecting...' ||
            normalized === 'downloading...' ||
            normalized === 'extracting...' ||
            normalized === 'success' ||
            normalized === 'download paused' ||
            normalized === 'download cancelled' ||
            normalized.startsWith('verifying')
        ) {
            return localizedStatus;
        }

        return trimmed;
    }

    public displayModuleName(moduleId: string): string {
        const knownNames: Record<string, string> = {
            llamacpp: 'llama.cpp',
            sdcpp: 'stable-diffusion.cpp',
        };

        const known = knownNames[moduleId.toLowerCase()];
        if (known !== undefined) return known;

        return moduleId.replaceAll(/[_-]+/g, ' ').trim();
    }

    public isActiveStatus(status: string): boolean {
        return (
            status === 'downloading' ||
            status === 'connecting' ||
            status === 'verifying' ||
            status === 'extracting'
        );
    }

    public isPausableStatus(status: string): boolean {
        return status === 'downloading' || status === 'connecting';
    }

    public isResumableStatus(status: string): boolean {
        return status === 'paused';
    }

    public isCancellableStatus(status: string): boolean {
        return status === 'downloading' || status === 'connecting';
    }
}
