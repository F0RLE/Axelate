/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');

const newVersion = process.argv[2];

if (!newVersion) {
    console.error('Usage: node src/scripts/bump-version.js <new-version>');
    process.exit(1);
}

// Configuration
// Script is in src/scripts/
// Root is ../../
const files = [
    {
        path: '../../package.json',
        type: 'json',
    },
    {
        path: '../package.json', // src/package.json (one level up from src/scripts)
        type: 'json',
    },
    {
        path: '../../src-tauri/tauri.conf.json',
        type: 'json',
    },
    {
        path: '../../src-tauri/Cargo.toml',
        type: 'toml',
    },
];

console.log(`Bumping version to ${newVersion}...`);

files.forEach((file) => {
    const filePath = path.resolve(__dirname, file.path);

    if (!fs.existsSync(filePath)) {
        console.warn(`Warning: File not found: ${filePath}`);
        return;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    if (file.type === 'json') {
        const json = JSON.parse(content);
        json.version = newVersion;
        content = JSON.stringify(json, null, 4) + '\n';
    } else if (file.type === 'toml') {
        content = content.replace(/^version = ".*"/m, `version = "${newVersion}"`);
    }

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${path.basename(filePath)}`); // Log name for clarity
});

console.log('Done!');
