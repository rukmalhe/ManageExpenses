import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, 'vendor'), { recursive: true });
await copyFile(resolve(root, 'node_modules/dexie/dist/dexie.mjs'), resolve(root, 'vendor/dexie.mjs'));
await copyFile(resolve(root, 'node_modules/dexie/dist/dexie.mjs.map'), resolve(root, 'vendor/dexie.mjs.map'));
