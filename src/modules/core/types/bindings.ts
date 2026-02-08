/* eslint-disable @typescript-eslint/no-explicit-any */
// This file was manually reconstructed based on Rust structs
// Source: src-tauri/src/models/{config,modules,settings}.rs

export interface AppSettings {
    theme: string;
    language: string;
    use_gpu: boolean;
    debug_mode: boolean;
}

export interface ConfigField {
    fieldType: string;
    label: string;
    default?: any;
    required: boolean;
    options?: string[];
}

export interface Module {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    category: string;
    icon: string;
    path: string;
    installed: boolean;
    local: boolean;
    enabled: boolean;
    status?: string | null;
    isDeletable: boolean;
    config: Record<string, any>;
    configSchema?: Record<string, ConfigField> | null;
}

export interface ModuleItem {
    id: string;
    nameKey: string;
    descKey: string;
    name: string;
    desc: string;
    icon: string;
    type: string;
    repoUrl?: string | null;
    expectedHash?: string | null;
    installed?: boolean;
    configSchema?: Record<string, ConfigField> | null;
    version?: string; // Added for compatibility with CatalogService fallback
}

export interface ConfigCatalog {
    ai: ModuleItem[];
    services: ModuleItem[];
    stars?: string[]; // Added for TS compatibility, may not be in Rust
}

export interface ApiModelConfig {
    text?: string | null;
    image?: string | null;
}

export interface ModelPricing {
    tier: string;
    in?: string | null;
    out?: string | null;
    note?: string | null;
}

export interface ModelStats {
    speed: number;
    logic: number;
    creative: number;
}

export interface AiModel {
    descKey: string;
    name: string;
    desc: string;
    pricing: ModelPricing[];
    stats: ModelStats;
    apiModels?: ApiModelConfig | null;
}

export interface ConfigModels {
    gpt: Record<string, AiModel>;
    gemini: Record<string, AiModel>;
    claude?: Record<string, AiModel>; // Added for compatibility
    deepseek?: Record<string, AiModel>; // Added for compatibility
    llama?: Record<string, AiModel>; // Added for compatibility
}

export interface ApiProvider {
    id: string;
    name: string;
    descKey?: string | null;
    description?: string | null;
    icon?: string | null;
    providerType: string;
    baseUrl?: string | null;
    apiKeyEnv?: string | null;
    models?: Record<string, ApiModelConfig> | null;
    modelAliases?: Record<string, string> | null;
}

export interface AppConfig {
    version: string;
    catalog: ConfigCatalog;
    apiProviders?: ApiProvider[] | null;
    models?: ConfigModels | null;
}

export interface GpuStats {
    usage: number;
    memoryUsed: number;
    memoryTotal: number;
    temp: number;
    name: string;
}

export interface VramStats {
    percent: number;
    usedGb: number;
    totalGb: number;
}

export interface CpuStats {
    percent: number;
    cores: number;
    name: string;
}

export interface RamStats {
    percent: number;
    usedGb: number;
    totalGb: number;
    availableGb: number;
}

export interface DiskStats {
    readRate: number;
    writeRate: number;
    utilization: number;
    totalGb: number;
    usedGb: number;
    activityPercent: number;
}

export interface NetworkStats {
    downloadRate: number;
    uploadRate: number;
    totalReceived: number;
    totalSent: number;
    utilization: number;
    activityPercent: number;
}

export interface SystemStats {
    cpu: CpuStats;
    ram: RamStats;
    gpu?: GpuStats | null;
    vram?: VramStats | null;
    disk: DiskStats;
    network: NetworkStats;
    pid: number;
}

/** User-created fine-tuned or custom AI model */
export interface CustomModel {
    id: string;
    name: string;
    providerId: string;
    baseModelId: string;
    createdAt: number;
}

/** Configuration for all custom models */
export interface CustomModelConfig {
    models: CustomModel[];
}

/** License tier status */
export type LicenseStatus = "Free" | "Pro" | "Enterprise" | "Expired" | "Invalid";

/** License activation status response */
export interface LicenseStatusResponse {
    status: LicenseStatus;
    email?: string | null;
}

/** Module control request from frontend */
export interface ControlRequest {
    moduleId?: string | null;
    action: string;
}

/** Module control response to frontend */
export interface ControlResponse {
    success: boolean;
    message: string;
    status?: string | null;
}

/** Currently selected module in UI */
export interface SelectedModule {
    id: string;
    name: string;
    nameKey?: string | null;
    icon: string;
    type: string;
    descKey?: string | null;
    desc: string;
}

/** UI State that persists across sessions */
export interface UIState {
    sidebarCollapsed: boolean;
    sidebarWidth: number;
    hiddenNavItems: string[];
    hiddenMonitors: string[];
    cardWidths: Record<string, string>;
    downloadLimitEnabled: boolean;
    downloadMaxSpeed: number;
    selectedModules: Record<string, SelectedModule>;
    zoomLevel: number;
    selectedAiModels: Record<string, string>;
    lastPage?: string | null;
    resolutionZoom: Record<string, number>;
    soundEnabled: boolean;
}
