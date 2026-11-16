# Host Roam on your Moku subdomain

This app is static. Your server hosts the interface; Firebase continues to store data and authenticate users. No Firebase CLI or Node runtime is needed on the production server after building.

## Environment and build

Use Node 22 or later locally or in your deployment build environment:

```sh
node --env-file=.env scripts/build.mjs
```

The supplied configuration has been moved into the local ignored `.env` file. For a fresh checkout, copy `.env.example` to `.env` and fill in your Firebase WEB configuration. Alternatively set those environment variables through your deployment system and run `node scripts/build.mjs`.

Upload only the contents of `dist/` to the subdomain's document root. Do not serve the project directory in production. The generator also writes an ignored `firebase-config.js` locally for development. To preview the actual deployment output:

```sh
python3 -m http.server 8000 --directory dist
```

Environment variables keep configuration out of tracked source and allow separate projects per deployment. They do not hide Firebase's web API key: browsers receive it in the generated `firebase-config.js`. That key identifies the project; Firebase Security Rules authorize data access. Never put service-account JSON, private keys, or Admin SDK credentials into this build.

## Domain and HTTPS

1. Choose a hostname, such as `trips.moku.nz`.
2. Point its DNS A/AAAA record (or hosting-provider CNAME) to the intended server. Publish an AAAA record only if IPv6 is configured.
3. Create a separate virtual host/document root containing only `dist/`.
4. Obtain a TLS certificate for that hostname and redirect HTTP to HTTPS.
5. For Nginx, adapt `deploy/nginx.conf.example` to your paths and hostname, run `nginx -t`, and reload Nginx after validation. For Apache/cPanel, use the provider's subdomain and HTTPS configuration instead; the Nginx example is not an Apache configuration.
6. Keep the existing moku.nz site's virtual host separate. No DNS or server changes have been applied by this project.

The sample headers prohibit framing, block MIME sniffing, limit resource origins, and permit the popup communication Google sign-in needs. Check browser console errors and the full Google sign-in flow after installing the headers. This configuration is a template and has not been tested against your server.

## Firebase production configuration

- Authentication: enable Google (and Email/Password if you keep that option). Add the exact new hostname under Authentication → Settings → Authorized domains. Keep the existing `YOUR_PROJECT_ID.firebaseapp.com` authDomain unless you deliberately configure Firebase's custom auth-domain flow.
- Publish `database.rules.json` in Realtime Database. Environment files do not deploy rules. Existing rules restrict reads to event members and member management to the organizer.
- In Google Cloud Console, review the web API key's API restrictions and limit it to the Firebase APIs this app requires. If adding HTTP-referrer restrictions, include the actual production origin and local development origin and verify authentication and database connections afterwards. Do not reuse this browser key for unrelated APIs.
- For additional abuse protection, register the production web app with Firebase App Check and integrate its web provider before enabling enforcement. App Check is not integrated or enforced in this version.
- Any signed-in user can currently create an event. Sharing a URL does not grant event membership. Organizers must add the correct Firebase account ID; names and email labels do not establish identity.

## Required live checks

Use two member accounts plus an unrelated third account. Verify Google login, event creation, adding a traveler, expense writes/deletes, and team listing repair. Verify the unrelated user cannot read a known event or write its members/expenses using the Firebase Rules Playground or emulator. Verify ordinary members cannot add members or delete someone else's expense. Check an unsigned-in request cannot read an event. Confirm `/.env`, `/database.rules.json`, and `/scripts/build.mjs` are not served.

No live rules enforcement tests, remote deployment, DNS updates, or TLS installation have been performed. The incorrect traveler ID from earlier remains in the existing event until it is removed in Firebase Console; configuration changes do not alter saved members or balances.

References: https://firebase.google.com/docs/projects/api-keys and https://firebase.google.com/docs/auth/web/google-signin

## This Mac: Docker and Caddy

The requested installation directory is `/Users/rukmal/Local Sites/ExpensesApp`.
`docker-compose.yml` runs `expensesapp` on the existing external `platform-network`, listening on port 8080 inside Docker only. The app container uses a read-only filesystem and exposes only `dist/`; `.env` and source files are outside its document root. `deploy/Caddyfile.app` supplies static-file security headers. HTTPS belongs at the existing front Caddy or Cloudflare edge.

From the installed folder:

```sh
node --env-file=.env scripts/build.mjs
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

The Docker image contains the built static files and its Caddyfile. There are no host bind mounts, so Docker Desktop file sharing is not required. After changing source, rebuild the static app and run `docker compose up -d --build`. No host port mapping is needed. Add the chosen hostname to Firebase Authentication's authorized domains before Google sign-in testing.

The front Caddy file is `/Users/rukmal/platform/caddy/Caddyfile`. For the existing Cloudflare Tunnel pattern, add a site block for `http://<chosen-hostname>` with `reverse_proxy expensesapp:8080`. Configure that same public hostname in the tunnel to reach `http://caddy:80` if cloudflared shares the Docker network, or the same working origin used by the existing tunnel if cloudflared runs on the host. For direct public HTTPS instead, omit `http://` from the Caddy site address and point DNS to the reachable server.

Validate the front Caddy file before reloading. A working internal route does not establish that public DNS, tunnel routing, HTTPS, or Google sign-in are configured.

Rollback this app with `docker compose down` in the installation folder and remove only its front-Caddy site block, then validate and reload Caddy. Firebase event and expense data remain in Firebase and are not deleted by stopping the container.
