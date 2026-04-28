import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const DIST_DIR = path.resolve('dist');
const KB = 1024;

const LIMITS = {
    totalBytes: 1_200 * KB,
    mainJsBytes: 400 * KB,
    vendorJsBytes: 100 * KB,
    cssBytes: 200 * KB,
    fontBytes: 450 * KB,
};

function walkFiles(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkFiles(fullPath));
            continue;
        }

        if (entry.isFile()) {
            files.push(fullPath);
        }
    }

    return files;
}

function formatKb(bytes) {
    return `${(bytes / KB).toFixed(2)} KB`;
}

function warn(message) {
    console.warn(`[size] warning: ${message}`);
}

const files = walkFiles(DIST_DIR).map((file) => ({
    file,
    relative: path.relative(DIST_DIR, file).replaceAll('\\', '/'),
    size: statSync(file).size,
}));

const isFont = (file) => /\.(woff2|woff|ttf|otf)$/iu.test(file.relative);
const isEntryDocument = (file) => /\.html$/iu.test(file.relative);
const totalBytes = files
    .filter((file) => !isFont(file) && !isEntryDocument(file))
    .reduce((sum, file) => sum + file.size, 0);
const mainJs = files.find((file) => /^main-.*\.js$/u.test(file.relative));
const vendorJs = files.find((file) => /^chunks\/vendor-.*\.js$/u.test(file.relative));
const cssBundle = files.find((file) => /^assets\/main-.*\.css$/u.test(file.relative));
const largestFont = files.filter(isFont).sort((left, right) => right.size - left.size)[0];

if (totalBytes > LIMITS.totalBytes) {
    warn(`Total dist size ${formatKb(totalBytes)} exceeds ${formatKb(LIMITS.totalBytes)}`);
}

if (mainJs && mainJs.size > LIMITS.mainJsBytes) {
    warn(
        `Main bundle ${mainJs.relative} is ${formatKb(mainJs.size)} and exceeds ${formatKb(LIMITS.mainJsBytes)}`,
    );
}

if (vendorJs && vendorJs.size > LIMITS.vendorJsBytes) {
    warn(
        `Vendor markdown chunk ${vendorJs.relative} is ${formatKb(vendorJs.size)} and exceeds ${formatKb(LIMITS.vendorJsBytes)}`,
    );
}

if (cssBundle && cssBundle.size > LIMITS.cssBytes) {
    warn(
        `Main stylesheet ${cssBundle.relative} is ${formatKb(cssBundle.size)} and exceeds ${formatKb(LIMITS.cssBytes)}`,
    );
}

if (largestFont && largestFont.size > LIMITS.fontBytes) {
    warn(
        `Largest font ${largestFont.relative} is ${formatKb(largestFont.size)} and exceeds ${formatKb(LIMITS.fontBytes)}`,
    );
}

console.log(
    `[size] ok: total=${formatKb(totalBytes)}, main=${formatKb(mainJs?.size ?? 0)}, vendor=${formatKb(vendorJs?.size ?? 0)}, css=${formatKb(cssBundle?.size ?? 0)}, font=${formatKb(largestFont?.size ?? 0)}`,
);
