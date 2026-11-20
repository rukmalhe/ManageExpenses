Context: creating a web application to share the expenses within the members, registered user can create the event and add members, each member should get the login screen and screen to list down their expenses. Expense categories will be food, transports etc. can be define when creating the event. javascripts, and firebase db will be going to use. 

Write the code to store and manage the app's traveler and expense data using
Firebase's Realtime Database. Use my Firebase configuration.

Create index.html page
  review with me
styles.css
  review with me
index.js
  reveiw with me

Changes
 - delete events when there are no payments history
 - auto archive events when you have more than 3 month evennts, - events should be moved to different tab automatically.
 - able to delete travelers and when deleting the total expenses re-adjusted with the team
 - new event type - personal expenses, which don't have travelers, this event type has monthly expenses, only show current month in the list, but user can search old expenses.
 Personal expenses support recurring payment schedules with a first payment date and a last payment date. For example, a monthly loan payment from January 2026 through December 2027. Scheduled amounts are calculated for each month; they are not recorded as completed payments.


 bugs
 1. remove traveler doesnt remove the traveler, only getting the confirmation but doesn't remove : fixed
 2. Add event, shows permission denied error in background : fixed
 3. Personal Expenses shown with travel members, it should be personal, not showing to others, they can create their own one.
 4. duplicate account id, no warning message

 5. Event details must remain empty and hidden until the user selects an event. Switching tabs, returning to summaries, signing out, or losing access must clear the previous selection. Background sync must not reopen it. Verify touch switching in both Shared → Personal and Personal → Shared directions; selections and delayed event-card handlers must belong to the tab where they were created. Provide Back to events, especially for mobile.


improvements:
  1. Forcus error/acknowlege tosters after the event
  2. Personal expenses: support Once, Monthly, Weekly, and Fortnightly repeat options. Recurring schedules require a first and last payment date. Monthly schedules repeat on the selected day, using the last day of shorter months when necessary. Weekly and fortnightly schedules repeat every 7 or 14 days from the first payment date, including payments on the last payment date.
  3. List expenses group by type, i.e. transport should display together, i have car and bus transport, recurring. should display by group.
  4. active, personal, and archived : pls rename as active -> shared, personal, and archived
  5. I should able to add amounts like 24.69+56.71+209.67 in the amount field, and it should calculate the total before adding.. 
  6. Editing saved one-off expenses:
     - Add Edit next to Delete for saved one-off expenses. Load the expense into the same form so the user can change its amount and date, then Save changes or Cancel edit.
     - Recurring payment schedules and their generated occurrences cannot be edited after saving. Do not show Edit or Edit schedule controls for them, and reject schedule changes in the application and Firebase rules.
     - To correct a recurring schedule, delete it and create a replacement. Explain that deleting a schedule removes its calculated amounts from every month, including earlier months. Ask for confirmation before deleting.
     - Keep recurring and one-off expenses together in their category groups and recalculate monthly and category totals after changes.
     - Display success or error feedback after saving or deleting. Existing monthly schedules remain compatible.
  7. Show total expenditure as of today against each event in the Shared, Personal, and Archived event lists.
     - Total all saved one-off expenses dated on or before the user's local date, across all months. For shared events, show the whole team's total rather than the user's share.
     - For personal events, also include recurring payments due on or before today, from the start of each schedule. Exclude future one-off expenses and future scheduled occurrences.
     - Display each total in its event's currency and label it "Total through today". Scheduled amounts are included as due amounts, not confirmed payments.
     - Update totals when expenses or schedules are added, edited, or deleted, and refresh the date cutoff while the app remains open.

Recurring-payment verification:
 - Test monthly, weekly, and fortnightly schedules, including month boundaries, leap years, and daylight-saving changes.
 - Verify recurring schedules can be created and deleted but cannot be modified, including direct database updates by their owner.
 - Verify saved one-off expenses still support amount and date edits.
 - Publish the updated database.rules.json when deploying; local emulator tests do not update live Firebase rules.


8. iOS-friendly client app with offline use and synchronization. Implemented as a PWA using the existing interface and Firebase database; device acceptance testing remains required.

Use an installable web app (PWA), preserving the existing application and database.

1. **Design the mobile interface**
   - Use a single-column layout with large touch controls.
   - Make event navigation, expense entry, and totals easy to use on small screens.
   - Support iPhone safe areas and the on-screen keyboard.

2. **Support installation**
   - Allow installation through Safari’s **Add to Home Screen**.
   - Require an internet connection for the first setup, sign-in, and initial download.
   - Cache the application so it can reopen offline.

3. **Store data locally**
   - Save downloaded events and expenses in account-scoped IndexedDB stores using Dexie.
   - Show the last successful synchronization time.
   - Clearly distinguish saved server data from pending local changes.

4. **Allow offline expense entry**
   - Queue new one-off expenses, permitted edits, and one-off deletions locally. Deletion must work during an in-flight sync and must not be blocked by a disconnected live socket.
   - Preserve pending changes when the app closes.
   - Initially require a connection for traveler management, event deletion, and recurring-schedule changes.

5. **Add synchronization**
   - Synchronize automatically when the app opens or regains a connection.
   - Provide a **Sync now** button while online.
   - Show Offline, Syncing, Synced, and Sync failed states.
   - Prevent duplicate expenses when retrying uploads by keeping a stable expense ID and using conditional server writes.

6. **Handle conflicts and account security**
   - Detect when another device has edited or deleted the same expense.
   - Ask the user to resolve conflicting edits.
   - Recheck Firebase permissions during synchronization.
   - Keep each account’s cached data separate and handle pending changes before sign-out.

7. **Test on iPhones**
   - Test installation, airplane mode, reopening offline, reconnection, and manual synchronization.
   - Verify queued expenses upload exactly once.
   - Test expired sign-ins, revoked event access, and conflicting changes.

**iOS limitation:** plan synchronization while the app is open. Background synchronization after the app closes should not be promised.
Mobile expense rows: keep the amount aligned above Edit/Delete buttons in a dedicated action group. Buttons must stay aligned and inside the card on narrow screens, with at least 44px touch height. Recurring-schedule deletion remains online-only but uses HTTPS rather than requiring a live socket.
