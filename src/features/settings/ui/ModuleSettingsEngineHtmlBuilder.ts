import type { IApp } from '@/shared/types/coreTypes';
import type { EngineConfig } from '@/features/ai/services/EngineConfigService';

type TranslateFn = (key: string, fallback: string) => string;

export class ModuleSettingsEngineHtmlBuilder {
    public constructor(private readonly _translate: TranslateFn) {}

    public escapeHtml(value: string): string {
        return value
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    public buildEngineConfigHtml(app: IApp, config: EngineConfig | null): string {
        const isImage = app.capability === 'image';
        const warnHtml =
            config === null
                ? `<p class="local-engine-warning">${this.escapeHtml(this._translate('ui.settings.engine.config_unavailable', 'Engine config unavailable (Tauri not connected)'))}</p>`
                : '';
        const generationSection = isImage ? this._buildImageGenerationSection(app.id) : '';

        return `
            <div class="ai-module-config universal-api-theme local-engine-config" data-provider-id="${this.escapeHtml(app.id)}">
                <div class="ai-settings-content local-engine-layout">
                    <section class="thinking-level-section local-engine-section" aria-labelledby="${app.id}-core-title">
                        <div class="ai-content-panel">
                            <div class="local-engine-section-header">
                                <h3 id="${app.id}-core-title">🧩 ${this.escapeHtml(
                                    this._translate(
                                        'ui.settings.engine.core_config',
                                        'Core Config',
                                    ),
                                )}</h3>
                            </div>
                            <div id="local-engine-core-primary-${app.id}" class="local-engine-field-stack local-engine-field-stack--tight"></div>
                            ${warnHtml}
                        </div>
                    </section>
                    ${generationSection}
                </div>
            </div>
        `;
    }

    private _buildImageGenerationSection(appId: string): string {
        return `
            <section class="thinking-level-section local-engine-section" aria-labelledby="${appId}-generation-title">
                <div class="ai-content-panel">
                    <div class="local-engine-section-header">
                        <h3 id="${appId}-generation-title">🎛️ ${this.escapeHtml(
                            this._translate(
                                'ui.settings.engine.generation_presets',
                                'Generation Presets',
                            ),
                        )}</h3>
                    </div>
                    <div class="local-engine-generation-grid local-engine-generation-grid--image">
                        <div class="local-engine-panel-card local-engine-panel-card--prompts">
                            <div id="local-engine-prompts-${appId}" class="local-engine-field-grid"></div>
                        </div>
                        <div class="local-engine-control-grid">
                            ${this._buildCompactGroup(
                                appId,
                                'size',
                                this._translate('ui.settings.engine.group_size', 'Image Size'),
                            )}
                            ${this._buildCompactGroup(
                                appId,
                                'sampling',
                                this._translate('ui.settings.engine.group_sampling', 'Sampling'),
                            )}
                            ${this._buildCompactGroup(
                                appId,
                                'batch',
                                this._translate('ui.settings.engine.group_batch', 'Batch & Seed'),
                            )}
                        </div>
                    </div>
                </div>
            </section>
        `;
    }

    private _buildCompactGroup(appId: string, groupId: string, title: string): string {
        return `
            <div class="local-engine-panel-card local-engine-panel-card--compact">
                <div class="local-engine-group-header">
                    <h4>${this.escapeHtml(title)}</h4>
                </div>
                <div class="local-engine-group-body">
                    <div id="local-engine-${groupId}-${appId}" class="local-engine-field-grid"></div>
                </div>
            </div>
        `;
    }
}
