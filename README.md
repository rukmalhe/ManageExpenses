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
