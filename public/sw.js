const CACHE_NAME = 'attendance-portal-v283-nocache';

// Install Event - skip waiting immediately
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

// Activate Event - PURGE ALL OLD CACHES IMMEDIATELY AND UNREGISTER
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => self.clients.claim()).then(() => self.registration.unregister())
  );
});

// Fetch Event - ALWAYS go to network for JS/HTML/API
self.addEventListener('fetch', (e) => {
  if (!e.request.url.startsWith('http')) return;
  
  // NEVER intercept API requests — allow native browser networking
  if (e.request.url.includes('/api/')) {
    return;
  }

  // Always fetch directly from network without caching app.js or HTML
  if (e.request.url.includes('/app.js') || e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(async () => {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        return new Response('<!DOCTYPE html><html><body><h1>Offline</h1><p>Please check your connection and reload.</p></body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        });
      })
    );
    return;
  }

  e.respondWith(
    fetch(e.request).catch(async () => {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      return new Response('', { status: 200 });
    })
  );
});
