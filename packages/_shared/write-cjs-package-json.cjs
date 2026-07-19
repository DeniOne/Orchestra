// Пишет dist/cjs/package.json со {"type":"commonjs"} — local override Node package-type.
// Без него Node трактует dist/cjs/*.js как ESM (из-за type:module в корне пакета).
// Запуск: node ../../packages/_shared/write-cjs-package-json.cjs  (из корня пакета)
const fs = require('fs');
const path = require('path');
const cjsDir = path.resolve(process.cwd(), 'dist', 'cjs');
fs.mkdirSync(cjsDir, { recursive: true });
fs.writeFileSync(path.join(cjsDir, 'package.json'), '{"type":"commonjs"}\n');
console.log(`wrote ${path.relative(process.cwd(), path.join(cjsDir, 'package.json'))}`);
