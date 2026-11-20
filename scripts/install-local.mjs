import { mkdir, cp, chmod, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const source = resolve(import.meta.dirname, '..');
const target = '/Users/rukmal/Local Sites/ExpensesApp';
try {
  await access(target);
  throw new Error('Target already exists. Inspect it before performing an update.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(target, { recursive: true });
for (const entry of ['index.html', 'index.js', 'bootstrap.js', 'styles.css', 'event-actions.js', 'expense-utils.js', 'offline-store.js', 'sync-engine.js', 'manifest.webmanifest', 'service-worker.js', 'firebase-config.js', '.env', '.env.example', '.gitignore', 'README.md', 'DEPLOYMENT.md', 'prompt.md', 'database.rules.json', 'docker-compose.yml', 'Dockerfile', '.dockerignore', 'package.json', 'package-lock.json', 'firebase.json', 'vitest.config.js', 'playwright.config.js', 'scripts', 'deploy', 'tests', 'icons', 'vendor', 'dist']) {
  await cp(resolve(source, entry), resolve(target, entry), { recursive: true, errorOnExist: true, force: false });
}
await chmod(resolve(target, '.env'), 0o600);
console.log(`Installed application source and dist in ${target}. Only dist is exposed by Docker.`);
