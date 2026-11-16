import { mkdir, writeFile, copyFile } from 'node:fs/promises';
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
for (const file of ['index.html', 'styles.css', 'index.js', 'event-actions.js', 'expense-utils.js', 'bootstrap.js']) {
  await copyFile(resolve(root, file), resolve(output, file));
}
const moduleText = `// Public Firebase web configuration generated from deployment environment.\nexport const firebaseConfig = ${JSON.stringify(config, null, 2)};\n`;
await writeFile(resolve(output, 'firebase-config.js'), moduleText);
// Keep the existing project-folder development server working as well.
await writeFile(resolve(root, 'firebase-config.js'), moduleText);
console.log('Built dist/. Serve only this directory in production. Firebase web configuration remains browser-visible.');
