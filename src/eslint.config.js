import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '*.config.js',
            '*.config.ts',
            'vite.config.ts',
            'test/**',
            '**/test/**',
            '**/bindings.ts',
            'scripts/**',
            '**/scripts/**',
        ],
    },
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'off',
        },
    },
    js.configs.recommended,
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parser: tsParser,
            globals: {
                ...globals.browser,
                t: 'readonly',
                showToast: 'readonly',
                axelateAPI: 'readonly',
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
                __APP_VERSION__: 'readonly',
            },
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['*.js', 'scripts/*.js'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
        },
        rules: {
            // Disable base JS rules in TS files in favor of TS-aware versions
            'no-unused-vars': 'off',
            'no-undef': 'off',

            // ============================================================
            // Maximum Strictness ESLint Rules
            // ============================================================

            // TypeScript-specific rules (Strictest)
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-non-null-assertion': 'error',
            '@typescript-eslint/only-throw-error': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/require-await': 'error',
            '@typescript-eslint/strict-boolean-expressions': 'error',
            '@typescript-eslint/no-unnecessary-condition': 'error',
            '@typescript-eslint/prefer-nullish-coalescing': 'error',
            '@typescript-eslint/prefer-optional-chain': 'error',
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
            ],
            '@typescript-eslint/consistent-type-exports': 'error',

            // Safety: prevent `any` leaks and implicit coercions
            '@typescript-eslint/no-unsafe-assignment': 'error',
            '@typescript-eslint/no-unsafe-return': 'error',
            '@typescript-eslint/restrict-template-expressions': 'error',

            // General code quality (Strictest)
            'no-console': 'warn',
            'prefer-const': 'error',
            'no-var': 'error',
            eqeqeq: ['error', 'always'],
            curly: ['error', 'all'],
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-param-reassign': 'error',
            'no-return-assign': 'error',
            'no-throw-literal': 'error',
            'no-useless-concat': 'error',
            'prefer-template': 'error',
        },
    },
    {
        files: ['scripts/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    eslintConfigPrettier,
];
