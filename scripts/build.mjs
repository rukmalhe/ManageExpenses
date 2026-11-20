import './prepare-vendor.mjs';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, copyFile, cp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const fields = {
  apiKey: 'FIREBASE_API_KEY', authDomain: 'FIREBASE_AUTH_DOMAIN',
  databaseURL: 'FIREBASE_DATABASE_URL', projectId: 'FIREBASE_PROJECT_ID',
  storageBucket: 'FIREBASE_STORAGE_BUCKET', messagingSenderId: 'FIREBASE_MESSAGING_SENDER_ID',
  appId: 'FIREBASE_APP_ID', measurementId: 'FIREBASE_MEASUREMENT_ID'
};
const config = Object.fromEntries(Object.entries(fields).map(([key, env]) => [key, process.env[env]?.trim() || '']));
for (const key of ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId']) {
  if (!config[key]) throw new Error(`Missing ${fields[key]}. Supply it through the environment or .env.`);
}
const database = new URL(config.databaseURL);
if (database.protocol !== 'https:' || !/\.(firebaseio\.com|firebasedatabase\.app)$/.test(database.hostname)) {
  throw new Error('FIREBASE_DATABASE_URL must be an HTTPS Firebase Realtime Database URL.');
}
if (!/^[a-zA-Z0-9.-]+$/.test(config.authDomain)) throw new Error('Invalid FIREBASE_AUTH_DOMAIN.');
const output = resolve(root, 'dist');
await mkdir(output, { recursive: true });
// Explicit allowlist: environment files, rules, and server files are never copied.
for (const file of ['index.html', 'styles.css', 'index.js', 'event-actions.js', 'expense-utils.js', 'bootstrap.js', 'offline-store.js', 'sync-engine.js', 'manifest.webmanifest']) {
  await copyFile(resolve(root, file), resolve(output, file));
}
const moduleText = `// Public Firebase web configuration generated from deployment environment.\nexport const firebaseConfig = ${JSON.stringify(config, null, 2)};\n`;
await writeFile(resolve(output, 'firebase-config.js'), moduleText);
// Keep the existing project-folder development server working as well.
await writeFile(resolve(root, 'firebase-config.js'), moduleText);
console.log('Built dist/. Serve only this directory in production. Firebase web configuration remains browser-visible.');

await cp(resolve(root, 'vendor'), resolve(output, 'vendor'), { recursive: true });
await cp(resolve(root, 'icons'), resolve(output, 'icons'), { recursive: true });
const files = ['index.html','styles.css','index.js','bootstrap.js','event-actions.js','expense-utils.js','offline-store.js','sync-engine.js','firebase-config.js','manifest.webmanifest','vendor/dexie.mjs','icons/icon-180.png','icons/icon-192.png','icons/icon-512.png'];
const worker = await readFile(resolve(root, 'service-worker.js'), 'utf8');
const hash = createHash('sha256').update(worker);
for (const file of files) hash.update(await readFile(resolve(output, file)));
const revision = hash.digest('hex').slice(0,16);
// The edge caches static assets, so use release-specific URLs consistently in
// HTML, module imports, the manifest, and the service worker's precache list.
const versioned = ['styles.css','bootstrap.js','index.js','event-actions.js','expense-utils.js','offline-store.js','sync-engine.js','firebase-config.js','vendor/dexie.mjs','icons/icon-180.png','icons/icon-192.png','icons/icon-512.png'];
for (const file of ['index.html','bootstrap.js','index.js','offline-store.js']) {
  let content = await readFile(resolve(output, file), 'utf8');
  for (const asset of versioned) {
    content = content.replaceAll(`"${asset}"`, `"${asset}?v=${revision}"`)
      .replaceAll(`'./${asset}'`, `'./${asset}?v=${revision}'`)
      .replaceAll(`"./${asset}"`, `"./${asset}?v=${revision}"`);
  }
  content = content.replaceAll("'./service-worker.js'", `'./service-worker.js?v=${revision}'`);
  await writeFile(resolve(output, file), content);
}
const manifest = JSON.parse(await readFile(resolve(output, 'manifest.webmanifest'), 'utf8'));
manifest.icons.forEach(icon => { icon.src += `?v=${revision}`; });
await writeFile(resolve(output, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2)+'\n');
let builtWorker = worker.replace('__BUILD_VERSION__', revision);
for (const asset of versioned) builtWorker = builtWorker.replaceAll(`'/${asset}'`, `'/${asset}?v=${revision}'`);
await writeFile(resolve(output, 'service-worker.js'), builtWorker);
