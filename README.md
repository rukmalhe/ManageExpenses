# Roam — shared travel expenses

A buildless JavaScript app using Firebase Authentication and Realtime Database.

## Connect Firebase

1. Firebase web configuration is supplied through `.env` (see `.env.example`). Run `node --env-file=.env scripts/build.mjs` to generate the app configuration and deployment folder. See [DEPLOYMENT.md](DEPLOYMENT.md) for subdomain hosting and security details.
2. Enable Authentication → Sign-in method → Google and/or Email/Password for the login options you use.
3. Add your hosting domain under Authentication → Settings → Authorized domains.
4. In Realtime Database → Rules, publish the contents of `database.rules.json`. Keep the database private; do not enable public read/write access.
5. Serve this folder over HTTP, for example `python3 -m http.server 8000 --directory dist`, then visit http://localhost:8000. Opening index.html directly as a file is not supported.

## Review the requested files

- `index.html`: sign-in and registration screen, event workspace, and event creation dialog.
- `styles.css`: responsive green and cream styling, focus indicators, mobile layouts.
- `index.js`: authentication, event/member creation, live database subscriptions, expense creation/deletion, and equal-share balances.

## Try the workflow

Create two accounts in separate browser sessions. Each account displays its ID after sign-in. Create an event in the first account, define its categories and currency, then add the second account using its ID. The second account should see the event immediately. Both can add their own expenses. Members can delete their own expenses; the organizer can delete any event expense.

Amounts are stored in integer cents. Balances divide the total equally across all current members; remaining cents go in sorted account-ID order so balances sum to zero. Adding a member includes that traveler in all existing costs. All supported currencies use two decimal places. Balances describe what people owe; payment settlement recording is not included.

Event names, categories, and currency are fixed after creation. Organizers can remove travelers; their recorded payments transfer to the organizer and all remaining shares recalculate. Empty events can be deleted. Shared events move to the Archived tab three calendar months after creation. Use Edit beside Delete to load an expense into the existing form, change its amount or date, and save or cancel. Account IDs must belong to registered travelers; this app does not send invitations or emails.

## Data and access

`events/{eventId}` contains owner, name, currency, categories, members, and expenses. `userEvents/{uid}/{eventId}` is a private discovery index. Only event members can read event data. Only an event owner can add members and update event discovery indexes. Expense authors and organizers can edit saved amounts and dates; descriptions, categories, creation times, and payment attribution are preserved. New expenses must be attributed to the signed-in member. No service-account credentials are used in the browser.

Event/member writes precede their discovery-index writes. If the second operation fails, the underlying record remains saved; repair the corresponding `userEvents` entry in the Firebase Console. Account IDs are not verified against Firebase Auth by this browser-only implementation.

## Verification

JavaScript syntax and JSON parsing were checked locally. Authentication, database operations, security-rule enforcement, and browser rendering need verification with a configured Firebase project. Deploy rules and test with two accounts plus an unrelated third account before sharing the app.

## Personal expenses

Choose Personal expenses when creating an event. The owner is the only account with access; no traveler controls are shown. The month picker defaults to the current month and can retrieve earlier months. Recurring schedules support monthly, weekly, and fortnightly payments with inclusive timelines. Monthly payments clamp to the last day of shorter months; weekly and fortnightly payments stay anchored to their first payment date. Existing monthly schedules remain supported. Scheduled amounts are calculated in each month, not recorded as completed payments. Deleting a schedule removes its amounts from all months.

Deploy the updated `database.rules.json` before using these features. Rebuild with `node --env-file=.env scripts/build.mjs` for the localhost preview. Live Firebase authorization and multi-account workflows still require verification.

## Regression tests

Run `npm ci`, then `npm test` (Java 21 or newer required). This starts the local Realtime Database emulator, loads `database.rules.json`, and runs Vitest against the isolated `demo-roam` project. No Firebase login or production credentials are needed. The first run downloads the emulator runtime.

`tests/events.test.js` covers shared/personal event creation and discovery-index permissions, and traveler removal starting with an empty client cache. It verifies payment reassignment, recalculated shares, discovery-index cleanup, and revoked database access. Browser actions use the same functions in `event-actions.js` as these tests. Publish the corrected database rules separately when deploying; emulator success does not verify the rules currently deployed to your live Firebase project.

Expenses are grouped by category with category totals, including both scheduled and one-off expenses. Success messages appear as dismissible toasts for 6.5 seconds; errors receive focus and stay visible until dismissed or another action begins.

Personal events appear in a separate Personal tab and are restricted to their owner, even if legacy data contains other member IDs. Event caches are cleared when accounts change. Duplicate traveler IDs (including the organizer’s ID) produce a warning without changing the original member; use Refresh team access to repair existing discovery indexes. Regression tests cover both behaviors and owner-only database access.

Amount fields accept a single amount or additions such as `24.69+5671+20967`. A live total appears before saving; only the total in integer cents is stored. This works for shared, personal, and recurring expenses. Use `+` between amounts and at most two decimal places per amount; totals must be between 0.01 and 1,000,000.

Recurring schedules and their generated occurrences cannot be edited after saving. To correct a schedule, delete it and create a replacement; deleting removes its calculated amounts from every month, including earlier months. Existing shared-expense balances recalculate from the updated amounts. Deploy the updated `database.rules.json` to enable member edits in live Firebase.

Each event in the Shared, Personal, and Archived lists shows cumulative expenditure through today in its own currency. This is the whole event total, across all months, excluding future-dated expenses. Personal totals also include scheduled payments due through the local date; these are not confirmations of payment. Totals update with live changes and refresh their date cutoff every minute.

## Installable offline app

Open the HTTPS site in Safari on iPhone, choose Share → Add to Home Screen, then open the installed app. Connect and sign in for the first setup. Wait for **Synced** and **Ready for offline use** before going offline. The app caches its interface, Firebase SDK, and downloaded events. The same app works in a normal browser.

One-off expense additions and permitted amount/date edits save first to account-scoped IndexedDB via Dexie. **Pending sync** labels distinguish local changes. They survive closing and reopening the app. Existing totals include those local changes. New expenses retain the same database ID on every retry; conditional Firebase REST writes prevent duplicate uploads and detect edits or deletions on another device. Conflicts offer **Use server version** or, when the server record still exists, **Apply my amount and date**. Revoked access blocks upload and removes that event from the local event list without silently discarding unsynced changes.

Synchronization runs on opening, reconnecting, returning to the app, every 30 seconds while pending changes remain and the app is open and connected, and through **Sync now**. The toolbar shows connection state, pending count, and the last completed sync. Signing out with pending changes requires confirmation; those changes are retained for the same account and are hidden from other accounts. Events, traveler management, deletions, and recurring schedules require a connection. Recurring schedules remain non-editable.

Use Node 24.12+ and npm 11+. Build with `npm ci` and `node --env-file=.env scripts/build.mjs`. Installation generates a local browser copy of Dexie in ignored `vendor/`; the build copies it into `dist/`. A content-hashed service-worker cache downloads the complete app before activation. An **Update app** button appears when another version is ready. Users can finish unsaved forms before accepting the reload. Database responses and authentication requests are never stored in the service-worker cache.

Offline availability depends on browser storage remaining available; clearing site data or uninstalling can remove unsynced data. Sync while connected before clearing storage. Background uploads after the app is closed are not guaranteed. Actual iPhone installation and keyboard behavior need device verification.

Run `npm test` for storage, queue, conflict, access-rule, and existing application regressions. For isolated mobile browser tests, run `npx playwright install chromium webkit`, build `dist/`, then `npm run test:browser`. The browser fixture serves synthetic authentication and a local test database; it does not connect to live Firebase. The test runner is pinned for compatibility with this Mac's supported WebKit runtime.

Browser-test note: WebKit’s Playwright offline toggle bypasses service-worker responses. WebKit offline-navigation tests therefore make the local fixture server unavailable and expose disconnected state to its synthetic SDK. Chromium uses the browser’s native offline toggle. Neither replaces a final installation check on a physical iPhone.

Builds use a shared release identifier in static-asset URLs to avoid mixing versions in the CDN cache. Online navigation checks the latest HTML; disconnected navigation falls back to the last completely installed app shell.

The Offline label follows the device network state, not Firebase’s live socket. Manual and automatic REST synchronization continue when the live connection is reconnecting; the app polls for server changes while that live connection is unavailable. Management actions still wait for a live connection.

The event list starts without a selection and uses the full workspace width. Details open only after selecting an event. Switching tabs or choosing Back to events clears and hides the panel; synchronization and event removal never reopen a previous selection.
