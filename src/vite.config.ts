/// <reference types="vitest" />

import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import pkg from './package.json';

const pruneFontsPlugin = {
    name: 'prune-fonts',
    enforce: 'post' as const,
    generateBundle(_outputOptions: unknown, bundle: Record<string, any>) {
        for (const fileName of Object.keys(bundle)) {
            const chunk = bundle[fileName];
            if (!chunk || chunk?.type !== 'asset') continue;

            if (
                (fileName.endsWith('.ttf') && !fileName.includes('Cubic_11')) ||
                fileName.endsWith('.woff')
            ) {
                delete bundle[fileName];
            }
        }
    },
};

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [pruneFontsPlugin],

    // Required for Tauri (tauri:// protocol)
    base: './',

    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },

    // Prevent Vite from swallowing Rust panic output
    clearScreen: false,

    server: {
        port: 1420,
        strictPort: true,
        host: true,
        hmr: {
            host: 'localhost',
            port: 1420,
            protocol: 'ws',
        },
        watch: {
            ignored: ['**/src-tauri/**'],
            usePolling: true,
            interval: 100,
        },
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:3000',
                changeOrigin: true,
                secure: false,
            },
        },
    },

    // Explicitly allow both Vite and Tauri env vars
    envPrefix: ['VITE_', 'TAURI_'],

    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./', import.meta.url)),
        },
    },

    // Pre-bundle known dependencies for faster dev startup
    optimizeDeps: {
        include: ['marked', 'katex', 'dompurify', 'marked-katex-extension', 'marked-alert'],
    },

    build: {
        // Tauri v2 modern engine targets
        target: process.env['TAURI_PLATFORM'] === 'windows' ? 'chrome120' : 'safari15',

        minify: process.env['TAURI_DEBUG'] ? false : 'esbuild',
        sourcemap: Boolean(process.env['TAURI_DEBUG']),

        // Desktop apps tolerate larger chunks
        chunkSizeWarningLimit: 1000,

        // Report compressed size for better insight
        reportCompressedSize: true,

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
                // Cleaner asset naming
                assetFileNames: 'assets/[name]-[hash][extname]',
                chunkFileNames: 'chunks/[name]-[hash].js',
                entryFileNames: '[name]-[hash].js',
            },
        },
    },

    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./test/setup.ts'],
        include: ['**/*.{test,spec}.{ts,tsx}'],
        // Fail fast on first error in CI
        bail: process.env['CI'] ? 1 : 0,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            thresholds: {
                'src/features/**/services/*.ts': {
                    lines: 80,
                    functions: 80,
                    branches: 80,
                    statements: 80,
                },
                'src/shared/**/services/*.ts': {
                    lines: 80,
                    functions: 80,
                    branches: 80,
                    statements: 80,
                },
                'src/infrastructure/**/services/*.ts': {
                    lines: 80,
                    functions: 80,
                    branches: 80,
                    statements: 80,
                },
                'src/shared/**/utils/*.ts': {
                    lines: 100,
                    functions: 100,
                    branches: 100,
                    statements: 100,
                },
            },
        },
    },
});
