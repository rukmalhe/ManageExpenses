    // This runs even if the browser cannot load the application module.
    window.showAuthStatus = function (message) {
      document.getElementById('auth-status').textContent = message;
    };
    if (location.protocol === 'file:') {
      window.showAuthStatus('Open http://localhost:8000 instead of opening this file directly. Start the server with: python3 -m http.server 8000');
    } else {
      window.authLoadingTimer = setTimeout(function () {
        window.showAuthStatus('Firebase is taking longer than expected to load. Check your internet connection and allow www.gstatic.com in any content blocker, then reload.');
      }, 15000);
      import('./index.js').catch(function (error) {
        clearTimeout(window.authLoadingTimer);
        window.showAuthStatus('Could not load the app: ' + error.message + '. Reload the page and check your connection.');
      });
    }

// HTTPS (or localhost) is required for installation and offline loading.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).then(registration => {
    const button = document.getElementById('update-app');
    let updateRequested = false;
    const ready = () => {
      if (registration.active) document.dispatchEvent(new Event('offline-shell-ready'));
    };
    ready();
    navigator.serviceWorker.ready.then(ready);
    const update = () => {
      // A first installation briefly enters "waiting" too; it is not an update.
      if (!registration.waiting || !navigator.serviceWorker.controller) return;
      button.hidden = false;
      button.onclick = () => {
        if (registration.waiting && confirm('Reload to install the app update? Finish any unsaved form first.')) {
          updateRequested = true;
          registration.waiting.postMessage('activate');
        }
      };
    };
    update();
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', update);
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateRequested) location.reload();
      else button.hidden = true;
    });
  }).catch(() => {
    const note = document.getElementById('offline-ready');
    if (note) note.textContent = 'Offline setup failed. Stay online and reload to retry.';
  });
}
