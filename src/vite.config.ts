import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Ensure we use the proper Vitest config typing if available,
// otherwise Vite-only typing works for the 'test' key in Vite 7.
/// <reference types="vitest" />

// https://vitejs.dev/config/
export default defineConfig({
    // Use relative paths for Tauri release builds (tauri:// protocol)
    base: './',

    // Vite options tailored for Tauri development
    // prevent vite from obscuring rust errors
    clearScreen: false,

    // Tauri expects a fixed port, fail if that port is not available
    server: {
        port: 1420,
        strictPort: true,
        host: true, // Listen on all local IPs (0.0.0.0)
        watch: {
            // tell vite to ignore watching `src-tauri`
            ignored: ['**/src-tauri/**'],
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

        // Multi-page app configuration
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL('./index.html', import.meta.url)),
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
