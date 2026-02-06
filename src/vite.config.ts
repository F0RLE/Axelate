import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import pkg from './package.json';

// Ensure we use the proper Vitest config typing if available,
// otherwise Vite-only typing works for the 'test' key in Vite 7.
/// <reference types="vitest" />

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        {
            name: 'prune-fonts',
            enforce: 'post',
            generateBundle(_, bundle) {
                for (const fileName in bundle) {
                    // Prune large font formats, keep woff2 for performance.
                    // EXCEPT Cubic_11.ttf as it's the primary (and only) source for that font.
                    if (
                        (fileName.endsWith('.ttf') && !fileName.includes('Cubic_11')) ||
                        fileName.endsWith('.woff')
                    ) {
                        delete bundle[fileName];
                    }
                }
            },
        },
    ],
    // Use relative paths for Tauri release builds (tauri:// protocol)
    base: './',

    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },

    // Vite options tailored for Tauri development
    // prevent vite from obscuring rust errors
    clearScreen: false,

    // Tauri expects a fixed port, fail if that port is not available
    server: {
        port: 1420,
        strictPort: true,
        host: true, // Required for Tauri
        watch: {
            // tell vite to ignore watching `src-tauri`
            ignored: ['**/src-tauri/**'],
        },
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:3000',
                changeOrigin: true,
                secure: false,
            },
        },
    },

    // Tauri expects a fixed port, fail if that port is not available
    // to access the Tauri environment variables set by the CLI with information about the current target
    envPrefix: ['VITE_', 'TAURI_'],

    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./', import.meta.url)),
        },
    },

    build: {
        // Tauri uses Chromium on Windows and WebKit on macOS and Linux
        // Modern targets for Tauri v2
        target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome120' : 'safari15',
        // don't minify for debug builds
        minify: process.env.TAURI_DEBUG ? false : 'esbuild',
        // produce sourcemaps for debug builds
        sourcemap: !!process.env.TAURI_DEBUG,
        // Increase chunk size warning limit for desktop app
        chunkSizeWarningLimit: 1000,

        // Multi-page app configuration
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL('./index.html', import.meta.url)),
            },
            output: {
                manualChunks: {
                    'vendor-marked': [
                        'marked',
                        'marked-footnote',
                        'marked-katex-extension',
                        'marked-alert',
                    ],
                    'vendor-katex': ['katex'],
                    'vendor-dompurify': ['dompurify'],
                },
            },
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./test/setup.ts'],
        include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        coverage: {
            provider: 'v8',
            thresholds: {
                // Section 8.5: strict coverage requirements
                'src/modules/**/services/*.ts': {
                    lines: 80,
                    functions: 80,
                    branches: 80,
                    statements: 80,
                },
                'src/modules/**/utils/*.ts': {
                    lines: 100,
                    functions: 100,
                    branches: 100,
                    statements: 100,
                },
            },
        },
    },
});
