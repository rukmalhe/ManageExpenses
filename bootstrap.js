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
      import('./index.js?v=team-access-3').catch(function (error) {
        clearTimeout(window.authLoadingTimer);
        window.showAuthStatus('Could not load the app: ' + error.message + '. Reload the page and check your connection.');
      });
    }
