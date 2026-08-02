/**
 * Copies src/data into dist/data after compilation.
 *
 * The Pal reference table is read at runtime rather than imported, so tsc has
 * no reason to emit it and the packaged server would otherwise ship without it.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src', 'data');
const dest = path.join(root, 'dist', 'data');

if (!fs.existsSync(src)) {
  console.error(`No data directory at ${src}`);
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });
let copied = 0;
for (const file of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
  copied++;
}
console.log(`Copied ${copied} data file(s) to dist/data`);
