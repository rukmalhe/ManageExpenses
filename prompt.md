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
 personal expenses has occuring expenses where user can define these occoring expenses with time line. i.e. loan payment from jan 2026 to dec 2027, monthly.


 bugs
 1. remove traveler doesnt remove the traveler, only getting the confirmation but doesn't remove : fixed
 2. Add event, shows permission denied error in background : fixed
 3. Personal Expenses shown with travel members, it should be personal, not showing to others, they can create their own one.
 4. duplicate account id, no warning message


improvements:
  1. Forcus error/acknowlege tosters after the event
  2. Personal Expenses - Repeat option - month , weekly, fortnighly, once
  3. List expenses group by type, i.e. transport should display together, i have car and bus transport, recurring. should display by group.
  4. active, personal, and archived : pls rename as active -> shared, personal, and archived
