import { test, expect } from '@playwright/test';

// Playwright's WebKit offline toggle blocks cached service-worker responses.
// For WebKit, make the fixture server unavailable and expose offline state to
// the SDK fixture. Chromium additionally tests the browser's real offline flag.
async function setOffline(context, page, request, offline) {
  if (context.browser().browserType().name() === 'webkit') {
    await request.post('/test-control',{ data:{ offline } });
    await page.evaluate(value => {
      localStorage.setItem('fixture-offline',value ? 'yes' : 'no');
      window.dispatchEvent(new Event(value ? 'offline' : 'online'));
    },offline);
  } else await context.setOffline(offline);
}

test.beforeEach(async ({ request, page, context }) => {
  if (context.browser().browserType().name() === 'webkit') {
    await context.addInitScript(() => Object.defineProperty(navigator,'onLine',{ get:()=>localStorage.getItem('fixture-offline')!=='yes' }));
  }
  await request.post('/test-control', { data: { reset:true } });
  await page.goto('/');
  await expect(page.locator('#sync-state')).toHaveText('Synced').catch(async error => { console.log('Sync detail:', await page.locator('#sync-detail').textContent(), 'Status:', await page.locator('#status').textContent()); throw error; });
  await expect(page.locator('#offline-ready')).toContainText('Ready for offline use');
});

test('installs the offline shell, survives an offline reload, and uploads an expense exactly once', async ({ page, context, request }) => {
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.evaluate(() => innerWidth));
  await page.locator('#event-list button').filter({ hasText:'Shared test trip' }).click();
  await setOffline(context,page,request,true);
  await expect(page.locator('#sync-state')).toHaveText('Offline');
  await page.locator('#expense-form [name="description"]').fill('Offline coffee');
  await page.locator('#expense-form [name="amount"]').fill('24.69+56.71');
  await expect(page.locator('#amount-total')).toContainText('81.40');
  await page.locator('#expense-form button').filter({ hasText:'Add expense' }).click();
  await expect(page.locator('#sync-detail')).toContainText('1 pending change');
  await expect(page.locator('#expenses')).toContainText('Offline coffee');
  await page.goto('/?offline-reopen=1');
  await expect(page.locator('#sync-state')).toHaveText('Offline');
  await page.locator('#event-list button').filter({ hasText:'Shared test trip' }).click();
  await expect(page.locator('#expenses')).toContainText('Offline coffee');
  await expect(page.locator('#expenses')).toContainText('Pending sync');
  await setOffline(context,page,request,false);
  await expect(page.locator('#sync-state')).toHaveText('Synced');
  await expect(page.locator('#sync-detail')).toContainText('0 pending changes');
  await page.locator('#sync-now').click();
  await expect(page.locator('#sync-state')).toHaveText('Synced');
  const data=await (await request.get('/test-control')).json();
  const coffees=Object.values(data.trip.expenses).filter(e=>e.description==='Offline coffee');
  expect(coffees).toHaveLength(1); expect(coffees[0].amount).toBe(8140);
});

test('detects conflicting offline edits and lets the user keep the server version', async ({ page, context, request }) => {
  await page.locator('#event-list button').filter({ hasText:'Shared test trip' }).click();
  await setOffline(context,page,request,true);
  await page.locator('[data-edit-expense="meal"]').click();
  await page.locator('#expense-form [name="amount"]').fill('2.00');
  await page.locator('#expense-form button').filter({ hasText:'Save changes' }).click();
  await expect(page.locator('#sync-detail')).toContainText('1 pending change');
  await request.post('/test-control',{ data:{ amount:300 } });
  await setOffline(context,page,request,false);
  await expect(page.locator('#sync-issues')).toBeVisible();
  await expect(page.locator('#sync-issues')).toContainText('Your change: 2.00');
  await expect(page.locator('#sync-issues')).toContainText('Server: 3.00');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Use server version'}).click();
  await expect(page.locator('#sync-detail')).toContainText('0 pending changes');
  const data=await (await request.get('/test-control')).json(); expect(data.trip.expenses.meal.amount).toBe(300);
});

test('offline personal expenses are private when accounts change', async ({ page, context, request }) => {
  await page.locator('#personal-events').click();
  await page.locator('#event-list button').filter({ hasText:'Personal test event' }).click();
  await setOffline(context,page,request,true);
  await page.locator('#personal-form [name="description"]').fill('Private offline expense');
  await page.locator('#personal-form [name="amount"]').fill('9.99');
  await page.locator('#personal-form button').filter({hasText:'Save expense'}).click();
  await expect(page.locator('#sync-detail')).toContainText('1 pending change');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#logout').click();
  await expect(page.locator('#auth-panel')).toBeVisible();
  await page.evaluate(()=>{ localStorage.setItem('fixture-account','other'); window.dispatchEvent(new Event('fixture-account')); });
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#event-list')).not.toContainText('Personal test event');
  await expect(page.locator('#event-detail')).not.toContainText('Private offline expense');
  await expect(page.locator('#sync-detail')).toContainText('0 pending changes');
});


test('only applies a conflicting edit after the user explicitly selects their version', async ({ page, context, request }) => {
  await page.locator('#event-list button').filter({ hasText:'Shared test trip' }).click();
  await setOffline(context,page,request,true);
  await page.locator('[data-edit-expense="meal"]').click();
  await page.locator('#expense-form [name="amount"]').fill('4.00');
  await page.locator('#expense-form button').filter({ hasText:'Save changes' }).click();
  await expect(page.locator('#sync-detail')).toContainText('1 pending change');
  await request.post('/test-control',{ data:{ amount:500 } });
  await setOffline(context,page,request,false);
  await expect(page.locator('#sync-issues')).toContainText('Server: 5.00');
  expect((await (await request.get('/test-control')).json()).trip.expenses.meal.amount).toBe(500);
  await page.getByRole('button',{name:'Apply my amount and date'}).click();
  await expect(page.locator('#sync-detail')).toContainText('0 pending changes');
  expect((await (await request.get('/test-control')).json()).trip.expenses.meal.amount).toBe(400);
});

test('keeps a revoked event’s pending changes for review and removes its cached event', async ({ page, context, request }) => {
  await page.locator('#event-list button').filter({ hasText:'Shared test trip' }).click();
  await setOffline(context,page,request,true);
  await page.locator('#expense-form [name="description"]').fill('Unsynced meal');
  await page.locator('#expense-form [name="amount"]').fill('3.00');
  await page.locator('#expense-form button').filter({hasText:'Add expense'}).click();
  await expect(page.locator('#sync-detail')).toContainText('1 pending change');
  await request.post('/test-control',{ data:{ revoke:true } });
  await setOffline(context,page,request,false);
  await expect(page.locator('#sync-issues')).toBeVisible();
  await expect(page.locator('#sync-detail')).toContainText('1 pending change');
  await expect(page.locator('#event-list')).not.toContainText('Shared test trip');
  const data=await (await request.get('/test-control')).json();
  expect(Object.values(data.trip.expenses).filter(e=>e.description==='Unsynced meal')).toHaveLength(0);
});
