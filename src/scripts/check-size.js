import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMITS = {
    js: 500 * 1024,   // 500KB
    css: 100 * 1024,  // 100KB
};

const DIST_DIR = path.resolve(process.cwd(), 'dist');

function getAllFiles(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            getAllFiles(filePath, fileList);
        } else {
            fileList.push(filePath);
        }
    });
    return fileList;
}

function checkSizes() {
    console.log('📦 Checking bundle sizes...');
    
    if (!fs.existsSync(DIST_DIR)) {
        console.error('❌ dist directory not found. Run build first.');
        process.exit(1);
    }

    const files = getAllFiles(DIST_DIR);
    let hasError = false;

    files.forEach(file => {
        const ext = path.extname(file).toLowerCase().replace('.', '');
        if (!['js', 'css'].includes(ext)) return;

        const content = fs.readFileSync(file);
        const gzipped = gzipSync(content);
        const size = gzipped.length;
        const limit = LIMITS[ext];

        const relativePath = path.relative(DIST_DIR, file);
        const sizeKB = (size / 1024).toFixed(2);
        const limitKB = (limit / 1024).toFixed(2);

        if (size > limit) {
            console.error(`❌ ${relativePath}: ${sizeKB}KB > ${limitKB}KB (Gzipped)`);
            hasError = true;
        } else {
            console.log(`✅ ${relativePath}: ${sizeKB}KB < ${limitKB}KB (Gzipped)`);
        }
    });

    if (hasError) {
        console.error('\n❌ Bundle size check failed.');
        process.exit(1);
    } else {
        console.log('\n✅ All bundles are within limits.');
    }
}

checkSizes();
