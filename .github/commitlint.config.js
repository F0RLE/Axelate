const path = require('node:path');

module.exports = {
    extends: [
        require.resolve('@commitlint/config-conventional', {
            paths: [path.join(__dirname, '..', 'src', 'node_modules')],
        }),
    ],
};
