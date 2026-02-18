import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import wawoff2 from 'wawoff2';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function convert(fileName) {
    const srcPath = path.resolve(__dirname, `../assets/fonts/${fileName}`);
    const outName = fileName.replace(/\.(ttf|otf)$/, '.woff2');
    const outPath = path.resolve(__dirname, `../assets/fonts/${outName}`);

    console.log(`Reading from: ${srcPath}`);
    if (!fs.existsSync(srcPath)) {
        console.error(`Source file ${fileName} not found!`);
        return;
    }

    const input = fs.readFileSync(srcPath);
    console.log(`Compressing ${(input.length / 1024).toFixed(2)} KB...`);

    try {
        const woff2 = await wawoff2.compress(input);
        fs.writeFileSync(outPath, woff2);
        console.log(`Written to: ${outPath}`);
        console.log(`Original Size: ${(input.length / 1024).toFixed(2)} KB`);
        console.log(`Compressed Size: ${(woff2.length / 1024).toFixed(2)} KB`);
        console.log(`Savings: ${((1 - woff2.length / input.length) * 100).toFixed(2)}%`);
    } catch (err) {
        console.error('Compression failed:', err);
    }
}

async function main() {
    // existing check for Cubic_11 (if it still exists as source)
    // but primarily for Monocraft now
    await convert('Monocraft.otf');
}

await main();
