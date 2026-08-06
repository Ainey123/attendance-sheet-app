const CACHE_NAME = 'attendance-portal-v202';

// Install Event - skip waiting immediately
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

// Activate Event - PURGE ALL OLD CACHES IMMEDIATELY
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - ALWAYS go to network for JS/HTML/API
self.addEventListener('fetch', (e) => {
  if (!e.request.url.startsWith('http')) return;
  
  // Always fetch directly from network without caching app.js or HTML
  if (e.request.url.includes('/app.js') || e.request.url.includes('/api/') || e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
