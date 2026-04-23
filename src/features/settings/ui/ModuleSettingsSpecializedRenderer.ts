import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { SettingsService } from '../services/SettingsService';
import type { IModuleSettingsUIContext } from './SettingsContext';

type ModuleSettingsMap = Record<string, string | undefined>;

type SimpleFieldBaseOptions = {
    settingKey: string;
    label: string;
    helpText: string;
};

type TextFieldOptions = SimpleFieldBaseOptions & {
    type: 'text' | 'password' | 'number';
    value: string;
    placeholder: string;
};

type TextareaFieldOptions = SimpleFieldBaseOptions & {
    value: string;
    placeholder: string;
    rows?: number;
};

type SelectFieldOptions = SimpleFieldBaseOptions & {
    value: string;
    options: Array<{ value: string; label: string }>;
};

type SpecializedRendererDeps = {
    service: SettingsService;
    getContext: () => IModuleSettingsUIContext;
    debouncedSave: (key: string, value: string | number | boolean | null) => void;
    tracer: Pick<LoggerService, 'error'>;
};

export class ModuleSettingsSpecializedRenderer {
    public constructor(private readonly _deps: SpecializedRendererDeps) {}

    private get _context(): IModuleSettingsUIContext {
        return this._deps.getContext();
    }

    public renderTelegramBotSettings(container: HTMLElement): void {
        const t = this._context.t;
        const settings = this._getSettings();

        container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'ai-module-config universal-api-theme';

        const panel = document.createElement('section');
        panel.className = 'ai-content-panel';

        const title = document.createElement('h3');
        title.textContent = t('ui.settings.telegram_stub_title', 'Telegram Bot');

        const description = document.createElement('p');
        description.className = 'stats-note';
        description.textContent = t(
            'ui.settings.telegram_settings_desc',
            'Launcher stores the bot token and target channel here. Bot language follows launcher language.',
        );

        const form = document.createElement('div');
        form.className = 'module-settings-form';

        this._renderTextField(form, {
            settingKey: 'bot_token',
            label: t('ui.settings.telegram_bot_token', 'Bot Token'),
            value: settings['bot_token'] ?? '',
            placeholder: '123456:ABCDEF...',
            helpText: t(
                'ui.settings.telegram_bot_token_desc',
                'Telegram bot token from BotFather.',
            ),
            type: 'password',
        });
        this._renderTextField(form, {
            settingKey: 'target_channel_id',
            label: t('ui.settings.telegram_channel_id', 'Target Channel ID'),
            value: settings['target_channel_id'] ?? '',
            placeholder: '-1001234567890',
            helpText: t(
                'ui.settings.telegram_channel_id_desc',
                'Channel ID where posts will be published.',
            ),
            type: 'number',
        });
        this._renderTelegramTopicsField(form, {
            value: settings['telegram_topics'] ?? '',
            label: t('ui.settings.telegram_topics', 'Topics and source channels'),
            helpText: t(
                'ui.settings.telegram_topics_desc',
                'One topic per line: Topic: @channel_one, @channel_two',
            ),
        });
        this._renderSelectField(form, {
            settingKey: 'telegram_source_mode',
            label: t('ui.settings.telegram_source_mode', 'Parser source mode'),
            value: settings['telegram_source_mode'] ?? 'auto',
            helpText: t(
                'ui.settings.telegram_source_mode_desc',
                'Use auto, telethon, or web. Auto tries Telethon first, then web fallback.',
            ),
            options: [
                { value: 'auto', label: 'auto' },
                { value: 'telethon', label: 'telethon' },
                { value: 'web', label: 'web' },
            ],
        });
        this._renderTextField(form, {
            settingKey: 'telegram_api_id',
            label: t('ui.settings.telegram_api_id', 'Telegram API ID'),
            value: settings['telegram_api_id'] ?? '',
            placeholder: '123456',
            helpText: t(
                'ui.settings.telegram_api_id_desc',
                'Optional MTProto API ID from my.telegram.org for reliable channel parsing.',
            ),
            type: 'number',
        });
        this._renderTextField(form, {
            settingKey: 'telegram_api_hash',
            label: t('ui.settings.telegram_api_hash', 'Telegram API Hash'),
            value: settings['telegram_api_hash'] ?? '',
            placeholder: '0123456789abcdef...',
            helpText: t(
                'ui.settings.telegram_api_hash_desc',
                'Optional MTProto API hash. Requires an authorized Telethon session.',
            ),
            type: 'password',
        });
        this._renderTextField(form, {
            settingKey: 'telegram_session',
            label: t('ui.settings.telegram_session', 'Telegram session'),
            value: settings['telegram_session'] ?? '',
            placeholder: 'telegram_parser',
            helpText: t(
                'ui.settings.telegram_session_desc',
                'Telethon session name or path. Leave empty for default Axelate user config path.',
            ),
            type: 'text',
        });
        this._renderTextareaField(form, {
            settingKey: 'telegram_rewrite_system_prompt',
            label: t('ui.settings.telegram_rewrite_system_prompt', 'Rewrite system prompt'),
            value: settings['telegram_rewrite_system_prompt'] ?? '',
            placeholder: t(
                'ui.settings.telegram_rewrite_system_prompt_placeholder',
                'Describe how the bot should rewrite posts.',
            ),
            helpText: t(
                'ui.settings.telegram_rewrite_system_prompt_desc',
                'Main instruction for post rewriting. Leave empty to use the built-in rewrite style.',
            ),
            rows: 5,
        });
        this._renderTextareaField(form, {
            settingKey: 'telegram_rewrite_user_prompt',
            label: t('ui.settings.telegram_rewrite_user_prompt', 'Rewrite user prompt'),
            value: settings['telegram_rewrite_user_prompt'] ?? '',
            placeholder: 'Перепиши этот текст:\n\n{text}',
            helpText: t(
                'ui.settings.telegram_rewrite_user_prompt_desc',
                'Prompt template sent with the source post. Use {text} where the original post should be inserted.',
            ),
            rows: 4,
        });
        this._renderTextareaField(form, {
            settingKey: 'telegram_rewrite_cliches',
            label: t('ui.settings.telegram_rewrite_cliches', 'Rewrite banned cliches'),
            value: settings['telegram_rewrite_cliches'] ?? '',
            placeholder: t(
                'ui.settings.telegram_rewrite_cliches_placeholder',
                'a you know, unbelievable, wow',
            ),
            helpText: t(
                'ui.settings.telegram_rewrite_cliches_desc',
                'Optional list of phrases the bot should avoid. Separate with commas or one phrase per line.',
            ),
            rows: 4,
        });

        const languageNote = document.createElement('p');
        languageNote.className = 'stats-note';
        languageNote.textContent = t(
            'ui.settings.telegram_language_note',
            'Bot language uses the current launcher language.',
        );

        const runtimeNote = document.createElement('p');
        runtimeNote.className = 'stats-note';
        runtimeNote.textContent = t(
            'ui.settings.telegram_runtime_note',
            'Topics, publish channel and parser mode update while the bot is running. Bot token changes require restart.',
        );

        form.append(languageNote, runtimeNote);
        panel.append(title, description, form);
        wrapper.appendChild(panel);
        container.appendChild(wrapper);
    }

    private _getSettings(): ModuleSettingsMap {
        return this._deps.service.getSettings() as ModuleSettingsMap;
    }

    private _renderTextField(form: HTMLElement, options: TextFieldOptions): void {
        const input = document.createElement('input');
        input.className = 'form-input';
        input.type = options.type;
        input.placeholder = options.placeholder;
        input.value = options.value;
        input.autocomplete = 'off';
        input.addEventListener('input', () => {
            this._deps.debouncedSave(options.settingKey, input.value.trim());
        });
        this._appendFieldRow(form, options, input);
    }

    private _renderTextareaField(form: HTMLElement, options: TextareaFieldOptions): void {
        const textarea = document.createElement('textarea');
        textarea.className = 'form-input';
        textarea.rows = options.rows ?? 4;
        textarea.placeholder = options.placeholder;
        textarea.value = options.value;
        textarea.addEventListener('input', () => {
            this._deps.debouncedSave(options.settingKey, textarea.value.trim());
        });
        this._appendFieldRow(form, options, textarea);
    }

    private _renderSelectField(form: HTMLElement, options: SelectFieldOptions): void {
        const select = document.createElement('select');
        select.className = 'form-input';
        for (const option of options.options) {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.label;
            select.appendChild(optionElement);
        }
        select.value = options.value;
        select.addEventListener('change', () => {
            this._deps.debouncedSave(options.settingKey, select.value);
        });
        this._appendFieldRow(form, options, select);
    }

    private _renderTelegramTopicsField(
        form: HTMLElement,
        options: { value: string; label: string; helpText: string },
    ): void {
        const textarea = document.createElement('textarea');
        textarea.className = 'form-input';
        textarea.rows = 6;
        textarea.placeholder = 'News: @my_channel, @second_channel';
        textarea.value = this._decodeTelegramTopicsForDisplay(options.value);
        textarea.addEventListener('input', () => {
            this._deps.debouncedSave(
                'telegram_topics',
                this._encodeTelegramTopicsForStorage(textarea.value),
            );
        });
        this._appendFieldRow(form, options, textarea);
    }

    private _decodeTelegramTopicsForDisplay(value: string): string {
        return value
            .split('|')
            .map((entry) => entry.trim())
            .filter((entry) => entry !== '')
            .join('\n');
    }

    private _encodeTelegramTopicsForStorage(value: string): string {
        return value
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter((entry) => entry !== '')
            .join(' | ');
    }

    private _appendFieldRow(
        form: HTMLElement,
        options: Pick<SimpleFieldBaseOptions, 'label' | 'helpText'>,
        control: HTMLElement,
    ): void {
        const row = document.createElement('div');
        row.className = 'form-row';

        const label = document.createElement('label');
        label.textContent = options.label;

        const help = document.createElement('div');
        help.className = 'setting-desc';
        help.textContent = options.helpText;

        row.append(label, control, help);
        form.appendChild(row);
    }
}
