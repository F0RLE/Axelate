import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createFont, woff2 } from 'fonteditor-core';

const SOURCE_FONT = path.resolve('assets/fonts/Cubic_11.woff2');
const OUTPUT_FONT = path.resolve('assets/fonts/Cubic_11.zh-subset.woff2');
const ZH_LOCALE = path.resolve('../src-tauri/resources/locales/zh.json');

const EXTRA_TEXT = [
    'Axelate',
    '0123456789',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz',
    ' \n\t',
    '.,:;!?()[]{}<>+-=*/\\|_#@$%^&`~\'"',
    '，。：；！？（）【】《》、“”‘’—…·￥',
].join('');

function collectCodePoints(value, codePoints) {
    if (typeof value === 'string') {
        for (const char of value) {
            codePoints.add(char.codePointAt(0));
        }
        return;
    }

    if (Array.isArray(value)) {
        value.forEach((item) => collectCodePoints(item, codePoints));
        return;
    }

    if (value && typeof value === 'object') {
        Object.values(value).forEach((item) => collectCodePoints(item, codePoints));
    }
}

function formatKb(bytes) {
    return `${(bytes / 1024).toFixed(2)} KB`;
}

await woff2.init();

const codePoints = new Set();
collectCodePoints(JSON.parse(readFileSync(ZH_LOCALE, 'utf8')), codePoints);
collectCodePoints(EXTRA_TEXT, codePoints);

const source = readFileSync(SOURCE_FONT);
const font = createFont(source, {
    type: 'woff2',
    subset: [...codePoints].filter((codePoint) => codePoint !== undefined),
});
const subset = Buffer.from(font.write({ type: 'woff2' }));
writeFileSync(OUTPUT_FONT, subset);

console.log(
    `[fonts] Cubic11 zh subset: ${codePoints.size} code points, ${formatKb(source.byteLength)} -> ${formatKb(subset.byteLength)}`,
);
