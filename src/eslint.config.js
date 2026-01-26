import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
    {
        ignores: ['**/dist/**', '**/node_modules/**', '*.config.js', '*.config.ts', 'test/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                t: 'readonly',
                showToast: 'readonly',
                fluxAPI: 'readonly',
                GPT_MODELS: 'writable',
                GEMINI_MODELS: 'writable',
                updateModuleSettings: 'writable',
                openModuleSettings: 'writable',
                closeModuleSettings: 'writable',
                updateState: 'writable',
                initTaskbarToggles: 'writable',
                initMonitorToggles: 'writable',
                loadCardWidths: 'writable',
                toggleTaskbarItem: 'writable',
                applyTranslations: 'writable',
                toggleNavItem: 'writable',
                updateMonitorPanelVisibility: 'writable',
                toggleMonitorBtn: 'writable',
                toggleMonitorItem: 'writable',
                updateSpeedDisplay: 'writable',
                closeDownloadSettings: 'writable',
                hideModelDownloadModal: 'writable',
                loadSdModels: 'writable',
                diskUtil: 'writable',
                formatBytes: 'writable',
                selectGeminiModel: 'writable',
                toggleGeminiKeyVisibility: 'writable',
                checkGeminiKey: 'writable',
                saveGeminiKey: 'writable',
                selectGPTModel: 'writable',
                toggleGPTKeyVisibility: 'writable',
                checkGPTKey: 'writable',
                saveGPTKey: 'writable',
                selectLocalModel: 'writable',
                agentLog: 'writable',
                removeQuotes: 'writable',
                updateRangeProgress: 'writable',
                markUnsaved: 'writable',
                updateSaveButton: 'writable',
                showNotification: 'writable',
                loadSettings: 'writable',
            },
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['*.js'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // TypeScript-specific rules
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/only-throw-error': 'error',

            // General code quality
            'no-console': 'off', // We use console for debugging and Tauri feedback
            'prefer-const': 'error',
            'no-var': 'error',
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            curly: ['error', 'multi-line'],
        },
    },
    eslintConfigPrettier,
];
