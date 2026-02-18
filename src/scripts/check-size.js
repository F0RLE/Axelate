import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.join(__dirname, '../dist');

function getDirSize(dirPath) {
    let size = 0;
    if (!fs.existsSync(dirPath)) return 0;

    const files = fs.readdirSync(dirPath);

    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = fs.statSync(filePath);

        if (stats.isDirectory()) {
            size += getDirSize(filePath);
        } else {
            size += stats.size;
        }
    }
    return size;
}

if (!fs.existsSync(DIST_DIR)) {
    console.warn(`[WARN] Dist directory not found at: ${DIST_DIR}`);
    process.exit(0); // Don't fail, just warn
}

const sizeBytes = getDirSize(DIST_DIR);
const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);

console.log(`Build Size (dist): ${sizeMB} MB`);
