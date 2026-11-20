import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { it, expect, vi } from 'vitest';
async function worker() {
  const listeners = {}, cache = { addAll:vi.fn(async()=>{}), match:vi.fn(async()=>new Response('cached shell')), put:vi.fn() };
  const caches = { open:vi.fn(async()=>cache), keys:vi.fn(async()=>['roam-shell-old','another-app-cache']), delete:vi.fn() };
  const self = { location:{origin:'https://expenses.example'}, addEventListener:(type,handler)=>listeners[type]=handler, clients:{claim:vi.fn()}, skipWaiting:vi.fn() };
  vm.runInNewContext(await readFile('service-worker.js','utf8'), { self,caches,URL,Response,AbortSignal,fetch:vi.fn(async()=>{ throw new Error("Offline"); }) });
  return { listeners,cache,caches,self };
}
it('preloads the app, IndexedDB library, and Firebase SDK before installation completes', async()=>{
  const {listeners,cache}=await worker(); let ready;
  listeners.install({waitUntil:promise=>ready=promise}); await ready;
  const files=cache.addAll.mock.calls[0][0];
  expect(files).toContain('/offline-store.js'); expect(files).toContain('/vendor/dexie.mjs');
  expect(files.filter(url=>url.includes('gstatic.com/firebasejs'))).toHaveLength(3);
});
it('does not cache database responses, auth callbacks, or non-GET requests', async()=>{
  const {listeners}=await worker();
  for (const [url,method,mode] of [
    ['https://project.firebaseio.com/events.json?auth=secret','GET','cors'],
    ['https://expenses.example/__/auth/handler','GET','navigate'],
    ['https://expenses.example/unknown.json?auth=secret','GET','cors'],
    ['https://expenses.example/index.html','POST','navigate']
  ]) {
    const respondWith=vi.fn(); listeners.fetch({request:{url,method,mode},respondWith}); expect(respondWith).not.toHaveBeenCalled();
  }
});
it('serves a cached navigation without a network request and leaves other applications’ caches alone', async()=>{
  const {listeners,caches,cache}=await worker(); let response,ready;
  listeners.fetch({request:{url:'https://expenses.example/?reopen=1',method:'GET',mode:'navigate'},respondWith:value=>response=value});
  expect(await (await response).text()).toBe('cached shell'); expect(cache.match).toHaveBeenCalledWith('/index.html');
  listeners.activate({waitUntil:value=>ready=value}); await ready;
  expect(caches.delete).toHaveBeenCalledWith('roam-shell-old'); expect(caches.delete).not.toHaveBeenCalledWith('another-app-cache');
});

it('does not reload on first installation and only activates an update after confirmation', async()=>{
  const listeners={}, registrationListeners={}, installingListeners={};
  const button={hidden:true}, postMessage=vi.fn(), reload=vi.fn(), confirm=vi.fn(()=>false);
  const registration={active:{}, waiting:{postMessage}, installing:{addEventListener:(type,handler)=>installingListeners[type]=handler}, addEventListener:(type,handler)=>registrationListeners[type]=handler};
  const serviceWorker={controller:null,register:async()=>registration,ready:Promise.resolve(registration),addEventListener:(type,handler)=>listeners[type]=handler};
  const source=await readFile('bootstrap.js','utf8');
  vm.runInNewContext(source.slice(source.indexOf('// HTTPS (or localhost)')), {
    navigator:{serviceWorker}, location:{protocol:'https:',reload}, confirm, Event,
    document:{getElementById:()=>button,dispatchEvent:vi.fn()}
  });
  await Promise.resolve(); await Promise.resolve();
  expect(button.hidden).toBe(true);
  serviceWorker.controller={}; listeners.controllerchange(); expect(reload).not.toHaveBeenCalled();
  registrationListeners.updatefound(); installingListeners.statechange(); expect(button.hidden).toBe(false);
  button.onclick(); expect(postMessage).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); button.onclick(); expect(postMessage).toHaveBeenCalledWith('activate');
  listeners.controllerchange(); expect(reload).toHaveBeenCalledTimes(1);
});
