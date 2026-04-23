const currentDir = process.cwd();
const initDir = process.env.INIT_CWD ?? currentDir;

if (initDir !== currentDir) {
    process.exit(0);
}

console.error(
    'Root npm install is disabled. Use "npm run setup" from the repository root or "npm --prefix src ci".',
);
process.exit(1);
