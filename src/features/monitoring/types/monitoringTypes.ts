import type { SystemStats } from '@/shared/types/bindings';

export type ISystemStats = SystemStats;
export type StatsCallback = (stats: ISystemStats) => void;
