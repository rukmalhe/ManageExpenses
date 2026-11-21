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

for (const type of ['shared', 'personal']) {
  test(`creates a ${type} event while the live connection is reconnecting`, async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('fixture-live-disconnected', 'yes');
      window.dispatchEvent(new Event('online'));
    });
    await page.locator('#new-event').click();
    await page.locator('#event-form [name="type"]').selectOption(type);
    await page.locator('#event-form [name="name"]').fill('New expense event');
    await page.getByRole('button', { name: 'Create event', exact: true }).click();
    await expect(page.locator('#event-dialog')).toBeHidden();
    await expect(page.locator('#event-detail')).toBeVisible();
    await expect(page.locator('#event-list')).toContainText('New expense event');
    await page.reload();
    await expect(page.locator('#sync-state')).toHaveText('Synced');
    await page.locator(type === 'personal' ? '#personal-events' : '#active-events').click();
    await expect(page.locator('#event-list')).toContainText('New expense event');
  });
}

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


test('sync stays available when the live socket is disconnected but internet requests work', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('fixture-live-disconnected','yes'));
  await page.reload();
  await expect(page.locator('#sync-state')).toHaveText('Synced');
  await expect(page.locator('#sync-now')).toBeEnabled();
  await page.locator('#event-list button').filter({hasText:'Shared test trip'}).click();
  await page.locator('#expense-form [name="description"]').fill('Socket-independent sync');
  await page.locator('#expense-form [name="amount"]').fill('12.34');
  await page.locator('#expense-form button').filter({hasText:'Add expense'}).click();
  await expect(page.locator('#sync-detail')).toContainText('0 pending changes');
  await expect(page.locator('#sync-state')).toHaveText('Synced');
});

test('keeps details empty until selection and clears them on tab changes, closing, and reload', async ({ page }) => {
  const detail=page.locator('#event-detail');
  await expect(detail).toBeHidden(); await expect(detail).toBeEmpty();
  await page.locator('#event-list button').filter({hasText:'Shared test trip'}).click();
  await expect(detail).toBeVisible(); await expect(detail).toContainText('Shared test trip');
  await page.locator('#personal-events').click();
  await expect(detail).toBeHidden(); await expect(detail).toBeEmpty();
  await page.locator('#sync-now').click();
  await expect(page.locator('#sync-state')).toHaveText('Synced');
  await expect(detail).toBeHidden(); await expect(detail).toBeEmpty();
  await page.locator('#event-list button').filter({hasText:'Personal test event'}).click();
  await expect(detail).toBeVisible(); await expect(detail).toContainText('Personal test event');
  await page.getByRole('button',{name:'Back to events'}).click();
  await expect(detail).toBeHidden(); await expect(detail).toBeEmpty();
  await page.locator('#sync-now').click();
  await expect(page.locator('#sync-state')).toHaveText('Synced');
  await expect(detail).toBeHidden();
  await page.reload(); await expect(page.locator('#sync-state')).toHaveText('Synced');
  await expect(detail).toBeHidden(); await expect(detail).toBeEmpty();
});

test('clears an open detail panel when background sync moves the event to Archived', async ({ page,request }) => {
  await page.locator('#event-list button').filter({hasText:'Shared test trip'}).click();
  await expect(page.locator('#event-detail')).toBeVisible();
  await request.post('/test-control',{data:{archive:true}});
  await page.locator('#sync-now').click();
  await expect(page.locator('#event-detail')).toBeHidden(); await expect(page.locator('#event-detail')).toBeEmpty();
  await page.locator('#archived-events').click();
  await expect(page.locator('#event-detail')).toBeHidden();
  await page.locator('#event-list button').filter({hasText:'Shared test trip'}).click();
  await expect(page.locator('#event-detail')).toBeVisible();
});


test('touch switching clears the last event in both directions, including while sync is running', async ({ page }) => {
  const detail=page.locator('#event-detail');
  await page.locator('#event-list button').filter({hasText:'Shared test trip'}).tap();
  await expect(detail).toContainText('Shared test trip');
  await page.locator('#personal-events').tap();
  await expect(detail).toBeHidden(); await expect(detail).toBeEmpty();
  await page.locator('#event-list button').filter({hasText:'Personal test event'}).tap();
  await expect(detail).toContainText('Personal test event');
  await page.locator('#active-events').tap();
  await expect(detail).toBeHidden(); await expect(detail).toBeEmpty();
  await expect(page.locator('#event-list button[aria-pressed="true"]')).toHaveCount(0);
  await page.locator('#personal-events').tap();
  await expect(detail).toBeHidden(); await expect(detail).toBeEmpty();
  await page.locator('#event-list button').filter({hasText:'Personal test event'}).tap();
  await page.locator('#sync-now').tap();
  await page.locator('#active-events').tap();
  await expect(page.locator('#sync-state')).toHaveText('Synced');
  await expect(detail).toBeHidden(); await expect(detail).toBeEmpty();
  await page.locator('#personal-events').tap();
  await expect(detail).toBeHidden(); await expect(detail).toBeEmpty();
});

test('does not reopen a panel from an event-card handler created before changing tabs', async ({ page }) => {
  await page.locator('#event-list button').filter({hasText:'Shared test trip'}).evaluate(button => { window.oldCardClick=button.onclick; });
  await page.locator('#personal-events').tap();
  await page.locator('#active-events').tap();
  await page.evaluate(()=>window.oldCardClick());
  await expect(page.locator('#event-detail')).toBeHidden(); await expect(page.locator('#event-detail')).toBeEmpty();
});


test('aligns mobile expense buttons and deletes personal expenses with the live connection down', async ({ page,request }) => {
  await request.post('/test-control',{data:{personalExpense:true}});
  await page.evaluate(()=>localStorage.setItem('fixture-live-disconnected','yes'));
  await page.reload();
  await page.locator('#personal-events').tap();
  await page.locator('#event-list button').filter({hasText:'Personal test event'}).tap();
  const row=page.locator('#personal-expenses .expense-row').filter({hasText:'Rest of line'});
  await expect(row).toBeVisible();
  for (const width of [393,320]) {
    await page.setViewportSize({width,height:844});
    const edit=await row.getByRole('button',{name:'Edit',exact:true}).boundingBox();
    const remove=await row.getByRole('button',{name:'Delete',exact:true}).boundingBox();
    const panel=await page.locator('#event-detail').boundingBox();
    expect(Math.abs(edit.y-remove.y)).toBeLessThan(2);
    expect(remove.x).toBeGreaterThanOrEqual(edit.x+edit.width);
    expect(edit.height).toBeGreaterThanOrEqual(44); expect(remove.height).toBeGreaterThanOrEqual(44);
    expect(remove.x+remove.width).toBeLessThanOrEqual(panel.x+panel.width);
    expect(await page.evaluate(()=>document.body.scrollWidth<=innerWidth)).toBe(true);
    if (width===393) await row.screenshot({path:test.info().outputPath('mobile-expense-actions.png')});
  }
  page.once('dialog',dialog=>dialog.accept());
  await row.getByRole('button',{name:'Delete',exact:true}).tap();
  await expect(row).toHaveCount(0);
  await expect(page.locator('#sync-detail')).toContainText('0 pending changes');
  expect((await (await request.get('/test-control')).json()).personal.expenses.personalMeal).toBeUndefined();
});

test('deletes an expense while its creation upload is still in progress', async ({ page,request }) => {
  await page.locator('#event-list button').filter({hasText:'Shared test trip'}).tap();
  await request.post('/test-control',{data:{holdUpload:true}});
  await page.locator('#expense-form [name="description"]').fill('Delete during upload');
  await page.locator('#expense-form [name="amount"]').fill('7.25');
  await page.locator('#expense-form button').filter({hasText:'Add expense'}).click();
  await expect.poll(async()=> (await (await request.get('/test-control')).json()).__uploadWaiting).toBe(true);
  const row=page.locator('#expenses .expense-row').filter({hasText:'Delete during upload'});
  page.once('dialog',dialog=>dialog.accept());
  await row.getByRole('button',{name:'Delete Delete during upload',exact:true}).click();
  await expect(row).toHaveCount(0);
  await request.post('/test-control',{data:{releaseUpload:true}});
  await expect(page.locator('#sync-detail')).toContainText('0 pending changes');
  const data=await (await request.get('/test-control')).json();
  expect(Object.values(data.trip.expenses).filter(e=>e.description==='Delete during upload')).toHaveLength(0);
});

test('keeps an offline deletion through reload and applies it once after reconnecting', async ({ page,context,request }) => {
  await page.locator('#event-list button').filter({hasText:'Shared test trip'}).tap();
  await setOffline(context,page,request,true);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-delete="meal"]').click();
  await expect(page.locator('[data-delete="meal"]')).toHaveCount(0);
  await expect(page.locator('#sync-detail')).toContainText('1 pending change');
  await page.goto('/?offline-delete-reopen=1');
  await page.locator('#event-list button').filter({hasText:'Shared test trip'}).tap();
  await expect(page.locator('[data-delete="meal"]')).toHaveCount(0);
  await setOffline(context,page,request,false);
  await expect(page.locator('#sync-detail')).toContainText('0 pending changes');
  expect((await (await request.get('/test-control')).json()).trip.expenses.meal).toBeUndefined();
});

test('deletes recurring schedules over HTTPS while the live connection is unavailable', async ({ page,request }) => {
  await request.post('/test-control',{data:{schedule:true}});
  await page.evaluate(()=>localStorage.setItem('fixture-live-disconnected','yes'));
  await page.reload();
  await page.locator('#personal-events').tap();
  await page.locator('#event-list button').filter({hasText:'Personal test event'}).tap();
  const button=page.locator('[data-schedule-delete="loan"]');
  await expect(button).toBeVisible();
  page.once('dialog',dialog=>dialog.accept()); await button.click();
  await expect(button).toHaveCount(0);
  expect((await (await request.get('/test-control')).json()).personal.recurring.loan).toBeUndefined();
});
