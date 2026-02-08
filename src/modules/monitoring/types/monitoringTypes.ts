export interface ICpuStats {
    percent: number;
    cores: number;
    name: string;
}

export interface IRamStats {
    percent: number;
    usedGb: number;
    totalGb: number;
    availableGb: number;
}

export interface IGpuStats {
    usage: number;
    memoryUsed: number;
    memoryTotal: number;
    temp: number;
    name: string;
}

export interface IVramStats {
    percent: number;
    usedGb: number;
    totalGb: number;
}

export interface IDiskStats {
    readRate: number;
    writeRate: number;
    utilization: number;
    totalGb: number;
    usedGb: number;
    activityPercent: number;
}

export interface INetworkStats {
    downloadRate: number;
    uploadRate: number;
    totalReceived: number;
    totalSent: number;
    utilization: number;
    activityPercent: number;
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
