import path from 'node:path';
import process from 'node:process';

const currentDir = path.resolve(process.cwd());
const initDir = process.env.INIT_CWD ?? currentDir;
const configuredPrefix = process.env.npm_config_prefix;
const srcPrefix = path.join(currentDir, 'src');

function samePath(left, right) {
    return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

if (!samePath(initDir, currentDir)) {
    process.exit(0);
}

if (configuredPrefix && samePath(configuredPrefix, srcPrefix)) {
    process.exit(0);
}

console.error(
    'Root npm install is disabled. Use "npm run setup" from the repository root or run "npm ci" from ./src.',
);
process.exit(1);
