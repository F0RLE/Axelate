export interface ICpuStats {
    percent: number;
    cores: number;
    name: string;
}

export interface IRamStats {
    percent: number;
    used_gb: number;
    total_gb: number;
    available_gb: number;
}

export interface IGpuStats {
    usage: number;
    memory_used: number;
    memory_total: number;
    temp: number;
    name: string;
}

export interface IVramStats {
    percent: number;
    used_gb: number;
    total_gb: number;
}

export interface IDiskStats {
    read_rate: number;
    write_rate: number;
    utilization: number;
    total_gb: number;
    used_gb: number;
    activity_percent: number;
}

export interface INetworkStats {
    download_rate: number;
    upload_rate: number;
    total_received: number;
    total_sent: number;
    utilization: number;
    activity_percent: number;
}

export interface ISystemStats {
    cpu: ICpuStats;
    ram: IRamStats;
    gpu: IGpuStats | null;
    vram: IVramStats | null;
    disk: IDiskStats;
    network: INetworkStats;
    pid: number;
}

export type StatsCallback = (stats: ISystemStats) => void;
