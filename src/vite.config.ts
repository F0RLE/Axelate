/// <reference types="vitest" />

import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import pkg from './package.json';

const tauriPlatform = process.env['TAURI_PLATFORM'];

function resolveBuildTarget(platform: string | undefined): string {
    switch (platform) {
        case 'windows':
            return 'chrome110';
        case 'macos':
            return 'safari15.4';
        case 'linux':
            return 'safari16';
        default:
            return 'es2022';
    }
}

const buildTarget = resolveBuildTarget(tauriPlatform);

const pruneFontsPlugin = {
    name: 'prune-fonts',
    enforce: 'post' as const,
    generateBundle(_outputOptions: unknown, bundle: Record<string, any>) {
        for (const fileName of Object.keys(bundle)) {
            const chunk = bundle[fileName];
            if (!chunk || chunk?.type !== 'asset') continue;

            if (
                (fileName.endsWith('.woff2') &&
                    !fileName.includes('Cubic_11') &&
                    !fileName.includes('Monocraft')) ||
                fileName.endsWith('.woff') ||
                fileName.endsWith('.ttf')
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
        include: ['marked', 'dompurify', 'marked-alert'],
    },

    build: {
        // Match Tauri runtime baselines instead of the newest desktop browser.
        // Windows: evergreen WebView2 with installer minimum version guard.
        // macOS: Safari 15.4 baseline from the WebKit mapping in Tauri docs.
        // Linux: WebKitGTK on modern distros maps roughly to Safari 16.
        target: buildTarget,

        minify: process.env['TAURI_DEBUG'] ? false : 'terser',
        terserOptions: {
            compress: {
                drop_console: true,
                drop_debugger: true,
            },
            mangle: {
                toplevel: true,
            },
            format: {
                comments: false,
            },
        },
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
                manualChunks(id) {
                    const normalizedId = id.replaceAll('\\', '/');
                    if (
                        normalizedId.includes('marked') ||
                        normalizedId.includes('dompurify') ||
                        normalizedId.includes('marked-alert') ||
                        normalizedId.includes('marked-footnote')
                    ) {
                        return 'vendor-markdown';
                    }
                    if (normalizedId.includes('/src/features/chat/')) {
                        return 'feature-chat';
                    }
                    if (normalizedId.includes('/src/features/ai/')) {
                        return 'feature-ai';
                    }
                    if (normalizedId.includes('/src/shared/shell/')) {
                        return 'app-shell';
                    }
                    return undefined;
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
            exclude: [
                // Pure TypeScript interface — no executable lines, always 0%
                '**/shared/types/IBridge.ts',
            ],
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
