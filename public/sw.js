const CACHE_NAME = 'attendance-portal-v212';

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
  
  // Always fetch directly from network without caching app.js or HTML or API
  if (e.request.url.includes('/app.js') || e.request.url.includes('/api/') || e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(async () => {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        if (e.request.url.includes('/api/')) {
          return new Response(JSON.stringify({ success: false, error: 'Network error' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response('Network error', { status: 503 });
      })
    );
    return;
  }

  e.respondWith(
    fetch(e.request).catch(async () => {
      const cached = await caches.match(e.request);
      return cached || new Response('Offline', { status: 503 });
    })
  );
});
