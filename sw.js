/* sw.js */
const CACHE_NAME = 'planflow-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/variables.css',
  './css/base.css',
  './css/components.css',
  './css/views.css',
  './lib/dexie.mjs',
  './js/app.js',
  './js/db.js',
  './js/seed.js',
  './js/utils/id.js',
  './js/utils/date.js',
  './js/utils/animate.js',
  './js/utils/haptics.js',
  './js/models/task.js',
  './js/models/plan.js',
  './js/models/preferences.js',
  './js/engine/recurrence.js',
  './js/engine/scoring.js',
  './js/engine/planner.js',
  './js/engine/reschedule.js',
  './js/components/toast.js',
  './js/components/modal.js',
  './js/components/taskCard.js',
  './js/components/timeSlot.js',
  './js/components/nav.js',
  './js/components/installPrompt.js',
  './js/components/onboarding.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png'
];

// Install: Cache App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Pre-caching App Shell');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: Clean up old caches & claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Stale-While-Revalidate for app assets
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Serve static assets from local origin via Stale-While-Revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseClone);
              });
            }
            return networkResponse;
          })
          .catch((err) => {
            console.log('[Service Worker] Fetch failed (offline):', err);
            return cachedResponse; // Fallback to cache if network fails
          });

        return cachedResponse || fetchPromise;
      })
    );
  }
});
