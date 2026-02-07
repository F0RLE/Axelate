import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '*.config.js',
            '*.config.ts',
            'test/**',
            '**/bindings.ts',
            'scripts/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        files: ['scripts/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    {
        languageOptions: {
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
            },
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['*.js', 'scripts/*.js'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
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
            '@typescript-eslint/explicit-function-return-type': 'warn',
            '@typescript-eslint/no-non-null-assertion': 'error',
            '@typescript-eslint/only-throw-error': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/require-await': 'error',
            '@typescript-eslint/strict-boolean-expressions': 'warn',
            '@typescript-eslint/no-unnecessary-condition': 'warn',
            '@typescript-eslint/prefer-nullish-coalescing': 'warn',
            '@typescript-eslint/prefer-optional-chain': 'warn',
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
            ],
            '@typescript-eslint/consistent-type-exports': 'error',

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
            'require-await': 'error',

            // Import organization
            'sort-imports': [
                'error',
                {
                    ignoreCase: true,
                    ignoreDeclarationSort: true,
                    ignoreMemberSort: false,
                    memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
                },
            ],
        },
    },
    eslintConfigPrettier,
];
