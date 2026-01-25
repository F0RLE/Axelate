
export interface DownloadProgress {
    percent: number;
    downloaded: number;
    total: number;
    speed: number;
    completed: boolean;
    error: string | null;
    label: string;
    hasActive: boolean;
}

export interface DownloadSettings {
    limitEnabled: boolean;
    maxSpeed: number;
}
